// ============================================================================
// 元进度 / 存档 —— src/meta.js
// ----------------------------------------------------------------------------
// 战斗内是"局内"状态（金币、波次、场上的塔），本文件管的是"局外"永久进度：
//   · 特殊积分（图签唯一货币）
//   · 图签：哪些图形塔已解锁、各自的图签等级（决定 +攻击力 与 能否登场）
//   · 登场池 lineup：战斗商店的出货池（只出登场池里的已解锁塔）
//   · 天赋点 + 天赋等级
//   · 关卡进度（已通关 / 最高波次 / 当前所选关卡）
//
// 持久化：微信小游戏走 wx.setStorageSync；非微信环境（node 冒烟测试）退化为纯内存，
// 不抛错。所有写操作走 save()，内部做节流，避免每帧落盘。
// ============================================================================

const {
  SHOP_TOWERS, TOWER_ORDER, TOWER_DEFS, CODEX, TALENTS, TALENT_EFFECT, LEVELS,
} = require('./config');

const STORAGE_KEY = 'graphic_td_meta_v1';
const SAVE_THROTTLE_MS = 400;

/** 一份全新的存档 */
function createDefaultMeta() {
  const codex = {};
  // 默认解锁的 5 种基础塔（图签 Lv.1）
  for (const type of SHOP_TOWERS) codex[type] = 1;
  return {
    version: 1,
    points: 0,                             // 特殊积分
    talentPoints: 0,                       // 天赋点
    codex,                                 // { [towerType]: level }，level>=1 即已解锁
    lineup: SHOP_TOWERS.slice(),           // 登场池（有序）
    talents: {},                           // { [talentId]: level }
    levels: { cleared: {}, best: {} },     // cleared[id]=通关次数 / best[id]=最高波次
    selectedLevel: 1,
  };
}

// ---------- 存储适配 ----------
function getStorage() {
  if (typeof wx !== 'undefined' && wx && typeof wx.setStorageSync === 'function') return wx;
  return null;
}

function readRaw() {
  const st = getStorage();
  if (!st) return null;
  try {
    const raw = st.getStorageSync(STORAGE_KEY);
    if (!raw) return null;
    return (typeof raw === 'string') ? JSON.parse(raw) : raw;
  } catch (e) {
    return null;
  }
}

function writeRaw(obj) {
  const st = getStorage();
  if (!st) return;
  try {
    st.setStorageSync(STORAGE_KEY, JSON.stringify(obj));
  } catch (e) {
    // 落盘失败不影响本局游戏（内存态仍然正确）
  }
}

// ---------- 迁移 / 补齐 ----------
/** 把任意（可能是旧版本 / 残缺的）存档补齐成合法结构，永不因坏档崩溃 */
function normalize(raw) {
  const base = createDefaultMeta();
  if (!raw || typeof raw !== 'object') return base;

  const out = base;
  if (typeof raw.points === 'number' && isFinite(raw.points)) out.points = Math.max(0, Math.floor(raw.points));
  if (typeof raw.talentPoints === 'number' && isFinite(raw.talentPoints)) out.talentPoints = Math.max(0, Math.floor(raw.talentPoints));

  // 图签等级：只保留存在且等级合法的条目
  out.codex = {};
  const rawCodex = (raw.codex && typeof raw.codex === 'object') ? raw.codex : {};
  for (const type of TOWER_ORDER) {
    const lv = Number(rawCodex[type]);
    if (isFinite(lv) && lv >= 1) out.codex[type] = Math.min(CODEX.maxLevel, Math.floor(lv));
  }
  // 默认赠送的 5 种塔永远保底解锁（避免坏档把玩家清空成"无塔可用"）
  for (const type of SHOP_TOWERS) {
    if (!out.codex[type]) out.codex[type] = 1;
  }

  // 登场池：仅保留已解锁且在 TOWER_DEFS 里的类型，去重，限长
  const rawLine = Array.isArray(raw.lineup) ? raw.lineup : [];
  const seen = {};
  out.lineup = [];
  for (const t of rawLine) {
    if (!TOWER_DEFS[t] || seen[t]) continue;
    if (!out.codex[t]) continue;
    seen[t] = 1;
    out.lineup.push(t);
  }
  if (out.lineup.length === 0) out.lineup = SHOP_TOWERS.slice();
  if (out.lineup.length > CODEX.lineupMax) out.lineup = out.lineup.slice(0, CODEX.lineupMax);

  // 天赋等级
  out.talents = {};
  const rawTal = (raw.talents && typeof raw.talents === 'object') ? raw.talents : {};
  for (const def of TALENTS) {
    const lv = Number(rawTal[def.id]);
    if (isFinite(lv) && lv > 0) out.talents[def.id] = Math.min(def.max, Math.floor(lv));
  }

  // 关卡进度
  const rawLevels = (raw.levels && typeof raw.levels === 'object') ? raw.levels : {};
  out.levels = { cleared: {}, best: {} };
  if (rawLevels.cleared && typeof rawLevels.cleared === 'object') {
    for (const k of Object.keys(rawLevels.cleared)) {
      const v = rawLevels.cleared[k];
      if (v === true) out.levels.cleared[k] = 1;         // 旧存档迁移：true → 1
      else if (typeof v === 'number' && v > 0) out.levels.cleared[k] = Math.floor(v);
    }
  }
  if (rawLevels.best && typeof rawLevels.best === 'object') {
    for (const k of Object.keys(rawLevels.best)) {
      const v = Number(rawLevels.best[k]);
      if (isFinite(v)) out.levels.best[k] = Math.floor(v);
    }
  }
  const sel = Number(raw.selectedLevel);
  out.selectedLevel = (isFinite(sel) && sel >= 1) ? Math.floor(sel) : 1;

  return out;
}

// ==================== 单例 ====================
let meta = null;
let lastSave = 0;
let dirty = false;

function get() {
  if (!meta) meta = normalize(readRaw());
  return meta;
}

/**
 * 落盘（带节流）。
 * @param {boolean} [force] 强制立即写（购买/解锁/切场景等关键节点用）
 */
function save(force) {
  const now = Date.now();
  if (!force && dirty && now - lastSave < SAVE_THROTTLE_MS) return;
  const m = get();
  if (m === null) return; // 理论上不会走到这里（save 之前一定先 get）
  writeRaw(m);
  lastSave = now;
}

/** 恢复初始存档（设置界面 / 调试用） */
function resetAll() {
  meta = createDefaultMeta();
  writeRaw(meta);
  lastSave = Date.now();
}

// ==================== 积分 ====================

/** 结算后的实际入账积分（天赋"洞察先机"加成，在此生效） */
function grantPoints(amount) {
  const m = get();
  // 仅受洞察先机加成影响，暴利风险已改为影响生存积分
  const mult = Math.max(0.1, 1 + talentValue('points_gain') / 100);
  const gain = Math.max(0, Math.round((amount || 0) * mult));
  m.points += gain;
  return gain;
}

function grantTalentPoints(amount) {
  const m = get();
  const gain = Math.max(0, Math.round(amount || 0));
  m.talentPoints += gain;
  return gain;
}

// ==================== 图签 ====================

/** 该类型当前图签等级（0 = 未解锁） */
function codexLevel(type) {
  const m = get();
  return m.codex[type] || 0;
}

function isUnlocked(type) {
  return codexLevel(type) > 0;
}

/**
 * 图签花费（含天赋"图鉴学"折扣）。
 * @param {string} type 塔类型
 * @param {number} targetLevel 目标等级（未解锁时传 1 = 解锁价；已解锁时传 当前+1 = 升级价）
 * @returns {number} 实际花费（整数）
 */
function codexCost(type, targetLevel) {
  const def = TOWER_DEFS[type];
  if (!def) return Infinity;
  const base = CODEX.unlockCost[def.rarity] || 200;
  const raw = (targetLevel <= 1) ? base : Math.round(base * CODEX.upgradeCostRate * targetLevel);
  const discount = talentValue('codex_ease') / 100;
  return Math.max(1, Math.round(raw * (1 - discount)));
}

/**
 * 解锁 / 升级图签（统一入口：等级 +1）。
 * @returns {{ok:boolean, level?:number, cost?:number, reason?:string}}
 */
function upgradeCodex(type) {
  const m = get();
  if (!TOWER_DEFS[type]) return { ok: false, reason: 'unknown' };
  const cur = m.codex[type] || 0;
  if (cur >= CODEX.maxLevel) return { ok: false, reason: 'maxed', level: cur };

  const target = cur + 1;
  const cost = codexCost(type, target);
  if (m.points < cost) return { ok: false, reason: 'points', cost: cost, level: cur };

  m.points -= cost;
  m.codex[type] = target;
  // 首次解锁自动进登场池（若还有位置）
  if (cur === 0 && m.lineup.length < CODEX.lineupMax && m.lineup.indexOf(type) < 0) {
    m.lineup.push(type);
  }
  save(true);
  return { ok: true, level: target, cost: cost };
}

/** 图签带来的攻击力乘数（1 + 等级×每级加成；未解锁返回 1） */
function codexDamageMultiplier(type) {
  const lv = codexLevel(type);
  if (lv <= 0) return 1;
  return 1 + (lv * CODEX.bonusPerLevel) / 100;
}

// ==================== 登场池 ====================

function getLineup() {
  return get().lineup.slice();
}

function isInLineup(type) {
  return get().lineup.indexOf(type) >= 0;
}

/**
 * 切换登场状态。规则：
 *  · 未解锁不能登场
 *  · 登场池上限 CODEX.lineupMax
 *  · 池内至少保留 1 种（否则战斗商店无货可出）
 * @returns {{ok:boolean, on?:boolean, reason?:string}}
 */
function toggleLineup(type) {
  const m = get();
  if (!TOWER_DEFS[type]) return { ok: false, reason: 'unknown' };
  if (!m.codex[type]) return { ok: false, reason: 'locked' };

  const idx = m.lineup.indexOf(type);
  if (idx >= 0) {
    if (m.lineup.length <= CODEX.lineupMin) return { ok: false, reason: 'min6', count: m.lineup.length };
    m.lineup.splice(idx, 1);
    save(true);
    return { ok: true, on: false };
  }
  if (m.lineup.length >= CODEX.lineupMax) return { ok: false, reason: 'full' };
  m.lineup.push(type);
  save(true);
  return { ok: true, on: true };
}

// ==================== 天赋 ====================

function talentLevel(id) {
  const m = get();
  return m.talents[id] || 0;
}

/**
 * 天赋的数值产出（等级 × 每级数值），口径见 config.TALENT_EFFECT。
 * @param {string} id 天赋 id
 * @param {string} [key] 取哪一档数值，默认 'perLevel'。
 *        双向天赋（如 high_stakes）用 'goldPerLevel' 取"增益侧"数值，
 *        'perLevel' 取"负向侧"数值（特殊积分）。
 */
function talentValue(id, key) {
  const def = TALENTS.filter((t) => t.id === id)[0];
  if (!def) return 0;
  const lv = talentLevel(id);
  if (lv <= 0) return 0;
  const eff = TALENT_EFFECT[id];
  if (!eff) return lv;
  const k = key || 'perLevel';
  return lv * (eff[k] !== undefined ? eff[k] : 0);
}

/** 学习下一级天赋 */
function learnTalent(id) {
  const m = get();
  const def = TALENTS.filter((t) => t.id === id)[0];
  if (!def) return { ok: false, reason: 'unknown' };
  const cur = m.talents[id] || 0;
  if (cur >= def.max) return { ok: false, reason: 'maxed', level: cur };

  const cost = def.costs[cur] || 1;
  if (m.talentPoints < cost) return { ok: false, reason: 'points', cost: cost, level: cur };

  m.talentPoints -= cost;
  m.talents[id] = cur + 1;
  save(true);
  return { ok: true, level: cur + 1, cost: cost };
}

// ==================== 关卡 ====================

function recordWave(levelId, wave) {
  const m = get();
  const key = String(levelId);
  const prev = m.levels.best[key] || 0;
  if (wave > prev) {
    m.levels.best[key] = wave;
    save();
  }
}

function markLevelCleared(levelId, wave) {
  const m = get();
  const key = String(levelId);
  const prevCount = m.levels.cleared[key] || 0;
  const first = prevCount === 0;
  const newCount = prevCount + 1;
  m.levels.cleared[key] = newCount;
  const prev = m.levels.best[key] || 0;
  if (wave > prev) m.levels.best[key] = wave;
  save(true);
  return { first, clearCount: newCount };
}

function isLevelCleared(levelId) {
  return (get().levels.cleared[String(levelId)] || 0) > 0;
}

/** 该关卡是否属于"已实现、可玩"范围（不是"待扩展"占位关卡） */
function isLevelPlayable(levelId) {
  const lv = LEVELS.find((l) => l.id === levelId);
  return !!(lv && lv.playable);
}

/**
 * 该关卡是否已解锁（可以进入战前选关并开始游戏）。
 * 规则：
 *   · 必须属于可玩范围（非"待扩展"占位）
 *   · 关卡 1 默认解锁
 *   · 关卡 N > 1 需要关卡 N-1 已通关
 */
function isLevelUnlocked(levelId) {
  if (!isLevelPlayable(levelId)) return false;
  if (levelId <= 1) return true;
  return isLevelCleared(levelId - 1);
}

function bestWaveOf(levelId) {
  return get().levels.best[String(levelId)] || 0;
}

function setSelectedLevel(levelId) {
  const m = get();
  m.selectedLevel = levelId;
  save(true);
}

function getSelectedLevel() {
  return get().selectedLevel;
}

module.exports = {
  STORAGE_KEY,
  createDefaultMeta,
  get,
  save,
  resetAll,
  // 积分
  grantPoints,
  grantTalentPoints,
  // 图签
  codexLevel,
  isUnlocked,
  codexCost,
  upgradeCodex,
  codexDamageMultiplier,
  // 登场池
  getLineup,
  isInLineup,
  toggleLineup,
  // 天赋
  talentLevel,
  talentValue,
  learnTalent,
  // 关卡
  recordWave,
  markLevelCleared,
  isLevelCleared,
  isLevelPlayable,
  isLevelUnlocked,
  bestWaveOf,
  setSelectedLevel,
  getSelectedLevel,
};
