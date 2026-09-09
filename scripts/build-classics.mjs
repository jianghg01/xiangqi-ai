// 从 classics_raw/raw-games.md 生成 gui/src/data/classics.json
// 用法: node scripts/build-classics.mjs <raw.md> <out.json>
// raw 格式: 每局一个小节标题 "## {类别}{第X局}（N步，{开局}）"，其后一行中文着法（空格分隔 token），
//           可选一行 "ICCS验证串：..."（引擎坐标，rank0=红底线，仅用于测试交叉校验）
import { readFileSync, writeFileSync } from 'fs';

const [, , rawPath, outPath] = process.argv;
const text = readFileSync(rawPath, 'utf8');

const CN = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5 };
const ID_PREFIX = { 自: 'zi', 出: 'chu', 洞: 'dong', 来: 'lai', 无: 'wu', 敌: 'di', 手: 'shou' };
const CATEGORY_FULL = {
  自: '自字信手炮', 出: '出字列手炮', 洞: '洞字入手炮', 来: '来字窝心炮',
  无: '无字袖手炮', 敌: '敌字出手炮', 手: '手字应手炮',
};

const lines = text.split(/\r?\n/);
const games = [];
let cur = null;
for (const line of lines) {
  const hm = /^(?:#{2,3})\s*([自出洞来无敌手])字(?:信手炮|列手炮|入手炮|窝心炮|袖手炮|出手炮|应手炮)?(第[一二三四五]局)（\d+步，(.+?)）/.exec(line.trim());
  if (hm) {
    cur = {
      id: ID_PREFIX[hm[1]] + CN[hm[2].replace('第', '').replace('局', '')],
      category: CATEGORY_FULL[hm[1]],
      name: hm[2],
      opening: hm[3].split('，')[0],
      movesZh: [],
      iccs: null,
    };
    games.push(cur);
    continue;
  }
  if (!cur) continue;
  const t = line.trim();
  if (!t) continue;
  if (t.startsWith('ICCS验证串：')) { cur.iccs = t.slice('ICCS验证串：'.length).trim(); continue; }
  if (t.startsWith('#')) { cur = null; continue; }
  // 着法行：可能含 "红胜" 等尾注
  const clean = t.replace(/红胜|黑胜|和棋|（.*?）/g, ' ').trim();
  const tokens = clean.split(/\s+/).filter(Boolean);
  cur.movesZh.push(...tokens);
}

// 校验
let bad = 0;
for (const g of games) {
  if (g.movesZh.length === 0) { console.error(`空着法: ${g.id}`); bad++; }
  if (g.movesZh.length % 2 === 0) { console.error(`着法数为偶数（红方应收尾）: ${g.id} = ${g.movesZh.length}`); bad++; }
  if (g.movesZh.some(t => !/^[前后中]?[帅仕相马车炮兵将士象卒][一二三四五六七八九123456789]?[平进退][一二三四五六七八九123456789]?$/.test(t))) {
    console.error(`非法 token: ${g.id} -> ${g.movesZh.filter(t => !/^[前后中]?[帅仕相马车炮兵将士象卒][一二三四五六七八九123456789]?[平进退][一二三四五六七八九123456789]?$/.test(t)).join(',')}`);
    bad++;
  }
}
if (bad) { console.error(`共 ${bad} 处问题，中止`); process.exit(1); }

const out = {
  book: '自出洞来无敌手',
  author: '纯阳道人',
  note: '古谱七类三十五局，全部红先胜；movesZh 为中文纵线记法，加载时经合法着法反推匹配转为内部坐标',
  games,
};
writeFileSync(outPath, JSON.stringify(out, null, 1) + '\n', 'utf8');
console.log(`OK: ${games.length} 局 -> ${outPath}`);
for (const g of games) console.log(`${g.id} ${g.category} ${g.name} ${g.opening} ${g.movesZh.length}手${g.iccs ? ' +ICCS' : ''}`);
