// 开局库测试：每条序列必须从初始局面逐合法重放；匹配逻辑正确
import { describe, expect, it } from 'vitest';
import { OPENINGS, isOpeningValid, matchOpening } from '../src/board/openings';

describe('开局库', () => {
  it('所有开局序列每一步都合法', () => {
    for (const o of OPENINGS) {
      expect(isOpeningValid(o), `${o.name} 存在非法着法`).toBe(true);
    }
  });

  it('开局名互不重复', () => {
    const names = OPENINGS.map(o => o.name);
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

  it('开局库规模（16 条）', () => {
    expect(OPENINGS.length).toBe(16);
  });

  it('开局走完时 next 为 null', () => {
    const m = matchOpening(['c6c5', 'b2c2']);
    expect(m!.name).toBe('仙人指路对卒底炮');
    expect(m!.next).toBeNull();
  });

  it('偏离开局库返回 null', () => {
    expect(matchOpening(['e9e8'])).toBeNull();          // 帅五进一，无此开局
    expect(matchOpening(['h7e7', 'e6e5'])).toBeNull();  // 黑回应不在库中
  });
});
