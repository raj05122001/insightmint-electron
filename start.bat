@echo off
echo Starting InsightMint Application...
echo.

REM Check if Node.js is installed
node --version >nul 2>&1
if %errorlevel% neq 0 (
    echo Error: Node.js is not installed or not in PATH
    echo Please install Node.js from https://nodejs.org/
    pause
    exit /b 1
)

REM Check if npm dependencies are installed
if not exist node_modules (
    echo Installing dependencies...
    npm install
    if %errorlevel% neq 0 (
        echo Error: Failed to install dependencies
        pause
        exit /b 1
    )
)

echo Starting API Server and Electron App...
echo.
echo API Server will run on http://localhost:8000
echo Electron App will start in system tray
echo.
echo NOTE: Some permission warnings are normal on Windows
echo Press Ctrl+C to stop both services
echo.

REM Start both API server and Electron app with warnings suppressed
set NODE_NO_WARNINGS=1
npm run dev 2>nul || npm run dev