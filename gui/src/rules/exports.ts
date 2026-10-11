// 规则共享模块的打包导出入口：
// 供 scripts/selfplay.js 等 Node 脚本通过 esbuild bundle 后复用 GUI 的规则实现，
// 避免在脚本中维护第二份规则代码（唯一权威实现：gui/src/rules/rules.ts）。
export * from './rules';
export {
  parseFen,
  toFen,
  initialBoard,
  cloneBoard,
  emptyBoard,
  INITIAL_FEN,
  getPiece,
  setPiece,
  countPiece,
} from '../board/fen';
export type { BoardData } from '../board/fen';
export {
  FILES,
  RANKS,
  sq,
  sameSquare,
  squareKey,
  PIECE_CHAR,
  FEN_TO_PIECE,
  pieceToFenChar,
  parseIccs,
  toIccs,
} from '../board/types';
export type { Side, Piece, PieceType, Square, Move } from '../board/types';
