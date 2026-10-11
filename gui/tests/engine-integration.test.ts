// 真实引擎 UCI 集成测试
// 需要设置环境变量 ENGINE_PATH 指向引擎 exe（如 ..\engine\engine-x64.exe），否则自动跳过。
// 示例：
//   $env:ENGINE_PATH = "..\engine\engine-x64.exe"; npm test
//   $env:ENGINE_PATH = "$PWD\..\engine\engine-x64.exe"; npx vitest run tests/engine-integration.test.ts
import { describe, expect, it } from 'vitest';
import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { UciClient } from '../src/uci/engine-client';

const ENGINE_PATH = process.env.ENGINE_PATH;

describe.skipIf(!ENGINE_PATH)('真实引擎集成', () => {
  it(
    'UCI 握手 + 固定深度搜索返回 bestmove',
    async () => {
      const exe = ENGINE_PATH!;
      expect(fs.existsSync(exe), `引擎不存在: ${exe}`).toBe(true);
      const dir = path.dirname(exe);
      const proc = spawn(exe, [], { cwd: dir });
      const buf: string[] = [];
      let exited = false;
      let engineError: Error | null = null;

      proc.stdout.setEncoding('utf8');
      proc.on('exit', () => { exited = true; });
      proc.on('error', err => { engineError = err; });

      const send = (cmd: string) => {
        if (proc.stdin.writable) proc.stdin.write(cmd + '\n');
      };

      // 轮询等待指定行出现（引擎输出是流式的，采用简单轮询）
      const waitLine = async (pred: (line: string) => boolean, timeoutMs = 15000) => {
        const t0 = Date.now();
        while (Date.now() - t0 < timeoutMs) {
          if (engineError) throw engineError;
          const hit = buf.find(pred);
          if (hit) return hit;
          if (exited) throw new Error('引擎提前退出，最近输出: ' + buf.slice(-5).join('|'));
          await new Promise(r => setTimeout(r, 50));
        }
        throw new Error('等待超时，最近输出: ' + buf.slice(-5).join('|'));
      };

      const client = new UciClient(send);
      let readyok = false;
      let bestmove: string | null = null;
      client.onReady = () => { readyok = true; };
      client.onBestmove = bm => { bestmove = bm; };

      // 每收到一行就交给 UciClient 解析（与 GUI 主进程桥行为一致）
      // 注意 Windows 上行尾带 \r，需 trim 后再匹配
      proc.stdout.on('data', d => {
        for (const raw of d.split('\n')) {
          const line = raw.trim();
          if (!line) continue;
          buf.push(line);
          client.handleLine(line);
        }
      });

      try {
        send('uci');
        await waitLine(l => l.startsWith('uciok'));

        // 自动指定网络权重（兼容 eval.nnue / pikafish.nnue 两种命名）
        const netFile = ['eval.nnue', 'pikafish.nnue'].find(n => fs.existsSync(path.join(dir, n)));
        if (netFile) send(`setoption name EvalFile value ${path.join(dir, netFile)}`);
        send('setoption name MultiPV value 1');

        send('isready');
        await waitLine(l => l.startsWith('readyok'));
        expect(readyok).toBe(true);

        send('position startpos');
        send('go depth 6');
        await waitLine(l => l.startsWith('bestmove'), 30000);
        expect(bestmove).toMatch(/^[a-i][0-9][a-i][0-9]$/);
      } finally {
        try { send('quit'); } catch { /* 已退出 */ }
        setTimeout(() => { try { proc.kill(); } catch { /* 已退出 */ } }, 300);
      }
    },
    40000,
  );
});