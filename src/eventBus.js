// 事件总线：统一管理游戏内各系统的事件
class EventBus {
  constructor() {
    this.listeners = {
      onHit: [],       // 命中事件：{ hitTarget, damageSource, damage }
      onDamage: [],    // 伤害事件：{ damageSource, damage, target }
      onDeath: [],     // 死亡事件：{ deadTarget, killer }
    };
  }

  /**
   * 注册事件监听
   */
  on(event, callback) {
    if (this.listeners[event]) {
      this.listeners[event].push(callback);
    }
    return () => this.off(event, callback); // 返回取消订阅函数
  }

  /**
   * 取消注册事件监听
   */
  off(event, callback) {
    if (this.listeners[event]) {
      const index = this.listeners[event].indexOf(callback);
      if (index > -1) {
        this.listeners[event].splice(index, 1);
      }
    }
  }

  /**
   * 触发事件
   */
  emit(event, data) {
    if (this.listeners[event]) {
      for (const callback of this.listeners[event]) {
        callback(data);
      }
    }
  }

  /**
   * 触发命中事件
   * @param {object} hitTarget - 被命中的目标
   * @param {object} damageSource - 伤害来源（塔/弹道）
   * @param {number} damage - 伤害值
   */
  emitHit(hitTarget, damageSource, damage) {
    this.emit('onHit', { hitTarget, damageSource, damage });
  }

  /**
   * 触发伤害事件
   * @param {object} damageSource - 伤害来源（塔/弹道）
   * @param {number} damage - 伤害值
   * @param {object} target - 受到伤害的单位
   */
  emitDamage(damageSource, damage, target) {
    this.emit('onDamage', { damageSource, damage, target });
  }

  /**
   * 触发死亡事件
   * @param {object} deadTarget - 死亡的单位
   * @param {object} killer - 击杀者（塔/弹道）
   */
  emitDeath(deadTarget, killer) {
    this.emit('onDeath', { deadTarget, killer });
  }
}

module.exports = EventBus;
