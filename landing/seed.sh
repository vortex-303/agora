#!/bin/sh
# Universal installer for @riotp2p/seed — Mac + Linux, no sudo.
# Curl | sh: curl -fsSL https://riotp2p.com/seed.sh | sh
# Pass args:  curl -fsSL https://riotp2p.com/seed.sh | sh -s -- --topics riot:user:XYZ
# Defaults to --seed-all --tui when no args given.

set -e

NODE_VER="22.11.0"
PKG="@riotp2p/seed"

command -v curl >/dev/null 2>&1 || { echo "curl required, please install it first." >&2; exit 1; }
command -v tar  >/dev/null 2>&1 || { echo "tar required, please install it first." >&2; exit 1; }

# Pass-through args; default to --seed-all --tui when called with none.
if [ $# -eq 0 ]; then
  set -- --seed-all --tui
fi

# 1. If a good-enough Node is already on PATH, just use it.
if command -v node >/dev/null 2>&1; then
  V=$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)
  if [ "$V" -ge 20 ]; then
    exec npx -y "$PKG" "$@"
  fi
  echo "→ Detected Node v$(node -v | sed 's/^v//'); need >= 20. Bootstrapping local copy."
fi

# 2. No / old Node — fetch a portable build into ~/.riotp2p/node
UNAME=$(uname -s)
ARCH=$(uname -m)

case "$UNAME" in
  Darwin) OS=darwin ;;
  Linux)  OS=linux ;;
  *) echo "Unsupported OS: $UNAME (use Mac or Linux)." >&2; exit 1 ;;
esac

case "$ARCH" in
  arm64|aarch64) A=arm64 ;;
  x86_64|amd64)  A=x64 ;;
  *) echo "Unsupported arch: $ARCH (need arm64 or x64)." >&2; exit 1 ;;
esac

DIR="$HOME/.riotp2p/node-${NODE_VER}-${OS}-${A}"
if [ ! -x "$DIR/bin/node" ]; then
  mkdir -p "$DIR"
  URL="https://nodejs.org/dist/v${NODE_VER}/node-v${NODE_VER}-${OS}-${A}.tar.xz"
  echo "→ Downloading Node ${NODE_VER} (${OS}-${A}) — one-time, ~25MB."
  curl -fsSL "$URL" | tar -xJ -C "$DIR" --strip-components=1
  echo "→ Installed to ${DIR}"
fi

export PATH="$DIR/bin:$PATH"
exec npx -y "$PKG" "$@"
