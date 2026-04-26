#!/bin/bash
set -euo pipefail

INSTALL_DIR="${INSTALL_DIR:-$HOME/Applications/transact-qda}"
BRANCH="${BRANCH:-main}"

log() {
  echo "[update-macos] $*"
}

fail() {
  echo "[update-macos] ERROR: $*" >&2
  exit 1
}

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || fail "required command missing: $1"
}

need_macos() {
  [ "$(uname -s)" = "Darwin" ] || fail "this updater is for macOS only"
}

ensure_no_root() {
  [ "${EUID:-$(id -u)}" -ne 0 ] || fail "run this updater as your normal macOS user, not root"
}

main() {
  need_macos
  ensure_no_root
  require_cmd git
  [ -d "$INSTALL_DIR/.git" ] || fail "no transact-qda checkout found at $INSTALL_DIR"

  log "updating checkout in $INSTALL_DIR"
  git -C "$INSTALL_DIR" fetch --all --tags
  git -C "$INSTALL_DIR" checkout "$BRANCH"
  git -C "$INSTALL_DIR" pull --ff-only origin "$BRANCH"

  log "running latest installer/update flow"
  exec bash "$INSTALL_DIR/installer/install_macos.sh"
}

main "$@"
