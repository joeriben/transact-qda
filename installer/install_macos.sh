#!/bin/bash
set -euo pipefail

APP_NAME="transact-qda"
INSTALL_DIR="${INSTALL_DIR:-$HOME/Applications/transact-qda}"
STATE_DIR="${STATE_DIR:-$HOME/Library/Application Support/transact-qda}"
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
OPEN_AFTER_INSTALL="${OPEN_AFTER_INSTALL:-yes}"

LAUNCH_AGENTS_DIR="$HOME/Library/LaunchAgents"
DB_PLIST_LABEL="ai.transact-qda.db"
APP_PLIST_LABEL="ai.transact-qda.app"
DB_PLIST_PATH="$LAUNCH_AGENTS_DIR/${DB_PLIST_LABEL}.plist"
APP_PLIST_PATH="$LAUNCH_AGENTS_DIR/${APP_PLIST_LABEL}.plist"
LAUNCHER_PATH="$HOME/Applications/transact-qda-open.command"
UPDATE_HELPER_PATH="$HOME/Applications/transact-qda-update.command"

PGDATA="$STATE_DIR/postgres"
PGRUN="$STATE_DIR/run"
PGBRAND="$STATE_DIR/brand"
PGLOG="$STATE_DIR/logs"

BREW_PREFIX=""
PG_BIN_DIR=""
NODE_BIN=""
PSQL_BIN=""
PG_ISREADY_BIN=""
INITDB_BIN=""
POSTGRES_BIN=""
PG_CTL_BIN=""

log() {
  echo "[install-macos] $*"
}

fail() {
  echo "[install-macos] ERROR: $*" >&2
  exit 1
}

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || fail "required command missing: $1"
}

sql_escape() {
  printf "%s" "${1//\'/\'\'}"
}

validate_pg_ident() {
  local value="$1"
  local label="$2"
  [[ "$value" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]] || fail "$label must match [A-Za-z_][A-Za-z0-9_]*"
}

need_macos() {
  [ "$(uname -s)" = "Darwin" ] || fail "this installer is for macOS only"
}

ensure_no_root() {
  [ "${EUID:-$(id -u)}" -ne 0 ] || fail "run this installer as your normal macOS user, not root"
}

detect_brew() {
  require_cmd brew
  BREW_PREFIX="$(brew --prefix)"
}

install_packages() {
  log "installing Homebrew packages"
  brew install git node postgresql@16
}

detect_binaries() {
  detect_brew
  PG_BIN_DIR="$(brew --prefix postgresql@16)/bin"
  NODE_BIN="$(command -v node)"
  PSQL_BIN="$PG_BIN_DIR/psql"
  PG_ISREADY_BIN="$PG_BIN_DIR/pg_isready"
  INITDB_BIN="$PG_BIN_DIR/initdb"
  POSTGRES_BIN="$PG_BIN_DIR/postgres"
  PG_CTL_BIN="$PG_BIN_DIR/pg_ctl"

  [ -x "$NODE_BIN" ] || fail "node not found"
  [ -x "$PSQL_BIN" ] || fail "psql not found at $PSQL_BIN"
  [ -x "$PG_ISREADY_BIN" ] || fail "pg_isready not found at $PG_ISREADY_BIN"
  [ -x "$INITDB_BIN" ] || fail "initdb not found at $INITDB_BIN"
  [ -x "$POSTGRES_BIN" ] || fail "postgres not found at $POSTGRES_BIN"
  [ -x "$PG_CTL_BIN" ] || fail "pg_ctl not found at $PG_CTL_BIN"
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

create_dirs() {
  log "preparing install and state directories"
  mkdir -p "$INSTALL_DIR" "$STATE_DIR" "$PGRUN" "$PGBRAND" "$PGLOG"
  mkdir -p "$STATE_DIR/uploads" "$STATE_DIR/projekte" "$STATE_DIR/coach-library" "$STATE_DIR/.model-cache"
  mkdir -p "$LAUNCH_AGENTS_DIR" "$HOME/Applications"
}

checkout_repo() {
  if [ -d "$INSTALL_DIR/.git" ]; then
    log "repository already present, updating checkout"
    git -C "$INSTALL_DIR" fetch --all --tags
    git -C "$INSTALL_DIR" checkout "$BRANCH"
    git -C "$INSTALL_DIR" pull --ff-only origin "$BRANCH"
  else
    log "cloning repository"
    git clone --branch "$BRANCH" "$REPO_URL" "$INSTALL_DIR"
  fi
}

write_env_file() {
  local env_file="$INSTALL_DIR/.env"
  log "writing $env_file"
  cat >"$env_file" <<EOF
DATABASE_URL=postgresql://${DB_USER}:${DB_PASSWORD}@127.0.0.1:${DB_PORT}/${DB_NAME}
SESSION_SECRET=${SESSION_SECRET}
HOST=${APP_HOST}
PORT=${APP_PORT}
TQDA_BOOTSTRAP=auto
TQDA_STATE_DIR=${STATE_DIR}
TQDA_BRAND_DIR=${PGBRAND}

# Instance branding (optional; empty = public/neutral defaults).
# For installer-managed local installs, place branding files under ${PGBRAND}/
# and use URLs such as /brand/logo.svg.
PUBLIC_BRAND_LOGO_URL=
PUBLIC_BRAND_NAME=
PUBLIC_BRAND_LINK=
PUBLIC_IMPRESSUM_URL=
EOF
  chmod 600 "$env_file"
}

install_node_deps() {
  log "installing node dependencies"
  (cd "$INSTALL_DIR" && npm install)
}

build_app() {
  log "building app"
  (cd "$INSTALL_DIR" && npm run build)
}

initialize_local_cluster() {
  if [ -f "$PGDATA/PG_VERSION" ]; then
    log "using existing app-managed PostgreSQL cluster"
    return
  fi

  mkdir -p "$PGDATA"
  if [ -n "$(find "$PGDATA" -mindepth 1 -maxdepth 1 -print -quit 2>/dev/null || true)" ]; then
    fail "postgres data dir exists but is not an initialized cluster: $PGDATA"
  fi

  log "initializing app-managed PostgreSQL cluster"
  "$INITDB_BIN" -D "$PGDATA" --username=postgres --auth-local=trust --auth-host=scram-sha-256

  cat >>"$PGDATA/postgresql.conf" <<EOF
listen_addresses = '127.0.0.1'
port = ${DB_PORT}
unix_socket_directories = '${PGRUN}'
unix_socket_permissions = 0700
logging_collector = on
log_directory = '${PGLOG}'
log_filename = 'postgresql.log'
EOF
}

write_db_plist() {
  log "writing LaunchAgent $DB_PLIST_PATH"
  cat >"$DB_PLIST_PATH" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${DB_PLIST_LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${POSTGRES_BIN}</string>
    <string>-D</string>
    <string>${PGDATA}</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${PGLOG}/launchd-db.out.log</string>
  <key>StandardErrorPath</key>
  <string>${PGLOG}/launchd-db.err.log</string>
</dict>
</plist>
EOF
}

write_app_plist() {
  log "writing LaunchAgent $APP_PLIST_PATH"
  cat >"$APP_PLIST_PATH" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${APP_PLIST_LABEL}</string>
  <key>WorkingDirectory</key>
  <string>${INSTALL_DIR}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${NODE_BIN}</string>
    <string>${INSTALL_DIR}/build/index.js</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>DATABASE_URL</key>
    <string>postgresql://${DB_USER}:${DB_PASSWORD}@127.0.0.1:${DB_PORT}/${DB_NAME}</string>
    <key>SESSION_SECRET</key>
    <string>${SESSION_SECRET}</string>
    <key>HOST</key>
    <string>${APP_HOST}</string>
    <key>PORT</key>
    <string>${APP_PORT}</string>
    <key>TQDA_BOOTSTRAP</key>
    <string>auto</string>
    <key>TQDA_STATE_DIR</key>
    <string>${STATE_DIR}</string>
    <key>TQDA_BRAND_DIR</key>
    <string>${PGBRAND}</string>
    <key>PUBLIC_BRAND_LOGO_URL</key>
    <string></string>
    <key>PUBLIC_BRAND_NAME</key>
    <string></string>
    <key>PUBLIC_BRAND_LINK</key>
    <string></string>
    <key>PUBLIC_IMPRESSUM_URL</key>
    <string></string>
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${PGLOG}/launchd-app.out.log</string>
  <key>StandardErrorPath</key>
  <string>${PGLOG}/launchd-app.err.log</string>
</dict>
</plist>
EOF
}

launchctl_remove_if_loaded() {
  local label="$1"
  launchctl bootout "gui/$(id -u)/${label}" >/dev/null 2>&1 || true
  launchctl remove "$label" >/dev/null 2>&1 || true
}

load_db_service() {
  log "loading LaunchAgent ${DB_PLIST_LABEL}"
  launchctl_remove_if_loaded "$DB_PLIST_LABEL"
  launchctl bootstrap "gui/$(id -u)" "$DB_PLIST_PATH"
  launchctl enable "gui/$(id -u)/${DB_PLIST_LABEL}"
  launchctl kickstart -k "gui/$(id -u)/${DB_PLIST_LABEL}"
}

wait_for_db() {
  log "waiting for local PostgreSQL to accept connections"
  for i in $(seq 1 60); do
    if "$PG_ISREADY_BIN" -h "$PGRUN" -p "$DB_PORT" -U postgres >/dev/null 2>&1; then
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
  if "$PSQL_BIN" -h "$PGRUN" -p "$DB_PORT" -U postgres -d postgres -tAc \
    "SELECT 1 FROM pg_roles WHERE rolname = '${DB_USER}'" | grep -q 1; then
    "$PSQL_BIN" -h "$PGRUN" -p "$DB_PORT" -U postgres -d postgres -v ON_ERROR_STOP=1 \
      -c "ALTER ROLE ${DB_USER} WITH LOGIN PASSWORD '${escaped_password}'"
  else
    "$PSQL_BIN" -h "$PGRUN" -p "$DB_PORT" -U postgres -d postgres -v ON_ERROR_STOP=1 \
      -c "CREATE ROLE ${DB_USER} LOGIN PASSWORD '${escaped_password}'"
  fi

  if ! "$PSQL_BIN" -h "$PGRUN" -p "$DB_PORT" -U postgres -d postgres -tAc \
    "SELECT 1 FROM pg_database WHERE datname = '${DB_NAME}'" | grep -q 1; then
    "$PSQL_BIN" -h "$PGRUN" -p "$DB_PORT" -U postgres -d postgres -v ON_ERROR_STOP=1 \
      -c "CREATE DATABASE ${DB_NAME} OWNER ${DB_USER}"
  fi
}

run_migrations() {
  log "running migrations"
  (cd "$INSTALL_DIR" && ./scripts/4_db_migrate.sh)
}

run_bootstrap() {
  log "bootstrapping initial app data if needed"
  (cd "$INSTALL_DIR" && node scripts/bootstrap.js)
}

run_seed_if_requested() {
  if [ "$RUN_DEMO_SEED" = "yes" ]; then
    log "seeding demo content"
    (cd "$INSTALL_DIR" && ./scripts/5_db_seed.sh)
  fi
}

load_app_service() {
  log "loading LaunchAgent ${APP_PLIST_LABEL}"
  launchctl_remove_if_loaded "$APP_PLIST_LABEL"
  launchctl bootstrap "gui/$(id -u)" "$APP_PLIST_PATH"
  launchctl enable "gui/$(id -u)/${APP_PLIST_LABEL}"
  launchctl kickstart -k "gui/$(id -u)/${APP_PLIST_LABEL}"
}

write_launcher() {
  log "installing launcher helper"
  cat >"$LAUNCHER_PATH" <<EOF
#!/bin/sh
open "http://${APP_HOST}:${APP_PORT}"
EOF
  chmod 755 "$LAUNCHER_PATH"
}

write_update_helper() {
  log "installing update helper"
  cat >"$UPDATE_HELPER_PATH" <<EOF
#!/bin/sh
exec bash "${INSTALL_DIR}/installer/update_macos.sh"
EOF
  chmod 755 "$UPDATE_HELPER_PATH"
}

open_after_install() {
  if [ "$OPEN_AFTER_INSTALL" = "yes" ]; then
    open "http://${APP_HOST}:${APP_PORT}" || true
  fi
}

print_summary() {
  cat <<EOF

[install-macos] complete
[install-macos] app dir: $INSTALL_DIR
[install-macos] state dir: $STATE_DIR
[install-macos] local postgres: 127.0.0.1:$DB_PORT
[install-macos] app url: http://${APP_HOST}:${APP_PORT}
[install-macos] launch agents: ${DB_PLIST_LABEL}, ${APP_PLIST_LABEL}

************************************************************
transact-qda macOS local install: what to do next
************************************************************

Open the app in your browser:
  open "http://${APP_HOST}:${APP_PORT}"
  or:
  ${LAUNCHER_PATH}

Start the database manually, if needed:
  launchctl kickstart -k "gui/\$(id -u)/${DB_PLIST_LABEL}"

Ensure the database starts again after a reboot:
  This installer already registered a LaunchAgent with RunAtLoad+KeepAlive.
  That means after you log into macOS again, the DB and app should restart
  automatically in your user session.

Start the frontend/app service manually, if needed:
  launchctl kickstart -k "gui/\$(id -u)/${APP_PLIST_LABEL}"

Make it feel like an app icon:
  1. Open http://${APP_HOST}:${APP_PORT} in Safari or Chrome
  2. Use "Add to Dock" / "Install as App"
  3. That gives you a normal clickable app-like launcher

How to log in:
  Username: admin
  Password: adminadmin
  You do NOT need a separate user account first.
  Log in once as admin and change the password immediately.

How to update later:
  ${UPDATE_HELPER_PATH}
  or in Terminal:
  bash "${INSTALL_DIR}/installer/update_macos.sh"

Demo content:
  The installer should create:
  - Sample Project
  - Clarke Abstract Maps (Demo)
  If they are missing, run:
    cd "$INSTALL_DIR" && node scripts/bootstrap.js

Branding files, if needed:
  ${PGBRAND}

AI settings and keys:
  Configure them through the app after login.
************************************************************
EOF
}

main() {
  need_macos
  ensure_no_root
  validate_pg_ident "$DB_NAME" "DB_NAME"
  validate_pg_ident "$DB_USER" "DB_USER"
  load_existing_config
  generate_secret
  generate_db_password
  require_cmd git
  require_cmd curl
  require_cmd openssl
  install_packages
  detect_binaries
  create_dirs
  checkout_repo
  write_env_file
  install_node_deps
  build_app
  initialize_local_cluster
  write_db_plist
  write_app_plist
  load_db_service
  wait_for_db
  create_database
  run_migrations
  run_bootstrap
  run_seed_if_requested
  load_app_service
  write_launcher
  write_update_helper
  open_after_install
  print_summary
}

main "$@"
