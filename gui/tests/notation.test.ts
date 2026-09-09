// 中文记谱测试
import { describe, expect, it } from 'vitest';
import { emptyBoard, initialBoard, parseFen, setPiece } from '../src/board/fen';
import { parseIccs } from '../src/board/types';
import { moveToChinese, movesToChinese } from '../src/board/notation';

function zh(board: ReturnType<typeof initialBoard>, iccs: string): string {
  const mv = parseIccs(iccs);
  if (!mv) throw new Error('bad iccs ' + iccs);
  return moveToChinese(board, mv);
}

describe('moveToChinese', () => {
  it('开局标准着法：炮二平五 / 马8进7 / 马二进三 / 车1平2', () => {
    const b = initialBoard();
    expect(zh(b, 'h7e7')).toBe('炮二平五');
    expect(zh(b, 'h0g2')).toBe('马8进7');
    expect(zh(b, 'h9g7')).toBe('马二进三');
    expect(zh(b, 'a0b0')).toBe('车1平2');
  });

  it('直线兵种进退用步数：兵五进一 / 卒3进1', () => {
    const b = initialBoard();
    expect(zh(b, 'e6e5')).toBe('兵五进一');      // 红中兵前进一步（rank 6→5）
    expect(zh(b, 'c3c4')).toBe('卒3进1');        // 黑 3路卒前进一步（rank 3→4，黑前进=rank 增大）
  });

  it('黑方平移：卒3平2', () => {
    const b = initialBoard();
    expect(zh(b, 'c3b3')).toBe('卒3平2');
  });

  it('帅与仕：帅五进一 / 仕六进五', () => {
    const b = initialBoard();
    expect(zh(b, 'e9e8')).toBe('帅五进一');      // 红帅 rank 9→8
    expect(zh(b, 'd9e8')).toBe('仕六进五');      // 红仕斜走到花心
  });

  it('同线消歧：前炮退二 / 后炮进二', () => {
    const b = emptyBoard();
    setPiece(b, 4, 9, { side: 'red', type: 'K' });
    setPiece(b, 4, 0, { side: 'black', type: 'K' });
    setPiece(b, 4, 4, { side: 'red', type: 'C' }); // 前（rank 小，靠敌方）
    setPiece(b, 4, 7, { side: 'red', type: 'C' }); // 后
    expect(zh(b, 'e4e6')).toBe('前炮退二');        // rank 4→6，红方后退 2 步
    expect(zh(b, 'e7e5')).toBe('后炮进二');        // rank 7→5，红方前进 2 步
  });

  it('同线消歧（黑方）：前卒进1 / 后卒退1', () => {
    const b = emptyBoard();
    setPiece(b, 4, 9, { side: 'red', type: 'K' });
    setPiece(b, 4, 0, { side: 'black', type: 'K' });
    setPiece(b, 4, 6, { side: 'black', type: 'P' }); // 前（rank 大，靠红方）
    setPiece(b, 4, 3, { side: 'black', type: 'P' }); // 后
    expect(zh(b, 'e6e5')).toBe('前卒退1');
    expect(zh(b, 'e3e4')).toBe('后卒进1');
  });

  it('吃子着法照常记谱：炮二平五打马', () => {
    const b = emptyBoard();
    setPiece(b, 4, 9, { side: 'red', type: 'K' });
    setPiece(b, 4, 0, { side: 'black', type: 'K' });
    setPiece(b, 7, 7, { side: 'red', type: 'C' });
    setPiece(b, 4, 7, { side: 'black', type: 'N' });
    expect(zh(b, 'h7e7')).toBe('炮二平五'); // 记谱只看走子，不看吃子
  });

  it('非法输入返回空串', () => {
    const b = emptyBoard();
    setPiece(b, 4, 9, { side: 'red', type: 'K' });
    expect(zh(b, 'a0a1')).toBe('');
  });
});

describe('movesToChinese', () => {
  it('完整开局序列', () => {
    const seq = ['h7e7', 'h0g2', 'h9g7', 'b0c2', 'a0a1'];
    // h7e7=炮二平五 h0g2=马8进7 h9g7=马二进三 b0c2=马2进3 a0a1=车1进1
    const out = movesToChinese(initialBoard(), seq);
    expect(out).toEqual(['炮二平五', '马8进7', '马二进三', '马2进3', '车1进1']);
  });

  it('非法着法截断不抛异常', () => {
    const out = movesToChinese(initialBoard(), ['h7e7', 'xxxx', 'h9g7']);
    expect(out).toEqual(['炮二平五']);
  });

  it('自定义起始局面（非标准 FEN）', () => {
    const { board } = parseFen('4k4/9/9/9/9/9/9/9/9/4K4 w - - 0 1');
    const out = movesToChinese(board, ['e9e8']);
    expect(out).toEqual(['帅五进一']);
  });
});
