import { describe, expect, it } from 'vitest';
import {
  LLM_SYSTEM_PROMPT,
  buildMessages,
  buildUserPrompt,
  tagForLoss,
  type ReviewContextInput,
  type StepEval,
} from '../src/uci/llm-review';

describe('tagForLoss 评分差值标记', () => {
  it('正向损失映射到 平稳/疑问手/败招/漏招', () => {
    expect(tagForLoss(0)).toBe('平稳');
    expect(tagForLoss(30)).toBe('平稳');
    expect(tagForLoss(60)).toBe('疑问手');
    expect(tagForLoss(150)).toBe('败招');
    expect(tagForLoss(300)).toBe('漏招');
  });
  it('负向损失（得分提升）映射到 佳着/妙手', () => {
    expect(tagForLoss(-45)).toBe('佳着');
    expect(tagForLoss(-150)).toBe('佳着');
    expect(tagForLoss(-249)).toBe('佳着');
    expect(tagForLoss(-300)).toBe('妙手');
  });
  it('阈值边界', () => {
    expect(tagForLoss(40)).toBe('平稳');
    expect(tagForLoss(41)).toBe('疑问手');
    expect(tagForLoss(100)).toBe('疑问手');
    expect(tagForLoss(101)).toBe('败招');
    expect(tagForLoss(250)).toBe('败招');
    expect(tagForLoss(251)).toBe('漏招');
    expect(tagForLoss(-40)).toBe('平稳');
    expect(tagForLoss(-41)).toBe('佳着');
    expect(tagForLoss(-250)).toBe('佳着');
    expect(tagForLoss(-251)).toBe('妙手');
  });
});

describe('消息组装', () => {
  const step = (over: Partial<StepEval> = {}): StepEval => ({
    ply: 1, side: 'red', moveZh: '炮二平五', fenAfter: 'fen1',
    scoreCp: 50, pv: 'h2e2 h9g7', depth: 18, loss: 0, tag: '平稳', ...over,
  });
  const base: ReviewContextInput = {
    pgn: '1. 炮二平五', startFen: 'start', redName: '玩家', blackName: '引擎',
    result: '红胜', steps: [step()], fullFens: ['start', 'fen1'], style: 'brief',
  };

  it('内置系统提示词包含核心要求', () => {
    expect(LLM_SYSTEM_PROMPT).toContain('专业中国象棋复盘解说');
    expect(LLM_SYSTEM_PROMPT).toContain('全局局势总结');
    expect(LLM_SYSTEM_PROMPT).toContain('不要编造不存在的招法');
  });

  it('user 消息包含 PGN / 评估表 / FEN 序列 / 风格指令', () => {
    const [sys, user] = buildMessages(base);
    expect(sys.role).toBe('system');
    expect(user.content).toContain('炮二平五');
    expect(user.content).toContain('【完整对局 PGN】');
    expect(user.content).toContain('【每一步引擎评估】');
    expect(user.content).toContain('【FEN 序列】');
    expect(user.content).toContain('startFen: start');
    expect(user.content).toContain('风格：简短点评');
  });

  it('deep 风格切换指令', () => {
    const [_, user] = buildMessages({ ...base, style: 'deep' });
    expect(user.content).toContain('风格：深度复盘');
    expect(user.content).not.toContain('风格：简短点评');
  });

  it('无评估数据时给出占位提示', () => {
    const content = buildUserPrompt({ ...base, steps: [] });
    expect(content).toContain('（无评估数据）');
  });
});