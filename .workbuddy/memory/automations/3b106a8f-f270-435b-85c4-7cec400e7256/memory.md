# 自动化执行记录：弹道大小减小50%

- 2026-09-16 首次执行：成功。
  - `src/renderer.js` drawProjectiles 中 `const size = 6` → `3`（所有形状弹道的视觉大小减半，圆形/扇形等派生尺寸自动缩小）。
  - `src/game_core.js` fireSquareProjectile 中正方塔弹道 `size: 20` → `10`（命中判定半径减半）。
  - 未改动爆炸半径（explosion radius）和敌人尺寸，仅涉及弹道本体大小。
