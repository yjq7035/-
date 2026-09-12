/**
 * 波次管理系统
 */

class WaveManager {
  constructor() {
    this.currentWave = 0;
    this.waveInProgress = false;
    this.waveComplete = false;
    this.waitTimer = 0;
    this.waitDuration = 3; // 波次间隔3秒
    this.spawnTimer = 0;
    this.enemiesToSpawn = [];
    this.enemiesSpawned = 0;
    // 商店塔的顺序（默认为默认顺序）
    this._shopTowerTypes = ['triangle', 'circle', 'hexagon', 'rectangle'];
  }

  /**
   * 设置商店塔的显示顺序
   */
  setShopTowerTypes(types) {
    this._shopTowerTypes = types;
  }

  /**
   * 获取当前商店塔的显示顺序
   */
  getShopTowerTypes() {
    return this._shopTowerTypes;
  }

  /**
   * 随机打乱商店塔的显示顺序
   */
  shuffleShop() {
    // 使用默认塔类型顺序打乱
    const defaultTypes = ['triangle', 'circle', 'hexagon', 'rectangle'];
    const arr = [...defaultTypes];
    // Fisher-Yates shuffle
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    this._shopTowerTypes = arr;
  }

  /**
   * 生成下一波的怪物列表
   */
  generateWave(waveNumber) {
    const enemies = [];
    
    // 基础：每波5 + 2*(波数-1)个普通怪
    const normalCount = 5 + 2 * (waveNumber - 1);
    for (let i = 0; i < normalCount; i++) {
      enemies.push('normal');
    }
    
    // 每3波出现1个快速怪
    if (waveNumber % 3 === 0) {
      enemies.push('fast');
    }
    
    // 每5波出现1个精英怪
    if (waveNumber % 5 === 0) {
      enemies.push('elite');
    }
    
    // 每7波出现1个重装怪
    if (waveNumber % 7 === 0) {
      enemies.push('heavy');
    }
    
    // 每10波出现1个Boss怪
    if (waveNumber % 10 === 0) {
      enemies.push('boss');
    }
    
    // 每20波出现1个最终Boss
    if (waveNumber % 20 === 0) {
      enemies.push('finalBoss');
    }
    
    // 打乱顺序（随机出现）
    for (let i = enemies.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [enemies[i], enemies[j]] = [enemies[j], enemies[i]];
    }
    
    return enemies;
  }

  /**
   * 开始下一波
   */
  startNextWave() {
    this.currentWave++;
    this.enemiesToSpawn = this.generateWave(this.currentWave);
    this.enemiesSpawned = 0;
    this.spawnTimer = 0;
    this.waveInProgress = true;
    this.waveComplete = false;
    
    console.log(`第 ${this.currentWave} 波开始！`);
    return this.currentWave;
  }

  /**
   * 更新波次管理
   * @param {number} deltaTime - 秒
   * @param {function} spawnCallback - 生成怪物的回调
   */
  update(deltaTime, spawnCallback) {
    if (!this.waveInProgress) {
      this.waitTimer -= deltaTime;
      if (this.waitTimer <= 0) {
        this.startNextWave();
      }
      return null;
    }
    
    if (this.enemiesToSpawn.length === 0) {
      this.waveInProgress = false;
      this.waveComplete = true;
      this.waitTimer = this.waitDuration;
      console.log(`第 ${this.currentWave} 波完成！`);
      return 'waveComplete';
    }
    
    this.spawnTimer -= deltaTime;
    if (this.spawnTimer <= 0) {
      const type = this.enemiesToSpawn.shift();
      this.enemiesSpawned++;
      this.spawnTimer = 1.0; // 每1秒生成一个怪物
      
      const enemy = spawnCallback(type);
      return enemy;
    }
    
    return null;
  }

  /**
   * 检查波次是否完成
   */
  isWaveComplete() {
    return this.waveComplete;
  }

  /**
   * 重置
   */
  reset() {
    this.currentWave = 0;
    this.waveInProgress = false;
    this.waveComplete = false;
    this.waitTimer = 0;
    this.spawnTimer = 0;
    this.enemiesToSpawn = [];
    this.enemiesSpawned = 0;
  }
}

export { WaveManager };
