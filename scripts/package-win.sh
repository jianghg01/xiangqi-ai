#!/usr/bin/env bash
# 打包 Windows 便携版（完全离线：复用本地 node_modules/electron/dist，不联网下载）
# 产物: release/xiangqi-ai/  （含 xiangqi-ai.exe 主程序 + app/ 页面 + engine/ 皮卡鱼）
# 用法: 在 gui 目录执行  bash scripts/package-win.sh  （或从仓库根: bash gui/.. 略）
set -e
cd "$(dirname "$0")/../gui"

APP=xiangqi-ai
OUT=../release
DEST="$OUT/$APP"

echo "[1/6] vite build（tsc 校验 + 产出 dist/）"
npx tsc --noEmit
npx vite build

echo "[2/6] 清理并创建目录"
if ! rm -rf "$DEST" 2>/dev/null; then
  # 沙箱/权限导致删除失败时，移走旧目录兜底（文件被占用等情况）
  mv "$DEST" "$(dirname "$DEST")/.trash-$(date +%s%N)" 2>/dev/null || true
fi
mkdir -p "$DEST/resources/app"

echo "[3/6] 复制 Electron 运行时"
cp -r node_modules/electron/dist/. "$DEST/"
mv "$DEST/electron.exe" "$DEST/$APP.exe"

# 瘦身：只保留中英文语言包
if [ -d "$DEST/locales" ]; then
  find "$DEST/locales" -name "*.pak" ! -name "zh-CN.pak" ! -name "zh-TW.pak" ! -name "en-US.pak" ! -name "en-GB.pak" -delete
fi

echo "[4/6] 复制应用（package.json + electron/ + dist/）"
cat > "$DEST/resources/app/package.json" <<EOF2
{
  "name": "$APP",
  "version": "$(node -p "require('./package.json').version")",
  "main": "electron/main.cjs"
}
EOF2
cp -r electron "$DEST/resources/app/"
cp -r dist "$DEST/resources/app/"

echo "[5/6] 复制引擎（皮卡鱼 + NNUE）"
mkdir -p "$DEST/resources/app/engine"
cp ../engine/Pikafish-Windows-x86-64-universal.exe "$DEST/resources/app/engine/"
cp ../engine/pikafish.nnue "$DEST/resources/app/engine/"

cat > "$DEST/使用说明.txt" <<'EOF2'
象棋 AI 便携版
================
1. 双击 xiangqi-ai.exe 启动
2. 主界面点「启动引擎」（已自动探测内置皮卡鱼）
3. 「进入对弈」开始下棋；「开启分析」看实时胜率
4. 「保存棋谱 / 导出 PGN / 打开棋谱复盘」在右侧面板
5. 本目录可整体复制到任意位置，无需安装
EOF2

echo "[6/6] 完成"
du -sh "$DEST" 2>/dev/null || true
echo "产物: $(cd "$DEST" && pwd)"
