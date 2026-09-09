// 中文记谱（纵线记法）：如 "炮二平五"、"马8进7"
// 坐标约定（与 board/types.ts 一致）：file 0..8 = 屏幕左→右，rank 0 = 黑方底线（屏幕顶部）
//   红方纵线：从红方视角右→左为一~九路 => 红路号 = 9 - file，用汉字
//   黑方纵线：从黑方视角右→左为 1~9 路   => 黑路号 = file + 1，用阿拉伯数字
// 同线同种同方棋子用 前/中/后 消歧（兵 3 个以上时中间用 汉字序号，属简化实现）

import { BoardData, cloneBoard } from './fen';
import { Move, PieceType, PIECE_CHAR } from './types';

const CN_NUM = ['一', '二', '三', '四', '五', '六', '七', '八', '九'];

// 走直线、能沿纵线平移的兵种（进退用步数）
function isStraightMover(t: PieceType): boolean {
  return t === 'R' || t === 'C' || t === 'P' || t === 'K';
}

// 纵线号（红方汉字 / 黑方数字）
function columnLabel(side: 'red' | 'black', file: number): string {
  return side === 'red' ? CN_NUM[8 - file] : String(file + 1);
}

// 同一纵线上与 from 同种同方的其他棋子的 rank 列表
function sameFilePeers(board: BoardData, side: 'red' | 'black', type: PieceType, file: number, fromRank: number): number[] {
  const ranks: number[] = [];
  for (let r = 0; r < 10; r++) {
    if (r === fromRank) continue;
    const q = board.pieces[r][file];
    if (q && q.side === side && q.type === type) ranks.push(r);
  }
  return ranks;
}

/**
 * 把一步着法转成中文记谱。board 必须是走子之前的局面（用于识别棋子与消歧）。
 * 非法输入（起点无子）返回空串。
 */
export function moveToChinese(board: BoardData, mv: Move): string {
  const p = board.pieces[mv.from.rank]?.[mv.from.file];
  if (!p) return '';
  const side = p.side;
  const t = p.type;
  const nameChar = PIECE_CHAR[side][t];

  // 方向：红方前进 = rank 减小；黑方前进 = rank 增大
  const dr = mv.to.rank - mv.from.rank;
  const forward = side === 'red' ? dr < 0 : dr > 0;
  const sameRank = dr === 0;

  let verb: string;
  let suffix: string;
  if (sameRank) {
    verb = '平';
    suffix = columnLabel(side, mv.to.file);
  } else if (isStraightMover(t)) {
    verb = forward ? '进' : '退';
    const steps = Math.abs(dr);
    suffix = side === 'red' ? CN_NUM[steps - 1] : String(steps);
  } else {
    // 马相仕斜走：进退 + 目标纵线
    verb = forward ? '进' : '退';
    suffix = columnLabel(side, mv.to.file);
  }

  // 消歧：同线同种同方还有别的子 → 前/中/后 + 子名
  const peers = sameFilePeers(board, side, t, mv.from.file, mv.from.rank);
  if (peers.length > 0) {
    // "前" = 更靠近敌方底线：红方 rank 小者为前，黑方 rank 大者为前
    const all = [...peers, mv.from.rank].sort((a, b) => (side === 'red' ? a - b : b - a));
    const idx = all.indexOf(mv.from.rank);
    const n = all.length;
    let prefix: string;
    if (n === 2) prefix = idx === 0 ? '前' : '后';
    else if (n === 3) prefix = idx === 0 ? '前' : idx === n - 1 ? '后' : '中';
    else prefix = idx === 0 ? '前' : idx === n - 1 ? '后' : CN_NUM[idx] ?? '中';
    return prefix + nameChar + verb + suffix;
  }

  return nameChar + columnLabel(side, mv.from.file) + verb + suffix;
}

/**
 * 从起始局面重放整段 ICCS 着法序列，返回每步的中文记谱。
 * 遇到非法着法即停止（返回已完成部分），不抛异常。
 */
export function movesToChinese(startBoard: BoardData, iccsMoves: string[]): string[] {
  const out: string[] = [];
  const b = cloneBoard(startBoard);
  for (const s of iccsMoves) {
    const mv = parseIccsLocal(s);
    if (!mv) break;
    const zh = moveToChinese(b, mv);
    if (!zh) break;
    out.push(zh);
    b.pieces[mv.to.rank][mv.to.file] = b.pieces[mv.from.rank][mv.from.file];
    b.pieces[mv.from.rank][mv.from.file] = null;
  }
  return out;
}

// 局部解析，避免循环依赖 types（types.ts 不依赖本模块）
function parseIccsLocal(s: string): { from: { file: number; rank: number }; to: { file: number; rank: number } } | null {
  const m = /^([a-i])(\d)([a-i])(\d)$/.exec(s.trim());
  if (!m) return null;
  return {
    from: { file: m[1].charCodeAt(0) - 97, rank: parseInt(m[2], 10) },
    to: { file: m[3].charCodeAt(0) - 97, rank: parseInt(m[4], 10) },
  };
}
