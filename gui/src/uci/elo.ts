// ELO 等级化：低强度档概率性选择次优着法（模拟分段棋手的不精确性）
export interface BlunderProfile {
  p: number;      // 触发概率
  margin: number; // 可接受次优损失上限（厘兵）
}

// 各深度档参考 ELO（与强度下拉选项一致）
export const DEPTH_ELO: Record<string, number> = {
  '1': 1200, '2': 1300, '3': 1400, '5': 1600,
  '8': 1800, '12': 2100, '18': 2500, '24': 2800,
};

export interface PerfRecord {
  elo: number;    // 该档引擎参考 ELO
  win: number;
  loss: number;
  games: number;
}

// 棋力估算（表现分法）：每档 ELO + 400*(胜-负)/局，按局数加权平均；每档不足 3 局不参与
export function estimateElo(perfs: PerfRecord[]): number | null {
  let sum = 0;
  let n = 0;
  for (const p of perfs) {
    if (p.games < 3 || p.elo <= 0) continue;
    sum += (p.elo + (400 * (p.win - p.loss)) / p.games) * p.games;
    n += p.games;
  }
  return n ? Math.round(sum / n) : null;
}

// 按搜索深度档给出扰动参数；>=18 层（满级）不扰动
export function blunderProfile(depth: number): BlunderProfile | null {
  if (depth >= 18) return null;
  if (depth >= 12) return { p: 0.06, margin: 80 };
  if (depth >= 8) return { p: 0.15, margin: 120 };
  if (depth >= 5) return { p: 0.25, margin: 150 };
  return { p: 0.35, margin: 200 };
}

// 从候选着法中挑选扰动着法：
// 候选为 MultiPV 各线首着（cp 为行棋方视角），仅保留 bestCp - cp <= margin 的，
// 候选多于 1 个时按 rand 均匀随机取一个；否则返回 null（走最佳）
export function pickBlunder<T extends { cp: number }>(
  candidates: T[],
  bestCp: number | null,
  margin: number,
  rand: number,
): T | null {
  if (bestCp === null) return null;
  const ok = candidates.filter(c => bestCp - c.cp <= margin);
  if (ok.length < 2) return null;
  return ok[Math.min(ok.length - 1, Math.max(0, Math.floor(rand * ok.length)))];
}
