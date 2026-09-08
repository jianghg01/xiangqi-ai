import { describe, expect, it } from 'vitest';
import { parseFen, toFen } from '../src/board/fen';
import { sq } from '../src/board/types';
import {
  applyMove,
  attackedBy,
  checkStatus,
  flyingGeneralFacing,
  inCheck,
  legalMoves,
  pseudoMovesFrom,
} from '../src/rules/rules';

const fen = (s: string) => parseFen(s).board;
const targets = (boardFen: string, from: { file: number; rank: number }) => {
  const b = fen(boardFen);
  return pseudoMovesFrom(b, sq(from.file, from.rank)).map(m => `${m.to.file},${m.to.rank}`);
};

describe('初始局面', () => {
  it('红方合法着法共 44 种（公认常数）', () => {
    const b = fen('rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1');
    expect(legalMoves(b, 'red')).toHaveLength(44);
  });
});

describe('马腿（蹩马腿）', () => {
  // 红马在 (4,4)，(4,5) 处放黑马挡腿：纵向 jumps（腿 (4,5)）被挡，横向 jumps（腿 (3,4)/(5,4)）不受影响
  const F = '4k4/9/9/9/4N4/4n4/9/9/9/4K4 w - - 0 1';
  it('纵向 jumps 被 (4,5) 蹩腿', () => {
    const t = targets(F, { file: 4, rank: 4 });
    expect(t).not.toContain('5,6');
    expect(t).not.toContain('3,6');
    expect(t).toContain('5,2'); // 腿在 (4,3)，畅通
    expect(t).toContain('3,2');
    expect(t).toContain('6,5');
    expect(t).toContain('2,5');
    expect(t).toContain('6,3');
    expect(t).toContain('2,3');
  });
});

describe('塞象眼', () => {
  // 红相在 (4,7)（红方地盘），目标 (2,5)/(6,5)，象眼 (3,6)/(5,6)
  it('象眼有子时飞相被挡', () => {
    const free = '4k4/9/9/9/9/9/9/4B4/9/4K4 w - - 0 1';
    const t = targets(free, { file: 4, rank: 7 });
    expect(t).toContain('2,5');
    expect(t).toContain('6,5');
    expect(t).toContain('2,9');
    expect(t).toContain('6,9');

    const blocked = '4k4/9/9/9/9/9/3n1n3/4B4/9/4K4 w - - 0 1';
    const t2 = targets(blocked, { file: 4, rank: 7 });
    expect(t2).not.toContain('2,5');
    expect(t2).not.toContain('6,5');
    // 底相不受影响
    expect(t2).toContain('2,9');
  });
});

describe('炮打隔子', () => {
  // 红炮 (4,7)，黑子 (4,4)，黑将 (4,0)：隔一个子可以打
  it('有炮架才能吃子', () => {
    const b = fen('4k4/9/9/9/4n4/9/9/4C4/9/4K4 w - - 0 1');
    const ms = pseudoMovesFrom(b, sq(4, 7)).map(m => `${m.to.file},${m.to.rank}`);
    // 无阻挡路径
    expect(ms).toContain('4,6');
    expect(ms).toContain('4,5');
    // (4,4) 是炮架：炮不能落该格，也不能落在炮架后空格（炮吃必须隔子打子）
    expect(ms).not.toContain('4,4');
    expect(ms).not.toContain('4,3');
    // (4,0) 黑将：与炮之间有 (4,4) 一个炮架 → 可隔子打
    expect(ms).toContain('4,0');
  });
});

describe('兵过河', () => {
  it('过河兵可横走', () => {
    // 红兵 (4,4) 已过河
    const b = fen('4k4/9/9/9/4P4/9/9/9/9/4K4 w - - 0 1');
    const ms = pseudoMovesFrom(b, sq(4, 4)).map(m => `${m.to.file},${m.to.rank}`);
    expect(ms).toContain('4,3'); // 前进
    expect(ms).toContain('3,4'); // 横走
    expect(ms).toContain('5,4');
    // 未过河红兵 (4,5)：只能前进
    const b2 = fen('4k4/9/9/9/9/4P4/9/9/9/4K4 w - - 0 1');
    const ms2 = pseudoMovesFrom(b2, sq(4, 5)).map(m => `${m.to.file},${m.to.rank}`);
    expect(ms2).toEqual(['4,4']);
  });
});

describe('将帅照面', () => {
  it('同列无子时视为被将', () => {
    const b = fen('4k4/9/9/9/9/9/9/9/9/4K4 w - - 0 1');
    expect(flyingGeneralFacing(b)).toBe(true);
    expect(inCheck(b, 'red')).toBe(true);
    expect(inCheck(b, 'black')).toBe(true);
  });
  it('中间有子不照面', () => {
    const b = fen('4k4/9/9/9/9/4P4/9/9/9/4K4 w - - 0 1');
    expect(flyingGeneralFacing(b)).toBe(false);
  });
});

describe('将军检测', () => {
  it('车将军', () => {
    // 黑将 (4,0)，红车 (4,5)，中间无子 → 黑被将
    const b = fen('4k4/9/9/9/9/4R4/9/9/9/4K4 b - - 0 1');
    expect(inCheck(b, 'black')).toBe(true);
    expect(attackedBy(b, sq(4, 0), 'red')).toBe(true);
  });
});

describe('绝杀', () => {
  // 双车阶梯杀：黑将(4,0)；红车(0,0)锁横线将军、红车(0,1)锁二路线；红帅(3,9)
  it('无路可走判负', () => {
    const b = fen('R3k4/R8/9/9/9/9/9/9/9/3K5 b - - 0 1');
    const st = checkStatus(b);
    expect(st.status).toBe('checkmate');
  });

  it('被将军但可解将 → check 而非 mate', () => {
    // 黑将(4,0)+黑士(3,0)，红车(4,5)沿四路将军，黑可平将避将
    const b = fen('3ak4/9/9/9/9/4R4/9/9/9/4K4 b - - 0 1');
    const st = checkStatus(b);
    expect(st.status).toBe('check');
  });
});

describe('applyMove', () => {
  it('走子后行棋方翻转且不修改原局面', () => {
    const b = fen('4k4/9/9/9/9/9/9/9/9/3RK4 w - - 0 1');
    const nb = applyMove(b, { from: sq(3, 9), to: sq(3, 0) });
    expect(nb.sideToMove).toBe('black');
    expect(toFen(nb).split(' ')[1]).toBe('b');
    // 原局面不变
    expect(toFen(b).split(' ')[1]).toBe('w');
    expect(b.pieces[9][3]).not.toBeNull();
  });
});
