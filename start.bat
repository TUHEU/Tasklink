@echo off
title TaskLink
cd /d "%~dp0backend"

rem Find Python: "python" (Miniconda or python.org) first, then the "py" launcher.
set "PY="
python --version >nul 2>nul && set "PY=python"
if not defined PY (
  py -3 --version >nul 2>nul && set "PY=py -3"
)
if not defined PY (
  echo Python 3.10 or newer was not found. Install it from python.org, then run this file again.
  pause
  exit /b 1
)

rem Install Flask only if it is missing.
%PY% -c "import flask" >nul 2>nul || %PY% -m pip install -r "%~dp0requirements.txt"

echo.
echo TaskLink is starting. Open http://127.0.0.1:5000 in your browser.
echo Press Ctrl+C in this window to stop it.
echo.
%PY% app.py
pause
