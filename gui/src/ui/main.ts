// M3/M4 主界面逻辑：对弈（人机）+ 摆子编辑 + 实时分析

import { BoardData, cloneBoard, emptyBoard, initialBoard, parseFen, toFen } from '../board/fen';
import { Move, PieceType, Side, Square, parseIccs, toIccs } from '../board/types';
import { moveToChinese, movesToChinese } from '../board/notation';
import { exportPgn, parsePgn } from '../board/pgn';
import { matchOpening } from '../board/openings';
import { CLASSICS, CLASSIC_CATEGORIES } from '../board/classics';
import { applyMove, checkStatus, isMaterialDraw, legalMovesFrom } from '../rules/rules';
import { UciClient, EngineInfo, toRedPersp, cpToWinrate, formatScore, engineMoveToLocal, enginePvToLocal } from '../uci/engine-client';
import { normalizeScore, lossList, marksFor, summarize, acplOf } from '../uci/review';
import { blunderProfile, pickBlunder } from '../uci/elo';
import { BoardView, Arrow } from './board-view';
import { findKing } from '../rules/rules';

// ---------- DOM ----------
const $ = (id: string) => document.getElementById(id) as HTMLElement;
const canvas = $('board') as HTMLCanvasElement;
const fenBox = $('fen') as HTMLTextAreaElement;
const statusEl = $('gameStatus') as HTMLDivElement;
const paletteEl = $('palette') as HTMLDivElement;
const analysisEl = $('analysis') as HTMLDivElement;
const curveEl = $('curve') as HTMLCanvasElement;
const engineState = $('engineState') as HTMLSpanElement;
const sideSelect = $('humanSide') as HTMLSelectElement;
const strengthSel = $('strength') as HTMLSelectElement;
const gameModeSel = $('gameMode') as HTMLSelectElement;
const pveRow = $('pveRow') as HTMLDivElement;
const eveRows = $('eveRows') as HTMLDivElement;
const redNameInput = $('redName') as HTMLInputElement;
const blackNameInput = $('blackName') as HTMLInputElement;
const redStrengthSel = $('redStrength') as HTMLSelectElement;
const blackStrengthSel = $('blackStrength') as HTMLSelectElement;
const timeLimitSel = $('timeLimit') as HTMLSelectElement;
const avoidDrawSel = $('avoidDraw') as HTMLSelectElement;
const useBookSel = $('useBook') as HTMLSelectElement;
const threadsSel = $('threadsSel') as HTMLSelectElement;
const hashSel = $('hashSel') as HTMLSelectElement;
const handicapSel = $('handicapSel') as HTMLSelectElement;
const clockModeSel = $('clockModeSel') as HTMLSelectElement;
const endBanner = $('endBanner') as HTMLDivElement;

// ---------- 对弈配置（避和/开局库/线程/哈希，localStorage 持久化） ----------
const CFG_KEY = 'xz_play_cfg';
const avoidDrawOn = () => avoidDrawSel.value === '1';
const useBookOn = () => useBookSel.value === '1';
function threadsValue(): number {
  return threadsSel.value === 'auto'
    ? Math.max(1, (navigator.hardwareConcurrency || 4) - 2)
    : Math.max(1, parseInt(threadsSel.value, 10) || 2);
}
function saveCfg() {
  try {
    localStorage.setItem(CFG_KEY, JSON.stringify({
      avoidDraw: avoidDrawSel.value, useBook: useBookSel.value,
      threads: threadsSel.value, hash: hashSel.value,
    }));
  } catch { /* 忽略存储失败 */ }
}
(function loadCfg() {
  try {
    const c = JSON.parse(localStorage.getItem(CFG_KEY) || '{}');
    if (c.avoidDraw === '0' || c.avoidDraw === '1') avoidDrawSel.value = c.avoidDraw;
    if (c.useBook === '0' || c.useBook === '1') useBookSel.value = c.useBook;
    if (['auto', '2', '4', '6', '8'].includes(c.threads)) threadsSel.value = c.threads;
    if (['128', '256', '512', '1024'].includes(c.hash)) hashSel.value = c.hash;
  } catch { /* 忽略读取失败 */ }
})();
[avoidDrawSel, useBookSel, threadsSel, hashSel].forEach(s => s.addEventListener('change', saveCfg));
threadsSel.addEventListener('change', () => { if (engineReady && !waitingFor) client.setOption('Threads', threadsValue()); });
hashSel.addEventListener('change', () => { if (engineReady && !waitingFor) client.setOption('Hash', parseInt(hashSel.value, 10)); });

// ---------- 终局横幅 ----------
function showEndBanner(text: string, draw = false) {
  endBanner.textContent = text;
  endBanner.classList.toggle('draw', draw);
  endBanner.classList.add('show');
}
function hideEndBanner() {
  endBanner.classList.remove('show');
}

// ---------- 状态 ----------
let mode: 'edit' | 'play' | 'replay' = 'edit';
let humanSide: Side = 'red';
let gameMode: 'pve' | 'eve' = 'pve';   // pve=人机 eve=机机对弈（强软对强软）
let gameOver = false;
let gameResult = '';                    // 对局结果描述（存入棋谱）
let startFen = '';                      // 本局起始 FEN（保存棋谱用）
let movesHistory: string[] = [];       // 当前对局 ICCS 着法（内部坐标）
let movesZhLive: string[] = [];        // 对应中文记谱（对弈实时显示）
let selected: Square | null = null;
let targets: Move[] = [];
let waitingFor: null | 'engine' | 'analysis' | 'review' = null;
let engineReady = false;
let analysisOn = false;
let cpHistory: number[] = [];          // 红方视角胜率曲线数据
let lastInfoMap = new Map<number, EngineInfo>();

// 强度分级 → 搜索深度（皮卡鱼新版无 Skill Level，用深度限强）
const ANALYSIS_DEPTH = 14;

const view = new BoardView(canvas, initialBoard());
view.setOnChange(() => { fenBox.value = view.getFen(); });

// ---------- UCI 客户端 ----------
const engineApi = window.engine;
const client = new UciClient(cmd => engineApi?.write(cmd));
if (engineApi) {
  engineApi.onLine((line: string) => {
    if (line.startsWith('ENGINE_')) {
      //引擎退出/出错：解除等待状态，避免界面卡死
      waitingFor = null;
      engineReady = false;
      engineState.textContent = line.startsWith('ENGINE_EXIT') ? `引擎已退出（${line.slice(12)}）` : '引擎错误';
      setStatus('引擎已停止，请重新启动引擎');
      return;
    }
    client.handleLine(line);
  });
}
client.onBestmove = bm => onBestmove(bm);
client.onInfo = info => onInfo(info);

function engineTurnNow(): boolean {
  if (mode !== 'play' || gameOver || !engineReady) return false;
  if (gameMode === 'eve') return true; // 机机对弈：两侧都是引擎
  return view.getBoard().sideToMove !== humanSide;
}

// ---------- 引擎搜索串行化 ----------
// UCI 引擎搜索中不能再收 position/go（会被忽略或错乱），必须先 stop 并等 bestmove 回来
let pendingAfterAnalysis: (() => void) | null = null;

function stopAnalysisThen(action: () => void) {
  if (waitingFor === 'analysis') {
    pendingAfterAnalysis = action;
    try { client.stop(); } catch { /* 引擎可能已退出 */ }
    return;
  }
  action();
}

// ---------- 音效（Web Audio 合成·天天象棋风格，无外部资源） ----------
// 默认关闭，手动打开；设置持久化到 localStorage
let soundOn = localStorage.getItem('xz_sound') === '1';
let audioCtx: AudioContext | null = null;

// 木子敲击"嗒"：低频正弦快速下滑（模拟棋子撞击木质棋盘的闷响）
function knockAt(t: number, f0: number, vol: number, dur: number) {
  const osc = audioCtx!.createOscillator();
  const gain = audioCtx!.createGain();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(f0, t);
  osc.frequency.exponentialRampToValueAtTime(f0 * 0.55, t + dur);
  gain.gain.setValueAtTime(vol, t);
  gain.gain.exponentialRampToValueAtTime(0.001, t + dur);
  osc.connect(gain).connect(audioCtx!.destination);
  osc.start(t);
  osc.stop(t + dur + 0.02);
}

// 落子瞬间的"沙"声：极短噪声过带通（模拟棋子与盘面的摩擦质感）
function clickNoiseAt(t: number, vol: number, dur = 0.03) {
  const ctx = audioCtx!;
  const len = Math.max(1, Math.floor(ctx.sampleRate * dur));
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = 2200;
  bp.Q.value = 1.2;
  const gain = ctx.createGain();
  gain.gain.value = vol;
  src.connect(bp).connect(gain).connect(ctx.destination);
  src.start(t);
}

function playSound(kind: 'move' | 'capture' | 'check') {
  if (!soundOn) return;
  try {
    audioCtx = audioCtx || new AudioContext();
    const t = audioCtx.currentTime + 0.01;
    if (kind === 'move') {
      // 落子：清脆一声"嗒"（噪声质感 + 木质闷响）
      clickNoiseAt(t, 0.8);
      knockAt(t, 210, 0.5, 0.09);
    } else if (kind === 'capture') {
      // 吃子：更重的"啪"（响亮噪声 + 低频重击 + 余震）
      clickNoiseAt(t, 1.0);
      knockAt(t, 170, 0.8, 0.12);
      knockAt(t + 0.06, 120, 0.5, 0.14);
    } else {
      // 将军：急促"哒哒—哒"三连警示
      knockAt(t, 320, 0.5, 0.10);
      knockAt(t + 0.12, 320, 0.5, 0.10);
      knockAt(t + 0.24, 430, 0.6, 0.14);
    }
  } catch { /* 音频不可用时静默 */ }
}

function refreshSoundBtn() {
  ($('btnSound') as HTMLButtonElement).textContent = soundOn ? '🔊音效:开' : '🔇音效:关';
}
refreshSoundBtn();

$('btnSound').addEventListener('click', () => {
  soundOn = !soundOn;
  try { localStorage.setItem('xz_sound', soundOn ? '1' : '0'); } catch { /* 忽略 */ }
  refreshSoundBtn();
});

// ---------- 分析提示箭头（推荐线画在棋盘上） ----------
function updateArrows() {
  if (!analysisOn || mode === 'replay' || mode === 'edit') {
    view.setArrows([]);
    return;
  }
  const arr: Arrow[] = [];
  for (const k of [1, 2, 3]) {
    const info = lastInfoMap.get(k);
    if (!info || !info.pv.length) continue;
    const mv = parseIccs(enginePvToLocal(info.pv)[0]);
    if (mv) arr.push({ from: mv.from, to: mv.to, rank: k - 1 });
  }
  view.setArrows(arr);
}

// ---------- AI 复盘点评（逐手评分标记 ◎/?!/?/?? + ACPL） ----------
const REVIEW_DEPTH = 12;                       // 点评搜索深度（速度与精度平衡）
const reviewReportEl = $('reviewReport') as HTMLDivElement;
let reviewing = false;
let reviewRec: GameRecord | null = null;       // 点评对象（当前对局或复盘棋谱）
let reviewIdx = 0;                             // 已完成评分的局面数（0..n）
let reviewScores: number[] = [];               // 每个局面的最优评分（行棋方视角，杀棋 9999-N）
let reviewMarks: (string | null)[] = [];       // 每手棋的标记
let reviewClickable = false;                   // 点评结束后列表是否可点击（复盘模式）

// 引擎评分 → 数值见 ../uci/review（normalizeScore）

// 局面 k（startFen + 前 k 手）的 FEN
function fenAt(startFen: string, moves: string[], k: number): string {
  let b: BoardData;
  try { b = parseFen(startFen).board; } catch { b = initialBoard(); }
  for (let i = 0; i < k; i++) {
    const mv = parseIccs(moves[i]);
    if (!mv) break;
    b = applyMove(b, mv);
  }
  return toFen(b);
}

function startReview() {
  if (reviewing) { cancelReview(); return; }
  if (!engineReady) { setStatus('AI点评需先启动引擎'); return; }
  if (waitingFor) { setStatus('引擎忙，请稍候再点评'); return; }
  // 点评对象：复盘中用棋谱，对弈中用当前对局
  if (replayRecord) {
    reviewRec = replayRecord;
    reviewClickable = true;
  } else if (mode === 'play' && movesHistory.length) {
    reviewRec = {
      app: 'xiangqi-ai', version: 2, date: '',
      startFen: startFen || view.getFen(),
      mode: gameMode,
      redName: sideName('red'),
      blackName: sideName('black'),
      moves: [...movesHistory],
      movesZh: [...movesZhLive],
      result: gameResult || (gameOver ? '对局结束' : ''),
    };
    reviewClickable = false;
  } else {
    setStatus('没有可点评的对局着法');
    return;
  }
  if (!reviewRec.moves.length) { setStatus('没有可点评的对局着法'); reviewRec = null; return; }
  reviewing = true;
  reviewIdx = 0;
  reviewScores = [];
  reviewMarks = [];
  reviewReportEl.textContent = 'AI点评中…';
  client.setOption('MultiPV', 1);
  reviewStep();
}

function cancelReview() {
  if (!reviewing) return;
  reviewing = false;
  if (waitingFor === 'review') {
    try { client.stop(); } catch { /* 引擎可能已退出 */ }
    waitingFor = null;
  }
  reviewReportEl.textContent = '已取消点评';
  setStatus('');
}

function reviewStep() {
  if (!reviewing || !reviewRec) return;
  if (!engineReady) { reviewing = false; setStatus('引擎已停止，点评中断'); return; }
  const n = reviewRec.moves.length;
  if (reviewIdx > n) { finishReview(); return; }
  setStatus(`AI点评中 ${reviewIdx}/${n}…`);
  waitingFor = 'review';
  client.position(fenAt(reviewRec.startFen, reviewRec.moves, reviewIdx));
  client.go({ depth: REVIEW_DEPTH });
}

function finishReview() {
  if (!reviewRec) return;
  const n = reviewRec.moves.length;
  // 行棋方（startFen 行棋方为第 0 手的行棋方）
  let startSide: Side = 'red';
  try { startSide = parseFen(reviewRec.startFen).board.sideToMove; } catch { /* 默认红 */ }
  const losses = lossList(reviewScores, n);
  reviewMarks = marksFor(losses, reviewScores);
  const acc = summarize(losses, reviewMarks, startSide);
  const fmt = (s: Side) => {
    const a = acc[s];
    if (!a.cnt) return '';
    const name = s === 'red' ? (reviewRec!.redName || '红') : (reviewRec!.blackName || '黑');
    return `${name} ACPL ${acplOf(a).toFixed(0)}（缓着${a.q1} 失误${a.q2} 大败${a.q3}）`;
  };
  reviewReportEl.textContent = [fmt('red'), fmt('black')].filter(Boolean).join(' · ') || '点评完成';
  const cur = reviewClickable ? replayIdx : n;
  renderMoveList(reviewRec.moves, reviewRec.movesZh ?? [], cur, reviewClickable, reviewMarks);
  reviewing = false;
  setStatus('点评完成');
  // 恢复 MultiPV（分析 3 / 避和 2 / 普通 1）
  client.setOption('MultiPV', analysisOn ? 3 : (avoidDrawOn() ? 2 : 1));
}

// ---------- 局面重复检测（三次重复判和，与 selfplay 同规则） ----------
let posSeen = new Map<string, number>();

function posKey(b: BoardData): string {
  return b.pieces.map(row => row.map(p => (p ? (p.side === 'red' ? p.type : p.type.toLowerCase()) : '.')).join('')).join('/')
    + ' ' + (b.sideToMove === 'red' ? 'w' : 'b');
}

// 从起始局面按着法序列重建重复计数（悔棋后调用）
function rebuildPosSeen(start: BoardData, seq: string[]) {
  const b = cloneBoard(start);
  posSeen = new Map();
  posSeen.set(posKey(b), 1);
  for (const s of seq) {
    const mv = parseIccs(s);
    if (!mv) break;
    b.pieces[mv.to.rank][mv.to.file] = b.pieces[mv.from.rank][mv.from.file];
    b.pieces[mv.from.rank][mv.from.file] = null;
    b.sideToMove = b.sideToMove === 'red' ? 'black' : 'red';
    const k = posKey(b);
    posSeen.set(k, (posSeen.get(k) || 0) + 1);
  }
}

// ---------- 对局用时统计 / 赛制计时 ----------
const clockEl = $('clock') as HTMLDivElement;
let turnStart: number | null = null;   // 当前手开始思考的时刻
let redMs = 0;
let blackMs = 0;
// 赛制（包干/加秒）：base=每方包干毫秒，inc=每步加秒毫秒；base=0 为不限时
let clockBaseMs = 0;
let clockIncMs = 0;
let redLeftMs = 0;
let blackLeftMs = 0;
let lastTick: number | null = null;

function fmtClock(ms: number): string {
  const s = Math.ceil(ms / 1000);
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

function applyClockMode() {
  const [b, i] = (clockModeSel.value || '0-0').split('-').map(Number);
  clockBaseMs = (b || 0) * 60 * 1000;
  clockIncMs = (i || 0) * 1000;
}

function onTimeout(loser: Side) {
  gameOver = true;
  turnStart = null;
  lastTick = null;
  recordGame(loser === 'red' ? 'black' : 'red');
  if (waitingFor) { try { client.stop(); } catch { /* 引擎可能已退出 */ } waitingFor = null; }
  if (gameMode === 'eve') {
    const winner = loser === 'red' ? (blackNameInput.value || '黑方') : (redNameInput.value || '红方');
    gameResult = `超时，${winner}胜`;
    setStatus(`超时！${winner}胜`);
    showEndBanner(`超时 · ${winner}胜`);
  } else {
    const humanLost = loser === humanSide;
    gameResult = humanLost ? '超时，引擎胜' : '超时，玩家胜';
    setStatus('超时！' + (humanLost ? '你输了' : '你赢了'));
    showEndBanner(humanLost ? '超时 · 引擎胜' : '超时 · 你赢了');
  }
}

setInterval(() => {
  if (mode !== 'play' || gameOver || turnStart === null) { lastTick = null; return; }
  const now = Date.now();
  const dt = lastTick === null ? 0 : now - lastTick;
  lastTick = now;
  const stm = view.getBoard().sideToMove;
  if (clockBaseMs > 0) {
    // 赛制倒计时
    if (stm === 'red') redLeftMs -= dt; else blackLeftMs -= dt;
    if (redLeftMs <= 0) { onTimeout('red'); return; }
    if (blackLeftMs <= 0) { onTimeout('black'); return; }
    clockEl.textContent = `剩余  红 ${fmtClock(Math.max(0, redLeftMs))} · 黑 ${fmtClock(Math.max(0, blackLeftMs))}`;
  } else {
    // 不限时：累计用时展示
    const cur = now - turnStart;
    const red = redMs + (stm === 'red' ? cur : 0);
    const black = blackMs + (stm === 'black' ? cur : 0);
    clockEl.textContent = `用时  红 ${fmtClock(red)} · 黑 ${fmtClock(black)}`;
  }
}, 200);

function resetClock() {
  applyClockMode();
  redMs = 0;
  blackMs = 0;
  redLeftMs = clockBaseMs;
  blackLeftMs = clockBaseMs;
  turnStart = Date.now();
  clockEl.textContent = clockBaseMs > 0
    ? `剩余  红 ${fmtClock(redLeftMs)} · 黑 ${fmtClock(blackLeftMs)}`
    : '用时  红 00:00 · 黑 00:00';
}

// ---------- 让子（引擎侧移除子力，人机模式） ----------
const HANDICAP_PLAN: Record<string, PieceType[]> = {
  '0': [],
  n1: ['N'],
  n2: ['N', 'N'],
  c1: ['C'],
  c2: ['C', 'C'],
  r1: ['R'],
  rnc: ['R', 'N', 'C'],
};

// 本局起始局面：让子时从初始局面移除引擎侧指定子力（每类按边线→中线优先）
function startBoardForGame(): BoardData {
  const plan = HANDICAP_PLAN[handicapSel.value] || [];
  const b = initialBoard();
  if (!plan.length || gameMode !== 'pve') return b;
  const engineSide: Side = humanSide === 'red' ? 'black' : 'red';
  const fileOrder = [0, 8, 1, 7, 2, 6, 3, 5, 4];
  for (const type of plan) {
    for (const f of fileOrder) {
      let removed = false;
      for (let r = 0; r < 10 && !removed; r++) {
        const p = b.pieces[r][f];
        if (p && p.side === engineSide && p.type === type) {
          b.pieces[r][f] = null;
          removed = true;
        }
      }
      if (removed) break;
    }
  }
  return b;
}

// ---------- 对弈流程 ----------
function newGame() {
  const startAction = () => {
    if (engineTurnNow()) engineMove();
  };
  if (waitingFor === 'analysis') {
    // 分析中：停掉搜索，等 bestmove 回来再开新局引擎行棋
    stopAnalysisThen(startAction);
  } else {
    startAction();
  }
  const startBoard = startBoardForGame();
  view.replaceBoard(startBoard);
  movesHistory = [];
  movesZhLive = [];
  gameOver = false;
  gameResult = '';
  hideEndBanner();
  selected = null;
  targets = [];
  cpHistory = [];
  lastInfoMap.clear();
  view.setArrows([]);
  reviewMarks = [];
  reviewReportEl.textContent = '';
  drawCurve();
  analysisEl.textContent = '—';
  waitingFor = null;
  view.setLastMove(null, null);
  setStatus('');
  fenBox.value = view.getFen();
  startFen = view.getFen();
  rebuildPosSeen(view.getBoard(), []);
  resetClock();
  renderMoveList(movesHistory, movesZhLive, 0, false);
  updateOpeningName();
}

function doMove(mv: Move) {
  const board = view.getBoard();
  const captured = !!board.pieces[mv.to.rank][mv.to.file];
  // 累计走子方本手思考用时；加秒制补时
  if (turnStart !== null) {
    const elapsed = Date.now() - turnStart;
    if (board.sideToMove === 'red') { redMs += elapsed; redLeftMs += clockIncMs; }
    else { blackMs += elapsed; blackLeftMs += clockIncMs; }
    turnStart = Date.now();
  }
  // 局面变化，旧的推荐箭头作废（分析更新后重画）
  view.setArrows([]);
  const nb = applyMove(board, mv);
  movesHistory.push(toIccs(mv));
  playSound(captured ? 'capture' : 'move');
  if (mode === 'play') {
    movesZhLive.push(moveToChinese(board, mv));
    renderMoveList(movesHistory, movesZhLive, movesHistory.length, false);
    updateOpeningName();
  }
  // 重复局面计数
  const k = posKey(nb);
  posSeen.set(k, (posSeen.get(k) || 0) + 1);
  selected = null;
  targets = [];
  view.clearOverlay();
  view.animateMove(mv.from, mv.to, () => {
    view.setLastMove(mv.from, mv.to);
    view.replaceBoard(nb);
    afterMove();
  });
}

function afterMove() {
  const board = view.getBoard();
  const st = checkStatus(board);
  // 将军标记：高亮被将方的将/帅
  view.setCheck(st.status === 'check' || st.status === 'checkmate' ? findKing(board, board.sideToMove) : null);
  if (st.status === 'checkmate') {
    gameOver = true;
    recordGame(board.sideToMove === 'red' ? 'black' : 'red');
    if (gameMode === 'eve') {
      const winner = board.sideToMove === 'red' ? (blackNameInput.value || '黑方') : (redNameInput.value || '红方');
      gameResult = `绝杀，${winner}胜`;
      setStatus(`绝杀！${winner}胜`);
      showEndBanner(`绝杀 · ${winner}胜`);
    } else {
      gameResult = board.sideToMove === humanSide ? '绝杀，引擎胜' : '绝杀，玩家胜';
      setStatus('绝杀！' + (board.sideToMove === humanSide ? '你输了' : '你赢了'));
      showEndBanner(board.sideToMove === humanSide ? '绝杀 · 引擎胜' : '绝杀 · 你赢了');
    }
    return;
  }
  if (st.status === 'stalemate') {
    gameOver = true;
    recordGame(board.sideToMove === 'red' ? 'black' : 'red');
    if (gameMode === 'eve') {
      const winner = board.sideToMove === 'red' ? (blackNameInput.value || '黑方') : (redNameInput.value || '红方');
      gameResult = `困毙，${winner}胜`;
      setStatus(`困毙！${winner}胜`);
      showEndBanner(`困毙 · ${winner}胜`);
    } else {
      gameResult = board.sideToMove === humanSide ? '困毙，引擎胜' : '困毙，玩家胜';
      setStatus('困毙！' + (board.sideToMove === humanSide ? '你输了' : '你赢了'));
      showEndBanner(board.sideToMove === humanSide ? '困毙 · 引擎胜' : '困毙 · 你赢了');
    }
    return;
  }
  if (isMaterialDraw(board)) {
    gameOver = true;
    recordGame('draw');
    gameResult = '双方无进攻子力，判和';
    setStatus('双方均无进攻子力（只剩士象将帅），和棋');
    showEndBanner('双方无进攻子力 · 和棋', true);
    return;
  }
  if ((posSeen.get(posKey(board)) || 0) >= 3) {
    gameOver = true;
    recordGame('draw');
    gameResult = '三次重复局面，判和';
    setStatus('双方三次重复局面，和棋');
    showEndBanner('三次重复局面 · 和棋', true);
    return;
  }
  if (st.status === 'check') {
    setStatus('将军！');
    playSound('check');
  } else setStatus('');
  if (engineTurnNow()) engineMove();
  else if (analysisOn && !waitingFor) analyze();
}

// ---------- 开局库（机机对弈开局秒走 + 开局名称显示） ----------
const INITIAL_FEN_PART = 'rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR';
const openingNameEl = $('openingName') as HTMLDivElement;

function updateOpeningName() {
  if (mode !== 'play' || !movesHistory.length || startFen.split(' ')[0] !== INITIAL_FEN_PART) {
    openingNameEl.textContent = '';
    return;
  }
  const m = matchOpening(movesHistory);
  openingNameEl.textContent = m ? `开局：${m.name}` : '';
}

function engineMove() {
  if (!engineReady) return;
  if (waitingFor === 'analysis') {
    // 分析搜索中：先停，等 bestmove 回来再走子（避免搜索中发 go 被引擎忽略导致卡死）
    stopAnalysisThen(() => engineMove());
    return;
  }
  // 开局库直接落子（从初始局面开始且未偏离开局序列时；人机/机机均可用，受配置开关控制）
  if (useBookOn() && startFen.split(' ')[0] === INITIAL_FEN_PART) {
    const m = matchOpening(movesHistory);
    if (m && m.next) {
      const bookMv = parseIccs(m.next);
      if (bookMv) {
        const mover = gameMode === 'eve'
          ? (view.getBoard().sideToMove === 'red' ? redNameInput.value : blackNameInput.value)
          : '引擎';
        setStatus(`${mover}（开局库·${m.name}）`);
        doMove(bookMv);
        return;
      }
    }
  }
  waitingFor = 'engine';
  // 避和求胜（需 2 线）与低强度扰动（需 3 线）共用 MultiPV；都不需要时单线全速
  client.setOption('MultiPV', avoidDrawOn() || blunderProfile(getDepth()) !== null ? 3 : 1);
  // 注意：只发当前 FEN，不再叠加 moves（FEN 已是最新位置，叠加会触发引擎严格校验崩溃）
  client.position(view.getFen());
  const limit = parseInt(timeLimitSel.value, 10) || 0;
  if (limit > 0) {
    client.go({ movetime: limit });                 // 时限模式：每步固定思考时间
  } else {
    client.go({ depth: getDepth() });               // 深度模式：按当前行棋方强度
  }
  const mover = gameMode === 'eve' ? (view.getBoard().sideToMove === 'red' ? redNameInput.value : blackNameInput.value) : '引擎';
  setStatus(`${mover}思考中…`);
}

function analyze() {
  if (!engineReady || gameOver) return;
  waitingFor = 'analysis';
  // 分析固定 MultiPV 3（多线参考；引擎空闲时设置才生效，此处必然空闲）
  client.setOption('MultiPV', 3);
  lastInfoMap.clear();
  client.position(view.getFen());
  client.go({ depth: ANALYSIS_DEPTH });
}

// 该着法走完后是否立即形成和棋（三次重复 / 双方无进攻子力）
function wouldEndInDraw(mv: Move): boolean {
  try {
    const nb = applyMove(view.getBoard(), mv);
    if (isMaterialDraw(nb)) return true;
    const k = posKey(nb);
    return (posSeen.get(k) || 0) + 1 >= 3;
  } catch { return false; }
}

function onBestmove(bm: string) {
  if (waitingFor === 'engine') {
    waitingFor = null;
    const raw = parseIccs(bm);
    if (!raw) { setStatus('引擎着法解析失败: ' + bm); return; }
    // 引擎 ICCS 坐标（rank 0=红底线）转内部坐标（rank 0=黑底线）
    let mv = engineMoveToLocal(raw);
    // ELO 扰动：低强度档概率性改走容差内的次优着法（模拟分段棋力）
    const prof = blunderProfile(getDepth());
    if (prof) {
      const bestCp = lastInfoMap.get(1)?.scoreCp ?? null;
      const cands: { mv: Move; cp: number }[] = [];
      for (const k of [1, 2, 3]) {
        const i = lastInfoMap.get(k);
        const imv = i && i.pv.length ? parseIccs(enginePvToLocal(i.pv)[0]) : null;
        if (i && imv && i.scoreCp !== null) cands.push({ mv: engineMoveToLocal(imv), cp: i.scoreCp });
      }
      const pick = pickBlunder(cands, bestCp, prof.margin, Math.random());
      if (pick) mv = pick.mv;
    }
    // 避和求胜：最佳着法将立即成和、且引擎不处败势时，改走评分可接受的替代着法
    if (avoidDrawOn() && wouldEndInDraw(mv)) {
      const best = lastInfoMap.get(1);
      const alt = lastInfoMap.get(2);
      const altMv = alt && alt.pv.length ? parseIccs(alt.pv[0]) : null;
      // 引擎当前不落后超过 1 兵，且替代着法不落后超过 3 兵，才值得换着求胜
      if (altMv && (best?.scoreCp ?? 0) > -100 && (alt?.scoreCp ?? -999) > -300) {
        mv = engineMoveToLocal(altMv);
        setStatus('避和求胜：改走替代着法');
      }
    }
    // 记录引擎思考分数进胜率曲线
    const best = lastInfoMap.get(1);
    if (best && best.scoreCp !== null) pushCp(best.scoreCp);
    doMove(mv);
  } else if (waitingFor === 'analysis') {
    waitingFor = null;
    const best = lastInfoMap.get(1);
    if (best && best.scoreCp !== null) pushCp(best.scoreCp);
    setStatus(statusTextFor());
    // 停分析后的挂起动作（如引擎接着行棋）
    const action = pendingAfterAnalysis;
    pendingAfterAnalysis = null;
    if (action) action();
  } else if (waitingFor === 'review') {
    waitingFor = null;
    const info = lastInfoMap.get(1);
    reviewScores.push(normalizeScore(info?.scoreCp ?? null, info?.scoreMate ?? null));
    reviewIdx++;
    reviewStep();
  }
}

function onInfo(info: EngineInfo) {
  if (!info.pv.length) return;
  lastInfoMap.set(info.multipv, info);
  renderAnalysis();
  updateArrows();
}

// ---------- 分析面板 ----------
function renderAnalysis() {
  const board = view.getBoard();
  const rows: string[] = [];
  const keys = [...lastInfoMap.keys()].sort((a, b) => a - b);
  for (const k of keys) {
    const i = lastInfoMap.get(k)!;
    const red = toRedPersp(i.scoreCp ?? 0, board.sideToMove);
    const mate = i.scoreMate !== null ? `杀#${i.scoreMate}` : formatScore(red, null);
    const wr = cpToWinrate(red).toFixed(0);
    rows.push(`#${k} ${mate} 胜率${wr}% ${enginePvToLocal(i.pv).slice(0, 4).join(' ')}`);
  }
  analysisEl.innerHTML = rows
    .map((r, idx) => idx === 0 ? `<span class="top">${r}</span>` : r)
    .join('\n');
}

function pushCp(cpMoveSide: number) {
  const red = toRedPersp(cpMoveSide, view.getBoard().sideToMove);
  cpHistory.push(red);
  drawCurve();
}

function drawCurve() {
  const c = curveEl.getContext('2d');
  if (!c) return;
  const W = curveEl.width, H = curveEl.height;
  c.clearRect(0, 0, W, H);
  c.strokeStyle = '#555';
  c.beginPath(); c.moveTo(0, H / 2); c.lineTo(W, H / 2); c.stroke();
  if (cpHistory.length < 2) return;
  c.strokeStyle = '#9fe1cb';
  c.lineWidth = 1.5;
  c.beginPath();
  cpHistory.forEach((cp, i) => {
    const x = (i / (cpHistory.length - 1)) * (W - 8) + 4;
    const wr = cpToWinrate(cp) / 100;
    const y = H - wr * H;
    if (i === 0) c.moveTo(x, y); else c.lineTo(x, y);
  });
  c.stroke();
  c.lineWidth = 1;
}

// ---------- 棋盘点击（对弈模式） ----------
view.onSquare = (s: Square) => {
  if (mode !== 'play' || gameOver || waitingFor || reviewing) return;
  if (gameMode === 'eve') return; // 机机对弈：人不落子
  const board = view.getBoard();
  if (board.sideToMove !== humanSide) return; // 引擎回合
  const p = board.pieces[s.rank][s.file];
  if (selected) {
    const hit = targets.find(m => m.to.file === s.file && m.to.rank === s.rank);
    if (hit) { doMove(hit); return; }
  }
  if (p && p.side === humanSide) {
    selected = s;
    targets = legalMovesFrom(board, s);
    view.setHighlights(targets.map(m => m.to));
  } else {
    selected = null;
    targets = [];
    view.setHighlights([]);
  }
};

// ---------- 模式切换 / 控件 ----------
function setStatus(t: string) {
  const base = statusTextFor();
  statusEl.textContent = t ? `${base} · ${t}` : base;
}
function statusTextFor(): string {
  if (mode === 'replay') return '复盘模式';
  if (mode === 'edit') return '编辑模式';
  const turn = view.getBoard().sideToMove === 'red' ? '红方' : '黑方';
  if (gameMode === 'eve') {
    const red = redNameInput.value || '红方引擎';
    const black = blackNameInput.value || '黑方引擎';
    if (gameOver) {
      const winner = view.getBoard().sideToMove === 'red' ? black : red;
      return `${red} vs ${black} · ${winner}胜`;
    }
    return `${red} vs ${black} · ${turn}行棋`;
  }
  if (gameOver) return '对局结束';
  const who = turn === (humanSide === 'red' ? '红方' : '黑方') ? '你' : '引擎';
  return `对弈中 · ${turn}行棋（${who}）`;
}

$('btnMode').addEventListener('click', () => {
  if (mode === 'replay') return; // 复盘中：先退出复盘再切换模式
  if (reviewing) cancelReview();
  if (mode === 'edit') {
    mode = 'play';
    ($('btnMode') as HTMLButtonElement).textContent = '返回编辑';
    ($('editPanel') as HTMLDivElement).style.opacity = '.4';
    gameMode = gameModeSel.value as 'pve' | 'eve';
    humanSide = sideSelect.value as Side;
    gameOver = false;
    gameResult = '';
    movesHistory = [];
    movesZhLive = [];
    startFen = view.getFen();          // 记住起始局面（保存棋谱用）
    view.setFlipped(gameMode === 'pve' && humanSide === 'black'); // 人执黑：翻转棋盘
    resetClock();
    moveListEl.style.display = 'block';
    reviewRow.style.display = 'flex';
    renderMoveList(movesHistory, movesZhLive, 0, false);
    updateOpeningName();
    setStatus('');
  } else {
    mode = 'edit';
    ($('btnMode') as HTMLButtonElement).textContent = '进入对弈';
    ($('editPanel') as HTMLDivElement).style.opacity = '1';
    view.onSquare = null;
    if (waitingFor === 'analysis') stopAnalysisThen(() => {}); // 停掉残留搜索
    waitingFor = null;
    turnStart = null; // 停止计时
    hideEndBanner();
    moveListEl.style.display = 'none';
    moveListEl.innerHTML = '';
    reviewRow.style.display = 'none';
    reviewReportEl.textContent = '';
    reviewMarks = [];
    setStatus('');
  }
});

$('btnNew').addEventListener('click', () => { if (mode === 'play') newGame(); });

$('btnUndo').addEventListener('click', () => {
  // 悔棋：撤销人机各一步（简化：回退到人类行棋局面）；机机对弈不支持悔棋
  if (mode !== 'play' || gameMode === 'eve' || movesHistory.length === 0 || waitingFor || reviewing) return;
  const undoCount = view.getBoard().sideToMove === humanSide ? 2 : 1;
  for (let i = 0; i < Math.min(undoCount, movesHistory.length); i++) {
    movesHistory.pop();
    movesZhLive.pop();
  }
  // 从起始局面重放
  let nb;
  try { nb = parseFen(startFen).board; } catch { nb = initialBoard(); }
  for (const iccs of movesHistory) {
    const mv = parseIccs(iccs);
    if (mv) nb = applyMove(nb, mv);
  }
  gameOver = false;
  gameResult = '';
  hideEndBanner();
  view.replaceBoard(nb);
  selected = null; targets = [];
  rebuildPosSeen(nb, movesHistory);
  reviewMarks = [];
  reviewReportEl.textContent = '';
  renderMoveList(movesHistory, movesZhLive, movesHistory.length, false);
  setStatus('');
  if (engineTurnNow()) engineMove();
  else if (analysisOn) analyze();
});

$('btnStartEngine').addEventListener('click', async () => {
  if (!engineApi) { engineState.textContent = '浏览器模式不支持引擎（需 Electron）'; return; }
  try {
    await engineApi.start(($('enginePath') as HTMLInputElement).value.trim());
    client.uci();
    // 引擎参数按配置面板应用：线程（自动 = 核心数-2）、哈希（MB）
    const threads = threadsValue();
    client.setOption('Threads', threads);
    client.setOption('Hash', parseInt(hashSel.value, 10) || 512);
    client.isready();
    engineReady = true;
    engineState.textContent = `已启动（${threads} 线程 · 哈希 ${hashSel.value}MB）`;
    setStatus('');
    if (engineTurnNow()) engineMove();
    else if (analysisOn) analyze();
  } catch (err) {
    engineState.textContent = '启动失败: ' + (err as Error).message;
  }
});

$('btnAnalysis').addEventListener('click', () => {
  analysisOn = !analysisOn;
  ($('btnAnalysis') as HTMLButtonElement).textContent = analysisOn ? '关闭分析' : '开启分析';
  if (!analysisOn) view.setArrows([]); // 关分析清掉推荐箭头
  // 分析用 MultiPV 3（多线参考）；对弈避和开启时用 2，关闭时 1（单线全速）
  if (engineReady) client.setOption('MultiPV', analysisOn ? 3 : (avoidDrawOn() ? 2 : 1));
  if (analysisOn && !waitingFor && mode === 'play' && gameMode === 'pve' && !gameOver) analyze();
});

function getDepth(): number {
  // 机机对弈：按行棋方各自的强度档；人机：用全局强度档
  const side = view.getBoard().sideToMove;
  const sel = gameMode === 'eve' ? (side === 'red' ? redStrengthSel : blackStrengthSel) : strengthSel;
  return Math.max(1, Math.min(40, parseInt(sel.value, 10) || 24));
}

sideSelect.addEventListener('change', () => {
  humanSide = sideSelect.value as Side;
  // 人执黑时翻转棋盘（随时预览）
  view.setFlipped(gameMode === 'pve' && humanSide === 'black');
  if (mode === 'play' && gameMode === 'pve' && !gameOver) newGame();
});

gameModeSel.addEventListener('change', () => {
  gameMode = gameModeSel.value as 'pve' | 'eve';
  // 切换模式时显示对应配置行
  pveRow.style.display = gameMode === 'pve' ? 'flex' : 'none';
  eveRows.style.display = gameMode === 'eve' ? 'block' : 'none';
  if (gameMode === 'eve') view.setFlipped(false); // 机机对弈固定红下视角
  if (mode === 'play' && !gameOver) newGame();
  else setStatus('');
});

redStrengthSel.addEventListener('change', () => { if (mode === 'play' && gameMode === 'eve' && !waitingFor) newGame(); });
blackStrengthSel.addEventListener('change', () => { if (mode === 'play' && gameMode === 'eve' && !waitingFor) newGame(); });
timeLimitSel.addEventListener('change', () => { if (mode === 'play' && gameMode === 'eve' && !waitingFor) newGame(); });
handicapSel.addEventListener('change', () => { if (mode === 'play' && gameMode === 'pve' && !waitingFor && !gameOver) newGame(); });
clockModeSel.addEventListener('change', () => {
  applyClockMode();
  redLeftMs = clockBaseMs;
  blackLeftMs = clockBaseMs;
  if (mode === 'play') setStatus(clockBaseMs > 0 ? '赛制已更新，双方重新计时' : '已切换为不限时');
});

// ---------- 编辑面板（编辑模式专用） ----------
const red: PieceType[] = ['K', 'A', 'B', 'N', 'R', 'C', 'P'];
const black: PieceType[] = ['K', 'A', 'B', 'N', 'R', 'C', 'P'];
const CHAR: Record<Side, Record<PieceType, string>> = {
  red: { K: '帅', A: '仕', B: '相', N: '马', R: '车', C: '炮', P: '兵' },
  black: { K: '将', A: '士', B: '象', N: '马', R: '车', C: '炮', P: '卒' },
};
const cells: HTMLDivElement[] = [];
function makeCell(side: Side, type: PieceType | null, label: string) {
  const el = document.createElement('div');
  el.className = 'pcell ' + (type ? side : 'del');
  el.textContent = label;
  el.addEventListener('click', () => {
    cells.forEach(c2 => c2.classList.remove('active'));
    el.classList.add('active');
    view.setPalette(type, side);
  });
  paletteEl.appendChild(el);
  cells.push(el);
}
red.forEach(t => makeCell('red', t, CHAR.red[t]));
black.forEach(t => makeCell('black', t, CHAR.black[t]));
makeCell('red', null, '✕');

$('btnApply').addEventListener('click', () => {
  try {
    const { board } = parseFen(fenBox.value);
    view.replaceBoard(board);
  } catch (err) {
    setStatus('FEN 无效: ' + (err as Error).message);
  }
});
$('btnInitial').addEventListener('click', () => view.replaceBoard(initialBoard()));
$('btnClear').addEventListener('click', () => view.replaceBoard(emptyBoard()));

fenBox.value = view.getFen();

// ---------- 棋谱保存 / 复盘（F3） ----------
interface GameRecord {
  app: string;
  version: number;
  date: string;
  startFen: string;
  mode: string;
  redName: string;
  blackName: string;
  moves: string[];      // ICCS 着法（内部坐标，rank 0=黑底线）
  movesZh?: string[];   // 对应中文记谱（v2 起保存）
  result: string;
}

const replayRow = $('replayRow') as HTMLDivElement;
const replayLabel = $('replayLabel') as HTMLDivElement;
const moveListEl = $('moveList') as HTMLDivElement;
let replayRecord: GameRecord | null = null;
let replayIdx = 0;                       // 当前回放到第几步（0=起始局面）
let replayTimer: number | null = null;
let replayMovesZh: string[] = [];        // 每步中文记谱

function sideName(side: Side): string {
  if (gameMode === 'eve') return side === 'red' ? (redNameInput.value || '红方引擎') : (blackNameInput.value || '黑方引擎');
  return side === humanSide ? '玩家' : '引擎';
}

function replayStartBoard(rec: GameRecord) {
  try {
    return parseFen(rec.startFen).board;
  } catch {
    return initialBoard();
  }
}

function updateReplayLabel() {
  if (!replayRecord) { replayLabel.textContent = ''; return; }
  const n = replayRecord.moves.length;
  const parts = [
    `第 ${replayIdx}/${n} 步`,
    replayIdx > 0 ? (replayMovesZh[replayIdx - 1] || replayRecord.moves[replayIdx - 1]) : '起始局面',
    `${replayRecord.redName} vs ${replayRecord.blackName}`,
  ];
  if (replayRecord.result) parts.push(replayRecord.result);
  replayLabel.textContent = parts.join(' · ');
}

// 渲染中文记谱列表（复盘模式可点击跳转，对弈模式仅展示），当前步高亮并自动滚动
// marks：AI点评标记（与 moves 对齐，可为 null）
function renderMoveList(moves: string[], zh: string[], curIdx: number, clickable: boolean, marks?: (string | null)[]) {
  const n = moves.length;
  const parts: string[] = [];
  const mkHtml = (i: number) => {
    const m = marks?.[i];
    if (!m) return '';
    const cls = m === '?!' ? 'mk-m1' : m === '?' ? 'mk-m2' : m === '??' ? 'mk-m3' : 'mk-m0';
    return `<span class="mk ${cls}">${m === '?!' || m === '?' || m === '??' ? m : '◎'}</span>`;
  };
  for (let i = 0; i < n; i++) {
    const cls = i + 1 === curIdx ? 'cur' : '';
    const text = zh[i] || moves[i];
    if (i % 2 === 0) parts.push(`<span data-mv="${i + 1}" class="${cls}"><span class="no">${i / 2 + 1}.</span>${text}${mkHtml(i)}</span>`);
    else parts.push(`<span data-mv="${i + 1}" class="${cls}">${text}${mkHtml(i)}</span>`);
    if (i % 2 === 1) parts.push('\n');
  }
  moveListEl.innerHTML = parts.join('');
  if (clickable) {
    moveListEl.querySelectorAll<HTMLSpanElement>('span[data-mv]').forEach(el => {
      el.addEventListener('click', () => repGoTo(parseInt(el.dataset.mv ?? '0', 10)));
    });
  }
  // 只滚动列表自身（scrollIntoView 会连带滚动页面窗口，导致整体窗口被拉动）
  const cur = moveListEl.querySelector('span.cur') as HTMLElement | null;
  if (cur) {
    const target = cur.offsetTop - moveListEl.clientHeight / 2 + cur.offsetHeight / 2;
    moveListEl.scrollTop = Math.max(0, target);
  }
}

// 保存当前对局
$('btnSaveGame').addEventListener('click', async () => {
  if (mode !== 'play' || !movesHistory.length) { setStatus('当前没有可保存的对局着法'); return; }
  if (!engineApi) { setStatus('浏览器模式不支持保存（需 Electron）'); return; }
  let startBoard;
  try { startBoard = parseFen(startFen).board; } catch { startBoard = initialBoard(); }
  const rec: GameRecord = {
    app: 'xiangqi-ai',
    version: 2,
    date: new Date().toISOString(),
    startFen: startFen || view.getFen(),
    mode: gameMode,
    redName: sideName('red'),
    blackName: sideName('black'),
    moves: [...movesHistory],
    movesZh: movesToChinese(startBoard, movesHistory),
    result: gameResult || (gameOver ? '对局结束' : '对局未结束'),
  };
  const ts = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '');
  try {
    const savedPath = await engineApi.saveText(`棋谱_${ts}.json`, JSON.stringify(rec, null, 2));
    setStatus(savedPath ? '棋谱已保存' : '已取消保存');
  } catch (err) {
    setStatus('保存失败: ' + (err as Error).message);
  }
});

// 棋谱文本（JSON/PGN）→ 复盘
function loadRecordFromText(content: string): boolean {
  try {
    const isPgn = content.trimStart().startsWith('[');
    if (isPgn) {
      const meta = parsePgn(content);
      if (!meta.moves.length) { setStatus('PGN 中未解析出有效着法'); return false; }
      enterReplay({
        app: 'xiangqi-ai', version: 2, date: '',
        startFen: meta.startFen,
        mode: 'import',
        redName: meta.redName, blackName: meta.blackName,
        moves: meta.moves,
        result: meta.result || '对局结束',
      });
      return true;
    }
    const rec = JSON.parse(content) as GameRecord;
    if (!rec || !Array.isArray(rec.moves) || rec.moves.some(m => typeof m !== 'string')) {
      setStatus('棋谱文件格式无效');
      return false;
    }
    enterReplay(rec);
    return true;
  } catch {
    setStatus('棋谱文件解析失败');
    return false;
  }
}

// 打开棋谱 → 进入复盘（JSON 用自带数据；PGN 用中文/ICCS 记法反推解析）
$('btnLoadGame').addEventListener('click', async () => {
  if (!engineApi) { setStatus('浏览器模式不支持打开棋谱（需 Electron）'); return; }
  const r = await engineApi.openText();
  if (!r) return;
  loadRecordFromText(r.content);
});

// 导出棋盘局面 PNG 图片
$('btnSnap').addEventListener('click', async () => {
  if (!engineApi) { setStatus('浏览器模式不支持导出（需 Electron）'); return; }
  try {
    const dataUrl = canvas.toDataURL('image/png');
    const ts = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '');
    const savedPath = await engineApi.saveImage(`局面_${ts}.png`, dataUrl);
    setStatus(savedPath ? '局面图片已导出' : '已取消导出');
  } catch (err) {
    setStatus('导出失败: ' + (err as Error).message);
  }
});

// 导出 PGN（中文纵线记法，鲨鱼象棋等第三方软件可读）
$('btnSavePgn').addEventListener('click', async () => {
  if (mode !== 'play' || !movesHistory.length) { setStatus('当前没有可导出的对局着法'); return; }
  if (!engineApi) { setStatus('浏览器模式不支持导出（需 Electron）'); return; }
  let startBoard;
  try { startBoard = parseFen(startFen).board; } catch { startBoard = initialBoard(); }
  const movesZh = movesToChinese(startBoard, movesHistory);
  const pgn = exportPgn({
    startFen: startFen || view.getFen(),
    redName: sideName('red'),
    blackName: sideName('black'),
    result: gameResult || (gameOver ? '对局结束' : ''),
    moves: [...movesHistory],
    movesZh,
    date: new Date().toISOString().slice(0, 10).replace(/-/g, '.'),
  });
  const ts = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '');
  try {
    const savedPath = await engineApi.saveText(`对局_${ts}.pgn`, pgn, 'pgn');
    setStatus(savedPath ? 'PGN 已导出' : '已取消导出');
  } catch (err) {
    setStatus('导出失败: ' + (err as Error).message);
  }
});

// ---------- 战绩统计（localStorage，上限 500 条） ----------
interface StatRecord {
  mode: string;
  humanSide: Side | null;
  winner: Side | 'draw';
  strength: string | null;
}
const REC_KEY = 'xz_records';
const statsReportEl = $('statsReport') as HTMLDivElement;

function recordGame(winner: Side | 'draw') {
  if (!movesHistory.length) return;
  try {
    const arr = JSON.parse(localStorage.getItem(REC_KEY) || '[]') as StatRecord[];
    arr.push({
      mode: gameMode,
      humanSide: gameMode === 'pve' ? humanSide : null,
      winner,
      strength: gameMode === 'pve' ? strengthSel.value : null,
    });
    while (arr.length > 500) arr.shift();
    localStorage.setItem(REC_KEY, JSON.stringify(arr));
  } catch { /* 忽略 */ }
}

function renderStats() {
  let arr: StatRecord[] = [];
  try { arr = JSON.parse(localStorage.getItem(REC_KEY) || '[]') as StatRecord[]; } catch { /* 忽略 */ }
  if (!arr.length) { statsReportEl.textContent = '暂无战绩'; return; }
  const pve = arr.filter(r => r.mode === 'pve');
  const eve = arr.filter(r => r.mode === 'eve');
  const lines: string[] = [`共 ${arr.length} 局（人机 ${pve.length} · 机机 ${eve.length}）`];
  if (pve.length) {
    const win = pve.filter(r => r.winner === r.humanSide).length;
    const draw = pve.filter(r => r.winner === 'draw').length;
    const loss = pve.length - win - draw;
    lines.push(`人机对弈：胜 ${win} · 和 ${draw} · 负 ${loss}（胜率 ${((win / pve.length) * 100).toFixed(0)}%）`);
    // 按强度档统计（胜/局）
    const byStrength = new Map<string, { w: number; n: number }>();
    for (const r of pve) {
      const k = String(r.strength ?? '?');
      const s = byStrength.get(k) || { w: 0, n: 0 };
      s.n++;
      if (r.winner === r.humanSide) s.w++;
      byStrength.set(k, s);
    }
    const order = ['1', '2', '3', '5', '8', '12', '18', '24'];
    const parts = order.filter(k => byStrength.has(k)).map(k => `${k}层:${byStrength.get(k)!.w}/${byStrength.get(k)!.n}`);
    if (parts.length) lines.push(`分档胜/局：${parts.join(' · ')}`);
  }
  if (eve.length) {
    const redWin = eve.filter(r => r.winner === 'red').length;
    const draw = eve.filter(r => r.winner === 'draw').length;
    lines.push(`机机对弈：红胜 ${redWin} · 和 ${draw} · 黑胜 ${eve.length - redWin - draw}`);
  }
  statsReportEl.textContent = lines.join('\n');
}

$('btnStats').addEventListener('click', renderStats);
$('btnStatsClear').addEventListener('click', () => {
  try { localStorage.removeItem(REC_KEY); } catch { /* 忽略 */ }
  statsReportEl.textContent = '已清空';
});

// ---------- 棋谱库（Electron games/ 目录） ----------
const libListEl = $('libList') as HTMLDivElement;

async function refreshLib() {
  if (!engineApi?.libList) { libListEl.textContent = '（需 Electron）'; return; }
  const r = await engineApi.libList();
  if (!Array.isArray(r)) { libListEl.textContent = '读取失败：' + (('error' in r && r.error) || ''); return; }
  if (!r.length) { libListEl.textContent = '库为空，对局后可存入'; return; }
  libListEl.innerHTML = '';
  for (const it of r) {
    const row = document.createElement('div');
    const d = new Date(it.mtime);
    const span = document.createElement('span');
    span.textContent = `${it.name}（${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}）`;
    const btnLoad = document.createElement('button');
    btnLoad.textContent = '载入';
    btnLoad.addEventListener('click', async () => {
      if (!engineApi?.libRead) return;
      const rr = await engineApi.libRead(it.name);
      if (!Array.isArray(rr) && 'error' in rr) { setStatus('读取失败：' + rr.error); return; }
      if ('content' in rr) loadRecordFromText(rr.content);
    });
    const btnDel = document.createElement('button');
    btnDel.textContent = '删除';
    btnDel.addEventListener('click', async () => {
      if (!engineApi?.libDelete) return;
      await engineApi.libDelete(it.name);
      refreshLib();
    });
    row.appendChild(span);
    row.appendChild(document.createTextNode(' '));
    row.appendChild(btnLoad);
    row.appendChild(document.createTextNode(' '));
    row.appendChild(btnDel);
    libListEl.appendChild(row);
  }
}
$('btnLibRefresh').addEventListener('click', refreshLib);

$('btnLibSave').addEventListener('click', async () => {
  if (!engineApi?.libSave) { setStatus('浏览器模式不支持（需 Electron）'); return; }
  if (mode !== 'play' || !movesHistory.length) { setStatus('当前没有可保存的对局'); return; }
  let startBoard;
  try { startBoard = parseFen(startFen).board; } catch { startBoard = initialBoard(); }
  const ts = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '');
  const rec: GameRecord = {
    app: 'xiangqi-ai',
    version: 2,
    date: new Date().toISOString(),
    startFen: startFen || view.getFen(),
    mode: gameMode,
    redName: sideName('red'),
    blackName: sideName('black'),
    moves: [...movesHistory],
    movesZh: movesToChinese(startBoard, movesHistory),
    result: gameResult || (gameOver ? '对局结束' : '对局未结束'),
  };
  const res = await engineApi.libSave(`棋谱_${ts}.json`, JSON.stringify(rec, null, 2));
  setStatus(res === true ? '已存入棋谱库' : '保存失败');
  refreshLib();
});

function enterReplay(rec: GameRecord) {
  // 停止自动播放 / 引擎思考，离开对局界面
  stopReplayTimer();
  if (waitingFor) {
    try { client.stop(); } catch { /* 引擎可能已退出 */ }
    waitingFor = null;
    pendingAfterAnalysis = null; // 避免旧挂起动作在复盘期间误触发
  }
  replayRecord = rec;
  replayIdx = 0;
  mode = 'replay';
  // 中文记谱：优先用棋谱自带（v2+），长度不符则现场重算
  const startBoard = replayStartBoard(rec);
  replayMovesZh = Array.isArray(rec.movesZh) && rec.movesZh.length === rec.moves.length
    ? rec.movesZh
    : movesToChinese(startBoard, rec.moves);
  view.onSquare = null;
  view.replaceBoard(startBoard);
  view.setLastMove(null, null);
  ($('btnMode') as HTMLButtonElement).textContent = '进入对弈';
  ($('editPanel') as HTMLDivElement).style.opacity = '1';
  replayRow.style.display = 'flex';
  reviewRow.style.display = 'flex';
  reviewReportEl.textContent = '';
  reviewMarks = [];
  moveListEl.style.display = 'block';
  renderMoveList(rec.moves, replayMovesZh, 0, true);
  ($('btnRepPlay') as HTMLButtonElement).textContent = '自动';
  updateReplayLabel();
  setStatus('');
}

function stopReplayTimer() {
  if (replayTimer !== null) {
    clearInterval(replayTimer);
    replayTimer = null;
  }
}

// 回放到指定步数
function repGoTo(idx: number) {
  if (!replayRecord) return;
  const n = replayRecord.moves.length;
  idx = Math.max(0, Math.min(n, idx));
  let b = replayStartBoard(replayRecord);
  for (let i = 0; i < idx; i++) {
    const mv = parseIccs(replayRecord.moves[i]);
    if (!mv) break;
    b = applyMove(b, mv);
  }
  replayIdx = idx;
  view.replaceBoard(b);
  if (idx > 0) {
    const last = parseIccs(replayRecord.moves[idx - 1]);
    if (last) view.setLastMove(last.from, last.to);
  } else {
    view.setLastMove(null, null);
  }
  renderMoveList(replayRecord.moves, replayMovesZh, idx, true);
  updateReplayLabel();
  setStatus('');
}

function exitReplay() {
  stopReplayTimer();
  replayRecord = null;
  replayIdx = 0;
  replayMovesZh = [];
  mode = 'edit';
  hideEndBanner();
  replayRow.style.display = 'none';
  reviewRow.style.display = 'none';
  moveListEl.style.display = 'none';
  moveListEl.innerHTML = '';
  reviewReportEl.textContent = '';
  reviewMarks = [];
  replayLabel.textContent = '';
  view.replaceBoard(initialBoard());
  view.setLastMove(null, null);
  view.clearOverlay();
  setStatus('已退出复盘');
}

$('btnRepFirst').addEventListener('click', () => repGoTo(0));
$('btnRepPrev').addEventListener('click', () => repGoTo(replayIdx - 1));
$('btnRepNext').addEventListener('click', () => repGoTo(replayIdx + 1));
$('btnRepLast').addEventListener('click', () => { if (replayRecord) repGoTo(replayRecord.moves.length); });

$('btnRepPlay').addEventListener('click', () => {
  if (!replayRecord) return;
  if (replayTimer !== null) { stopReplayTimer(); ($('btnRepPlay') as HTMLButtonElement).textContent = '自动'; return; }
  if (replayIdx >= replayRecord.moves.length) repGoTo(0);
  ($('btnRepPlay') as HTMLButtonElement).textContent = '暂停';
  replayTimer = window.setInterval(() => {
    if (!replayRecord || replayIdx >= replayRecord.moves.length) {
      stopReplayTimer();
      ($('btnRepPlay') as HTMLButtonElement).textContent = '自动';
      return;
    }
    repGoTo(replayIdx + 1);
  }, 900);
});

$('btnRepExit').addEventListener('click', () => exitReplay());

// ---------- AI 点评按钮 ----------
const reviewRow = $('reviewRow') as HTMLDivElement;
$('btnReview').addEventListener('click', () => startReview());

// ---------- 名局欣赏（古谱《自出洞来无敌手》） ----------
const classicCatSel = $('classicCategory') as HTMLSelectElement;
const classicGameSel = $('classicGame') as HTMLSelectElement;
const classicInfoEl = $('classicInfo') as HTMLSpanElement;

for (const cat of CLASSIC_CATEGORIES) {
  classicCatSel.add(new Option(cat, cat));
}

function refreshClassicGames() {
  const cat = classicCatSel.value;
  classicGameSel.innerHTML = '';
  for (const g of CLASSICS.filter(g => g.category === cat)) {
    classicGameSel.add(new Option(`${g.name}（${g.opening}）`, g.id));
  }
  updateClassicInfo();
}

function updateClassicInfo() {
  const g = CLASSICS.find(x => x.id === classicGameSel.value);
  classicInfoEl.textContent = g ? `${g.moves.length} 手` : '';
}

classicCatSel.addEventListener('change', refreshClassicGames);
classicGameSel.addEventListener('change', updateClassicInfo);
refreshClassicGames();

$('btnLoadClassic').addEventListener('click', () => {
  const g = CLASSICS.find(x => x.id === classicGameSel.value);
  if (!g) return;
  // 数据已在构建期经规则库全量校验，这里直接重放
  enterReplay({
    app: 'xiangqi-ai',
    version: 2,
    date: '',
    startFen: 'rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1',
    mode: 'classic',
    redName: '红（古谱先手）',
    blackName: '黑（古谱后手）',
    moves: [...g.moves],
    movesZh: [...g.movesZh],
    result: g.result,
  });
  setStatus(`名局欣赏：${g.category}·${g.name}（${g.opening}）`);
});
