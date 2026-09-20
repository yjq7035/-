// 光环管理器：管理所有塔身上的光环效果（增益 / 负面效果）
// 规则（2026-09-20 三次修订：加入"通道"）：
//  1. 光环以【目标塔 + 属性键 + 通道】为单位存储：同一个目标可以同时挂着来自不同来源的
//     不同属性光环（如菱形塔的「穿透」+ 梯塔的「攻速」），互不排斥；
//  2. 同一个属性键上多源竞争时只保留一个生效来源（最强来源），不再多源累加 ——
//     优先级：来源阶段高者胜 → 同阶比作用强度（绝对值大者胜）→ 完全同值则先到先得；
//     ⚠️ 竞争**只在同一通道内部**发生（见第 6 条）；
//  3. 光环带真实过期时间：来源塔离开范围/死亡后，过期自动移除，不再永久残留；
//     ⚠️ 低阶来源**不会**给高阶光环续命（旧版会把高阶光环的倒计时一起刷新，
//     造成"离开高星梯塔后，只要身边还有一座低星梯塔，高阶光环就永不过期"）；
//  4. 光环强度由来源塔阶段决定（见 game_core.applyTrapezoidAuras），每次进阶立即生效；
//  5. 一个来源在同一个目标身上可携带多条 buff（buffs 键值对，正值=增益、负值=负面效果），
//     并记录来源名 / 来源阶段 / 剩余时间，供"附加属性系统"（bonusStats）在属性面板
//     的绿字数值与"生效效果"明细里如实展示。
//  6. ★ 通道（channel，见 config.AURA_CHANNEL）：辅助塔自带的固有光环是 'aura'，
//     十字塔「共享资源」是 'share'。**不同通道之间不竞争**，读取时同一个属性键相加。
//     为什么必须有这条 —— 二者发出去的键完全同名（攻速 / 穿透 / 暴击率 / 破解 / 暴击伤害），
//     分通道之前它们在同一把键上抢唯一名额：谁阶段高谁留，输的那个**整条光环凭空消失**
//     （玩家症状：「只有星级压住共享资源时，光环才给得上；否则梯塔/菱形塔等于白放」）。
//     同通道内部仍然"取最强不叠加"（两座梯塔不会把攻速叠成两份）。
//
// 数据结构（三层，最后一层才是"通道"）：
//   targetId -> Map<buffKey, Map<channel, { sourceId, sourceName, sourceStage, value,
//                                            expiryTime, maxExpiry }>>
//
// 依赖方向：auraManager → config（只取 AURA_CHANNEL 常量）。**config 不许 require 本文件**。

const { AURA_CHANNEL } = require('./config');

/** 通道名归一化：只认登记过的两个通道，其余（含 undefined / 拼错）一律回落固有光环通道 */
function normalizeChannel(ch) {
  return ch === AURA_CHANNEL.SHARE ? AURA_CHANNEL.SHARE : AURA_CHANNEL.AURA;
}

// 兼容旧调用：允许直接传数字，等价于 { attackSpeedMultiplier: n }
function normalizeBuffs(buff) {
  if (typeof buff === 'number') return { attackSpeedMultiplier: buff };
  if (!buff || typeof buff !== 'object') return {};
  // 支持 { buffs: {...} } 包装形式
  const src = (buff.buffs && typeof buff.buffs === 'object') ? buff.buffs : buff;
  const out = {};
  for (const key of Object.keys(src)) {
    const v = Number(src[key]);
    if (!isNaN(v)) out[key] = v;
  }
  return out;
}

/**
 * 新来源是否应当从当前来源手里抢走这条属性（**同一通道内部**的竞争）。
 * 规则：阶段高者胜 → 同阶比作用强度（|值| 大者胜）→ 完全打平则先到先得（保持稳定，不来回抖）。
 */
function outranks(stage, value, cur) {
  if (stage !== cur.sourceStage) return stage > cur.sourceStage;
  return Math.abs(value) > Math.abs(cur.value) + 1e-9;
}

class AuraManager {
  constructor() {
    // targetId -> Map<buffKey, Map<channel, entry>>
    this.towerAuras = new Map();
  }

  /**
   * 应用光环效果（每帧对范围内目标调用，持续刷新）
   * @param {number} sourceId - 光环来源塔的唯一ID
   * @param {Object|number} buff - 光环效果，如 { attackSpeedMultiplier: 50 }（负数即负面效果）
   * @param {number} sourceStage - 来源塔的阶段（决定**同通道内**覆盖优先级）
   * @param {number} targetId - 目标塔的唯一ID
   * @param {number} expiry - 持续时间（秒）
   * @param {Object} [meta] - 附加信息：{ name } 来源塔显示名（面板展示用）；
   *                          { channel } 光环通道（config.AURA_CHANNEL，缺省 = 'aura'）
   */
  applyAura(sourceId, buff, sourceStage, targetId, expiry = 3.0, meta = {}) {
    const buffs = normalizeBuffs(buff);
    const keys = Object.keys(buffs);
    if (!keys.length) return;
    const stage = Number(sourceStage) || 0;
    const sourceName = meta.name || '光环';
    const channel = normalizeChannel(meta.channel);

    let byKey = this.towerAuras.get(targetId);
    if (!byKey) {
      byKey = new Map();
      this.towerAuras.set(targetId, byKey);
    }

    for (const key of keys) {
      const value = buffs[key];
      let byChannel = byKey.get(key);
      if (!byChannel) {
        byChannel = new Map();
        byKey.set(key, byChannel);
      }
      const cur = byChannel.get(channel);
      if (cur) {
        if (cur.sourceId === sourceId) {
          // 同一来源同一通道：刷新数值与持续时间（塔还在范围内，光环不该掉）
          cur.sourceName = sourceName;
          cur.sourceStage = stage;
          cur.value = value;
          cur.expiryTime = Math.max(cur.expiryTime, expiry);
          cur.maxExpiry = Math.max(cur.maxExpiry || 0, expiry);
          continue;
        }
        if (!outranks(stage, value, cur)) {
          // 本通道内已有更强来源：本次不生效，也不给它续命（高阶光环由它自己的来源负责刷新）
          continue;
        }
      }
      byChannel.set(channel, {
        sourceId,
        sourceName,
        sourceStage: stage,
        channel,
        value,
        expiryTime: expiry,
        maxExpiry: expiry,
      });
    }
  }

  /**
   * 更新光环持续时间，过期的直接移除（过期真正生效）
   * @param {number} dt - deltaTime（秒）
   */
  update(dt) {
    for (const [targetId, byKey] of this.towerAuras) {
      for (const [key, byChannel] of byKey) {
        for (const [channel, entry] of byChannel) {
          entry.expiryTime -= dt;
          if (entry.expiryTime <= 0) byChannel.delete(channel);
        }
        if (byChannel.size === 0) byKey.delete(key);
      }
      if (byKey.size === 0) this.towerAuras.delete(targetId);
    }
  }

  /**
   * 获取目标塔的光环（合并视图，供只想拿"有什么 buff"的调用方使用）。
   * 多个来源时 sourceId/sourceName/sourceStage 取阶段最高的那条；
   * ⚠️ buffs 为**各来源、各通道的合并结果**：同一个键跨通道**相加**
   *   （梯塔攻速 + 十字塔共享攻速），同通道同键已在 applyAura 里竞争出唯一来源，不会重复计入。
   * @returns {{sourceId:number, sourceName:string, sourceStage:number, buffs:Object, expiryTime:number}|null}
   */
  getAura(targetId) {
    const list = this.getAuras(targetId);
    if (!list.length) return null;
    const primary = list.reduce((a, b) => (b.sourceStage > a.sourceStage ? b : a));
    const buffs = {};
    for (const a of list) {
      for (const key of Object.keys(a.buffs)) {
        buffs[key] = (buffs[key] || 0) + a.buffs[key];
      }
    }
    return {
      sourceId: primary.sourceId,
      sourceName: primary.sourceName,
      sourceStage: primary.sourceStage,
      buffs,
      expiryTime: primary.remaining,
      maxExpiry: primary.maxExpiry,
    };
  }

  /**
   * 获取目标塔当前生效的全部光环，**按【来源 + 通道】分组**（含 remaining 剩余秒数）。
   * 同一个目标可以有多条（不同来源 / 不同通道提供不同属性），每条 buffs 里只包含该来源
   * 在该通道内胜出的属性键。
   * @returns {Array<Object>} 每项含 { sourceId, sourceName, sourceStage, channel, buffs, remaining, maxExpiry }
   */
  getAuras(targetId) {
    const byKey = this.towerAuras.get(targetId);
    if (!byKey || byKey.size === 0) return [];
    const groups = new Map();   // "sourceId@channel" -> view
    for (const [key, byChannel] of byKey) {
      for (const [channel, entry] of byChannel) {
        const gid = `${entry.sourceId}@${channel}`;
        let g = groups.get(gid);
        if (!g) {
          g = {
            sourceId: entry.sourceId,
            sourceName: entry.sourceName,
            sourceStage: entry.sourceStage,
            channel,
            buffs: {},
            remaining: entry.expiryTime,
            maxExpiry: entry.maxExpiry,
          };
          groups.set(gid, g);
        }
        g.buffs[key] = entry.value;
        g.remaining = Math.min(g.remaining, entry.expiryTime);
        g.maxExpiry = Math.max(g.maxExpiry || 0, entry.maxExpiry || 0);
      }
    }
    return Array.from(groups.values());
  }

  /**
   * 读取某个 buff 键的当前值：**跨通道相加**（同通道内已经竞争出唯一来源）。
   * 这才是战斗侧要的"这座塔一共吃到多少" —— 梯塔光环与十字塔共享必须同时算进去。
   * @param {number} targetId
   * @param {string} key - buff 属性键，如 'attackSpeedMultiplier'
   */
  getAuraValue(targetId, key) {
    const byChannel = this._channelMap(targetId, key);
    if (!byChannel) return 0;
    let sum = 0;
    for (const entry of byChannel.values()) sum += entry.value;
    return sum;
  }

  /**
   * 读取某个 buff 键在**指定通道**内胜出的值（0 = 该通道没给这条属性）。
   * 面板明细/探针要区分"这条加成到底是光环发的还是共享资源发的"时用它。
   * @param {number} targetId
   * @param {string} key - buff 属性键
   * @param {string} channel - config.AURA_CHANNEL 里的通道名（非法值按 'aura' 处理）
   */
  getChannelValue(targetId, key, channel) {
    const byChannel = this._channelMap(targetId, key);
    if (!byChannel) return 0;
    const entry = byChannel.get(normalizeChannel(channel));
    return entry ? entry.value : 0;
  }

  /** 内部：某目标某属性键的「通道 → entry」表（没有则 null） */
  _channelMap(targetId, key) {
    const byKey = this.towerAuras.get(targetId);
    if (!byKey) return null;
    const byChannel = byKey.get(key);
    return (byChannel && byChannel.size) ? byChannel : null;
  }

  /**
   * 获取带光环加成的值（无光环/已过期则返回基础值）
   * @param {number} towerId - 目标塔的唯一ID
   * @param {number} baseValue - 基础值（如攻击速度基础100）
   * @param {string} [key] - buff 属性键，默认攻击速度
   * @returns {number} 应用光环后的值
   */
  getBuffedValue(towerId, baseValue, key = 'attackSpeedMultiplier') {
    return baseValue + this.getAuraValue(towerId, key);
  }

  /**
   * 目标塔当前是否有生效光环
   */
  hasAura(targetId) {
    const byKey = this.towerAuras.get(targetId);
    return !!byKey && byKey.size > 0;
  }

  /**
   * 清除所有光环（游戏重启时）
   */
  clear() {
    this.towerAuras.clear();
  }
}

module.exports = AuraManager;
