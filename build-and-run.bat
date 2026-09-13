@echo off
rem Xiangqi AI - build dist then launch Electron
rem One click: rebuild + open. Safe to run repeatedly.
chcp 65001 >nul
setlocal
cd /d "D:\1.DouBaoDownload\3.WB\xiangqi-ai\gui"

echo [1/3] Building dist via vite...
npx vite build
if errorlevel 1 (
  echo [ERROR] Build failed. Not launching.
  pause
  exit /b 1
)

echo [2/3] Build OK. Killing stale engine process...
taskkill /F /IM engine-x64.exe >nul 2>&1

echo [3/3] Launching Electron...
start "" "node_modules\electron\dist\electron.exe" "electron\main.cjs"

echo Launched. If the window did not appear, confirm the project is at D:\1.DouBaoDownload\3.WB\xiangqi-ai
timeout /t 3 >nul
endlocal
