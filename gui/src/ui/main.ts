// M3/M4 主界面逻辑：对弈（人机）+ 摆子编辑 + 实时分析

import { BoardData, cloneBoard, emptyBoard, initialBoard, parseFen, toFen } from '../board/fen';
import { Move, PieceType, Side, Square, parseIccs, toIccs } from '../board/types';
import { moveToChinese, movesToChinese } from '../board/notation';
import { exportPgn, parsePgn } from '../board/pgn';
import { matchOpening, matchOpeningByCategory, setCustomOpenings, type Opening, type OpeningCategory } from '../board/openings';
import { CLASSICS, CLASSIC_CATEGORIES } from '../board/classics';
import puzzlesJson from '../data/puzzles.json';
import { applyMove, checkStatus, inCheck, isMaterialDraw, legalMoves, legalMovesFrom } from '../rules/rules';
import { UciClient, EngineInfo, toRedPersp, cpToWinrate, formatScore, engineMoveToLocal, enginePvToLocal } from '../uci/engine-client';
import { normalizeScore, lossList, marksFor, summarize, acplOf } from '../uci/review';
import { blunderProfile, pickBlunder, estimateElo, DEPTH_ELO } from '../uci/elo';
import { buildMessages, tagForLoss, type ReviewStyle, type StepEval } from '../uci/llm-review';
import { BoardView, Arrow, BOARD_W, BOARD_H, BOARD_THEMES, type FlipMode } from './board-view';
import { findKing } from '../rules/rules';

// ---------- DOM ----------
const $ = (id: string) => document.getElementById(id) as HTMLElement;
const canvas = $('board') as HTMLCanvasElement;
const fenBox = $('fen') as HTMLTextAreaElement;
const statusEl = $('gameStatus') as HTMLDivElement;
const paletteEl = $('palette') as HTMLDivElement;
const analysisEl = $('analysis') as HTMLDivElement;
const curveEl = $('curve') as HTMLCanvasElement;
const sideSelect = $('humanSide') as HTMLSelectElement;
const gameModeSel = $('gameMode') as HTMLSelectElement;
const redNameInput = $('redName') as HTMLInputElement;
const blackNameInput = $('blackName') as HTMLInputElement;
const redStrengthSel = $('redStrength') as HTMLSelectElement;
const blackStrengthSel = $('blackStrength') as HTMLSelectElement;
// 红/黑行 UI（固定布局：角色标签 / 引擎折叠 / 侧计时）
const redRoleEl = $('redRole') as HTMLSpanElement;
const blackRoleEl = $('blackRole') as HTMLSpanElement;
const redEngToggle = $('redEngToggle') as HTMLButtonElement;
const blackEngToggle = $('blackEngToggle') as HTMLButtonElement;
const redEngBox = $('redEngBox') as HTMLDivElement;
const blackEngBox = $('blackEngBox') as HTMLDivElement;
const redEnginePathInp = $('redEnginePath') as HTMLInputElement;
const blackEnginePathInp = $('blackEnginePath') as HTMLInputElement;
const timeLimitSel = $('timeLimit') as HTMLSelectElement;
const avoidDrawSel = $('avoidDraw') as HTMLSelectElement;
const useBookSel = $('useBook') as HTMLSelectElement;
const openingCategorySel = $('openingCategory') as HTMLSelectElement;
const sacrificeModeChk = $('sacrificeMode') as HTMLInputElement;
const threadsSel = $('threadsSel') as HTMLSelectElement;
const hashSel = $('hashSel') as HTMLSelectElement;
const handicapSel = $('handicapSel') as HTMLSelectElement;
const clockModeSel = $('clockModeSel') as HTMLSelectElement;
const endBanner = $('endBanner') as HTMLDivElement;
const interveneChk = $('interveneChk') as HTMLInputElement;
const naturalLimitSel = $('naturalLimitSel') as HTMLSelectElement;
const ruleSetSel = $('ruleSet') as HTMLSelectElement;
const btnLLM = $('btnLLM') as HTMLButtonElement;
const llmRow = $('llmRow') as HTMLDivElement;
const llmStyleSel = $('llmStyle') as HTMLSelectElement;
const llmCfgRow = $('llmCfgRow') as HTMLDivElement;
const llmBaseUrl = $('llmBaseUrl') as HTMLInputElement;
const llmModel = $('llmModel') as HTMLInputElement;
const llmApiKey = $('llmApiKey') as HTMLInputElement;
const btnLlmSave = $('btnLlmSave') as HTMLButtonElement;
const llmReport = $('llmReport') as HTMLDivElement;
const btnLlmCfgToggle = $('btnLlmCfgToggle') as HTMLButtonElement;

// ---------- 对弈配置（避和/开局库/线程/哈希/自然限着，localStorage 持久化） ----------
// 判和规则体系：guogui=国规2020（自然限着+25回合不提和） net=网络规则（天天象棋：400步/重复5次/长将6回合） casual=休闲简化
type RuleSet = 'guogui' | 'net' | 'casual';
let ruleSet: RuleSet = 'guogui';
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
      openingCategory: openingCategorySel.value,
      sacrifice: sacrificeModeChk.checked ? '1' : '0',
      threads: threadsSel.value, hash: hashSel.value,
      naturalLimit: naturalLimitSel.value,
      ruleSet: ruleSetSel.value,
      redEnginePath: redEnginePathInp.value,
      blackEnginePath: blackEnginePathInp.value,
    }));
  } catch { /* 忽略存储失败 */ }
}
(function loadCfg() {
  try {
    const c = JSON.parse(localStorage.getItem(CFG_KEY) || '{}');
    if (c.avoidDraw === '0' || c.avoidDraw === '1') avoidDrawSel.value = c.avoidDraw;
    if (c.useBook === '0' || c.useBook === '1') useBookSel.value = c.useBook;
    if (['any', 'zhongpao', 'shunpao', 'xianren', 'feixiang', 'guogong', 'qima', 'jiuweigu'].includes(c.openingCategory)) openingCategorySel.value = c.openingCategory;
    if (c.sacrifice === '1' || c.sacrifice === '0') sacrificeModeChk.checked = c.sacrifice === '1';
    if (['auto', '2', '4', '6', '8'].includes(c.threads)) threadsSel.value = c.threads;
    if (['128', '256', '512', '1024'].includes(c.hash)) hashSel.value = c.hash;
    if (['40', '50', '60'].includes(c.naturalLimit)) naturalLimitSel.value = c.naturalLimit;
    if (['guogui', 'net', 'casual'].includes(c.ruleSet)) ruleSetSel.value = c.ruleSet;
    // 引擎选择持久化：打开软件直接沿用上次设置（留空=内置引擎）
    if (typeof c.redEnginePath === 'string') redEnginePathInp.value = c.redEnginePath;
    if (typeof c.blackEnginePath === 'string') blackEnginePathInp.value = c.blackEnginePath;
  } catch { /* 忽略读取失败 */ }
  ruleSet = ruleSetSel.value as RuleSet; // loadCfg 直接设值不触发 change，手动同步运行时变量
})();
[avoidDrawSel, useBookSel, openingCategorySel, sacrificeModeChk, threadsSel, hashSel, naturalLimitSel, ruleSetSel, redEnginePathInp, blackEnginePathInp].forEach(s => s.addEventListener('change', saveCfg));
ruleSetSel.addEventListener('change', () => {
  ruleSet = ruleSetSel.value as RuleSet;
  setStatus(ruleSet === 'guogui'
    ? '规则体系：国规2020（自然限着·25回合不提和）'
    : ruleSet === 'net'
      ? '规则体系：网络规则（400步·重复5次·长将6回合判和）'
      : '规则体系：休闲简化（点击提和即判和）');
});
threadsSel.addEventListener('change', () => { if (engineReady && !waitingFor) clientMain.setOption('Threads', threadsValue()); });
hashSel.addEventListener('change', () => { if (engineReady && !waitingFor) clientMain.setOption('Hash', parseInt(hashSel.value, 10)); });

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
let gameMode: 'pve' | 'pvp' | 'eve' = 'eve';   // 默认机机对弈；pve=人机 pvp=人人同屏 eve=机机对弈
// 棋盘视角：null=跟随默认（人执黑自动上下翻转），'ud'=上下翻转（红上黑下），'lr'=左右翻转（水平镜像）
let flipManual: FlipMode | null = null;
const autoFlipped = (): FlipMode => (gameMode === 'pve' && humanSide === 'black' ? 'ud' : 'none');
function effectiveFlip(): FlipMode { return flipManual !== null ? flipManual : autoFlipped(); }
function applyFlip() { view.setFlipMode(effectiveFlip()); refreshFlipBtn(); }
// 翻转按钮为「循环切换器」：默认 → 上下翻转 → 左右翻转 → 默认…
function refreshFlipBtn() {
  const btn = $('btnFlip') as HTMLButtonElement;
  const m = effectiveFlip();
  btn.textContent = m === 'none' ? '↕上下翻转' : m === 'ud' ? '↔左右翻转' : '⟲恢复视角';
  btn.title = '切换棋盘视角：上下翻转（红上黑下）↔ 左右翻转（水平镜像）↔ 恢复默认';
}
// 干预引擎着法：挂起中的引擎建议着法（非空=引擎已想好，等人确认或改走）
let engineProposal: { mv: Move; zh: string } | null = null;
const interveneOn = () => interveneChk.checked && mode === 'play' && !puzzleActive;
let gameOver = false;
let gameResult = '';                    // 对局结果描述（存入棋谱）
let startFen = '';                      // 本局起始 FEN（保存棋谱用）
let movesHistory: string[] = [];       // 当前对局 ICCS 着法（内部坐标）
let movesZhLive: string[] = [];        // 对应中文记谱（对弈实时显示）
let selected: Square | null = null;
let targets: Move[] = [];
let waitingFor: null | 'engine' | 'analysis' | 'review' | 'hint' | 'study' = null;
let engineReady = false;
let illegalRetry = 0;   // 引擎着法非法时的重发次数（防死循环）
let analysisOn = false;
let cpHistory: number[] = [];          // 红方视角胜率曲线数据
// 引擎最近一次对弈评估（红方视角，厘兵），供提和按钮判断引擎是否占优
let lastEvalRedCp: number | null = null;
let lastEvalMate = false;                // 引擎最近一次评估是否处于绝杀线
let lastInfoMap = new Map<number, EngineInfo>();

// 强度分级 → 搜索深度（引擎新版无 Skill Level，用深度限强）
const ANALYSIS_DEPTH = 14;

const view = new BoardView(canvas, initialBoard());
view.setOnChange(() => { fenBox.value = view.getFen(); });

// ---------- 棋盘自适应缩放（窗口/分屏等比缩小，Canvas 缓冲不变、CSS 拉伸显示） ----------
function fitBoard() {
  const scale = Math.max(0.35, Math.min(1,
    (window.innerHeight - 240) / BOARD_H, // 扣掉菜单/按钮/状态栏高度
    (window.innerWidth - 420) / BOARD_W,  // 扣掉右侧面板宽度与边距
  ));
  canvas.style.width = Math.round(BOARD_W * scale) + 'px';
  canvas.style.height = Math.round(BOARD_H * scale) + 'px';
}
window.addEventListener('resize', fitBoard);
fitBoard();

// ---------- UCI 客户端（多引擎：主引擎 + 机机对弈可选红/黑独立引擎） ----------
const engineApi = window.engine;
// 自有品牌名：界面与棋谱中引擎选手的统一称呼（与主进程 UCI 伪装保持一致）
const ENGINE_BRAND = '楚河引擎';
// 三个槽位的 UciClient：默认全部指向主引擎；eve 模式配置了独立引擎路径后，clientRed/clientBlack 换成独立实例
const clientMain = new UciClient(cmd => engineApi?.write('main', cmd));
let clientRed: UciClient = clientMain;
let clientBlack: UciClient = clientMain;
// 当前活跃客户端（发起搜索/停止搜索都用它；同一时刻只有一侧在搜索）
let client: UciClient = clientMain;
// 最近一次发起搜索的客户端：stop 只发给它（机机对弈两侧独立引擎时，避免误停另一侧空闲引擎）
let searchingClient: UciClient = clientMain;
const onBestmoveH = (bm: string) => onBestmove(bm);
const onInfoH = (info: EngineInfo) => onInfo(info);
clientMain.onBestmove = onBestmoveH;
clientMain.onInfo = onInfoH;
if (engineApi) {
  engineApi.onLine((msg: { slot: 'main' | 'red' | 'black'; line: string }) => {
    const { slot, line } = msg;
    if (line.startsWith('ENGINE_')) {
      const isExit = line.startsWith('ENGINE_EXIT');
      const reason = isExit ? line.slice(12) : '错误';
      if (slot === 'main') {
        // 主引擎退出/出错：全局停摆，解除等待状态避免界面卡死
        clearPending();
        waitingFor = null;
        engineReady = false;
        setStatus(isExit ? `引擎已退出（${reason}）—— 点「开始」重新启动` : '引擎错误');
      } else {
        // 独立引擎（红/黑）退出：该侧回退共用主引擎，局可继续
        if (slot === 'red' && clientRed !== clientMain) {
          clientRed = clientMain;
          setStatus(isExit ? `红方独立引擎已退出（${reason}），已回退内置引擎` : '红方独立引擎错误，已回退内置引擎');
        } else if (slot === 'black' && clientBlack !== clientMain) {
          clientBlack = clientMain;
          setStatus(isExit ? `黑方独立引擎已退出（${reason}），已回退内置引擎` : '黑方独立引擎错误，已回退内置引擎');
        }
        setStatus('独立引擎已停用，该侧改用主引擎继续');
        // 若独立引擎恰好在搜索中（waitingFor 指向它），解除等待避免卡死
        if (waitingFor) {
          clearPending();
          waitingFor = null;
          if (engineReady && mode === 'play' && gameMode === 'eve' && !gameOver) engineMove();
        }
      }
      return;
    }
    const c = slot === 'red' && clientRed !== clientMain ? clientRed
      : slot === 'black' && clientBlack !== clientMain ? clientBlack
      : clientMain;
    c.handleLine(line);
  });
}

function engineTurnNow(): boolean {
  if (mode !== 'play' || gameOver || !engineReady) return false;
  if (gameMode === 'eve') return true; // 机机对弈：两侧都是引擎
  if (gameMode === 'pvp') return false; // 人人对弈：引擎不参与行棋
  return view.getBoard().sideToMove !== humanSide;
}

// ---------- 引擎搜索串行化 ----------
// UCI 引擎搜索中不能再收 position/go（会被忽略或错乱），必须先 stop 并等 bestmove 回来
let pendingAfterAnalysis: (() => void) | null = null;
// 丢弃下一次 bestmove：开新局/切模式时停止旧搜索，旧结果不得落到新棋盘
let discardNextBestmove = false;
let discardWatchdog: ReturnType<typeof setTimeout> | null = null;

function clearPending() {
  discardNextBestmove = false;
  if (discardWatchdog) { clearTimeout(discardWatchdog); discardWatchdog = null; }
  pendingAfterAnalysis = null;
}

// 引擎正在搜索（engine/analysis/review）时：stop 并丢弃旧结果，等 bestmove 回来后执行 action
// （开新局/切模式/接着走子的统一入口，保证「搜索中绝不再发 position/go」的不变量）
function stopEngineThen(action: () => void) {
  if (waitingFor) {
    discardNextBestmove = true;
    pendingAfterAnalysis = action;
    if (discardWatchdog) clearTimeout(discardWatchdog);
    discardWatchdog = setTimeout(() => {
      discardWatchdog = null;
      if (discardNextBestmove) {
        discardNextBestmove = false;
        waitingFor = null;
        const a = pendingAfterAnalysis;
        pendingAfterAnalysis = null;
        if (a) a();
      }
    }, 15000); // 安全网：引擎异常未回 bestmove 时强制执行，避免界面卡死
    try { searchingClient.stop(); } catch { /* 引擎可能已退出 */ }
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
// 只在「分析阶段」（人在思考）绘制；引擎思考/落子动画期间一律清空，避免旧箭头残留
function updateArrows() {
  if (!analysisOn || mode === 'replay' || mode === 'edit' || waitingFor !== 'analysis') {
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
// LLM 复盘数据：逐步收集（每步完整评估，供 llm-review 模块组装上下文）
let reviewEvals: { fen: string; scoreCp: number | null; scoreMate: number | null; pv: string[]; depth: number }[] = [];
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
  reviewEvals = []; // 重置 LLM 复盘评估数据
  llmReport.textContent = '';
  reviewReportEl.textContent = 'AI点评中…';
  searchingClient = clientMain;
  clientMain.setOption('MultiPV', 1);
  reviewStep();
}

function cancelReview() {
  if (!reviewing) return;
  reviewing = false;
  if (waitingFor === 'review') {
    try { searchingClient.stop(); } catch { /* 引擎可能已退出 */ }
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
  clientMain.position(fenAt(reviewRec.startFen, reviewRec.moves, reviewIdx));
  clientMain.go({ depth: REVIEW_DEPTH });
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
  // 复盘中的点评结果随棋谱保存（再次载入可直接显示）
  if (reviewClickable && replayRecord) {
    replayRecord.marks = [...reviewMarks];
    replayRecord.review = reviewReportEl.textContent;
  }
  reviewing = false;
  setStatus('点评完成');
  // 恢复 MultiPV（分析 3 / 避和 2 / 普通 1）
  clientMain.setOption('MultiPV', analysisOn ? 3 : (avoidDrawOn() ? 2 : 1));
  // LLM 解说挂起：点评数据就绪后自动续跑
  if (llmPending) { llmPending = false; runLLMReview(); }
}

// ---------- LLM 复盘解说（独立模块，仅对局结束后调用，不干预引擎思考） ----------
const LLM_CFG_KEY = 'xz_llm_cfg';
interface LlmCfg { baseUrl: string; model: string; apiKey: string; }
function loadLlmCfg(): LlmCfg {
  try { return JSON.parse(localStorage.getItem(LLM_CFG_KEY) || '{}'); } catch { return { baseUrl: '', model: '', apiKey: '' }; }
}
function saveLlmCfg(c: LlmCfg) {
  try { localStorage.setItem(LLM_CFG_KEY, JSON.stringify(c)); } catch { /* 忽略 */ }
}
// 初始化配置输入框
(function initLlmCfg() {
  const c = loadLlmCfg();
  llmBaseUrl.value = c.baseUrl || '';
  llmModel.value = c.model || '';
  llmApiKey.value = c.apiKey || '';
})();
btnLlmSave.addEventListener('click', () => {
  saveLlmCfg({ baseUrl: llmBaseUrl.value.trim(), model: llmModel.value.trim(), apiKey: llmApiKey.value.trim() });
  setStatus('LLM 配置已保存');
});
btnLlmCfgToggle.addEventListener('click', () => {
  llmCfgRow.style.display = llmCfgRow.style.display === 'flex' ? 'none' : 'flex';
});

// 收集 LLM 复盘上下文并调用大模型
async function runLLMReview() {
  if (!engineApi) { setStatus('LLM 复盘需 Electron 环境（浏览器模式无 IPC）'); return; }
  if (!reviewRec || !reviewRec.moves.length) { setStatus('没有可解说的对局'); return; }
  const cfg = loadLlmCfg();
  if (!cfg.baseUrl || !cfg.model || !cfg.apiKey) {
    llmCfgRow.style.display = 'flex';
    setStatus('请先填写 LLM 配置（Base URL / 模型 / API Key）');
    return;
  }
  // 需要评估数据：若尚未点评完毕，先跑 AI 点评（逐手评分收集）
  if (reviewEvals.length !== reviewRec.moves.length + 1) {
    setStatus('先生成 AI 点评评估…（完成后自动解说）');
    llmPending = true;
    startReview();
    return;
  }
  llmReport.textContent = 'LLM 解说生成中…';
  setStatus('LLM 复盘解说中…');
  // 组装步级数据（与 reviewScores/reviewEvals 对齐：第 k+1 手走子方得失 = scores[k] + scores[k+1]）
  let startSide: Side = 'red';
  try { startSide = parseFen(reviewRec.startFen).board.sideToMove; } catch { /* 默认红 */ }
  const steps: StepEval[] = [];
  const moveZh = reviewRec.movesZh && reviewRec.movesZh.length === reviewRec.moves.length ? reviewRec.movesZh : [];
  for (let k = 0; k < reviewRec.moves.length; k++) {
    const ev = reviewEvals[k + 1];
    const loss = (reviewScores[k] ?? 0) + (reviewScores[k + 1] ?? 0); // 走子方损失（负=得分提升）
    steps.push({
      ply: k + 1,
      side: k % 2 === 0 ? startSide : (startSide === 'red' ? 'black' : 'red'),
      moveZh: moveZh[k] || reviewRec.moves[k],
      fenAfter: ev.fen,
      scoreCp: ev.scoreCp,
      pv: ev.pv.join(' '),
      depth: ev.depth,
      loss,
      tag: tagForLoss(loss),
    });
  }
  let pgn = '';
  try {
    const sb = parseFen(reviewRec.startFen).board;
    const zhs = moveZh.length === reviewRec.moves.length ? moveZh : movesToChinese(sb, reviewRec.moves);
    pgn = exportPgn({
      startFen: reviewRec.startFen,
      redName: reviewRec.redName, blackName: reviewRec.blackName,
      result: reviewRec.result,
      moves: [...reviewRec.moves],
      movesZh: zhs,
      date: reviewRec.date || new Date().toISOString().slice(0, 10).replace(/-/g, '.'),
    });
  } catch { /* PGN 生成失败则用着法串代替 */ }
  try {
    const messages = buildMessages({
      pgn,
      startFen: reviewRec.startFen,
      redName: reviewRec.redName || '红方',
      blackName: reviewRec.blackName || '黑方',
      result: reviewRec.result || '对局结束',
      steps,
      fullFens: reviewEvals.map(e => e.fen),
      style: llmStyleSel.value as ReviewStyle,
    });
    const resp = await engineApi.llmChat({
      baseUrl: cfg.baseUrl, apiKey: cfg.apiKey, model: cfg.model, messages,
    });
    if ('error' in resp) {
      llmReport.textContent = 'LLM 调用失败：' + resp.error;
      setStatus('LLM 解说失败');
    } else {
      llmReport.textContent = resp.content;
      setStatus('LLM 复盘解说完成');
    }
  } catch (err) {
    llmReport.textContent = 'LLM 调用异常：' + (err as Error).message;
    setStatus('LLM 解说异常');
  }
}
let llmPending = false; // AI 点评完成后继续 LLM 解说
btnLLM.addEventListener('click', () => { runLLMReview(); });

// ---------- 局面重复检测（三次重复判和，与 selfplay 同规则） ----------
let posSeen = new Map<string, number>();
// 将军着法连续计数（天天象棋规则：长将 6 回合判和 / 强制变招）
let checkStreak = 0;

function posKey(b: BoardData): string {
  // 键只含「子力配置」（不含走棋方）：同一棋局无论轮到哪方走子都视为同一局面，
  // 这样 3 次/5 次重复判和计数才正确（若含走棋方，同局面仅计 2 次永不触发）。
  return b.pieces.map(row => row.map(p => (p ? (p.side === 'red' ? p.type : p.type.toLowerCase()) : '.')).join('')).join('/');
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

// ---------- 对局用时统计 / 赛制计时（显示在红/黑方行内各自时钟） ----------
const redClockEl = $('redClock') as HTMLSpanElement;
const blackClockEl = $('blackClock') as HTMLSpanElement;
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
  if (waitingFor) { try { searchingClient.stop(); } catch { /* 引擎可能已退出 */ } waitingFor = null; }
  if (gameMode === 'eve') {
    const winner = loser === 'red' ? (blackNameInput.value || '黑方') : (redNameInput.value || '红方');
    gameResult = `超时，${winner}胜`;
    setStatus(`超时！${winner}胜`);
    showEndBanner(`超时 · ${winner}胜`);
  } else {
    const humanLost = loser === humanSide;
    gameResult = humanLost ? `超时，${ENGINE_BRAND}胜` : '超时，玩家胜';
    setStatus('超时！' + (humanLost ? '你输了' : '你赢了'));
    showEndBanner(humanLost ? `超时 · ${ENGINE_BRAND}胜` : '超时 · 你赢了');
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
    redClockEl.textContent = fmtClock(Math.max(0, redLeftMs));
    blackClockEl.textContent = fmtClock(Math.max(0, blackLeftMs));
  } else {
    // 不限时：累计用时展示
    const cur = now - turnStart;
    const red = redMs + (stm === 'red' ? cur : 0);
    const black = blackMs + (stm === 'black' ? cur : 0);
    redClockEl.textContent = fmtClock(red);
    blackClockEl.textContent = fmtClock(black);
  }
}, 200);

function resetClock() {
  applyClockMode();
  redMs = 0;
  blackMs = 0;
  redLeftMs = clockBaseMs;
  blackLeftMs = clockBaseMs;
  turnStart = Date.now();
  redClockEl.textContent = fmtClock(Math.max(0, redLeftMs));
  blackClockEl.textContent = fmtClock(Math.max(0, blackLeftMs));
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
function newGame(startBoardOverride?: BoardData) {
  if (reviewing) cancelReview(); // 点评进行中：先取消（会停止 review 搜索）
  engineProposal = null; // 清除挂起的引擎着法
  const startAction = () => {
    if (engineReady && engineTurnNow()) engineMove();
  };
  // 必须先重置棋盘再启动引擎行棋（engineMove 发的是当前棋盘 FEN）
  const startBoard = startBoardOverride ?? startBoardForGame();
  view.replaceBoard(startBoard);
  movesHistory = [];
  movesZhLive = [];
  gameOver = false;
  gameResult = '';
  hideEndBanner();
  clearAuto(); // 主动开新局：清掉旧对局快照
  selected = null;
  targets = [];
  cpHistory = [];
  lastInfoMap.clear();
  lastEvalRedCp = null;
  lastEvalMate = false;
  view.setArrows([]);
  reviewMarks = [];
  reviewReportEl.textContent = '';
  puzzleHumanMoves = 0;
  checkStreak = 0; // 将军着法连续计数（天天象棋长将规则用）
  drawCurve();
  analysisEl.textContent = '—';
  view.setLastMove(null, null);
  setStatus('');
  fenBox.value = view.getFen();
  startFen = view.getFen();
  rebuildPosSeen(view.getBoard(), []);
  resetClock();
  renderMoveList(movesHistory, movesZhLive, 0, false);
  updateOpeningName();
  // 引擎先手：若引擎正在搜索旧局面，先停并丢弃旧结果，等 bestmove 回来再开新局首步
  if (waitingFor) stopEngineThen(startAction);
  else startAction();
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
  // 闯关：统计人行棋步数（预算校验用）
  if (puzzleActive && board.sideToMove === humanSide) puzzleHumanMoves++;
  const nb = applyMove(board, mv);
  illegalRetry = 0; // 成功落子：重置引擎着法校验重试计数
  movesHistory.push(toIccs(mv));
  playSound(captured ? 'capture' : 'move');
  if (mode === 'play') {
    movesZhLive.push(moveToChinese(board, mv));
    renderMoveList(movesHistory, movesZhLive, movesHistory.length, false);
    updateOpeningName();
  }
  // 重复局面计数（同步将军着法连续计数：吃子重置、非将军着法重置）
  const k = posKey(nb);
  posSeen.set(k, (posSeen.get(k) || 0) + 1);
  const givedNow = inCheck(nb, nb.sideToMove); // 走子后是否将军对方（nb 已翻转 sideToMove）
  if (givedNow) checkStreak++;
  else checkStreak = 0;
  selected = null;
  targets = [];
  view.clearOverlay();
  view.animateMove(mv.from, mv.to, () => {
    view.setLastMove(mv.from, mv.to);
    view.replaceBoard(nb);
    afterMove();
  });
}

// ---------- 对局自动保存 / 崩溃恢复（localStorage 快照，每步写入） ----------
const AUTOSAVE_KEY = 'xz_autosave';
function saveAuto() {
  if (mode !== 'play' || !movesHistory.length || gameOver) return;
  try {
    let startBoard;
    try { startBoard = parseFen(startFen).board; } catch { startBoard = initialBoard(); }
    localStorage.setItem(AUTOSAVE_KEY, JSON.stringify({
      app: 'xiangqi-ai', version: 2,
      date: new Date().toISOString(),
      startFen, mode: gameMode, humanSide,
      moves: [...movesHistory],
      movesZh: movesToChinese(startBoard, movesHistory),
      result: '对局未结束',
      ts: Date.now(),
    }));
  } catch { /* 忽略 */ }
}
function clearAuto() {
  try { localStorage.removeItem(AUTOSAVE_KEY); } catch { /* 忽略 */ }
  const b = $('btnResume') as HTMLButtonElement;
  b.style.display = 'none';
}
// 检测到未完成对局：显示恢复按钮
function checkAutoResume() {
  const b = $('btnResume') as HTMLButtonElement;
  try {
    const raw = localStorage.getItem(AUTOSAVE_KEY);
    if (!raw) { b.style.display = 'none'; return; }
    const rec = JSON.parse(raw) as GameRecord;
    if (rec && Array.isArray(rec.moves) && rec.moves.length && !rec.result?.includes('结束')) {
      b.style.display = 'inline-block';
      b.title = `恢复上次未完成对局（${new Date(rec.ts || Date.now()).toLocaleString()}，${rec.moves.length} 手）`;
    } else { b.style.display = 'none'; }
  } catch { b.style.display = 'none'; }
}
// 恢复对局：进入对弈模式并按快照重建棋盘继续
$('btnResume').addEventListener('click', () => {
  try {
    const raw = localStorage.getItem(AUTOSAVE_KEY);
    if (!raw) { setStatus('没有可恢复的对局'); return; }
    const rec = JSON.parse(raw) as GameRecord;
    if (!rec || !Array.isArray(rec.moves)) { setStatus('自动保存数据无效'); return; }
    // 离开复盘/编辑，进入对弈模式
    if (mode === 'replay') exitReplay();
    stopEngineThen(() => {
      mode = 'play';
      gameMode = rec.mode === 'eve' || rec.mode === 'pvp' || rec.mode === 'pve' ? rec.mode : 'pve';
      gameModeSel.value = gameMode;
      updateSideRows();
      if (gameMode === 'pve' && rec.humanSide) {
        humanSide = rec.humanSide;
        sideSelect.value = humanSide;
      }
      let b;
      try { b = parseFen(rec.startFen).board; } catch { b = initialBoard(); }
      view.onSquare = playSquareClick;
      view.replaceBoard(b);
      movesHistory = [...rec.moves];
      movesZhLive = Array.isArray(rec.movesZh) && rec.movesZh.length === rec.moves.length ? [...rec.movesZh] : movesToChinese(b, rec.moves);
      ($('btnMode') as HTMLButtonElement).textContent = '返回编辑';
      gameOver = false;
      gameResult = '';
      hideEndBanner();
      selected = null; targets = [];
      cpHistory = [];
      lastInfoMap.clear();
      lastEvalRedCp = null; lastEvalMate = false;
      view.setArrows([]);
      reviewMarks = [];
      renderMoveList(movesHistory, movesZhLive, movesHistory.length, false);
      updateOpeningName();
      startFen = rec.startFen;
      rebuildPosSeen(b, movesHistory);
      resetClock();
      // 重建最后一手标记
      if (movesHistory.length) {
        const last = parseIccs(movesHistory[movesHistory.length - 1]);
        if (last) view.setLastMove(last.from, last.to);
      }
      view.setCheck(null);
      ($('btnMode') as HTMLButtonElement).textContent = '返回编辑';
      clearAuto();
      setStatus(`已恢复未完成对局（${movesHistory.length} 手），继续对弈`);
      if (engineReady && engineTurnNow()) engineMove();
      else if (analysisOn && !waitingFor) analyze();
    });
  } catch (err) {
    setStatus('恢复对局失败: ' + (err as Error).message);
  }
});

function afterMove() {
  const board = view.getBoard();
  const st = checkStatus(board);
  // 将军标记：高亮被将方的将/帅
  view.setCheck(st.status === 'check' || st.status === 'checkmate' ? findKing(board, board.sideToMove) : null);
  if (st.status === 'checkmate') {
    gameOver = true;
    if (puzzleActive) {
      gameResult = `闯关成功（${puzzleActive.movesToMate}步杀）`;
      setStatus(`闯关成功！${puzzleActive.name}`);
      showEndBanner(`闯关成功 · ${puzzleActive.name}`);
      markPuzzleDone(puzzleActive.id);
      puzzleActive = null;
      return;
    }
    recordGame(board.sideToMove === 'red' ? 'black' : 'red');
    if (gameMode === 'eve') {
      const winner = board.sideToMove === 'red' ? (blackNameInput.value || '黑方') : (redNameInput.value || '红方');
      gameResult = `绝杀，${winner}胜`;
      setStatus(`绝杀！${winner}胜`);
      showEndBanner(`绝杀 · ${winner}胜`);
    } else {
      gameResult = board.sideToMove === humanSide ? `绝杀，${ENGINE_BRAND}胜` : '绝杀，玩家胜';
      setStatus('绝杀！' + (board.sideToMove === humanSide ? '你输了' : '你赢了'));
      showEndBanner(board.sideToMove === humanSide ? `绝杀 · ${ENGINE_BRAND}胜` : '绝杀 · 你赢了');
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
      gameResult = board.sideToMove === humanSide ? `困毙，${ENGINE_BRAND}胜` : '困毙，玩家胜';
      setStatus('困毙！' + (board.sideToMove === humanSide ? '你输了' : '你赢了'));
      showEndBanner(board.sideToMove === humanSide ? `困毙 · ${ENGINE_BRAND}胜` : '困毙 · 你赢了');
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
  // ---------- 网络规则（天天象棋，基于亚洲规则）特有判和 ----------
  // 仅「网络规则」体系启用；国规 2020 不设 400 步上限与重复5次/长将判和（长将属棋例裁决范畴，本程序简化为不提和即继续）
  if (ruleSet === 'net') {
    // 规则（6）：局面重复 5 次自动判和（非将非捉状态下）
    if ((posSeen.get(posKey(board)) || 0) >= 5) {
      gameOver = true;
      recordGame('draw');
      gameResult = '局面重复5次，自动判和';
      setStatus('非将非捉状态下局面重复5次，自动判和');
      showEndBanner('局面重复5次 · 和棋', true);
      return;
    }
    // 规则（3）：双方互相长将6次判和
    if (checkStreak >= 12) { // 12 个单方着法 = 双方各长将 6 回合
      gameOver = true;
      recordGame('draw');
      gameResult = '双方长将6回合，自动判和';
      setStatus('将军着法连续达到 12 着（双方各 6 回合），自动判和');
      showEndBanner('长将6回合 · 和棋', true);
      return;
    }
    // 规则（6）：总步数 400 步（200 回合）自动判和；若最后一步将死/困毙则不判和
    if (movesHistory.length >= 400) {
      // 绝杀/困毙已在前面 st.status 分支处理，此处仅对非终局做自动判和
      gameOver = true;
      recordGame('draw');
      gameResult = '超过400步（200回合）自动判和';
      setStatus('总步数超过 400 步（200 回合），自动判和');
      showEndBanner('400步上限 · 和棋', true);
      return;
    }
  }
  // 闯关预算：攻方行棋超过 N步杀+1 仍未成杀 → 失败
  if (puzzleActive && puzzleHumanMoves >= puzzleActive.movesToMate + 1) {
    gameOver = true;
    gameResult = '闯关失败，步数用尽';
    clearAuto();
    setStatus('闯关失败：超出预算步数，可重新载入再试');
    showEndBanner('闯关失败 · 步数用尽', true);
    return;
  }
  if (st.status === 'check') {
    setStatus('将军！');
    playSound('check');
  } else setStatus('');
  saveAuto(); // 未结束对局：每步落子后写入自动保存快照
  if (engineTurnNow()) engineMove();
  else if (analysisOn && !waitingFor) analyze();
}

// ---------- 自然限着（《象棋竞赛规则 2020版》4.2.4 + 快棋细则 29.1.1） ----------
// 和棋判据是客观的「连续 N 回合均未吃子」（不是主观"无胜机"）。
// 2020 版细则：专业赛事自然限着 50 回合，其中「将军」着法只计 8 着
// （连续将军阶段仅认前 8 着，超出部分不计入未吃子着法；中间插有非将军着法则重新累计）。
// 若 N 回合内未吃子 → 自然限着成立，「提和」按钮可直接判和。
// 同时 4.3 条：前 25 回合（含）内双方不得提和。
// 从 startFen 重放 movesHistory：统计末段「未吃子」着法数，将军着法按上述规则封顶。
// 自然限着回合数：网络规则固定 60（天天自然限招 120 步，60 回合）；国规用下拉（40/50/60）
function naturalLimitTurns(): number {
  return ruleSet === 'net' ? 60 : (parseInt(naturalLimitSel.value, 10) || 50);
}
function naturalLimitReached(): boolean {
  const limitTurns = naturalLimitTurns();
  const limitPly = limitTurns * 2; // 单方着法上限
  const CHECK_CAP = 8;             // 2020 版：将军着法只计 8 着
  try {
    const startBoard = parseFen(startFen).board;
    const startSide: Side = startBoard.sideToMove;
    let b = startBoard;
    let cap = 0;      // 末段连续未吃子着法计数
    let checkStreak = 0; // 连续将军阶段已计着法数（达 8 封顶）
    for (let i = 0; i < movesHistory.length; i++) {
      const mv = parseIccs(movesHistory[i]);
      if (!mv) break;
      const mover: Side = i % 2 === 0 ? startSide : (startSide === 'red' ? 'black' : 'red'); // 着法序号推导走子方（不依赖 b.sideToMove 状态）
      const isCap = b.pieces[mv.to.rank][mv.to.file] != null; // 目标格有子=吃子
      const after = applyMove(b, mv);
      const gived = inCheck(after, mover === 'red' ? 'black' : 'red'); // 走子后是否将军对方
      if (isCap) {
        cap = 0; checkStreak = 0; // 吃子重置
      } else {
        if (gived) {
          if (checkStreak < CHECK_CAP) { cap++; checkStreak++; }
          // 连续将军超出 8 着：该着法不再累计
        } else {
          cap++; checkStreak = 0; // 非将军着法正常累计，并重置将军计数
        }
      }
      b = after;
    }
    return cap >= limitPly;
  } catch { return false; }
}

// 4.3 条：前 25 回合（含）内不得提和（机机/人机通用）
const MIN_DRAW_TURNS = 25;
function withinMinDrawWindow(): boolean {
  return movesHistory.length < MIN_DRAW_TURNS * 2; // 单方着法 < 50 即仍在 25 回合窗口内
}

// ---------- 提和（自然限着 2020版 4.2.4；一方提议 + 另一方同意即和棋 4.2.1） ----------
function offerDraw() {
  if (mode !== 'play' || gameOver || puzzleActive) return;
  // 休闲简化：点击「提和」即协商判和（不计较胜负）
  if (ruleSet === 'casual') {
    gameOver = true;
    recordGame('draw');
    gameResult = '休闲模式 · 协商和棋';
    setStatus('休闲简化模式：双方同意和棋');
    showEndBanner('协商和棋', true);
    return;
  }
  // 4.3 条：前 25 回合（含）内双方不得提和（仅国规；网络规则可随时提和）
  if (ruleSet === 'guogui' && withinMinDrawWindow()) {
    setStatus(`按 2020 规则 4.3，前 ${MIN_DRAW_TURNS} 回合内不得提和（当前已 ${Math.floor(movesHistory.length / 2)} 回合）`);
    return;
  }
  if (waitingFor) { try { searchingClient.stop(); } catch { /* 引擎可能已退出 */ } waitingFor = null; clearPending(); }
  const limitTurns = naturalLimitTurns();
  if (naturalLimitReached()) {
    // 已走满 N 回合未吃子（将军着法只计 8 着）→ 自然限着成立，直接判和
    gameOver = true;
    recordGame('draw');
    gameResult = `${limitTurns}回合自然限着（将军计8着）· 判和`;
    setStatus(`连续 ${limitTurns} 回合未吃子 · 自然限着判和`);
    showEndBanner(`自然限着${limitTurns}回合 · 和棋`, true);
    return;
  }
  // 未达自然限着：判断是否"双方均无取胜可能的简单局势"（4.2.2 公认死和子力）
  if (gameMode === 'eve') {
    // 机机：你作裁判。仅当双方确无取胜可能（死和子力）或已自然限着才判和；否则不能强行提和
    if (isMaterialDraw(view.getBoard())) {
      gameOver = true; recordGame('draw');
      gameResult = '双方均无取胜可能，判和';
      setStatus('双方均无取胜可能（公认死和子力）· 判和');
      showEndBanner('无取胜可能 · 和棋', true);
      return;
    }
    setStatus(`未达自然限着（需 ${limitTurns} 回合未吃子，将军计8着）且非公认死和子力：按 2020 规则 4.2，提和需双方同意/自然限着，本局暂不能判和`);
    return;
  }
  if (gameMode === 'pvp') {
    // 人人对弈（同屏双人）：点击「提和」即双方协商同意和棋（4.2.1）
    gameOver = true;
    recordGame('draw');
    gameResult = '双方同意和棋';
    setStatus('双方同意和棋');
    showEndBanner('双方同意和棋', true);
    return;
  }
  // 人机：一方提和需对方同意（4.2.1）——引擎不占优才接受
  if (!engineReady || lastEvalRedCp === null) {
    setStatus(`尚未走满 ${limitTurns} 回合未吃子，且引擎未评估本局（先让引擎走一步再提和）`);
    return;
  }
  const engineSide: Side = humanSide === 'red' ? 'black' : 'red';
  const engineAdv = engineSide === 'red' ? lastEvalRedCp : -lastEvalRedCp;
  const accepts = lastEvalMate || engineAdv <= 100;
  if (accepts) {
    gameOver = true;
    recordGame('draw');
    gameResult = `${ENGINE_BRAND}接受提和 · 判和`;
    setStatus(`${ENGINE_BRAND}评估无胜机，接受你的提和 · 和棋`);
    showEndBanner('引擎接受提和 · 和棋', true);
  } else {
    setStatus(`${ENGINE_BRAND}评估仍有胜机，拒绝提和，请继续对弈`);
  }
}
$('btnDrawOffer').addEventListener('click', offerDraw);

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
  if (waitingFor) {
    // 引擎搜索中（分析/复盘等）：先停并丢弃旧结果，等 bestmove 回来再走子（避免搜索中发 go 被引擎忽略导致卡死）
    stopEngineThen(() => engineMove());
    return;
  }
  // 开局库直接落子（从初始局面开始且未偏离开局序列时；人机/机机均可用）
  // 弃子优先开启时禁用开局库，让引擎在开局阶段主动偏离最优着法
  const sacrificeOn = sacrificeModeChk.checked;
  const openingCategory = openingCategorySel.value as OpeningCategory;
  if (useBookOn() && startFen.split(' ')[0] === INITIAL_FEN_PART && !sacrificeOn) {
    // 按「开局类型」从开局库中随机选一条兼容开局（不限定时在全量兼容集合随机），打破固定走法
    const m = matchOpeningByCategory(movesHistory, openingCategory);
    if (m && m.next) {
      const bookMv = parseIccs(m.next);
      if (bookMv) {
        const mover = gameMode === 'eve'
          ? (view.getBoard().sideToMove === 'red' ? redNameInput.value : blackNameInput.value)
          : ENGINE_BRAND;
        setStatus(`${mover}（开局库·${m.name}）`);
        doMove(bookMv);
        return;
      }
    }
  }
  waitingFor = 'engine';
  // 机机对弈：按行棋方切换独立引擎（该侧配置了独立引擎路径时用独立实例，否则回退主引擎）；
  // 人机/人人对弈一律用主引擎
  const side = view.getBoard().sideToMove;
  client = gameMode === 'eve'
    ? (side === 'red' && clientRed !== clientMain ? clientRed
      : side === 'black' && clientBlack !== clientMain ? clientBlack
      : clientMain)
    : clientMain;
  searchingClient = client;
  // 弃子优先：开局阶段（前 10 手）强制 3 线搜索，供 onBestmove 用综合评分重选着法
  const isOpeningPhase = startFen.split(' ')[0] === INITIAL_FEN_PART && movesHistory.length < 10;
  const sacrificeMode = sacrificeOn && isOpeningPhase;
  client.setOption('MultiPV', (avoidDrawOn() || blunderProfile(getDepth()) !== null || sacrificeMode) ? 3 : 1);
  // 清掉旧局面分析数据：防止扰动/避和捡到残留 PV（浅层搜索 info 来不及覆盖多线时曾导致非法着法卡死）
  lastInfoMap.clear();
  renderAnalysis();
  // 注意：只发当前 FEN，不再叠加 moves（FEN 已是最新位置，叠加会触发引擎严格校验崩溃）
  client.position(view.getFen());
  const limit = parseInt(timeLimitSel.value, 10) || 0;
  if (limit > 0) {
    client.go({ movetime: limit });                 // 时限模式：每步固定思考时间
  } else {
    client.go({ depth: getDepth() });               // 深度模式：按当前行棋方强度
  }
  const mover = gameMode === 'eve' ? (view.getBoard().sideToMove === 'red' ? redNameInput.value : blackNameInput.value) : ENGINE_BRAND;
  setStatus(`${mover}思考中…`);
}

function analyze() {
  if (!engineReady || gameOver || engineProposal) return;
  waitingFor = 'analysis';
  // 分析固定 MultiPV 3（多线参考；引擎空闲时设置才生效，此处必然空闲）
  searchingClient = clientMain;
  clientMain.setOption('MultiPV', 3);
  lastInfoMap.clear();
  clientMain.position(view.getFen());
  clientMain.go({ depth: ANALYSIS_DEPTH });
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
  // 旧搜索作废（开新局/切模式时 stop 的结果）：不得落子，只执行挂起动作
  if (discardNextBestmove) {
    discardNextBestmove = false;
    if (discardWatchdog) { clearTimeout(discardWatchdog); discardWatchdog = null; }
    waitingFor = null;
    const action = pendingAfterAnalysis;
    pendingAfterAnalysis = null;
    if (action) action();
    return;
  }
  if (waitingFor === 'engine') {
    waitingFor = null;
    const raw = parseIccs(bm);
    if (!raw) { setStatus('引擎着法解析失败: ' + bm); return; }
    // 引擎 ICCS 坐标（rank 0=红底线）转内部坐标（rank 0=黑底线）
    let mv = engineMoveToLocal(raw);
    // 当前局面合法着法集：扰动/避和/最终兜底共用
    const legalNow = legalMoves(view.getBoard(), view.getBoard().sideToMove);
    const isLegal = (c: Move) => legalNow.some(l =>
      l.from.file === c.from.file && l.from.rank === c.from.rank &&
      l.to.file === c.to.file && l.to.rank === c.to.rank,
    );
    // ELO 扰动：低强度档概率性改走容差内的次优着法（模拟分段棋力）
    const prof = blunderProfile(getDepth());
    if (prof) {
      const bestCp = lastInfoMap.get(1)?.scoreCp ?? null;
      const cands: { mv: Move; cp: number }[] = [];
      for (const k of [1, 2, 3]) {
        const i = lastInfoMap.get(k);
        const imv = i && i.pv.length ? parseIccs(enginePvToLocal(i.pv)[0]) : null;
        if (i && imv && i.scoreCp !== null) {
          const c = engineMoveToLocal(imv);
          if (isLegal(c)) cands.push({ mv: c, cp: i.scoreCp }); // 只收当前局面合法着法
        }
      }
      const pick = pickBlunder(cands, bestCp, prof.margin, Math.random());
      if (pick) mv = pick.mv;
    }
    // 弃子优先：开局阶段（前 10 手）主动偏离最高胜率着法，倾向「吃子/将军/兑子」等精彩着法
    // 思路：引擎评分 cp 反映客观优势；以「相对最佳线的代价 price」+「吃子价值」+「是否将军」+「随机扰动」综合排序，
    //       让 AI 在评分代价可接受（≤6 兵）范围内优先选视觉冲击强的着法，棋局更精彩但棋力下降。
    if (sacrificeModeChk.checked && startFen.split(' ')[0] === INITIAL_FEN_PART && movesHistory.length < 10) {
      const board = view.getBoard();
      const cands2: { mv: Move; cp: number }[] = [];
      for (const k of [1, 2, 3]) {
        const i = lastInfoMap.get(k);
        const imv = i && i.pv.length ? parseIccs(enginePvToLocal(i.pv)[0]) : null;
        if (i && imv && i.scoreCp !== null) {
          const c = engineMoveToLocal(imv);
          if (isLegal(c)) cands2.push({ mv: c, cp: i.scoreCp });
        }
      }
      if (cands2.length >= 2) {
        const bestCp = Math.max(...cands2.map(c => c.cp));
        const PIECE_VAL: Record<string, number> = { P: 100, N: 400, R: 900, C: 450, B: 200, A: 200, K: 0 };
        const scored = cands2.map(({ mv: m, cp }) => {
          const tgt = board.pieces[m.to.rank][m.to.file];
          const capVal = tgt ? (PIECE_VAL[tgt.type] ?? 100) : 0;      // 吃掉的子价值
          const price = Math.max(0, bestCp - cp);                        // 相对最佳线的评分代价（弃子信号）
          const givesCheck = inCheck(applyMove(board, m), board.sideToMove === 'red' ? 'black' : 'red');
          // 综合分：吃子奖励 + 将军奖励 − 代价惩罚 + 随机扰动（打破固定走法）
          const score = capVal * 1.5 + (givesCheck ? 400 : 0) - price * 0.5 + Math.random() * 150;
          return { mv: m, cp, price, score };
        });
        scored.sort((a, b) => b.score - a.score);
        const top = scored[0];
        // 代价护栏：评分损失超过 6 兵（600 cp）的弃子不选，避免无脑送死
        if (top && top.mv !== mv && top.price <= 600) {
          mv = top.mv;
          const tgt = board.pieces[top.mv.to.rank][top.mv.to.file];
          setStatus(tgt
            ? `弃子优先：${moveToChinese(board, top.mv)}（吃子，评分代价 ${Math.round(top.price / 100)} 兵）`
            : `弃子优先：${moveToChinese(board, top.mv)}（非常规着法，代价 ${Math.round(top.price / 100)} 兵）`);
        }
      }
    }
    // 避和求胜：最佳着法将立即成和、且引擎不处败势时，改走评分可接受的替代着法
    // 弃子优先模式下跳过（避和会把着法往"常规求胜"拉，与创新弃子目标相悖）
    if (avoidDrawOn() && !sacrificeModeChk.checked && wouldEndInDraw(mv)) {
      const best = lastInfoMap.get(1);
      const alt = lastInfoMap.get(2);
      const altMv = alt && alt.pv.length ? parseIccs(alt.pv[0]) : null;
      const altLocal = altMv ? engineMoveToLocal(altMv) : null;
      // 引擎当前不落后超过 1 兵，且替代着法不落后超过 3 兵，才值得换着求胜
      if (altLocal && isLegal(altLocal) && (best?.scoreCp ?? 0) > -100 && (alt?.scoreCp ?? -999) > -300) {
        mv = altLocal;
        setStatus('避和求胜：改走替代着法');
      }
    }
    // 记录引擎思考分数进胜率曲线
    const best = lastInfoMap.get(1);
    if (best && best.scoreCp !== null) {
      pushCp(best.scoreCp);
      // 记录引擎方视角评估，供「提和」按钮判断引擎是否占优（4.2.2 双方均无取胜可能）
      lastEvalRedCp = toRedPersp(best.scoreCp, view.getBoard().sideToMove);
      lastEvalMate = best.scoreMate !== null;
    }
    // 着法合法性兜底：局面不同步/引擎异常时重发当前局面再思考（防着法丢失卡死）
    if (legalNow.length && !isLegal(mv)) {
      if (illegalRetry < 2) {
        illegalRetry++;
        setStatus('引擎着法校验失败，正在重新思考…');
        waitingFor = 'engine';
        searchingClient.position(view.getFen());
        searchingClient.go({ depth: getDepth() });
      } else {
        setStatus('引擎着法校验多次失败：请重启引擎或检查当前局面');
        engineProposal = null;
        view.setArrows([]);
      }
      return;
    }
    illegalRetry = 0;
    // 干预开关：不直接落子，挂起为建议着法，等人确认或改走
    if (interveneOn()) {
      engineProposal = { mv, zh: moveToChinese(view.getBoard(), mv) };
      view.setArrows([{ from: mv.from, to: mv.to, rank: 0 }]);
      view.setHighlights([mv.from, mv.to]);
      setStatus(`引擎建议：${engineProposal.zh} —— 先点该子、再点落点即可确认（或改走其他棋；取消勾选「干预引擎着法」则自动落子）`);
      return;
    }
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
    // 同步收集 LLM 复盘数据（当前局面 = fenAt(startFen, moves, reviewIdx)，与 reviewScores 对齐）
    reviewEvals.push({
      fen: fenAt(reviewRec?.startFen || startFen || '', reviewRec?.moves || movesHistory, reviewIdx),
      scoreCp: info?.scoreCp ?? null,
      scoreMate: info?.scoreMate ?? null,
      pv: info?.pv ? [...info.pv] : [],
      depth: info?.depth ?? 0,
    });
    reviewIdx++;
    reviewStep();
  } else if (waitingFor === 'hint') {
    // 残局/局面提示：引擎求解当前局面最佳着法（不落子、不入棋谱、不动胜率曲线）
    waitingFor = null;
    const raw = parseIccs(bm);
    if (raw) {
      const mv = engineMoveToLocal(raw);
      setStatus(`${ENGINE_BRAND}提示：${moveToChinese(view.getBoard(), mv)} 较优`);
    } else {
      setStatus(`${ENGINE_BRAND}提示不可用`);
    }
    // 恢复 MultiPV（分析3 / 避和2 / 普通1），避免影响后续对弈/分析
    try { clientMain.setOption('MultiPV', analysisOn ? 3 : (avoidDrawOn() ? 2 : 1)); } catch { /* 引擎可能已退出 */ }
  } else if (waitingFor === 'study') {
    // 变着研习：两段分析（走子前局面 → 实际着法后的局面），完成后汇总显示
    studyPhase();
  }
}

// ---------- 变着研习（复盘时对任一手做引擎替代着法对比） ----------
interface StudyState {
  rec: GameRecord;
  idx: number;        // 当前研究手（0..n，0=起始局面）
  phase: 0 | 1;       // 0=分析走子前局面 1=分析实际着法后局面
  beforeBest: { zh: string; cp: number | null } | null; // 走子前引擎最优
}
let study: StudyState | null = null;

// phase 0 结束（bestmove 已回来）→ 发起 phase 1；phase 1 结束 → 汇总展示
function studyPhase() {
  if (!study) { waitingFor = null; return; }
  const s = study;
  const startBoard = replayStartBoard(s.rec);
  const n = s.rec.moves.length;
  if (s.phase === 0) {
    // 记录走子前最优着法（multipv1 主变第一手 + 评分）
    const best = lastInfoMap.get(1);
    const bestMv = best && best.pv.length ? parseIccs(enginePvToLocal(best.pv)[0]) : null;
    if (best && bestMv) {
      s.beforeBest = {
        zh: moveToChinese(startBoard, bestMv),
        cp: best.scoreCp ?? null,
      };
    }
    // phase 1：若本手有实际着法，分析其走完后的局面评分
    if (s.idx < n) {
      const afterFen = fenAt(s.rec.startFen, s.rec.moves, s.idx + 1);
      s.phase = 1;
      searchingClient = clientMain;
      clientMain.position(afterFen);
      clientMain.go({ depth: 12 });
      setStatus(`变着研习：评估实际着法后的局面…`);
      return;
    }
  }
  // 汇总展示
  const actualCp = lastInfoMap.get(1)?.scoreCp ?? null;
  const sboard = replayStartBoard(s.rec);
  const actualMvIccs = s.idx < n ? s.rec.moves[s.idx] : null;
  const actualZh = actualMvIccs ? (replayMovesZh[s.idx] || actualMvIccs) : '—';
  const L: string[] = [`变着研习 · 第 ${s.idx} 手（${actualZh}）`];
  if (s.beforeBest && s.beforeBest.cp !== null) {
    L.push(`引擎最优：${s.beforeBest.zh}（+${(s.beforeBest.cp / 100).toFixed(2)}）`);
  }
  if (actualMvIccs && actualCp !== null) {
    // 实际着法损失 = 走子前最优分 + 走子后局面评分（走子方视角）
    const loss = (s.beforeBest?.cp ?? 0) + (actualCp ?? 0);
    const cls = loss > 100 ? `大亏（${(loss / 100).toFixed(2)} 兵）` : loss > 40 ? `稍亏（${(loss / 100).toFixed(2)} 兵）` : loss < -40 ? '优于引擎推荐' : '平稳';
    L.push(`实际着法：${actualZh}（走子后评分 ${(actualCp / 100).toFixed(2)} → ${cls}）`);
  } else {
    L.push('（本手无实际着法——已是最后一手）');
  }
  // 列出引擎推荐的其它候选（multipv 2/3）
  const cands: string[] = [];
  for (const k of [2, 3]) {
    const i = lastInfoMap.get(k);
    if (i && i.pv.length) {
      const m = parseIccs(enginePvToLocal(i.pv)[0]);
      if (m) cands.push(`${moveToChinese(sboard, engineMoveToLocal(m))}（${i.scoreCp !== null ? (i.scoreCp / 100).toFixed(2) : '?'}）`);
    }
  }
  if (cands.length) L.push(`替代着法：${cands.join(' / ')}`);
  setStatus(L.join(' · '));
  reviewReportEl.textContent = L.join('\n');
  waitingFor = null;
  study = null;
  try { clientMain.setOption('MultiPV', analysisOn ? 3 : (avoidDrawOn() ? 2 : 1)); } catch { /* 引擎可能已退出 */ }
}

$('btnRepStudy').addEventListener('click', () => {
  if (mode !== 'replay' || !replayRecord) { setStatus('需先进入复盘（打开棋谱或载入名局）'); return; }
  if (!engineReady) { setStatus('需先启动楚河引擎'); return; }
  if (guessMode) { setStatus('请先退出打谱训练'); return; }
  if (waitingFor) { setStatus('引擎正忙，请稍候'); return; }
  if (reviewing) { setStatus('AI 点评进行中，请先等待完成或取消'); return; }
  study = { rec: replayRecord, idx: replayIdx, phase: 0, beforeBest: null };
  waitingFor = 'study';
  searchingClient = clientMain;
  clientMain.setOption('MultiPV', 3);
  lastInfoMap.clear();
  clientMain.position(fenAt(replayRecord.startFen, replayRecord.moves, replayIdx));
  clientMain.go({ depth: 12 });
  setStatus(`变着研习：分析第 ${replayIdx} 手局面…`);
});

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
function playSquareClick(s: Square) {
  if (mode !== 'play' || gameOver || waitingFor || reviewing) return;
  const board = view.getBoard();
  // 干预模式：引擎行棋但着法已挂起——人替引擎确认/改走（人机、机机通用）
  // 机机对弈未开干预时 engineProposal 恒为空，直接 return（人不落子）
  if (gameMode === 'eve' || (gameMode === 'pve' && board.sideToMove !== humanSide)) {
    if (!engineProposal) return; // 引擎仍在思考或未开干预
    const p = board.pieces[s.rank][s.file];
    if (selected) {
      const hit = targets.find(m => m.to.file === s.file && m.to.rank === s.rank);
      if (hit) { confirmEngineMove(hit); return; }
    }
    if (p && p.side === board.sideToMove) {
      selected = s;
      targets = legalMovesFrom(board, s);
      view.setHighlights(targets.map(m => m.to));
    } else {
      selected = null;
      targets = [];
      view.setHighlights([]);
    }
    return;
  }
  if (selected) {
    const hit = targets.find(m => m.to.file === s.file && m.to.rank === s.rank);
    if (hit) { doMove(hit); return; }
  }
  // 人人对弈：双方均为人走子（点己方棋子）；人机：仅 humanSide 可走
  const mySide = gameMode === 'pve' ? humanSide : board.sideToMove;
  const p = board.pieces[s.rank][s.file];
  if (p && p.side === mySide) {
    selected = s;
    targets = legalMovesFrom(board, s);
    view.setHighlights(targets.map(m => m.to));
  } else {
    selected = null;
    targets = [];
    view.setHighlights([]);
  }
}
view.onSquare = playSquareClick;

// 干预确认：mv 为引擎建议或人改走的着法，清挂起并落子
function confirmEngineMove(mv: Move) {
  const prop = engineProposal;
  const same = prop && mv.from.file === prop.mv.from.file && mv.from.rank === prop.mv.from.rank
    && mv.to.file === prop.mv.to.file && mv.to.rank === prop.mv.to.rank;
  const zh = moveToChinese(view.getBoard(), mv);
  engineProposal = null;
  view.setArrows([]);
  view.setHighlights([]);
  setStatus(same ? `采纳引擎着法：${zh}` : `手动改走：${zh}`);
  doMove(mv);
}

// 干预开关：关闭时若引擎建议已挂起，立即按建议落子恢复自动
interveneChk.addEventListener('change', () => {
  if (!interveneChk.checked && engineProposal) {
    const p = engineProposal;
    engineProposal = null;
    doMove(p.mv);
  }
});

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
    const red = redNameInput.value || '红方·楚河';
    const black = blackNameInput.value || '黑方·楚河';
    if (gameOver) {
      const winner = view.getBoard().sideToMove === 'red' ? black : red;
      return `${red} vs ${black} · ${winner}胜`;
    }
    return `${red} vs ${black} · ${turn}行棋`;
  }
  if (gameMode === 'pvp') {
    if (gameOver) return '对局结束';
    return `人人对弈 · ${turn}行棋`;
  }
  if (gameOver) return '对局结束';
  const who = turn === (humanSide === 'red' ? '红方' : '黑方') ? '你' : ENGINE_BRAND;
  return `对弈中 · ${turn}行棋（${who}）`;
}

$('btnMode').addEventListener('click', async () => {
  if (mode === 'replay') return; // 复盘中：先退出复盘再切换模式
  if (reviewing) cancelReview();
  if (mode === 'edit') {
    // 「开始」：先确保引擎就绪（自动启动内置主引擎 + 红/黑配置的独立引擎），失败则不进入对弈
    const ok = await ensureEngines();
    if (!ok) return;
    mode = 'play';
    ($('btnMode') as HTMLButtonElement).textContent = '返回编辑';
    view.onSquare = playSquareClick; // 复盘/打谱后恢复棋盘落子
    gameMode = gameModeSel.value as 'pve' | 'pvp' | 'eve';
    humanSide = sideSelect.value as Side;
    gameOver = false;
    gameResult = '';
    movesHistory = [];
    movesZhLive = [];
    startFen = view.getFen();          // 保留当前棋盘局面（初始或编辑模式摆好）开始对弈
    engineProposal = null;
    view.setArrows([]);
    flipManual = null; applyFlip(); // 恢复默认视角（人执黑自动翻转）
    resetClock();
    updateSideRows();
    moveListEl.style.display = 'block';
    reviewRow.style.display = 'flex';
    llmRow.style.display = 'flex';
    renderMoveList(movesHistory, movesZhLive, 0, false);
    updateOpeningName();
    setStatus('');
    // 按当前模式直接开下
    if (gameMode === 'eve') { setStatus('机机对弈开始：红方先行'); }
    if (engineTurnNow()) engineMove();
    else if (analysisOn) analyze();
  } else {
    mode = 'edit';
    loopActive = false;
    ($('btnMode') as HTMLButtonElement).textContent = '开始';
    view.onSquare = null;
    if (waitingFor) stopEngineThen(() => {}); // 停掉残留搜索（analysis/engine/review 一律作废旧结果）
    waitingFor = null;
    engineProposal = null;
    view.setArrows([]);
    turnStart = null; // 停止计时
    hideEndBanner();
    moveListEl.style.display = 'none';
    moveListEl.innerHTML = '';
    reviewRow.style.display = 'none';
    llmRow.style.display = 'none';
    reviewReportEl.textContent = '';
    reviewMarks = [];
    setStatus('');
    setMenu('menuEdit'); // 编辑模式自动展开编辑棋盘工具
  }
});

// ---------- 顶部菜单（循环赛 / 编辑棋盘 / 关于） ----------
const menuEntries = [
  ['menuLoopBtn', 'menuLoop'],
  ['menuEditBtn', 'menuEdit'],
  ['menuAboutBtn', 'menuAbout'],
] as const;
let openMenu: string | null = null;
function setMenu(which: string | null) {
  openMenu = which;
  for (const [b, p] of menuEntries) {
    ($(b) as HTMLElement).classList.toggle('active', which === p);
    ($(p) as HTMLElement).style.display = which === p ? 'block' : 'none';
  }
}
for (const [b, p] of menuEntries) {
  ($(b) as HTMLElement).addEventListener('click', ev => {
    ev.stopPropagation();
    setMenu(openMenu === p ? null : p);
  });
  // 面板内点击不关闭菜单（输入局数等）
  ($(p) as HTMLElement).addEventListener('click', ev => ev.stopPropagation());
}
document.addEventListener('click', () => setMenu(null));

$('btnNew').addEventListener('click', () => { if (mode === 'play') newGame(); });
// 翻转棋盘：手动切换上下视角（再次点击恢复默认视角）
$('btnFlip').addEventListener('click', () => {
  // 循环切换视角：默认 → 上下翻转 → 左右翻转 → 默认（按钮文字随状态变化）
  const cur = effectiveFlip();
  flipManual = cur === 'none' ? 'ud' : cur === 'ud' ? 'lr' : null;
  applyFlip();
  const m = effectiveFlip();
  setStatus(m === 'ud' ? '视角：红方在上（上下翻转）' : m === 'lr' ? '视角：左右翻转（镜像）' : '视角：红方在下（默认）');
});
refreshFlipBtn(); // 初始化翻转按钮文字（默认/上下/左右循环切换）

// ---------- 悔棋分叉：撤销前把当前对局保存为变着分支（localStorage，最多 20 条） ----------
const BRANCH_KEY = 'xz_branches';
function saveBranch() {
  if (mode !== 'play' || movesHistory.length < 2) return; // 至少两手才值得记分支
  try {
    let startBoard;
    try { startBoard = parseFen(startFen).board; } catch { startBoard = initialBoard(); }
    const arr = JSON.parse(localStorage.getItem(BRANCH_KEY) || '[]') as (GameRecord & { ts: number })[];
    arr.unshift({
      app: 'xiangqi-ai', version: 2,
      date: new Date().toISOString(),
      startFen, mode: gameMode,
      redName: sideName('red'), blackName: sideName('black'),
      moves: [...movesHistory],
      movesZh: movesToChinese(startBoard, movesHistory),
      result: '悔棋分支（未结束）',
      ts: Date.now(),
    });
    while (arr.length > 20) arr.pop();
    localStorage.setItem(BRANCH_KEY, JSON.stringify(arr));
    setStatus('已记录悔棋前的变着分支（可在「变着记录」中载入复盘）');
  } catch { /* 忽略 */ }
}
// 渲染变着分支列表：时间 / 手数 / 红黑名，可载入复盘或删除
$('btnBranches').addEventListener('click', () => {
  const el = $('branchesList') as HTMLDivElement;
  let arr: (GameRecord & { ts: number })[] = [];
  try { arr = JSON.parse(localStorage.getItem(BRANCH_KEY) || '[]'); } catch { /* 忽略 */ }
  if (!arr.length) { el.textContent = '暂无变着分支（悔棋时自动记录原对局）'; return; }
  el.innerHTML = '';
  arr.forEach((rec, i) => {
    const d = new Date(rec.ts || Date.now());
    const line = document.createElement('div');
    const info = document.createElement('span');
    info.textContent = `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')} · ${rec.redName} vs ${rec.blackName} · ${rec.moves.length}手`;
    const btnLoad = document.createElement('button');
    btnLoad.textContent = '载入复盘';
    btnLoad.style.marginLeft = '6px';
    btnLoad.addEventListener('click', () => {
      enterReplay({ ...rec, result: rec.result || '对局结束' });
      setStatus('已载入变着分支复盘');
    });
    const btnDel = document.createElement('button');
    btnDel.textContent = '删除';
    btnDel.style.marginLeft = '6px';
    btnDel.addEventListener('click', () => {
      arr.splice(i, 1);
      localStorage.setItem(BRANCH_KEY, JSON.stringify(arr));
      ($('btnBranches') as HTMLButtonElement).click();
    });
    line.appendChild(info);
    line.appendChild(btnLoad);
    line.appendChild(btnDel);
    el.appendChild(line);
  });
});

$('btnUndo').addEventListener('click', () => {
  // 悔棋：人机撤销人机各一步（回退到人类行棋局面）；人人对弈撤销双方各一步；机机对弈不支持悔棋
  if (mode !== 'play' || gameMode === 'eve' || movesHistory.length === 0 || waitingFor || reviewing) return;
  saveBranch(); // 悔棋分叉：先记录当前对局快照
  // 干预挂起的建议着法随局面作废
  if (engineProposal) { engineProposal = null; view.setArrows([]); }
  const undoCount = gameMode === 'pvp' ? 2 : (view.getBoard().sideToMove === humanSide ? 2 : 1);
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
  lastEvalRedCp = null; lastEvalMate = false;
  reviewMarks = [];
  reviewReportEl.textContent = '';
  renderMoveList(movesHistory, movesZhLive, movesHistory.length, false);
  setStatus('');
  if (engineTurnNow()) engineMove();
  else if (analysisOn) analyze();
});

// 帮机悔棋：撤销引擎刚走的一步（回到人行棋局面），不自动重走，等人确认后点「帮机重走」
$('btnUndoEngine').addEventListener('click', () => {
  if (mode !== 'play' || gameMode === 'pvp' || movesHistory.length === 0 || waitingFor || reviewing) return;
  saveBranch(); // 悔棋分叉：先记录当前对局快照
  // 干预挂起（引擎已想好但未落子）：直接作废建议即可
  if (engineProposal) {
    engineProposal = null;
    view.setArrows([]);
    view.setHighlights([]);
    setStatus('已取消引擎建议着法');
    return;
  }
  const board = view.getBoard();
  // pve：仅当轮到人行棋（引擎刚走完）时才存在「引擎的最后一步」可撤
  if (gameMode === 'pve' && board.sideToMove !== humanSide) {
    setStatus('当前轮到引擎行棋，没有可撤销的引擎着法');
    return;
  }
  movesHistory.pop();
  movesZhLive.pop();
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
  lastEvalRedCp = null; lastEvalMate = false;
  view.setLastMove(null, null);
  view.setCheck(null);
  view.setArrows([]);
  renderMoveList(movesHistory, movesZhLive, movesHistory.length, false);
  setStatus('已撤销引擎着法 —— 点「帮机重走」让引擎重新思考');
});

// 帮机重走：让引擎（重新）思考当前局面并走一步（人机/机机通用；人人对弈无引擎可重走）
$('btnRedoEngine').addEventListener('click', () => {
  if (mode !== 'play' || gameOver || !engineReady) { setStatus('需在对弈模式且引擎已启动'); return; }
  if (gameMode === 'pvp') { setStatus('人人对弈无引擎可重走'); return; }
  if (!engineTurnNow()) { setStatus('当前轮到人行棋，引擎不行动'); return; }
  if (engineProposal) { engineProposal = null; view.setArrows([]); view.setHighlights([]); }
  engineMove(); // engineMove 内部自行处理搜索中串行化（stopEngineThen）
});

// 内置引擎（相对 gui 目录；主进程 resolveEnginePath 兼容 dev/打包两种布局）
const DEFAULT_ENGINE = '../engine/engine-x64.exe';

// 机机对弈独立引擎：按槽位启动独立 UciClient + 引擎进程（失败回退主引擎，不影响整体可用）
async function startSlotEngine(slot: 'red' | 'black', exePath: string): Promise<UciClient | null> {
  if (!engineApi || !exePath) return null;
  const c = new UciClient(cmd => engineApi.write(slot, cmd));
  c.onBestmove = onBestmoveH;
  c.onInfo = onInfoH;
  try {
    await engineApi.start(slot, exePath);
    c.uci();
    const threads = threadsValue();
    c.setOption('Threads', threads);
    c.setOption('Hash', parseInt(hashSel.value, 10) || 512);
    // 网文件已重命名为 eval.nnue（去品牌化），独立引擎同样必须设置，否则首次 go 即崩溃退出
    c.setOption('EvalFile', 'eval.nnue');
    c.isready();
    return c;
  } catch (err) {
    setStatus(`${slot === 'red' ? '红方' : '黑方'}独立引擎启动失败：${(err as Error).message}（该侧回退内置引擎）`);
    return null;
  }
}

// 确保引擎就绪：主引擎（分析/点评用）+ 红/黑配置的独立引擎；幂等，可重复调用
async function ensureEngines(): Promise<boolean> {
  if (engineReady) return true;
  if (!engineApi) { setStatus('浏览器模式不支持引擎（需 Electron）'); return false; }
  try {
    await engineApi.start('main', DEFAULT_ENGINE);
    clientMain.uci();
    // 引擎参数按配置面板应用：线程（自动 = 核心数-2）、哈希（MB）
    const threads = threadsValue();
    clientMain.setOption('Threads', threads);
    clientMain.setOption('Hash', parseInt(hashSel.value, 10) || 512);
    // 网文件已被重命名为 eval.nnue（去品牌化），而引擎默认找 pikafish.nnue，
    // 不设置会在首次 go 时直接报错退出（The engine will be terminated now）
    clientMain.setOption('EvalFile', 'eval.nnue');
    clientMain.isready();
    engineReady = true;
    // 红/黑独立引擎：留空则各该侧共用主引擎
    const redPath = redEnginePathInp.value.trim();
    const blackPath = blackEnginePathInp.value.trim();
    const cRed = await startSlotEngine('red', redPath);
    if (cRed) clientRed = cRed;
    const cBlack = await startSlotEngine('black', blackPath);
    if (cBlack) clientBlack = cBlack;
    client = clientMain;
    searchingClient = clientMain;
    setStatus('');
    return true;
  } catch (err) {
    setStatus('引擎启动失败: ' + ((err as Error).message || String(err)));
    return false;
  }
}

$('btnAnalysis').addEventListener('click', () => {
  analysisOn = !analysisOn;
  ($('btnAnalysis') as HTMLButtonElement).textContent = analysisOn ? '关闭分析' : '开启分析';
  if (!analysisOn) view.setArrows([]); // 关分析清掉推荐箭头
  // 分析用 MultiPV 3（多线参考）；对弈避和开启时用 2，关闭时 1（单线全速）
  if (engineReady) clientMain.setOption('MultiPV', analysisOn ? 3 : (avoidDrawOn() ? 2 : 1));
  if (analysisOn && !waitingFor && mode === 'play' && gameMode === 'pve' && !gameOver) analyze();
});

function getDepth(): number {
  // 机机对弈：按行棋方各自的强度档；人机：用引擎侧（非你执方）的强度档
  const side = view.getBoard().sideToMove;
  const sel = gameMode === 'eve'
    ? (side === 'red' ? redStrengthSel : blackStrengthSel)
    : (humanSide === 'red' ? blackStrengthSel : redStrengthSel);
  return Math.max(1, Math.min(40, parseInt(sel.value, 10) || 24));
}

sideSelect.addEventListener('change', () => {
  humanSide = sideSelect.value as Side;
  // 人执黑时翻转棋盘（随时预览）；换边后复位手动翻转
  flipManual = null; applyFlip();
  // 换边保留当前棋局（不重置）：轮到新执方继续
  // 换边后旧引擎评估作废（提和判定基于最新评估）
  lastEvalRedCp = null; lastEvalMate = false;
  if (mode === 'play' && gameMode === 'pve' && !gameOver) {
    if (waitingFor) stopEngineThen(() => { if (engineTurnNow()) engineMove(); });
    else if (engineTurnNow()) engineMove();
    else if (analysisOn) analyze();
    else setStatus('');
  }
});

// 红/黑行角色与可用性：布局固定不变，仅按模式调整「引擎/你/玩家」与强度/引擎设置可用性
function updateSideRows() {
  const gm = gameModeSel.value as 'pve' | 'pvp' | 'eve';
  const hs = sideSelect.value as Side;
  const redIsHuman = gm === 'pve' && hs === 'red';
  const blackIsHuman = gm === 'pve' && hs === 'black';
  const pvp = gm === 'pvp';
  redRoleEl.textContent = pvp ? '玩家' : redIsHuman ? '你' : '引擎';
  blackRoleEl.textContent = pvp ? '玩家' : blackIsHuman ? '你' : '引擎';
  redStrengthSel.disabled = pvp || redIsHuman;
  blackStrengthSel.disabled = pvp || blackIsHuman;
  redEngToggle.disabled = pvp || redIsHuman;
  blackEngToggle.disabled = pvp || blackIsHuman;
}
// 引擎设置折叠（默认收起；仅该侧为引擎时可展开）
const engBoxOpen = { red: false, black: false };
redEngToggle.addEventListener('click', () => {
  engBoxOpen.red = !engBoxOpen.red;
  redEngBox.style.display = engBoxOpen.red ? 'flex' : 'none';
});
blackEngToggle.addEventListener('click', () => {
  engBoxOpen.black = !engBoxOpen.black;
  blackEngBox.style.display = engBoxOpen.black ? 'flex' : 'none';
});
updateSideRows();
sideSelect.addEventListener('change', updateSideRows);

gameModeSel.addEventListener('change', () => {
  gameMode = gameModeSel.value as 'pve' | 'pvp' | 'eve';
  loopActive = false; // 切换模式取消循环赛
  // 切换模式保留棋局：旧引擎评估作废（提和判定基于最新评估）
  lastEvalRedCp = null; lastEvalMate = false;
  updateSideRows(); // 侧行角色/可用性随模式刷新（布局不变）
  if (gameMode === 'eve') { flipManual = null; applyFlip(); } // 机机对弈固定红下视角
  else if (gameMode === 'pvp') { flipManual = null; applyFlip(); } // 人人对弈默认红下视角
  // 切换模式保留当前棋局（不重置）：按新模式继续对弈
  if (mode === 'play' && !gameOver) {
    if (waitingFor) stopEngineThen(() => { if (engineTurnNow()) engineMove(); });
    else if (engineTurnNow()) engineMove();
    else if (analysisOn) analyze();
    else setStatus('');
  } else setStatus('');
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
  marks?: (string | null)[]; // AI 点评标记（与 moves 对齐，v3 起保存）
  review?: string;           // AI 点评 ACPL 汇总文本
  humanSide?: Side;          // 人机模式玩家执方（自动保存快照用）
  ts?: number;               // 快照/分支时间戳
}

const replayRow = $('replayRow') as HTMLDivElement;
const replayLabel = $('replayLabel') as HTMLDivElement;
const moveListEl = $('moveList') as HTMLDivElement;
let replayRecord: GameRecord | null = null;
let replayIdx = 0;                       // 当前回放到第几步（0=起始局面）
let replayTimer: number | null = null;
let replayMovesZh: string[] = [];        // 每步中文记谱

function sideName(side: Side): string {
  if (gameMode === 'eve') return side === 'red' ? (redNameInput.value || '红方·楚河') : (blackNameInput.value || '黑方·楚河');
  if (gameMode === 'pvp') return side === 'red' ? '红方玩家' : '黑方玩家';
  return side === humanSide ? '玩家' : ENGINE_BRAND;
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
  if (guessMode) parts.push(`打谱一次答对 ${guessFirst}/${guessAnswered}`);
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
  // 已点评则随棋谱保存（载入复盘可直接显示标记与 ACPL）
  if (reviewMarks.length === movesHistory.length) {
    rec.marks = [...reviewMarks];
    const rt = reviewReportEl.textContent;
    if (rt && rt !== 'AI点评中…' && rt !== '已取消点评') rec.review = rt;
  }
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
  clearAuto(); // 终局：移除自动保存快照
  try {
    const arr = JSON.parse(localStorage.getItem(REC_KEY) || '[]') as StatRecord[];
    arr.push({
      mode: gameMode,
      humanSide: gameMode === 'pve' ? humanSide : null,
      winner,
      strength: gameMode === 'pve' ? (humanSide === 'red' ? blackStrengthSel.value : redStrengthSel.value) : null,
    });
    while (arr.length > 500) arr.shift();
    localStorage.setItem(REC_KEY, JSON.stringify(arr));
  } catch { /* 忽略 */ }
  // 循环赛计分与续局
  if (loopActive) {
    loopScores[winner === 'draw' ? 'draw' : winner]++;
    loopDone++;
    updateLoopReport();
    if (loopDone >= loopTotal) {
      loopActive = false;
      updateLoopReport(true);
      setStatus(`循环赛完成：红 ${loopScores.red} 胜 · 黑 ${loopScores.black} 胜 · 和 ${loopScores.draw}`);
    } else {
      setTimeout(() => {
        if (loopActive && mode === 'play' && gameMode === 'eve' && !waitingFor) newGame();
      }, 600);
    }
  }
}

function renderStats() {
  let arr: StatRecord[] = [];
  try { arr = JSON.parse(localStorage.getItem(REC_KEY) || '[]') as StatRecord[]; } catch { /* 忽略 */ }
  if (!arr.length) { statsReportEl.textContent = '暂无战绩'; return; }
  const pve = arr.filter(r => r.mode === 'pve');
  const eve = arr.filter(r => r.mode === 'eve');
  const pvp = arr.filter(r => r.mode === 'pvp');
  const lines: string[] = [`共 ${arr.length} 局（人机 ${pve.length} · 机机 ${eve.length} · 人人 ${pvp.length}）`];
  if (pve.length) {
    const win = pve.filter(r => r.winner === r.humanSide).length;
    const draw = pve.filter(r => r.winner === 'draw').length;
    const loss = pve.length - win - draw;
    lines.push(`人机对弈：胜 ${win} · 和 ${draw} · 负 ${loss}（胜率 ${((win / pve.length) * 100).toFixed(0)}%）`);
    // 按强度档统计（胜/局） + 棋力估算
    const byStrength = new Map<string, { w: number; l: number; n: number }>();
    for (const r of pve) {
      const k = String(r.strength ?? '?');
      const s = byStrength.get(k) || { w: 0, l: 0, n: 0 };
      s.n++;
      if (r.winner === r.humanSide) s.w++;
      else if (r.winner !== 'draw') s.l++;
      byStrength.set(k, s);
    }
    const order = ['1', '2', '3', '5', '8', '12', '18', '24'];
    const parts = order.filter(k => byStrength.has(k)).map(k => `${k}层:${byStrength.get(k)!.w}/${byStrength.get(k)!.n}`);
    if (parts.length) lines.push(`分档胜/局：${parts.join(' · ')}`);
    const est = estimateElo(order
      .filter(k => byStrength.has(k))
      .map(k => ({ elo: DEPTH_ELO[k] ?? 0, win: byStrength.get(k)!.w, loss: byStrength.get(k)!.l, games: byStrength.get(k)!.n })));
    if (est) lines.push(`棋力参考：约 ${est}（各档 ≥3 局参与估算）`);
  }
  if (eve.length) {
    const redWin = eve.filter(r => r.winner === 'red').length;
    const draw = eve.filter(r => r.winner === 'draw').length;
    lines.push(`机机对弈：红胜 ${redWin} · 和 ${draw} · 黑胜 ${eve.length - redWin - draw}`);
  }
  if (pvp.length) {
    const redWin = pvp.filter(r => r.winner === 'red').length;
    const draw = pvp.filter(r => r.winner === 'draw').length;
    lines.push(`人人对弈：红胜 ${redWin} · 和 ${draw} · 黑胜 ${pvp.length - redWin - draw}`);
  }
  statsReportEl.textContent = lines.join('\n');
}

$('btnStats').addEventListener('click', renderStats);
$('btnStatsClear').addEventListener('click', () => {
  try { localStorage.removeItem(REC_KEY); } catch { /* 忽略 */ }
  statsReportEl.textContent = '已清空';
});

// ---------- 自动机机循环赛 ----------
const loopCountInput = $('loopCount') as HTMLInputElement;
const loopReportEl = $('loopReport') as HTMLDivElement;
let loopActive = false;
let loopTotal = 0;
let loopDone = 0;
let loopScores = { red: 0, black: 0, draw: 0 };

function updateLoopReport(final = false) {
  loopReportEl.textContent = `循环赛 ${loopDone}/${loopTotal} — 红 ${loopScores.red} · 黑 ${loopScores.black} · 和 ${loopScores.draw}${final ? ' · 已完成' : ''}`;
}

$('btnLoopStart').addEventListener('click', () => {
  if (loopActive) return;
  if (mode !== 'play' || gameMode !== 'eve' || !engineReady) {
    setStatus('循环赛需在机机对弈模式并启动引擎后进行');
    return;
  }
  // 必须人为填写局数才循环；不设置则不开（无默认局数）
  const n = parseInt(loopCountInput.value, 10);
  if (!n || n < 2) {
    setStatus('请先在顶部「循环赛」菜单填写自动对弈局数（2~200 局）');
    return;
  }
  loopTotal = Math.min(200, n);
  loopDone = 0;
  loopScores = { red: 0, black: 0, draw: 0 };
  loopActive = true;
  updateLoopReport();
  newGame();
});

$('btnLoopStop').addEventListener('click', () => {
  if (!loopActive) return;
  loopActive = false;
  updateLoopReport();
  setStatus('循环赛已停止');
});

// ---------- 棋盘皮肤 ----------
const themeSel = $('themeSel') as HTMLSelectElement;
for (const [k, v] of Object.entries(BOARD_THEMES)) {
  themeSel.add(new Option(v.name, k));
}
(function initTheme() {
  let saved = 'classic';
  try { saved = localStorage.getItem('xz_theme') || 'classic'; } catch { /* 忽略 */ }
  if (BOARD_THEMES[saved]) {
    themeSel.value = saved;
    view.setThemeByName(saved);
  }
})();
themeSel.addEventListener('change', () => {
  view.setThemeByName(themeSel.value);
  try { localStorage.setItem('xz_theme', themeSel.value); } catch { /* 忽略 */ }
});

// ---------- 界面主题（深色默认 / 浅色 / 跟随系统，localStorage 持久化） ----------
const uiThemeSel = $('uiTheme') as HTMLSelectElement;
const UI_THEME_KEY = 'xz_ui_theme';
function applyUiTheme(mode: string) {
  let actual: string;
  if (mode === 'light') actual = 'light';
  else if (mode === 'auto') actual = window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  else actual = 'dark';
  document.documentElement.dataset.theme = actual;
}
(function initUiTheme() {
  let saved = 'auto';
  try { saved = localStorage.getItem(UI_THEME_KEY) || 'auto'; } catch { /* 忽略 */ }
  if (!['auto', 'dark', 'light'].includes(saved)) saved = 'auto';
  uiThemeSel.value = saved;
  applyUiTheme(saved);
})();
uiThemeSel.addEventListener('change', () => {
  applyUiTheme(uiThemeSel.value);
  try { localStorage.setItem(UI_THEME_KEY, uiThemeSel.value); } catch { /* 忽略 */ }
});
// 跟随系统：系统主题变化时实时切换
window.matchMedia('(prefers-color-scheme: light)').addEventListener('change', () => {
  if (uiThemeSel.value === 'auto') applyUiTheme('auto');
});

// ---------- 自定义棋盘底纹（本地图片 → dataURL，localStorage 持久化） ----------
const BG_KEY = 'xz_board_bg';
const bgFileInput = $('bgFile') as HTMLInputElement;
const btnBgPick = $('btnBgPick') as HTMLButtonElement;
const btnBgClear = $('btnBgClear') as HTMLButtonElement;
function applyBoardBg() {
  let url = '';
  try { url = localStorage.getItem(BG_KEY) || ''; } catch { /* 忽略 */ }
  view.setCustomBg(url || null);
  btnBgClear.style.display = url ? '' : 'none';
}
bgFileInput.addEventListener('change', () => {
  const f = bgFileInput.files?.[0];
  if (!f) return;
  const rd = new FileReader();
  rd.onload = () => {
    const url = String(rd.result || '');
    try { localStorage.setItem(BG_KEY, url); } catch { setStatus('图片过大，无法保存底纹（建议 <2MB）'); return; }
    applyBoardBg();
    setStatus('已应用自定义棋盘底纹');
  };
  rd.readAsDataURL(f);
  bgFileInput.value = '';
});
btnBgPick.addEventListener('click', () => bgFileInput.click());
btnBgClear.addEventListener('click', () => {
  try { localStorage.removeItem(BG_KEY); } catch { /* 忽略 */ }
  applyBoardBg();
  setStatus('已恢复默认棋盘');
});
applyBoardBg();

// ---------- 快捷键（可自定义键位绑定，localStorage 持久化） ----------
const KEYS_KEY = 'xz_hotkeys';
const DEFAULT_KEYS = {
  undo: 'ctrl+z', flip: 'f', snap: 's', new: 'n',
  repPrev: 'left', repNext: 'right', repPlay: 'space', repStudy: 'k',
} as const;
const KEY_LABELS: Record<string, string> = {
  undo: '悔棋', flip: '翻转棋盘', snap: '导出局面图', new: '新对局',
  repPrev: '复盘上一手', repNext: '复盘下一手', repPlay: '复盘播放/停', repStudy: '变着研习',
};
const KEY_BUTTONS: Record<string, string> = {
  undo: 'btnUndo', flip: 'btnFlip', snap: 'btnSnap', new: 'btnNew',
  repPrev: 'btnRepPrev', repNext: 'btnRepNext', repPlay: 'btnRepPlay', repStudy: 'btnRepStudy',
};
const KEY_MAP: Record<string, string> = {
  ' ': 'space', 'arrowleft': 'left', 'arrowright': 'right', 'arrowup': 'up', 'arrowdown': 'down',
  'escape': 'esc', 'enter': 'enter', 'backspace': 'backspace', 'delete': 'del',
};
// 按键事件 → 规范化键位串（小写，修饰键 + 主键）
function keyToStr(e: KeyboardEvent): string {
  const mods = (e.ctrlKey ? 'ctrl+' : '') + (e.metaKey ? 'meta+' : '') + (e.altKey ? 'alt+' : '') + (e.shiftKey ? 'shift+' : '');
  const k = e.key.toLowerCase();
  if (k === 'control' || k === 'meta' || k === 'alt' || k === 'shift') return '';
  const key = KEY_MAP[k] || k;
  return mods + key;
}
function loadKeys(): Record<string, string> {
  try {
    const v = JSON.parse(localStorage.getItem(KEYS_KEY) || '{}');
    return { ...DEFAULT_KEYS, ...(typeof v === 'object' && v ? v : {}) };
  } catch { return { ...DEFAULT_KEYS }; }
}
let keys = loadKeys();
function saveKeys() { try { localStorage.setItem(KEYS_KEY, JSON.stringify(keys)); } catch { /* 忽略 */ } }
const shortcutRows = $('shortcutRows') as HTMLDivElement;
function renderShortcutRows() {
  shortcutRows.innerHTML = '';
  const ids = Object.keys(DEFAULT_KEYS) as (keyof typeof DEFAULT_KEYS)[];
  for (const id of ids) {
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;align-items:center;gap:6px';
    const lab = document.createElement('span');
    lab.textContent = KEY_LABELS[id] || id;
    lab.style.cssText = 'font-size:12px;color:var(--note);width:88px;flex-shrink:0;overflow:hidden;text-overflow:ellipsis';
    const inp = document.createElement('input');
    inp.type = 'text';
    inp.readOnly = true;
    inp.value = keys[id] || '（禁用）';
    inp.title = '点击后按组合键重新绑定；按 Esc 或 Del 清除（禁用该快捷键）';
    inp.style.cssText = 'flex:1;min-width:0;cursor:pointer;font-size:12px';
    inp.addEventListener('focus', () => { inp.value = '按下组合键…'; });
    inp.addEventListener('keydown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === 'Escape' || e.key === 'Delete') keys[id] = '';
      else {
        const s = keyToStr(e);
        if (s) keys[id] = s;
      }
      inp.value = keys[id] || '（禁用）';
      inp.blur();
      saveKeys();
    });
    inp.addEventListener('blur', () => { inp.value = keys[id] || '（禁用）'; });
    row.append(lab, inp);
    shortcutRows.append(row);
  }
}
renderShortcutRows();
$('btnKeysReset').addEventListener('click', () => {
  keys = { ...DEFAULT_KEYS };
  saveKeys();
  renderShortcutRows();
  setStatus('快捷键已恢复默认');
});
// 全局快捷键分发：输入框聚焦时让位（编辑 FEN / 名称 / 键位录入）
window.addEventListener('keydown', (e) => {
  const tag = (e.target as HTMLElement | null)?.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
  const id = (Object.keys(keys) as (keyof typeof DEFAULT_KEYS)[]).find(k => keys[k] && keyToStr(e) === keys[k]);
  if (!id) return;
  e.preventDefault();
  const btn = $(KEY_BUTTONS[id]);
  if (btn) (btn as HTMLButtonElement).click();
});

// ---------- 开局库：PGN 导入（本地自定义开局，localStorage 持久化） ----------
const BOOK_KEY = 'xz_custom_book';
function loadCustomBook(): Opening[] {
  try {
    const v = JSON.parse(localStorage.getItem(BOOK_KEY) || '[]');
    return Array.isArray(v) ? v : [];
  } catch { return []; }
}
function saveCustomBook(list: Opening[]) {
  try { localStorage.setItem(BOOK_KEY, JSON.stringify(list)); } catch { /* 忽略 */ }
  setCustomOpenings(list);
  updateBookCount(list);
}
const bookFileInput = $('bookFile') as HTMLInputElement;
const btnBookImport = $('btnBookImport') as HTMLButtonElement;
const btnBookClear = $('btnBookClear') as HTMLButtonElement;
const bookCountEl = $('bookCount') as HTMLSpanElement;
function updateBookCount(list: Opening[]) {
  const n = list.length;
  bookCountEl.textContent = n ? `已导入 ${n} 条` : '';
  btnBookClear.style.display = n ? '' : 'none';
}
bookFileInput.addEventListener('change', () => {
  const f = bookFileInput.files?.[0];
  if (!f) return;
  const rd = new FileReader();
  rd.onload = () => {
    try {
      const meta = parsePgn(String(rd.result || ''));
      // 只收录从初始局面开始的对局；着法不足 2 手无法作为开局
      if (meta.startFen.trim().split(/\s+/)[0] !== INITIAL_FEN_PART) {
        setStatus('仅支持从初始局面开始的对局 PGN（未用 FEN 变例开局）');
        return;
      }
      if (meta.moves.length < 2) { setStatus('PGN 着法太少（至少 2 手），无法作为开局'); return; }
      const moves = meta.moves.slice(0, Math.min(12, meta.moves.length)); // 最多 12 半手，保证后续可复用
      const base = f.name.replace(/\.(pgn|txt)$/i, '');
      const name = base || (meta.redName && meta.blackName ? `${meta.redName}对${meta.blackName}` : '自定义开局');
      const list = loadCustomBook();
      const dup = list.some(o =>
        o.name === name ||
        (o.moves.length === moves.length && o.moves.every((m, i) => m === moves[i])),
      );
      if (dup) { setStatus('该开局已存在（同名或相同序列），未重复导入'); return; }
      list.push({ name, moves });
      saveCustomBook(list);
      setStatus(`已导入开局「${name}」（前 ${moves.length} 手）`);
    } catch (e) {
      setStatus('PGN 解析失败: ' + ((e as Error).message || String(e)));
    }
  };
  rd.readAsText(f, 'utf-8');
  bookFileInput.value = '';
});
btnBookImport.addEventListener('click', () => bookFileInput.click());
btnBookClear.addEventListener('click', () => {
  saveCustomBook([]);
  setStatus('已清空自定义开局库');
});
// 启动时载入自定义开局，并显示数量
setCustomOpenings(loadCustomBook());
updateBookCount(loadCustomBook());

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
  if (reviewMarks.length === movesHistory.length) {
    rec.marks = [...reviewMarks];
    const rt = reviewReportEl.textContent;
    if (rt && rt !== 'AI点评中…' && rt !== '已取消点评') rec.review = rt;
  }
  const res = await engineApi.libSave(`棋谱_${ts}.json`, JSON.stringify(rec, null, 2));
  setStatus(res === true ? '已存入棋谱库' : '保存失败');
  refreshLib();
});

function enterReplay(rec: GameRecord) {
  // 停止自动播放 / 引擎思考，离开对局界面
  stopReplayTimer();
  if (waitingFor) {
    try { searchingClient.stop(); } catch { /* 引擎可能已退出 */ }
    waitingFor = null;
    clearPending(); // 避免旧挂起动作/看门狗在复盘期间误触发
  }
  replayRecord = rec;
  replayIdx = 0;
  mode = 'replay';
  // 干预挂起的引擎着法随复盘作废
  engineProposal = null;
  view.setArrows([]);
  // 中文记谱：优先用棋谱自带（v2+），长度不符则现场重算
  const startBoard = replayStartBoard(rec);
  replayMovesZh = Array.isArray(rec.movesZh) && rec.movesZh.length === rec.moves.length
    ? rec.movesZh
    : movesToChinese(startBoard, rec.moves);
  view.onSquare = null;
  view.replaceBoard(startBoard);
  view.setLastMove(null, null);
  ($('btnMode') as HTMLButtonElement).textContent = '开始';
  replayRow.style.display = 'flex';
  reviewRow.style.display = 'flex';
    llmRow.style.display = 'flex';
  reviewReportEl.textContent = '';
  reviewMarks = [];
  // 进入复盘：退出打谱状态
  guessMode = false;
  guessFrom = null;
  // 载入棋谱自带的 AI 点评结果（如有）
  reviewMarks = Array.isArray(rec.marks) && rec.marks.length === rec.moves.length ? [...rec.marks] : [];
  reviewReportEl.textContent = rec.review ?? '';
  ($('btnGuess') as HTMLButtonElement).textContent = '打谱训练';
  ($('btnRepNext') as HTMLButtonElement).disabled = false;
  ($('btnRepLast') as HTMLButtonElement).disabled = false;
  ($('btnRepPlay') as HTMLButtonElement).disabled = false;
  moveListEl.style.display = 'block';
  renderReplayList();
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
  renderReplayList();
  updateReplayLabel();
  setStatus('');
}

// ---------- 打谱训练（遮谱猜下一手） ----------
let guessMode = false;
let guessFrom: Square | null = null;
let guessAnswered = 0;
let guessFirst = 0;
let guessWrongThisStep = false;

// 复盘列表渲染：打谱模式下后续着法遮为「？」
function renderReplayList() {
  if (!replayRecord) return;
  if (guessMode) {
    const masked = replayRecord.moves.map((m, i) => (i < replayIdx ? m : '？'));
    const maskedZh = replayMovesZh.map((z, i) => (i < replayIdx ? z : '？'));
    renderMoveList(masked, maskedZh, replayIdx, false);
  } else {
    renderMoveList(replayRecord.moves, replayMovesZh, replayIdx, true, reviewMarks);
  }
}

function guessClick(s: Square) {
  if (!guessMode || !replayRecord || replayIdx >= replayRecord.moves.length) return;
  const b = view.getBoard();
  if (!guessFrom) {
    const p = b.pieces[s.rank][s.file];
    if (p && p.side === b.sideToMove) {
      guessFrom = s;
      view.setHighlights([s]);
    }
    return;
  }
  const from = guessFrom;
  guessFrom = null;
  view.setHighlights([]);
  const expected = replayRecord.moves[replayIdx];
  if (toIccs({ from, to: s }) === expected) {
    guessAnswered++;
    if (!guessWrongThisStep) guessFirst++;
    guessWrongThisStep = false;
    playSound(b.pieces[s.rank][s.file] ? 'capture' : 'move');
    repGoTo(replayIdx + 1);
  } else {
    guessWrongThisStep = true;
    setStatus('打谱：这手不对，再想想');
  }
  updateReplayLabel();
}

$('btnGuess').addEventListener('click', () => {
  if (mode !== 'replay' || !replayRecord) { setStatus('需先进入复盘（打开棋谱或载入名局）'); return; }
  guessMode = !guessMode;
  ($('btnGuess') as HTMLButtonElement).textContent = guessMode ? '退出打谱' : '打谱训练';
  guessFrom = null;
  view.setHighlights([]);
  // 打谱中禁用会剧透答案的导航
  ($('btnRepNext') as HTMLButtonElement).disabled = guessMode;
  ($('btnRepLast') as HTMLButtonElement).disabled = guessMode;
  ($('btnRepPlay') as HTMLButtonElement).disabled = guessMode;
  if (guessMode) {
    guessAnswered = 0;
    guessFirst = 0;
    guessWrongThisStep = false;
    repGoTo(0);
    view.onSquare = guessClick;
    setStatus(`打谱训练：在棋盘上走出正确着法（共 ${replayRecord.moves.length} 手）`);
  } else {
    view.onSquare = null;
    renderReplayList();
    updateReplayLabel();
    setStatus('');
  }
});

function exitReplay() {
  stopReplayTimer();
  replayRecord = null;
  replayIdx = 0;
  replayMovesZh = [];
  guessMode = false;
  ($('btnGuess') as HTMLButtonElement).textContent = '打谱训练';
  ($('btnRepNext') as HTMLButtonElement).disabled = false;
  ($('btnRepLast') as HTMLButtonElement).disabled = false;
  ($('btnRepPlay') as HTMLButtonElement).disabled = false;
  mode = 'edit';
  hideEndBanner();
  replayRow.style.display = 'none';
  reviewRow.style.display = 'none';
    llmRow.style.display = 'none';
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

// 自动播放速度档（0.5x / 1x / 2x），900ms 基准间隔 ÷ 倍率
let repSpeed = 1;
const repSpeedBtn = $('btnRepSpeed') as HTMLButtonElement;
repSpeedBtn.addEventListener('click', () => {
  repSpeed = repSpeed === 0.5 ? 1 : repSpeed === 1 ? 2 : 0.5;
  repSpeedBtn.textContent = `速度${repSpeed}x`;
  // 播放中切换速度即时生效
  if (replayTimer !== null) {
    stopReplayTimer();
    startReplayTimer();
  }
});
function startReplayTimer() {
  if (!replayRecord) return;
  if (replayTimer !== null) stopReplayTimer();
  ($('btnRepPlay') as HTMLButtonElement).textContent = '暂停';
  replayTimer = window.setInterval(() => {
    if (!replayRecord || replayIdx >= replayRecord.moves.length) {
      stopReplayTimer();
      ($('btnRepPlay') as HTMLButtonElement).textContent = '自动';
      return;
    }
    repGoTo(replayIdx + 1);
  }, Math.round(900 / repSpeed));
}
$('btnRepPlay').addEventListener('click', () => {
  if (!replayRecord) return;
  if (replayTimer !== null) { stopReplayTimer(); ($('btnRepPlay') as HTMLButtonElement).textContent = '自动'; return; }
  if (replayIdx >= replayRecord.moves.length) repGoTo(0);
  startReplayTimer();
});

$('btnRepExit').addEventListener('click', () => exitReplay());

// ---------- AI 点评按钮 ----------
const reviewRow = $('reviewRow') as HTMLDivElement;
$('btnReview').addEventListener('click', () => startReview());

// ---------- 点评报告导出（AI 点评 + LLM 解说 + 逐手标记 → Markdown 文件） ----------
$('btnReviewExport').addEventListener('click', async () => {
  if (!engineApi) { setStatus('浏览器模式不支持导出（需 Electron）'); return; }
  if (!reviewRec || !reviewRec.moves.length) { setStatus('当前没有可导出的复盘对局'); return; }
  const L: string[] = [];
  L.push(`# 象棋 AI · 对局点评报告`);
  L.push('');
  L.push(`- 对局：${reviewRec.redName || '红方'} vs ${reviewRec.blackName || '黑方'}`);
  L.push(`- 结果：${reviewRec.result || '对局结束'}`);
  L.push(`- 手数：${reviewRec.moves.length}`);
  if (reviewRec.date) L.push(`- 时间：${reviewRec.date}`);
  L.push('');
  // 逐手标记表
  const rec = reviewRec;
  if (reviewMarks.length === rec.moves.length) {
    L.push('## 逐手评分');
    L.push('');
    L.push('| # | 着法 | 标记 |');
    L.push('|---|------|------|');
    rec.moves.forEach((mv, i) => {
      const zh = (rec.movesZh && rec.movesZh[i]) || mv;
      L.push(`| ${i + 1} | ${zh} | ${reviewMarks[i] ?? '—'} |`);
    });
    L.push('');
  }
  // AI 点评 ACPL 汇总
  const rt = reviewReportEl.textContent;
  if (rt && rt !== 'AI点评中…' && rt !== '已取消点评') {
    L.push('## AI 点评（引擎 ACPL）');
    L.push('');
    L.push(rt);
    L.push('');
  }
  // LLM 解说
  const llm = llmReport.textContent;
  if (llm && llm !== 'LLM 解说生成中…' && !llm.startsWith('LLM ')) {
    L.push('## LLM 复盘解说');
    L.push('');
    L.push(llm);
    L.push('');
  }
  if (L.length <= 3) { setStatus('暂无点评数据（先点「AI 点评」或「LLM 复盘解说」）'); return; }
  const ts = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '');
  try {
    const savedPath = await engineApi.saveText(`点评报告_${ts}.md`, L.join('\n'), 'md');
    setStatus(savedPath ? '点评报告已导出' : '已取消导出');
  } catch (err) {
    setStatus('导出失败: ' + (err as Error).message);
  }
});

// ---------- 残局闯关（古谱杀局题库） ----------
interface Puzzle {
  id: string;
  name: string;
  fen: string;
  side: Side;
  movesToMate: number;
  solution: string;
}
const PUZZLES = puzzlesJson as Puzzle[];
const puzzleSel = $('puzzleSel') as HTMLSelectElement;
const puzzleInfoEl = $('puzzleInfo') as HTMLSpanElement;
let puzzleActive: Puzzle | null = null;
let puzzleHumanMoves = 0;

// 闯关进度记忆（localStorage）
const PUZZLE_DONE_KEY = 'xz_puzzle_done';
function getPuzzleDone(): Set<string> {
  try { return new Set(JSON.parse(localStorage.getItem(PUZZLE_DONE_KEY) || '[]') as string[]); }
  catch { return new Set(); }
}
function markPuzzleDone(id: string) {
  const s = getPuzzleDone();
  s.add(id);
  try { localStorage.setItem(PUZZLE_DONE_KEY, JSON.stringify([...s])); } catch { /* 忽略 */ }
  refreshPuzzleLabels();
}
function refreshPuzzleLabels() {
  const done = getPuzzleDone();
  puzzleSel.innerHTML = '';
  for (const p of PUZZLES) {
    puzzleSel.add(new Option(`${done.has(p.id) ? '✓ ' : ''}${p.name}（${p.movesToMate}步杀）`, p.id));
  }
  puzzleInfoEl.textContent = `共 ${PUZZLES.length} 关 · 已过 ${done.size} 关`;
}
refreshPuzzleLabels();

function loadPuzzle() {
  const p = PUZZLES.find(x => x.id === puzzleSel.value);
  if (!p) return;
  stopReplayTimer();
  if (waitingFor) { try { searchingClient.stop(); } catch { /* 引擎可能已退出 */ } waitingFor = null; pendingAfterAnalysis = null; }
  puzzleActive = p;
  mode = 'play';
  gameMode = 'pve';
  gameModeSel.value = 'pve';
  updateSideRows();
  humanSide = p.side;
  sideSelect.value = p.side;
  ($('btnMode') as HTMLButtonElement).textContent = '返回编辑';
  view.onSquare = playSquareClick;
  flipManual = null; applyFlip();
  replayRow.style.display = 'none';
  reviewRow.style.display = 'flex';
    llmRow.style.display = 'flex';
  gameOver = false;
  gameResult = '';
  hideEndBanner();
  let pb;
  try { pb = parseFen(p.fen).board; } catch { setStatus('残局 FEN 无效'); return; }
  newGame(pb);
  setStatus(`残局闯关：${p.name} · ${p.movesToMate}步杀（预算 ${p.movesToMate + 1} 步）`);
}
$('btnPuzzleLoad').addEventListener('click', loadPuzzle);

$('btnPuzzleHint').addEventListener('click', () => {
  const p = puzzleActive ?? PUZZLES.find(x => x.id === puzzleSel.value);
  if (!p) { setStatus('请先选择残局'); return; }
  // 优先引擎实时求解当前局面最佳着法（内置/自定义残局通用）；引擎未启动或正忙则回退原谱答案
  if (engineReady && !waitingFor && !gameOver) {
    waitingFor = 'hint';
    lastInfoMap.clear();
    searchingClient = clientMain;
    clientMain.setOption('MultiPV', 1); // 提示只要一条线，搜索更快
    clientMain.position(view.getFen());
    clientMain.go({ depth: 12 });
    setStatus('引擎求解提示中…');
    return;
  }
  try {
    const b = parseFen(p.fen).board;
    const mv = parseIccs(p.solution);
    if (mv) setStatus(`提示：${moveToChinese(b, mv)}（原谱共 ${p.movesToMate} 步杀）`);
  } catch { setStatus('提示不可用（可启动引擎后实时求解）'); }
});

// ---------- 自定义残局（保存 / 载入 / 导出 / 导入） ----------
interface CustomPuzzle {
  id: string;
  name: string;
  fen: string;
  side: Side;            // 攻方（先行方）
  movesToMate: number;   // 杀法步数
  solution: string;      // 参考着法（ICCS 或中文，可选）
  date: string;
}
const CPZ_KEY = 'xz_custom_puzzles';

function loadCustomPuzzles(): CustomPuzzle[] {
  try {
    const raw = localStorage.getItem(CPZ_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    if (Array.isArray(arr)) return arr as CustomPuzzle[];
    return [];
  } catch { return []; }
}
function saveCustomPuzzles(list: CustomPuzzle[]) {
  try { localStorage.setItem(CPZ_KEY, JSON.stringify(list)); } catch { /* 忽略 */ }
}

const cpzNameInput = $('cpzName') as HTMLInputElement;
const cpzSideSel = $('cpzSide') as HTMLSelectElement;
const cpzMovesSel = $('cpzMoves') as HTMLSelectElement;
const cpzSolutionInput = $('cpzSolution') as HTMLInputElement;
const cpzSel = $('cpzSel') as HTMLSelectElement;
const cpzInfoEl = $('cpzInfo') as HTMLDivElement;

function refreshCpzLabels() {
  const list = loadCustomPuzzles();
  cpzSel.innerHTML = '';
  for (const p of list) {
    cpzSel.add(new Option(`${p.name}（${p.movesToMate}步杀）`, p.id));
  }
  cpzInfoEl.textContent = list.length
    ? `共 ${list.length} 个自定义残局 · 选择后点「载入」即可闯关`
    : '暂无自定义残局 · 在编辑模式摆好局面后点「保存残局」';
}
refreshCpzLabels();

// 保存当前编辑模式局面为自定义残局（同时写入棋谱库 JSON）
$('btnCpzSave').addEventListener('click', async () => {
  const board = view.getBoard();
  const pieceCount = board.pieces.flat().filter(Boolean).length;
  if (pieceCount < 4) { setStatus('局面子力过少（至少 4 子），请摆好残局再保存'); return; }
  const name = cpzNameInput.value.trim() || `自定义残局_${new Date().toISOString().slice(5,10).replace('-','/')}`;
  const side = cpzSideSel.value as Side;
  board.sideToMove = side;
  const fenFull = toFen(board);
  const movesToMate = parseInt(cpzMovesSel.value, 10) || 2;
  const solution = cpzSolutionInput.value.trim();
  const id = 'cpz-' + Date.now().toString(36);
  const item: CustomPuzzle = {
    id, name, fen: fenFull, side, movesToMate,
    solution,
    date: new Date().toISOString(),
  };
  const list = loadCustomPuzzles();
  list.push(item);
  saveCustomPuzzles(list);
  refreshCpzLabels();
  cpzSel.value = id;

  // 同步到棋谱库（Electron 环境）：残局 PGN 文件
  if (engineApi?.saveText) {
    try {
      const pgn = exportPgn({
        startFen: fenFull,
        redName: side === 'red' ? name : '防守方',
        blackName: side === 'black' ? name : '防守方',
        result: '',
        moves: solution ? solution.split(/\s+/).slice(0, 2) : [],
        movesZh: [],
        date: new Date().toISOString().slice(0, 10).replace(/-/g, '.'),
      });
      await engineApi.saveText(`残局_${name.replace(/[\\/:*?"<>|]/g, '')}_${id.slice(-6)}.pgn`, pgn, 'pgn');
    } catch { /* PGN 同步失败不影响主保存 */ }
  }
  setStatus(`残局「${name}」已保存（${movesToMate}步杀，攻方${side === 'red' ? '红' : '黑'}）`);
});

// 载入自定义残局为闯关
function loadCustomPuzzle() {
  const p = loadCustomPuzzles().find(x => x.id === cpzSel.value);
  if (!p) { setStatus('请先选择要载入的自定义残局'); return; }
  stopReplayTimer();
  if (waitingFor) { try { searchingClient.stop(); } catch { /* 引擎可能已退出 */ } waitingFor = null; pendingAfterAnalysis = null; }
  puzzleActive = {
    id: p.id,
    name: p.name,
    fen: p.fen,
    side: p.side,
    movesToMate: p.movesToMate,
    solution: p.solution,
  };
  mode = 'play';
  gameMode = 'pve';
  gameModeSel.value = 'pve';
  updateSideRows();
  humanSide = p.side;
  sideSelect.value = p.side;
  ($('btnMode') as HTMLButtonElement).textContent = '返回编辑';
  view.onSquare = playSquareClick;
  flipManual = null; applyFlip();
  replayRow.style.display = 'none';
  reviewRow.style.display = 'flex';
  llmRow.style.display = 'flex';
  gameOver = false;
  gameResult = '';
  hideEndBanner();
  let pb;
  try { pb = parseFen(p.fen).board; } catch { setStatus('残局 FEN 无效'); return; }
  newGame(pb);
  setStatus(`自定义残局：${p.name} · ${p.movesToMate}步杀（预算 ${p.movesToMate + 1} 步）`);
}
$('btnCpzLoad').addEventListener('click', loadCustomPuzzle);

// 删除选中的自定义残局
$('btnCpzDelete').addEventListener('click', () => {
  const id = cpzSel.value;
  if (!id) { setStatus('请先选择要删除的残局'); return; }
  const list = loadCustomPuzzles().filter(x => x.id !== id);
  saveCustomPuzzles(list);
  refreshCpzLabels();
  setStatus('已删除');
});

// 导出选中残局为 PGN 文件（系统文件对话框）
$('btnCpzExport').addEventListener('click', async () => {
  const p = loadCustomPuzzles().find(x => x.id === cpzSel.value);
  if (!p) { setStatus('请先选择要导出的残局'); return; }
  if (!engineApi?.saveText) { setStatus('浏览器模式不支持导出（需 Electron）'); return; }
  try {
    const pgn = exportPgn({
      startFen: p.fen,
      redName: p.side === 'red' ? p.name : p.name + '（黑先）',
      blackName: p.side === 'black' ? p.name : p.name + '（红先）',
      result: '',
      moves: p.solution ? p.solution.split(/\s+/) : [],
      movesZh: [],
      date: new Date().toISOString().slice(0, 10).replace(/-/g, '.'),
    });
    const safe = p.name.replace(/[\\/:*?"<>|]/g, '');
    const savedPath = await engineApi.saveText(`残局_${safe}.pgn`, pgn, 'pgn');
    setStatus(savedPath ? `已导出 PGN：${savedPath}` : '已取消导出');
  } catch (err) {
    setStatus('导出失败: ' + (err as Error).message);
  }
});

// 从 PGN 文件导入残局
$('btnCpzImport').addEventListener('click', async () => {
  if (!engineApi?.openText) { setStatus('浏览器模式不支持导入（需 Electron）'); return; }
  const r = await engineApi.openText();
  if (!r) return;
  const meta = parsePgn(r.content);
  if (!meta.startFen) { setStatus('PGN 中未找到 FEN，无法导入'); return; }
  const safe = (r.path || '').split('\\').pop()?.split('/').pop() || '导入';
  const name = safe.replace(/\.(pgn|json)$/i, '').replace(/^残局_/, '');
  const side = cpzSideSel.value as Side;
  const fen = meta.startFen;
  const item: CustomPuzzle = {
    id: 'cpz-' + Date.now().toString(36),
    name: name || '导入残局',
    fen, side,
    movesToMate: parseInt(cpzMovesSel.value, 10) || 2,
    solution: meta.moves.join(' '),
    date: new Date().toISOString(),
  };
  const list = loadCustomPuzzles();
  list.push(item);
  saveCustomPuzzles(list);
  refreshCpzLabels();
  cpzSel.value = item.id;
  cpzNameInput.value = item.name;
  cpzSolutionInput.value = item.solution;
  setStatus(`已导入「${item.name}」（${item.movesToMate}步杀，攻方${side === 'red' ? '红' : '黑'}）`);
});

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

// 启动时检测未完成的自动保存对局（异常退出后可恢复）
checkAutoResume();
