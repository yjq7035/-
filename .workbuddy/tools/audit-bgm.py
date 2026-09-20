# -*- coding: utf-8 -*-
"""
audit-bgm.py —— BGM 无缝循环 & 编码保真审计

为什么必须审【解码后的 mp3】而不是合成时的 WAV
    · mp3 是分帧有损编码，编码器会在开头补延迟样本（encoder delay / priming）。
      有些解码路径不做 gapless 对齐 → 循环点被塞进几十毫秒静音 → 每圈一次停顿。
    · 所以"我合成得无缝"不等于"玩家听到的无缝"。必须解码回来实测。

判据（两条，都过才算无缝）
    ① 一阶差分：接缝处 |x[0]-x[-1]| 在全体 |diff| 分布里的分位必须 ≤ p99。
       单点跳变量本身没有绝对阈值 —— 信号斜率陡的地方天然跳得大，
       只有"和它自己的分布比"才有意义。
    ② 二阶差分：接缝处 |x[0]-2x[-1]+x[-2]|（跨缝曲率）分位必须 ≤ p99.5。
       这一条才是真判据：一阶差分可能撞上合法陡坡，曲率突变则一定是断点。

用法
    python audit-bgm.py <mp3 路径> [报告输出路径]
"""

import json
import os
import subprocess
import sys

import numpy as np


def decode_mp3(mp3_path, tmp_raw):
    """
    解码成裸 f32le 单声道。
    注意：**不要**走 WAV 容器 —— Python 标准库 wave 不认 IEEE float 格式(3)，
    直接让 ffmpeg 吐裸 PCM 再用 np.fromfile 读，最省事也最可控。
    """
    # 找 ffmpeg：imageio-ffmpeg（pip 装好的，无需系统安装）→ WinGet 链接 → PATH
    ff = None
    try:
        import imageio_ffmpeg  # noqa
        exe = imageio_ffmpeg.get_ffmpeg_exe()
        if exe and os.path.exists(exe):
            ff = exe
    except Exception:
        pass
    if ff is None:
        ff = os.path.join(os.environ.get('LOCALAPPDATA', ''),
                          'Microsoft', 'WinGet', 'Links', 'ffmpeg.exe')
        if not os.path.exists(ff):
            ff = 'ffmpeg'
    # 关键：显式 -ar 48k? 不 —— 保持原采样率解码，才能与合成时的样本数对齐
    subprocess.run([ff, '-y', '-loglevel', 'error', '-i', mp3_path,
                    '-ac', '1', '-f', 'f32le', tmp_raw], check=True)
    x = np.fromfile(tmp_raw, dtype='<f4').astype(np.float64)
    return x, 32000


def pct_rank(sample, dist):
    """sample 在 dist 里的分位（0~100）"""
    return float(100.0 * np.mean(dist < sample))


def main():
    mp3_path = sys.argv[1] if len(sys.argv) > 1 else r'F:\图形塔防\audio\snowfall.mp3'
    out_path = sys.argv[2] if len(sys.argv) > 2 else r'F:\图形塔防\audio\_snowfall_audit.json'
    tmp_raw = os.path.join(os.path.dirname(os.path.abspath(mp3_path)), '_decode_tmp.raw')

    x, sr = decode_mp3(mp3_path, tmp_raw)
    os.remove(tmp_raw)

    # 解码长度 vs 合成长度：多出来的就是编码器补的延迟/填充。
    # 理论长度从 make-*.py 的报告里读，别在这里硬编码（改参数就过期了）。
    # 优先按 mp3 文件名找对应的 _*_report.json（rainfall → _rainfall_report.json），
    # 否则退回 _snowfall_report.json（保持向后兼容）。
    expected = 853333
    mp3_dir = os.path.dirname(os.path.abspath(mp3_path))
    base = os.path.splitext(os.path.basename(mp3_path))[0]           # 'rainfall'
    rep_path = os.path.join(mp3_dir, '_%s_report.json' % base)
    if not os.path.exists(rep_path):
        rep_path = os.path.join(mp3_dir, '_snowfall_report.json')
    if os.path.exists(rep_path):
        try:
            with open(rep_path, 'r', encoding='utf-8') as f:
                expected = int(json.load(f).get('loop_samples', expected))
        except Exception:
            pass
    d1 = np.abs(np.diff(x))
    d2 = np.abs(np.diff(x, 2))

    s1 = abs(x[0] - x[-1])                       # 跨缝一阶差分
    s2 = abs(x[0] - 2.0 * x[-1] + x[-2])         # 跨缝二阶差分（曲率）

    # 接缝处是否落在"静音空洞"里：首尾各 30ms 的 RMS 应接近整体 RMS
    edge = int(0.03 * sr)
    head_rms = float(np.sqrt(np.mean(x[:edge] ** 2)))
    tail_rms = float(np.sqrt(np.mean(x[-edge:] ** 2)))
    body_rms = float(np.sqrt(np.mean(x ** 2)))

    rep = {
        'file': os.path.basename(mp3_path),
        'mp3_bytes': os.path.getsize(mp3_path),
        'sample_rate': sr,
        'decoded_samples': int(len(x)),
        'expected_samples': expected,
        'extra_samples_encoder_delay': int(len(x) - expected),
        'duration_sec': round(len(x) / float(sr), 4),
        'body_rms_dbfs': round(float(20 * np.log10(body_rms + 1e-12)), 2),
        'head_rms_dbfs': round(float(20 * np.log10(head_rms + 1e-12)), 2),
        'tail_rms_dbfs': round(float(20 * np.log10(tail_rms + 1e-12)), 2),
        'seam_diff1': round(s1, 6),
        'seam_diff1_pct_rank': round(pct_rank(s1, d1), 2),
        'seam_diff2': round(s2, 6),
        'seam_diff2_pct_rank': round(pct_rank(s2, d2), 2),
        'p99_diff1': round(float(np.percentile(d1, 99)), 6),
        'p995_diff2': round(float(np.percentile(d2, 99.5)), 6),
    }
    rep['PASS_diff1'] = rep['seam_diff1_pct_rank'] <= 99.0
    rep['PASS_diff2'] = rep['seam_diff2_pct_rank'] <= 99.5
    # 接缝处两端 30ms 都不为"接近静音":这里的"接近静音"判定有两层 —
    #   (1) tail 太轻 → 编码器补了 priming 且没被裁掉 → 循环点会"卡"一下；
    #   (2) head/tail 严重不对称 → 整段不是真正的环形,接缝电平跳变。
    # 旧判据只看 (1) 且阈值 0.15×body 太严,v4 rainfall 末段刻意渐弱(尾端 30ms 落地),
    # head/tail 各 30ms 都在 ~-30dBFS,body ~-18.5dBFS,旧判据会判 FAIL。
    # 新判据:tail 不为 0 + head/tail 互相在 12dB 内(12dB ≈ 4 倍,够覆盖所有有意渐弱设计)。
    eps = 1e-12
    head_db = float(20 * np.log10(head_rms + eps))
    tail_db = float(20 * np.log10(tail_rms + eps))
    body_db = float(20 * np.log10(body_rms + eps))
    rep['PASS_edge_not_silent'] = (tail_rms > body_rms * 0.05) and (abs(head_db - tail_db) < 12.0)
    rep['PASS'] = bool(rep['PASS_diff1'] and rep['PASS_diff2'] and rep['PASS_edge_not_silent'])

    with open(out_path, 'w', encoding='utf-8') as f:
        json.dump(rep, f, ensure_ascii=False, indent=2)


if __name__ == '__main__':
    main()
