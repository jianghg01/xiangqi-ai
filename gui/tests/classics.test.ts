// 名局欣赏（古谱《自出洞来无敌手》）测试：
// 35 局逐手合法重放 + 中文记谱一致性 + 红方收尾 + 绝杀统计
import { describe, expect, it } from 'vitest';
import { initialBoard, cloneBoard } from '../src/board/fen';
import { Move, parseIccs } from '../src/board/types';
import { applyMove, checkStatus, legalMoves } from '../src/rules/rules';
import { moveToChinese } from '../src/board/notation';
import { CLASSICS, CLASSIC_CATEGORIES, findClassic } from '../src/board/classics';

function replay(moves: string[]) {
  let board = initialBoard();
  for (const s of moves) {
    const mv = parseIccs(s);
    expect(mv, `着法 ${s} 解析`).not.toBeNull();
    board = applyMove(board, mv as Move);
  }
  return board;
}

describe('名局欣赏（自出洞来无敌手）', () => {
  it('共 35 局，七类各五局，id 唯一', () => {
    expect(CLASSICS.length).toBe(35);
    expect(CLASSIC_CATEGORIES.length).toBe(7);
    for (const cat of CLASSIC_CATEGORIES) {
      expect(CLASSICS.filter(g => g.category === cat).length, cat).toBe(5);
    }
    expect(new Set(CLASSICS.map(g => g.id)).size).toBe(35);
    for (const g of CLASSICS) expect(findClassic(g.id)).toBe(g);
  });

  it('全部 35 局每一步都合法重放', () => {
    for (const g of CLASSICS) {
      expect(g.moves.length, `${g.id} moves 与 movesZh 对应`).toBe(g.movesZh.length);
      expect(g.moves.length % 2, `${g.category}·${g.name} 应红方收尾（古谱得先胜）`).toBe(1);
      replay(g.moves);
    }
  });

  it('movesZh 与实际走子生成的中文记谱完全一致', () => {
    for (const g of CLASSICS) {
      let board = initialBoard();
      for (let i = 0; i < g.moves.length; i++) {
        const mv = parseIccs(g.moves[i]) as Move;
        expect(moveToChinese(board, mv), `${g.id} 第 ${i + 1} 手记谱`).toBe(g.movesZh[i]);
        board = applyMove(board, mv);
      }
    }
  });

  it('绝大多数局以绝杀收尾（红胜）', () => {
    let mate = 0;
    const nonMate: string[] = [];
    for (const g of CLASSICS) {
      const board = replay(g.moves);
      const st = checkStatus(board);
      if (st.status === 'checkmate') mate++;
      else nonMate.push(`${g.id}(${st.status})`);
    }
    // 古谱个别局在绝杀前收手，但绝大多数应以绝杀结束
    expect(mate).toBeGreaterThanOrEqual(25);
    if (nonMate.length) console.log('非绝杀收尾：', nonMate.join(', '));
  });

  it('着法规模合理（25~55 手）', () => {
    for (const g of CLASSICS) {
      expect(g.moves.length, g.id).toBeGreaterThanOrEqual(25);
      expect(g.moves.length, g.id).toBeLessThanOrEqual(55);
    }
  });
});

// 规则模块回归哨兵
describe('哨兵', () => {
  it('初始局面红方合法着法 44 种', () => {
    expect(legalMoves(initialBoard(), 'red').length).toBe(44);
    expect(cloneBoard(initialBoard()).pieces.length).toBe(10);
  });
});
