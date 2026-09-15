// 光环管理器：管理所有塔的光环效果
// 规则（2026-09 重构）：
//  1. 每个目标塔同一时间只保留一个生效光环（最强来源），不再多源累加；
//  2. 高阶来源覆盖低阶来源（高阶效果覆盖低阶效果）；同级来源刷新数值与持续时间；
//  3. 光环带真实过期时间：来源塔离开范围/死亡后，过期自动移除，不再永久残留；
//  4. 光环强度由来源塔阶段决定（见 game_core.applyTrapezoidAuras），每次进阶立即生效。

class AuraManager {
  constructor() {
    // targetId -> { source, stage, value, expiryTime }
    this.towerAuras = new Map();
  }

  /**
   * 应用光环效果（每帧对范围内目标调用，持续刷新）
   * @param {number} sourceId - 光环来源塔的唯一ID
   * @param {Object} buff - 光环效果配置，如 { attackSpeedMultiplier: 50 }
   * @param {number} sourceStage - 来源塔的阶段（决定覆盖优先级）
   * @param {number} targetId - 目标塔的唯一ID
   * @param {number} expiry - 持续时间（秒）
   */
  applyAura(sourceId, buff, sourceStage, targetId, expiry = 3.0) {
    const value = (buff && typeof buff.attackSpeedMultiplier === 'number')
      ? buff.attackSpeedMultiplier
      : 0;

    const current = this.towerAuras.get(targetId);
    if (current) {
      if (current.stage > sourceStage) {
        // 已有更高阶光环覆盖：低阶来源不生效，只保证持续时间不缩短
        current.expiryTime = Math.max(current.expiryTime, expiry);
        return;
      }
      // 高阶（或同级）来源：覆盖数值、刷新持续时间
      current.source = sourceId;
      current.stage = sourceStage;
      current.value = value;
      current.expiryTime = Math.max(current.expiryTime, expiry);
      return;
    }

    this.towerAuras.set(targetId, {
      source: sourceId,
      stage: sourceStage,
      value: value,
      expiryTime: expiry,
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
   * 获取带光环加成的值（无光环/已过期则返回基础值）
   * @param {number} towerId - 目标塔的唯一ID
   * @param {number} baseValue - 基础值（如攻击速度基础100）
   * @returns {number} 应用光环后的值
   */
  getBuffedValue(towerId, baseValue) {
    const aura = this.towerAuras.get(towerId);
    if (!aura) return baseValue;
    return baseValue + aura.value;
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
