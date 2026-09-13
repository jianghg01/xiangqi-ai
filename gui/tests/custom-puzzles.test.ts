// 自定义残局：localStorage 持久化 + PGN 导入导出边界测试
//
// main.ts 里的 cpz* 函数依赖 DOM / localStorage / engineApi，无法直接 import。
// 这里自建 localStorage 桩（vitest 默认 node 环境无全局 localStorage），
// 复刻 main.ts 的持久化逻辑做回归，并覆盖 exportPgn / parsePgn 在自定义残局场景的往返。

import { describe, it, expect, beforeEach } from 'vitest';
import { parseFen, toFen } from '../src/board/fen';
import { exportPgn, parsePgn } from '../src/board/pgn';

// ---- localStorage 桩 ----
const store = new Map<string, string>();
const localStorageShim = {
  getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
  setItem: (k: string, v: string) => { store.set(k, String(v)); },
  removeItem: (k: string) => { store.delete(k); },
  clear: () => store.clear(),
};

interface CustomPuzzle {
  id: string;
  name: string;
  fen: string;
  side: 'red' | 'black';
  movesToMate: number;
  solution: string;
  date: string;
}
const CPZ_KEY = 'xz_custom_puzzles';

function loadCustomPuzzles(): CustomPuzzle[] {
  try {
    const raw = localStorageShim.getItem(CPZ_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    if (Array.isArray(arr)) return arr as CustomPuzzle[];
    return [];
  } catch {
    return [];
  }
}
function saveCustomPuzzles(list: CustomPuzzle[]) {
  try {
    localStorageShim.setItem(CPZ_KEY, JSON.stringify(list));
  } catch {
    /* 忽略 */
  }
}

// 真实残局 FEN（取自 puzzles.json zi1-m2 的下一步，黑先）
const SAMPLE_FEN = '2bakab2/1R3r3/2n1cN1cn/p3p3p/9/3p2P2/P1r1P3P/2N1C2C1/9/2BAKAB2 b - - 0 1';

describe('自定义残局 localStorage 持久化', () => {
  beforeEach(() => localStorageShim.removeItem(CPZ_KEY));

  it('保存后可被载入，字段完整', () => {
    const item: CustomPuzzle = {
      id: 'cpz-test1',
      name: '测试残局',
      fen: SAMPLE_FEN,
      side: 'red',
      movesToMate: 2,
      solution: 'f1f0',
      date: new Date().toISOString(),
    };
    const list = loadCustomPuzzles();
    list.push(item);
    saveCustomPuzzles(list);
    const reloaded = loadCustomPuzzles();
    expect(reloaded.length).toBe(1);
    expect(reloaded[0].id).toBe('cpz-test1');
    expect(reloaded[0].name).toBe('测试残局');
    expect(reloaded[0].fen).toBe(SAMPLE_FEN);
    expect(reloaded[0].side).toBe('red');
    expect(reloaded[0].movesToMate).toBe(2);
    expect(reloaded[0].solution).toBe('f1f0');
  });

  it('删除后列表变空', () => {
    const item: CustomPuzzle = {
      id: 'cpz-test2',
      name: '待删',
      fen: SAMPLE_FEN,
      side: 'black',
      movesToMate: 3,
      solution: '',
      date: new Date().toISOString(),
    };
    saveCustomPuzzles([item]);
    expect(loadCustomPuzzles().length).toBe(1);
    const after = loadCustomPuzzles().filter(x => x.id !== 'cpz-test2');
    saveCustomPuzzles(after);
    expect(loadCustomPuzzles().length).toBe(0);
  });

  it('localStorage 数据损坏时降级为空数组', () => {
    localStorageShim.setItem(CPZ_KEY, '{bad json');
    expect(loadCustomPuzzles()).toEqual([]);
  });

  it('FEN 往返一致（toFen 序列化稳定）', () => {
    const board = parseFen(SAMPLE_FEN).board;
    expect(toFen(board)).toBe(SAMPLE_FEN);
  });

  it('子力统计：残局至少 4 子（校验门槛）', () => {
    const b = parseFen(SAMPLE_FEN).board;
    const count = b.pieces.flat().filter(Boolean).length;
    expect(count).toBeGreaterThanOrEqual(4);
  });
});

describe('自定义残局 PGN 导入导出', () => {
  it('exportPgn 生成含 FEN 标签的文本，parsePgn 可还原 FEN', () => {
    const pgn = exportPgn({
      startFen: SAMPLE_FEN,
      redName: '攻方',
      blackName: '守方',
      result: '',
      moves: [],
      movesZh: [],
      date: '2026.09.13',
    });
    expect(pgn).toContain('[FEN');
    expect(pgn).toContain(SAMPLE_FEN);
    const meta = parsePgn(pgn);
    expect(meta.startFen).toBe(SAMPLE_FEN);
  });

  it('PGN 无 FEN 标签时 parsePgn 回退初始局面', () => {
    const pgn = '[Event "no fen"]\n\n*';
    const meta = parsePgn(pgn);
    const hasFen = /\[FEN\s+"/.test(pgn);
    expect(hasFen).toBe(false);
    // 回退为初始局面 FEN
    expect(meta.startFen).toContain('rnbakabnr');
  });
});
