// 开局库：常见开局序列（内部坐标 ICCS，rank 0=黑底线）
// 用途：机机对弈开局阶段直接按库走（无需等引擎思考），并显示开局名称
// 序列必须严格合法（tests/openings.test.ts 会逐一验证）
// 数据在 openings.json——扩充开局库只改 JSON 文件即可

import { cloneBoard, initialBoard } from './fen';
import { parseIccs } from './types';
import { legalMoves } from '../rules/rules';
import bookData from './openings.json';

export interface Opening {
  name: string;
  moves: string[];
}

export const OPENINGS: Opening[] = bookData;

// 自定义开局（运行时注入，来自 PGN 导入，localStorage 持久化；测试环境不受影响）
let customOpenings: Opening[] = [];
export function setCustomOpenings(list: Opening[]) {
  customOpenings = list;
}
export function getCustomOpenings(): Opening[] {
  return [...customOpenings];
}
function allOpenings(): Opening[] {
  return customOpenings.length ? [...OPENINGS, ...customOpenings] : OPENINGS;
}

// 校验一条开局序列每步都合法（从初始局面重放）
export function isOpeningValid(o: Opening): boolean {
  const b = cloneBoard(initialBoard());
  for (const s of o.moves) {
    const mv = parseIccs(s);
    if (!mv) return false;
    const ok = legalMoves(b, b.sideToMove).some(
      (l) =>
        l.from.file === mv.from.file &&
        l.from.rank === mv.from.rank &&
        l.to.file === mv.to.file &&
        l.to.rank === mv.to.rank,
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
  for (const o of allOpenings()) {
    if (
      movesHistory.length <= o.moves.length &&
      o.moves.slice(0, movesHistory.length).every((m, i) => m === movesHistory[i])
    ) {
      if (!best || o.moves.length > best.moves.length) best = o;
    }
  }
  if (!best) return null;
  return {
    name: best.name,
    next: movesHistory.length < best.moves.length ? best.moves[movesHistory.length] : null,
  };
}

// ---------- 按开局类别选择（人指定起手） ----------
export type OpeningCategory =
  'any' | 'zhongpao' | 'shunpao' | 'xianren' | 'feixiang' | 'guogong' | 'qima' | 'jiuweigu';

/**
 * 首着 → 类别映射（按红方首着确定性归类，避免名称含"中炮"导致误判）：
 *   h7e7 炮二平五 → 中炮；b7e7 炮八平五 → 顺炮（对局中黑亦走炮2平5形成顺炮）
 *   h7d7 炮二平六 → 过宫炮；c6c5 兵三进一 → 仙人指路
 *   g9e7 相三进五 → 飞相局；h9g7 马二进三 → 起马局；a6a5 兵九进一 → 九尾龟
 */
export function categoryOf(name: string, firstMove: string): OpeningCategory {
  if (firstMove === 'b7e7') return 'shunpao';
  if (firstMove === 'h7d7') return 'guogong';
  if (firstMove === 'c6c5') return 'xianren';
  if (firstMove === 'g9e7') return 'feixiang';
  if (firstMove === 'h9g7') return 'qima';
  if (firstMove === 'a6a5') return 'jiuweigu';
  if (firstMove === 'h7e7') return name.includes('顺炮') ? 'shunpao' : 'zhongpao';
  return 'any';
}

export const OPENING_CATEGORY_LABELS: Record<OpeningCategory, string> = {
  any: '不限定（开局库随机）',
  zhongpao: '中炮（中炮系列）',
  shunpao: '顺炮（顺炮系列）',
  xianren: '仙人指路',
  feixiang: '飞相局',
  guogong: '过宫炮',
  qima: '起马局',
  jiuweigu: '九尾龟',
};

/**
 * 按类别匹配开局（兼容当前已走着法），从匹配集合中随机选一条返回。
 * category='any' 时在所有兼容开局中随机；指定类别时在类别内随机。
 */
export function matchOpeningByCategory(
  movesHistory: string[],
  category: OpeningCategory,
): { name: string; next: string | null } | null {
  const compatible = allOpenings().filter(
    (o) =>
      movesHistory.length <= o.moves.length &&
      o.moves.slice(0, movesHistory.length).every((m, i) => m === movesHistory[i]),
  );
  if (!compatible.length) return null;
  const pool =
    category === 'any'
      ? compatible
      : compatible.filter((o) => categoryOf(o.name, o.moves[0]) === category);
  const selected = pool.length ? pool : compatible; // 类别内无匹配则回退全量兼容集合
  const pick = selected[Math.floor(Math.random() * selected.length)];
  return {
    name: pick.name,
    next: movesHistory.length < pick.moves.length ? pick.moves[movesHistory.length] : null,
  };
}
