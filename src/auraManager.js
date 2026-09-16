// 光环管理器：管理所有塔身上的光环效果（增益 / 负面效果）
// 规则（2026-09 重构）：
//  1. 每个目标塔同一时间只保留一个生效光环（最强来源），不再多源累加；
//  2. 高阶来源覆盖低阶来源（高阶效果覆盖低阶效果）；同级来源刷新数值与持续时间；
//  3. 光环带真实过期时间：来源塔离开范围/死亡后，过期自动移除，不再永久残留；
//  4. 光环强度由来源塔阶段决定（见 game_core.applyTrapezoidAuras），每次进阶立即生效；
//  5. （2026-09 新增）一个光环可携带多条 buff（buffs 键值对，正值=增益、负值=负面效果），
//     并记录来源名 / 来源阶段 / 剩余时间，供"附加属性系统"（bonusStats）在属性面板
//     的绿字数值与"生效效果"明细里如实展示。

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

class AuraManager {
  constructor() {
    // targetId -> { sourceId, sourceName, sourceStage, buffs, expiryTime, maxExpiry }
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
    const stage = Number(sourceStage) || 0;
    const sourceName = meta.name || '光环';

    const current = this.towerAuras.get(targetId);
    if (current) {
      if (current.sourceStage > stage) {
        // 已有更高阶光环覆盖：低阶来源不生效，只保证持续时间不缩短
        current.expiryTime = Math.max(current.expiryTime, expiry);
        return;
      }
      // 高阶（或同级）来源：覆盖数值与来源信息、刷新持续时间
      current.sourceId = sourceId;
      current.sourceName = sourceName;
      current.sourceStage = stage;
      current.buffs = buffs;
      current.expiryTime = Math.max(current.expiryTime, expiry);
      current.maxExpiry = Math.max(current.maxExpiry || 0, expiry);
      return;
    }

    this.towerAuras.set(targetId, {
      sourceId,
      sourceName,
      sourceStage: stage,
      buffs,
      expiryTime: expiry,
      maxExpiry: expiry,
    });
  }

  /**
   * 更新光环持续时间，过期的直接移除（过期真正生效）
   * @param {number} dt - deltaTime（秒）
   */
  update(dt) {
    for (const [targetId, aura] of this.towerAuras) {
      aura.expiryTime -= dt;
      if (aura.expiryTime <= 0) {
        this.towerAuras.delete(targetId);
      }
    }
  }

  /**
   * 获取目标塔的光环原始记录（无则 null）
   * @returns {{sourceId:number, sourceName:string, sourceStage:number, buffs:Object, expiryTime:number}|null}
   */
  getAura(targetId) {
    return this.towerAuras.get(targetId) || null;
  }

  /**
   * 获取目标塔当前生效的全部光环（数组，含 remaining 剩余秒数）。
   * 当前规则下一个目标最多一个光环，返回数组是为将来多光环叠加预留。
   * @returns {Array<Object>}
   */
  getAuras(targetId) {
    const aura = this.towerAuras.get(targetId);
    if (!aura) return [];
    return [{
      sourceId: aura.sourceId,
      sourceName: aura.sourceName,
      sourceStage: aura.sourceStage,
      buffs: aura.buffs,
      remaining: Math.max(0, aura.expiryTime),
      maxExpiry: aura.maxExpiry,
    }];
  }

  /**
   * 读取某个 buff 键的当前值（无光环则该键为 0）
   * @param {number} targetId
   * @param {string} key - buff 属性键，如 'attackSpeedMultiplier'
   */
  getAuraValue(targetId, key) {
    const aura = this.towerAuras.get(targetId);
    if (!aura || !aura.buffs) return 0;
    return aura.buffs[key] || 0;
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
    return this.towerAuras.has(targetId);
  }

  /**
   * 清除所有光环（游戏重启时）
   */
  clear() {
    this.towerAuras.clear();
  }
}

module.exports = AuraManager;
