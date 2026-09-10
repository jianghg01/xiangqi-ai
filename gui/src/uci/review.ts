// AI 复盘点评纯逻辑：评分归一化、损失计算、标记分类、ACPL 汇总（可单测）

export interface ReviewSideAcc {
  sum: number;   // 损失合计（单手上限 500）
  cnt: number;   // 手数
  q1: number;    // ?! 缓着数
  q2: number;    // ?  失误数
  q3: number;    // ?? 大败数
}

export interface ReviewSummary {
  red: ReviewSideAcc;
  black: ReviewSideAcc;
}

// 引擎评分 → 数值（行棋方视角）：#N 杀 = 10000-N；被 #N 杀 = -(10000-N)
export function normalizeScore(scoreCp: number | null, scoreMate: number | null): number {
  if (scoreMate !== null) {
    return scoreMate > 0 ? 10000 - scoreMate : -(10000 + scoreMate);
  }
  return scoreCp ?? 0;
}

// 每手棋损失 = 走前预期 - 走后局面（对手视角评分取负换算回走子方）
// scores[k] 为局面 k（startFen + 前 k 手）的行棋方视角最优评分，长度 n+1
export function lossList(scores: number[], n: number): number[] {
  const losses: number[] = [];
  for (let k = 0; k < n; k++) {
    let loss = scores[k] - (-scores[k + 1]);
    if (loss < 0) loss = 0; // 走得比预期更好，不扣分
    losses.push(loss);
  }
  return losses;
}

// 单手标记分类：正常/null、?! 缓着、? 失误、?? 大败；已必败（被杀进程）不评判
export function classifyLoss(loss: number, before: number): string | null {
  if (before <= -9000) return null;
  if (loss <= 40) return null;
  if (loss <= 100) return '?!';
  if (loss <= 250) return '?';
  return '??';
}

export function marksFor(losses: number[], scores: number[]): (string | null)[] {
  return losses.map((l, k) => classifyLoss(l, scores[k]));
}

// 分方汇总（startSide 为第 0 手行棋方；偶数手 = startSide）
export function summarize(losses: number[], marks: (string | null)[], startSide: 'red' | 'black'): ReviewSummary {
  const acc: ReviewSummary = {
    red: { sum: 0, cnt: 0, q1: 0, q2: 0, q3: 0 },
    black: { sum: 0, cnt: 0, q1: 0, q2: 0, q3: 0 },
  };
  losses.forEach((loss, k) => {
    const side = k % 2 === 0 ? startSide : (startSide === 'red' ? 'black' : 'red');
    const a = acc[side];
    a.sum += Math.min(loss, 500);
    a.cnt++;
    if (marks[k] === '?!') a.q1++;
    else if (marks[k] === '?') a.q2++;
    else if (marks[k] === '??') a.q3++;
  });
  return acc;
}

export function acplOf(a: ReviewSideAcc): number {
  return a.cnt ? a.sum / a.cnt : 0;
}
