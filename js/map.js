/**
 * 地图和槽位系统
 */

class MapSystem {
  constructor(mapX, mapY, mapWidth, mapHeight) {
    this.mapX = mapX;
    this.mapY = mapY;
    this.mapWidth = mapWidth;
    this.mapHeight = mapHeight;
    this.slots = this.calculateSlots();
  }

  calculateSlots() {
    const slotSize = 60;
    const gap = 20;
    const totalWidth = 4 * slotSize + 3 * gap;
    const startX = this.mapX + (this.mapWidth - totalWidth) / 2;
    const rows = 2;
    const rowHeight = slotSize + gap;
    const startY = this.mapY + this.mapHeight - rowHeight * rows - 20;

    const slots = [];
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < 4; col++) {
        slots.push({
          x: startX + col * (slotSize + gap),
          y: startY + row * rowHeight,
          size: slotSize,
          occupied: false,
          tower: null
        });
      }
    }

    return slots;
  }

  /**
   * 绘制槽位
   */
  drawSlots(ctx, selectedTowerType) {
    for (const slot of this.slots) {
      ctx.fillStyle = slot.occupied ? 'rgba(255, 255, 255, 0.1)' : 'rgba(255, 255, 255, 0.05)';
      ctx.strokeStyle = selectedTowerType ? 'rgba(255, 255, 100, 0.5)' : 'rgba(255, 255, 255, 0.2)';
      ctx.lineWidth = 2;

      ctx.fillRect(slot.x, slot.y, slot.size, slot.size);
      ctx.strokeRect(slot.x, slot.y, slot.size, slot.size);
    }
  }

  /**
   * 检查位置是否在某个空槽位内
   */
  findEmptySlotAt(pos) {
    for (const slot of this.slots) {
      if (!slot.occupied &&
          pos.x >= slot.x && pos.x <= slot.x + slot.size &&
          pos.y >= slot.y && pos.y <= slot.y + slot.size) {
        return slot;
      }
    }
    return null;
  }

  /**
   * 检查位置是否在任何槽位内
   */
  findSlotAt(pos) {
    for (const slot of this.slots) {
      if (pos.x >= slot.x && pos.x <= slot.x + slot.size &&
          pos.y >= slot.y && pos.y <= slot.y + slot.size) {
        return slot;
      }
    }
    return null;
  }

  /**
   * 获取所有空槽位
   */
  getEmptySlots() {
    return this.slots.filter(s => !s.occupied);
  }

  /**
   * 清空所有槽位（重置用）
   */
  resetSlots() {
    for (const slot of this.slots) {
      slot.occupied = false;
      slot.tower = null;
    }
  }
}

export { MapSystem };
