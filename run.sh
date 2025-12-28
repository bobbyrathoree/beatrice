#!/bin/bash

# Beatrice - Run Script
# Starts the Tauri development server (frontend + backend)

set -e

echo "Starting Beatrice..."
echo ""

# Check if node_modules exists
if [ ! -d "node_modules" ]; then
    echo "Installing frontend dependencies..."
    npm install
fi

# Check if Rust target exists
if [ ! -d "src-tauri/target" ]; then
    echo "First run - Rust compilation may take a few minutes..."
fi

echo "Launching Tauri dev server..."
echo "  Frontend: Vite (React)"
echo "  Backend:  Tauri (Rust)"
echo ""

npm run tauri dev
