import { describe, expect, it } from 'vitest';
import { parseIccs, toIccs } from '../src/board/types';

describe('ICCS 着法', () => {
  it('解析与还原', () => {
    const mv = parseIccs('h2e2');
    expect(mv).not.toBeNull();
    expect(mv!.from).toEqual({ file: 7, rank: 2 });
    expect(mv!.to).toEqual({ file: 4, rank: 2 });
    expect(toIccs(mv!)).toBe('h2e2');
  });

  it('非法输入返回 null', () => {
    expect(parseIccs('')).toBeNull();
    expect(parseIccs('z9a9')).toBeNull();
    expect(parseIccs('h10e2')).toBeNull();
  });
});
