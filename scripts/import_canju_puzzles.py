#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
从 liudada1980/canju12（一二残局，GPL-3.0）题库 txt 批量导入古谱/连将杀残局。
每行格式：<完整FEN> <题名>，如：
  1RN1k4/3P3rC/6n2/9/9/9/4p4/3p5/c1rAK4 w - - 0 1 炮居中庭

输出：与 xiangqi-ai 闯关题库兼容的 JSON（含 source 来源；solution 留空，提示时走引擎实时求解）。

用法：python scripts/import_canju_puzzles.py <输出json> [是否仅古谱/连将杀]
"""
import sys
import json
import base64
import re

import requests

API = 'https://api.github.com/repos/liudada1980/canju12/contents/一二残局专属题库'
DIR = '一二残局专属题库'

# 文件 -> (source 名, 默认 movesToMate)
FILES = [
    ('古谱-古谱胜局合集.txt', '古谱胜局合集', 6),
    ('古谱-梦入神机胜局.txt', '梦入神机', 6),
    ('古谱-烂柯神机及其他胜局.txt', '烂柯神机胜局', 6),
    ('古谱-适情雅趣精选.txt', '适情雅趣精选', 6),
    ('古谱-适情雅趣胜局.txt', '适情雅趣胜局', 6),
    ('连将杀一至四步杀.txt', '连将杀1-4步', 4),
    ('连将杀五至七步杀.txt', '连将杀5-7步', 7),
]

LINE_RE = re.compile(r'^(\S+ ([wb]) - - 0 1)\s*(.*)$')


def fetch_file(name):
    url = f'{API}/{name}'
    r = requests.get(url, headers={'User-Agent': 'agent-reach/1.0'}, timeout=30)
    r.raise_for_status()
    data = r.json()
    raw = base64.b64decode(data['content'])
    # 优先 UTF-8，回退 GBK（Windows 旧文本常见）
    for enc in ('utf-8', 'gbk'):
        try:
            return raw.decode(enc)
        except UnicodeDecodeError:
            continue
    return raw.decode('utf-8', errors='replace')


def parse_lines(text):
    puzzles = []
    for line in text.splitlines():
        line = line.strip()
        if not line:
            continue
        m = LINE_RE.match(line)
        if not m:
            # 可能是“2#FEN 走法”格式，跳过（只导入纯连将杀）
            if line.startswith('2#'):
                continue
            continue
        fen_part, turn, name = m.group(1), m.group(2), m.group(3).strip()
        puzzles.append((fen_part, turn, name))
    return puzzles


def main():
    out_json = sys.argv[1]
    result = []
    for fname, source, default_steps in FILES:
        try:
            text = fetch_file(fname)
        except Exception as e:  # noqa: BLE001
            print(f'下载失败 {fname}: {e}', file=sys.stderr)
            continue
        items = parse_lines(text)
        print(f'{fname}: 解析 {len(items)} 行')
        for fen_part, turn, name in items:
            side = 'red' if turn == 'w' else 'black'
            result.append({
                'id': '',
                'name': name,
                'fen': fen_part,
                'side': side,
                'movesToMate': default_steps,
                'solution': '',
                'source': source,
            })
    # 分配 id 并去重（按 FEN+source）
    seen = set()
    dedup = []
    for p in result:
        key = (p['source'], p['fen'], p['side'])
        if key in seen:
            continue
        seen.add(key)
        idx = len(dedup) + 1
        p['id'] = f"{p['source']}-{idx:03d}"
        dedup.append(p)
    with open(out_json, 'w', encoding='utf-8') as fp:
        json.dump(dedup, fp, ensure_ascii=False, indent=1)
    print(f'共导入 {len(dedup)} 关 -> {out_json}')


if __name__ == '__main__':
    main()