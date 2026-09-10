// 残局闯关题库校验：FEN 合法、提示手合法且不直接成杀
import { describe, it, expect } from 'vitest';
import puzzlesJson from '../src/data/puzzles.json';
import { parseFen, toFen } from '../src/board/fen';
import { applyMove, checkStatus, legalMovesFrom } from '../src/rules/rules';
import { parseIccs, Side } from '../src/board/types';

const PUZZLES = puzzlesJson as { id: string; name: string; fen: string; side: Side; movesToMate: number; solution: string }[];

describe('残局题库', () => {
  it('题量充足且 id 唯一', () => {
    expect(PUZZLES.length).toBeGreaterThanOrEqual(40);
    expect(new Set(PUZZLES.map(p => p.id)).size).toBe(PUZZLES.length);
  });

  it('FEN 合法且可往返', () => {
    for (const p of PUZZLES) {
      const b = parseFen(p.fen).board;
      expect(toFen(b)).toBe(p.fen);
    }
  });

  it('行棋方与标注一致，提示手合法', () => {
    for (const p of PUZZLES) {
      const b = parseFen(p.fen).board;
      expect(b.sideToMove).toBe(p.side);
      const sol = parseIccs(p.solution)!;
      const legal = legalMovesFrom(b, sol.from).some(m => m.to.file === sol.to.file && m.to.rank === sol.to.rank);
      expect(legal).toBe(true);
    }
  });

  it('提示手不会一步直接成杀（movesToMate>=2 的提取口径）', () => {
    for (const p of PUZZLES) {
      const b = parseFen(p.fen).board;
      const after = applyMove(b, parseIccs(p.solution)!);
      expect(checkStatus(after).status).not.toBe('checkmate');
    }
  });
});
