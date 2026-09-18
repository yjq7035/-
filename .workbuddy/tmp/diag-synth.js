// 诊断：⑦ 节「点开始合成没反应」最小复现 —— 只打日志，不断言
const path = require('path');
const fs = require('fs');
const { makeCtx, makeRec } = require(path.join(__dirname, '..', 'tools', 'harness'));

global.document = { addEventListener() {}, removeEventListener() {} };
global.requestAnimationFrame = () => 0;

const ROOT = path.resolve(__dirname, '..', '..');
const out = [];
const log = (s) => { out.push(String(s)); };

const Game = require(path.join(ROOT, 'src', 'game_core'));
const meta = require(path.join(ROOT, 'src', 'meta'));
const bag = require(path.join(ROOT, 'src', 'bag'));
const input = require(path.join(ROOT, 'src', 'input'));
const gemModal = require(path.join(ROOT, 'src', 'gemModal'));

const rec = makeRec();
const ctx = makeCtx(rec);
function mkGame(W, H) {
  const canvas = { width: W, height: H, addEventListener() {}, removeEventListener() {}, getContext() { return ctx; } };
  return new Game(canvas, ctx, { screenWidth: W, screenHeight: H, renderScale: 1 });
}
function tapAt(g, x, y, tag) {
  const ev = { touches: [{ clientX: x, clientY: y, x, y }], changedTouches: [{ clientX: x, clientY: y, x, y }] };
  input.handleTouchStart(g, ev);
  log(`  [tap:${tag}] start(${x.toFixed(1)},${y.toFixed(1)}) touch=${JSON.stringify(g._gemModalTouch)}`);
  input.handleTouchEnd(g, ev);
  log(`  [tap:${tag}] end`);
}

meta.resetAll();
meta.addGemsByKind('ruby', 5);
meta.addGemsByKind('sapphire', 2);
const g = mkGame(390, 844);
g.scene = 'bag';

const BL = bag.getBagLayout(g);
const cell = BL.cells.filter((c) => c.unlocked && c.item && c.item.kind === 'ruby')[0];
tapAt(g, cell.x + cell.w / 2, cell.y + cell.h / 2, 'cell');
log('gemInfo=' + JSON.stringify(g.gemInfo));

const il = gemModal.getGemInfoLayout(g);
log('infoLayout.synthBtn=' + JSON.stringify(il && il.synthBtn));
tapAt(g, il.synthBtn.x + il.synthBtn.w / 2, il.synthBtn.y + il.synthBtn.h / 2, 'synthBtn');
log('gemSynth.picked=' + JSON.stringify(g.gemSynth && Object.keys(g.gemSynth.picked)) + ' gemInfo=' + JSON.stringify(g.gemInfo));

const SL = gemModal.getSynthLayout(g);
log(`SL bodyTop=${SL.bodyTop} bodyH=${SL.bodyH} maxScroll=${SL.maxScroll} goBtn=${JSON.stringify(SL.goBtn)}`);
const more = SL.rows.filter((r) => r.selectable && !r.selected && r.kind === 'ruby' && r.visible).slice(0, 2);
for (const row of more) {
  log(`  row ${row.uid} ${row.name} rect=${JSON.stringify(row.rect)}`);
  tapAt(g, row.rect.x + row.rect.w / 2, row.rect.y + row.rect.h / 2, 'row-' + row.uid);
}
const SL2 = gemModal.getSynthLayout(g);
log(`SL2 count=${SL2.count} canGo=${SL2.canGo} rate=${SL2.rate} goBtn=${JSON.stringify(SL2.goBtn)}`);

meta.addGem('sapphire', 2);
const SL3 = gemModal.getSynthLayout(g);
const lv2Row = SL3.rows.filter((r) => r.kind === 'sapphire' && r.lv === 2)[0];
log(`lv2Row visible=${lv2Row.visible} selectable=${lv2Row.selectable} rect=${JSON.stringify(lv2Row.rect)}`);
tapAt(g, lv2Row.rect.x + lv2Row.rect.w / 2, lv2Row.rect.y + lv2Row.rect.h / 2, 'lv2row');
log('after lv2 tap: picked=' + JSON.stringify(Object.keys(g.gemSynth.picked)) + ' touch=' + JSON.stringify(g._gemModalTouch));

const SLNow = gemModal.getSynthLayout(g);
log(`SLNow goBtn=${JSON.stringify(SLNow.goBtn)} canGo=${SLNow.canGo}`);
const hitNow = gemModal.hitSynth(g, { x: SL2.goBtn.x + SL2.goBtn.w / 2, y: SL2.goBtn.y + SL2.goBtn.h / 2 });
log('hitSynth@SL2.goBtn center = ' + JSON.stringify(hitNow));

const randomBack = Math.random;
const bagBefore = meta.gemList().length;
Math.random = () => 0;
tapAt(g, SL2.goBtn.x + SL2.goBtn.w / 2, SL2.goBtn.y + SL2.goBtn.h / 2, 'go');
Math.random = randomBack;
log('after go: gemSynth=' + JSON.stringify(g.gemSynth && Object.keys(g.gemSynth.picked)) + ' bag ' + bagBefore + '->' + meta.gemList().length);

fs.writeFileSync(path.join(__dirname, 'diag-synth.txt'), out.join('\n'), 'utf8');
console.log(out.join('\n'));
