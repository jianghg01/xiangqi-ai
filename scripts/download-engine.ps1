# 下载最新皮卡鱼引擎（universal binary + nnue）到 engine/
# 用法: powershell -ExecutionPolicy Bypass -File scripts/download-engine.ps1 [-Version 2026-09-06]
param(
    [string]$Version = "2026-09-06"
)
$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$dest = Join-Path $root "engine"
New-Item -ItemType Directory -Force -Path $dest | Out-Null

# 官方 release 资产为单个 7z 包（含全部平台二进制 + nnue）
$base = "https://github.com/official-pikafish/Pikafish/releases/download/Pikafish-$Version"
$url = "$base/Pikafish.$Version.7z"
$seven = Join-Path $env:TEMP "Pikafish.$Version.7z"

Write-Host "下载 $url ..."
Invoke-WebRequest -Uri $url -OutFile $seven

Write-Host "解压到 $dest（需 py7zr: pip install py7zr）..."
$py = "python"
& $py -c "import py7zr,sys; py7zr.SevenZipFile(r'$seven').extractall(r'$dest')"

Write-Host "完成。Windows 引擎在 engine/ 下（universal 版自动适配 CPU）。"
Write-Host "验证: echo 'uci' | engine\pikafish.exe"
