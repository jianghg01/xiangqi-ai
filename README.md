# xiangqi-ai · 中国象棋 AI 二次开发

基于最新开源皮卡鱼引擎（Pikafish 2026-09-06）的象棋 AI 项目：自研图形界面 + 引擎搜索/评估魔改两条线并行。

## 结构

- `gui/` — 自研象棋界面（Electron + TypeScript），经 UCI 协议对接引擎
- `engine-src/` — 皮卡鱼官方源码 fork（C++，GPL-3.0）
- `engine/` — 引擎运行时（**不入库**），由脚本获取
- `docs/` — 需求、设计、测试文档（软件开发全流程）
- `scripts/` — 引擎下载等工具脚本

## 获取引擎（M1）

```powershell
powershell -ExecutionPolicy Bypass -File scripts/download-engine.ps1
```

脚本从官方 Release 下载 universal 二进制与 nnue 权重到 `engine/`。

## 验证引擎

```powershell
echo "uci`nisready`nposition startpos`ngo depth 12`nquit" | .\engine\pikafish.exe
```

能看到 `uciok` / `readyok` / `bestmove` 即引擎正常。

## 开发流程

见 `AGENTS.md`（commit 纪律）与 `docs/`（需求/设计/测试）。里程碑：M1 引擎可用 → M2 GUI 骨架 → M3 对弈闭环 → M4 分析功能 → M5 引擎魔改。

## 许可

- 引擎衍生代码遵循 **GPL-3.0**（皮卡鱼为 GPL 项目，魔改必须开源）。
- GUI 代码为本项目自有代码。
