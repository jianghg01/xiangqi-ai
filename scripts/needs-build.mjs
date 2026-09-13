// 检测 gui 源码(src/electron/index.html/package.json) 是否比 dist 更新
// 输出 1 = 需要重新构建；0 = dist 已最新。被 启动象棋.bat 调用
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const gui = path.join(root, 'gui');
const SRC_GLOBS = [
  ['src'], ['electron'], ['index.html'], ['package.json'],
];

function latestMtime(rel) {
  let max = 0;
  const full = path.join(gui, rel);
  const walk = p => {
    let st;
    try { st = fs.statSync(p); } catch { return; }
    if (st.isDirectory()) {
      for (const f of fs.readdirSync(p)) walk(path.join(p, f));
    } else if (st.mtimeMs > max) {
      max = st.mtimeMs;
    }
  };
  walk(full);
  return max;
}

let srcMax = 0;
for (const [rel] of SRC_GLOBS) srcMax = Math.max(srcMax, latestMtime(rel));
const distMax = latestMtime('dist');

process.stdout.write(srcMax > 0 && (distMax === 0 || srcMax > distMax) ? '1' : '0');