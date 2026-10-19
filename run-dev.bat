@echo off
rem Start the Origami app: portable Node on PATH, install if needed, dev server, open the browser.
chcp 65001 >nul
setlocal
cd /d "%~dp0"
set "PATH=%LOCALAPPDATA%\Programs\nodejs;%PATH%"
where node >nul 2>nul || (
  echo Node.js was not found. Install Node 20+ or unpack it to %%LOCALAPPDATA%%\Programs\nodejs
  pause
  exit /b 1
)
if not exist "node_modules\" (
  echo Installing dependencies...
  call npm install || (pause & exit /b 1)
)
call npm run dev -- --open
pause
