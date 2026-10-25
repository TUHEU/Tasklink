#!/usr/bin/env bash
# Starts TaskLink on http://127.0.0.1:5000 (Linux / macOS)
set -e
cd "$(dirname "$0")"
python3 -c "import flask" 2>/dev/null || python3 -m pip install -r requirements.txt \
  || python3 -m pip install --break-system-packages -r requirements.txt
cd backend
echo "TaskLink is starting. Open http://127.0.0.1:5000 (Ctrl+C to stop)"
python3 app.py
