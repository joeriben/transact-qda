#!/bin/bash
set -euo pipefail

APP_NAME="transact-qda"
APP_USER="${APP_USER:-transact-qda}"
INSTALL_DIR="${INSTALL_DIR:-/opt/transact-qda}"
DB_NAME="${DB_NAME:-transact_qda}"
DB_USER="${DB_USER:-tqda}"
DB_PASSWORD="${DB_PASSWORD:-}"
DB_HOST="${DB_HOST:-127.0.0.1}"
DB_PORT="${DB_PORT:-5432}"
APP_PORT="${APP_PORT:-5174}"
APP_HOST="${APP_HOST:-127.0.0.1}"
REPO_URL="${REPO_URL:-https://github.com/joeriben/transact-qda.git}"
BRANCH="${BRANCH:-main}"
SESSION_SECRET="${SESSION_SECRET:-}"
RUN_DEMO_SEED="${RUN_DEMO_SEED:-no}"

log() {
  echo "[install] $*"
}

fail() {
  echo "[install] ERROR: $*" >&2
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

install_packages() {
  local pkg_mgr
  pkg_mgr="$(detect_pkg_manager)"

  log "installing system packages via $pkg_mgr"
  if [ "$pkg_mgr" = "apt" ]; then
    apt-get update
    apt-get install -y git curl ca-certificates postgresql postgresql-contrib nodejs npm
  else
    dnf install -y git curl ca-certificates postgresql-server postgresql-contrib nodejs npm
    if [ ! -d /var/lib/pgsql/data/base ]; then
      postgresql-setup --initdb
    fi
  fi
}

ensure_postgres_running() {
  log "enabling and starting PostgreSQL"
  systemctl enable --now postgresql || systemctl enable --now postgresql.service
}

ensure_app_user() {
  if id "$APP_USER" >/dev/null 2>&1; then
    log "using existing app user $APP_USER"
  else
    log "creating app user $APP_USER"
    useradd --system --create-home --home-dir /var/lib/"$APP_NAME" --shell /usr/sbin/nologin "$APP_USER"
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

ensure_runtime_dirs() {
  log "creating runtime directories"
  install -d -o "$APP_USER" -g "$APP_USER" "$INSTALL_DIR/uploads"
  install -d -o "$APP_USER" -g "$APP_USER" "$INSTALL_DIR/static/brand"
}

create_database() {
  log "creating PostgreSQL role and database if needed"
  runuser -u postgres -- psql -p "$DB_PORT" -tAc "SELECT 1 FROM pg_roles WHERE rolname='${DB_USER}'" | grep -q 1 || \
    runuser -u postgres -- psql -p "$DB_PORT" -c "CREATE USER ${DB_USER} WITH PASSWORD '${DB_PASSWORD}';"

  runuser -u postgres -- psql -p "$DB_PORT" -tAc "SELECT 1 FROM pg_database WHERE datname='${DB_NAME}'" | grep -q 1 || \
    runuser -u postgres -- psql -p "$DB_PORT" -c "CREATE DATABASE ${DB_NAME} OWNER ${DB_USER};"
}

write_env_file() {
  local env_file="$INSTALL_DIR/.env"
  log "writing $env_file"
  cat >"$env_file" <<EOF
DATABASE_URL=postgresql://${DB_USER}:${DB_PASSWORD}@${DB_HOST}:${DB_PORT}/${DB_NAME}
SESSION_SECRET=${SESSION_SECRET}
HOST=${APP_HOST}
PORT=${APP_PORT}

# Instance branding (optional; empty = public/neutral defaults).
# See static/brand/README.md for where to put the logo and impressum files.
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

run_migrations() {
  log "running migrations"
  as_app_user "./scripts/4_db_migrate.sh"
}

run_seed_if_requested() {
  if [ "$RUN_DEMO_SEED" = "yes" ]; then
    log "seeding demo content"
    as_app_user "./scripts/5_db_seed.sh"
  fi
}

write_systemd_unit() {
  log "installing systemd unit"
  sed \
    -e "s|__APP_USER__|$APP_USER|g" \
    -e "s|__INSTALL_DIR__|$INSTALL_DIR|g" \
    "$INSTALL_DIR/installer/transact-qda.service" > /etc/systemd/system/transact-qda.service
}

enable_service() {
  log "enabling and starting transact-qda service"
  systemctl daemon-reload
  systemctl enable --now transact-qda.service
}

print_summary() {
  cat <<EOF

[install] complete
[install] app dir: $INSTALL_DIR
[install] app user: $APP_USER
[install] database: $DB_NAME
[install] db user: $DB_USER
[install] listen: http://${APP_HOST}:${APP_PORT}
[install] systemd unit: transact-qda.service

Next steps:
  1. Visit http://${APP_HOST}:${APP_PORT}
  2. Log in with admin / adminadmin
  3. Change the admin password immediately
  4. Add branding files under $INSTALL_DIR/static/brand if needed
  5. Configure AI keys in $INSTALL_DIR/*.key or via the app
EOF
}

main() {
  need_root
  require_cmd openssl
  require_cmd systemctl
  install_packages
  require_cmd git
  require_cmd node
  require_cmd npm
  require_cmd psql
  require_cmd runuser
  ensure_postgres_running
  ensure_app_user
  generate_secret
  generate_db_password
  create_install_dir
  checkout_repo
  ensure_runtime_dirs
  create_database
  write_env_file
  install_node_deps
  run_migrations
  run_seed_if_requested
  build_app
  write_systemd_unit
  enable_service
  print_summary
}

main "$@"
