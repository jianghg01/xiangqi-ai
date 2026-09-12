@echo off
rem ============================================================
rem  象棋 AI · 双击启动
rem  启动 Electron GUI（加载 dist 构建）+ Pikafish 引擎
rem  首次运行前若引擎未就绪，请确认 engine\Pikafish-*.exe 存在
rem ============================================================
chcp 65001 >nul
setlocal
rem 进入 gui 目录，主进程入口为 electron/main.cjs，读取 gui/dist
cd /d "D:\1.DouBaoDownload\3.WB\xiangqi-ai\gui"

rem 清理可能残留的引擎进程（避免端口/占用冲突）
taskkill /F /IM Pikafish-Windows-x86-64-universal.exe >nul 2>&1

echo 正在启动象棋 AI…（引擎将在应用内通过「启动引擎」按钮加载）
rem 直接调 electron.exe 拉起主进程（绕过 npm，免去 shell 环境变量注入）
start "" "node_modules\electron\dist\electron.exe" "electron\main.cjs"

echo 已启动。若窗口未弹出，请检查本文件所在目录是否为 D:\1.DouBaoDownload\3.WB\xiangqi-ai
timeout /t 3 >nul
endlocal
