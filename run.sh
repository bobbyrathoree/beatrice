#!/bin/bash

# Beatrice - Run Script
# Starts the development server
#
# Usage:
#   ./run.sh        - Browser mode: Vite dev server only at localhost:1420
#   ./run.sh tauri  - Native app: Launches Tauri app with native window

set -e

MODE="${1:-browser}"

echo "Starting Beatrice..."
echo ""

# Check if node_modules exists
if [ ! -d "node_modules" ]; then
    echo "Installing frontend dependencies..."
    npm install
fi

if [ "$MODE" = "tauri" ]; then
    # Check if Rust target exists
    if [ ! -d "src-tauri/target" ]; then
        echo "First run - Rust compilation may take a few minutes..."
    fi

    echo "Launching Tauri dev server..."
    echo "  Frontend: Vite (React)"
    echo "  Backend:  Tauri (Rust)"
    echo "  Mode:     Native app window"
    echo ""
    echo "TIP: To run in browser-only mode (no native window), use:"
    echo "     ./run.sh"
    echo ""
    npm run tauri dev
else
    echo "=== BROWSER-ONLY MODE ==="
    echo ""
    echo "Starting Vite dev server (frontend only)..."
    echo "  URL: http://localhost:1420"
    echo ""
    echo "NOTE: Tauri backend commands will NOT be available in this mode."
    echo "      This is for frontend development only."
    echo "      Use './run.sh tauri' for full app with native window and backend."
    echo ""
    npm run dev
fi
