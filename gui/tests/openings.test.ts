// 开局库测试：每条序列必须从初始局面逐合法重放；匹配逻辑正确
import { describe, expect, it } from 'vitest';
import {
  OPENINGS,
  isOpeningValid,
  matchOpening,
  matchOpeningByCategory,
  categoryOf,
} from '../src/board/openings';

describe('开局库', () => {
  it('所有开局序列每一步都合法', () => {
    for (const o of OPENINGS) {
      expect(isOpeningValid(o), `${o.name} 存在非法着法`).toBe(true);
    }
  });

  it('开局名互不重复', () => {
    const names = OPENINGS.map((o) => o.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it('空序列匹配所有开局中最长者，next 为第 1 步', () => {
    const m = matchOpening([]);
    expect(m).not.toBeNull();
    // 最长的是平炮兑车（12 步）
    expect(m!.name).toBe('中炮过河车对屏风马平炮兑车');
    expect(m!.next).toBe('h7e7');
  });

  it('部分走子后匹配并给出下一步', () => {
    const m = matchOpening(['h7e7', 'h0g2', 'h9g7', 'i0h0', 'i9h9', 'b0c2']);
    // 此时最长匹配是五七炮/五六炮（10 步，前缀相同）与进三兵（8 步）
    expect(['五七炮对屏风马', '五六炮对屏风马']).toContain(m!.name);
    expect(m!.next).toBe('b9a7');
    const m2 = matchOpening(['h7e7', 'h0g2', 'h9g7', 'i0h0']);
    expect(m2!.next).toBe('i9h9');
  });

  it('开局库规模（27 条）', () => {
    expect(OPENINGS.length).toBe(27);
  });

  it('开局走完时 next 为 null', () => {
    const m = matchOpening(['h7e7', 'b0a2', 'h9g7', 'h0g2', 'i9h9', 'i0h0']);
    expect(m!.name).toBe('中炮对单提马');
    expect(m!.next).toBeNull();
  });

  it('偏离开局库返回 null', () => {
    expect(matchOpening(['e9e8'])).toBeNull(); // 帅五进一，无此开局
    expect(matchOpening(['h7e7', 'e6e5'])).toBeNull(); // 黑回应不在库中
  });
});

describe('按开局类别匹配（人指定起手）', () => {
  it('空序列 + 中炮类：首着为炮二平五/炮八平五，名称属中炮体系', () => {
    const m = matchOpeningByCategory([], 'zhongpao')!;
    expect(['h7e7', 'b7e7']).toContain(m.next);
    expect(
      [
        '中炮',
        '五七炮',
        '五六炮',
        '五九炮',
        '列手炮',
        '反宫马',
        '屏风马',
        '单提马',
        '半途列炮',
      ].some((k) => m.name.includes(k)),
    ).toBe(true);
  });

  it('空序列 + 顺炮类：名称含顺炮', () => {
    const m = matchOpeningByCategory([], 'shunpao')!;
    expect(m.name.includes('顺炮')).toBe(true);
    expect(['h7e7', 'b7e7']).toContain(m.next);
  });

  it('类别分布与开局库 27 条对齐（无遗漏、无重复归类）', () => {
    const counts: Record<string, number> = {};
    for (const o of OPENINGS) {
      const c = categoryOf(o.name, o.moves[0]);
      counts[c] = (counts[c] ?? 0) + 1;
    }
    // 每条开局都必须归入 7 类之一，合计 27
    expect(Object.values(counts).reduce((a, b) => a + b, 0)).toBe(OPENINGS.length);
    expect(Object.keys(counts).length).toBe(7);
    for (const k of Object.keys(counts)) expect(counts[k]).toBeGreaterThan(0);
  });

  it('空序列 + 仙人指路/飞相/过宫炮/起马/九尾龟：首着与类别对应', () => {
    expect(matchOpeningByCategory([], 'xianren')!.next).toBe('c6c5');
    expect(matchOpeningByCategory([], 'feixiang')!.next).toBe('g9e7');
    expect(matchOpeningByCategory([], 'guogong')!.next).toBe('h7d7');
    expect(matchOpeningByCategory([], 'qima')!.next).toBe('h9g7');
    expect(matchOpeningByCategory([], 'jiuweigu')!.next).toBe('a6a5');
  });

  it('空序列 + 不限定：多次随机应出现多种首着（打破固定走法）', () => {
    const firsts = new Set<string>();
    for (let i = 0; i < 200; i++) {
      const m = matchOpeningByCategory([], 'any');
      if (m) firsts.add(m.next!);
    }
    expect(firsts.size).toBeGreaterThan(1);
  });

  it('类别内无匹配时回退到兼容全量（不返回 null）', () => {
    // 已走炮二平五后，指定「仙人指路」类已不兼容 → 应回退到兼容开局并给出合法 next
    const m = matchOpeningByCategory(['h7e7'], 'xianren');
    expect(m).not.toBeNull();
    expect(m!.next).not.toBeNull();
  });

  it('偏离开局库时仍返回 null', () => {
    expect(matchOpeningByCategory(['e9e8'], 'any')).toBeNull();
    expect(matchOpeningByCategory(['h7e7', 'e6e5'], 'zhongpao')).toBeNull();
  });

  it('开局走完时 next 为 null', () => {
    const m = matchOpeningByCategory(['h7e7', 'b0a2', 'h9g7', 'h0g2', 'i9h9', 'i0h0'], 'zhongpao');
    expect(m!.name).toBe('中炮对单提马');
    expect(m!.next).toBeNull();
  });
});
