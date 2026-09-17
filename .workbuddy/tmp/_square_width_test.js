const fs = require("fs");
const t = require("F:/图形塔防/src/tower.js");
const lines = [];
const mk = (lv) => {
  const tw = { type: "square", enhanceLevel: lv };
  tw.enhanceAttrs = t.applyEnhanceAttrs(tw);
  return tw;
};
for (const lv of [0, 1, 3]) {
  const tw = mk(lv);
  const scale = t.getProjectileScale(tw);
  const size = t.getProjectileSize(tw);
  lines.push("Lv" + lv + ": scale=" + scale.toFixed(2) + "  drawW=" + (size * 0.8).toFixed(1) + "  hitW=" + (size * 0.6).toFixed(1) + "  rangeMult=" + scale.toFixed(2));
}
fs.writeFileSync("F:/图形塔防/.workbuddy/tmp/_square_width_out.txt", lines.join("\n") + "\n");
