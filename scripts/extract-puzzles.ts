// 残局闯关题库提取：从古谱 35 局的绝杀终局逆推两步/三步杀残局
// 运行：npx esbuild scripts/extract-puzzles.ts --bundle --platform=node --format=esm --outfile=scripts/.extract-puzzles.mjs && node scripts/.extract-puzzles.mjs
import { writeFileSync } from 'fs';
import { initialBoard, toFen } from '../gui/src/board/fen';
import { applyMove, checkStatus } from '../gui/src/rules/rules';
import { parseIccs, Side } from '../gui/src/board/types';
import { CLASSICS } from '../gui/src/board/classics';

interface Puzzle {
  id: string;
  name: string;
  fen: string;
  side: Side;          // 行棋方（攻方）
  movesToMate: number; // 攻方还需几步行棋成杀
  solution: string;    // 原谱第一手（ICCS 内部坐标）
}

const puzzles: Puzzle[] = [];

for (const g of CLASSICS) {
  let b = initialBoard();
  const fens: string[] = [toFen(b)];
  for (const s of g.moves) {
    const mv = parseIccs(s);
    if (!mv) break;
    b = applyMove(b, mv);
    fens.push(toFen(b));
  }
  const n = g.moves.length;
  if (checkStatus(b).status !== 'checkmate') continue;
  // j = n-3：距终局 3 手 → 攻方两步杀；j = n-5：距终局 5 手 → 攻方三步杀
  for (const [j, k] of [[n - 3, 2], [n - 5, 3]] as [number, number][]) {
    if (j < 0) continue;
    const side: Side = j % 2 === 0 ? 'red' : 'black';
    puzzles.push({
      id: `${g.id}-m${k}`,
      name: `${g.category}·${g.name}`,
      fen: fens[j],
      side,
      movesToMate: k,
      solution: g.moves[j],
    });
  }
}

const out = new URL('../gui/src/data/puzzles.json', import.meta.url);
writeFileSync(out, JSON.stringify(puzzles, null, 1), 'utf8');
console.log('puzzles:', puzzles.length);
