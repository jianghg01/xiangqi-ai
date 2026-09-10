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

## 功能总览（M6 · 2026-09）

- **对弈**：人机（执红/黑、8 档强度带参考 ELO、每步时限、让子 6 档、避和求胜、赛制计时包干/加秒超时判负）、机机（双引擎、自动循环赛 2~200 局比分统计）
- **AI 复盘点评**：逐手深度 12 评分，标记 缓着?!/失误?/大败??，双方 ACPL 汇总；点评结果随棋谱 JSON 保存，载入复盘直接显示
- **实时分析**：MultiPV 3 多线参考、胜率曲线、棋盘前三推荐线箭头
- **训练**：残局闯关 52 关（古谱两步/三步杀，预算步数、提示、进度记忆）、打谱训练（遮谱猜下一手、一次答对率）
- **棋谱**：JSON 保存/导出 PGN/局面图 PNG、棋谱库（games 目录列表/载入/删除）、复盘播放与点击跳转、名局欣赏（古谱《自出洞来无敌手》35 局）、16 序列开局库（可开关）
- **战绩**：按强度档分档胜率统计、表现分法棋力估算（各档 ≥3 局）
- **界面**：拖拽或点击走子、三套棋盘皮肤（持久化）、天天象棋风格音效（默认关）、开局名称显示、用时/剩余时间显示
- **引擎配置**：线程（自动=核数-2）/哈希 128~1024MB、点评与避和自动切换 MultiPV

测试：`npm test`（Vitest，90 项）。类型检查：`npx tsc --noEmit`。

## 许可

- 引擎衍生代码遵循 **GPL-3.0**（皮卡鱼为 GPL 项目，魔改必须开源）。
- GUI 代码为本项目自有代码。
