#!/bin/bash
# Agora Relay — Quick Install
# Runs a relay on port 9800, syncs with the public network
set -e

echo "🏛️  Agora Relay — Quick Install"
echo ""

# Check dependencies
if ! command -v node &> /dev/null; then
  echo "❌ Node.js is required. Install from https://nodejs.org"
  exit 1
fi

if ! command -v git &> /dev/null; then
  echo "❌ Git is required."
  exit 1
fi

# Clone and build
echo "📦 Cloning agora..."
git clone --depth 1 https://github.com/vortex-303/agora.git agora-relay
cd agora-relay

echo "📦 Installing dependencies..."
npm install -g pnpm 2>/dev/null || true
pnpm install

echo "🔨 Building..."
pnpm --filter @agora/core build
pnpm --filter @agora/relay build

# Create data directory
mkdir -p data

echo ""
echo "✅ Agora relay is ready!"
echo ""
echo "Start it with:"
echo "  cd agora-relay"
echo "  PEER_RELAYS=wss://agora-relay.fly.dev,wss://agora-relay-eu.fly.dev node packages/relay/dist/index.js"
echo ""
echo "Your relay will be available at ws://localhost:9800"
echo "Add it to your Agora client in Settings → Relays"
echo ""
