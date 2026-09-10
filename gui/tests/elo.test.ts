// ELO 扰动逻辑测试
import { describe, it, expect } from 'vitest';
import { blunderProfile, pickBlunder, estimateElo } from '../src/uci/elo';

describe('blunderProfile 强度分档', () => {
  it('满级及以上不扰动', () => {
    expect(blunderProfile(18)).toBeNull();
    expect(blunderProfile(24)).toBeNull();
  });
  it('档位越低概率与容差越大', () => {
    const p12 = blunderProfile(12)!;
    const p8 = blunderProfile(8)!;
    const p5 = blunderProfile(5)!;
    const p1 = blunderProfile(1)!;
    expect(p12.p).toBeLessThan(p8.p);
    expect(p8.p).toBeLessThan(p5.p);
    expect(p5.p).toBeLessThan(p1.p);
    expect(p1.margin).toBeGreaterThan(p12.margin);
  });
});

describe('pickBlunder 次优选择', () => {
  const cands = [
    { key: 'a1', cp: 100 },
    { key: 'b2', cp: 60 },
    { key: 'c3', cp: 20 },
    { key: 'd4', cp: -150 },
  ];
  it('bestCp 未知返回 null', () => {
    expect(pickBlunder(cands, null, 100, 0)).toBeNull();
  });
  it('margin 内候选随机均匀选取', () => {
    // margin 100：a1(100) b2(60) c3(20) 可选，d4 排除
    expect(pickBlunder(cands, 100, 100, 0)?.key).toBe('a1');
    expect(pickBlunder(cands, 100, 100, 0.5)?.key).toBe('b2');
    expect(pickBlunder(cands, 100, 100, 0.99)?.key).toBe('c3');
  });
  it('仅最佳可用时返回 null', () => {
    expect(pickBlunder(cands, 100, 0, 0.5)).toBeNull();
  });
  it('rand 越界保护', () => {
    expect(pickBlunder(cands, 100, 100, 5)?.key).toBe('c3');
    expect(pickBlunder(cands, 100, 100, -1)?.key).toBe('a1');
  });
});

describe('estimateElo 棋力估算', () => {
  it('样本不足（<3局）不参与估算', () => {
    expect(estimateElo([{ elo: 1800, win: 2, loss: 0, games: 2 }])).toBeNull();
  });
  it('全胜表现分高于档位，全负低于档位', () => {
    const win = estimateElo([{ elo: 1800, win: 4, loss: 0, games: 4 }])!;
    const loss = estimateElo([{ elo: 1800, win: 0, loss: 4, games: 4 }])!;
    expect(win).toBe(2200);           // 1800+400
    expect(loss).toBe(1400);          // 1800-400
  });
  it('多档按局数加权', () => {
    const r = estimateElo([
      { elo: 1600, win: 4, loss: 0, games: 4 },  // 2000 ×4
      { elo: 2100, win: 0, loss: 4, games: 4 },  // 1700 ×4
    ])!;
    expect(r).toBe(1850);             // (2000*4 + 1700*4)/8
  });
});
