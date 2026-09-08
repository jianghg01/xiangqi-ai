import { describe, expect, it } from 'vitest';
import {
  emptyBoard,
  INITIAL_FEN,
  initialBoard,
  parseFen,
  setPiece,
  toFen,
} from '../src/board/fen';

describe('FEN 解析', () => {
  it('解析初始局面', () => {
    const { board, extra } = parseFen(INITIAL_FEN);
    expect(extra).toEqual(['-', '-', '0', '1']);
    expect(board.sideToMove).toBe('red');
    // 黑方底线 rank 0
    expect(board.pieces[0][0]).toEqual({ side: 'black', type: 'R' });
    expect(board.pieces[0][4]).toEqual({ side: 'black', type: 'K' });
    // 黑炮 rank 2: 1c5c1
    expect(board.pieces[2][1]).toEqual({ side: 'black', type: 'C' });
    expect(board.pieces[2][0]).toBeNull();
    // 红帅 rank 9
    expect(board.pieces[9][4]).toEqual({ side: 'red', type: 'K' });
    // 红兵 rank 6
    expect(board.pieces[6][0]).toEqual({ side: 'red', type: 'P' });
  });

  it('非法 FEN 抛错', () => {
    expect(() => parseFen('rnbakabnr w')).toThrow();
    expect(() => parseFen('rnbakabnr/9/9/9/9/9/9/9/9/RNBAKABNR x - - 0 1')).toThrow(/行棋方/);
    expect(() => parseFen('rnbakabnr/9/9/9/9/9/9/9/9/RNBAKZBNR w - - 0 1')).toThrow(/非法棋子/);
    expect(() => parseFen('rnbakabnr/8/9/9/9/9/9/9/9/RNBAKABNR w - - 0 1')).toThrow(/宽度不足/);
  });
});

describe('FEN 序列化', () => {
  it('初始局面 roundtrip 一致', () => {
    const { board } = parseFen(INITIAL_FEN);
    expect(toFen(board)).toBe(INITIAL_FEN);
  });

  it('空盘序列化', () => {
    const b = emptyBoard();
    expect(toFen(b)).toBe('9/9/9/9/9/9/9/9/9/9 w - - 0 1');
  });

  it('摆子后序列化正确', () => {
    const b = emptyBoard();
    setPiece(b, 4, 9, { side: 'red', type: 'K' });
    setPiece(b, 4, 0, { side: 'black', type: 'K' });
    expect(toFen(b)).toBe('4k4/9/9/9/9/9/9/9/9/4K4 w - - 0 1');
  });

  it('摆任意局面 roundtrip', () => {
    const b = emptyBoard();
    setPiece(b, 0, 0, { side: 'black', type: 'R' });
    setPiece(b, 8, 8, { side: 'red', type: 'C' });
    setPiece(b, 4, 5, { side: 'red', type: 'N' });
    const fen = toFen(b);
    const { board } = parseFen(fen);
    expect(toFen(board)).toBe(fen);
    expect(board.pieces[8][8]).toEqual({ side: 'red', type: 'C' });
  });
});

describe('初始局面完整性', () => {
  it('双方各 16 子', () => {
    const b = initialBoard();
    const flat = b.pieces.flat();
    expect(flat.filter(p => p?.side === 'red')).toHaveLength(16);
    expect(flat.filter(p => p?.side === 'black')).toHaveLength(16);
  });
});
