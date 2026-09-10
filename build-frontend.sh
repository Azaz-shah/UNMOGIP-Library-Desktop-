#!/bin/bash
# Build the React frontend and install prebuilt better-sqlite3
# Run this from the project root: ./build-frontend.sh

set -e

echo "📦 Building React frontend..."
cd Frontend/my-app
npm install --silent
npm run build

echo "📁 Syncing build output to desktop-app/frontend/..."
cd ../..
rm -rf desktop-app/frontend/assets
cp -r Frontend/my-app/dist/* desktop-app/frontend/

echo "🔧 Installing better-sqlite3 prebuilt binary (no Visual Studio needed)..."
cd desktop-app
npm install
node fix-sqlite.js

echo "✅ Frontend built and synced successfully!"
echo "   Run 'cd desktop-app && npm start' to launch the app."
