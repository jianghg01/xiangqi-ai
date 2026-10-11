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

# 将 Windows 引擎与 nnue 权重重命名为项目实际引用的文件名
# （GUI/自对弈/诊断脚本统一使用 engine-x64.exe 与 eval.nnue）
$winEngine = Get-ChildItem -Path $dest -Recurse -File | Where-Object {
    $_.Name -match 'windows.*universal.*\.exe$' -or $_.Name -match '^pikafish.*\.exe$'
} | Select-Object -First 1
if ($winEngine) {
    Copy-Item -Path $winEngine.FullName -Destination (Join-Path $dest "engine-x64.exe") -Force
    Write-Host "Windows 引擎已就位: engine\engine-x64.exe（源自 $($winEngine.Name)）"
} else {
    Write-Warning "未找到 Windows 引擎可执行文件，请检查解压产物（$dest）"
}

$nnue = Get-ChildItem -Path $dest -Recurse -File -Filter *.nnue | Select-Object -First 1
if ($nnue) {
    Copy-Item -Path $nnue.FullName -Destination (Join-Path $dest "eval.nnue") -Force
    Write-Host "NNUE 权重已就位: engine\eval.nnue（源自 $($nnue.Name)）"
} else {
    Write-Warning "未找到 .nnue 权重文件，请检查解压产物（$dest）"
}

Write-Host "完成。验证: echo 'uci' | engine\engine-x64.exe"