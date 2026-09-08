// M3/M4 主界面逻辑：对弈（人机）+ 摆子编辑 + 实时分析

import { emptyBoard, initialBoard, parseFen } from '../board/fen';
import { Move, PieceType, Side, Square, parseIccs, toIccs } from '../board/types';
import { applyMove, checkStatus, legalMovesFrom } from '../rules/rules';
import { UciClient, EngineInfo, toRedPersp, cpToWinrate, formatScore } from '../uci/engine-client';
import { BoardView } from './board-view';

// ---------- DOM ----------
const $ = (id: string) => document.getElementById(id) as HTMLElement;
const canvas = $('board') as HTMLCanvasElement;
const fenBox = $('fen') as HTMLTextAreaElement;
const statusEl = $('gameStatus') as HTMLDivElement;
const paletteEl = $('palette') as HTMLDivElement;
const analysisEl = $('analysis') as HTMLDivElement;
const curveEl = $('curve') as HTMLCanvasElement;
const engineState = $('engineState') as HTMLSpanElement;
const depthInput = $('depth') as HTMLInputElement;
const sideSelect = $('humanSide') as HTMLSelectElement;

// ---------- 状态 ----------
let mode: 'edit' | 'play' = 'edit';
let humanSide: Side = 'red';
let gameOver = false;
let movesHistory: string[] = [];       // 当前对局 ICCS 着法
let selected: Square | null = null;
let targets: Move[] = [];
let waitingFor: null | 'engine' | 'analysis' = null;
let engineReady = false;
let analysisOn = false;
let cpHistory: number[] = [];          // 红方视角胜率曲线数据
let lastInfoMap = new Map<number, EngineInfo>();

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
  return mode === 'play' && !gameOver && engineReady && view.getBoard().sideToMove !== humanSide;
}

// ---------- 对弈流程 ----------
function newGame() {
  view.replaceBoard(initialBoard());
  movesHistory = [];
  gameOver = false;
  selected = null;
  targets = [];
  cpHistory = [];
  lastInfoMap.clear();
  drawCurve();
  analysisEl.textContent = '—';
  waitingFor = null;
  view.setLastMove(null, null);
  setStatus('');
  fenBox.value = view.getFen();
  if (engineTurnNow()) engineMove();
}

function doMove(mv: Move) {
  const board = view.getBoard();
  const nb = applyMove(board, mv);
  movesHistory.push(toIccs(mv));
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
  if (st.status === 'checkmate') { gameOver = true; setStatus('绝杀！' + (board.sideToMove === humanSide ? '你输了' : '你赢了')); return; }
  if (st.status === 'stalemate') { gameOver = true; setStatus('困毙！' + (board.sideToMove === humanSide ? '你输了' : '你赢了')); return; }
  if (st.status === 'check') setStatus('将军！');
  else setStatus('');
  if (engineTurnNow()) engineMove();
  else if (analysisOn && !waitingFor) analyze();
}

function engineMove() {
  if (!engineReady) return;
  waitingFor = 'engine';
  // 注意：只发当前 FEN，不再叠加 moves（FEN 已是最新位置，叠加会触发引擎严格校验崩溃）
  client.position(view.getFen());
  client.go({ depth: getDepth() });
  setStatus('引擎思考中…');
}

function analyze() {
  if (!engineReady || gameOver) return;
  waitingFor = 'analysis';
  lastInfoMap.clear();
  client.position(view.getFen());
  client.go({ depth: getDepth() });
}

function onBestmove(bm: string) {
  if (waitingFor === 'engine') {
    waitingFor = null;
    const mv = parseIccs(bm);
    if (!mv) { setStatus('引擎着法解析失败: ' + bm); return; }
    // 记录引擎思考分数进胜率曲线
    const best = lastInfoMap.get(1);
    if (best && best.scoreCp !== null) pushCp(best.scoreCp);
    doMove(mv);
  } else if (waitingFor === 'analysis') {
    waitingFor = null;
    const best = lastInfoMap.get(1);
    if (best && best.scoreCp !== null) pushCp(best.scoreCp);
    setStatus(statusTextFor());
  }
}

function onInfo(info: EngineInfo) {
  if (!info.pv.length) return;
  lastInfoMap.set(info.multipv, info);
  renderAnalysis();
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
    rows.push(`#${k} ${mate} 胜率${wr}% ${i.pv.slice(0, 4).join(' ')}`);
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
  if (mode !== 'play' || gameOver || waitingFor) return;
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
  if (mode === 'edit') return '编辑模式';
  if (gameOver) return '对局结束';
  const turn = view.getBoard().sideToMove === 'red' ? '红方' : '黑方';
  const who = turn === (humanSide === 'red' ? '红方' : '黑方') ? '你' : '引擎';
  return `对弈中 · ${turn}行棋（${who}）`;
}

$('btnMode').addEventListener('click', () => {
  if (mode === 'edit') {
    mode = 'play';
    ($('btnMode') as HTMLButtonElement).textContent = '返回编辑';
    ($('editPanel') as HTMLDivElement).style.opacity = '.4';
    view.onSquare = view.onSquare; // 保持回调
    humanSide = sideSelect.value as Side;
    setStatus('');
  } else {
    mode = 'edit';
    ($('btnMode') as HTMLButtonElement).textContent = '进入对弈';
    ($('editPanel') as HTMLDivElement).style.opacity = '1';
    view.onSquare = null;
    waitingFor = null;
    setStatus('');
  }
});

$('btnNew').addEventListener('click', () => { if (mode === 'play') newGame(); });

$('btnUndo').addEventListener('click', () => {
  // 悔棋：撤销人机各一步（简化：回退到人类行棋局面）
  if (mode !== 'play' || movesHistory.length === 0 || waitingFor) return;
  const undoCount = view.getBoard().sideToMove === humanSide ? 2 : 1;
  const b = view.getBoard();
  let nb = b;
  for (let i = 0; i < Math.min(undoCount, movesHistory.length); i++) {
    // 通过重放实现悔棋
    movesHistory.pop();
  }
  // 从初始局面重放
  nb = initialBoard();
  for (const iccs of movesHistory) {
    const mv = parseIccs(iccs);
    if (mv) nb = applyMove(nb, mv);
  }
  gameOver = false;
  view.replaceBoard(nb);
  selected = null; targets = [];
  setStatus('');
  if (engineTurnNow()) engineMove();
  else if (analysisOn) analyze();
});

$('btnStartEngine').addEventListener('click', async () => {
  if (!engineApi) { engineState.textContent = '浏览器模式不支持引擎（需 Electron）'; return; }
  try {
    await engineApi.start(($('enginePath') as HTMLInputElement).value.trim());
    client.uci();
    client.setOption('MultiPV', 3);
    client.setOption('Hash', 256);
    client.isready();
    engineReady = true;
    engineState.textContent = '已启动';
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
  if (analysisOn && !waitingFor && mode === 'play' && !gameOver) analyze();
});

function getDepth(): number {
  return Math.max(1, Math.min(40, parseInt(depthInput.value, 10) || 12));
}

sideSelect.addEventListener('change', () => {
  humanSide = sideSelect.value as Side;
  if (mode === 'play' && !gameOver) newGame();
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
