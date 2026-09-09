// M3/M4 主界面逻辑：对弈（人机）+ 摆子编辑 + 实时分析

import { BoardData, cloneBoard, emptyBoard, initialBoard, parseFen } from '../board/fen';
import { Move, PieceType, Side, Square, parseIccs, toIccs } from '../board/types';
import { moveToChinese, movesToChinese } from '../board/notation';
import { exportPgn, parsePgn } from '../board/pgn';
import { matchOpening } from '../board/openings';
import { applyMove, checkStatus, isMaterialDraw, legalMovesFrom } from '../rules/rules';
import { UciClient, EngineInfo, toRedPersp, cpToWinrate, formatScore, engineMoveToLocal, enginePvToLocal } from '../uci/engine-client';
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
const endBanner = $('endBanner') as HTMLDivElement;

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
let waitingFor: null | 'engine' | 'analysis' = null;
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

// ---------- 音效（Web Audio 合成，无外部资源） ----------
let soundOn = true;
let audioCtx: AudioContext | null = null;

function playSound(kind: 'move' | 'capture' | 'check') {
  if (!soundOn) return;
  try {
    audioCtx = audioCtx || new AudioContext();
    const t = audioCtx.currentTime;
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = 'triangle';
    // 落子：短促中频"嗒"；吃子：低频重击；将军：高频急促双音
    const f0 = kind === 'move' ? 640 : kind === 'capture' ? 300 : 920;
    const f1 = kind === 'move' ? 190 : kind === 'capture' ? 110 : 640;
    osc.frequency.setValueAtTime(f0, t);
    osc.frequency.exponentialRampToValueAtTime(f1, t + 0.09);
    const vol = kind === 'capture' ? 0.5 : kind === 'check' ? 0.4 : 0.35;
    gain.gain.setValueAtTime(vol, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + (kind === 'capture' ? 0.2 : 0.13));
    osc.connect(gain).connect(audioCtx.destination);
    osc.start(t);
    osc.stop(t + 0.22);
    if (kind === 'check') {
      // 将军：紧跟第二个更高的短音
      const osc2 = audioCtx.createOscillator();
      const gain2 = audioCtx.createGain();
      osc2.type = 'triangle';
      osc2.frequency.setValueAtTime(1150, t + 0.13);
      osc2.frequency.exponentialRampToValueAtTime(760, t + 0.22);
      gain2.gain.setValueAtTime(0.4, t + 0.13);
      gain2.gain.exponentialRampToValueAtTime(0.001, t + 0.28);
      osc2.connect(gain2).connect(audioCtx.destination);
      osc2.start(t + 0.13);
      osc2.stop(t + 0.3);
    }
  } catch { /* 音频不可用时静默 */ }
}

$('btnSound').addEventListener('click', () => {
  soundOn = !soundOn;
  ($('btnSound') as HTMLButtonElement).textContent = soundOn ? '🔊音效:开' : '🔇音效:关';
});

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
  view.replaceBoard(initialBoard());
  movesHistory = [];
  movesZhLive = [];
  gameOver = false;
  gameResult = '';
  hideEndBanner();
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
  startFen = view.getFen();
  rebuildPosSeen(view.getBoard(), []);
  renderMoveList(movesHistory, movesZhLive, 0, false);
  updateOpeningName();
}

function doMove(mv: Move) {
  const board = view.getBoard();
  const captured = !!board.pieces[mv.to.rank][mv.to.file];
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
  if (st.status === 'checkmate') {
    gameOver = true;
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
    gameResult = '双方无进攻子力，判和';
    setStatus('双方均无进攻子力（只剩士象将帅），和棋');
    showEndBanner('双方无进攻子力 · 和棋', true);
    return;
  }
  if ((posSeen.get(posKey(board)) || 0) >= 3) {
    gameOver = true;
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
  // 机机对弈：开局库直接落子（从初始局面开始且未偏离开局序列时）
  if (gameMode === 'eve' && startFen.split(' ')[0] === INITIAL_FEN_PART) {
    const m = matchOpening(movesHistory);
    if (m && m.next) {
      const bookMv = parseIccs(m.next);
      if (bookMv) {
        const mover = view.getBoard().sideToMove === 'red' ? redNameInput.value : blackNameInput.value;
        setStatus(`${mover}（开局库·${m.name}）`);
        doMove(bookMv);
        return;
      }
    }
  }
  waitingFor = 'engine';
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
  lastInfoMap.clear();
  client.position(view.getFen());
  client.go({ depth: ANALYSIS_DEPTH });
}

function onBestmove(bm: string) {
  if (waitingFor === 'engine') {
    waitingFor = null;
    const raw = parseIccs(bm);
    if (!raw) { setStatus('引擎着法解析失败: ' + bm); return; }
    // 引擎 ICCS 坐标（rank 0=红底线）转内部坐标（rank 0=黑底线）
    const mv = engineMoveToLocal(raw);
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
  if (mode !== 'play' || gameOver || waitingFor) return;
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
    moveListEl.style.display = 'block';
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
    hideEndBanner();
    moveListEl.style.display = 'none';
    moveListEl.innerHTML = '';
    setStatus('');
  }
});

$('btnNew').addEventListener('click', () => { if (mode === 'play') newGame(); });

$('btnUndo').addEventListener('click', () => {
  // 悔棋：撤销人机各一步（简化：回退到人类行棋局面）；机机对弈不支持悔棋
  if (mode !== 'play' || gameMode === 'eve' || movesHistory.length === 0 || waitingFor) return;
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
    // 提速三件套：多线程（留 2 核给系统）、大哈希、对弈默认单线搜索
    const threads = Math.max(1, (navigator.hardwareConcurrency || 4) - 2);
    client.setOption('Threads', threads);
    client.setOption('Hash', 512);
    client.setOption('MultiPV', 1);
    client.isready();
    engineReady = true;
    engineState.textContent = `已启动（${threads} 线程）`;
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
  // 分析用 MultiPV 3（多线参考），对弈用 MultiPV 1（单线全速）
  if (engineReady) client.setOption('MultiPV', analysisOn ? 3 : 1);
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
  if (mode === 'play' && gameMode === 'pve' && !gameOver) newGame();
});

gameModeSel.addEventListener('change', () => {
  gameMode = gameModeSel.value as 'pve' | 'eve';
  // 切换模式时显示对应配置行
  pveRow.style.display = gameMode === 'pve' ? 'flex' : 'none';
  eveRows.style.display = gameMode === 'eve' ? 'block' : 'none';
  if (mode === 'play' && !gameOver) newGame();
  else setStatus('');
});

redStrengthSel.addEventListener('change', () => { if (mode === 'play' && gameMode === 'eve' && !waitingFor) newGame(); });
blackStrengthSel.addEventListener('change', () => { if (mode === 'play' && gameMode === 'eve' && !waitingFor) newGame(); });
timeLimitSel.addEventListener('change', () => { if (mode === 'play' && gameMode === 'eve' && !waitingFor) newGame(); });

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
function renderMoveList(moves: string[], zh: string[], curIdx: number, clickable: boolean) {
  const n = moves.length;
  const parts: string[] = [];
  for (let i = 0; i < n; i++) {
    const cls = i + 1 === curIdx ? 'cur' : '';
    const text = zh[i] || moves[i];
    if (i % 2 === 0) parts.push(`<span data-mv="${i + 1}" class="${cls}"><span class="no">${i / 2 + 1}.</span>${text}</span>`);
    else parts.push(`<span data-mv="${i + 1}" class="${cls}">${text}</span>`);
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

// 打开棋谱 → 进入复盘（JSON 用自带数据；PGN 用中文/ICCS 记法反推解析）
$('btnLoadGame').addEventListener('click', async () => {
  if (!engineApi) { setStatus('浏览器模式不支持打开棋谱（需 Electron）'); return; }
  const r = await engineApi.openText();
  if (!r) return;
  try {
    const isPgn = /\.pgn$/i.test(r.path) || r.content.trimStart().startsWith('[');
    if (isPgn) {
      const meta = parsePgn(r.content);
      if (!meta.moves.length) { setStatus('PGN 中未解析出有效着法'); return; }
      enterReplay({
        app: 'xiangqi-ai', version: 2, date: '',
        startFen: meta.startFen,
        mode: 'import',
        redName: meta.redName, blackName: meta.blackName,
        moves: meta.moves,
        result: meta.result || '对局结束',
      });
      return;
    }
    const rec = JSON.parse(r.content) as GameRecord;
    if (!rec || !Array.isArray(rec.moves) || rec.moves.some(m => typeof m !== 'string')) {
      setStatus('棋谱文件格式无效');
      return;
    }
    enterReplay(rec);
  } catch {
    setStatus('棋谱文件解析失败');
  }
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
  moveListEl.style.display = 'none';
  moveListEl.innerHTML = '';
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
