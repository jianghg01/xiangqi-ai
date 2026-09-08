# AGENTS.md · xiangqi-ai 项目协作规范

> 本文件对所有参与开发的 AI 代理与人类开发者生效。

## 硬性纪律

1. **每次改动完成后，必须创建对应的 Git commit**，以便后续追踪和回滚。
   - Commit message 格式：`<type>: <一句话说明>`，type 取 feat / fix / docs / test / chore。
2. **每次改动后，必须编写或更新相关测试**，并在交付前确保所有测试与验证全部通过。
3. `main` 分支只接受可运行节点（里程碑）：merge 前必须在 `dev` 上验证通过。
4. 每个里程碑在 main 上打 tag（v0.1.0 …），并 `git push origin main --tags`。
5. 引擎二进制与 nnue 权重**不入库**（`.gitignore` 已排除），统一用 `scripts/download-engine.ps1` 获取。

## 项目约定

- 语言：GUI 为 TypeScript（Electron），引擎为 C++（皮卡鱼 fork，GPL-3.0，衍生代码公开）。
- 引擎对接一律走 UCI 标准协议，不直连引擎内部接口。
- 中文注释与文档；代码标识符用英文。
- 里程碑验收标准见 `docs/01-requirements.md`，测试要求见 `docs/03-testing.md`。

## 回滚与上传

- 随时回滚：`git log --oneline` 找节点 → `git revert <hash>`（安全）或 `git checkout <tag>`（查看）。
- 随时上传：里程碑节点 `git push origin main --tags`；日常在 feature 分支推送。
