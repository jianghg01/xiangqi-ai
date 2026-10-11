#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
从古谱 XQF 棋谱提取「杀棋残局」，生成与 xiangqi-ai 闯关题库兼容的 JSON 数据。

用法：
  python scripts/extract_classic_puzzles.py <古谱目录> <source名> <输出json> [步数上限]

说明：
- XQF 由 cchess 库解析（pip install cchess）。
- cchess 的 ICCS 坐标为「引擎坐标」（rank0=红方底线），需转换为项目内部坐标（rank0=黑方底线）。
- 仅提取终局为将死（checkmate）且 result 为 1-0/0-1 的棋谱。
"""
import sys
import os
import json
import glob

from cchess import read_from_xqf


def to_local(iccs: str) -> str:
    """cchess 引擎坐标(rank0=红底) -> 项目内部坐标(rank0=黑底)"""
    if len(iccs) != 4 or not iccs[1].isdigit() or not iccs[3].isdigit():
        return iccs
    return iccs[0] + str(9 - int(iccs[1])) + iccs[2] + str(9 - int(iccs[3]))


def extract_dir(dir_path, source, max_steps=12):
    files = []
    for ext in ('*.XQF', '*.xqf'):
        files.extend(glob.glob(os.path.join(dir_path, '**', ext), recursive=True))
    files = sorted(set(files))
    out = []
    ok = 0
    for f in files:
        try:
            g = read_from_xqf(f)
            info = g.info or {}
            move_player = info.get('move_player', 'RED')
            title = info.get('title') or os.path.splitext(os.path.basename(f))[0]
            # 部分古谱 XQF 的 result 字段为空（'*'），不以此过滤；只要主变含将死步即可
            branches = g.dump_moves()
            if not branches:
                continue
            main = branches[0].get('moves', [])
            if not main:
                continue
            # 找到将死步（主变中最后一步将死）
            cm_idx = None
            for i, m in enumerate(main):
                if getattr(m, 'is_checkmate', False):
                    cm_idx = i
            if cm_idx is None:
                continue
            side = 'red' if move_player == 'RED' else 'black'
            # 攻方行棋次数（含杀棋那步）：棋谱由先行方开始交替走子，
            # 用索引奇偶计算，不依赖 Move.move_player 属性值
            if move_player == 'RED':
                moves_to_mate = (cm_idx // 2) + 1
            else:
                moves_to_mate = ((cm_idx + 1) // 2)
            if moves_to_mate < 1 or moves_to_mate > max_steps:
                continue
            # 初始 FEN（补全为标准格式）
            fen = g.init_board.to_fen()
            parts = fen.split(' ')
            if len(parts) >= 2:
                fen_full = parts[0] + ' ' + parts[1] + ' - - 0 1'
            else:
                fen_full = fen + ' w - - 0 1'
            # 攻方第一步（转换为内部坐标）
            first_move = main[0]
            sol_local = to_local(first_move.to_iccs())
            out.append({
                'id': f'{source}-{ok + 1:03d}',
                'name': title,
                'fen': fen_full,
                'side': side,
                'movesToMate': moves_to_mate,
                'solution': sol_local,
                'source': source,
            })
            ok += 1
        except Exception as e:  # noqa: BLE001
            print('跳过', os.path.basename(f), ':', e, file=sys.stderr)
    return out


def main():
    if len(sys.argv) < 4:
        print(__doc__)
        sys.exit(1)
    dir_path = sys.argv[1]
    source = sys.argv[2]
    out_json = sys.argv[3]
    max_steps = int(sys.argv[4]) if len(sys.argv) > 4 else 12
    puzzles = extract_dir(dir_path, source, max_steps)
    with open(out_json, 'w', encoding='utf-8') as fp:
        json.dump(puzzles, fp, ensure_ascii=False, indent=1)
    print(f'共提取 {len(puzzles)} 个杀棋残局 -> {out_json}')
    # 按步数统计
    from collections import Counter
    by_steps = Counter(p['movesToMate'] for p in puzzles)
    print('步数分布:', dict(sorted(by_steps.items())))


if __name__ == '__main__':
    main()