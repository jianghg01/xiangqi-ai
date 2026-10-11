@echo off
chcp 65001 >nul
rem ============================================================
rem  Xiangqi AI - double-click launcher
rem  自动检测源码更新 -> 重建 dist -> 启动 Electron（含引擎）
rem  引擎需在程序内点「启动引擎」；引擎文件缺失时界面会提示
rem ============================================================
setlocal
cd /d "D:\AI_code\2.GitHub_IDEProjects\xiangqi-ai\gui"

rem ---- 检测: 源码(src/electron/index.html/package.json) 是否有比 dist 更新的文件 ----
set NEED_BUILD=0
for /f %%i in ('node "%~dp0scripts\needs-build.mjs"') do set NEED_BUILD=%%i

if "%NEED_BUILD%"=="1" (
  echo [1/2] 源码有更新，正在重新构建 dist...
  call npx vite build
  if errorlevel 1 (
    echo [ERROR] 构建失败，未启动。请查看上方错误信息。
    pause
    exit /b 1
  )
) else (
  echo [1/2] dist 已是最新，跳过构建。
)

echo [2/2] 清理旧引擎进程并启动...
taskkill /F /IM engine-x64.exe >nul 2>&1
start "" "node_modules\electron\dist\electron.exe" "electron\main.cjs"

echo 已启动。若窗口未出现，请确认本文件位于 D:\AI_code\2.GitHub_IDEProjects\xiangqi-ai
timeout /t 3 >nul
endlocal