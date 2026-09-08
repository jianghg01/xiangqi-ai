# 02 · 技术设计

## 1. 总体架构

```
┌─────────────────────────────┐         UCI（stdin/stdout 管道）
│  gui/  Electron + TypeScript │ ◄──────────────────────────► engine/pikafish.exe
│  ├─ 棋盘渲染层（Canvas/SVG）  │   position / go / stop       └─ pikafish.nnue
│  ├─ 规则引擎（纯 TS 模块）    │   ◄── info / bestmove ──
│  ├─ UCI 客户端（子进程管理）  │
│  └─ 界面层（分析面板/对局控制）│
└─────────────────────────────┘
```

## 2. 模块划分（GUI 线）

| 模块 | 职责 | 关键类/文件 |
|------|------|------------|
| board | 棋盘状态、FEN 解析、走子生成与校验 | `gui/src/board/` |
| rules | 中国象棋规则（马腿/塞象眼/照面/将军/绝杀） | `gui/src/rules/` |
| uci | 引擎子进程生命周期、命令封装、info 解析 | `gui/src/uci/` |
| ui | 界面组件、动画、分析面板 | `gui/src/ui/` |

设计原则：board/rules/uci 为**纯逻辑模块**（不依赖 Electron），便于单元测试；ui 层只做展示。

## 3. UCI 通信设计
- 引擎以子进程启动，GUI 写 stdin、读 stdout，按行解析
- 命令序列：`uci` → 等 `uciok` → `setoption`（Hash/MultiPV）→ `isready` → 等 `readyok` → `position fen ... moves ...` → `go depth N / movetime T`
- info 行解析：`depth`、`multipv`、`score cp/mate`、`pv`（着法 ICCS 格式，如 h2e2）
- 退出：`stop` → `quit`，子进程异常退出自动重启（上限 3 次）

## 4. 引擎线设计
- fork 官方仓库为 git submodule 引入 `engine-src/`
- 构建链：MSYS2 MinGW-w64（`make build ARCH=x86-64-vnni512` 等，沿用官方 Makefile）
- 实验管理：每个实验一个分支，bench 基线（官方数值）+ 固定深度自对弈 20 局对比，回退判据明确
- 提交策略：自研改动在自己 fork 上提交；上游更新 `git pull upstream master` rebase

## 5. 关键决策记录
- D1 选 Electron 而非纯 Web：需要无沙箱限制地拉起引擎子进程
- D2 引擎二进制不入库：nnue >100MB 超 GitHub 单文件限制，用脚本重取保证可复现
- D3 规则引擎自研而非引擎托管：人机对弈需要本地即时合法性校验，不能每步都问引擎
