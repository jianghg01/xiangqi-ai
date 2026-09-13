@echo off
rem ============================================================
rem  Xiangqi AI - double-click launcher
rem  Starts Electron GUI (loads gui/dist) + chess engine
rem  Make sure engine\engine-x64.exe exists on first run
rem ============================================================
setlocal
rem cd into gui; main entry is electron/main.cjs, it reads gui/dist
cd /d "D:\1.DouBaoDownload\3.WB\xiangqi-ai\gui"

rem Kill any stale engine process to avoid port/resource conflicts
taskkill /F /IM engine-x64.exe >nul 2>&1

echo Launching Xiangqi AI... (engine loads via the in-app "Start Engine" button)
rem Launch electron.exe directly (bypass npm, avoid shell env injection)
start "" "node_modules\electron\dist\electron.exe" "electron\main.cjs"

echo Launched. If no window appears, confirm this file sits at D:\1.DouBaoDownload\3.WB\xiangqi-ai
timeout /t 3 >nul
endlocal
