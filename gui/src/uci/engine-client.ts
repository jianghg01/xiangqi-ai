// UCI 客户端（纯逻辑，传输层注入，便于测试）

export interface EngineInfo {
  depth: number;
  multipv: number;
  scoreCp: number | null;   // 分数（行棋方视角，厘兵）
  scoreMate: number | null; // #N 步杀
  pv: string[];             // ICCS 着法序列
}

export interface GoOptions {
  depth?: number;
  movetime?: number;
  infinite?: boolean;
}

export function parseInfo(line: string): EngineInfo | null {
  const t = line.split(/\s+/);
  let depth = 0, multipv = 1, scoreCp: number | null = null, scoreMate: number | null = null;
  const pv: string[] = [];
  for (let i = 1; i < t.length; i++) {
    if (t[i] === 'depth') depth = parseInt(t[++i], 10) || 0;
    else if (t[i] === 'multipv') multipv = parseInt(t[++i], 10) || 1;
    else if (t[i] === 'score') {
      if (t[i + 1] === 'cp') { scoreCp = parseInt(t[i + 2], 10); i += 2; }
      else if (t[i + 1] === 'mate') { scoreMate = parseInt(t[i + 2], 10); i += 2; }
    } else if (t[i] === 'pv') {
      pv.push(...t.slice(i + 1));
      break;
    }
  }
  if (!depth && !pv.length) return null;
  return { depth, multipv, scoreCp, scoreMate, pv };
}

export class UciClient {
  onInfo: (info: EngineInfo) => void = () => {};
  onBestmove: (bestmove: string) => void = () => {};
  onReady: () => void = () => {};

  constructor(private send: (cmd: string) => void) {}

  handleLine(line: string): void {
    if (line.startsWith('info ')) {
      const info = parseInfo(line);
      if (info) this.onInfo(info);
    } else if (line.startsWith('bestmove')) {
      const parts = line.split(/\s+/);
      this.onBestmove(parts[1] ?? '(none)');
    } else if (line === 'readyok') {
      this.onReady();
    }
  }

  uci() { this.send('uci'); }
  isready() { this.send('isready'); }
  setOption(name: string, value: string | number) { this.send(`setoption name ${name} value ${value}`); }
  newGame() { this.send('ucinewgame'); }
  position(fen: string, moves: string[] = []) {
    this.send(`position fen ${fen}` + (moves.length ? ` moves ${moves.join(' ')}` : ''));
  }
  go(opts: GoOptions) {
    let s = 'go';
    if (opts.depth) s += ` depth ${opts.depth}`;
    if (opts.movetime) s += ` movetime ${opts.movetime}`;
    if (opts.infinite) s += ' infinite';
    this.send(s);
  }
  stop() { this.send('stop'); }
  quit() { this.send('quit'); }
}

// 引擎分数（行棋方视角）→ 红方视角
export function toRedPersp(cp: number, sideToMove: 'red' | 'black'): number {
  return sideToMove === 'red' ? cp : -cp;
}

// 厘兵 → 胜率%（logistic，k 与 lichess 一致）
export function cpToWinrate(cp: number): number {
  return (100 / (1 + Math.exp(-0.00368208 * cp)));
}

export function formatScore(cp: number | null, mate: number | null): string {
  if (mate !== null) return `#${mate}`;
  if (cp === null) return '?';
  return (cp >= 0 ? '+' : '') + (cp / 100).toFixed(2);
}

// ---------- 坐标系转换 ----------
// 引擎 ICCS：rank 0 = 红方底线（FEN 最后一行）；本项目内部：rank 0 = 黑方底线（FEN 首行）
// 因此引擎的 rank r 对应内部 rank 9-r；file 两侧一致（a..i = 0..8）
export function engineMoveToLocal(mv: { from: { file: number; rank: number }; to: { file: number; rank: number } }): { from: { file: number; rank: number }; to: { file: number; rank: number } } {
  return {
    from: { file: mv.from.file, rank: 9 - mv.from.rank },
    to: { file: mv.to.file, rank: 9 - mv.to.rank },
  };
}

// 引擎 pv 着法串（ICCS）转内部坐标串，仅用于显示
export function enginePvToLocal(pv: string[]): string[] {
  return pv.map(s => {
    const m = /^([a-i])(\d)([a-i])(\d)$/.exec(s);
    if (!m) return s;
    return m[1] + (9 - parseInt(m[2], 10)) + m[3] + (9 - parseInt(m[4], 10));
  });
}
