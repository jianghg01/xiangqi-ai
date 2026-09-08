// Xiangqi FEN 解析与序列化（标准格式）
// 例（初始局面）：rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1
// 行序：rank 0（黑方底线，FEN 第一行）→ rank 9（红方底线）

import {
  FILES,
  FEN_TO_PIECE,
  Piece,
  PieceType,
  Side,
  pieceToFenChar,
  sq,
} from './types';

export interface BoardData {
  // pieces[rank][file] = 棋子或 null
  pieces: (Piece | null)[][];
  sideToMove: Side;
}

export const INITIAL_FEN =
  'rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1';

export function emptyBoard(): BoardData {
  const pieces: (Piece | null)[][] = [];
  for (let r = 0; r < 10; r++) pieces.push(new Array(9).fill(null));
  return { pieces, sideToMove: 'red' };
}

export function initialBoard(): BoardData {
  return parseFen(INITIAL_FEN).board;
}

export function parseFen(fen: string): { board: BoardData; extra: string[] } {
  const parts = fen.trim().split(/\s+/);
  if (parts.length < 2) throw new Error(`FEN 字段不足: ${fen}`);
  const rows = parts[0].split('/');
  if (rows.length !== 10) throw new Error(`FEN 行数应为 10，实际 ${rows.length}`);

  const board = emptyBoard();
  if (parts[1] !== 'w' && parts[1] !== 'b') {
    throw new Error(`行棋方字段无效: ${parts[1]}`);
  }
  board.sideToMove = parts[1] === 'w' ? 'red' : 'black';

  rows.forEach((row, rank) => {
    let file = 0;
    for (const ch of row) {
      if (ch >= '1' && ch <= '9') {
        file += parseInt(ch, 10);
      } else {
        const piece = FEN_TO_PIECE[ch];
        if (!piece) throw new Error(`FEN 含非法棋子字符: ${ch}`);
        if (file >= FILES) throw new Error(`FEN 行超长: ${row}`);
        board.pieces[rank][file] = piece;
        file++;
      }
    }
    if (file !== FILES) throw new Error(`FEN 行宽度不足: ${row}`);
  });

  return { board, extra: parts.slice(2) };
}

export function toFen(board: BoardData, extra: string[] = ['-','-','0','1']): string {
  const rows: string[] = [];
  for (let rank = 0; rank < 10; rank++) {
    let row = '';
    let empty = 0;
    for (let file = 0; file < 9; file++) {
      const p = board.pieces[rank][file];
      if (p) {
        if (empty) { row += empty; empty = 0; }
        row += pieceToFenChar(p);
      } else {
        empty++;
      }
    }
    if (empty) row += empty;
    rows.push(row);
  }
  const side = board.sideToMove === 'red' ? 'w' : 'b';
  return `${rows.join('/')} ${side} ${extra.join(' ')}`;
}

export function getPiece(board: BoardData, file: number, rank: number): Piece | null {
  return board.pieces[rank][file] ?? null;
}

export function setPiece(board: BoardData, file: number, rank: number, p: Piece | null): void {
  if (file < 0 || file > 8 || rank < 0 || rank > 9) {
    throw new Error(`坐标越界: (${file},${rank})`);
  }
  board.pieces[rank][file] = p;
}

export function cloneBoard(board: BoardData): BoardData {
  return {
    pieces: board.pieces.map(row => row.slice()),
    sideToMove: board.sideToMove,
  };
}

// 统计某方某类棋子数量（FEN 校验用，如将/帅必须各恰 1）
export function countPiece(board: BoardData, side: Side, type: PieceType): number {
  let n = 0;
  for (let r = 0; r < 10; r++)
    for (let f = 0; f < 9; f++) {
      const p = board.pieces[r][f];
      if (p && p.side === side && p.type === type) n++;
    }
  return n;
}

export { sq };
