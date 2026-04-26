#!/bin/bash
set -euo pipefail

APP_USER="${APP_USER:-transact-qda}"
INSTALL_DIR="${INSTALL_DIR:-/opt/transact-qda}"
BRANCH="${BRANCH:-main}"

log() {
  echo "[update-local] $*"
}

fail() {
  echo "[update-local] ERROR: $*" >&2
  exit 1
}

need_root() {
  if [ "${EUID:-$(id -u)}" -ne 0 ]; then
    fail "run this updater as root (for example: sudo transact-qda-update)"
  fi
}

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || fail "required command missing: $1"
}

main() {
  need_root
  require_cmd git
  require_cmd runuser
  [ -d "$INSTALL_DIR/.git" ] || fail "no transact-qda checkout found at $INSTALL_DIR"

  log "updating checkout in $INSTALL_DIR"
  runuser -u "$APP_USER" -- git -C "$INSTALL_DIR" fetch --all --tags
  runuser -u "$APP_USER" -- git -C "$INSTALL_DIR" checkout "$BRANCH"
  runuser -u "$APP_USER" -- git -C "$INSTALL_DIR" pull --ff-only origin "$BRANCH"

  log "running latest installer/update flow"
  exec bash "$INSTALL_DIR/installer/install.sh"
}

main "$@"
