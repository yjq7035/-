# -*- coding: utf-8 -*-
"""
compare-bgm.py —— 「我这版为什么拉音 / 人家那版为什么好听」的客观对照工具

用法：
    python compare-bgm.py <参照音频> <自制音频> [更多音频...]

输出（脚本同级目录）：_bgm_compare.txt / _bgm_compare.json

指标分五组：
  A 基本       时长 / 采样率 / 声道
  B 响度动态   RMS / 峰值 / 峰值因数 / ⭐包络起伏（发音度的直接量化）
  C 频谱分布   频谱重心 / 各频带能量占比（亮度、浑浊度）
  D 起音       起音密度(音/秒) / 起音锐度 / 音间残余电平（"糊不糊"）
  E 旋律形态   音域 / 音程分布（级进占比）/ 音高稳定性

⭐为什么"包络起伏"是判定「拉音」的头号指标：
  「拉音」= 上一个音还没落下去、下一个音就叠上来，听感上音与音糊成一条线。
  逐帧 RMS 转 dB 之后，音音分明的演奏在 dB 域里是大起大落（几十 dB 跨度）；
  糊成一片的，包络几乎是平的。这个数比"频谱重心"之类离听感近得多。

⚠️ 已知局限（别把结论建立在它上面）：
  - 混响很重的曲子，包络起伏会被混响尾巴抬高 → 必须两个曲子用同一套代码测、横向比。
  - 音高提取只取 180~1400Hz 里最强的峰，和弦/垫音会干扰；只用于看"级进还是大跳"的分布形状。
"""

import json
import os
import subprocess
import sys

import numpy as np

SR = 44100
NFFT = 4096
HOP = 1024
EPS = 1e-12

HERE = os.path.dirname(os.path.abspath(__file__))


# ============================================================================
# 读音频
# ============================================================================
def find_ffmpeg():
    for exe in ('ffmpeg', 'ffmpeg.exe'):
        try:
            subprocess.run([exe, '-version'], stdout=subprocess.DEVNULL,
                           stderr=subprocess.DEVNULL, check=True)
            return exe
        except Exception:
            pass
    cand = os.path.join(os.environ.get('LOCALAPPDATA', ''),
                        'Microsoft', 'WinGet', 'Links', 'ffmpeg.exe')
    return cand if os.path.exists(cand) else None


FFMPEG = find_ffmpeg()


def decode_mono(path, sr=SR):
    """解码成单声道 float32。⚠️ 一律走裸 f32le，别走 WAV 容器（Python wave 不认 float 格式）。"""
    cmd = [FFMPEG, '-v', 'error', '-i', path, '-ac', '1', '-ar', str(sr),
           '-f', 'f32le', '-']
    p = subprocess.run(cmd, capture_output=True)
    if p.returncode != 0:
        raise RuntimeError('ffmpeg 解码失败: %s' % p.stderr.decode('utf-8', 'ignore')[:300])
    return np.frombuffer(p.stdout, dtype='<f4').astype(np.float64)


def decode_stereo(path, sr=SR):
    """解码成双声道 float32（算 L/R 相关性用）。"""
    cmd = [FFMPEG, '-v', 'error', '-i', path, '-ac', '2', '-ar', str(sr),
           '-f', 'f32le', '-']
    p = subprocess.run(cmd, capture_output=True)
    if p.returncode != 0:
        return None
    x = np.frombuffer(p.stdout, dtype='<f4').astype(np.float64)
    if len(x) % 2:
        x = x[:-1]
    return x.reshape(-1, 2)


# ============================================================================
# 基础 DSP
# ============================================================================
def stft_mag(x, nfft=NFFT, hop=HOP):
    if len(x) < nfft:
        x = np.pad(x, (0, nfft - len(x)))
    win = np.hanning(nfft)
    nf = 1 + (len(x) - nfft) // hop
    idx = np.arange(nfft)[None, :] + hop * np.arange(nf)[:, None]
    return np.abs(np.fft.rfft(x[idx] * win, axis=1))


def frame_rms_db(x, hop=441, win=882):
    """逐帧 RMS 转 dBFS（10ms 步长 / 20ms 窗）。"""
    if len(x) < win:
        x = np.pad(x, (0, win - len(x)))
    nf = 1 + (len(x) - win) // hop
    idx = np.arange(win)[None, :] + hop * np.arange(nf)[:, None]
    seg = x[idx]
    r = np.sqrt(np.mean(seg ** 2, axis=1) + EPS)
    return 20.0 * np.log10(r + EPS), hop / float(SR)


def envelope_stats(env_db):
    """⭐发音度的核心：包络在 dB 域的起伏幅度。"""
    lo = float(np.percentile(env_db, 5))
    hi = float(np.percentile(env_db, 95))
    return {
        'env_std_db': round(float(np.std(env_db)), 2),
        'env_p5_p95_db': round(hi - lo, 2),
        'env_median_db': round(float(np.median(env_db)), 2),
    }


def spectral_stats(x, sr=SR):
    mag = stft_mag(x)
    freqs = np.fft.rfftfreq(NFFT, 1.0 / sr)
    p = mag ** 2
    tot = float(np.sum(p) + EPS)
    centroid = float(np.sum(freqs * p.sum(axis=0)) / tot)
    bands = [(0, 150), (150, 500), (500, 2000), (2000, 5000), (5000, 16000)]
    frac = {}
    for a, b in bands:
        m = (freqs >= a) & (freqs < b)
        frac['%d-%d' % (a, b)] = round(100.0 * float(np.sum(p[:, m])) / tot, 3)
    return {'spectral_centroid_hz': round(centroid, 1), 'band_pct': frac}


def stereo_corr(path):
    st = decode_stereo(path)
    if st is None or len(st) < 1000:
        return None
    l, r = st[:, 0], st[:, 1]
    if np.std(l) < EPS or np.std(r) < EPS:
        return None
    return round(float(np.corrcoef(l, r)[0, 1]), 3)


# ============================================================================
# 起音检测
# ============================================================================
def spectral_flux(x, sr=SR):
    mag = stft_mag(x)
    mag_db = 20.0 * np.log10(mag + 1e-8)
    mag_db -= np.max(mag_db, axis=1, keepdims=True)     # 每帧归一化，防响度主导
    d = np.diff(mag_db, axis=0)
    flux = np.sum(np.maximum(0.0, d), axis=1)
    t = (np.arange(len(flux)) + 1) * HOP / float(sr)
    return flux, t


def pick_onsets(flux, t, k=1.5, min_dist=0.11, win=0.3):
    n = len(flux)
    w = max(3, int(win * (t[1] - t[0]) and win / (t[1] - t[0])))
    thr = np.zeros(n)
    half = max(1, w // 2)
    for i in range(n):
        a = max(0, i - half)
        b = min(n, i + half + 1)
        seg = flux[a:b]
        thr[i] = np.mean(seg) + k * np.std(seg)
    md = max(1, int(min_dist / (t[1] - t[0])))
    ons = []
    for i in range(1, n - 1):
        if flux[i] <= thr[i]:
            continue
        a = max(0, i - md)
        b = min(n, i + md + 1)
        if flux[i] >= np.max(flux[a:b]) - 1e-12:
            if not ons or (i - ons[-1]) >= md:
                ons.append(i)
    return np.array([t[i] for i in ons])


def onset_stats(x, sr=SR):
    flux, t = spectral_flux(x, sr)
    ons = pick_onsets(flux, t)
    dur = len(x) / float(sr)
    out = {
        'onsets': int(len(ons)),
        'onset_rate_per_sec': round(len(ons) / dur, 2),
        'flux_mean': round(float(np.mean(flux)), 4),
        'flux_p95': round(float(np.percentile(flux, 95)), 4),
        'onset_sharpness': round(float(np.percentile(flux, 95) / (np.mean(flux) + EPS)), 2),
    }
    if len(ons) > 2:
        ioi = np.diff(ons) * 1000.0
        out['ioi_median_ms'] = round(float(np.median(ioi)), 1)
        out['ioi_std_ms'] = round(float(np.std(ioi)), 1)
        out['ioi_cv'] = round(float(np.std(ioi) / (np.median(ioi) + EPS)), 3)
    return out, ons


def articulation(x, ons, sr=SR):
    """
    ⭐「拉音」的直接量化：每个音起头之后的"下落幅度"，以及下一音来之前的残余电平。
      drop_db        = 本音峰值 - 本音与下一音之间最小值（越大 = 音与音分得越开）
      residual_db    = 下一音**前一瞬**的电平 - 本音峰值（越接近 0 = 越糊）
      rise_db        = 本音峰值 - 前 60ms 的中位电平（越大 = 音头越立得起来）
    """
    env_db, hop_t = frame_rms_db(x)
    if len(ons) < 3:
        return {}
    drops, resids, rises = [], [], []
    for i in range(len(ons) - 1):
        a = int(ons[i] / hop_t)
        b = int(ons[i + 1] / hop_t)
        if b - a < 3:
            continue
        seg = env_db[a:b]
        peak = float(np.max(seg))
        floor = float(np.min(seg))
        drops.append(peak - floor)
        pre = int(max(0, b - 0.06 / hop_t))
        resids.append(float(np.median(env_db[pre:b])) - peak)
        lo = int(max(0, a - 0.06 / hop_t))
        if a - lo >= 2:
            rises.append(peak - float(np.median(env_db[lo:a])))
    if not drops:
        return {}
    return {
        'note_drop_db_median': round(float(np.median(drops)), 2),
        'note_residual_db_median': round(float(np.median(resids)), 2),
        'note_rise_db_median': round(float(np.median(rises)) if rises else 0.0, 2),
    }


# ============================================================================
# 旋律形态（音高轨迹 → 音程分布）
# ============================================================================
def pitch_track(x, sr=SR, fmin=180.0, fmax=1400.0, gate_pct=40):
    mag = stft_mag(x, nfft=NFFT, hop=2048)
    freqs = np.fft.rfftfreq(NFFT, 1.0 / sr)
    lo = int(np.searchsorted(freqs, fmin))
    hi = int(np.searchsorted(freqs, fmax))
    band = mag[:, lo:hi]
    fr = freqs[lo:hi]
    if band.shape[1] < 3:
        return []
    e = band.sum(axis=1)
    thr = np.percentile(e, gate_pct)
    out = []
    for i in range(band.shape[0]):
        if e[i] < thr:
            out.append(None)
            continue
        k = int(np.argmax(band[i]))
        if k == 0 or k == band.shape[1] - 1:
            out.append(None)
            continue
        a = np.log(band[i, k - 1] + EPS)
        b = np.log(band[i, k] + EPS)
        c = np.log(band[i, k + 1] + EPS)
        den = a - 2 * b + c
        d = 0.0 if abs(den) < 1e-12 else 0.5 * (a - c) / den
        d = max(-0.5, min(0.5, d))
        f = fr[k] + d * (fr[1] - fr[0])
        out.append(f)
    hop_t = 2048 / float(sr)
    return [(i * hop_t, f) for i, f in enumerate(out) if f]


def melody_shape(x, sr=SR):
    tr = pitch_track(x, sr)
    if len(tr) < 8:
        return {}
    mids = []
    for _, f in tr:
        m = 69.0 + 12.0 * np.log2(f / 440.0)
        mids.append(int(round(m)))
    # 中值滤波压抖动，再游程编码成"音"
    k = 3
    sm = []
    for i in range(len(mids)):
        a = max(0, i - k)
        b = min(len(mids), i + k + 1)
        sm.append(int(np.median(mids[a:b])))
    seq = []
    for m in sm:
        if not seq or seq[-1] != m:
            seq.append(m)
    intervals = [seq[i + 1] - seq[i] for i in range(len(seq) - 1)]
    intervals = [i for i in intervals if i != 0]
    absi = [abs(i) for i in intervals]
    hist = {}
    for i in intervals:
        hist[str(i)] = hist.get(str(i), 0) + 1
    out = {
        'pitch_voiced_frames': len(tr),
        'melody_notes_tracked': len(seq),
        'pitch_lowest': _mname(min(seq)) if seq else '',
        'pitch_highest': _mname(max(seq)) if seq else '',
        'pitch_range_semitones': (max(seq) - min(seq)) if seq else 0,
    }
    if absi:
        out['interval_stepwise_pct'] = round(100.0 * sum(1 for i in absi if i <= 2) / len(absi), 1)
        out['interval_leap_pct'] = round(100.0 * sum(1 for i in absi if i >= 5) / len(absi), 1)
        out['interval_median_semitones'] = round(float(np.median(absi)), 1)
        out['interval_hist'] = dict(sorted(hist.items(), key=lambda kv: -kv[1])[:8])
    return out


_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']


def _mname(m):
    return _NAMES[int(m) % 12] + str(int(m) // 12 - 1)


# ============================================================================
# 单文件总分析
# ============================================================================
def analyze(path):
    x = decode_mono(path)
    dur = len(x) / float(SR)
    rms = float(np.sqrt(np.mean(x ** 2) + EPS))
    peak = float(np.max(np.abs(x)) + EPS)
    env_db, _ = frame_rms_db(x)
    rep = {
        'file': os.path.basename(path),
        'duration_sec': round(dur, 2),
        'rms_dbfs': round(20 * np.log10(rms + EPS), 2),
        'peak_dbfs': round(20 * np.log10(peak + EPS), 2),
        'crest_db': round(20 * np.log10(peak / (rms + EPS)), 2),
    }
    rep.update(envelope_stats(env_db))
    rep.update(spectral_stats(x))
    osc, ons = onset_stats(x)
    rep.update(osc)
    rep.update(articulation(x, ons))
    rep.update(melody_shape(x))
    c = stereo_corr(path)
    rep['lr_correlation'] = c if c is not None else 'n/a(mono)'
    return rep


# ============================================================================
# 主流程
# ============================================================================
def main():
    files = sys.argv[1:]
    if len(files) < 1:
        print('用法: python compare-bgm.py <音频1> [音频2] ...')
        return 2
    reps = []
    for f in files:
        try:
            reps.append(analyze(f))
        except Exception as e:
            reps.append({'file': os.path.basename(f), 'error': str(e)})

    txt = []
    txt.append('===== 客观对照 =====')
    for r in reps:
        txt.append('')
        txt.append('--- %s ---' % r.get('file'))
        if 'error' in r:
            txt.append('   !! %s' % r['error'])
            continue
        for k, v in r.items():
            if k == 'file':
                continue
            txt.append('  %-28s : %s' % (k, v))

    with open(os.path.join(HERE, '_bgm_compare.txt'), 'w', encoding='utf-8') as f:
        f.write('\n'.join(txt) + '\n')
    with open(os.path.join(HERE, '_bgm_compare.json'), 'w', encoding='utf-8') as f:
        json.dump(reps, f, ensure_ascii=False, indent=2)
    print('ok')
    return 0


if __name__ == '__main__':
    sys.exit(main())
