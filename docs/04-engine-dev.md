# 04 · 引擎魔改工作手册（M5）

## 现状（2026-10-11）

- 上游：official-pikafish/Pikafish（master，2026-09-06 版）
- 自有 fork：jianghg01/Pikafish（GPL-3.0，公开，已推送）
- 本地源码：`engine-src/`（以 **git submodule** 引入主仓库，`.gitmodules` 指向 `https://github.com/jianghg01/Pikafish.git`；submodule 内 remote：`origin`=fork，`upstream`=官方，推送改动用 `git push origin`，拉上游用 `git pull upstream master`）
- 编译链：`tools/w64devkit/`（GCC 16.2 便携版，无 LTO 支持，编译需加 `debug=yes`）
- 桌面 GUI 用的引擎：`engine/`（官方 universal binary，重命名为 `engine-x64.exe`）

## bench 回归基线

| 版本 | bench（nodes） | NPS |
|------|---------------|-----|
| 官方 universal 2026-09-06 | 2,651,062 | ~515,770 |
| 自编译 avx2（debug=yes） | 2,651,062 ✅ 一致 | ~251,954（debug 构建偏慢，属预期） |

**规则：任何引擎改动后 bench nodes 必须与改动前一致（除非有意改变搜索行为）；实验性改动用固定深度自对弈对比。**

## 编译命令

```powershell
$env:Path = "D:\AI_code\2.GitHub_IDEProjects\xiangqi-ai\tools\w64devkit\bin;" + $env:Path
cd D:\AI_code\2.GitHub_IDEProjects\xiangqi-ai\engine-src\src
make build ARCH=x86-64-avx2 debug=yes -j8
```

- NNUE 权重由 `engine/eval.nnue` 复制到 `engine-src/src/`（Makefile 默认会联网下载，GitHub 不通时手动复制）
- 归档指令集：vnni512 > avx512 > avxvnni > bmi2 > avx2 > sse41-popcnt（按 CPU 支持）
- 可执行文件在 `engine-src/src/pikafish.exe`

## 实验流程（每个实验一个分支）

1. `git checkout -b exp/<名称>`（在 engine-src 内）
2. 修改搜索/评估代码
3. 编译 → `bench` nodes 对比基线（应一致或符合预期）
4. 固定深度 12 自对弈 20 局（新 vs 基线），胜率 <40% 即放弃并回滚
5. 保留的实验：`git push origin exp/<名称>` 并合并

自对弈统计命令（结果自动追加到 `docs/selfplay-results.md`）：

```powershell
node scripts/selfplay.js --engine-a engine/engine-x64.exe --engine-b engine-src/src/pikafish.exe --games 20 --depth 12
```

## 实验记录

- **LMR 实验#1（exp/lmr-base-1750，2026-09-09）**：LMR base 1713→1750，自对弈 110 局（depth=10 × 100 局 + 前 10 局低深度）统计无优势（B 50.5%，扣除执子均衡后无可测收益），分支保留在 fork 未合并。详见 `docs/selfplay-results.md`。
