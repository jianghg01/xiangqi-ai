// 棋盘 Canvas 渲染 + 摆子交互 + 走子动画
// 界面方向：红方在下（rank 9 在屏幕底部），rank 0（黑方）在屏幕顶部

// 棋盘视角翻转模式：
//   none — 红方在下（默认）
//   ud   — 上下翻转（180° 旋转：红上黑下，执黑视角）
//   lr   — 左右翻转（水平镜像：纯左右对调，执子方仍在底部）
export type FlipMode = 'none' | 'ud' | 'lr';

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

// 棋盘主题
export interface BoardTheme {
  bg: string;
  line: string;
  text: string;
  pieceBg: string;
  red: string;
  black: string;
}
export const BOARD_THEMES: Record<string, { name: string; theme: BoardTheme }> = {
  classic: { name: '经典木色', theme: { bg: '#f5e7c8', line: '#6b4a2b', text: '#5b3a1e', pieceBg: '#fdf6e3', red: '#b02a1e', black: '#1e3e6e' } },
  walnut: { name: '胡桃深木', theme: { bg: '#d9b382', line: '#5a3a1a', text: '#4a2f14', pieceBg: '#fbf3df', red: '#a02318', black: '#173a5e' } },
  jade: { name: '墨玉', theme: { bg: '#2e4636', line: '#c8b88a', text: '#d8c9a0', pieceBg: '#f2ead2', red: '#c23a28', black: '#28527a' } },
};

// 分析提示箭头（rank 0 = 引擎第一推荐）
export interface Arrow {
  from: Square;
  to: Square;
  rank: number;
}
const ARROW_COLORS = ['rgba(240,163,10,.9)', 'rgba(86,156,214,.75)', 'rgba(150,150,150,.6)'];
const ARROW_WIDTHS = [9, 7, 6];

export class BoardView {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private board: BoardData;
  private selected: Square | null = null;      // 编辑模式：选中格子
  private paletteType: PieceType | null = null;
  private paletteSide: Side = 'red';
  private onChange: (() => void) | null = null;
  private animating = false;
  private highlights: Square[] = [];           // 对弈模式：合法落点
  private lastMove: { from: Square; to: Square } | null = null;
  private checkSquare: Square | null = null;   // 被将军一方的将/帅位置（红圈标记）
  private arrows: Arrow[] = [];                // 分析提示箭头
  private theme: BoardTheme = BOARD_THEMES.classic.theme;
  private customBg: HTMLImageElement | null = null;   // 自定义底纹图（dataURL 导入，拉伸铺满）
  private customBgUrl = '';
  private dragFrom: Square | null = null;      // 拖拽中的棋子起点
  private dragPos: [number, number] | null = null; // 拖拽当前像素位置
  private swallowClick = false;                // 拖拽后吞掉紧随的 click
  private flipMode: FlipMode = 'none';         // 棋盘视角：默认/上下翻转/左右翻转
  // 对弈模式：设置后接管棋盘点击；为 null 时走编辑摆子逻辑
  onSquare: ((s: Square) => void) | null = null;

  constructor(canvas: HTMLCanvasElement, board: BoardData) {
    this.canvas = canvas;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('无法获取 canvas 上下文');
    this.ctx = ctx;
    this.board = board;
    this.resize(W, H);   // 初始尺寸=逻辑尺寸，缓冲 2x 抗锯齿

    canvas.addEventListener('click', e => this.onClick(e));
    canvas.addEventListener('mousedown', e => this.onMouseDown(e));
    canvas.addEventListener('mousemove', e => this.onMouseMove(e));
    canvas.addEventListener('mouseup', e => this.onMouseUp(e));
    canvas.addEventListener('mouseleave', () => {
      if (this.dragFrom) { this.dragFrom = null; this.dragPos = null; this.draw(); }
    });
    this.draw();
  }

  // 拖拽走子：仅对弈模式（onSquare 已接管）启用；按住己方棋子拖到目标格即走子
  private onMouseDown(e: MouseEvent) {
    if (!this.onSquare || this.animating) return;
    const s = this.toSquare(e);
    if (!s) return;
    if (!getPiece(this.board, s.file, s.rank)) return;
    this.dragFrom = s;
    this.dragPos = this.eventPos(e);
  }

  private onMouseMove(e: MouseEvent) {
    if (!this.dragFrom) return;
    this.dragPos = this.eventPos(e);
    this.draw();
    const p = getPiece(this.board, this.dragFrom.file, this.dragFrom.rank);
    if (p && this.dragPos) this.drawPiece(p, this.dragPos[0], this.dragPos[1], true);
  }

  private onMouseUp(e: MouseEvent) {
    if (!this.dragFrom) return;
    const from = this.dragFrom;
    this.dragFrom = null;
    this.dragPos = null;
    this.swallowClick = true; // 抑制 mouseup 后浏览器补发的 click
    const to = this.toSquare(e);
    const same = to && to.file === from.file && to.rank === from.rank;
    if (to && !same) {
      // 先选起点再落目标：与两次点击等价（复用现有选择/走子逻辑）
      this.onSquare?.(from);
      this.onSquare?.(to);
    } else {
      // 原地松手：等价单击选中
      this.onSquare?.(from);
    }
    this.draw();
  }

  // 按目标 CSS 尺寸等比缩放棋盘：缓冲始终为显示尺寸的 2x（高 DPI 清晰），重绘
  // 逻辑坐标恒为 W×H，通过 setTransform 映射到缓冲像素
  resize(cssW: number, cssH: number) {
    const s = cssW / W;   // 显示缩放比（s>1 放大、s<1 缩小）
    this.canvas.width = Math.max(2, Math.round(cssW * 2));
    this.canvas.height = Math.max(2, Math.round(cssH * 2));
    this.canvas.style.width = Math.round(cssW) + 'px';
    this.canvas.style.height = Math.round(cssH) + 'px';
    this.ctx.setTransform(2 * s, 0, 0, 2 * s, 0, 0);
    this.draw();
  }

  // 事件坐标（CSS 像素）→ 画布逻辑坐标（除以显示缩放比，保证拖拽绘制与点击换算一致）
  private eventPos(e: MouseEvent): [number, number] {
    const rect = this.canvas.getBoundingClientRect();
    const k = rect.width / W;
    return [(e.clientX - rect.left) / k, (e.clientY - rect.top) / k];
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
    this.highlights = [];
    this.checkSquare = null;
    this.draw();
    this.onChange?.();
  }

  // 对弈模式：显示合法落点与上一步
  setHighlights(squares: Square[]) { this.highlights = squares; this.draw(); }
  setLastMove(from: Square | null, to: Square | null) {
    this.lastMove = from && to ? { from, to } : null;
    this.draw();
  }
  setCheck(s: Square | null) { this.checkSquare = s; this.draw(); }
  setFlipMode(m: FlipMode) { if (this.flipMode !== m) { this.flipMode = m; this.draw(); } }
  getFlipMode(): FlipMode { return this.flipMode; }
  setArrows(arr: Arrow[]) { this.arrows = arr; this.draw(); }
  setThemeByName(name: string) {
    const t = BOARD_THEMES[name]?.theme;
    if (!t) return;
    this.theme = t;
    this.draw();
  }

  // 自定义棋盘底纹：dataURL 图片拉伸铺满；null 清除恢复木色
  setCustomBg(dataUrl: string | null) {
    if (!dataUrl) { this.customBg = null; this.customBgUrl = ''; this.draw(); return; }
    if (dataUrl === this.customBgUrl) return;
    const img = new Image();
    img.onload = () => {
      this.customBg = img;
      this.customBgUrl = dataUrl;
      this.draw();
    };
    img.src = dataUrl;
  }

  clearOverlay() {
    this.highlights = [];
    this.selected = null;
    this.draw();
  }

  // 屏幕像素 -> 棋盘坐标（按翻转模式镜像；ud=180° 旋转，lr=水平镜像）
  // k 为显示缩放比例：Canvas 缓冲随显示尺寸重设，事件坐标除以 k 换算回逻辑坐标
  private toSquare(e: MouseEvent): Square | null {
    const rect = this.canvas.getBoundingClientRect();
    const k = rect.width / W;
    const x = e.clientX - rect.left - MARGIN * k;
    const y = e.clientY - rect.top - MARGIN * k;
    const file = Math.round(x / (CELL * k));
    const rank = Math.round(y / (CELL * k));
    if (file < 0 || file > 8 || rank < 0 || rank > 9) return null;
    if (Math.abs(x - file * CELL * k) > CELL * k * 0.45) return null;
    if (Math.abs(y - rank * CELL * k) > CELL * k * 0.45) return null;
    if (this.flipMode === 'ud') return sq(8 - file, 9 - rank);
    if (this.flipMode === 'lr') return sq(8 - file, rank);
    return sq(file, rank);
  }

  private toXy(s: Square): [number, number] {
    let f = s.file;
    let r = s.rank;
    if (this.flipMode === 'ud') { f = 8 - f; r = 9 - r; }
    else if (this.flipMode === 'lr') { f = 8 - f; }
    return [MARGIN + f * CELL, MARGIN + r * CELL];
  }

  private onClick(e: MouseEvent) {
    if (this.swallowClick) { this.swallowClick = false; return; }
    const s = this.toSquare(e);
    if (!s || this.animating) return;
    if (this.onSquare) {
      this.onSquare(s);
      return;
    }

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
    c.fillStyle = this.theme.bg;
    c.fillRect(0, 0, W, H);
    // 自定义底纹：拉伸铺满后叠一层木色半透明，保证线条/文字/棋子可读
    if (this.customBg) {
      c.drawImage(this.customBg, 0, 0, W, H);
      c.globalAlpha = 0.45;
      c.fillStyle = this.theme.bg;
      c.fillRect(0, 0, W, H);
      c.globalAlpha = 1;
    }

    // 横线 10 条
    c.strokeStyle = this.theme.line;
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
    c.fillStyle = this.theme.text;
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
    c.strokeStyle = this.theme.line;
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

    // 棋子（拖拽中的棋子最后单独绘制在光标处）
    for (let r = 0; r < 10; r++)
      for (let f = 0; f < 9; f++) {
        if (this.dragFrom && this.dragFrom.file === f && this.dragFrom.rank === r) continue;
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

    // 合法落点提示（绿点）
    c.fillStyle = 'rgba(46,160,67,.85)';
    for (const s of this.highlights) {
      const [x, y] = this.toXy(s);
      const occupied = getPiece(this.board, s.file, s.rank);
      if (occupied) {
        // 可吃子：画四角框
        c.strokeStyle = 'rgba(46,160,67,.9)';
        c.lineWidth = 2.5;
        const r0 = PIECE_R + 3;
        c.strokeRect(x - r0, y - r0, r0 * 2, r0 * 2);
        c.lineWidth = 1;
      } else {
        c.beginPath();
        c.arc(x, y, 9, 0, Math.PI * 2);
        c.fill();
      }
    }

    // 上一步标记（来源格小方框）
    if (this.lastMove) {
      c.strokeStyle = 'rgba(240,163,10,.9)';
      c.lineWidth = 2;
      const [x0, y0] = this.toXy(this.lastMove.from);
      c.strokeRect(x0 - 12, y0 - 12, 24, 24);
      c.lineWidth = 1;
    }

    // 被将军的将/帅：红色双圈警示
    if (this.checkSquare) {
      const [x, y] = this.toXy(this.checkSquare);
      c.strokeStyle = 'rgba(200,40,26,.95)';
      c.lineWidth = 3;
      c.beginPath();
      c.arc(x, y, PIECE_R + 5, 0, Math.PI * 2);
      c.stroke();
      c.strokeStyle = 'rgba(200,40,26,.5)';
      c.lineWidth = 2;
      c.beginPath();
      c.arc(x, y, PIECE_R + 10, 0, Math.PI * 2);
      c.stroke();
      c.lineWidth = 1;
    }

    // 分析提示箭头（半透明，最上层）
    for (const a of this.arrows) {
      const rank = Math.max(0, Math.min(2, a.rank));
      const [x0, y0] = this.toXy(a.from);
      const [x1, y1] = this.toXy(a.to);
      const dx = x1 - x0, dy = y1 - y0;
      const len = Math.hypot(dx, dy) || 1;
      // 起止各留出棋子半径，箭头尖端再留 4px
      const sx = x0 + (dx / len) * (PIECE_R - 2);
      const sy = y0 + (dy / len) * (PIECE_R - 2);
      const ex = x1 - (dx / len) * (PIECE_R + 4);
      const ey = y1 - (dy / len) * (PIECE_R + 4);
      const w = ARROW_WIDTHS[rank];
      c.strokeStyle = ARROW_COLORS[rank];
      c.fillStyle = ARROW_COLORS[rank];
      c.lineWidth = w;
      c.lineCap = 'round';
      c.beginPath();
      c.moveTo(sx, sy);
      c.lineTo(ex, ey);
      c.stroke();
      // 箭头三角
      const ang = Math.atan2(dy, dx);
      const head = w * 2.4;
      c.beginPath();
      c.moveTo(ex + Math.cos(ang) * head, ey + Math.sin(ang) * head);
      c.lineTo(ex + Math.cos(ang + 2.5) * head, ey + Math.sin(ang + 2.5) * head);
      c.lineTo(ex + Math.cos(ang - 2.5) * head, ey + Math.sin(ang - 2.5) * head);
      c.closePath();
      c.fill();
      c.lineWidth = 1;
      c.lineCap = 'butt';
    }
  }

  private drawPiece(p: Piece, x: number, y: number, lifted = false) {
    const c = this.ctx;
    c.save();
    if (lifted) { c.shadowColor = 'rgba(0,0,0,.35)'; c.shadowBlur = 12; }
    c.beginPath();
    c.arc(x, y, PIECE_R, 0, Math.PI * 2);
    c.fillStyle = this.theme.pieceBg;
    c.fill();
    c.strokeStyle = p.side === 'red' ? this.theme.red : this.theme.black;
    c.lineWidth = 2.5;
    c.stroke();
    c.fillStyle = p.side === 'red' ? this.theme.red : this.theme.black;
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
