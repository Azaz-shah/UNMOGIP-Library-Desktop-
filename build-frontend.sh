#!/bin/bash
# Build the React frontend and sync to desktop-app/frontend/
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

echo "✅ Frontend built and synced successfully!"
echo "   Run 'cd desktop-app && npm start' to launch the app."
