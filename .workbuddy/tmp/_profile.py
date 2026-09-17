# -*- coding: utf-8 -*-
"""诊断：把两条音轨的逐秒 RMS 画成一条"响度轮廓"，看它们的动态形状差在哪。"""
import os
import subprocess
import sys

import numpy as np

SR = 44100
HERE = os.path.dirname(os.path.abspath(__file__))
FF = os.path.join(os.environ.get('LOCALAPPDATA', ''),
                  'Microsoft', 'WinGet', 'Links', 'ffmpeg.exe')


def load(p):
    r = subprocess.run([FF, '-v', 'error', '-i', p, '-ac', '1', '-ar', str(SR),
                        '-f', 'f32le', '-'], capture_output=True)
    return np.frombuffer(r.stdout, dtype='<f4').astype(np.float64)


out = []
for p in sys.argv[1:]:
    x = load(p)
    hop = SR // 2                      # 0.5s
    nf = len(x) // hop
    seg = x[:nf * hop].reshape(nf, hop)
    rms = np.sqrt(np.mean(seg ** 2, axis=1) + 1e-12)
    db = 20 * np.log10(rms + 1e-12)
    # 归一到各自的峰值，看"形状"而不是绝对电平
    rel = db - np.max(db)
    out.append('--- %s (%d 个 0.5s 帧) ---' % (os.path.basename(p), nf))
    line = ''
    for i in range(0, nf, 4):          # 每 2 秒一个刻度
        v = rel[i]
        line += '%5.1f' % v
    out.append('每 2s 的相对电平(dB):')
    out.append(line)
    out.append('')
    out.append('分位数 p5 / p25 / p50 / p75 / p95 = %.1f / %.1f / %.1f / %.1f / %.1f'
               % tuple(np.percentile(rel, [5, 25, 50, 75, 95])))
    # ⚠️ 中文里带 % 就别用 %-格式化（'10%' 会被当成格式符），用 .format
    out.append('最安静的 10% 与最响的 10% 之间差 {:.1f} dB'.format(
        np.percentile(rel, 90) - np.percentile(rel, 10)))
    out.append('')

with open(os.path.join(HERE, '_profile.txt'), 'w', encoding='utf-8') as f:
    f.write('\n'.join(out) + '\n')
print('ok')
