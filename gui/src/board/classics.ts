// 名局欣赏：古谱《自出洞来无敌手》（纯阳道人，七类三十五局，全部得先胜）
// 数据在 data/classics.json：
//   moves   — 内部坐标 ICCS（rank0=黑底线），可直接逐手重放，已由规则库全量校验
//   movesZh — 对应中文纵线记法（古谱原文省略的前/后消歧已补全后重新生成）
// 数据由 scripts/build-classics.mjs + DFS 消歧求解生成，人工不直接编辑 JSON。

import classicsData from '../data/classics.json';

export interface ClassicGame {
  id: string;
  category: string;   // 七类：自字信手炮 / 出字列手炮 / 洞字入手炮 / 来字窝心炮 / 无字袖手炮 / 敌字出手炮 / 手字应手炮
  name: string;       // 第一局 ~ 第五局
  opening: string;    // 对应现代布局名（顺炮横车对直车 / 中炮对单提马 / 起马局 等）
  result: string;     // 全部为 红胜
  moves: string[];    // 内部坐标 ICCS 着法（红黑交替，红方收尾）
  movesZh: string[];  // 中文纵线记法，与 moves 一一对应
}

export const CLASSIC_BOOK: string = classicsData.book;
export const CLASSICS: ClassicGame[] = classicsData.games as ClassicGame[];

// 七类目录（保持自→出→洞→来→无→敌→手 顺序，即书名七字顺序）
export const CLASSIC_CATEGORIES: string[] = [...new Set(CLASSICS.map(g => g.category))];

export function findClassic(id: string): ClassicGame | undefined {
  return CLASSICS.find(g => g.id === id);
}
