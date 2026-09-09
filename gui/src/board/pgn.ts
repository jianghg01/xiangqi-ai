// PGN 导出/导入（中国象棋）
// 导出格式：国内主流的中文纵线记法 PGN，带 FEN / Event / Red / Black / Result 标签
// 导入：兼容两种着法格式
//   1) 中文纵线记法（炮二平五 / 马8进7 / 前炮退二）——通过「合法着法反推匹配」解析
//   2) ICCS 坐标（h7e7）——部分软件使用
// 解析失败的着法即截断，不抛异常。

import { BoardData, cloneBoard, initialBoard, parseFen } from './fen';
import { Move, Side, toIccs } from './types';
import { moveToChinese } from './notation';
import { legalMoves } from '../rules/rules';

export interface PgnMeta {
  startFen: string;
  redName: string;
  blackName: string;
  result: string;        // 中文描述，如 "绝杀，红方胜"；空串表示未结束
  moves: string[];       // 内部坐标 ICCS（rank 0=黑底线）
}

const CN_NUM = ['一', '二', '三', '四', '五', '六', '七', '八', '九'];
const AR_NUM = ['1', '2', '3', '4', '5', '6', '7', '8', '9'];

// ---------- 导出 ----------

function resultToPgnTag(result: string, redName: string, blackName: string): string {
  if (!result) return '*';
  if (result.includes('和')) return '1/2-1/2';
  if (redName && result.includes(redName)) return '1-0';
  if (blackName && result.includes(blackName)) return '0-1';
  if (result.includes('红')) return '1-0';
  if (result.includes('黑')) return '0-1';
  return '*';
}

/** 把对局记录转成 PGN 文本（中文纵线记法） */
export function exportPgn(meta: {
  startFen: string;
  redName: string;
  blackName: string;
  result: string;
  moves: string[];
  movesZh: string[];
  date?: string;
}): string {
  const isInitial = meta.startFen.trim().split(/\s+/)[0] ===
    'rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR';
  const tags: string[] = [
    `[Event "象棋 AI 对局"]`,
    `[Site "xiangqi-ai"]`,
    ...(meta.date ? [`[Date "${meta.date}"]`] : []),
    `[Red "${meta.redName}"]`,
    `[Black "${meta.blackName}"]`,
    `[Result "${resultToPgnTag(meta.result, meta.redName, meta.blackName)}"]`,
    ...(isInitial ? [] : [`[FEN "${meta.startFen}"]`]),
  ];
  const body: string[] = [];
  for (let i = 0; i < meta.movesZh.length; i++) {
    if (i % 2 === 0) body.push(`${i / 2 + 1}.`);
    body.push(meta.movesZh[i] || meta.moves[i]);
  }
  const resultTag = resultToPgnTag(meta.result, meta.redName, meta.blackName);
  return tags.join('\n') + '\n\n' + (body.join(' ') + ' ' + resultTag).trim() + '\n';
}

// ---------- 导入 ----------

// 中文记法着法 token（黑方常用阿拉伯数字，兼容汉字）
const ZH_MOVE_RE = /^[前后中]?[帅仕相马车炮兵将士象卒][一二三四五六七八九1234567890]?[平进退][一二三四五六七八九1234567890]?$/;
const ICCS_MOVE_RE = /^[a-i][0-9][a-i][0-9]$/;

/** 从 PGN 文本提取标签与着法 token（去掉回合编号/结果/注释） */
function tokenizePgn(text: string): { tags: Record<string, string>; tokens: string[] } {
  const tags: Record<string, string> = {};
  const movesPart = text.replace(/^\s*\[(\w+)\s+"([^"]*)"\]\s*$/gm, (_m, k, v) => {
    tags[k] = v;
    return '\n';
  });
  const tokens = movesPart
    .replace(/\{[^}]*\}/g, ' ')          // {} 注释
    .replace(/;[^\n]*/g, ' ')            // 行注释
    .split(/\s+/)
    .filter(t => t && !/^\d+\.+$/.test(t) && !/^(1-0|0-1|1\/2-1\/2|\*)$/.test(t));
  return { tags, tokens };
}

// 数字风格互换，生成备选写法（黑方 1↔一、红方同理，双向兼容）
function numVariants(t: string): string[] {
  const out = new Set<string>([t]);
  CN_NUM.forEach((cn, i) => {
    for (const v of [...out]) {
      if (v.includes(cn)) out.add(v.split(cn).join(AR_NUM[i]));
      if (v.includes(AR_NUM[i])) out.add(v.split(AR_NUM[i]).join(cn));
    }
  });
  // 棋子字互换（来源软件常混用：红士写作士、黑象写作相、卒兵将帅互串）
  const SWAPS: [string, string][] = [['士', '仕'], ['象', '相'], ['卒', '兵'], ['将', '帅']];
  for (const [a, b] of SWAPS) {
    for (const v of [...out]) {
      if (v.includes(a)) out.add(v.split(a).join(b));
      if (v.includes(b)) out.add(v.split(b).join(a));
    }
  }
  return [...out];
}

function matchToken(board: BoardData, side: Side, token: string): Move | null {
  const legal = legalMoves(board, side);
  if (ICCS_MOVE_RE.test(token)) {
    // ICCS 内部坐标直接匹配
    const hit = legal.find(mv => toIccs(mv) === token);
    return hit ?? null;
  }
  if (!ZH_MOVE_RE.test(token)) return null;
  const variants = new Set(numVariants(token));
  // 中文记法：枚举所有合法着法算记谱后比对
  for (const mv of legal) {
    const zh = moveToChinese(board, mv);
    if (variants.has(zh)) return mv;
  }
  return null;
}

/**
 * 解析 PGN 文本为着法序列（内部坐标 ICCS）。
 * 无 FEN 标签时按初始局面；着法不合法即截断。
 */
export function parsePgn(text: string): PgnMeta {
  const { tags, tokens } = tokenizePgn(text);
  let board: BoardData;
  try {
    board = tags.FEN ? parseFen(tags.FEN).board : initialBoard();
  } catch {
    board = initialBoard();
  }
  const startFen = tags.FEN && board ? tags.FEN : 'rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1';
  const parsed = parseMoveTokens(board, tokens);
  let result = '';
  const tag = tags.Result ?? '';
  if (tag === '1-0') result = '红方胜';
  else if (tag === '0-1') result = '黑方胜';
  else if (tag === '1/2-1/2') result = '和局';
  return {
    startFen,
    redName: tags.Red || '红方',
    blackName: tags.Black || '黑方',
    result,
    moves: parsed.moves,
  };
}

/**
 * 把中文纵线记法 / ICCS 混合 token 序列从指定起始局面解析为内部 ICCS 着法。
 * 首手默认红方；遇到不合法的 token 即停，failedAt 为该 token 下标（全部合法为 -1）。
 * 供古谱（名局欣赏）与 PGN 导入共用。
 */
export function parseMoveTokens(
  startBoard: BoardData,
  tokens: string[],
): { moves: string[]; failedAt: number } {
  const moves: string[] = [];
  const work = cloneBoard(startBoard);
  for (let i = 0; i < tokens.length; i++) {
    const side: Side = moves.length % 2 === 0 ? 'red' : 'black';
    const mv = matchToken(work, side, tokens[i]);
    if (!mv) return { moves, failedAt: i };
    moves.push(toIccs(mv));
    work.pieces[mv.to.rank][mv.to.file] = work.pieces[mv.from.rank][mv.from.file];
    work.pieces[mv.from.rank][mv.from.file] = null;
  }
  return { moves, failedAt: -1 };
}
