#!/usr/bin/env node
// 自对弈统计：两个引擎二进制对打 N 局，输出胜负比
// 用法:
//   node scripts/selfplay.js --engine-a <exe> --engine-b <exe> [--games 10] [--depth 6] [--movetime 0] [--max-plies 160]
// 规则:
//   - A 先执红，隔局换先
//   - depth 与 movetime 二选一：movetime>0 用每步固定时间，否则用固定深度
//   - bestmove 为 (none) 或超过 max-plies 判和；被将死的一方判负

const { spawn } = require('child_process');
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

// ---------- 极简中国象棋规则（判定走子合法与将死；与 gui/src/rules 同一套逻辑的 JS 版） ----------
const DIRS = [[1,0],[-1,0],[0,1],[0,-1]];
const KNIGHT = [[1,2],[2,1],[2,-1],[1,-2],[-1,-2],[-2,-1],[-2,1],[-1,2]];

function fenToBoard(fen) {
  const rows = fen.split(/\s+/)[0].split('/');
  const pieces = [];
  for (let r = 0; r < 10; r++) pieces.push(new Array(9).fill(null));
  rows.forEach((row, rank) => {
    let file = 0;
    for (const ch of row) {
      if (ch >= '1' && ch <= '9') file += +ch;
      else {
        const upper = ch.toUpperCase();
        const type = { K:'K',A:'A',B:'B',N:'N',R:'R',C:'C',P:'P' }[upper];
        pieces[rank][file] = { side: ch === upper ? 'red' : 'black', type };
        file++;
      }
    }
  });
  const stm = fen.split(/\s+/)[1] === 'w' ? 'red' : 'black';
  return { pieces, sideToMove: stm };
}

function pieceAt(b, f, r) { return b.pieces[r][f] || null; }

function findKing(b, side) {
  const r0 = side === 'red' ? 7 : 0;
  for (let r = r0; r < r0 + 3; r++) for (let f = 3; f <= 5; f++) {
    const p = pieceAt(b, f, r);
    if (p && p.side === side && p.type === 'K') return { file: f, rank: r };
  }
  return null;
}

function flyingFacing(b) {
  const rk = findKing(b, 'red'), bk = findKing(b, 'black');
  if (!rk || !bk || rk.file !== bk.file) return false;
  for (let r = bk.rank + 1; r < rk.rank; r++) if (pieceAt(b, rk.file, r)) return false;
  return true;
}

function attackedBy(b, f, r, by) {
  const dir = by === 'red' ? -1 : 1;
  for (const [df, dr] of DIRS) {
    let cf = f + df, cr = r + dr, screen = false;
    while (cf >= 0 && cf <= 8 && cr >= 0 && cr <= 9) {
      const p = pieceAt(b, cf, cr);
      if (p) {
        if (!screen) { if (p.side === by && p.type === 'R') return true; screen = true; }
        else { if (p.side === by && p.type === 'C') return true; break; }
      }
      cf += df; cr += dr;
    }
  }
  for (const [df, dr] of KNIGHT) {
    const tf = f + df, tr = r + dr;
    if (tf < 0 || tf > 8 || tr < 0 || tr > 9) continue;
    const p = pieceAt(b, tf, tr);
    if (!p || p.side !== by || p.type !== 'N') continue;
    const lf = tf + (Math.abs(df) === 2 ? (df > 0 ? -1 : 1) : 0);
    const lr = tr + (Math.abs(dr) === 2 ? (dr > 0 ? -1 : 1) : 0);
    if (!pieceAt(b, lf, lr)) return true;
  }
  const pr = r - dir;
  if (pr >= 0 && pr <= 9) {
    const p = pieceAt(b, f, pr);
    if (p && p.side === by && p.type === 'P') return true;
  }
  for (const df of [-1, 1]) {
    const sf = f + df;
    if (sf < 0 || sf > 8) continue;
    const p = pieceAt(b, sf, r);
    if (p && p.side === by && p.type === 'P') {
      const crossed = by === 'red' ? r <= 4 : r >= 5;
      if (crossed) return true;
    }
  }
  return false;
}

function inCheck(b, side) {
  if (flyingFacing(b)) return true;
  const k = findKing(b, side);
  return k ? attackedBy(b, k.file, k.rank, side === 'red' ? 'black' : 'red') : true;
}

function pseudoFrom(b, f0, r0) {
  const p = pieceAt(b, f0, r0);
  if (!p) return [];
  const { side, type } = p;
  const out = [];
  const dir = side === 'red' ? -1 : 1;
  const push = (f, r) => {
    if (f < 0 || f > 8 || r < 0 || r > 9) return;
    const t = pieceAt(b, f, r);
    if (t && t.side === side) return;
    out.push({ from: { file: f0, rank: r0 }, to: { file: f, rank: r } });
  };
  const palace = (f, r) => f >= 3 && f <= 5 && (side === 'red' ? r >= 7 : r <= 2);
  if (type === 'K') {
    for (const [df, dr] of DIRS) { const f = f0+df, r = r0+dr; if (palace(f, r)) push(f, r); }
  } else if (type === 'A') {
    for (const [df, dr] of [[1,1],[1,-1],[-1,1],[-1,-1]]) { const f = f0+df, r = r0+dr; if (palace(f, r)) push(f, r); }
  } else if (type === 'B') {
    for (const [df, dr] of [[2,2],[2,-2],[-2,2],[-2,-2]]) {
      const f = f0+df, r = r0+dr;
      const crossed = side === 'red' ? r < 5 : r > 4;
      if (f < 0 || f > 8 || r < 0 || r > 9 || crossed) continue;
      if (!pieceAt(b, f0+df/2, r0+dr/2)) push(f, r);
    }
  } else if (type === 'N') {
    for (const [df, dr] of KNIGHT) {
      const f = f0+df, r = r0+dr;
      if (f < 0 || f > 8 || r < 0 || r > 9) continue;
      const lf = f0 + (Math.abs(df) === 2 ? df/2 : 0);
      const lr = r0 + (Math.abs(dr) === 2 ? dr/2 : 0);
      if (!pieceAt(b, lf, lr)) push(f, r);
    }
  } else if (type === 'R') {
    for (const [df, dr] of DIRS) {
      let f = f0+df, r = r0+dr;
      while (f >= 0 && f <= 8 && r >= 0 && r <= 9) {
        const t = pieceAt(b, f, r);
        if (!t) out.push({ from: {file:f0,rank:r0}, to: {file:f,rank:r} });
        else { if (t.side !== side) out.push({ from: {file:f0,rank:r0}, to: {file:f,rank:r} }); break; }
        f += df; r += dr;
      }
    }
  } else if (type === 'C') {
    for (const [df, dr] of DIRS) {
      let f = f0+df, r = r0+dr, screen = false;
      while (f >= 0 && f <= 8 && r >= 0 && r <= 9) {
        const t = pieceAt(b, f, r);
        if (!screen) { if (!t) out.push({ from: {file:f0,rank:r0}, to: {file:f,rank:r} }); else screen = true; }
        else if (t) { if (t.side !== side) out.push({ from: {file:f0,rank:r0}, to: {file:f,rank:r} }); break; }
        f += df; r += dr;
      }
    }
  } else {
    push(f0, r0 + dir);
    const crossed = side === 'red' ? r0 <= 4 : r0 >= 5;
    if (crossed) { push(f0-1, r0); push(f0+1, r0); }
  }
  return out;
}

function pseudoMoves(b, side) {
  const out = [];
  for (let r = 0; r < 10; r++) for (let f = 0; f < 9; f++) {
    const p = pieceAt(b, f, r);
    if (p && p.side === side) out.push(...pseudoFrom(b, f, r));
  }
  return out;
}

function applyMove(b, mv) {
  const p = pieceAt(b, mv.from.file, mv.from.rank);
  const nb = { pieces: b.pieces.map(row => row.slice()), sideToMove: b.sideToMove === 'red' ? 'black' : 'red' };
  nb.pieces[mv.from.rank][mv.from.file] = null;
  nb.pieces[mv.to.rank][mv.to.file] = p;
  return nb;
}

function legalMoves(b, side) {
  return pseudoMoves(b, side).filter(mv => {
    const nb = applyMove(b, mv);
    return !inCheck(nb, side);
  });
}

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
  let board = fenToBoard(fen);
  let plies = 0;
  const moves = [];

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
    fen = boardToFen(board);
    moves.push(bm);
    plies++;
  }
  return { result: 'draw', winner: null, plies, reason: `超过 ${MAX_PLIES} 步` };
}

function boardToFen(b) {
  const rows = [];
  for (let r = 0; r < 10; r++) {
    let row = '', empty = 0;
    for (let f = 0; f < 9; f++) {
      const p = pieceAt(b, f, r);
      if (p) {
        if (empty) { row += empty; empty = 0; }
        row += p.side === 'red' ? p.type : p.type.toLowerCase();
      } else empty++;
    }
    if (empty) row += empty;
    rows.push(row);
  }
  return `${rows.join('/')} ${b.sideToMove === 'red' ? 'w' : 'b'} - - 0 ${Math.floor(1)}`;
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
