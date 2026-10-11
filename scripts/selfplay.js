#!/usr/bin/env node
// 自对弈统计：两个引擎二进制对打 N 局，输出胜负比
// 用法:
//   node scripts/selfplay.js --engine-a <exe> --engine-b <exe> [--games 10] [--depth 6] [--movetime 0] [--max-plies 160]
// 规则:
//   - A 先执红，隔局换先
//   - depth 与 movetime 二选一：movetime>0 用每步固定时间，否则用固定深度
//   - bestmove 为 (none) 或超过 max-plies 判和；被将死的一方判负；双方无进攻子力判和

const { spawn } = require('child_process');
const { parseFen, toFen, applyMove, legalMoves, inCheck, hasAttackingPieces } = require('./rules.cjs');
const fs = require('fs');
const path = require('path');

function arg(name, def) {
  const i = process.argv.indexOf('--' + name);
  return i >= 0 ? process.argv[i + 1] : def;
}

const ENGINE_A = arg('engine-a');
const ENGINE_B = arg('engine-b');
const GAMES = parseInt(arg('games', '10'), 10);
const DEPTH = parseInt(arg('depth', '6'), 10);
const MOVETIME = parseInt(arg('movetime', '0'), 10);
const MAX_PLIES = parseInt(arg('max-plies', '160'), 10);

if (!ENGINE_A || !ENGINE_B) {
  console.error('用法: node scripts/selfplay.js --engine-a <exe> --engine-b <exe> [--games 10] [--depth 6] [--movetime 0] [--max-plies 160]');
  process.exit(1);
}
const EXE_A = path.resolve(ENGINE_A);
const EXE_B = path.resolve(ENGINE_B);

// ---------- 引擎进程封装 ----------
class Engine {
  constructor(exe) {
    this.exe = exe;
    this.proc = null;
    this.queue = [];
    this.waiting = null;
  }
  async start() {
    this.proc = spawn(this.exe, [], { cwd: path.dirname(this.exe) });
    this.proc.stdout.setEncoding('utf8');
    let buf = '';
    this.proc.stdout.on('data', d => {
      buf += d;
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        if (!line) continue;
        if (line.startsWith('bestmove')) {
          const bm = line.split(/\s+/)[1];
          const w = this.waiting; this.waiting = null;
          if (w) w(bm);
        }
      }
    });
    this.proc.stderr.on('data', () => {});
    this.send('uci');
    await this.waitLine('uciok');
    // 自动指定网络权重（引擎同目录下的 eval.nnue 或 pikafish.nnue，兼容两种命名）
    const netNames = ['eval.nnue', 'pikafish.nnue'];
    const engineDir = path.dirname(this.exe);
    const netFile = netNames.find(n => fs.existsSync(path.join(engineDir, n)));
    if (netFile) this.send(`setoption name EvalFile value ${path.join(engineDir, netFile)}`);
    this.send('setoption name MultiPV value 1');
    this.send('isready');
    await this.waitLine('readyok');
  }
  send(cmd) { if (this.proc && this.proc.stdin.writable) this.proc.stdin.write(cmd + '\n'); }
  waitLine(prefix) {
    return new Promise(res => {
      const handler = line => {
        if (line.startsWith(prefix)) { this.proc.stdout.removeListener('data', onData); res(line); }
      };
      const onData = d => {
        let buf = d;
        for (const line of buf.split('\n').map(s => s.trim()).filter(Boolean)) handler(line);
      };
      this.proc.stdout.on('data', onData);
    });
  }
  go(fen, depth, movetime) {
    return new Promise(res => {
      this.waiting = res;
      this.send(`position fen ${fen}`);
      this.send(movetime > 0 ? `go movetime ${movetime}` : `go depth ${depth}`);
    });
  }
  quit() { this.send('quit'); try { this.proc.kill(); } catch (_) {} }
}

function toEngineIccs(mv) {
  // 内部坐标(rank0=黑底线) → 引擎坐标(rank0=红底线)
  const c = s => String.fromCharCode(97 + s.file) + (9 - s.rank);
  return c(mv.from) + c(mv.to);
}

async function playGame(gameIdx, engA, engB) {
  // A 执红（偶数局）/ 黑（奇数局）
  const aIsRed = gameIdx % 2 === 0;
  let fen = 'rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1';
  let board = parseFen(fen).board;
  let plies = 0;
  const moves = [];
  const seen = new Map();   // 局面重复检测（同局面同方行棋出现 3 次 = 和）
  const posKey = b => b.pieces.map(row => row.map(p => p ? (p.side === 'red' ? p.type : p.type.toLowerCase()) : '.').join('')).join('/') + ' ' + b.sideToMove;
  seen.set(posKey(board), 1);

  while (plies < MAX_PLIES) {
    const stm = board.sideToMove;
    const eng = (stm === 'red') === aIsRed ? engA : engB;
    const legal = legalMoves(board, stm);
    if (legal.length === 0) {
      const loser = stm === 'red' ? '红方' : '黑方';
      const loserName = (stm === 'red') === aIsRed ? 'A' : 'B';
      return { result: inCheck(board, stm) ? 'checkmate' : 'stalemate', winner: loserName === 'A' ? 'B' : 'A', plies, reason: `${loser}无子可动` };
    }
    const bm = await eng.go(fen, DEPTH, MOVETIME);
    if (!bm || bm === '(none)') {
      return { result: 'none', winner: (stm === 'red') === aIsRed ? 'B' : 'A', plies, reason: `${stm === 'red' ? '红' : '黑'}方引擎无着法` };
    }
    // 引擎 ICCS(rank0=红底) → 内部坐标
    const m = /^([a-i])(\d)([a-i])(\d)$/.exec(bm);
    if (!m) return { result: 'error', winner: (stm === 'red') === aIsRed ? 'B' : 'A', plies, reason: '着法解析失败: ' + bm };
    const mv = { from: { file: m[1].charCodeAt(0) - 97, rank: 9 - parseInt(m[2], 10) }, to: { file: m[3].charCodeAt(0) - 97, rank: 9 - parseInt(m[4], 10) } };
    // 校验着法合法（引擎 FEN 输入正确时应恒合法）
    const ok = legal.find(l => l.from.file === mv.from.file && l.from.rank === mv.from.rank && l.to.file === mv.to.file && l.to.rank === mv.to.rank);
    if (!ok) return { result: 'illegal', winner: (stm === 'red') === aIsRed ? 'B' : 'A', plies, reason: `非法着法 ${bm}` };
    board = applyMove(board, mv);
    fen = toFen(board);
    moves.push(bm);
    plies++;
    // 双方无进攻子力判和（只剩将帅士象，不可能将死）
    if (!hasAttackingPieces(board, 'red') && !hasAttackingPieces(board, 'black')) {
      return { result: 'draw', winner: null, plies, reason: '双方无进攻子力' };
    }
    // 重复局面判和（3 次）
    const key = posKey(board);
    const n = (seen.get(key) || 0) + 1;
    if (n >= 3) return { result: 'draw', winner: null, plies, reason: '三次重复局面' };
    seen.set(key, n);
  }
  return { result: 'draw', winner: null, plies, reason: `超过 ${MAX_PLIES} 步` };
}

async function main() {
  console.log(`自对弈: A=${path.basename(EXE_A)} B=${path.basename(EXE_B)} 局数=${GAMES} depth=${DEPTH} movetime=${MOVETIME}`);
  const engA = new Engine(EXE_A);
  const engB = new Engine(EXE_B);
  await engA.start();
  await engB.start();

  let aWin = 0, bWin = 0, draw = 0;
  const log = [];
  for (let g = 0; g < GAMES; g++) {
    const t0 = Date.now();
    const r = await playGame(g, engA, engB);
    const secs = ((Date.now() - t0) / 1000).toFixed(1);
    if (r.winner === 'A') aWin++;
    else if (r.winner === 'B') bWin++;
    else draw++;
    const line = `第${g + 1}局: ${r.winner ? (r.winner === 'A' ? 'A胜' : 'B胜') : '和局'} (${r.reason}, ${r.plies}步, ${secs}s)`;
    console.log(line);
    log.push(line);
  }
  engA.quit();
  engB.quit();

  const summary = `\n结果: A ${aWin}胜 - B ${bWin}胜 - 和 ${draw}  （A 执红 ${Math.ceil(GAMES / 2)} 局）`;
  console.log(summary);
  const resultsPath = path.join(__dirname, '..', 'docs', 'selfplay-results.md');
  const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ');
  const entry = `\n## ${stamp}\nA=${path.basename(ENGINE_A)}\nB=${path.basename(ENGINE_B)}\ndepth=${DEPTH} movetime=${MOVETIME} games=${GAMES}\n${summary.trim()}\n${log.join('\n')}\n`;
  fs.appendFileSync(resultsPath, entry);
  console.log('已追加到 ' + resultsPath);
}

main().catch(e => { console.error('FATAL', e); process.exit(1); });
