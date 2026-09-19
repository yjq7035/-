// 光环管理器：管理所有塔身上的光环效果（增益 / 负面效果）
// 规则（2026-09 二次重构）：
//  1. 光环以【目标塔 + 属性键】为单位存储：同一个目标可以同时挂着来自不同来源的
//     不同属性光环（如菱形塔的「穿透」+ 梯塔的「攻速」），互不排斥；
//  2. 同一个属性键上多源竞争时只保留一个生效来源（最强来源），不再多源累加 ——
//     优先级：来源阶段高者胜 → 同阶比作用强度（绝对值大者胜）→ 完全同值则先到先得；
//  3. 光环带真实过期时间：来源塔离开范围/死亡后，过期自动移除，不再永久残留；
//     ⚠️ 低阶来源**不会**给高阶光环续命（旧版会把高阶光环的倒计时一起刷新，
//     造成"离开高星梯塔后，只要身边还有一座低星梯塔，高阶光环就永不过期"）；
//  4. 光环强度由来源塔阶段决定（见 game_core.applyTrapezoidAuras），每次进阶立即生效；
//  5. 一个来源在同一个目标身上可携带多条 buff（buffs 键值对，正值=增益、负值=负面效果），
//     并记录来源名 / 来源阶段 / 剩余时间，供"附加属性系统"（bonusStats）在属性面板
//     的绿字数值与"生效效果"明细里如实展示。
//
// 数据结构：targetId -> Map<buffKey, { sourceId, sourceName, sourceStage, value,
//                                    expiryTime, maxExpiry }>

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
 * 新来源是否应当从当前来源手里抢走这条属性。
 * 规则：阶段高者胜 → 同阶比作用强度（|值| 大者胜）→ 完全打平则先到先得（保持稳定，不来回抖）。
 */
function outranks(stage, value, cur) {
  if (stage !== cur.sourceStage) return stage > cur.sourceStage;
  return Math.abs(value) > Math.abs(cur.value) + 1e-9;
}

class AuraManager {
  constructor() {
    // targetId -> Map<buffKey, entry>
    this.towerAuras = new Map();
  }

  /**
   * 应用光环效果（每帧对范围内目标调用，持续刷新）
   * @param {number} sourceId - 光环来源塔的唯一ID
   * @param {Object|number} buff - 光环效果，如 { attackSpeedMultiplier: 50 }（负数即负面效果）
   * @param {number} sourceStage - 来源塔的阶段（决定覆盖优先级）
   * @param {number} targetId - 目标塔的唯一ID
   * @param {number} expiry - 持续时间（秒）
   * @param {Object} [meta] - 附加信息：{ name } 来源塔显示名（面板展示用）
   */
  applyAura(sourceId, buff, sourceStage, targetId, expiry = 3.0, meta = {}) {
    const buffs = normalizeBuffs(buff);
    const keys = Object.keys(buffs);
    if (!keys.length) return;
    const stage = Number(sourceStage) || 0;
    const sourceName = meta.name || '光环';

    let byKey = this.towerAuras.get(targetId);
    if (!byKey) {
      byKey = new Map();
      this.towerAuras.set(targetId, byKey);
    }

    for (const key of keys) {
      const value = buffs[key];
      const cur = byKey.get(key);
      if (cur) {
        if (cur.sourceId === sourceId) {
          // 同一来源：刷新数值与持续时间（塔还在范围内，光环不该掉）
          cur.sourceName = sourceName;
          cur.sourceStage = stage;
          cur.value = value;
          cur.expiryTime = Math.max(cur.expiryTime, expiry);
          cur.maxExpiry = Math.max(cur.maxExpiry || 0, expiry);
          continue;
        }
        if (!outranks(stage, value, cur)) {
          // 已有更强来源：本次不生效，也不给它续命（高阶光环由它自己的来源负责刷新）
          continue;
        }
      }
      byKey.set(key, {
        sourceId,
        sourceName,
        sourceStage: stage,
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
      for (const [key, entry] of byKey) {
        entry.expiryTime -= dt;
        if (entry.expiryTime <= 0) byKey.delete(key);
      }
      if (byKey.size === 0) this.towerAuras.delete(targetId);
    }
  }

  /**
   * 获取目标塔的光环（合并视图，供只想拿"有什么 buff"的调用方使用）。
   * 多个来源时 sourceId/sourceName/sourceStage 取阶段最高的那条，buffs 为各来源合并结果。
   * @returns {{sourceId:number, sourceName:string, sourceStage:number, buffs:Object, expiryTime:number}|null}
   */
  getAura(targetId) {
    const list = this.getAuras(targetId);
    if (!list.length) return null;
    const primary = list.reduce((a, b) => (b.sourceStage > a.sourceStage ? b : a));
    const buffs = {};
    for (const a of list) Object.assign(buffs, a.buffs);
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
   * 获取目标塔当前生效的全部光环，**按来源分组**（含 remaining 剩余秒数）。
   * 同一个目标可以有多条（不同来源提供不同属性），每条 buffs 里只包含该来源胜出的属性键。
   * @returns {Array<Object>}
   */
  getAuras(targetId) {
    const byKey = this.towerAuras.get(targetId);
    if (!byKey || byKey.size === 0) return [];
    const groups = new Map();   // sourceId -> view
    for (const [key, entry] of byKey) {
      let g = groups.get(entry.sourceId);
      if (!g) {
        g = {
          sourceId: entry.sourceId,
          sourceName: entry.sourceName,
          sourceStage: entry.sourceStage,
          buffs: {},
          remaining: entry.expiryTime,
          maxExpiry: entry.maxExpiry,
        };
        groups.set(entry.sourceId, g);
      }
      g.buffs[key] = entry.value;
      g.remaining = Math.min(g.remaining, entry.expiryTime);
      g.maxExpiry = Math.max(g.maxExpiry || 0, entry.maxExpiry || 0);
    }
    return Array.from(groups.values());
  }

  /**
   * 读取某个 buff 键的当前值（无光环则该键为 0）
   * @param {number} targetId
   * @param {string} key - buff 属性键，如 'attackSpeedMultiplier'
   */
  getAuraValue(targetId, key) {
    const byKey = this.towerAuras.get(targetId);
    if (!byKey) return 0;
    const entry = byKey.get(key);
    return entry ? entry.value : 0;
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
