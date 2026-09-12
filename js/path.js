/**
 * H 型路径定义
 * 路径: 起点(左下) → 向上 → 向右 → 向下 → 向右 → 向下 → 终点(右下)
 */
class Path {
  constructor(mapX, mapY, mapWidth, mapHeight) {
    this.mapX = mapX;
    this.mapY = mapY;
    this.mapWidth = mapWidth;
    this.mapHeight = mapHeight;
    
    // 计算路径点
    this.points = this._calculatePath();
  }

  _calculatePath() {
    const { mapX, mapY, mapWidth, mapHeight } = this;
    const verticalWidth = 40; // 路径宽度
    const horizontalHeight = 40; // 横向路径高度
    
    // H 型路径的关键点
    const startX = mapX + verticalWidth / 2; // 左侧起点
    const startY = mapY + mapHeight - verticalWidth / 2; // 底部
    
    // 路径点数组（从起点到终点）
    const points = [
      // 第1段：从左下角向上
      { x: startX, y: startY },
      { x: startX, y: mapY + horizontalHeight / 2 },
      
      // 第2段：向右到中间
      { x: mapX + mapWidth / 2, y: mapY + horizontalHeight / 2 },
      
      // 第3段：向下
      { x: mapX + mapWidth / 2, y: mapY + mapHeight - horizontalHeight / 2 },
      
      // 第4段：向右到右侧
      { x: mapX + mapWidth - verticalWidth / 2, y: mapY + mapHeight - horizontalHeight / 2 },
      
      // 第5段：向下到终点
      { x: mapX + mapWidth - verticalWidth / 2, y: mapY + mapHeight - verticalWidth / 2 }
    ];
    
    return points;
  }

  /**
   * 获取路径总长度
   */
  getTotalLength() {
    let total = 0;
    for (let i = 1; i < this.points.length; i++) {
      const dx = this.points[i].x - this.points[i - 1].x;
      const dy = this.points[i].y - this.points[i - 1].y;
      total += Math.sqrt(dx * dx + dy * dy);
    }
    return total;
  }

  /**
   * 根据进度获取路径上的位置
   * @param {number} progress - 0~1 之间的进度值
   * @returns {{x: number, y: number}}
   */
  getPosition(progress) {
    if (progress <= 0) return this.points[0];
    if (progress >= 1) return this.points[this.points.length - 1];
    
    const totalLength = this.getTotalLength();
    const targetDistance = progress * totalLength;
    
    let accumulatedDistance = 0;
    for (let i = 1; i < this.points.length; i++) {
      const prev = this.points[i - 1];
      const curr = this.points[i];
      const segmentLength = Math.sqrt(
        (curr.x - prev.x) ** 2 + (curr.y - prev.y) ** 2
      );
      
      if (accumulatedDistance + segmentLength >= targetDistance) {
        const t = (targetDistance - accumulatedDistance) / segmentLength;
        return {
          x: prev.x + (curr.x - prev.x) * t,
          y: prev.y + (curr.y - prev.y) * t
        };
      }
      
      accumulatedDistance += segmentLength;
    }
    
    return this.points[this.points.length - 1];
  }

  /**
   * 绘制路径
   * @param {CanvasRenderingContext2D} ctx 
   */
  draw(ctx) {
    ctx.save();
    ctx.strokeStyle = '#666666';
    ctx.lineWidth = 40;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(this.points[0].x, this.points[0].y);
    for (let i = 1; i < this.points.length; i++) {
      ctx.lineTo(this.points[i].x, this.points[i].y);
    }
    ctx.stroke();
    
    // 绘制路径边框
    ctx.strokeStyle = '#444444';
    ctx.lineWidth = 42;
    ctx.beginPath();
    ctx.moveTo(this.points[0].x, this.points[0].y);
    for (let i = 1; i < this.points.length; i++) {
      ctx.lineTo(this.points[i].x, this.points[i].y);
    }
    ctx.stroke();
    
    // 重绘路径（覆盖中间部分）
    ctx.strokeStyle = '#888888';
    ctx.lineWidth = 40;
    ctx.beginPath();
    ctx.moveTo(this.points[0].x, this.points[0].y);
    for (let i = 1; i < this.points.length; i++) {
      ctx.lineTo(this.points[i].x, this.points[i].y);
    }
    ctx.stroke();
    
    ctx.restore();
  }
}

export { Path };
