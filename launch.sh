#!/usr/bin/env bash
# ===========================================================
#  YumeVRM launcher (macOS / Linux)
#  Works for any user / install location: it cd's into the
#  folder this script lives in, so no paths are hardcoded.
# ===========================================================
set -e

# Move to the directory of this script.
cd "$(dirname "$0")"

# Check that Node.js is available.
if ! command -v node >/dev/null 2>&1; then
    echo "[YumeVRM] Node.js was not found on your PATH."
    echo "          Please install Node.js 18+ from https://nodejs.org/ and try again."
    exit 1
fi

# Install dependencies on first run.
if [ ! -d "node_modules" ]; then
    echo "[YumeVRM] Installing dependencies, this may take a minute..."
    npm install
fi

echo "[YumeVRM] Starting dev server... open the URL Vite prints (usually http://localhost:5173)"
npm run dev
