// 棋盘 Canvas 渲染 + 摆子交互 + 走子动画
// 界面方向：红方在下（rank 9 在屏幕底部），rank 0（黑方）在屏幕顶部

import { BoardData, getPiece, setPiece, toFen } from '../board/fen';
import {
  Piece,
  PieceType,
  PIECE_CHAR,
  Side,
  Square,
  sq,
} from '../board/types';

const CELL = 64;          // 格距（px）
const MARGIN = 40;        // 边距
const PIECE_R = 26;       // 棋子半径
const W = MARGIN * 2 + CELL * 8;
const H = MARGIN * 2 + CELL * 9;

const BG = '#f5e7c8';
const LINE = '#6b4a2b';
const TEXT = '#5b3a1e';

export class BoardView {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private board: BoardData;
  private selected: Square | null = null;      // 编辑模式：选中格子
  private paletteType: PieceType | null = null;
  private paletteSide: Side = 'red';
  private onChange: (() => void) | null = null;
  private animating = false;

  constructor(canvas: HTMLCanvasElement, board: BoardData) {
    this.canvas = canvas;
    this.canvas.width = W * 2;   // 2x 抗锯齿
    this.canvas.height = H * 2;
    this.canvas.style.width = W + 'px';
    this.canvas.style.height = H + 'px';
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('无法获取 canvas 上下文');
    this.ctx = ctx;
    this.ctx.scale(2, 2);
    this.board = board;

    canvas.addEventListener('click', e => this.onClick(e));
    this.draw();
  }

  setOnChange(cb: () => void) { this.onChange = cb; }
  setPalette(type: PieceType | null, side: Side) {
    this.paletteType = type;
    this.paletteSide = side;
  }
  getFen(): string { return toFen(this.board); }
  getBoard(): BoardData { return this.board; }

  // 替换整个局面（载入 FEN / 初始局面 / 清空）
  replaceBoard(board: BoardData) {
    this.board = board;
    this.selected = null;
    this.draw();
    this.onChange?.();
  }

  // 屏幕像素 -> 棋盘坐标
  private toSquare(e: MouseEvent): Square | null {
    const rect = this.canvas.getBoundingClientRect();
    const x = e.clientX - rect.left - MARGIN;
    const y = e.clientY - rect.top - MARGIN;
    const file = Math.round(x / CELL);
    const rank = Math.round(y / CELL);
    if (file < 0 || file > 8 || rank < 0 || rank > 9) return null;
    if (Math.abs(x - file * CELL) > CELL * 0.45) return null;
    if (Math.abs(y - rank * CELL) > CELL * 0.45) return null;
    return sq(file, rank);
  }

  private toXy(s: Square): [number, number] {
    return [MARGIN + s.file * CELL, MARGIN + s.rank * CELL];
  }

  private onClick(e: MouseEvent) {
    const s = this.toSquare(e);
    if (!s || this.animating) return;

    const existing = getPiece(this.board, s.file, s.rank);
    if (this.paletteType) {
      // 摆子模式：同型棋子点击即清除，否则放置
      if (existing && existing.side === this.paletteSide && existing.type === this.paletteType) {
        setPiece(this.board, s.file, s.rank, null);
      } else {
        setPiece(this.board, s.file, s.rank, { side: this.paletteSide, type: this.paletteType });
      }
      this.selected = null;
    } else {
      // 无摆子选择：切换选中（用于删除或后续走子）
      if (this.selected && existing && same(s, this.selected)) {
        setPiece(this.board, s.file, s.rank, null);
        this.selected = null;
      } else {
        this.selected = existing ? s : null;
      }
    }
    this.draw();
    this.onChange?.();
  }

  // 走子动画（M3 规则校验通过后由上层调用）
  animateMove(from: Square, to: Square, done?: () => void) {
    const p = getPiece(this.board, from.file, from.rank);
    if (!p) { done?.(); return; }
    this.animating = true;
    const [x0, y0] = this.toXy(from);
    const [x1, y1] = this.toXy(to);
    const t0 = performance.now();
    const DUR = 260;
    const step = (t: number) => {
      const k = Math.min(1, (t - t0) / DUR);
      const ease = 1 - Math.pow(1 - k, 3);
      const cx = x0 + (x1 - x0) * ease;
      const cy = y0 + (y1 - y0) * ease;
      this.draw();
      this.drawPiece(p, cx, cy, true);
      if (k < 1) requestAnimationFrame(step);
      else {
        this.animating = false;
        done?.();
      }
    };
    requestAnimationFrame(step);
  }

  private draw() {
    const c = this.ctx;
    c.clearRect(0, 0, W, H);
    c.fillStyle = BG;
    c.fillRect(0, 0, W, H);

    // 横线 10 条
    c.strokeStyle = LINE;
    c.lineWidth = 1;
    for (let r = 0; r < 10; r++) {
      c.beginPath();
      c.moveTo(MARGIN, MARGIN + r * CELL);
      c.lineTo(MARGIN + 8 * CELL, MARGIN + r * CELL);
      c.stroke();
    }
    // 竖线：中间断开（楚河汉界）
    for (let f = 0; f < 9; f++) {
      if (f === 0 || f === 8) {
        c.beginPath();
        c.moveTo(MARGIN + f * CELL, MARGIN);
        c.lineTo(MARGIN + f * CELL, MARGIN + 9 * CELL);
        c.stroke();
      } else {
        c.beginPath();
        c.moveTo(MARGIN + f * CELL, MARGIN);
        c.lineTo(MARGIN + f * CELL, MARGIN + 4 * CELL);
        c.stroke();
        c.beginPath();
        c.moveTo(MARGIN + f * CELL, MARGIN + 5 * CELL);
        c.lineTo(MARGIN + f * CELL, MARGIN + 9 * CELL);
        c.stroke();
      }
    }
    // 外框加粗
    c.lineWidth = 2.5;
    c.strokeRect(MARGIN - 4, MARGIN - 4, 8 * CELL + 8, 9 * CELL + 8);
    c.lineWidth = 1;

    // 九宫斜线
    for (const [f0, r0, f1, r1] of [[3,0,5,2],[5,0,3,2],[3,7,5,9],[5,7,3,9]]) {
      c.beginPath();
      c.moveTo(MARGIN + f0 * CELL, MARGIN + r0 * CELL);
      c.lineTo(MARGIN + f1 * CELL, MARGIN + r1 * CELL);
      c.stroke();
    }

    // 楚河汉界
    c.fillStyle = TEXT;
    c.font = '28px serif';
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillText('楚  河', MARGIN + 2 * CELL, MARGIN + 4.5 * CELL);
    c.fillText('汉  界', MARGIN + 6 * CELL, MARGIN + 4.5 * CELL);

    // 兵/炮位标记（四角直角短线，边线处只画内侧）
    const marks: [number, number][] = [
      [1,2],[7,2],[0,3],[2,3],[4,3],[6,3],[8,3],
      [1,7],[7,7],[0,6],[2,6],[4,6],[6,6],[8,6],
    ];
    c.strokeStyle = LINE;
    for (const [f, r] of marks) {
      const [x, y] = this.toXy(sq(f, r));
      const g = 5, l = 10;
      const sides = [f > 0, f < 8]; // 左侧、右侧是否画
      for (const [on, dx] of [[sides[0], -1], [sides[1], 1]] as [boolean, number][]) {
        if (!on) continue;
        for (const dy of [-1, 1]) {
          c.beginPath();
          c.moveTo(x + dx * g, y + dy * g);
          c.lineTo(x + dx * (g + l), y + dy * g);
          c.stroke();
          c.beginPath();
          c.moveTo(x + dx * g, y + dy * g);
          c.lineTo(x + dx * g, y + dy * (g + l));
          c.stroke();
        }
      }
    }

    // 棋子
    for (let r = 0; r < 10; r++)
      for (let f = 0; f < 9; f++) {
        const p = getPiece(this.board, f, r);
        if (p) {
          const [x, y] = this.toXy(sq(f, r));
          this.drawPiece(p, x, y);
        }
      }

    // 选中高亮
    if (this.selected) {
      const [x, y] = this.toXy(this.selected);
      c.strokeStyle = '#c8402a';
      c.lineWidth = 2;
      c.beginPath();
      c.arc(x, y, PIECE_R + 4, 0, Math.PI * 2);
      c.stroke();
      c.lineWidth = 1;
    }
  }

  private drawPiece(p: Piece, x: number, y: number, lifted = false) {
    const c = this.ctx;
    c.save();
    if (lifted) { c.shadowColor = 'rgba(0,0,0,.35)'; c.shadowBlur = 12; }
    c.beginPath();
    c.arc(x, y, PIECE_R, 0, Math.PI * 2);
    c.fillStyle = '#fdf6e3';
    c.fill();
    c.strokeStyle = p.side === 'red' ? '#b02a1e' : '#1e3e6e';
    c.lineWidth = 2.5;
    c.stroke();
    c.fillStyle = p.side === 'red' ? '#b02a1e' : '#1e3e6e';
    c.font = 'bold 26px "KaiTi","SimSun",serif';
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillText(PIECE_CHAR[p.side][p.type], x, y + 1);
    c.restore();
  }
}

function same(a: Square, b: Square): boolean {
  return a.file === b.file && a.rank === b.rank;
}

export { W as BOARD_W, H as BOARD_H, CELL, MARGIN };
