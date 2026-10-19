@echo off
rem Creates the Python venv for the book importer in %LOCALAPPDATA%\origami-app\venv (outside drive D:).
chcp 65001 >nul
setlocal
set "VENV=%LOCALAPPDATA%\origami-app\venv"
if not exist "%VENV%\Scripts\python.exe" (
  py -3 -m venv "%VENV%" || python -m venv "%VENV%" || (echo Python 3 not found & pause & exit /b 1)
)
"%VENV%\Scripts\python.exe" -m pip install --upgrade pip
"%VENV%\Scripts\python.exe" -m pip install --prefer-binary -r "%~dp0requirements.txt"
echo Done. Import a book with:  npm run import:book -- komatsu
pause
