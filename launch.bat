@echo off
setlocal enabledelayedexpansion

rem ===========================================================
rem  YumeVRM launcher (Windows)
rem  Works for any user / install location: it cd's into the
rem  folder this script lives in (%~dp0), so no paths are
rem  hardcoded.
rem ===========================================================

rem Move to the directory of this script.
cd /d "%~dp0"

rem Check that Node.js is available.
where node >nul 2>nul
if errorlevel 1 (
    echo [YumeVRM] Node.js was not found on your PATH.
    echo           Please install Node.js 18+ from https://nodejs.org/ and try again.
    pause
    exit /b 1
)

rem Install dependencies on first run.
if not exist "node_modules" (
    echo [YumeVRM] Installing dependencies, this may take a minute...
    call npm install
    if errorlevel 1 (
        echo [YumeVRM] npm install failed.
        pause
        exit /b 1
    )
)

echo [YumeVRM] Starting dev server... open the URL Vite prints (usually http://localhost:5173)
call npm run dev

endlocal
