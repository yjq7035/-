/**
 * 塔系统
 */

// 塔类型配置
const TOWER_TYPES = {
  triangle: {
    name: '三角塔',
    shape: 'triangle',
    color: '#FF4444',
    colorDark: '#CC0000',
    damage: 50,
    range: 200,
    attackSpeed: 0.5, // 秒/发
    cost: 100,
    description: '单体高伤害'
  },
  circle: {
    name: '圆塔',
    shape: 'circle',
    color: '#4444FF',
    colorDark: '#0000CC',
    damage: 30,
    range: 150,
    attackSpeed: 1.0,
    aoeRadius: 80,
    cost: 150,
    description: '范围AOE伤害'
  },
  hexagon: {
    name: '六边塔',
    shape: 'hexagon',
    color: '#44FF44',
    colorDark: '#00CC00',
    damage: 25,
    range: 250,
    attackSpeed: 1.5,
    chainCount: 3,
    cost: 200,
    description: '闪电链穿透'
  },
  rectangle: {
    name: '长方塔',
    shape: 'rectangle',
    color: '#AA44FF',
    colorDark: '#6600CC',
    damage: 150,
    range: 300,
    attackSpeed: 3.0,
    chargeTime: 1.0,
    cost: 300,
    description: '蓄力暴击炮'
  }
};

/**
 * 塔基类
 */
class Tower {
  constructor(type, x, y) {
    const config = TOWER_TYPES[type];
    if (!config) throw new Error(`Unknown tower type: ${type}`);
    
    this.type = type;
    this.name = config.name;
    this.shape = config.shape;
    this.color = config.color;
    this.colorDark = config.colorDark;
    this.damage = config.damage;
    this.range = config.range;
    this.attackSpeed = config.attackSpeed;
    this.x = x;
    this.y = y;
    
    this.attackTimer = 0;
    this.target = null;
    this.chargeTime = 0;
    this.isCharging = false;
    this.charged = false;
  }

  /**
   * 查找目标
   */
  findTarget(enemies) {
    let closest = null;
    let closestProgress = -1;
    
    for (const enemy of enemies) {
      if (!enemy.alive) continue;
      
      const dx = enemy.x - this.x;
      const dy = enemy.y - this.y;
      const distance = Math.sqrt(dx * dx + dy * dy);
      
      if (distance <= this.range) {
        // 优先攻击进度最靠前的敌人
        if (enemy.progress > closestProgress) {
          closest = enemy;
          closestProgress = enemy.progress;
        }
      }
    }
    
    return closest;
  }

  /**
   * 攻击逻辑（子类实现）
   */
  attack(target) {
    // 默认实现，由子类覆盖
    // 返回特效数组，每个特效包含 type 和渲染数据
    return [];
  }

  /**
   * 绘制塔
   */
  draw(ctx) {
    ctx.save();
    
    switch (this.shape) {
      case 'triangle':
        this.drawTriangle(ctx);
        break;
      case 'circle':
        this.drawCircle(ctx);
        break;
      case 'hexagon':
        this.drawHexagon(ctx);
        break;
      case 'rectangle':
        this.drawRectangle(ctx);
        break;
    }
    
    // 绘制射程（如果选中）
    if (this === window._selectedTower) {
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
      ctx.lineWidth = 2;
      ctx.setLineDash([5, 5]);
      ctx.beginPath();
      ctx.arc(this.x, this.y, this.range, 0, Math.PI * 2);
      ctx.stroke();
    }
    
    ctx.restore();
  }

  drawTriangle(ctx) {
    const size = 25;
    ctx.fillStyle = this.color;
    ctx.strokeStyle = this.colorDark;
    ctx.lineWidth = 3;
    
    ctx.beginPath();
    ctx.moveTo(this.x, this.y - size);
    ctx.lineTo(this.x - size, this.y + size);
    ctx.lineTo(this.x + size, this.y + size);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }

  drawCircle(ctx) {
    const radius = 22;
    ctx.fillStyle = this.color;
    ctx.strokeStyle = this.colorDark;
    ctx.lineWidth = 3;
    
    ctx.beginPath();
    ctx.arc(this.x, this.y, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }

  drawHexagon(ctx) {
    const radius = 22;
    ctx.fillStyle = this.color;
    ctx.strokeStyle = this.colorDark;
    ctx.lineWidth = 3;
    
    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
      const angle = (Math.PI / 3) * i - Math.PI / 6;
      const x = this.x + radius * Math.cos(angle);
      const y = this.y + radius * Math.sin(angle);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }

  drawRectangle(ctx) {
    const width = 30;
    const height = 20;
    ctx.fillStyle = this.color;
    ctx.strokeStyle = this.colorDark;
    ctx.lineWidth = 3;
    
    ctx.fillRect(this.x - width / 2, this.y - height / 2, width, height);
    ctx.strokeRect(this.x - width / 2, this.y - height / 2, width, height);
  }

  /**
   * 更新塔状态
   */
  update(deltaTime, enemies) {
    this.attackTimer -= deltaTime;
    
    if (this.attackTimer <= 0) {
      this.target = this.findTarget(enemies);
      // 保存敌人列表到 target 上，供 AOE 等攻击使用
      if (this.target) {
        this.target.enemies = enemies;
        this.attackTimer = this.attackSpeed;
        const result = this.attack(this.target);
        // 返回特效数组（兼容单个对象和数组）
        if (result && result.effect) {
          return [{ effect: result.effect, reward: result.reward || 0 }];
        }
        return result || [];
      }
    }
    
    return [];
  }
}

/**
 * 三角塔 - 直线射击
 */
class TriangleTower extends Tower {
  attack(target) {
    // 直接造成伤害
    const reward = target.takeDamage(this.damage);
    
    // 创建弹道特效
    const effect = {
      type: 'projectile',
      startX: this.x,
      startY: this.y,
      endX: target.x,
      endY: target.y,
      color: '#FFFF00',
      life: 0.3,
      maxLife: 0.3
    };
    
    return { effect, reward };
  }
}

/**
 * 圆塔 - AOE范围伤害
 */
class CircleTower extends Tower {
  attack(target) {
    const aoeRadius = TOWER_TYPES.circle.aoeRadius;
    let totalReward = 0;
    
    // 遍历所有敌人，对AOE范围内的敌人造成伤害
    const allEnemies = this.target.enemies || [];
    for (const enemy of allEnemies) {
      if (!enemy.alive) continue;
      const dx = enemy.x - this.x;
      const dy = enemy.y - this.y;
      const distance = Math.sqrt(dx * dx + dy * dy);
      
      // AOE 范围是 塔射程 + AOE额外范围
      if (distance <= this.range + aoeRadius) {
        const reward = enemy.takeDamage(this.damage);
        totalReward += reward;
      }
    }
    
    // 创建AOE特效
    const effect = {
      type: 'aoe',
      x: this.x,
      y: this.y,
      radius: aoeRadius,
      life: 0.5,
      maxLife: 0.5
    };
    
    return { effect, reward: totalReward };
  }
}

/**
 * 六边塔 - 闪电链
 */
class HexagonTower extends Tower {
  attack(target) {
    const chainCount = TOWER_TYPES.hexagon.chainCount;
    const hitTargets = new Set();
    let currentTarget = target;
    const segments = [];
    let totalReward = 0;
    
    for (let i = 0; i < chainCount && currentTarget; i++) {
      if (!currentTarget.alive || hitTargets.has(currentTarget)) break;
      
      const reward = currentTarget.takeDamage(this.damage);
      totalReward += reward;
      hitTargets.add(currentTarget);
      
      // 添加闪电段
      segments.push({
        startX: i === 0 ? this.x : (segments[i-1].endX),
        startY: i === 0 ? this.y : (segments[i-1].endY),
        endX: currentTarget.x,
        endY: currentTarget.y
      });
      
      // 寻找下一个最近的目标
      let nearest = null;
      let nearestDist = Infinity;
      for (const enemy of this.target.enemies || []) {
        if (!enemy.alive || hitTargets.has(enemy)) continue;
        const dx = enemy.x - currentTarget.x;
        const dy = enemy.y - currentTarget.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < nearestDist) {
          nearest = enemy;
          nearestDist = dist;
        }
      }
      currentTarget = nearest;
    }
    
    // 创建闪电特效
    const effect = {
      type: 'lightning',
      segments: segments,
      life: 0.4,
      maxLife: 0.4
    };
    
    return { effect, reward: totalReward };
  }
}

/**
 * 长方塔 - 蓄力炮
 */
class RectangleTower extends Tower {
  update(deltaTime, enemies) {
    if (this.isCharging) {
      this.chargeTime -= deltaTime;
      if (this.chargeTime <= 0) {
        this.isCharging = false;
        this.charged = true;
      }
      return [];
    }
    
    this.attackTimer -= deltaTime;
    if (this.attackTimer <= 0) {
      this.target = this.findTarget(enemies);
      if (this.target) {
        this.isCharging = true;
        this.chargeTime = TOWER_TYPES.rectangle.chargeTime;
        this.charged = false;
        return [];
      }
    }
    
    return [];
  }
  
  attack(target) {
    if (!this.charged) return [];
    
    const reward = target.takeDamage(this.damage);
    this.charged = false;
    this.isCharging = false;
    this.attackTimer = this.attackSpeed;
    
    return [{
      type: 'damage',
      target: target,
      damage: this.damage,
      reward: reward,
      x: this.x,
      y: this.y,
      tx: target.x,
      ty: target.y
    }];
  }
}

// 塔类型映射
const TOWER_MAP = {
  triangle: TriangleTower,
  circle: CircleTower,
  hexagon: HexagonTower,
  rectangle: RectangleTower
};

function createTower(type, x, y) {
  const Constructor = TOWER_MAP[type];
  if (!Constructor) throw new Error(`Unknown tower type: ${type}`);
  return new Constructor(type, x, y);
}

export { TOWER_TYPES, Tower, TriangleTower, CircleTower, HexagonTower, RectangleTower, createTower };
