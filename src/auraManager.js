// 光环管理器：管理所有塔的光环效果
// 首次赋予光环效果才施加实质属性，后续赋予只更新持续时间
// 默认持续时间：3秒

/**
 * 光环效果记录
 * { buff, expiryTime }
 */

/**
 * 光环管理器类
 */
class AuraManager {
  constructor() {
    // towerUniqueId -> { buff: Object, expiryTime: number }
    this.towerAuras = new Map();
    // 当前帧需要重置的塔列表（每帧清理）
    this.resetTowerIds = new Set();
  }

  /**
   * 应用光环效果
   * @param {number} towerId - 光环来源塔的唯一ID
   * @param {Object} buff - 光环效果配置，如 { attackSpeedMultiplier: 25 }
   * @param {number} targetId - 目标塔的唯一ID
   * @param {number} baseValue - 基础值（如攻击速度基础100）
   * @param {number} expiry - 持续时间（秒），默认3秒
   */
  applyAura(towerId, buff, targetId, baseValue, expiry = 3.0) {
    if (!this.towerAuras.has(targetId)) {
      this.resetTowerIds.add(targetId);
    }

    const current = this.towerAuras.get(targetId) || { buffs: [], expiryTime: 0 };

    // 合并 buff：如果有同类型的 buff，累加
    for (const key of Object.keys(buff)) {
      const buffValue = buff[key];
      const existingBuff = current.buffs.find(b => b.source === towerId);

      if (existingBuff) {
        // 已存在来源光环，只更新持续时间
        existingBuff.value = buffValue;
      } else {
        // 新来源光环
        current.buffs.push({ source: towerId, key, value: buffValue });
      }
    }

    current.expiryTime = expiry;
    this.towerAuras.set(targetId, current);
  }

  /**
   * 更新所有光环持续时间
   * @param {number} dt -  deltaTime（秒）
   */
  update(dt) {
    for (const [towerId, aura] of this.towerAuras) {
      aura.expiryTime -= dt;
      if (aura.expiryTime <= 0) {
        // 光环过期，标记重置
        this.resetTowerIds.add(towerId);
      }
    }
  }

  /**
   * 计算每个塔的光环加成
   * @param {number} towerId - 目标塔的唯一ID
   * @param {number} baseValue - 基础值（如攻击速度基础100）
   * @returns {number} 应用光环后的值
   */
  getBuffedValue(towerId, baseValue) {
    const aura = this.towerAuras.get(towerId);
    if (!aura) {
      return baseValue;
    }

    let totalBuff = 0;
    for (const buff of aura.buffs) {
      if (buff.key === 'attackSpeedMultiplier') {
        totalBuff += buff.value;
      }
    }

    return baseValue + totalBuff;
  }

  /**
   * 每帧调用：清理已重置的塔
   */
  resetFrame() {
    this.resetTowerIds.clear();
  }

  /**
   * 清除所有光环
   */
  clear() {
    this.towerAuras.clear();
    this.resetTowerIds.clear();
  }
}

module.exports = AuraManager;
