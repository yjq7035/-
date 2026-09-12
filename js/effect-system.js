/**
 * 特效系统 - 整合版
 * 包含：弹道、闪电、AOE、爆炸等视觉效果及其管理器
 */

/**
 * 特效基类
 */
class Effect {
  constructor(type) {
    this.type = type;
    this.life = 0;
    this.maxLife = 0;
  }

  update(deltaTime) {
    this.life -= deltaTime;
    return this.life > 0;
  }

  draw(ctx) {}
}

/**
 * 弹道特效
 */
class ProjectileEffect extends Effect {
  constructor(startX, startY, endX, endY, color = '#FFFF00') {
    super('projectile');
    this.startX = startX;
    this.startY = startY;
    this.endX = endX;
    this.endY = endY;
    this.color = color;
    this.life = 0.3;
    this.maxLife = 0.3;
  }

  draw(ctx) {
    const progress = 1 - this.life / this.maxLife;
    const x = this.startX + (this.endX - this.startX) * progress;
    const y = this.startY + (this.endY - this.startY) * progress;

    ctx.fillStyle = this.color;
    ctx.shadowColor = this.color;
    ctx.shadowBlur = 10;
    ctx.beginPath();
    ctx.arc(x, y, 5, 0, Math.PI * 2);
    ctx.fill();
  }
}

/**
 * 闪电特效
 */
class LightningEffect extends Effect {
  constructor(segments) {
    super('lightning');
    this.segments = segments;
    this.life = 0.4;
    this.maxLife = 0.4;
  }

  draw(ctx) {
    const alpha = this.life / this.maxLife;
    ctx.strokeStyle = `rgba(100, 200, 255, ${alpha})`;
    ctx.lineWidth = 3;
    ctx.shadowColor = '#64C8FF';
    ctx.shadowBlur = 15;

    for (const segment of this.segments) {
      ctx.beginPath();
      ctx.moveTo(segment.startX, segment.startY);

      const dx = segment.endX - segment.startX;
      const dy = segment.endY - segment.startY;
      const midX = segment.startX + dx * 0.5 + (Math.random() - 0.5) * 20;
      const midY = segment.startY + dy * 0.5 + (Math.random() - 0.5) * 20;
      ctx.quadraticCurveTo(midX, midY, segment.endX, segment.endY);
      ctx.stroke();
    }
  }
}

/**
 * AOE 范围特效
 */
class AOEEffect extends Effect {
  constructor(x, y, radius) {
    super('aoe');
    this.x = x;
    this.y = y;
    this.radius = radius;
    this.life = 0.5;
    this.maxLife = 0.5;
  }

  draw(ctx) {
    const progress = 1 - this.life / this.maxLife;
    const radius = this.radius * progress;
    const alpha = (1 - progress) * 0.8;

    ctx.fillStyle = `rgba(100, 100, 255, ${alpha * 0.3})`;
    ctx.strokeStyle = `rgba(100, 150, 255, ${alpha})`;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(this.x, this.y, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }
}

/**
 * 爆炸特效
 */
class ExplosionEffect extends Effect {
  constructor(x, y, radius) {
    super('explosion');
    this.x = x;
    this.y = y;
    this.radius = radius;
    this.life = 0.6;
    this.maxLife = 0.6;
  }

  draw(ctx) {
    const progress = 1 - this.life / this.maxLife;
    const radius = this.radius * progress;
    const alpha = (1 - progress) * 0.9;

    const gradient = ctx.createRadialGradient(this.x, this.y, 0, this.x, this.y, radius);
    gradient.addColorStop(0, `rgba(255, 255, 200, ${alpha})`);
    gradient.addColorStop(0.5, `rgba(255, 150, 50, ${alpha * 0.7})`);
    gradient.addColorStop(1, `rgba(255, 50, 50, 0)`);

    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(this.x, this.y, radius, 0, Math.PI * 2);
    ctx.fill();
  }
}

/**
 * 特效管理器
 */
class EffectManager {
  constructor() {
    this.effects = [];
  }

  addEffect(effect) {
    if (Array.isArray(effect)) {
      this.effects.push(...effect);
    } else {
      this.effects.push(effect);
    }
  }

  update(deltaTime) {
    for (let i = this.effects.length - 1; i >= 0; i--) {
      if (!this.effects[i].update(deltaTime)) {
        this.effects.splice(i, 1);
      }
    }
  }

  draw(ctx) {
    for (const effect of this.effects) {
      ctx.save();
      effect.draw(ctx);
      ctx.restore();
    }
  }

  clear() {
    this.effects = [];
  }

  getEffects() {
    return this.effects;
  }
}

// 工厂函数：创建弹道特效
function createProjectileEffect(startX, startY, endX, endY, color) {
  return new ProjectileEffect(startX, startY, endX, endY, color);
}

// 工厂函数：创建闪电特效
function createLightningEffect(segments) {
  return new LightningEffect(segments);
}

// 工厂函数：创建 AOE 特效
function createAOEEffect(x, y, radius) {
  return new AOEEffect(x, y, radius);
}

// 工厂函数：创建爆炸特效
function createExplosionEffect(x, y, radius) {
  return new ExplosionEffect(x, y, radius);
}

export {
  Effect,
  ProjectileEffect,
  LightningEffect,
  AOEEffect,
  ExplosionEffect,
  EffectManager,
  createProjectileEffect,
  createLightningEffect,
  createAOEEffect,
  createExplosionEffect
};
