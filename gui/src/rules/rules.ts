// 中国象棋走子规则引擎（纯逻辑，不依赖 UI）
// 坐标：file 0..8（左→右），rank 0..9（上→下，黑方在上，红方在下）
// 红方前进方向为 rank 递减（向上）

import { BoardData, cloneBoard, getPiece, setPiece } from '../board/fen';
import { Move, Piece, Side, Square, sq } from '../board/types';

const DIRS: [number, number][] = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const DIAGS: [number, number][] = [[1, 1], [1, -1], [-1, 1], [-1, -1]];
const KNIGHT: [number, number][] = [
  [1, 2], [2, 1], [2, -1], [1, -2], [-1, -2], [-2, -1], [-2, 1], [-1, 2],
];

function onBoard(s: Square): boolean {
  return s.file >= 0 && s.file <= 8 && s.rank >= 0 && s.rank <= 9;
}

// 九宫：files 3..5；黑 rank 0..2，红 rank 7..9
function inPalace(s: Square, side: Side): boolean {
  return s.file >= 3 && s.file <= 5 && (side === 'red' ? s.rank >= 7 : s.rank <= 2);
}

// 过河：红过河为 rank <= 4，黑过河为 rank >= 5
function crossedRiver(s: Square, side: Side): boolean {
  return side === 'red' ? s.rank <= 4 : s.rank >= 5;
}

export function findKing(board: BoardData, side: Side): Square | null {
  const r0 = side === 'red' ? 7 : 0;
  for (let r = r0; r < r0 + 3; r++)
    for (let f = 3; f <= 5; f++) {
      const p = getPiece(board, f, r);
      if (p && p.side === side && p.type === 'K') return sq(f, r);
    }
  return null;
}

// 将帅照面：同列且中间无子
export function flyingGeneralFacing(board: BoardData): boolean {
  const rk = findKing(board, 'red');
  const bk = findKing(board, 'black');
  if (!rk || !bk || rk.file !== bk.file) return false;
  for (let r = bk.rank + 1; r < rk.rank; r++) {
    if (getPiece(board, rk.file, r)) return false;
  }
  return true;
}

// target 是否被 by 方攻击
export function attackedBy(board: BoardData, target: Square, by: Side): boolean {
  const { file: f, rank: r } = target;
  const dir = by === 'red' ? -1 : 1; // 该方兵的前进方向

  // 车 / 炮（四方向射线）
  for (const [df, dr] of DIRS) {
    let cf = f + df, cr = r + dr, screen = false;
    while (cf >= 0 && cf <= 8 && cr >= 0 && cr <= 9) {
      const p = getPiece(board, cf, cr);
      if (p) {
        if (!screen) {
          if (p.side === by && p.type === 'R') return true;
          screen = true;
        } else {
          if (p.side === by && p.type === 'C') return true;
          break;
        }
      }
      cf += df; cr += dr;
    }
  }

  // 马（注意蹩腿判断方向：腿在马的相邻位置，朝目标方向）
  for (const [df, dr] of KNIGHT) {
    const tf = f + df, tr = r + dr;
    if (tf < 0 || tf > 8 || tr < 0 || tr > 9) continue;
    const p = getPiece(board, tf, tr);
    if (!p || p.side !== by || p.type !== 'N') continue;
    const lf = tf + (Math.abs(df) === 2 ? (df > 0 ? -1 : 1) : 0);
    const lr = tr + (Math.abs(dr) === 2 ? (dr > 0 ? -1 : 1) : 0);
    if (!getPiece(board, lf, lr)) return true;
  }

  // 兵：正前方一格的敌兵；过河兵的侧翼
  const pr = r - dir;
  if (pr >= 0 && pr <= 9) {
    const p = getPiece(board, f, pr);
    if (p && p.side === by && p.type === 'P') return true;
  }
  for (const df of [-1, 1]) {
    const sf = f + df;
    if (sf < 0 || sf > 8) continue;
    const p = getPiece(board, sf, r);
    if (p && p.side === by && p.type === 'P' && crossedRiver(sq(sf, r), by)) return true;
  }

  return false;
}

export function inCheck(board: BoardData, side: Side): boolean {
  if (flyingGeneralFacing(board)) return true;
  const k = findKing(board, side);
  if (!k) return true; // 将被吃（不应出现）
  return attackedBy(board, k, side === 'red' ? 'black' : 'red');
}

// 某格棋子的伪合法着法（不考虑送将）
export function pseudoMovesFrom(board: BoardData, from: Square): Move[] {
  const p: Piece | null = getPiece(board, from.file, from.rank);
  if (!p) return [];
  const { side, type } = p;
  const out: Move[] = [];
  const dir = side === 'red' ? -1 : 1;

  const push = (to: Square) => {
    if (!onBoard(to)) return;
    const t = getPiece(board, to.file, to.rank);
    if (t && t.side === side) return;
    out.push({ from, to });
  };

  if (type === 'K') {
    for (const [df, dr] of DIRS) {
      const to = sq(from.file + df, from.rank + dr);
      if (inPalace(to, side)) push(to);
    }
  } else if (type === 'A') {
    for (const [df, dr] of DIAGS) {
      const to = sq(from.file + df, from.rank + dr);
      if (inPalace(to, side)) push(to);
    }
  } else if (type === 'B') {
    for (const [df, dr] of [[2, 2], [2, -2], [-2, 2], [-2, -2]] as [number, number][]) {
      const to = sq(from.file + df, from.rank + dr);
      const eye = sq(from.file + df / 2, from.rank + dr / 2);
      if (onBoard(to) && !crossedRiver(to, side) && !getPiece(board, eye.file, eye.rank)) push(to);
    }
  } else if (type === 'N') {
    for (const [df, dr] of KNIGHT) {
      const to = sq(from.file + df, from.rank + dr);
      const leg = sq(
        from.file + (Math.abs(df) === 2 ? df / 2 : 0),
        from.rank + (Math.abs(dr) === 2 ? dr / 2 : 0),
      );
      if (onBoard(to) && !getPiece(board, leg.file, leg.rank)) push(to);
    }
  } else if (type === 'R') {
    for (const [df, dr] of DIRS) {
      let f = from.file + df, r = from.rank + dr;
      while (f >= 0 && f <= 8 && r >= 0 && r <= 9) {
        const t = getPiece(board, f, r);
        if (!t) out.push({ from, to: sq(f, r) });
        else {
          if (t.side !== side) out.push({ from, to: sq(f, r) });
          break;
        }
        f += df; r += dr;
      }
    }
  } else if (type === 'C') {
    for (const [df, dr] of DIRS) {
      let f = from.file + df, r = from.rank + dr, screen = false;
      while (f >= 0 && f <= 8 && r >= 0 && r <= 9) {
        const t = getPiece(board, f, r);
        if (!screen) {
          if (!t) out.push({ from, to: sq(f, r) });
          else screen = true;
        } else if (t) {
          if (t.side !== side) out.push({ from, to: sq(f, r) });
          break;
        }
        f += df; r += dr;
      }
    }
  } else {
    // 兵/卒
    push(sq(from.file, from.rank + dir));
    if (crossedRiver(from, side)) {
      push(sq(from.file - 1, from.rank));
      push(sq(from.file + 1, from.rank));
    }
  }
  return out;
}

export function pseudoMoves(board: BoardData, side: Side): Move[] {
  const out: Move[] = [];
  for (let r = 0; r < 10; r++)
    for (let f = 0; f < 9; f++) {
      const p = getPiece(board, f, r);
      if (p && p.side === side) out.push(...pseudoMovesFrom(board, sq(f, r)));
    }
  return out;
}

// 应用着法，返回新局面（不修改原局面），行棋方翻转
export function applyMove(board: BoardData, mv: Move): BoardData {
  const p = getPiece(board, mv.from.file, mv.from.rank);
  if (!p) throw new Error(`起点无棋子: (${mv.from.file},${mv.from.rank})`);
  const nb = cloneBoard(board);
  setPiece(nb, mv.from.file, mv.from.rank, null);
  setPiece(nb, mv.to.file, mv.to.rank, p);
  nb.sideToMove = nb.sideToMove === 'red' ? 'black' : 'red';
  return nb;
}

// 合法着法 = 伪合法 且 走后不被将/将帅不照面
export function legalMoves(board: BoardData, side: Side): Move[] {
  return pseudoMoves(board, side).filter(mv => !inCheck(applyMove(board, mv), side));
}

export function legalMovesFrom(board: BoardData, from: Square): Move[] {
  const p = getPiece(board, from.file, from.rank);
  if (!p) return [];
  return legalMoves(board, p.side).filter(mv => mv.from.file === from.file && mv.from.rank === from.rank);
}

export type GameStatus = 'ok' | 'check' | 'checkmate' | 'stalemate';

// 局面状态评估（针对 sideToMove）
export function checkStatus(board: BoardData): { status: GameStatus; moves: Move[] } {
  const side = board.sideToMove;
  const moves = legalMoves(board, side);
  if (moves.length === 0) {
    return { status: inCheck(board, side) ? 'checkmate' : 'stalemate', moves };
  }
  return { status: inCheck(board, side) ? 'check' : 'ok', moves };
}
