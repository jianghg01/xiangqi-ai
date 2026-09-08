// 棋盘核心类型定义
// 坐标系：file 0..8（左→右，即红方视角的一~九路），rank 0..9（上→下，rank 0 为黑方底线）

export type Side = 'red' | 'black';

export type PieceType = 'K' | 'A' | 'B' | 'N' | 'R' | 'C' | 'P';
// K=将/帅 A=士 B=象 N=马 R=车 C=炮 P=兵/卒

export interface Piece {
  side: Side;
  type: PieceType;
}

export interface Square {
  file: number; // 0..8
  rank: number; // 0..9
}

// 着法（M3 规则用）：ICCS 记谱，如 "h2e2"
export interface Move {
  from: Square;
  to: Square;
}

export const FILES = 9;
export const RANKS = 10;

export function sq(file: number, rank: number): Square {
  return { file, rank };
}

export function sameSquare(a: Square, b: Square): boolean {
  return a.file === b.file && a.rank === b.rank;
}

export function squareKey(s: Square): string {
  return `${s.file},${s.rank}`;
}

// 棋子显示字符（红方下行、黑方上行）
export const PIECE_CHAR: Record<Side, Record<PieceType, string>> = {
  red: { K: '帅', A: '仕', B: '相', N: '马', R: '车', C: '炮', P: '兵' },
  black: { K: '将', A: '士', B: '象', N: '马', R: '车', C: '炮', P: '卒' },
};

// FEN 字母 -> 棋子
export const FEN_TO_PIECE: Record<string, Piece> = {
  K: { side: 'red', type: 'K' },
  A: { side: 'red', type: 'A' },
  B: { side: 'red', type: 'B' },
  N: { side: 'red', type: 'N' },
  R: { side: 'red', type: 'R' },
  C: { side: 'red', type: 'C' },
  P: { side: 'red', type: 'P' },
  k: { side: 'black', type: 'K' },
  a: { side: 'black', type: 'A' },
  b: { side: 'black', type: 'B' },
  n: { side: 'black', type: 'N' },
  r: { side: 'black', type: 'R' },
  c: { side: 'black', type: 'C' },
  p: { side: 'black', type: 'P' },
};

export function pieceToFenChar(p: Piece): string {
  const ch = p.type;
  return p.side === 'red' ? ch : ch.toLowerCase();
}

// ICCS 着法：列 a..i 对应 file 0..8；行 0..9 对应 rank 0..9（黑方在上）
export function parseIccs(s: string): Move | null {
  const m = /^([a-i])(\d)([a-i])(\d)$/.exec(s.trim());
  if (!m) return null;
  return {
    from: { file: m[1].charCodeAt(0) - 97, rank: parseInt(m[2], 10) },
    to: { file: m[3].charCodeAt(0) - 97, rank: parseInt(m[4], 10) },
  };
}

export function toIccs(mv: Move): string {
  return (
    String.fromCharCode(97 + mv.from.file) +
    mv.from.rank +
    String.fromCharCode(97 + mv.to.file) +
    mv.to.rank
  );
}
