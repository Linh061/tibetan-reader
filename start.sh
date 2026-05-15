#!/bin/bash
# Tibetan Reader - Startup Script
# Starts the Flask backend server

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo "============================================"
echo "  Tibetan Reader - 藏文阅读器"
echo "============================================"
echo ""

# Check if Python 3 is available
if ! command -v python3 &> /dev/null; then
    echo "Error: Python 3 is required but not found."
    exit 1
fi

# Install dependencies if needed
if [ ! -d "venv" ]; then
    echo "Creating virtual environment..."
    python3 -m venv venv
    source venv/bin/activate
    echo "Installing dependencies..."
    pip install -r requirements.txt
else
    source venv/bin/activate
fi

echo ""
echo "Starting server..."
echo "  Open http://127.0.0.1:5000 in your browser"
echo "  Press Ctrl+C to stop"
echo ""

python3 backend/app.py
