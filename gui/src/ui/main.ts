// M2 GUI 入口：棋盘渲染 + 摆子编辑 + FEN 导入导出

import { emptyBoard, initialBoard, parseFen } from '../board/fen';
import { PieceType, Side } from '../board/types';
import { BoardView } from './board-view';

const canvas = document.getElementById('board') as HTMLCanvasElement;
const fenBox = document.getElementById('fen') as HTMLTextAreaElement;
const status = document.getElementById('status') as HTMLDivElement;
const paletteEl = document.getElementById('palette') as HTMLDivElement;

const view = new BoardView(canvas, initialBoard());

function refresh() {
  fenBox.value = view.getFen();
  status.textContent = '';
}

view.setOnChange(refresh);
refresh();

// 棋子面板：红方七种 + 黑方七种 + 删除模式
const red: PieceType[] = ['K', 'A', 'B', 'N', 'R', 'C', 'P'];
const black: PieceType[] = ['K', 'A', 'B', 'N', 'R', 'C', 'P'];
const CHAR: Record<Side, Record<PieceType, string>> = {
  red: { K: '帅', A: '仕', B: '相', N: '马', R: '车', C: '炮', P: '兵' },
  black: { K: '将', A: '士', B: '象', N: '马', R: '车', C: '炮', P: '卒' },
};

interface PaletteCell { el: HTMLDivElement; side: Side; type: PieceType | null; }
const cells: PaletteCell[] = [];

function makeCell(side: Side, type: PieceType | null, label: string) {
  const el = document.createElement('div');
  el.className = 'pcell ' + (type ? side : 'del');
  el.textContent = label;
  el.title = type ? `${side === 'red' ? '红' : '黑'}方 ${label}` : '删除模式（点击棋子移除）';
  el.addEventListener('click', () => {
    cells.forEach(c => c.el.classList.remove('active'));
    el.classList.add('active');
    view.setPalette(type, side);
    status.textContent = type
      ? `摆子模式：${side === 'red' ? '红' : '黑'}方「${label}」，点击棋盘放置，再点同格清除`
      : '删除模式：点击棋盘上的棋子将其移除';
  });
  paletteEl.appendChild(el);
  cells.push({ el, side, type });
}

red.forEach(t => makeCell('red', t, CHAR.red[t]));
black.forEach(t => makeCell('black', t, CHAR.black[t]));
makeCell('red', null, '✕');

(document.getElementById('btnApply') as HTMLButtonElement).addEventListener('click', () => {
  try {
    const { board } = parseFen(fenBox.value);
    view.replaceBoard(board);
    status.textContent = 'FEN 载入成功';
  } catch (err) {
    status.textContent = 'FEN 无效: ' + (err as Error).message;
  }
});

(document.getElementById('btnInitial') as HTMLButtonElement).addEventListener('click', () => {
  view.replaceBoard(initialBoard());
  status.textContent = '已载入初始局面';
});

(document.getElementById('btnClear') as HTMLButtonElement).addEventListener('click', () => {
  view.replaceBoard(emptyBoard());
  status.textContent = '棋盘已清空';
});
