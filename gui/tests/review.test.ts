// AI 复盘点评纯逻辑测试
import { describe, it, expect } from 'vitest';
import { normalizeScore, lossList, classifyLoss, marksFor, summarize, acplOf } from '../src/uci/review';

describe('normalizeScore 评分归一化', () => {
  it('厘兵分原样返回', () => {
    expect(normalizeScore(150, null)).toBe(150);
    expect(normalizeScore(-80, null)).toBe(-80);
    expect(normalizeScore(null, null)).toBe(0);
  });
  it('杀棋：#N=10000-N，被杀=-(10000-N)', () => {
    expect(normalizeScore(null, 1)).toBe(9999);
    expect(normalizeScore(null, 3)).toBe(9997);
    expect(normalizeScore(null, -2)).toBe(-9998);
  });
  it('杀棋分值序正确（#1 > #3 > 任意厘兵）', () => {
    expect(normalizeScore(null, 1)).toBeGreaterThan(normalizeScore(null, 3));
    expect(normalizeScore(null, 3)).toBeGreaterThan(9000);
    expect(normalizeScore(null, 3)).toBeGreaterThan(normalizeScore(8000, null));
  });
});

describe('lossList 损失计算', () => {
  it('最佳着法损失≈0（走后评分与走前一致）', () => {
    // 走前 120，走后对手视角 -120 → 损失 0
    expect(lossList([120, -120, 60], 2)).toEqual([0, 0]);
  });
  it('走差着法损失为差值', () => {
    // 走前 200，走后对手视角 -50（即己方 -50? 不，-(-50)=50）→ 损失 150
    expect(lossList([200, -50], 1)).toEqual([150]);
  });
  it('负损失截断为 0（走得比预期好）', () => {
    expect(lossList([100, -300], 1)).toEqual([0]);
  });
});

describe('classifyLoss 标记分类', () => {
  it('阈值分档', () => {
    expect(classifyLoss(40, 100)).toBeNull();
    expect(classifyLoss(41, 100)).toBe('?!');
    expect(classifyLoss(100, 100)).toBe('?!');
    expect(classifyLoss(101, 100)).toBe('?');
    expect(classifyLoss(250, 100)).toBe('?');
    expect(classifyLoss(251, 100)).toBe('??');
  });
  it('已必败（被杀进程）不评判', () => {
    expect(classifyLoss(5000, -9500)).toBeNull();
  });
  it('marksFor 对齐输出', () => {
    const scores = [300, -60, 500, -5000];
    const losses = lossList(scores, 3);
    const marks = marksFor(losses, scores);
    expect(marks).toHaveLength(3);
    expect(marks[0]).toBe('?');    // 300-60=240 → '?'
    expect(marks[2]).toBeNull();   // before=-5000 已必败
  });
});

describe('summarize 分方汇总', () => {
  it('红先：偶数手记红、奇数手记黑', () => {
    const losses = [0, 300, 60, 0];
    const marks = marksFor(losses, [0, 0, 0, 0, 0]);
    const s = summarize(losses, marks, 'red');
    expect(s.red.cnt).toBe(2);
    expect(s.black.cnt).toBe(2);
    expect(s.black.q3).toBe(1);
    expect(s.red.q1).toBe(1);          // k=2 损失60 属红方
    expect(s.black.q1).toBe(0);
    expect(acplOf(s.red)).toBe(30);   // (0+60)/2
    expect(acplOf(s.black)).toBe(150); // (300+0)/2
  });
  it('黑先：奇数手记红', () => {
    const losses = [100, 0];
    const s = summarize(losses, [null, null], 'black');
    expect(s.black.cnt).toBe(1);
    expect(s.red.cnt).toBe(1);
  });
});
