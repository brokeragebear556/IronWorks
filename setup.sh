#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# Ironworks setup for Linux (and macOS).
# Installs everything the app needs: the Python packages (in .venv) and the
# web app's npm packages, then builds the web app. Safe to run again.
# Needs Python 3.10+ and Node.js 20+. If either is missing it shows the
# install command for your system and can run it for you (asks first).
#   bash setup.sh          interactive
#   bash setup.sh --yes    install missing system packages without asking
# ---------------------------------------------------------------------------
set -euo pipefail
cd "$(dirname "$0")"
YES=0
[ "${1:-}" = "--yes" ] && YES=1

say() { printf '%s\n' "$*"; }
ask() {  # ask "question"  -> 0 for yes
  [ "$YES" = 1 ] && return 0
  [ -t 0 ] || return 1
  read -r -p "$1 [y/N] " a
  [[ "$a" =~ ^[Yy] ]]
}

# The system package manager, for installing Python or Node.js when missing
PM=""
for p in apt-get dnf pacman zypper brew; do command -v "$p" >/dev/null 2>&1 && { PM="$p"; break; }; done
pkg_cmd() {  # pkg_cmd python|node -> the install command for this system
  case "$PM:$1" in
    apt-get:python) echo "sudo apt-get install -y python3 python3-venv python3-pip" ;;
    apt-get:node)   echo "sudo apt-get install -y nodejs npm" ;;
    dnf:python)     echo "sudo dnf install -y python3 python3-pip" ;;
    dnf:node)       echo "sudo dnf install -y nodejs npm" ;;
    pacman:python)  echo "sudo pacman -S --needed --noconfirm python python-pip" ;;
    pacman:node)    echo "sudo pacman -S --needed --noconfirm nodejs npm" ;;
    zypper:python)  echo "sudo zypper install -y python3 python3-pip" ;;
    zypper:node)    echo "sudo zypper install -y nodejs npm" ;;
    brew:python)    echo "brew install python" ;;
    brew:node)      echo "brew install node" ;;
    *) echo "" ;;
  esac
}
offer_install() {  # offer_install python|node "name"
  local cmd; cmd="$(pkg_cmd "$1")"
  if [ -z "$cmd" ]; then say "Install $2 with your system's package manager, then run setup.sh again."; exit 1; fi
  say "Install command: $cmd"
  if ask "Run it now?"; then
    [ "$PM" = apt-get ] && sudo apt-get update
    eval "$cmd"
  else
    say "Skipped. Run the command above, then run setup.sh again."; exit 1
  fi
}

say ""
say "=== Ironworks setup ==="
say ""

# ---- Python 3.10 or newer ----
find_python() {
  for c in python3 python; do
    if command -v "$c" >/dev/null 2>&1 && "$c" -c 'import sys; sys.exit(0 if sys.version_info >= (3, 10) else 1)' 2>/dev/null; then echo "$c"; return; fi
  done
}
PY="$(find_python)"
if [ -z "$PY" ]; then
  say "Python 3.10 or newer was not found."
  offer_install python "Python 3.10 or newer"
  PY="$(find_python)"
  [ -n "$PY" ] || { say "Python is still too old or missing. Install Python 3.10 or newer, then run setup.sh again."; exit 1; }
fi
say "Python  $("$PY" -c 'import platform; print(platform.python_version())')  ($PY)"

# ---- Node.js 20 or newer, with npm ----
node_major() { node -p "process.versions.node.split('.')[0]" 2>/dev/null || echo 0; }
if ! command -v node >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1 || [ "$(node_major)" -lt 20 ]; then
  say "Node.js 20 or newer (with npm) was not found."
  offer_install node "Node.js 20 or newer"
  if ! command -v npm >/dev/null 2>&1 || [ "$(node_major)" -lt 20 ]; then
    say "Your system's Node.js is older than 20 ($(node -v 2>/dev/null || echo none))."
    say "Install a newer one from https://nodejs.org, or with nvm:  nvm install --lts"
    exit 1
  fi
fi
say "Node.js $(node -v)"

# ---- Python packages ----
# A .venv copied from Windows only has Windows programs; use a separate one then.
VENV=".venv"
if [ -d .venv ] && [ ! -x .venv/bin/python ]; then VENV=".venv-linux"; fi
if [ ! -x "$VENV/bin/python" ]; then
  say ""
  say "Creating the Python environment in $VENV ..."
  if ! "$PY" -m venv "$VENV"; then
    say "Couldn't create it. The venv module is missing."
    [ "$PM" = apt-get ] && say "Install it with:  sudo apt-get install -y python3-venv"
    exit 1
  fi
fi
say ""
say "Installing Python packages ..."
"$VENV/bin/python" -m pip install --quiet --upgrade pip
"$VENV/bin/python" -m pip install --quiet -r requirements.txt

# ---- npm packages and the web build ----
say ""
say "Installing npm packages (npm ci) ..."
cd web
# node_modules copied from Windows has Windows-only build tools; npm ci starts clean
if ! npm ci --no-fund --no-audit; then
  say "npm ci failed; trying npm install instead ..."
  rm -rf node_modules
  npm install --no-fund --no-audit
fi
say ""
say "Building the web app ..."
npm run build
cd ..

say ""
say "=== Setup finished ==="
say "Start the app with:  bash start-ironworks.sh   (then open http://127.0.0.1:8080)"
