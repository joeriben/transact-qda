#!/bin/bash
set -euo pipefail

APP_NAME="transact-qda"
APP_USER="${APP_USER:-transact-qda}"
INSTALL_DIR="${INSTALL_DIR:-/opt/transact-qda}"
STATE_DIR="${STATE_DIR:-/var/lib/transact-qda}"
DB_NAME="${DB_NAME:-transact_qda}"
DB_USER="${DB_USER:-tqda}"
DB_PASSWORD="${DB_PASSWORD:-}"
DB_PORT="${DB_PORT:-15432}"
APP_PORT="${APP_PORT:-5174}"
APP_HOST="${APP_HOST:-127.0.0.1}"
REPO_URL="${REPO_URL:-https://github.com/joeriben/transact-qda.git}"
BRANCH="${BRANCH:-main}"
SESSION_SECRET="${SESSION_SECRET:-}"
RUN_DEMO_SEED="${RUN_DEMO_SEED:-no}"
OPEN_LAUNCHER="${OPEN_LAUNCHER:-yes}"
# SKIP_DB_INIT=yes leaves the freshly created database empty and does not
# auto-start the app service. Use this when migrating an existing dump into
# the new cluster; restore the dump afterwards, then run
# `./scripts/4_db_migrate.sh` and `systemctl start transact-qda.service`.
SKIP_DB_INIT="${SKIP_DB_INIT:-no}"
# Bootstrap mode written into .env (auto|seed|none). `auto` triggers the
# legacy seed on the first start; pick `none` for migrated installations to
# avoid the in-app seed touching restored data.
TQDA_BOOTSTRAP_MODE="${TQDA_BOOTSTRAP_MODE:-auto}"

DB_SERVICE_NAME="transact-qda-db.service"
APP_SERVICE_NAME="transact-qda.service"
LAUNCHER_PATH="/usr/local/bin/transact-qda-open"
UPDATE_HELPER_PATH="/usr/local/bin/transact-qda-update"
DESKTOP_ENTRY_PATH="/usr/share/applications/transact-qda.desktop"

PGDATA="$STATE_DIR/postgres"
PGRUN="$STATE_DIR/run"
PGBRAND="$STATE_DIR/brand"

PG_BIN_DIR=""
INITDB_BIN=""
POSTGRES_BIN=""
PG_CTL_BIN=""
PSQL_BIN=""
PG_ISREADY_BIN=""

log() {
  echo "[install-local] $*"
}

fail() {
  echo "[install-local] ERROR: $*" >&2
  exit 1
}

need_root() {
  if [ "${EUID:-$(id -u)}" -ne 0 ]; then
    fail "run this installer as root"
  fi
}

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || fail "required command missing: $1"
}

as_app_user() {
  runuser -u "$APP_USER" -- bash -lc "cd '$INSTALL_DIR' && $*"
}

sql_escape() {
  printf "%s" "${1//\'/\'\'}"
}

validate_pg_ident() {
  local value="$1"
  local label="$2"
  [[ "$value" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]] || fail "$label must match [A-Za-z_][A-Za-z0-9_]*"
}

detect_pkg_manager() {
  if command -v apt-get >/dev/null 2>&1; then
    echo "apt"
    return
  fi
  if command -v dnf >/dev/null 2>&1; then
    echo "dnf"
    return
  fi
  fail "supported package manager not found (apt-get or dnf)"
}

have_node_20_or_newer() {
  command -v node >/dev/null 2>&1 || return 1
  local raw major
  raw="$(node --version 2>/dev/null | sed -E 's/^v//; s/[^0-9.].*$//')"
  major="${raw%%.*}"
  [ -n "$major" ] || return 1
  [ "$major" -ge 20 ]
}

install_packages() {
  local pkg_mgr base_pkgs=()
  pkg_mgr="$(detect_pkg_manager)"

  if [ "$pkg_mgr" = "apt" ]; then
    base_pkgs=(git curl ca-certificates postgresql postgresql-contrib xdg-utils)
  else
    base_pkgs=(git curl ca-certificates postgresql-server postgresql-contrib xdg-utils)
  fi

  # Only pull distro nodejs/npm if the host doesn't already have a usable
  # Node. Ubuntu 24/26 ship nodejs from `universe` while many setups use a
  # Nodesource build; mixing both downgrades npm and breaks bundled paths.
  if have_node_20_or_newer; then
    log "node $(node --version) already present, skipping distro nodejs/npm"
  else
    log "no usable Node.js ≥20 found, installing distro nodejs/npm"
    base_pkgs+=(nodejs npm)
  fi

  log "installing system packages via $pkg_mgr: ${base_pkgs[*]}"
  if [ "$pkg_mgr" = "apt" ]; then
    apt-get update
    DEBIAN_FRONTEND=noninteractive apt-get install -y "${base_pkgs[@]}"
  else
    dnf install -y "${base_pkgs[@]}"
  fi
}

install_pgvector() {
  local pkg_mgr major pkg
  pkg_mgr="$(detect_pkg_manager)"
  major="$("$INITDB_BIN" --version 2>/dev/null | sed -E 's/.* ([0-9]+)\..*/\1/; t; s/.*/0/')"
  [ -n "$major" ] && [ "$major" != "0" ] || fail "could not detect PostgreSQL major version from $INITDB_BIN"

  if [ "$pkg_mgr" = "apt" ]; then
    pkg="postgresql-${major}-pgvector"
    if apt-cache show "$pkg" >/dev/null 2>&1; then
      log "installing $pkg for pgvector support"
      DEBIAN_FRONTEND=noninteractive apt-get install -y "$pkg"
    else
      log "WARNING: $pkg not in apt cache — pgvector may need manual install"
    fi
  else
    pkg="pgvector_${major}"
    if dnf list available "$pkg" >/dev/null 2>&1 || dnf list installed "$pkg" >/dev/null 2>&1; then
      log "installing $pkg for pgvector support"
      dnf install -y "$pkg"
    else
      log "WARNING: $pkg not in dnf repos — pgvector may need manual install"
    fi
  fi
}

detect_pg_bin_dir() {
  if command -v initdb >/dev/null 2>&1; then
    PG_BIN_DIR="$(dirname "$(command -v initdb)")"
  elif compgen -G "/usr/lib/postgresql/*/bin/initdb" >/dev/null 2>&1; then
    PG_BIN_DIR="$(ls -d /usr/lib/postgresql/*/bin | sort -V | tail -1)"
  elif compgen -G "/usr/pgsql-*/bin/initdb" >/dev/null 2>&1; then
    PG_BIN_DIR="$(ls -d /usr/pgsql-*/bin | sort -V | tail -1)"
  else
    fail "could not locate PostgreSQL server binaries (initdb/postgres)"
  fi

  INITDB_BIN="$PG_BIN_DIR/initdb"
  POSTGRES_BIN="$PG_BIN_DIR/postgres"
  PG_CTL_BIN="$PG_BIN_DIR/pg_ctl"
  PSQL_BIN="$PG_BIN_DIR/psql"
  PG_ISREADY_BIN="$PG_BIN_DIR/pg_isready"

  [ -x "$INITDB_BIN" ] || fail "missing initdb at $INITDB_BIN"
  [ -x "$POSTGRES_BIN" ] || fail "missing postgres at $POSTGRES_BIN"
  [ -x "$PG_CTL_BIN" ] || fail "missing pg_ctl at $PG_CTL_BIN"
  [ -x "$PSQL_BIN" ] || fail "missing psql at $PSQL_BIN"
  [ -x "$PG_ISREADY_BIN" ] || fail "missing pg_isready at $PG_ISREADY_BIN"
}

load_existing_config() {
  local env_file="$INSTALL_DIR/.env"
  if [ ! -f "$env_file" ]; then
    return
  fi

  if [ -z "$SESSION_SECRET" ]; then
    SESSION_SECRET="$(sed -n 's/^SESSION_SECRET=//p' "$env_file" | tail -1)"
  fi

  if [ -z "$DB_PASSWORD" ]; then
    DB_PASSWORD="$(sed -n 's#^DATABASE_URL=postgresql://[^:]*:\([^@]*\)@.*#\1#p' "$env_file" | tail -1)"
  fi
}

ensure_app_user() {
  if id "$APP_USER" >/dev/null 2>&1; then
    log "using existing app user $APP_USER"
  else
    log "creating app user $APP_USER"
    useradd --system --create-home --home-dir "$STATE_DIR" --shell /usr/sbin/nologin "$APP_USER"
  fi
}

generate_secret() {
  if [ -n "$SESSION_SECRET" ]; then
    return
  fi
  SESSION_SECRET="$(openssl rand -hex 32)"
}

generate_db_password() {
  if [ -n "$DB_PASSWORD" ]; then
    return
  fi
  DB_PASSWORD="$(openssl rand -hex 16)"
}

create_install_dir() {
  log "preparing install dir $INSTALL_DIR"
  mkdir -p "$INSTALL_DIR"
  chown "$APP_USER":"$APP_USER" "$INSTALL_DIR"
}

create_state_dirs() {
  log "preparing local state dir $STATE_DIR"
  install -d -o "$APP_USER" -g "$APP_USER" "$STATE_DIR"
  install -d -o "$APP_USER" -g "$APP_USER" "$PGDATA"
  install -d -o "$APP_USER" -g "$APP_USER" "$PGRUN"
  install -d -o "$APP_USER" -g "$APP_USER" "$PGBRAND"
  install -d -o "$APP_USER" -g "$APP_USER" "$STATE_DIR/uploads"
  install -d -o "$APP_USER" -g "$APP_USER" "$STATE_DIR/projekte"
  install -d -o "$APP_USER" -g "$APP_USER" "$STATE_DIR/coach-library"
  install -d -o "$APP_USER" -g "$APP_USER" "$STATE_DIR/.model-cache"
}

checkout_repo() {
  if [ -d "$INSTALL_DIR/.git" ]; then
    log "repository already present, updating checkout"
    runuser -u "$APP_USER" -- git -C "$INSTALL_DIR" fetch --all --tags
    runuser -u "$APP_USER" -- git -C "$INSTALL_DIR" checkout "$BRANCH"
    runuser -u "$APP_USER" -- git -C "$INSTALL_DIR" pull --ff-only origin "$BRANCH"
  else
    log "cloning repository"
    runuser -u "$APP_USER" -- git clone --branch "$BRANCH" "$REPO_URL" "$INSTALL_DIR"
  fi
}

# The .env is read by `set -a; . .env` (scripts/lib/load_env.sh) and by the
# equivalent loader in scripts/migrate.js. Both treat it as shell syntax, so a
# value containing a space, a quote or a `$` must arrive quoted — otherwise the
# line breaks apart and the variable ends up wrong or the source fails outright.
# Single quotes with the standard '\'' escape are the only form that survives
# every value unchanged; migrate.js strips the surrounding pair again.
env_line() {
  printf "%s='%s'\n" "$1" "$(printf '%s' "$2" | sed "s/'/'\\\\''/g")"
}

write_env_file() {
  local env_file="$INSTALL_DIR/.env"
  log "writing $env_file"
  {
    env_line DATABASE_URL "postgresql://${DB_USER}:${DB_PASSWORD}@127.0.0.1:${DB_PORT}/${DB_NAME}"
    env_line SESSION_SECRET "$SESSION_SECRET"
    env_line HOST "$APP_HOST"
    env_line PORT "$APP_PORT"
    env_line TQDA_BOOTSTRAP "$TQDA_BOOTSTRAP_MODE"
    env_line TQDA_STATE_DIR "$STATE_DIR"
    env_line TQDA_BRAND_DIR "$PGBRAND"
  } >"$env_file"
  cat >>"$env_file" <<EOF

# Instance branding (optional; empty = public/neutral defaults).
# For local installer setups, place branding files under ${PGBRAND}/
# and use URLs such as /brand/logo.svg.
PUBLIC_BRAND_LOGO_URL=
PUBLIC_BRAND_NAME=
PUBLIC_BRAND_LINK=
PUBLIC_IMPRESSUM_URL=
EOF
  chown "$APP_USER":"$APP_USER" "$env_file"
  chmod 600 "$env_file"
}

install_node_deps() {
  log "installing node dependencies"
  as_app_user "npm install"
}

build_app() {
  log "building app"
  as_app_user "npm run build"
}

verify_pdf_support() {
  log "verifying PDF text extraction"
  if as_app_user "node installer/check-pdf-support.mjs"; then
    log "PDF text extraction OK"
  else
    log "WARNING: PDF text extraction is NOT working on this machine."
    log "WARNING: the app still installed fine; only PDF uploads are affected."
    log "WARNING: to retry, run: sudo -u ${APP_USER} bash -lc 'cd \"${INSTALL_DIR}\" && npm install && npm run verify:pdf'"
  fi
}

initialize_local_cluster() {
  if [ -f "$PGDATA/PG_VERSION" ]; then
    log "using existing app-managed PostgreSQL cluster"
    return
  fi

  if [ -n "$(find "$PGDATA" -mindepth 1 -maxdepth 1 -print -quit 2>/dev/null || true)" ]; then
    fail "postgres data dir exists but is not an initialized cluster: $PGDATA"
  fi

  log "initializing app-managed PostgreSQL cluster"
  runuser -u "$APP_USER" -- "$INITDB_BIN" -D "$PGDATA" --username=postgres --auth-local=trust --auth-host=scram-sha-256

  apply_pg_conf_overrides
}

apply_pg_conf_overrides() {
  local conf="$PGDATA/postgresql.conf"
  local marker_begin="### BEGIN transact-qda installer overrides"
  local marker_end="### END transact-qda installer overrides"
  local tmp
  tmp="$(mktemp)"

  # Strip any previous installer block so repeated installs stay idempotent.
  if [ -f "$conf" ]; then
    awk -v b="$marker_begin" -v e="$marker_end" '
      BEGIN { skip = 0 }
      $0 == b { skip = 1; next }
      $0 == e { skip = 0; next }
      skip == 0 { print }
    ' "$conf" >"$tmp"
  fi

  {
    cat "$tmp"
    cat <<EOF
${marker_begin}
listen_addresses = '127.0.0.1'
port = ${DB_PORT}
unix_socket_directories = '${PGRUN}'
unix_socket_permissions = 0700
${marker_end}
EOF
  } >"$conf"
  rm -f "$tmp"
  chown "$APP_USER":"$APP_USER" "$conf"
}

write_db_systemd_unit() {
  log "installing $DB_SERVICE_NAME"
  cat >/etc/systemd/system/"$DB_SERVICE_NAME" <<EOF
[Unit]
Description=transact-qda local PostgreSQL
After=network.target

[Service]
Type=simple
User=${APP_USER}
Group=${APP_USER}
ExecStart=${POSTGRES_BIN} -D ${PGDATA}
ExecStop=${PG_CTL_BIN} -D ${PGDATA} -m fast stop
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF
}

write_app_systemd_unit() {
  log "installing $APP_SERVICE_NAME"
  cat >/etc/systemd/system/"$APP_SERVICE_NAME" <<EOF
[Unit]
Description=transact-qda
After=network.target ${DB_SERVICE_NAME}
Wants=${DB_SERVICE_NAME}

[Service]
Type=simple
User=${APP_USER}
Group=${APP_USER}
WorkingDirectory=${INSTALL_DIR}
EnvironmentFile=${INSTALL_DIR}/.env
ExecStart=/usr/bin/env node ${INSTALL_DIR}/build/index.js
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF
}

enable_db_service() {
  log "enabling and starting $DB_SERVICE_NAME"
  systemctl daemon-reload
  systemctl enable --now "$DB_SERVICE_NAME"
}

wait_for_db() {
  log "waiting for local PostgreSQL to accept connections"
  for i in $(seq 1 60); do
    if runuser -u "$APP_USER" -- "$PG_ISREADY_BIN" -h "$PGRUN" -p "$DB_PORT" -U postgres >/dev/null 2>&1; then
      return
    fi
    sleep 1
  done
  fail "local PostgreSQL did not become ready"
}

create_database() {
  local escaped_password
  escaped_password="$(sql_escape "$DB_PASSWORD")"

  log "creating PostgreSQL role and database for the local app runtime"
  if runuser -u "$APP_USER" -- "$PSQL_BIN" -h "$PGRUN" -p "$DB_PORT" -U postgres -d postgres -tAc \
    "SELECT 1 FROM pg_roles WHERE rolname = '${DB_USER}'" | grep -q 1; then
    runuser -u "$APP_USER" -- "$PSQL_BIN" -h "$PGRUN" -p "$DB_PORT" -U postgres -d postgres -v ON_ERROR_STOP=1 \
      -c "ALTER ROLE ${DB_USER} WITH LOGIN PASSWORD '${escaped_password}'"
  else
    runuser -u "$APP_USER" -- "$PSQL_BIN" -h "$PGRUN" -p "$DB_PORT" -U postgres -d postgres -v ON_ERROR_STOP=1 \
      -c "CREATE ROLE ${DB_USER} LOGIN PASSWORD '${escaped_password}'"
  fi

  if ! runuser -u "$APP_USER" -- "$PSQL_BIN" -h "$PGRUN" -p "$DB_PORT" -U postgres -d postgres -tAc \
    "SELECT 1 FROM pg_database WHERE datname = '${DB_NAME}'" | grep -q 1; then
    runuser -u "$APP_USER" -- "$PSQL_BIN" -h "$PGRUN" -p "$DB_PORT" -U postgres -d postgres -v ON_ERROR_STOP=1 \
      -c "CREATE DATABASE ${DB_NAME} OWNER ${DB_USER}"
  fi

  # pgvector is not a trusted extension, so CREATE EXTENSION needs superuser
  # rights. Migration 019 asks for it, but the migrations run as the app role —
  # which would fail. Create it here as postgres; 019 then finds it in place.
  log "enabling the pgvector extension in ${DB_NAME}"
  runuser -u "$APP_USER" -- "$PSQL_BIN" -h "$PGRUN" -p "$DB_PORT" -U postgres -d "$DB_NAME" -v ON_ERROR_STOP=1 \
    -c "CREATE EXTENSION IF NOT EXISTS vector"
}

run_migrations() {
  if [ "$SKIP_DB_INIT" = "yes" ]; then
    log "SKIP_DB_INIT=yes — leaving database untouched, skipping migrations"
    return
  fi
  log "running migrations"
  as_app_user "./scripts/4_db_migrate.sh"
}

run_bootstrap() {
  if [ "$SKIP_DB_INIT" = "yes" ]; then
    log "SKIP_DB_INIT=yes — skipping bootstrap"
    return
  fi
  log "bootstrapping initial app data if needed"
  as_app_user "node scripts/bootstrap.js"
}

run_seed_if_requested() {
  if [ "$SKIP_DB_INIT" = "yes" ]; then
    log "SKIP_DB_INIT=yes — skipping demo seed"
    return
  fi
  if [ "$RUN_DEMO_SEED" = "yes" ]; then
    log "seeding demo content"
    as_app_user "./scripts/5_db_seed.sh"
  fi
}

enable_app_service() {
  if [ "$SKIP_DB_INIT" = "yes" ]; then
    log "enabling $APP_SERVICE_NAME (deferred start — DB still needs to be restored)"
    systemctl enable "$APP_SERVICE_NAME"
    return
  fi
  log "enabling and starting $APP_SERVICE_NAME"
  systemctl enable --now "$APP_SERVICE_NAME"
}

write_launcher() {
  if [ "$OPEN_LAUNCHER" != "yes" ]; then
    return
  fi

  log "installing launcher helpers"
  cat >"$LAUNCHER_PATH" <<EOF
#!/bin/sh
URL="http://${APP_HOST}:${APP_PORT}"
if command -v xdg-open >/dev/null 2>&1; then
  exec xdg-open "\$URL"
fi
printf '%s\n' "\$URL"
EOF
  chmod 755 "$LAUNCHER_PATH"

  cat >"$DESKTOP_ENTRY_PATH" <<EOF
[Desktop Entry]
Type=Application
Version=1.0
Name=transact-qda
Comment=Open transact-qda in your browser
Exec=${LAUNCHER_PATH}
Terminal=false
Categories=Office;Education;
EOF
  chmod 644 "$DESKTOP_ENTRY_PATH"
}

write_update_helper() {
  log "installing update helper"
  cat >"$UPDATE_HELPER_PATH" <<EOF
#!/bin/sh
exec bash "${INSTALL_DIR}/installer/update.sh"
EOF
  chmod 755 "$UPDATE_HELPER_PATH"
}

print_summary() {
  cat <<EOF

[install-local] complete
[install-local] app dir: $INSTALL_DIR
[install-local] state dir: $STATE_DIR
[install-local] app user: $APP_USER
[install-local] local postgres: 127.0.0.1:$DB_PORT
[install-local] app url: http://${APP_HOST}:${APP_PORT}
[install-local] services: $DB_SERVICE_NAME, $APP_SERVICE_NAME

************************************************************
transact-qda Linux local install: what to do next
************************************************************

Open the app in your browser:
  http://${APP_HOST}:${APP_PORT}
  or:
  transact-qda-open

Start the database manually, if needed:
  systemctl start ${DB_SERVICE_NAME}

Ensure the database starts again after a reboot:
  This installer already enabled ${DB_SERVICE_NAME} and ${APP_SERVICE_NAME}
  via systemd, so they should restart automatically with the machine.

Start the frontend/app service manually, if needed:
  systemctl start ${APP_SERVICE_NAME}

How to log in:
  Username: admin
  Password: adminadmin
  You do NOT need a separate user account first.
  Log in once as admin and change the password immediately.

How to update later:
  sudo transact-qda-update
  or:
  sudo bash "${INSTALL_DIR}/installer/update.sh"

Demo content:
  The installer should create:
  - Sample Project
  - Clarke Abstract Maps (Demo)
  If they are missing, run:
    sudo -u ${APP_USER} bash -lc 'cd "${INSTALL_DIR}" && node scripts/bootstrap.js'

Branding files, if needed:
  ${PGBRAND}

AI settings and keys:
  Configure them through the app after login.
************************************************************
EOF
}

main() {
  need_root
  validate_pg_ident "$DB_NAME" "DB_NAME"
  validate_pg_ident "$DB_USER" "DB_USER"
  load_existing_config
  generate_secret
  generate_db_password

  require_cmd openssl
  require_cmd systemctl
  install_packages
  require_cmd git
  require_cmd node
  require_cmd npm
  require_cmd runuser
  detect_pg_bin_dir
  install_pgvector
  ensure_app_user
  create_install_dir
  create_state_dirs
  checkout_repo
  write_env_file
  install_node_deps
  verify_pdf_support
  build_app
  initialize_local_cluster
  write_db_systemd_unit
  write_app_systemd_unit
  enable_db_service
  wait_for_db
  create_database
  run_migrations
  run_bootstrap
  run_seed_if_requested
  enable_app_service
  write_launcher
  write_update_helper
  print_summary
}

main "$@"
