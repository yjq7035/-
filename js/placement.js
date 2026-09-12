/**
 * 拖放和放置系统
 */
import { TOWER_TYPES } from './tower.js';

class PlacementSystem {
  constructor(slots, getGold, canAfford) {
    this.slots = slots;
    this.getGold = getGold;
    this.canAfford = canAfford;
    this.canvas = null;
    this.dragging = false;
    this.dragType = null;
    this.dragX = 0;
    this.dragY = 0;
  }

  handleMouseDown(towerTypes, pos, canvas) {
    this.canvas = canvas;
    const slotWidth = 120;
    const slotHeight = 70;
    const gap = 15;
    const totalWidth = towerTypes.length * slotWidth + (towerTypes.length - 1) * gap;
    const startX = (canvas.width - totalWidth) / 2;
    const startY = canvas.height - 90;

    for (let i = 0; i < towerTypes.length; i++) {
      const type = towerTypes[i];
      const x = startX + i * (slotWidth + gap);

      if (pos.x >= x && pos.x <= x + slotWidth &&
          pos.y >= startY && pos.y <= startY + slotHeight) {
        const cost = TOWER_TYPES[type].cost;
        if (this.getGold() >= cost) {
          this.dragging = true;
          this.dragType = type;
          this.dragX = pos.x;
          this.dragY = pos.y;
        }
        return true;
      }
    }
    return false;
  }

  handleMouseMove(pos) {
    if (this.dragging) {
      this.dragX = pos.x;
      this.dragY = pos.y;
    }
  }

  handleMouseUp(canvas, pos, onPlaceTower) {
    if (!this.dragging) return false;

    for (const slot of this.slots) {
      if (!slot.occupied &&
          pos.x >= slot.x && pos.x <= slot.x + slot.size &&
          pos.y >= slot.y && pos.y <= slot.y + slot.size) {

        const cost = TOWER_TYPES[this.dragType].cost;
        if (this.getGold() >= cost) {
          const tower = onPlaceTower(this.dragType, slot.x + slot.size / 2, slot.y + slot.size / 2);
          slot.occupied = true;
          slot.tower = tower;
          return true;
        }
      }
    }

    this.dragging = false;
    this.dragType = null;
    return false;
  }

  drawDragPreview(ctx) {
    if (!this.dragging || !this.dragType) return;

    const config = TOWER_TYPES[this.dragType];
    const cost = config.cost;
    const canAfford = this.getGold() >= cost;

    ctx.save();
    ctx.globalAlpha = canAfford ? 0.7 : 0.5;

    if (!canAfford) {
      ctx.fillStyle = '#FF4444';
    } else {
      ctx.fillStyle = config.color;
    }
    ctx.strokeStyle = '#FFFFFF';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(this.dragX, this.dragY, 25, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // 显示金币状态
    ctx.fillStyle = canAfford ? '#44FF44' : '#FF4444';
    ctx.font = 'bold 12px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText(canAfford ? '✅ 可放置' : '❌ 金币不足', this.dragX, this.dragY + 30);

    ctx.restore();

    // 显示可放置提示
    let canPlace = false;
    for (const slot of this.slots) {
      if (!slot.occupied &&
          this.dragX >= slot.x && this.dragX <= slot.x + slot.size &&
          this.dragY >= slot.y && this.dragY <= slot.y + slot.size) {
        canPlace = true;
        break;
      }
    }

    // 绘制放置范围高亮
    const canActuallyPlace = canPlace && canAfford;
    ctx.strokeStyle = canActuallyPlace ? 'rgba(100, 255, 100, 0.8)' : 'rgba(255, 100, 100, 0.5)';
    ctx.lineWidth = 3;
    ctx.setLineDash([5, 5]);
    ctx.strokeRect(this.dragX - 30, this.dragY - 30, 60, 60);
    ctx.setLineDash([]);
  }

  isDragging() {
    return this.dragging;
  }

  getDragType() {
    return this.dragType;
  }

  cancelDrag() {
    this.dragging = false;
    this.dragType = null;
  }
}

export { PlacementSystem };
