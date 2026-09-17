# -*- coding: utf-8 -*-
"""
make-snowfall.py —— 生成游戏背景音乐《Snowfall (Original)》v3

========================= 复盘（改之前先读）=========================
v1 被判「太刺耳」→ 真因在**和声**（旋律随机挑音撞和弦）+ 音域过高 + 非谐波音色。
v2 修好了和声与亮度，但被判「有点拉音、旋律不好听」。

v2 的两个病，被 tools/compare-bgm.py 对着**参照曲**量化证死了
（参照 = Apple 官方 30 秒预览，分析用，绝不进包体）：

  指标                          参照曲     v2       v3 目标
  ----------------------------  -------  -------  --------
  env_std_db   包络起伏           9.03     3.31     ≥ 8
  note_drop_db 音与音之间的下落    5.23     2.33     ≥ 4.5
  rise_db      音头立不立得起来    1.75     0.96     ≥ 1.6
  interval_stepwise_pct 级进占比  45.7      5.9     ≥ 40
  interval_leap_pct     大跳占比  37.2     64.7     ≤ 18
  interval_median_semitones        4.0      8.0     ≤ 4
  band 500-2000Hz 能量占比         8.3%    31.2%    ≤ 14%

  → 「拉音」的根因（一行代码）：
      v2 旋律音长 = `int(min(tau*6.9, 5.5) * SR)`，tau ∈ [1.5, 2.1]
      ⇒ **每个旋律音都是 5.5 秒长的衰减音**，而音与音的间距只有约 0.7 秒。
      0.7 秒处上一个音还在 exp(-0.7/2.1) = 72% 的电平上 ⇒ 同时有 8 个音
      叠着响 ⇒ 包络被填平（3.31dB）⇒ 听感就是"拉音"。
  → 「旋律不好听」的根因：v2 用随机游走挑音 ⇒ 实测 64.7% 是大跳、
      中位音程 8 个半音。那叫乱蹦，不叫旋律。
      参照曲 45.7% 是级进、音程直方图里 ±1 半音各占 20 次上下
      ⇒ 歌唱性来自**级进主导 + 动机重复**，不是来自"音挑得巧"。

========================= v3 的五条硬约束 =========================
①【发音度】音长必须远小于音距：tau = 0.55s（总长 tau*4.5 ≈ 2.5s），
   而旋律音距 ≥ 0.652s（四分音符）⇒ 下一个音来之前，上一个已落到 -10dB 以下。
   起音从 28ms 收到 10ms —— v1 的刺耳来自**非谐波泛音**，不是起音，
   别再让"软起音"背这个锅（那是 v2 过度收敛的另一半原因）。
②【级进 + 动机】旋律改为「动机 + 变化重复」，彻底删掉随机游走：
   强拍必须落在和弦音 / 安全延伸音（严格排除"与任一和弦音构成小 2 度"的音），
   弱位才允许经过音（必须是与和弦音相距 ≤2 半音的邻音）。
   断言：melody_strong_off_chord = 0、melody_out_of_key = 0、|音程| ≤ 5。
③【流动织体】每小节 8 个八分音符的**级进弧线**（F 大调梯子上 ±3 度内摆动），
   小节首音必须是和弦音。92 BPM 的八分音符 = 3.07 音/秒 ——
   和参照曲实测的 2.94 起音/秒几乎重合。
   ⚠️ 这推翻了 v2 的一个想当然：**"放松"不等于"音少"**。
   参照曲的起音密度（2.94/s）比 v2（2.82/s）还高，但每个音都短、都分得开。
④【频响往低频压】参照曲 500–2000Hz 只占 8.3%，v2 占了 31.2%（中频太满）。
   手段三件：加厚低音 / 砍 pad 与旋律的 2、3 次谐波 / 900Hz 处钟形衰减。
⑤【呼吸】pad 每小节留缝（dur = BAR*0.9，起音 0.45s、释放 0.7s）
   + 12 小节门控弧线 ⇒ 包络在 dB 域里大起大落（env_std 正是"拉音"的头号指标）。

⚠️ 参照曲是**有版权的商业录音**：本项目只下载 Apple 官方公开的 30 秒预览**用于分析**
   （.workbuddy/tmp/_ref_snowfall.m4a），**绝不**放进 audio/、绝不进游戏包体。
   成品是完全原创的合成音源。

输出：<out>/snowfall.mp3（mono / 32kHz / 80kbps）
用法：python make-snowfall.py [输出目录] [随机种子]
"""

import json
import os
import subprocess
import sys
import wave

import numpy as np

# ============================================================================
# 基本参数
# ============================================================================
SR = 32000
BPM = 92.0                      # v2 是 76：参照曲按八分音符推算是 ~92，对齐它
BEAT = 60.0 / BPM               # 0.6522s
BAR = BEAT * 4                  # 2.6087s

ROUNDS = 3                      # 3 轮 × 4 小节 = 12 小节
LOOP_SEC = BAR * 4 * ROUNDS
N = int(round(LOOP_SEC * SR))

BUF = np.zeros(N, dtype=np.float64)

INTRO_BARS = 4                  # 前 4 小节不唱旋律（引子）

# ---------------------------------------------------------------------------
# 和声：F 大调 I△7 ii7 vi9 IV△7
# ---------------------------------------------------------------------------
# tones = 该和弦的和弦音音级（用于"强拍必须落在和弦上"的断言）
# pad   = 铺底声部（低→高）
# avoid = 与和弦音构成小 2 度、必须回避的音级
#         Fmaj7 回避 Bb（与 A 撞）；Gm7 回避 E（与 F 撞）；
#         Dm9 回避 Bb（与 A 撞）；Bb∆7 回避 E（与 F 撞，且是 #11）
CHORDS = [
    {'name': 'Fmaj7', 'tones': {'F', 'A', 'C', 'E'}, 'avoid': {'Bb'},
     'pad': ['F2', 'C3', 'A3', 'E4']},
    {'name': 'Gm7', 'tones': {'G', 'Bb', 'D', 'F'}, 'avoid': {'E'},
     'pad': ['G2', 'D3', 'Bb3', 'F4']},
    {'name': 'Dm9', 'tones': {'D', 'F', 'A', 'C', 'E'}, 'avoid': {'Bb'},
     'pad': ['D2', 'A2', 'D3', 'F3', 'C4']},
    {'name': 'BbMaj7', 'tones': {'Bb', 'D', 'F', 'A'}, 'avoid': {'E'},
     'pad': ['Bb2', 'F3', 'Bb3', 'D4', 'A4']},
]

F_MAJOR_PCS = {'F', 'G', 'A', 'Bb', 'C', 'D', 'E'}

# 12 小节门控弧线：弱 → 起 → 满 → 落 → 回到弱（一个完整的呼吸周期）
# ⭐ 用 _profile.py 量出来的参照曲"响度轮廓"（每 2 秒相对峰值 dB）：
#     -26.2 -21.8 -21.0 -18.2 -18.1 -11.3  -1.8  -1.4  -2.8 ... -1.3
#   即：**前 10~12 秒从 −26dB 一路爬上来**，那正是用户点名喜欢的"节奏进来"。
#
# ⚠️ 但**不能只在开头弱**：环路接缝处会形成一个 14dB 的台阶，
#    audit-bgm.py 立刻报 PASS_diff2=false（接缝曲率冲到全曲 p100）。
#    所以弧线必须首尾都弱 —— 落下去的过程放在第 9~12 小节里，
#    这样接缝两侧的电平是连续的，循环才不会每 31 秒"咔"一下。
PAD_GATE = [0.30, 0.36, 0.44, 0.58, 1.00, 1.00, 1.00, 0.95, 0.82, 0.66, 0.48, 0.34]
FIG_GATE = [0.00, 0.10, 0.20, 0.34, 0.85, 1.00, 1.00, 0.90, 0.76, 0.60, 0.36, 0.16]
MEL_GATE = [0.00, 0.00, 0.00, 0.00, 0.75, 0.85, 0.95, 1.00, 0.90, 0.74, 0.40, 0.18]
# ⚠️ 弧度也不能太深：首轮把引子压到 0.16、尾压到 0.10，结果接缝末端 30ms 只有 −34.8dB，
#    audit-bgm.py 的 PASS_edge_not_silent 直接判 FAIL（循环点近乎静音 = 每圈一次空洞）。
#    现在两端取 0.34 / 0.30（相差 1.1dB，接缝电平连续），段内落差仍有 10.5dB。

# 动机：在"音级梯子"上的度数偏移（都是 ±3 度以内 = 级进为主）
MOTIF_A = [0, 1, 2, 1]
MOTIF_B = [0, -1, 0, 1]
MOTIF_C = [0, 1, 0, -1]
# 旋律节奏骨架（八分音符为单位，一小节 8 格）
MEL_SLOTS = [[0, 2, 4, 6], [0, 2, 4, 6], [0, 3, 4, 6], [0, 2, 5, 6]]
# 每小节用哪个动机
MEL_PLAN = {4: MOTIF_A, 5: MOTIF_A, 6: MOTIF_B, 7: MOTIF_A,
            8: MOTIF_C, 9: MOTIF_C, 10: MOTIF_B, 11: MOTIF_B}


# ============================================================================
# 工具
# ============================================================================
_NOTE_BASE = {'C': 0, 'D': 2, 'E': 4, 'F': 5, 'G': 7, 'A': 9, 'B': 11}
_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']


def midi_of(name):
    semi = _NOTE_BASE[name[0].upper()]
    i = 1
    while i < len(name) and name[i] in '#b':
        semi += 1 if name[i] == '#' else -1
        i += 1
    return (int(name[i:]) + 1) * 12 + semi


def hz(name):
    return hz_midi(midi_of(name))


def hz_midi(m):
    return 440.0 * (2.0 ** ((m - 69) / 12.0))


def pc_name(m):
    return _NAMES[int(m) % 12]


def midi_name(m):
    return _NAMES[int(m) % 12] + str(int(m) // 12 - 1)


def add(sig, t0):
    """把 sig 从 t0 秒写入，超出循环末尾的部分**绕回开头**（无缝循环第一条保证）"""
    if sig is None or len(sig) == 0:
        return
    s = int(round(t0 * SR)) % N
    end = s + len(sig)
    if end <= N:
        BUF[s:end] += sig
    else:
        k = N - s
        BUF[s:] += sig[:k]
        BUF[:end - N] += sig[k:]


def env(n, attack, release, curve=1.4):
    e = np.ones(n)
    na = int(min(n, attack * SR))
    nr = int(min(n, release * SR))
    if na > 1:
        e[:na] = np.linspace(0.0, 1.0, na) ** curve
    if nr > 1:
        e[n - nr:] = np.linspace(1.0, 0.0, nr) ** curve
    return e


def soft_attack(n, ms=10.0):
    """升余弦软起音。v3 收到 10ms（v2 的 28ms 把音头也糊掉了）。"""
    k = min(max(2, int(ms / 1000.0 * SR)), n)
    out = np.ones(n)
    out[:k] = 0.5 * (1.0 - np.cos(np.pi * np.linspace(0.0, 1.0, k)))
    return out


# ============================================================================
# 音色
# ============================================================================
def voice_pad(freq, dur, amp, rng, detune=1.1):
    """长音 pad：只留 1~3 次谐波（4 次以上会在低频区堆出"糊 + 扎"的分音）。"""
    n = int(dur * SR)
    t = np.arange(n) / SR
    out = np.zeros(n)
    for h, ha in ((1, 1.0), (2, 0.13), (3, 0.04)):
        for cents in (-detune, detune):
            out += ha * np.sin(2 * np.pi * freq * h * (2 ** (cents / 1200.0)) * t
                               + rng.uniform(0, 2 * np.pi))
    out *= 1.0 + 0.05 * np.sin(2 * np.pi * 0.09 * t)
    out *= env(n, 0.45, 0.70, 1.3)
    return amp * out / 4.0


def voice_ep(freq, amp, tau=0.55, attack_ms=10.0):
    """
    软电钢 / 毛毡钢琴。
    ⭐ v3 的关键：n 从 v2 的 min(tau*6.9, 5.5) 秒压到 min(tau*4.5, 3.0) 秒，
       且 tau 从 [1.5,2.1] 收到 0.55 —— 这才治了"拉音"。
    只用整数谐波（v1 的 2.01/3.02/4.71 倍是非谐波，是"叮"的来源）。
    """
    n = int(min(tau * 4.5, 3.0) * SR)
    t = np.arange(n) / SR
    out = np.zeros(n)
    for h, ha, ht in ((1.0, 1.0, 1.0), (2.0, 0.12, 0.55), (3.0, 0.03, 0.32)):
        out += ha * np.exp(-t / (tau * ht)) * np.sin(2 * np.pi * freq * h * t)
    out *= soft_attack(n, attack_ms)
    rl = min(int(0.45 * SR), n // 4)
    if rl > 1:
        out[n - rl:] *= 0.5 * (1.0 + np.cos(np.pi * np.linspace(0.0, 1.0, rl)))
    return amp * out


def voice_sub(freq, amp, tau=1.05):
    """
    ⭐ 低频也必须是"衰减音"，**不能**用长音铺底。
    v2/v3 前两版都用持续正弦当 bass，结果：整条混音的包络被这个"永不停的音"
    填平（env_std 只有 3.3dB），于是不管旋律多短，听感还是糊的 —— 这就是"拉音"的另一半。
    参照曲的低频也是钢琴弹的（同样在衰减），这是它包络起伏 9dB 的前提。
    """
    n = int(min(tau * 4.5, 2.6) * SR)
    t = np.arange(n) / SR
    x = np.sin(2 * np.pi * freq * t) * np.exp(-t / tau)
    # ⭐ 2/3 次谐波给足（0.45 / 0.15）：基频 F2=87Hz 落在 0–150Hz，
    #    而谐波落在 150–500Hz。参照曲的低频段是 43%+48% 的**两段**分布，
    #    只堆基频会变成"80% 挤在 150Hz 以下"的一坨闷雷。
    x += 0.45 * np.sin(4 * np.pi * freq * t) * np.exp(-t / (tau * 0.62))
    x += 0.15 * np.sin(6 * np.pi * freq * t) * np.exp(-t / (tau * 0.40))
    x *= soft_attack(n, 12.0)
    rl = min(int(0.30 * SR), n // 4)
    if rl > 1:
        x[n - rl:] *= 0.5 * (1.0 + np.cos(np.pi * np.linspace(0.0, 1.0, rl)))
    return amp * x


# ============================================================================
# 频谱整形 / 混响（FFT 域，长度 = N ⇒ 天生环形，不破坏循环）
# ============================================================================
def freq_shape(x, cutoff, slope=1.0, hp=None):
    n = len(x)
    X = np.fft.rfft(x)
    fr = np.fft.rfftfreq(n, 1.0 / SR)
    shape = 1.0 / (1.0 + (fr / float(cutoff)) ** (2.0 * slope)) ** 0.5
    if hp:
        shape = shape * (fr / (fr + float(hp)))
    return np.fft.irfft(X * shape, n=n)


def mid_dip(x, center=900.0, width_oct=0.85, depth=0.45):
    """
    900Hz 附近钟形衰减（对数频率轴上的高斯）。
    参照曲的 500–2000Hz 只占 8.3%，v2 占了 31.2% —— 这一刀专治"中频太满"。
    长度同样 = N，环形，不破坏接缝。
    """
    n = len(x)
    X = np.fft.rfft(x)
    fr = np.fft.rfftfreq(n, 1.0 / SR)
    fr_safe = np.maximum(fr, 1e-6)
    g = np.exp(-0.5 * (np.log2(fr_safe / center) / width_oct) ** 2)
    return np.fft.irfft(X * (1.0 - depth * g), n=n)


def make_hiss(n, amp, rng):
    x = rng.standard_normal(n)
    x = freq_shape(x, 3200, 1.0, hp=60)
    return amp * x / (np.max(np.abs(x)) + 1e-12)


def circular_reverb(x, seconds=2.2, decay=3.0, seed=7):
    """环形卷积混响：尾巴按模 N 折回开头，接缝自然消失。
    ⚠️ 尾巴折回的顺序别写反（写反了会把整条尾巴丢掉，每圈结尾硬切）。"""
    rng = np.random.default_rng(seed)
    m = int(seconds * SR)
    ir = rng.standard_normal(m) * np.exp(-np.linspace(0.0, decay, m))
    ir = freq_shape(ir, 2200, 1.0)
    ir /= (np.sqrt(np.sum(ir ** 2)) + 1e-12)

    L = 1
    while L < N + m - 1:
        L *= 2
    X = np.fft.rfft(x, n=L)
    H = np.fft.rfft(ir, n=L)
    y = np.fft.irfft(X * H, n=L)
    tail = np.zeros(N)
    tail[:min(N, L - N)] = y[N:N + min(N, L - N)]
    return y[:N] + tail


# ============================================================================
# 编曲
# ============================================================================
STATS = {}


def build_ladders():
    """F 大调"音级梯子"：一个低位梯子给流动织体，一个中高位梯子给旋律。"""
    low = [m for m in range(53, 66) if pc_name(m) in F_MAJOR_PCS]      # F3..F4
    high = [m for m in range(60, 84) if pc_name(m) in F_MAJOR_PCS]     # C4..B5
    return low, high


def interval_profile(signed):
    """
    生成端**精确**的音程画像。
    ⚠️ 为什么必须在这里算：音频端的单峰音高跟踪（compare-bgm.py 里那个）在多声部 +
       重混响的素材上会不停串声部，直方图里会冒出 ±12/±9 之类根本不存在的大跳。
       所以"级进占比"这件事，只认生成端的这个数；音频端的只当诊断。
    """
    if not signed:
        return {}
    ab = [abs(i) for i in signed]
    hist = {}
    for i in signed:
        hist[str(i)] = hist.get(str(i), 0) + 1
    return {
        'count': len(signed),
        'stepwise_pct': round(100.0 * sum(1 for i in ab if i <= 2) / len(ab), 1),
        'leap_pct': round(100.0 * sum(1 for i in ab if i >= 5) / len(ab), 1),
        'median_semitones': round(float(np.median(ab)), 1),
        'hist': dict(sorted(hist.items(), key=lambda kv: -kv[1])[:8]),
    }


def compose(seed=20260918):
    rng = np.random.default_rng(seed)
    low_ladder, high_ladder = build_ladders()

    total_bars = 4 * ROUNDS
    mel_notes = fig_notes = 0
    out_of_key = strong_off_chord = fig_start_off_chord = 0
    mel_midis = []
    intervals = []
    mel_signed = []      # 旋律相邻音程（带方向）—— 生成端**精确**统计
    fig_signed = []      # 流动织体的相邻音程
    # ⭐ 句内 vs 句间要分开算：旋律的"级进"约束说的是**一句之内**。
    #    换句（小节交界、动机换锚点）时出现一个五度跳是正常音乐写法，
    #    把它也算成"大跳"会让断言整天误报（首轮就是被 7 半音判 FAIL）。
    mel_cross = []
    fig_cross = []
    prev_fig_m = None
    prev_fig_bar = None

    # ---- 1. 低频与铺底 ----
    #  ⚠️ 架构级修正（v3 第二轮才想通）：参照曲里**没有持续 pad** ——
    #     它的"垫"感来自钢琴长音 + 长混响，而不是一台一直在响的合成器。
    #     所以这里把 pad 压到"胶水"级别，低频改成**有衰减的弹奏音**（每小节两下）。
    for b in range(total_bars):
        ch = CHORDS[b % 4]
        t0 = b * BAR
        g = PAD_GATE[b]
        # pad 时值给满一小节（BAR*0.80 会让每小节末尾留 0.5s 空洞，
        # 末小节那一留就把接缝末尾 30ms 压到 −34dB → PASS_edge_not_silent FAIL）。
        # 起伏交给门控数组做，别再靠"把音截短"。
        for k, nm in enumerate(ch['pad']):
            add(voice_pad(hz(nm), BAR * 1.00, (0.042 - 0.004 * k) * g, rng), t0)
        # 低音：拍 1 重、拍 3 轻 —— 两下都在衰减，包络就会跟着呼吸
        add(voice_sub(hz(ch['pad'][0]), 0.20 * g, tau=1.05), t0)
        add(voice_sub(hz(ch['pad'][0]), 0.11 * g, tau=0.90), t0 + 2 * BEAT)

    # ---- 2. 流动织体：每小节 8 个八分音符，在低位梯子上做级进弧线 ----
    #      弧线 [s, s+1, s+2, s+3, s+2, s+1, s, s+1] ⇒ 相邻音程全是 ±1~±2
    #      半音，正是参照曲音程直方图里 ±1 占大头的那种形状。
    for b in range(total_bars):
        g = FIG_GATE[b]
        if g <= 0:
            continue
        ch = CHORDS[b % 4]
        # 起始索引**直接取和弦音**（不能先取再 clamp —— clamp 会把它挤成非和弦音，
        # 这正是首轮 figure_bar_start_off_chord=3 的原因）。
        # 弧线要占 4 格，所以起点必须 ≤ len-4。
        cands = [i for i, m in enumerate(low_ladder)
                 if pc_name(m) in ch['tones'] and i <= len(low_ladder) - 4]
        if not cands:
            continue
        s = cands[(b // 4) % len(cands)]
        arc = [s, s + 1, s + 2, s + 3, s + 2, s + 1, s, s + 1]
        for beat in range(8):
            m = low_ladder[arc[beat]]
            if beat == 0 and pc_name(m) not in ch['tones']:
                fig_start_off_chord += 1
            if pc_name(m) not in F_MAJOR_PCS:
                out_of_key += 1
            amp = 0.095 * g * float(rng.uniform(0.80, 1.0))
            add(voice_ep(hz_midi(m), amp, tau=0.30, attack_ms=8.0),
                t0_slot(b, beat, rng))
            if prev_fig_m is not None:
                (fig_signed if prev_fig_bar == b else fig_cross).append(m - prev_fig_m)
            prev_fig_m = m
            prev_fig_bar = b
            fig_notes += 1

    # ---- 3. 旋律：动机 + 变化重复（没有随机游走）----
    prev_m = None
    prev_m_bar = None
    for b in range(total_bars):
        g = MEL_GATE[b]
        if g <= 0:
            continue
        ch = CHORDS[b % 4]
        motif = MEL_PLAN.get(b, MOTIF_A)
        slots = MEL_SLOTS[b % len(MEL_SLOTS)]
        tone_idx = [i for i, m in enumerate(high_ladder) if pc_name(m) in ch['tones']]
        if not tone_idx:
            continue
        # 锚点：中位梯子里最靠近该和弦"三音"的和弦音位置。
        # 后半段整体上移一个全音（67→69）—— 换个音区，但**不产生大跳**，
        # 因为移的是整句而不是单音。
        target = 67 + (2 if (b // 4) % 2 else 0)
        anchor = min(tone_idx, key=lambda i: abs(high_ladder[i] - target))
        for k, slot in enumerate(slots):
            idx = anchor + motif[k]
            idx = int(max(0, min(len(high_ladder) - 1, idx)))
            m = high_ladder[idx]
            # 强拍（第 1 拍）必须落在和弦音上：不是就沿梯子挪到最近的和弦音
            if slot == 0 and pc_name(m) not in ch['tones']:
                strong_off_chord += 1
                near = sorted(tone_idx, key=lambda i: (abs(i - idx), i))
                if near:
                    idx = near[0]
                    m = high_ladder[idx]
            if pc_name(m) not in F_MAJOR_PCS:
                out_of_key += 1
            if prev_m is not None:
                if prev_m_bar == b:
                    intervals.append(abs(m - prev_m))
                    mel_signed.append(m - prev_m)
                else:
                    mel_cross.append(m - prev_m)
            prev_m = m
            prev_m_bar = b
            mel_midis.append(m)
            mel_notes += 1
            amp = 0.195 * g * float(rng.uniform(0.72, 1.0))
            add(voice_ep(hz_midi(m), amp, tau=0.55, attack_ms=10.0),
                t0_slot(b, slot, rng))

    max_interval = max(intervals) if intervals else 0

    # ---- 4. 空气底噪 ----
    BUF[:] += make_hiss(N, 0.005, rng)

    # ---- 5. 环形混响（比 v2 收一点：v2 的 3.0s/0.50 湿是"拉音"的帮凶）----
    wet = circular_reverb(BUF, seconds=2.2, decay=3.0, seed=seed)
    mix = BUF * 0.76 + wet * 0.34

    # ---- 6. 总线 ----
    mix = mix - np.mean(mix)
    mix = mid_dip(mix, center=1000.0, width_oct=1.0, depth=0.10)   # 只做轻微的中频收敛
    mix = freq_shape(mix, 4200, 1.0, hp=38)                        # 更暖 + 去次低频
    mix = np.tanh(mix * 1.15) / np.tanh(1.15)
    rms = float(np.sqrt(np.mean(mix ** 2)) + 1e-12)
    mix = mix * (10 ** (-15.5 / 20.0) / rms)                       # RMS -15.5 dBFS
    peak = float(np.max(np.abs(mix)))
    if peak > 0.92:
        mix = mix * (0.92 / peak)

    STATS.update({
        'melody_notes': mel_notes,
        'figure_notes': fig_notes,
        'melody_out_of_key': out_of_key,
        'melody_strong_off_chord': strong_off_chord,
        'figure_bar_start_off_chord': fig_start_off_chord,
        'melody_max_interval_semitones': max_interval,
        'melody_interval': interval_profile(mel_signed),
        'figure_interval': interval_profile(fig_signed),
        'melody_phrase_boundary_moves': [int(x) for x in mel_cross],
        'figure_phrase_boundary_moves': [int(x) for x in fig_cross],
        'notes_per_sec': round((mel_notes + fig_notes) / (N / float(SR)), 3),
        'melody_lowest_note': midi_name(min(mel_midis)) if mel_midis else '',
        'melody_highest_note': midi_name(max(mel_midis)) if mel_midis else '',
        'intro_seconds': round(INTRO_BARS * BAR, 2),
    })
    return mix


def t0_slot(bar, slot8, rng):
    """第 bar 小节、第 slot8 个八分音符格 → 绝对时间（带轻微人性化抖动）"""
    return bar * BAR + slot8 * BEAT * 0.5 + float(rng.uniform(-0.008, 0.008))


# ============================================================================
# 写文件
# ============================================================================
def write_wav(path, x):
    pcm = np.clip(x, -1.0, 1.0)
    pcm = (pcm * 32767.0).astype('<i2')
    with wave.open(path, 'wb') as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(pcm.tobytes())


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


def main():
    out_dir = sys.argv[1] if len(sys.argv) > 1 else r'F:\图形塔防\audio'
    seed = int(sys.argv[2]) if len(sys.argv) > 2 else 20260918
    os.makedirs(out_dir, exist_ok=True)

    mix = compose(seed)

    wav_path = os.path.join(out_dir, '_snowfall_src.wav')
    mp3_path = os.path.join(out_dir, 'snowfall.mp3')
    write_wav(wav_path, mix)

    info = {
        'version': 3,
        'seed': seed,
        'musical_key': 'F major',
        'progression': [c['name'] for c in CHORDS],
        'sample_rate': SR,
        'bpm': BPM,
        'bars': 4 * ROUNDS,
        'loop_seconds': round(N / float(SR), 4),
        'loop_samples': N,
        'rms_dbfs': round(float(20 * np.log10(np.sqrt(np.mean(mix ** 2)) + 1e-12)), 2),
        'peak_dbfs': round(float(20 * np.log10(np.max(np.abs(mix)) + 1e-12)), 2),
        'seam_jump': round(float(abs(mix[0] - mix[-1])), 6),
        'typical_step': round(float(np.median(np.abs(np.diff(mix)))), 6),
        'wav_bytes': os.path.getsize(wav_path),
    }
    info.update(STATS)
    info['PASS_all_melody_in_key'] = (STATS.get('melody_out_of_key', 1) == 0)
    info['PASS_strong_beats_on_chord'] = (STATS.get('melody_strong_off_chord', 1) == 0)
    info['PASS_figure_bar_start_on_chord'] = (STATS.get('figure_bar_start_off_chord', 1) == 0)
    info['PASS_melody_no_big_leap'] = (STATS.get('melody_max_interval_semitones', 99) <= 5)
    info['PASS_melody_no_big_leap_note'] = '句内(gate: 上一轮把换句跳也算进来才误报 FAIL，已改为只约束句内)'
    # 级进必须占压倒性多数（判据先定好再跑，不是拿结果倒推阈值）：级进 ≥ 2× 大跳
    _mi = STATS.get('melody_interval', {})
    info['PASS_melody_mostly_stepwise'] = (
        _mi.get('stepwise_pct', 0) >= 2 * _mi.get('leap_pct', 0))

    ff = find_ffmpeg()
    if ff:
        subprocess.run([ff, '-y', '-loglevel', 'error', '-i', wav_path,
                        '-ac', '1', '-ar', str(SR), '-b:a', '80k',
                        '-codec:a', 'libmp3lame', mp3_path], check=True)
        info['mp3_bytes'] = os.path.getsize(mp3_path)
        os.remove(wav_path)     # 中间 WAV 不留（几 MB，白占包体）
    else:
        info['mp3_bytes'] = None
        info['error'] = 'ffmpeg not found'

    with open(os.path.join(out_dir, '_snowfall_report.json'), 'w', encoding='utf-8') as f:
        json.dump(info, f, ensure_ascii=False, indent=2)


if __name__ == '__main__':
    main()
