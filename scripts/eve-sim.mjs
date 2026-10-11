// eve 对弈模拟诊断：交替 depth 5 / depth 24 驱动引擎，监控崩溃/卡死
// 用法: node eve-sim.mjs [maxPly] [timeoutMsPerMove]
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ENGINE = path.resolve(__dirname, '..', 'engine', 'engine-x64.exe');
const MAX_PLY = parseInt(process.argv[2] || '120', 10);
const MOVE_TIMEOUT = parseInt(process.argv[3] || '180000', 10);

const eng = spawn(ENGINE, [], { cwd: path.dirname(ENGINE) });
let buf = '';
let exited = false;
let lineCount = 0;

eng.stdout.setEncoding('utf8');
eng.stdout.on('data', d => { buf += d; });
eng.stderr.on('data', d => {
  const s = String(d).trim();
  if (s) console.error('[STDERR]', s.slice(0, 500));
});
eng.on('exit', (code, sig) => {
  exited = true;
  console.error(`\n[EXIT] code=${code} signal=${sig}`);
});

function waitLine(pred, timeout) {
  return new Promise((resolve, reject) => {
    const t0 = Date.now();
    const timer = setInterval(() => {
      const lines = buf.split('\n');
      for (let i = 0; i < lines.length - 1; i++) {
        const l = lines[i].trim();
        if (!l) continue;
        if (pred(l)) {
          buf = lines.slice(i + 1).join('\n');
          clearInterval(timer);
          resolve(l);
          return;
        }
      }
      if (exited) { clearInterval(timer); reject(new Error('引擎进程已退出')); return; }
      if (Date.now() - t0 > timeout) { clearInterval(timer); reject(new Error('等待超时: ' + (lines[lines.length - 1] || '').slice(0, 200))); }
    }, 20);
  });
}

function send(cmd) {
  console.log('[>>>]', cmd);
  eng.stdin.write(cmd + '\n');
}

async function main() {
  send('uci');
  await waitLine(l => l.startsWith('uciok'), 10000);
  send('setoption name Threads value 4');
  send('setoption name Hash value 512');
  send('setoption name EvalFile value ' + path.join(path.dirname(ENGINE), 'eval.nnue'));
  send('ucinewgame');
  send('isready');
  await waitLine(l => l === 'readyok', 10000);

  const moves = [];
  const tStart = Date.now();
  for (let ply = 0; ply < MAX_PLY; ply++) {
    const depth = ply % 2 === 0 ? 5 : 24; // 红=中级5层，黑=最顶级24层
    const pos = moves.length ? `position startpos moves ${moves.join(' ')}` : 'position startpos';
    send(pos);
    send(`go depth ${depth}`);
    let bm;
    try {
      bm = await waitLine(l => l.startsWith('bestmove'), MOVE_TIMEOUT);
    } catch (e) {
      console.error(`\n[FAIL] 第 ${ply + 1} 手(depth ${depth}) 失败:`, e.message);
      if (!exited) send('quit');
      process.exitCode = 1;
      return;
    }
    const mv = (bm.split(/\s+/)[1] || '').trim();
    console.log(`[${ply + 1}/${MAX_PLY}] depth=${depth} bestmove=${mv} 用时=${((Date.now() - tStart) / 1000).toFixed(1)}s`);
    if (!mv || mv === '(none)') {
      console.error('[INFO] 引擎返回 (none)——可能将军/困毙终结');
      break;
    }
    if (mv.startsWith('0000')) {
      console.error('[INFO] 引擎返回空着 0000——规则终结');
      break;
    }
    moves.push(mv);
    // 中等偏后的局面偶尔清理（模拟 long-run）
  }
  const total = ((Date.now() - tStart) / 1000).toFixed(1);
  console.log(`\n[完成] 共 ${moves.length} 手，总用时 ${total}s，引擎${exited ? '已退出' : '存活'}`);
  if (!exited) send('quit');
}

main().catch(e => { console.error(e); if (!exited) eng.kill(); });