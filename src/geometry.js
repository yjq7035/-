// 路径几何纯函数：不依赖游戏实例，接收 pathPoints 参数。
// 从原 Game.getPathLength / getPathPosition 抽离。

// ==================== 锚点定位工具 ====================
// 通用相对定位，返回目标矩形上指定锚点的像素坐标（可加偏移）。
// rect 形如 {x, y, w, h}。anchor 支持命名锚点或归一化比例。

const ANCHORS = {
  topLeft: { x: 0, y: 0 },
  top: { x: 0.5, y: 0 },
  topRight: { x: 1, y: 0 },
  left: { x: 0, y: 0.5 },
  center: { x: 0.5, y: 0.5 },
  right: { x: 1, y: 0.5 },
  bottomLeft: { x: 0, y: 1 },
  bottom: { x: 0.5, y: 1 },
  bottomRight: { x: 1, y: 1 },
};

/**
 * 将锚点解析为归一化比例 {x, y}（0~1）。
 * 支持命名锚点（'topLeft'/'center'/'bottom'...）或 {x, y}，非法时回退 center。
 */
function normalizeAnchor(anchor) {
  if (typeof anchor === 'string') return ANCHORS[anchor] || { x: 0.5, y: 0.5 };
  if (anchor && typeof anchor.x === 'number' && typeof anchor.y === 'number') {
    return anchor;
  }
  return { x: 0.5, y: 0.5 };
}

/**
 * 返回目标矩形上某锚点的像素坐标（含可选偏移 offset: {x, y}）。
 * @param {object} rect 目标矩形 {x, y, w, h}
 * @param {string|object} anchor 命名锚点或归一化比例
 * @param {object} [offset] 在锚点基础上的额外像素偏移 {x, y}
 * @returns {{x: number, y: number}}
 *
 * 例如星星顶部相对槽位顶部：anchorPointOf(slot, 'top', {y: -12}) → 槽位顶边上方12px。
 * 文字/图标对齐请结合 ctx.textBaseline 使用：
 *   - 子元素顶边对目标顶边：textBaseline='top'，取 anchor='top'
 *   - 子元素底边对目标底边：textBaseline='bottom'，取 anchor='bottom'
 */
function anchorPointOf(rect, anchor, offset) {
  const a = normalizeAnchor(anchor);
  const o = offset || { x: 0, y: 0 };
  // 兼容矩形 {x,y,w,h} 与方块 {x,y,size}（如槽位）
  const w = (rect.w !== undefined && rect.w !== null) ? rect.w : rect.size;
  const h = (rect.h !== undefined && rect.h !== null) ? rect.h : rect.size;
  return {
    x: rect.x + (w || 0) * a.x + (o.x || 0),
    y: rect.y + (h || 0) * a.y + (o.y || 0),
  };
}

// ==================== 路径几何 ====================

function getPathLength(pathPoints) {
  let total = 0;
  for (let i = 1; i < pathPoints.length; i++) {
    const dx = pathPoints[i].x - pathPoints[i - 1].x;
    const dy = pathPoints[i].y - pathPoints[i - 1].y;
    total += Math.sqrt(dx * dx + dy * dy);
  }
  return total;
}

function getPathPosition(pathPoints, progress) {
  if (progress <= 0) return pathPoints[0];
  if (progress >= 1) return pathPoints[pathPoints.length - 1];

  const totalLength = getPathLength(pathPoints);
  const targetDistance = progress * totalLength;
  let accumulatedDistance = 0;

  for (let i = 1; i < pathPoints.length; i++) {
    const prev = pathPoints[i - 1];
    const curr = pathPoints[i];
    const segmentLength = Math.sqrt(
      (curr.x - prev.x) ** 2 + (curr.y - prev.y) ** 2
    );

    if (accumulatedDistance + segmentLength >= targetDistance) {
      const t = (targetDistance - accumulatedDistance) / segmentLength;
      return {
        x: prev.x + (curr.x - prev.x) * t,
        y: prev.y + (curr.y - prev.y) * t,
      };
    }
    accumulatedDistance += segmentLength;
  }

  return pathPoints[pathPoints.length - 1];
}

module.exports = { getPathLength, getPathPosition, anchorPointOf, normalizeAnchor };
