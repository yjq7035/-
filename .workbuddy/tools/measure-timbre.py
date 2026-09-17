# -*- coding: utf-8 -*-
"""
measure-timbre.py —— 给 BGM 做"刺耳度"客观体检

为什么需要它
    "太刺耳"是个主观判断，主观判断没法迭代 —— 改一版听一次，全靠运气。
    所以把它拆成四个可测量的客观量，改完立刻知道是变好还是变坏。

四个量（都是越大越刺耳）
    ① 频谱重心 spectral centroid：整段的能量重心频率。放松类 ambient 通常在
       500~1500Hz；超过 2500Hz 就是"亮、尖、累耳朵"。
    ② 高频能量占比：>4kHz 的能量占总能量比例。镲片、铃音泛音、噪音嘶声都在这里，
       人耳对这个频段最敏感（也是"疼"的来源）。放松曲目应 < 2%。
    ③ 包络峰值因数 crest：20ms 短时 RMS 的峰值/均值。音头越硬、瞬态越强，这个越大。
       舒缓曲目应 < 3.0；打击乐/音乐盒式的硬音头能到 5+。
    ④ 峰值/RMS 比：单点尖峰（click、硬削波）会让它飙高。

用法
    python measure-timbre.py <mp3 路径> [报告输出路径]
"""

import json
import os
import subprocess
import sys

import numpy as np

SR = 32000


def decode(mp3_path, tmp_raw):
    ff = os.path.join(os.environ.get('LOCALAPPDATA', ''),
                      'Microsoft', 'WinGet', 'Links', 'ffmpeg.exe')
    if not os.path.exists(ff):
        ff = 'ffmpeg'
    subprocess.run([ff, '-y', '-loglevel', 'error', '-i', mp3_path,
                    '-ac', '1', '-ar', str(SR), '-f', 'f32le', tmp_raw], check=True)
    x = np.fromfile(tmp_raw, dtype='<f4').astype(np.float64)
    return x


def band_energy(x, lo, hi):
    X = np.fft.rfft(x * np.hanning(len(x)))
    p = (np.abs(X) ** 2)
    fr = np.fft.rfftfreq(len(x), 1.0 / SR)
    return float(np.sum(p[(fr >= lo) & (fr < hi)]))


def spectral_centroid(x):
    X = np.fft.rfft(x * np.hanning(len(x)))
    p = np.abs(X) ** 2
    fr = np.fft.rfftfreq(len(x), 1.0 / SR)
    s = np.sum(p)
    return float(np.sum(fr * p) / s) if s > 0 else 0.0


def a_weight_db(f):
    """
    A 计权（人耳等响曲线的标准近似），返回 dB。
    为什么必须有它：第一版 model 直接把幅度谱喂进粗糙度公式，结果把
    "低频厚但很柔"的 mix 判成比"高频亮但刺"的更差 —— 因为 87Hz 和 1kHz
    在同样幅度下，人耳感受的响度差了近 20dB。不做计权 = 用仪器的耳朵听音乐。
    """
    f = np.maximum(np.asarray(f, dtype=np.float64), 1e-6)
    f2 = f * f
    num = (12194.0 ** 2) * (f2 ** 2)
    den = (f2 + 20.6 ** 2) * np.sqrt((f2 + 107.7 ** 2) * (f2 + 737.9 ** 2)) * (f2 + 12194.0 ** 2)
    return 20.0 * np.log10(num / den) + 2.0


def roughness(x, win=2048, hop=1024, max_peaks=60):
    """
    感官粗糙度（Plomp-Levelt / Sethares  dissonance 曲线的工程近似）。

    为什么必须加这一项：v1 就是被这条曲线抓到问题的。
    它的四种"客观亮/响"指标全部合格（频谱重心 405Hz、4kHz 以上 0.025%），
    但听起来刺耳 —— 因为刺耳的本质不是"高频多"，而是**同时响的音之间离得太近**：
    两个纯音频率越接近（又不完全相同），包络拍频越落在人耳最不适的区间。
    公式里 s 是临界带宽尺度，Δf = 0 时两个指数项相等 → 贡献为 0；
    Δf 落在临界带附近时贡献最大。所以它专门惩罚小二度、大七度这类"贴着的音"。

    算法：逐帧取幅度谱的前 N 个局部极大值当作"分音"，两两按上面的曲线求和，
    再用该帧分音能量归一化（去掉响度影响）→ 得到与音量无关的粗糙度。

    ==================== 标定失败记录（别重复踩）====================
    实测：v1（人耳判定"刺耳"，旋律在和弦外乱撞）= 0.071；
          v2（重做后：和弦内音 + 降八度 + 纯谐波音色）= 0.082。
    **排序与听感相反。** 试过加 A 计权重（人耳等响曲线）也没能翻转，
    只把 v1 抬到 0.071、v2 压到 0.082 一点 —— 说明问题不在计权，在模型本身：
    它实际度量的是"低频区里互相贴近的分音有多少"（= 浑浊度），
    而"刺耳"的主因是**和声冲突**（旋律音与和弦音撞小二度）——
    那是**乐谱层面**的事，不是频谱幅度层面的事，用频谱指标永远测不出来。

    结论：和声冲突只能在**生成端**断言（见 make-snowfall.py 的
    PASS_all_melody_in_chord / _in_key），不要在音频端硬凑代理指标。
    本函数保留仅作对比诊断，见报告里 spectral_crowding_diag_NOT_a_criterion。
    ================================================================
    """
    n = len(x)
    if n < win:
        return 0.0
    frames = 1 + (n - win) // hop
    acc = 0.0
    cnt = 0
    for i in range(frames):
        seg = x[i * hop:i * hop + win] * np.hanning(win)
        mag = np.abs(np.fft.rfft(seg))
        fr = np.fft.rfftfreq(win, 1.0 / SR)
        idx = np.where((mag[1:-1] > mag[:-2]) & (mag[1:-1] > mag[2:]))[0] + 1
        if len(idx) < 2:
            continue
        # 按 A 计权后的响度选峰并加权 —— 不这么做，耳机里柔和的低频会被判成"糙"
        aw = 10 ** (a_weight_db(fr[idx]) / 20.0)
        idx = idx[np.argsort((mag[idx] * aw))[::-1][:max_peaks]]
        f = fr[idx]
        a = mag[idx] * (10 ** (a_weight_db(fr[idx]) / 20.0))
        keep = (f > 60) & (f < 8000)
        f = f[keep]
        a = a[keep]
        if len(f) < 2:
            continue
        denom = float(np.sum(a ** 2)) + 1e-12
        fmin = np.minimum.outer(f, f)
        df = np.abs(np.subtract.outer(f, f))
        s = 0.24 / (0.0207 * fmin + 18.96)
        d = np.exp(-3.5 * s * df) - np.exp(-5.75 * s * df)
        acc += float(np.sum(np.outer(a, a) * d)) / denom
        cnt += 1
    return float(acc / cnt) if cnt else 0.0


def envelope_crest(x, win_ms=20.0):
    w = max(1, int(SR * win_ms / 1000.0))
    n = len(x) // w
    if n < 2:
        return 0.0
    e = np.sqrt(np.mean(x[:n * w].reshape(n, w) ** 2, axis=1))
    m = np.mean(e) + 1e-12
    return float(np.max(e) / m)


def main():
    mp3_path = sys.argv[1] if len(sys.argv) > 1 else r'F:\图形塔防\audio\snowfall.mp3'
    out_path = sys.argv[2] if len(sys.argv) > 2 else r'F:\图形塔防\.workbuddy\tmp\_timbre.json'
    tmp = os.path.join(os.path.dirname(os.path.abspath(out_path)), '_timbre_tmp.raw')

    x = decode(mp3_path, tmp)
    os.remove(tmp)

    total = band_energy(x, 20, SR / 2)
    rms = float(np.sqrt(np.mean(x ** 2)) + 1e-12)
    peak = float(np.max(np.abs(x)) + 1e-12)

    rep = {
        'file': os.path.basename(mp3_path),
        'bytes': os.path.getsize(mp3_path),
        'duration_sec': round(len(x) / float(SR), 3),
        'rms_dbfs': round(20 * float(np.log10(rms)), 2),
        'peak_dbfs': round(20 * float(np.log10(peak)), 2),
        'spectral_centroid_hz': round(spectral_centroid(x)),
        'hf_ratio_gt4k_pct': round(100.0 * band_energy(x, 4000, SR / 2) / total, 3),
        'hf_ratio_gt8k_pct': round(100.0 * band_energy(x, 8000, SR / 2) / total, 3),
        'pain_band_2k5k_pct': round(100.0 * band_energy(x, 2000, 5000) / total, 3),
        'envelope_crest_20ms': round(envelope_crest(x), 3),
        'peak_over_rms_db': round(20 * float(np.log10(peak / rms)), 2),
        # ⚠️ 诊断项，**不可作为判据**。见 roughness() 上方的"标定失败"说明：
        #    这个模型惩罚的是"低频厚"，不是"刺耳"。实测 v1（人耳判定刺耳）
        #    0.071、v2（重做后）0.082 —— 排序与听感相反，所以不参与 PASS。
        #    保留它只是为了对比曲线、以及给后人一个"别再信它"的路标。
        'spectral_crowding_diag_NOT_a_criterion': round(roughness(x), 5),
    }
    # 判据：舒缓、不刺耳
    rep['PASS_centroid'] = rep['spectral_centroid_hz'] <= 1500
    rep['PASS_hf4k'] = rep['hf_ratio_gt4k_pct'] <= 2.0
    rep['PASS_crest'] = rep['envelope_crest_20ms'] <= 3.0
    rep['PASS_peak_rms'] = rep['peak_over_rms_db'] <= 14.0
    # ⚠️ 这里**刻意**不给粗糙度设阈值。标定失败（排序与听感相反），
    #    设了阈值等于用一个错尺子量东西，还会让报告出现"越改越差"的假信号。
    #    判据只用四项物理量清晰的指标：亮度(重心) / 高频占比 / 瞬态硬度 / 尖峰。
    #    "刺耳"这一类听感，最终判据只能是**人的耳朵** —— 交付里附带 A/B 试听页。
    rep['PASS'] = bool(rep['PASS_centroid'] and rep['PASS_hf4k']
                       and rep['PASS_crest'] and rep['PASS_peak_rms'])

    with open(out_path, 'w', encoding='utf-8') as f:
        json.dump(rep, f, ensure_ascii=False, indent=2)


if __name__ == '__main__':
    main()
