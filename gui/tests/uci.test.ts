import { describe, expect, it } from 'vitest';
import { UciClient, parseInfo, toRedPersp, cpToWinrate, formatScore } from '../src/uci/engine-client';

describe('info 行解析', () => {
  it('标准 multipv 输出', () => {
    const info = parseInfo('info depth 12 multipv 2 score cp -34 nodes 1234 pv h2e2 b2c2 h0g2');
    expect(info).toEqual({ depth: 12, multipv: 2, scoreCp: -34, scoreMate: null, pv: ['h2e2', 'b2c2', 'h0g2'] });
  });

  it('mate 分数', () => {
    const info = parseInfo('info depth 9 multipv 1 score mate 3 pv e4e5');
    expect(info?.scoreMate).toBe(3);
    expect(info?.scoreCp).toBeNull();
  });

  it('无 pv/depth 的行忽略', () => {
    expect(parseInfo('info string NNUE evaluation using pikafish.nnue')).toBeNull();
  });
});

describe('UciClient 指令', () => {
  it('go depth 与 position 组装', () => {
    const sent: string[] = [];
    const c = new UciClient(s => sent.push(s));
    c.position('rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1', ['h2e2']);
    c.go({ depth: 12 });
    expect(sent[0]).toContain('position fen rnbakabnr');
    expect(sent[0].endsWith('moves h2e2')).toBe(true);
    expect(sent[1]).toBe('go depth 12');
  });

  it('bestmove 回调', () => {
    let got = '';
    const c = new UciClient(() => {});
    c.onBestmove = bm => { got = bm; };
    c.handleLine('bestmove h2e2 ponder e9h9');
    expect(got).toBe('h2e2');
  });
});

describe('分数工具', () => {
  it('红方视角转换', () => {
    expect(toRedPersp(100, 'red')).toBe(100);
    expect(toRedPersp(100, 'black')).toBe(-100);
  });
  it('胜率换算', () => {
    expect(cpToWinrate(0)).toBeCloseTo(50, 1);
    expect(cpToWinrate(1000)).toBeGreaterThan(95);
    expect(cpToWinrate(-1000)).toBeLessThan(5);
  });
  it('分数显示', () => {
    expect(formatScore(234, null)).toBe('+2.34');
    expect(formatScore(-56, null)).toBe('-0.56');
    expect(formatScore(null, 3)).toBe('#3');
  });
});
