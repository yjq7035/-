/**
 * 怪物系统
 */

// 怪物类型配置
const ENEMY_TYPES = {
  normal: {
    name: '普通怪',
    hp: 100,
    speed: 15,
    color: '#808080',
    reward: 10,
    radius: 15,
    scorePenalty: 1
  },
  fast: {
    name: '快速怪',
    hp: 50,
    speed: 25,
    color: '#FF8C00',
    reward: 15,
    radius: 12,
    scorePenalty: 1
  },
  elite: {
    name: '精英怪',
    hp: 300,
    speed: 8,
    color: '#9B59B6',
    reward: 30,
    radius: 18,
    scorePenalty: 5
  },
  heavy: {
    name: '重装怪',
    hp: 500,
    speed: 7.5,
    color: '#555555',
    reward: 50,
    radius: 20,
    scorePenalty: 1
  },
  boss: {
    name: 'Boss怪',
    hp: 2000,
    speed: 7,
    color: '#FF0000',
    reward: 200,
    radius: 25,
    scorePenalty: 20
  },
  finalBoss: {
    name: '最终Boss',
    hp: 5000,
    speed: 10,
    color: '#8B0000',
    reward: 500,
    radius: 30,
    scorePenalty: 50
  }
};

class Enemy {
  constructor(type, path) {
    const config = ENEMY_TYPES[type];
    if (!config) throw new Error(`Unknown enemy type: ${type}`);
    
    this.type = type;
    this.maxHp = config.hp;
    this.hp = config.hp;
    this.speed = config.speed;
    this.color = config.color;
    this.reward = config.reward;
    this.radius = config.radius;
    this.scorePenalty = config.scorePenalty || 1;
    
    this.path = path;
    this.progress = 0; // 0~1，路径进度
    this.alive = true;
    
    // 初始位置
    const pos = path.getPosition(0);
    this.x = pos.x;
    this.y = pos.y;
  }

  /**
   * 更新怪物位置
   * @param {number} deltaTime - 秒
   */
  update(deltaTime) {
    if (!this.alive) return;
    
    // 根据速度更新进度
    const pathLength = this.path.getTotalLength();
    const speedPerPixel = this.speed / pathLength;
    this.progress += speedPerPixel * deltaTime;
    
    if (this.progress >= 1) {
      // 到达终点
      this.alive = false;
      return 'reachedEnd';
    }
    
    // 更新位置
    const pos = this.path.getPosition(this.progress);
    this.x = pos.x;
    this.y = pos.y;
    
    return null;
  }

  /**
   * 受到伤害
   */
  takeDamage(damage) {
    this.hp -= damage;
    if (this.hp <= 0) {
      this.hp = 0;
      this.alive = false;
      return this.reward;
    }
    return 0;
  }

  /**
   * 绘制怪物
   */
  draw(ctx) {
    if (!this.alive) return;
    
    ctx.save();
    
    // 如果是逃亡状态，绘制特殊标记
    if (this.isEscaping) {
      // 绘制半透明效果
      ctx.globalAlpha = 0.5;
      
      // 绘制红色边框表示正在逃亡
      ctx.strokeStyle = '#FF0000';
      ctx.lineWidth = 3;
      ctx.setLineDash([5, 5]);
      ctx.beginPath();
      ctx.arc(this.x, this.y, this.radius + 5, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
      
      // 绘制"逃亡"文字
      ctx.globalAlpha = 0.8;
      ctx.fillStyle = '#FF0000';
      ctx.font = 'bold 12px Arial';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('逃亡', this.x, this.y);
    }
    
    // 绘制怪物主体
    ctx.fillStyle = this.color;
    ctx.beginPath();
    ctx.arc(this.x, this.y, this.radius, 0, Math.PI * 2);
    ctx.fill();
    
    // 绘制边框
    ctx.strokeStyle = '#000000';
    ctx.lineWidth = 2;
    ctx.stroke();
    
    // 绘制血条
    const barWidth = this.radius * 2;
    const barHeight = 4;
    const barX = this.x - barWidth / 2;
    const barY = this.y - this.radius - 8;
    
    // 血条背景
    ctx.fillStyle = '#333333';
    ctx.fillRect(barX, barY, barWidth, barHeight);
    
    // 血条前景
    const hpRatio = this.hp / this.maxHp;
    ctx.fillStyle = hpRatio > 0.5 ? '#00FF00' : hpRatio > 0.25 ? '#FFFF00' : '#FF0000';
    ctx.fillRect(barX, barY, barWidth * hpRatio, barHeight);
    
    ctx.restore();
  }
}

export { ENEMY_TYPES, Enemy };
