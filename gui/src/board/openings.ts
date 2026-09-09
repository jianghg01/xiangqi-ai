// 开局库：常见开局序列（内部坐标 ICCS，rank 0=黑底线）
// 用途：机机对弈开局阶段直接按库走（无需等引擎思考），并显示开局名称
// 序列必须严格合法（tests/openings.test.ts 会逐一验证）

import { cloneBoard, initialBoard } from './fen';
import { parseIccs } from './types';
import { legalMoves } from '../rules/rules';

export interface Opening {
  name: string;
  moves: string[];
}

export const OPENINGS: Opening[] = [
  // 中炮进三兵对屏风马：炮二平五 马8进7 马二进三 车9平8 车一平二 马2进3 兵三进一 卒3进1
  { name: '中炮进三兵对屏风马', moves: ['h7e7', 'h0g2', 'h9g7', 'i0h0', 'i9h9', 'b0c2', 'c6c5', 'c3c4'] },
  // 顺炮直车对横车：炮二平五 炮2平5 马二进三 马8进7 车一平二 车1进1
  { name: '顺炮直车对横车', moves: ['h7e7', 'b2e2', 'h9g7', 'h0g2', 'i9h9', 'a0a1'] },
  // 仙人指路对卒底炮：兵七进一 炮2平3
  { name: '仙人指路对卒底炮', moves: ['c6c5', 'b2c2'] },
  // 飞相局：相三进五 马8进7
  { name: '飞相局', moves: ['g9e7', 'h0g2'] },
  // 中炮对反宫马：炮二平五 马2进3 马二进三 马8进7
  { name: '中炮对反宫马', moves: ['h7e7', 'b0c2', 'h9g7', 'h0g2'] },
  // 过宫炮：炮二平六 马8进7
  { name: '过宫炮', moves: ['h7d7', 'h0g2'] },
];

// 校验一条开局序列每步都合法（从初始局面重放）
export function isOpeningValid(o: Opening): boolean {
  const b = cloneBoard(initialBoard());
  for (const s of o.moves) {
    const mv = parseIccs(s);
    if (!mv) return false;
    const ok = legalMoves(b, b.sideToMove).some(
      l => l.from.file === mv.from.file && l.from.rank === mv.from.rank &&
           l.to.file === mv.to.file && l.to.rank === mv.to.rank,
    );
    if (!ok) return false;
    b.pieces[mv.to.rank][mv.to.file] = b.pieces[mv.from.rank][mv.from.file];
    b.pieces[mv.from.rank][mv.from.file] = null;
    b.sideToMove = b.sideToMove === 'red' ? 'black' : 'red';
  }
  return true;
}

/**
 * 匹配当前已走着法序列（最长前缀优先）。
 * 返回 null 表示没有匹配的开局；next 为库中下一步（null 表示该开局已走完）。
 */
export function matchOpening(movesHistory: string[]): { name: string; next: string | null } | null {
  let best: Opening | null = null;
  for (const o of OPENINGS) {
    if (movesHistory.length <= o.moves.length &&
        o.moves.slice(0, movesHistory.length).every((m, i) => m === movesHistory[i])) {
      if (!best || o.moves.length > best.moves.length) best = o;
    }
  }
  if (!best) return null;
  return {
    name: best.name,
    next: movesHistory.length < best.moves.length ? best.moves[movesHistory.length] : null,
  };
}
