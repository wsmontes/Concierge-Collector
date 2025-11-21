@echo off
REM ############################################################################
REM File: run_local.bat
REM Purpose: Start the Concierge API V3 backend locally for development (Windows)
REM Usage: run_local.bat
REM ############################################################################

echo ╔════════════════════════════════════════════════╗
echo ║  Concierge Collector API V3 - Local Server    ║
echo ╚════════════════════════════════════════════════╝
echo.

REM Check if .env exists
if not exist ".env" (
    echo ❌ Error: .env file not found
    echo 💡 Creating .env from .env.example...
    copy .env.example .env
    echo ⚠️  Please edit .env with your configuration and run again
    pause
    exit /b 1
)

REM Check if Python 3 is installed
python --version >nul 2>&1
if errorlevel 1 (
    echo ❌ Error: Python is not installed
    pause
    exit /b 1
)

REM Check if virtual environment exists
if not exist "venv" (
    echo 📦 Creating virtual environment...
    python -m venv venv
)

REM Activate virtual environment
echo 🔧 Activating virtual environment...
call venv\Scripts\activate.bat

REM Install/update dependencies
echo 📦 Installing dependencies...
pip install -q --upgrade pip
pip install -q -r requirements.txt

REM Start the server
echo.
echo 🚀 Starting API server...
echo ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
echo    API: http://localhost:8000/api/v3
echo    Docs: http://localhost:8000/api/v3/docs
echo    Health: http://localhost:8000/api/v3/health
echo ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
echo Press Ctrl+C to stop
echo.

uvicorn main:app --host 0.0.0.0 --port 8000 --reload
