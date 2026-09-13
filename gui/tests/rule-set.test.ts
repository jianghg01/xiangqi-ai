// 规则体系（国规2020 / 网络规则 / 休闲简化）判和逻辑的纯函数复刻验证
// 与 main.ts 中 afterMove/offerDraw 的规则分支保持一致；UI 全局状态无法直接 import，故按复刻风格测试
import { describe, expect, it } from 'vitest';

type RuleSet = 'guogui' | 'net' | 'casual';

// 复刻 main.ts naturalLimitTurns：网络规则固定 60 回合（天天自然限招 120 步），国规用下拉（40/50/60，缺省 50）
function naturalLimitTurns(ruleSet: RuleSet, selValue: string): number {
  return ruleSet === 'net' ? 60 : (parseInt(selValue, 10) || 50);
}

// 复刻 main.ts offerDraw：休闲简化点「提和」即协商判和
function isCasualDraw(ruleSet: RuleSet): boolean {
  return ruleSet === 'casual';
}

// 复刻 main.ts afterMove 通用判和（所有体系生效）：无进攻子力 / 三次重复
function universalDraw(materialNone: boolean, boardRepeats: number): string | null {
  if (materialNone) return '无进攻子力';
  if (boardRepeats >= 3) return '三次重复';
  return null;
}

// 复刻 main.ts afterMove 网络规则特有判和：重复5次 / 长将12着 / 400步，仅 net 启用
function netOnlyDraw(ruleSet: RuleSet, boardRepeats: number, checkStreak: number, ply: number): string | null {
  if (ruleSet === 'net') {
    if (boardRepeats >= 5) return '重复5次';
    if (checkStreak >= 12) return '长将6回合';
    if (ply >= 400) return '400步';
  }
  return null;
}

describe('规则体系 · 自然限着回合数（复刻 main.ts naturalLimitTurns）', () => {
  it('网络规则固定 60 回合，忽略下拉值', () => {
    expect(naturalLimitTurns('net', '40')).toBe(60);
    expect(naturalLimitTurns('net', '50')).toBe(60);
    expect(naturalLimitTurns('net', '')).toBe(60);
  });
  it('国规取下拉值（40/50/60），空值缺省 50', () => {
    expect(naturalLimitTurns('guogui', '40')).toBe(40);
    expect(naturalLimitTurns('guogui', '50')).toBe(50);
    expect(naturalLimitTurns('guogui', '60')).toBe(60);
    expect(naturalLimitTurns('guogui', '')).toBe(50);
  });
});

describe('规则体系 · 提和（复刻 main.ts offerDraw）', () => {
  it('休闲简化模式：点提和即协商判和', () => {
    expect(isCasualDraw('casual')).toBe(true);
    expect(isCasualDraw('guogui')).toBe(false);
    expect(isCasualDraw('net')).toBe(false);
  });
});

describe('规则体系 · 判和分支（复刻 main.ts afterMove）', () => {
  it('通用判和对三种体系全部生效', () => {
    expect(universalDraw(true, 0)).toBe('无进攻子力');
    expect(universalDraw(false, 3)).toBe('三次重复');
    expect(universalDraw(false, 5)).toBe('三次重复'); // 重复5也先命中三次重复
  });
  it('网络规则特有判和仅在 net 体系启用', () => {
    expect(netOnlyDraw('net', 5, 0, 0)).toBe('重复5次');
    expect(netOnlyDraw('net', 0, 12, 0)).toBe('长将6回合');
    expect(netOnlyDraw('net', 0, 0, 400)).toBe('400步');
    for (const rs of ['guogui', 'casual'] as const) {
      expect(netOnlyDraw(rs, 5, 0, 0)).toBeNull();
      expect(netOnlyDraw(rs, 0, 12, 0)).toBeNull();
      expect(netOnlyDraw(rs, 0, 0, 400)).toBeNull();
    }
  });
  it('网络规则特殊判定边界：重复4次/长将11着/399步不判和', () => {
    expect(netOnlyDraw('net', 4, 0, 0)).toBeNull();
    expect(netOnlyDraw('net', 0, 11, 0)).toBeNull();
    expect(netOnlyDraw('net', 0, 0, 399)).toBeNull();
  });
});