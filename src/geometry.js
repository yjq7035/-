// 路径几何纯函数：不依赖游戏实例，接收 pathPoints 参数。
// 从原 Game.getPathLength / getPathPosition 抽离。

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

module.exports = { getPathLength, getPathPosition };
