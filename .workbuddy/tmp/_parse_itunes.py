# -*- coding: utf-8 -*-
"""解析 iTunes 搜索结果，把候选曲目 + 官方预览 URL 落成纯文本。"""
import json
import os

HERE = os.path.dirname(os.path.abspath(__file__))
src = os.path.join(HERE, '_itunes.json')
with open(src, 'r', encoding='utf-8') as f:
    data = json.load(f)

lines = []
for i, r in enumerate(data.get('results', [])):
    lines.append('#%d' % i)
    lines.append('  trackName  : %s' % r.get('trackName'))
    lines.append('  artistName : %s' % r.get('artistName'))
    lines.append('  collection : %s' % r.get('collectionName'))
    lines.append('  duration   : %s ms' % r.get('trackTimeMillis'))
    lines.append('  release    : %s' % r.get('releaseDate'))
    lines.append('  previewUrl : %s' % r.get('previewUrl'))
    lines.append('')

with open(os.path.join(HERE, '_itunes.txt'), 'w', encoding='utf-8') as f:
    f.write('\n'.join(lines))
print('ok')
