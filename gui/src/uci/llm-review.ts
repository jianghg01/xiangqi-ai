// LLM 复盘解说模块 —— 与引擎对战逻辑完全解耦
//
// 职责边界（硬约束）：
//  1. 本模块不导入、不引用 UciClient / engineMove / onBestmove 等引擎对战代码；
//  2. 不参与、不干预引擎落子思考过程；
//  3. 只在"走棋完成 / 对局结束后"，由 UI 层将点评数据喂入本模块进行文本组装；
//  4. 网络请求由主进程 IPC（llm:chat）完成，本模块只负责构建消息体。
//
// 模块输入（每次调用由 UI 层收集）：
//  - 完整对局 PGN
//  - 每一步 FEN 序列
//  - 每一步引擎评估分数、PV 主变、搜索深度
//  - 每一步标记（妙手/佳着/平稳/疑问手/败招/漏招，由评分差值判定）

export type ReviewStyle = 'brief' | 'deep';

// 每步评估记录
export interface StepEval {
  ply: number; // 第几步（从 1 起）
  side: 'red' | 'black'; // 行棋方
  moveZh: string; // 中文记谱
  fenAfter: string; // 走完后的局面 FEN
  scoreCp: number | null; // 引擎评估（行棋方视角，厘兵）
  pv: string; // 主变 ICCS（空格分隔，内部坐标系）
  depth: number; // 搜索深度
  loss: number; // 本手损失 = 走前分 - 走后分（行棋方视角，负值=得分提升）
  tag: StepTag; // 六类标记
}

export type StepTag = '妙手' | '佳着' | '平稳' | '疑问手' | '败招' | '漏招';

// 评分差值（loss，厘兵）→ 标记。与 AI 点评（review.ts）的 40/100/250 阈值对称扩展：
//   正向为损失（败招/漏招 >100/250、疑问手 40~100）；负向为得分提升（佳着/妙手）。
export function tagForLoss(loss: number): StepTag {
  if (loss > 250) return '漏招'; // 大败/漏杀
  if (loss > 100) return '败招'; // 失误、明显亏损
  if (loss > 40) return '疑问手'; // 缓手、稍差
  if (loss < -250) return '妙手'; // 极大提升（通常净赚大子/抓住对方漏招）
  if (loss < -40) return '佳着'; // 明显提升
  return '平稳';
}

// 两种解说风格对应的指令（追加在 user 消息末尾）
export function styleInstruction(style: ReviewStyle): string {
  return style === 'brief'
    ? '风格：简短点评。两三句话概括局势，点出本局最大问题与最佳一手即可，不要逐手展开。'
    : '风格：深度复盘。逐阶段（开局/中局/残局）分析，详细拆解关键变例、漏杀与改进招法，引用具体步数与推荐PV。';
}

// 内置系统提示词（随模块发送给大模型）
export const LLM_SYSTEM_PROMPT = `你是专业中国象棋复盘解说，面向象棋爱好者。
基于给到的对局棋谱、引擎评估、每步评分变化来解说。
要求：
1. 简明扼要，不要堆砌术语，同时专业准确。
2. 区分：全局局势总结 + 关键转折点 + 败招分析 + 改进推荐招法。
3. 指出漏杀、缓手、陷阱；解释思路，不只说结论。
4. 用户可以切换两种风格：【简洁版】简短几句话、【深度复盘版】详细拆解变例。
5. 输出不要编造不存在的招法；所有推荐招法参考提供的引擎PV。`;

export interface ReviewContextInput {
  pgn: string;
  startFen: string;
  redName: string;
  blackName: string;
  result: string;
  steps: StepEval[]; // 按步序
  fullFens: string[]; // 完整 FEN 序列（含起始局面，length = steps+1）
  style: ReviewStyle;
}

// 把对局数据组装为大模型的 user 消息体
export function buildUserPrompt(ctx: ReviewContextInput): string {
  const L: string[] = [];
  L.push(`红方：${ctx.redName}   黑方：${ctx.blackName}   结果：${ctx.result}`);
  L.push('');
  L.push('【完整对局 PGN】');
  L.push(ctx.pgn || '（无）');
  L.push('');
  L.push('【每一步引擎评估】（分数为行棋方视角厘兵；loss=本手损失，负值=得分提升）');
  if (!ctx.steps.length) {
    L.push('（无评估数据）');
  } else {
    L.push('步 | 行棋方 | 着法 | 评分 | 损失 | 标记 | 深度 | PV主变');
    for (const s of ctx.steps) {
      const cp = s.scoreCp === null ? '-' : s.scoreCp.toString().padStart(5);
      const pv = s.pv ? s.pv.split(' ').slice(0, 6).join(' ') : '-';
      L.push(
        `${s.ply} | ${s.side === 'red' ? '红' : '黑'} | ${s.moveZh} | ${cp} | ${s.loss >= 0 ? '+' + s.loss : s.loss} | ${s.tag} | ${s.depth} | ${pv}`,
      );
    }
  }
  // 完整 FEN 序列（深度复盘需要精确定位局面）
  L.push('');
  L.push('【FEN 序列】（steps: 每手走完后的局面；初始局面见 startFen）');
  L.push(`startFen: ${ctx.startFen}`);
  ctx.fullFens.forEach((f, i) => L.push(`${i === 0 ? 0 : i}. ${f}`));
  return L.join('\n');
}

// 组装发送给大模型的 messages
export function buildMessages(
  ctx: ReviewContextInput,
): { role: 'system' | 'user'; content: string }[] {
  return [
    { role: 'system', content: LLM_SYSTEM_PROMPT },
    {
      role: 'user',
      content: `${buildUserPrompt(ctx)}\n\n${styleInstruction(ctx.style)}\n现在请给出本局复盘解说。`,
    },
  ];
}
