// PGN 导出/导入测试
import { describe, expect, it } from 'vitest';
import { initialBoard } from '../src/board/fen';
import { movesToChinese } from '../src/board/notation';
import { exportPgn, parsePgn } from '../src/board/pgn';

const SEQ = ['h7e7', 'h0g2', 'h9g7', 'i0h0', 'i9h9']; // 炮二平五 马8进7 马二进三 车9平8 车一平二
const ZH = movesToChinese(initialBoard(), SEQ);

function samplePgn(): string {
  return exportPgn({
    startFen: 'rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1',
    redName: '皮卡鱼·红',
    blackName: '皮卡鱼·黑',
    result: '',
    moves: SEQ,
    movesZh: ZH,
    date: '2026.09.09',
  });
}

describe('exportPgn', () => {
  it('生成标签与中文着法', () => {
    const pgn = samplePgn();
    expect(pgn).toContain('[Red "皮卡鱼·红"]');
    expect(pgn).toContain('[Black "皮卡鱼·黑"]');
    expect(pgn).toContain('[Result "*"]');
    expect(pgn).toContain('1. 炮二平五 马8进7 2. 马二进三 车9平8 3. 车一平二');
  });

  it('初始局面不写 FEN 标签，自定义局面写', () => {
    const pgn = samplePgn();
    expect(pgn).not.toContain('[FEN');
    const pgn2 = exportPgn({
      startFen: '4k4/9/9/9/9/9/9/9/9/4K4 w - - 0 1',
      redName: 'A', blackName: 'B', result: '', moves: ['e9e8'], movesZh: ['帅五进一'],
    });
    expect(pgn2).toContain('[FEN "4k4/9/9/9/9/9/9/9/9/4K4 w - - 0 1"]');
  });

  it('结果标签映射：1-0 / 0-1 / 1/2-1/2', () => {
    const mk = (result: string) => exportPgn({
      startFen: 'rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1',
      redName: '红方', blackName: '黑方', result, moves: ['e6e5'], movesZh: ['兵五进一'],
    });
    expect(mk('绝杀，红方胜')).toContain('1-0');
    expect(mk('绝杀，黑方胜')).toContain('0-1');
    expect(mk('和局')).toContain('1/2-1/2');
  });
});

describe('parsePgn', () => {
  it('导出→导入 round-trip（中文记法）', () => {
    const meta = parsePgn(samplePgn());
    expect(meta.moves).toEqual(SEQ);
    expect(meta.redName).toBe('皮卡鱼·红');
    expect(meta.blackName).toBe('皮卡鱼·黑');
  });

  it('解析中文记法 PGN（外部软件风格，黑方数字可写汉字）', () => {
    const pgn = [
      '[Event "测试"]',
      '[Red "甲"]',
      '[Black "乙"]',
      '[Result "1-0"]',
      '',
      '1. 炮二平五 马8进7 2. 马二进三 车9平8 1-0',
    ].join('\n');
    const meta = parsePgn(pgn);
    // 车9平8：黑 9 路车（file 8）平到 8 路（file 7）→ 内部 "i0h0"
    expect(meta.moves).toEqual(['h7e7', 'h0g2', 'h9g7', 'i0h0']);
    expect(meta.result).toBe('红方胜');
    expect(meta.redName).toBe('甲');
  });

  it('解析 ICCS 着法 PGN（内部坐标，避开将帅照面）', () => {
    const pgn = ['[FEN "4k4/9/9/9/9/9/9/9/9/4K4 w - - 0 1"]', '', '1. e9f9 e0d0 *'].join('\n');
    const meta = parsePgn(pgn);
    expect(meta.moves).toEqual(['e9f9', 'e0d0']);
  });

  it('非法 token 截断不抛异常；空着法返回空数组', () => {
    expect(parsePgn('1. 炮二平五 乱写 xyz h7e7').moves).toEqual(['h7e7']);
    expect(parsePgn('[Result "*"]\n\n*').moves).toEqual([]);
  });
});
