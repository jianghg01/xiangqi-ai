@echo off
rem ============================================================
rem  Xiangqi AI - double-click launcher
rem  Starts Electron GUI (loads gui/dist) + Pikafish engine
rem  Make sure engine\Pikafish-*.exe exists on first run
rem ============================================================
setlocal
rem cd into gui; main entry is electron/main.cjs, it reads gui/dist
cd /d "D:\1.DouBaoDownload\3.WB\xiangqi-ai\gui"

rem Kill any stale engine process to avoid port/resource conflicts
taskkill /F /IM Pikafish-Windows-x86-64-universal.exe >nul 2>&1

echo Launching Xiangqi AI... (engine loads via the in-app "Start Engine" button)
rem Launch electron.exe directly (bypass npm, avoid shell env injection)
start "" "node_modules\electron\dist\electron.exe" "electron\main.cjs"

echo Launched. If no window appears, confirm this file sits at D:\1.DouBaoDownload\3.WB\xiangqi-ai
timeout /t 3 >nul
endlocal
