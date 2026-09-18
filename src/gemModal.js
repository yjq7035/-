// ============================================================================
// 宝石浮层 —— src/gemModal.js
// ----------------------------------------------------------------------------
// 三层模态浮层（自下而上）：嵌入列表 → 宝石详情 → 合成，图签与背包两个场景共用。
//
//   · game.gemPicker —— 「嵌入宝石」列表（图签点空槽弹出）。
//     点宝石行【不再直接嵌入】：弹出宝石详情浮层，由玩家决定 合成 / 嵌入（需求 2026-09-18）。
//   · game.gemInfo   —— 宝石详情浮层。底部按钮按来源变化：
//       图签（正在选宝石嵌入）→ [合成宝石] [嵌入宝石] 两颗
//       背包（点背包里的宝石）→ [合成宝石] 一颗
//   · game.gemSynth  —— 合成浮层：拉出背包宝石列表多选，
//       3 颗同级起、基础成功率 50%、每多 1 颗 +10%（封顶 100%）；
//       成功 → 获得所选材料范围内随机一种 +1 级；失败 → 材料消耗（浮层上写明）。
//
// 约定（与图签面板/选宝石浮层同一套规矩）：
//   · 布局纯函数与命中检测共用同一份几何 —— "画在哪" = "点在哪"；
//   · 模态浮层必须能退出（取消 / ✕ / 点浮层外）；
//   · 被滚动裁掉的行不可点。
// ============================================================================

const { LAYOUT, GEM, TOWER_DEFS } = require('./config');
const theme = require('./theme');
const meta = require('./meta');
const gems = require('./gems');

const { THEME, roundRectPath, drawButton, drawScrollBar, drawScrollHint, ellipsize } = theme;

// ==================== 公共助手 ====================

/** 背包宝石排序：种类表顺序 → 等级升序 → uid（三处浮层共用同一份顺序） */
function sortedBagGems() {
  const order = {};
  gems.GEM_ORDER.forEach((k, i) => { order[k] = i; });
  return meta.gemList().slice().sort((a, b) => {
    const d = (order[a.kind] !== undefined ? order[a.kind] : 99)
      - (order[b.kind] !== undefined ? order[b.kind] : 99);
    if (d !== 0) return d;
    if (a.lv !== b.lv) return a.lv - b.lv;
    return a.uid < b.uid ? -1 : 1;
  });
}

/** 挑出"第一颗被选中"的宝石等级（同级约束的锚点；没选返回 null） */
function pickedAnchorLv(list, picked) {
  for (const g of list) {
    if (picked[g.uid]) return g.lv || 1;
  }
  return null;
}

/** 合成规则的固定文案（数值取自 config，浮层与详情共用） */
function synthRuleLines() {
  const s = GEM.synth;
  return [
    `${s.minCount} 颗同级起 · 基础成功率 ${s.baseRate}%`,
    `每多 1 颗 +${s.perExtra}% · 成功获得随机一种 +1 级`,
  ];
}

/** 遮罩 + 面板底（三张浮层共用的外观） */
function drawModalPanel(ctx, x, y, w, h, strokeColor) {
  const bg = ctx.createLinearGradient(0, y, 0, y + h);
  bg.addColorStop(0, 'rgba(20, 20, 36, 0.99)');
  bg.addColorStop(1, 'rgba(10, 10, 20, 1)');
  ctx.fillStyle = bg;
  ctx.strokeStyle = strokeColor || 'rgba(179, 136, 255, 0.55)';
  ctx.lineWidth = 1.4;
  roundRectPath(ctx, x, y, w, h, THEME.radius.large);
  ctx.fill();
  ctx.stroke();
}

// ==================== ① 嵌入列表（原图签"选宝石浮层"，改为逐颗 + 详情中转） ====================

const PICKER_UI = {
  maxW: 322,
  headH: 44,
  rowH: 44,
  rowGap: 6,
  footH: 46,
  padX: 14,
};

/**
 * 嵌入列表布局（模态，居中，可滚动）。
 * 行 = 背包里的【每一颗】宝石（不再是按种类聚合）：宝石现在带等级，
 * 同一种类可能同时有 Lv.1 / Lv.2，按种类聚合会让"嵌哪颗"变成猜谜。
 * @returns {{x,y,w,h,rows,close,cancel,bagUsed,bagMax,type,index,scroll,maxScroll,emptyHint}}
 */
function getEmbedPickerLayout(game) {
  const W = game.W;
  const H = game.H;
  const list = sortedBagGems();

  const w = Math.min(PICKER_UI.maxW, W - 36);
  // 视口高：夹在顶栏与导航栏之间，至少 1 行（列表为空时也要画空提示）
  const maxBody = Math.max(PICKER_UI.rowH,
    H - LAYOUT.topBarHeight - LAYOUT.navHeight - PICKER_UI.headH - PICKER_UI.footH - 44);
  const bodyH = Math.min(list.length * PICKER_UI.rowH, maxBody);
  const h = PICKER_UI.headH + bodyH + PICKER_UI.footH;
  const x = Math.round((W - w) / 2);
  const y = Math.round(Math.max(LAYOUT.topBarHeight + 14, (H - h) / 2 - 18));

  const maxScroll = Math.max(0, list.length * PICKER_UI.rowH - bodyH);
  const scroll = Math.max(0, Math.min(maxScroll, game.gemPickerScroll || 0));

  const viewTop = y + PICKER_UI.headH;
  const rows = list.map((g, i) => {
    const def = gems.gemDef(g.kind) || { name: g.kind, desc: '', color: '#90A4AE' };
    return {
      uid: g.uid,
      kind: g.kind,
      lv: g.lv || 1,
      name: gems.gemName(g.kind, g.lv),
      desc: gems.effectTextAt(g.kind, g.lv),
      color: def.color,
      rect: {
        x: x + PICKER_UI.padX,
        y: viewTop + i * PICKER_UI.rowH - scroll,
        w: w - PICKER_UI.padX * 2,
        h: PICKER_UI.rowH - PICKER_UI.rowGap,
      },
      visible: false,   // 下面统一标
    };
  });
  const viewBottom = viewTop + bodyH;
  for (const row of rows) {
    row.visible = row.rect.y >= viewTop - 0.5 && row.rect.y + row.rect.h <= viewBottom + 0.5;
  }

  return {
    x, y, w, h, rows,
    bodyTop: viewTop, bodyH, scroll, maxScroll,
    emptyHint: list.length === 0,
    bagUsed: meta.gemList().length,
    bagMax: meta.bagSlots(),
    close: { x: x + w - 36, y: y + 9, w: 26, h: 26 },
    cancel: {
      x: x + PICKER_UI.padX,
      y: y + h - PICKER_UI.footH + 6,
      w: w - PICKER_UI.padX * 2,
      h: 32,
    },
    type: game.gemPicker ? game.gemPicker.type : null,
    index: game.gemPicker ? game.gemPicker.index : -1,
  };
}

/** 嵌入列表滚动量写回（夹取） */
function setEmbedPickerScroll(game, value) {
  const L = getEmbedPickerLayout(game);
  game.gemPickerScroll = Math.max(0, Math.min(L.maxScroll, value || 0));
  return game.gemPickerScroll;
}

/** 嵌入列表是否需要滚动 */
function isEmbedPickerScrollable(game) {
  return getEmbedPickerLayout(game).maxScroll > 0;
}

/**
 * 嵌入列表命中。
 * @returns {{kind:'pick'|'close', layer:'picker', uid?:string, gem?:string}}
 *   · pick  —— 点到了某颗宝石行 → 打开详情浮层（不再直接嵌入）
 *   · close —— 取消 / ✕ / 浮层外
 */
function hitEmbedPicker(game, pos) {
  const L = getEmbedPickerLayout(game);
  for (const row of L.rows) {
    if (!row.visible) continue;
    if (theme.pointInRect(pos, row.rect)) {
      return { kind: 'pick', layer: 'picker', uid: row.uid, gem: row.kind };
    }
  }
  return { kind: 'close', layer: 'picker' };
}

/** 打开"给某槽选宝石"浮层 */
function openEmbedPicker(game, type, index) {
  game.gemPicker = { type: type, index: index };
  game.gemPickerScroll = 0;
  return game.gemPicker;
}

function drawEmbedPicker(game) {
  const ctx = game.ctx;
  const L = getEmbedPickerLayout(game);
  const W = game.W;
  const H = game.H;

  // 遮罩
  ctx.save();
  ctx.fillStyle = 'rgba(0, 0, 0, 0.62)';
  ctx.fillRect(0, 0, W, H);
  ctx.restore();

  drawModalPanel(ctx, L.x, L.y, L.w, L.h);

  // 标题：目标槽位 + 绑定的固有技能名
  const towerDef = L.type ? TOWER_DEFS[L.type] : null;
  const skillName = L.type ? gems.skillNameOf(L.type) : '';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.font = 'bold 13px Arial';
  ctx.fillStyle = THEME.text.primary;
  ctx.fillText(`嵌入宝石 · 第 ${L.index + 1} 槽`, L.x + PICKER_UI.padX, L.y + 17);

  ctx.font = '10px Arial';
  ctx.fillStyle = THEME.text.dim;
  const sub = towerDef
    ? `${towerDef.name}${skillName ? ' · 绑定「' + skillName + '」' : ''} · 点宝石查看详情`
    : '点宝石查看详情';
  ctx.fillText(ellipsize(ctx, sub, L.w - PICKER_UI.padX * 2 - 40), L.x + PICKER_UI.padX, L.y + 33);

  // 关闭 ✕
  ctx.textAlign = 'center';
  ctx.font = 'bold 14px Arial';
  ctx.fillStyle = THEME.text.dim;
  ctx.fillText('✕', L.close.x + L.close.w / 2, L.close.y + L.close.h / 2);

  // 宝石行（裁剪在正文视区内）
  ctx.save();
  ctx.beginPath();
  ctx.rect(L.x + 2, L.bodyTop, L.w - 4, L.bodyH);
  ctx.clip();
  for (const row of L.rows) {
    const r = row.rect;
    ctx.fillStyle = 'rgba(255, 255, 255, 0.06)';
    roundRectPath(ctx, r.x, r.y, r.w, r.h, THEME.radius.medium);
    ctx.fill();
    ctx.strokeStyle = theme.shade(row.color, -0.1, 0.42);
    ctx.lineWidth = 1;
    roundRectPath(ctx, r.x, r.y, r.w, r.h, THEME.radius.medium);
    ctx.stroke();

    // 左：宝石图标
    gems.drawGemIcon(ctx, r.x + 22, r.y + r.h / 2, 12, row.kind);

    // 中：名称（带 Lv）+ 效果（按该颗的等级缩放）
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.font = 'bold 12px Arial';
    ctx.fillStyle = row.color;
    ctx.fillText(row.name, r.x + 42, r.y + r.h / 2 - 7);

    ctx.font = '10px Arial';
    ctx.fillStyle = THEME.text.secondary;
    ctx.fillText(row.desc, r.x + 42, r.y + r.h / 2 + 9);
  }

  // 空背包提示
  if (L.emptyHint) {
    ctx.textAlign = 'center';
    ctx.font = '11px Arial';
    ctx.fillStyle = THEME.text.off;
    ctx.fillText('背包里还没有宝石 · 战斗结算会掉落', L.x + L.w / 2, L.bodyTop + L.bodyH / 2);
  }
  ctx.restore();

  // 正文滚动条
  if (L.maxScroll > 0) {
    const view = { x: L.x + 2, y: L.bodyTop, w: L.w - 4, h: L.bodyH };
    drawScrollBar(ctx, view, L.scroll, L.maxScroll, view.h, L.rows.length * PICKER_UI.rowH);
    drawScrollHint(ctx, view, L.scroll, L.maxScroll, 'rgba(20,20,36,0.98)', THEME.accent.violet);
  }

  // 底部：背包占用 + 取消
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = '10px Arial';
  ctx.fillStyle = THEME.text.off;
  ctx.fillText(`背包 ${L.bagUsed}/${L.bagMax} 格`, L.x + L.w / 2, L.y + L.h - PICKER_UI.footH + 2);

  drawButton(ctx, {
    x: L.cancel.x, y: L.cancel.y, w: L.cancel.w, h: L.cancel.h,
    top: THEME.track.soft, bottom: THEME.track.faint, stroke: THEME.border.subtle,
    label: '取消', labelColor: THEME.text.secondary,
    fontSize: 13, radius: THEME.radius.medium,
    pressed: theme.isButtonPressed(game, 'gemmodal:cancel'),
  });
}

// ==================== ② 宝石详情浮层 ====================

const INFO_UI = {
  maxW: 322,
  padX: 16,
  padTop: 14,
  headH: 56,
  lineH: 18,
  divH: 12,
  ruleTitleH: 18,
  ruleLineH: 16,
  btnH: 40,
  btnGap: 12,
  padBottom: 14,
};

/**
 * 宝石详情浮层布局。
 * 底部按钮：图签来源（正在嵌入选宝石）→ 合成 + 嵌入 两颗；背包来源 → 只有合成一颗。
 * @returns {null|{x,y,w,h,name,desc,lv,color,synthBtn,embedBtn,close}}
 */
function getGemInfoLayout(game) {
  const info = game.gemInfo;
  if (!info) return null;
  const gem = meta.findGem(info.uid);
  if (!gem) return null;

  const W = game.W;
  const H = game.H;
  const def = gems.gemDef(gem.kind);
  const w = Math.min(INFO_UI.maxW, W - 36);
  const fromCodex = info.from === 'codex' && info.type && meta.socketCount(info.type) > info.index;

  // 高度逐段累加（与绘制同源，不允许两套算法）
  let h = INFO_UI.padTop + INFO_UI.headH
    + INFO_UI.divH + INFO_UI.lineH * 2
    + INFO_UI.divH + INFO_UI.ruleTitleH + INFO_UI.ruleLineH * 2
    + INFO_UI.btnGap + INFO_UI.btnH + INFO_UI.padBottom;

  const x = Math.round((W - w) / 2);
  const y = Math.round(Math.max(LAYOUT.topBarHeight + 20, (H - h) / 2 - 12));

  // 按钮区：两颗对半 / 一颗全宽
  const btnY = y + h - INFO_UI.padBottom - INFO_UI.btnH;
  let synthBtn, embedBtn = null;
  if (fromCodex) {
    const bw = Math.floor((w - INFO_UI.padX * 2 - 10) / 2);
    synthBtn = { x: x + INFO_UI.padX, y: btnY, w: bw, h: INFO_UI.btnH };
    embedBtn = { x: synthBtn.x + bw + 10, y: btnY, w: w - INFO_UI.padX * 2 - bw - 10, h: INFO_UI.btnH };
  } else {
    synthBtn = { x: x + INFO_UI.padX, y: btnY, w: w - INFO_UI.padX * 2, h: INFO_UI.btnH };
  }

  return {
    x, y, w, h,
    uid: gem.uid,
    kind: gem.kind,
    lv: gem.lv || 1,
    name: gems.gemName(gem.kind, gem.lv),
    desc: gems.effectTextAt(gem.kind, gem.lv),
    color: def ? def.color : '#90A4AE',
    from: info.from,
    synthBtn: synthBtn,
    embedBtn: embedBtn,
    close: { x: x + w - 34, y: y + 10, w: 24, h: 24 },
    ruleLines: synthRuleLines(),
  };
}

/**
 * 详情浮层命中。
 * @returns {{kind:'synth'|'embed'|'close', layer:'info'}}
 */
function hitGemInfo(game, pos) {
  const L = getGemInfoLayout(game);
  if (!L) return { kind: 'close', layer: 'info' };
  if (theme.pointInRect(pos, L.synthBtn)) return { kind: 'synth', layer: 'info' };
  if (L.embedBtn && theme.pointInRect(pos, L.embedBtn)) return { kind: 'embed', layer: 'info' };
  if (theme.pointInRect(pos, L.close)) return { kind: 'close', layer: 'info' };
  // 面板外 = 关闭；面板内空白 = 吞掉（不透给下层）
  if (pos.x < L.x || pos.x > L.x + L.w || pos.y < L.y || pos.y > L.y + L.h) {
    return { kind: 'close', layer: 'info' };
  }
  return { kind: 'none', layer: 'info' };
}

/** 详情浮层上的「嵌入宝石」按钮：把详情指向的那颗嵌进浮层指向的槽位 */
function actEmbedFromInfo(game) {
  const info = game.gemInfo;
  if (!info) return { ok: false, reason: 'noinfo' };

  const res = meta.embedGem(info.type, info.index, info.uid);
  if (res.ok) {
    const def = gems.gemDef(res.kind) || { name: res.kind, color: THEME.accent.violet };
    game.gemInfo = null;
    game.gemPicker = null;      // 嵌入完成，嵌入列表一并收掉
    game.gemPickerScroll = 0;
    theme.pushToast(game, `已嵌入 ${gems.gemName(res.kind, info.lv || 1)} · 与固有技能绑定`, def.color);
  } else if (res.reason === 'occupied') {
    theme.pushToast(game, '该槽已有宝石，先点它取出来', THEME.accent.danger);
  } else if (res.reason === 'locked') {
    theme.pushToast(game, '该槽尚未解锁', THEME.accent.danger);
  } else {
    theme.pushToast(game, '无法嵌入', THEME.accent.danger);
  }
  return res;
}

function drawGemInfo(game) {
  const ctx = game.ctx;
  const L = getGemInfoLayout(game);
  if (!L) return;
  const W = game.W;
  const H = game.H;

  ctx.save();
  ctx.fillStyle = 'rgba(0, 0, 0, 0.62)';
  ctx.fillRect(0, 0, W, H);
  ctx.restore();

  drawModalPanel(ctx, L.x, L.y, L.w, L.h, theme.shade(L.color, -0.05, 0.6));

  // ---- 头部：图标 + 名字（带 Lv）+ 效果 ----
  const headCY = L.y + INFO_UI.padTop + INFO_UI.headH / 2;
  gems.drawGemIcon(ctx, L.x + INFO_UI.padX + 20, headCY, 20, L.kind);

  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.font = 'bold 15px Arial';
  ctx.fillStyle = L.color;
  ctx.fillText(L.name, L.x + INFO_UI.padX + 52, headCY - 9);

  ctx.font = '11px Arial';
  ctx.fillStyle = THEME.text.secondary;
  ctx.fillText(ellipsize(ctx, L.desc, L.w - INFO_UI.padX * 2 - 52), L.x + INFO_UI.padX + 52, headCY + 10);

  // 关闭 ✕
  ctx.textAlign = 'center';
  ctx.font = 'bold 13px Arial';
  ctx.fillStyle = THEME.text.dim;
  ctx.fillText('✕', L.close.x + L.close.w / 2, L.close.y + L.close.h / 2);

  let cy = L.y + INFO_UI.padTop + INFO_UI.headH;

  // ---- 效果细节 ----
  theme.drawTaperedDivider(ctx, L.x + L.w / 2, cy + INFO_UI.divH / 2, L.w - 28, 4);
  cy += INFO_UI.divH;

  ctx.textAlign = 'left';
  ctx.font = '11px Arial';
  ctx.fillStyle = L.color;
  ctx.fillText(`当前效果：${L.desc}`, L.x + INFO_UI.padX, cy + INFO_UI.lineH / 2);
  cy += INFO_UI.lineH;

  ctx.font = '10px Arial';
  ctx.fillStyle = THEME.text.off;
  ctx.fillText(`宝石等级 Lv.${L.lv} · 效果随等级提升，合成 +1 级`, L.x + INFO_UI.padX, cy + INFO_UI.lineH / 2);
  cy += INFO_UI.lineH;

  // ---- 合成规则 ----
  theme.drawTaperedDivider(ctx, L.x + L.w / 2, cy + INFO_UI.divH / 2, L.w - 28, 4);
  cy += INFO_UI.divH;

  ctx.font = 'bold 11px Arial';
  ctx.fillStyle = THEME.text.primary;
  ctx.fillText('合成规则', L.x + INFO_UI.padX, cy + INFO_UI.ruleTitleH / 2);
  cy += INFO_UI.ruleTitleH;

  ctx.font = '10px Arial';
  ctx.fillStyle = THEME.text.off;
  for (const line of L.ruleLines) {
    ctx.fillText(line, L.x + INFO_UI.padX, cy + INFO_UI.ruleLineH / 2);
    cy += INFO_UI.ruleLineH;
  }

  // ---- 底部按钮 ----
  drawButton(ctx, {
    x: L.synthBtn.x, y: L.synthBtn.y, w: L.synthBtn.w, h: L.synthBtn.h,
    top: 'rgba(165, 214, 167, 0.40)', bottom: 'rgba(76, 175, 80, 0.24)',
    stroke: 'rgba(165, 214, 167, 0.8)',
    label: '合成宝石', labelColor: THEME.text.primary,
    fontSize: 13, radius: THEME.radius.medium,
    pressed: theme.isButtonPressed(game, 'gemmodal:synth'),
  });
  if (L.embedBtn) {
    drawButton(ctx, {
      x: L.embedBtn.x, y: L.embedBtn.y, w: L.embedBtn.w, h: L.embedBtn.h,
      top: 'rgba(179, 136, 255, 0.42)', bottom: 'rgba(126, 87, 194, 0.28)',
      stroke: 'rgba(179, 136, 255, 0.8)',
      label: '嵌入宝石', labelColor: THEME.text.primary,
      fontSize: 13, radius: THEME.radius.medium,
      pressed: theme.isButtonPressed(game, 'gemmodal:embed'),
    });
  }
  ctx.restore();
}

// ==================== ③ 合成浮层 ====================

const SYNTH_UI = {
  maxW: 340,
  padX: 14,
  padTop: 12,
  headH: 30,
  infoH: 24,
  bodyGap: 6,
  rowH: 42,
  rowGap: 5,
  footH: 86,
};

/**
 * 合成浮层布局：背包宝石多选列表 + 实时成功率 + 开始合成。
 * @returns {null|{x,y,w,h,rows,count,canGo,rate,rateText,goBtn,cancelBtn,close,scroll,maxScroll,bodyTop,bodyH}}
 */
function getSynthLayout(game) {
  const st = game.gemSynth;
  if (!st) return null;
  const W = game.W;
  const H = game.H;
  const list = sortedBagGems();
  const picked = st.picked || {};
  const anchorLv = pickedAnchorLv(list, picked);

  const w = Math.min(SYNTH_UI.maxW, W - 36);
  const headTotal = SYNTH_UI.padTop + SYNTH_UI.headH + SYNTH_UI.infoH + SYNTH_UI.bodyGap;
  const maxBody = Math.max(SYNTH_UI.rowH,
    H - LAYOUT.topBarHeight - LAYOUT.navHeight - headTotal - SYNTH_UI.footH - 40);
  const bodyH = Math.min(list.length * SYNTH_UI.rowH, maxBody);
  const h = headTotal + bodyH + SYNTH_UI.footH;
  const x = Math.round((W - w) / 2);
  const y = Math.round(Math.max(LAYOUT.topBarHeight + 14, (H - h) / 2 - 14));

  const maxScroll = Math.max(0, list.length * SYNTH_UI.rowH - bodyH);
  const scroll = Math.max(0, Math.min(maxScroll, st.scroll || 0));

  const bodyTop = y + headTotal;
  const viewBottom = bodyTop + bodyH;
  const rows = list.map((g, i) => {
    const def = gems.gemDef(g.kind) || { name: g.kind, desc: '', color: '#90A4AE' };
    const selectable = anchorLv === null || (g.lv || 1) === anchorLv;
    return {
      uid: g.uid,
      kind: g.kind,
      lv: g.lv || 1,
      name: gems.gemName(g.kind, g.lv),
      desc: gems.effectTextAt(g.kind, g.lv),
      color: def.color,
      selected: !!picked[g.uid],
      selectable: selectable,
      rect: {
        x: x + SYNTH_UI.padX,
        y: bodyTop + i * SYNTH_UI.rowH - scroll,
        w: w - SYNTH_UI.padX * 2,
        h: SYNTH_UI.rowH - SYNTH_UI.rowGap,
      },
      visible: false,
    };
  });
  for (const row of rows) {
    row.visible = row.rect.y >= bodyTop - 0.5 && row.rect.y + row.rect.h <= viewBottom + 0.5;
  }

  const count = rows.filter((r) => r.selected).length;
  const s = GEM.synth;
  const canGo = count >= s.minCount;           // 同级由"锚点 + 行禁用"保证
  const rate = meta.synthRate(count);

  let infoText, infoColor;
  if (count === 0) {
    infoText = `点选至少 ${s.minCount} 颗同级宝石`;
    infoColor = THEME.text.dim;
  } else if (count < s.minCount) {
    infoText = `已选 ${count} 颗同级 · 还差 ${s.minCount - count} 颗`;
    infoColor = THEME.text.secondary;
  } else {
    infoText = `已选 ${count} 颗同级 · 成功率 ${Math.round(rate * 100)}%`;
    infoColor = THEME.accent.green;
  }

  const btnY = y + h - SYNTH_UI.footH + 40;
  const bw = Math.floor((w - SYNTH_UI.padX * 2 - 10) / 2);

  return {
    x, y, w, h, rows,
    bodyTop, bodyH, scroll, maxScroll,
    count, canGo, rate,
    infoText, infoColor,
    cancelBtn: { x: x + SYNTH_UI.padX, y: btnY, w: bw, h: 34 },
    goBtn: { x: x + SYNTH_UI.padX + bw + 10, y: btnY, w: w - SYNTH_UI.padX * 2 - bw - 10, h: 34 },
    close: { x: x + w - 34, y: y + 8, w: 24, h: 24 },
  };
}

/** 合成列表滚动量写回（夹取） */
function setSynthScroll(game, value) {
  const st = game.gemSynth;
  if (!st) return 0;
  const L = getSynthLayout(game);
  st.scroll = Math.max(0, Math.min(L.maxScroll, value || 0));
  return st.scroll;
}

/** 合成列表是否需要滚动 */
function isSynthScrollable(game) {
  const L = getSynthLayout(game);
  return !!L && L.maxScroll > 0;
}

/**
 * 合成浮层命中。
 * @returns {{kind:'row'|'go'|'cancel'|'disabled'|'close'|'none', layer:'synth', uid?:string}}
 */
function hitSynth(game, pos) {
  const L = getSynthLayout(game);
  if (!L) return { kind: 'close', layer: 'synth' };
  for (const row of L.rows) {
    if (!row.visible || !row.selectable) continue;
    if (theme.pointInRect(pos, row.rect)) return { kind: 'row', layer: 'synth', uid: row.uid };
  }
  // 不可选（等级不符）的行：吞掉点击但不当作关闭
  for (const row of L.rows) {
    if (row.visible && !row.selectable && theme.pointInRect(pos, row.rect)) {
      return { kind: 'disabled', layer: 'synth', uid: row.uid, reason: 'level' };
    }
  }
  if (theme.pointInRect(pos, L.goBtn)) return L.canGo
    ? { kind: 'go', layer: 'synth' }
    : { kind: 'disabled', layer: 'synth', reason: 'count' };
  if (theme.pointInRect(pos, L.cancelBtn)) return { kind: 'cancel', layer: 'synth' };
  if (theme.pointInRect(pos, L.close)) return { kind: 'close', layer: 'synth' };
  if (pos.x < L.x || pos.x > L.x + L.w || pos.y < L.y || pos.y > L.y + L.h) {
    return { kind: 'close', layer: 'synth' };
  }
  return { kind: 'none', layer: 'synth' };
}

/** 勾选/取消一颗合成材料（锚点等级之外的行在 hit 层就被拦下了） */
function toggleSynthRow(game, uid) {
  const st = game.gemSynth;
  if (!st) return;
  st.picked = st.picked || {};
  if (st.picked[uid]) delete st.picked[uid];
  else st.picked[uid] = true;
}

/**
 * 执行合成（meta.synthesizeGems）：结算、收浮层、报结果。
 * 成功 → 产物随机一种所选材料 +1 级；失败 → 材料消耗。
 */
function actSynthesize(game) {
  const st = game.gemSynth;
  if (!st) return { ok: false, reason: 'nosynth' };
  const uids = Object.keys(st.picked || {});
  const res = meta.synthesizeGems(uids);
  if (!res.ok) {
    const msg = res.reason === 'count' ? `至少选 ${GEM.synth.minCount} 颗同级宝石`
      : (res.reason === 'level' ? '所选宝石等级必须相同' : '无法合成');
    theme.pushToast(game, msg, THEME.accent.danger);
    return res;
  }

  closeGemSynth(game);
  game.gemInfo = null;          // 合成入口可能是详情浮层，一并收掉
  if (res.success && res.gem) {
    const g = res.gem;
    theme.pushToast(game,
      `合成成功！获得 ${gems.gemName(g.kind, g.lv)}（${gems.effectTextAt(g.kind, g.lv)}）`,
      THEME.accent.green);
  } else {
    theme.pushToast(game, `合成失败…${uids.length} 颗材料已消耗`, THEME.accent.danger);
  }
  return res;
}

/** 打开合成浮层（可带预选，详情浮层的「合成宝石」会预选当前这颗） */
function openGemSynth(game, preselectUids) {
  game.gemInfo = null;          // 详情让位给合成浮层（同一时间只看一张）
  const picked = {};
  for (const uid of (preselectUids || [])) {
    if (meta.findGem(uid)) picked[uid] = true;
  }
  game.gemSynth = { picked: picked, scroll: 0 };
  return game.gemSynth;
}

function closeGemSynth(game) {
  game.gemSynth = null;
}

function drawSynth(game) {
  const ctx = game.ctx;
  const L = getSynthLayout(game);
  if (!L) return;
  const W = game.W;
  const H = game.H;

  ctx.save();
  ctx.fillStyle = 'rgba(0, 0, 0, 0.62)';
  ctx.fillRect(0, 0, W, H);
  ctx.restore();

  drawModalPanel(ctx, L.x, L.y, L.w, L.h, 'rgba(77, 208, 225, 0.55)');

  // 标题
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.font = 'bold 13px Arial';
  ctx.fillStyle = THEME.text.primary;
  ctx.fillText('合成宝石', L.x + SYNTH_UI.padX, L.y + SYNTH_UI.padTop + SYNTH_UI.headH / 2);

  ctx.textAlign = 'center';
  ctx.font = 'bold 14px Arial';
  ctx.fillStyle = THEME.text.dim;
  ctx.fillText('✕', L.close.x + L.close.w / 2, L.close.y + L.close.h / 2);

  // 状态行（已选几颗 / 成功率）
  ctx.textAlign = 'left';
  ctx.font = 'bold 11px Arial';
  ctx.fillStyle = L.infoColor;
  ctx.fillText(L.infoText, L.x + SYNTH_UI.padX,
    L.y + SYNTH_UI.padTop + SYNTH_UI.headH + SYNTH_UI.infoH / 2);

  // ---- 多选列表 ----
  ctx.save();
  ctx.beginPath();
  ctx.rect(L.x + 2, L.bodyTop, L.w - 4, L.bodyH);
  ctx.clip();
  for (const row of L.rows) {
    const r = row.rect;

    if (row.selected) {
      ctx.fillStyle = 'rgba(129, 199, 132, 0.14)';
      ctx.strokeStyle = 'rgba(129, 199, 132, 0.75)';
    } else if (!row.selectable) {
      ctx.fillStyle = 'rgba(255, 255, 255, 0.02)';
      ctx.strokeStyle = THEME.border.subtle;
    } else {
      ctx.fillStyle = 'rgba(255, 255, 255, 0.05)';
      ctx.strokeStyle = theme.shade(row.color, -0.1, 0.35);
    }
    ctx.lineWidth = 1;
    roundRectPath(ctx, r.x, r.y, r.w, r.h, THEME.radius.medium);
    ctx.fill();
    ctx.stroke();

    ctx.save();
    if (!row.selectable) ctx.globalAlpha = 0.45;

    gems.drawGemIcon(ctx, r.x + 20, r.y + r.h / 2, 11, row.kind);

    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.font = 'bold 12px Arial';
    ctx.fillStyle = row.color;
    ctx.fillText(row.name, r.x + 38, r.y + r.h / 2 - 7);

    ctx.font = '10px Arial';
    ctx.fillStyle = THEME.text.secondary;
    ctx.fillText(row.desc, r.x + 38, r.y + r.h / 2 + 9);
    ctx.restore();

    // 右侧：勾选框 / 等级不符
    const cb = 16;
    const cbx = r.x + r.w - cb - 10;
    const cby = r.y + (r.h - cb) / 2;
    if (row.selectable) {
      roundRectPath(ctx, cbx, cby, cb, cb, 4);
      if (row.selected) {
        ctx.fillStyle = THEME.accent.green;
        ctx.fill();
        // ✓
        ctx.strokeStyle = '#0b0b16';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(cbx + 4, cby + cb / 2);
        ctx.lineTo(cbx + cb / 2 - 1, cby + cb - 5);
        ctx.lineTo(cbx + cb - 4, cby + 4);
        ctx.stroke();
      } else {
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
        ctx.lineWidth = 1.2;
        ctx.stroke();
      }
    } else {
      ctx.textAlign = 'right';
      ctx.font = '9px Arial';
      ctx.fillStyle = THEME.text.off;
      ctx.fillText('等级不符', cbx - 4, r.y + r.h / 2);
    }
  }

  if (L.rows.length === 0) {
    ctx.textAlign = 'center';
    ctx.font = '11px Arial';
    ctx.fillStyle = THEME.text.off;
    ctx.fillText('背包里没有宝石', L.x + L.w / 2, L.bodyTop + L.bodyH / 2);
  }
  ctx.restore();

  // 滚动条
  if (L.maxScroll > 0) {
    const view = { x: L.x + 2, y: L.bodyTop, w: L.w - 4, h: L.bodyH };
    drawScrollBar(ctx, view, L.scroll, L.maxScroll, view.h, L.rows.length * SYNTH_UI.rowH);
    drawScrollHint(ctx, view, L.scroll, L.maxScroll, 'rgba(20,20,36,0.98)', THEME.accent.cyan);
  }

  // ---- 页脚：结果说明 + 按钮 ----
  ctx.textAlign = 'left';
  ctx.font = '9.5px Arial';
  ctx.fillStyle = THEME.text.off;
  ctx.fillText('成功：获得所选范围内随机一种 +1 级 · 失败：材料消耗',
    L.x + SYNTH_UI.padX, L.y + L.h - SYNTH_UI.footH + 22);

  drawButton(ctx, {
    x: L.cancelBtn.x, y: L.cancelBtn.y, w: L.cancelBtn.w, h: L.cancelBtn.h,
    top: THEME.track.soft, bottom: THEME.track.faint, stroke: THEME.border.subtle,
    label: '取消', labelColor: THEME.text.secondary,
    fontSize: 13, radius: THEME.radius.medium,
    pressed: theme.isButtonPressed(game, 'gemmodal:cancel'),
  });
  drawButton(ctx, {
    x: L.goBtn.x, y: L.goBtn.y, w: L.goBtn.w, h: L.goBtn.h,
    top: L.canGo ? 'rgba(165, 214, 167, 0.42)' : THEME.track.soft,
    bottom: L.canGo ? 'rgba(76, 175, 80, 0.26)' : THEME.track.faint,
    stroke: L.canGo ? 'rgba(165, 214, 167, 0.85)' : THEME.border.subtle,
    label: L.canGo ? `开始合成 ${Math.round(L.rate * 100)}%` : `开始合成（选 ${GEM.synth.minCount} 颗起）`,
    labelColor: L.canGo ? THEME.text.primary : THEME.text.off,
    fontSize: 13, radius: THEME.radius.medium,
    pressed: L.canGo && theme.isButtonPressed(game, 'gemmodal:go'),
  });
}

// ==================== 路由（输入层只对接这里） ====================

/** 当前是否有浮层（详情浮层的宝石被消耗掉时顺带自愈） */
function hasActive(game) {
  if (game.gemInfo && !meta.findGem(game.gemInfo.uid)) game.gemInfo = null;
  return !!(game.gemPicker || game.gemInfo || game.gemSynth);
}

/** 命中当前最上层的浮层 */
function hitActive(game, pos) {
  if (game.gemSynth) return hitSynth(game, pos);
  if (game.gemInfo) return hitGemInfo(game, pos);
  if (game.gemPicker) return hitEmbedPicker(game, pos);
  return { kind: 'none', layer: 'none' };
}

/**
 * touchstart/touchend 两段都命中同一目标才结算（与全项目按钮同一套"按住滑开不算"规矩）。
 * @param {{layer:string, kind:string, uid?:string}} touch touchstart 记下的命中
 */
function settleTap(game, pos, touch) {
  const hit = hitActive(game, pos);
  if (!hit || hit.layer !== touch.layer || hit.kind !== touch.kind) return;
  if (hit.kind === 'row' && hit.uid !== touch.uid) return;

  switch (hit.kind) {
    case 'pick':       // 嵌入列表点宝石 → 打开详情（不再直接嵌入）
      openGemInfo(game, hit.uid, {
        from: 'codex',
        type: game.gemPicker ? game.gemPicker.type : null,
        index: game.gemPicker ? game.gemPicker.index : -1,
      });
      break;
    case 'embed':      // 详情浮层 → 嵌入
      actEmbedFromInfo(game);
      break;
    case 'synth':      // 详情浮层 → 打开合成（预选当前宝石）
      openGemSynth(game, [game.gemInfo ? game.gemInfo.uid : hit.uid]);
      break;
    case 'row':
      toggleSynthRow(game, hit.uid);
      break;
    case 'go':
      actSynthesize(game);
      break;
    case 'disabled':
      // 点了不可用的东西：等级不符 ≠ 数量不够，两种提示不能混为一谈
      theme.pushToast(game, hit.reason === 'level' ? '同级宝石才能一起合成'
        : `至少选 ${GEM.synth.minCount} 颗同级宝石`, THEME.text.dim);
      break;
    case 'close':
      if (hit.layer === 'synth') closeGemSynth(game);
      else if (hit.layer === 'info') game.gemInfo = null;
      else if (hit.layer === 'picker') { game.gemPicker = null; game.gemPickerScroll = 0; }
      break;
    default:
      break;   // 'none'：面板内空白，吞掉
  }
}

/** 打开宝石详情浮层（背包 / 图签嵌入列表共用入口） */
function openGemInfo(game, uid, opts) {
  const o = opts || {};
  game.gemInfo = { uid: uid, from: o.from || 'bag', type: o.type || null, index: o.index === undefined ? -1 : o.index };
  return game.gemInfo;
}

/** 关掉全部浮层（切场景 / 嵌入完成时用） */
function closeAll(game) {
  game.gemPicker = null;
  game.gemPickerScroll = 0;
  game.gemInfo = null;
  game.gemSynth = null;
}

/** 绘制当前打开的浮层（自下而上：嵌入列表 → 详情 → 合成） */
function drawGemModal(game) {
  if (game.gemPicker) drawEmbedPicker(game);
  if (game.gemInfo) drawGemInfo(game);
  if (game.gemSynth) drawSynth(game);
}

module.exports = {
  PICKER_UI,
  INFO_UI,
  SYNTH_UI,
  sortedBagGems,
  // 嵌入列表
  getEmbedPickerLayout,
  setEmbedPickerScroll,
  isEmbedPickerScrollable,
  hitEmbedPicker,
  openEmbedPicker,
  // 详情浮层
  getGemInfoLayout,
  hitGemInfo,
  openGemInfo,
  actEmbedFromInfo,
  // 合成浮层
  getSynthLayout,
  setSynthScroll,
  isSynthScrollable,
  hitSynth,
  openGemSynth,
  closeGemSynth,
  toggleSynthRow,
  actSynthesize,
  // 路由
  hasActive,
  hitActive,
  settleTap,
  closeAll,
  drawGemModal,
};
