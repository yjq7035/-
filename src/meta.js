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
  SHOP_TOWERS, TOWER_ORDER, TOWER_DEFS, CODEX, TALENTS, TALENT_COST, TALENT_EFFECT, LEVELS,
  GEM, GEM_KINDS, clampGemLevel, resolveGem, gemSynthRate, gemSynthResult, MAX_STAGE,
} = require('./config');

const STORAGE_KEY = 'graphic_td_meta_v1';
const SAVE_THROTTLE_MS = 400;

/** 宝石表按 id 索引（模块级缓存，配置是静态的） */
const GEM_BY_ID = (() => {
  const m = {};
  for (const g of GEM_KINDS) m[g.id] = g;
  return m;
})();

// ---------- 塔型键重命名迁移 ----------
// 存档里有三张表以**塔型**为键：codex（图签等级）、socketed（已嵌宝石）、lineup（登场池）。
// 塔改名时内部键会跟着改，所以旧键必须搬过来 —— 否则玩家会静默掉图签等级、丢已嵌的宝石。
// 每加一条：旧键 → 新键。
const TYPE_ALIAS = {
  graphic: 'parallel',   // 2026-09：「图形塔」更名为「平行塔」（与塔族统称撞车）
};

/** 按 TYPE_ALIAS 把旧键搬到新键；返回浅拷贝，不改调用方传进来的对象 */
function aliasTable(tbl) {
  const out = {};
  if (!tbl || typeof tbl !== 'object') return out;
  for (const k of Object.keys(tbl)) out[TYPE_ALIAS[k] || k] = tbl[k];
  return out;
}

/**
 * 宝石等级夹取：非法值一律回落 Lv.1（坏档不许造出 0 级 / 负级 / 小数级宝石）。
 * 转发 config.clampGemLevel —— 唯一的夹取实现在那里（存档侧与 gems 侧共用一份，
 * 否则改等级上限时两边必然打架）。
 */
function clampGemLv(v) {
  return clampGemLevel(v);
}

/**
 * 宝石 {kind, lv} 归一化 → { kind: 家族 id, lv: 等级 }；未知 id 返回 null（调用方据此剔除坏档）。
 * 转发 config.resolveGem —— **唯一**的折算实现：2026-09-19 之前的旧 kind
 * （fire_ruby / magma_ruby / void_opal …）在这里被搬成"家族 + 等级"，老存档不掉东西。
 */
function normalizeGem(kind, lv) {
  const r = resolveGem(kind, lv);
  return r ? { kind: r.id, lv: r.lv } : null;
}

/** 一份全新的存档 */
function createDefaultMeta() {
  const codex = {};
  // 默认解锁的 5 种基础塔（图签 Lv.1）
  for (const type of SHOP_TOWERS) codex[type] = 1;
  // 新档赠送的宝石（让背包一开局就不是空的）
  const gems = [];
  const starters = GEM.starterGems || [];
  for (let i = 0; i < starters.length; i++) {
    if (GEM_BY_ID[starters[i]]) gems.push({ uid: 'g' + (i + 1), kind: starters[i], lv: 1 });
  }
  return {
    version: 1,
    points: 0,                             // 特殊积分
    talentPoints: 0,                       // 天赋点
    codex,                                 // { [towerType]: level }，level>=1 即已解锁
    lineup: SHOP_TOWERS.slice(),           // 登场池（有序）
    talents: {},                           // { [talentId]: level }
    levels: { cleared: {}, best: {} },     // cleared[id]=通关次数 / best[id]=最高波次
    selectedLevel: 1,
    gems: gems,                            // 背包里的宝石（未嵌入）：[{ uid, kind, lv }]
    gemSeq: gems.length,                   // uid 自增序号（保证 uid 唯一）
    socketed: {},                          // { [towerType]: [{kind,lv}|null, ...] } 已嵌入的宝石（长度 = GEM.maxSlots）
    bagSlots: GEM.bagSlots,                // 背包已解锁格数（默认 24 = 每行 8 格 × 3 行）
    stages: {},                            // { [towerType]: number } 该类型达到过的最高星级（0~MAX_STAGE）；功能性宝石"镇守宝石"依赖它判断 3★
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
  const rawCodex = aliasTable(raw.codex);   // 旧塔型键在此自动搬到新键
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
    const type = TYPE_ALIAS[t] || t;   // 旧塔型键迁移（登场池是"塔型字符串数组"）
    if (!TOWER_DEFS[type] || seen[type]) continue;
    if (!out.codex[type]) continue;
    seen[type] = 1;
    out.lineup.push(type);
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

  // ---- 宝石：背包格数 / 背包内容 / 已嵌入的槽位 ----
  // 袋口：只在 [bagSlots, bagMaxSlots] 之间取值（坏档也不会出现 3 格或 999 格）
  const rawBag = Number(raw.bagSlots);
  out.bagSlots = isFinite(rawBag)
    ? Math.max(GEM.bagSlots, Math.min(GEM.bagMaxSlots, Math.floor(rawBag)))
    : GEM.bagSlots;

  // 背包内容：只保留"存在的宝石家族"，uid 去重；超出袋口的部分直接丢弃（不可能通过正常玩法产生）
  out.gems = [];
  const rawGems = Array.isArray(raw.gems) ? raw.gems : [];
  const seenUid = {};
  let seq = 0;
  for (const item of rawGems) {
    if (out.gems.length >= out.bagSlots) break;
    // 旧档可能存着 2026-09-19 之前的 kind（fire_ruby / void_opal …）——
    // resolveGem 把"旧 kind + lv"折算成 {家族, 等级}，玩家不会掉宝石、也不会掉等级。
    const g = item ? normalizeGem(item.kind, item.lv) : null;
    if (!g) continue;
    let uid = (item && typeof item.uid === 'string' && item.uid) ? item.uid : '';
    if (!uid || seenUid[uid]) uid = 'g' + (++seq + rawGems.length);
    seenUid[uid] = 1;
    out.gems.push({ uid: uid, kind: g.kind, lv: g.lv });
  }
  const rawSeq = Number(raw.gemSeq);
  out.gemSeq = Math.max(
    isFinite(rawSeq) ? Math.floor(rawSeq) : 0,
    out.gems.length,
    seq + rawGems.length
  );

  // 已嵌入的槽位：仅保留已解锁的塔型 + 合法宝石 + 不超过自身槽位数
  // 槽位条目兼容三代格式：最早是字符串 'ruby'（无等级概念 → Lv.1），
  // 2026-09-18 起是 { kind, lv }，2026-09-19 起 kind 一律折算成家族 id。
  // 统一搬进新格式，读档侧永远只见 { kind: 家族, lv: 等级 }。
  out.socketed = {};
  const rawSock = aliasTable(raw.socketed);   // 旧塔型键在此自动搬到新键
  for (const type of TOWER_ORDER) {
    const arr = Array.isArray(rawSock[type]) ? rawSock[type] : null;
    if (!arr) continue;
    const maxN = Math.min(GEM.maxSlots, out.codex[type] || 0);
    const slots = [];
    for (let i = 0; i < GEM.maxSlots; i++) {
      if (i < maxN && arr[i]) {
        const e = arr[i];
        const g = (typeof e === 'string')
          ? normalizeGem(e, 1)
          : (e ? normalizeGem(e.kind, e.lv) : null);
        if (g) { slots.push({ kind: g.kind, lv: g.lv }); continue; }
      }
      slots.push(null);
    }
    // 全空就不存这条记录（保持存档干净）
    if (slots.some((k) => !!k)) out.socketed[type] = slots;
  }

  // 各塔型达到过的最高星级（功能性宝石判定 3★ 用；只保留合法塔型 + 合法星级）
  out.stages = {};
  if (raw && raw.stages && typeof raw.stages === 'object') {
    for (const type of TOWER_ORDER) {
      const v = Number(raw.stages[type]);
      if (TOWER_DEFS[type] && isFinite(v) && v > 0) out.stages[type] = Math.min(MAX_STAGE, Math.floor(v));
    }
  }

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

// ==================== 宝石 / 背包 ====================

/** 背包里的宝石（未嵌入）：返回副本，避免调用方直接改存档数组 */
function gemList() {
  return get().gems.map((g) => ({ uid: g.uid, kind: g.kind, lv: g.lv || 1 }));
}

/** 背包已解锁格数 */
function bagSlots() {
  return get().bagSlots;
}

/** 背包还能不能再解锁（+10 格） */
function canExpandBag() {
  const m = get();
  return m.bagSlots < GEM.bagMaxSlots;
}

/**
 * 看广告解锁背包：+bagStep 格。
 * @returns {{ok:boolean, slots?:number, reason?:string}}
 */
function expandBag() {
  const m = get();
  if (m.bagSlots >= GEM.bagMaxSlots) return { ok: false, reason: 'max' };
  m.bagSlots = Math.min(GEM.bagMaxSlots, m.bagSlots + GEM.bagStep);
  save(true);
  return { ok: true, slots: m.bagSlots };
}

/**
 * 把一颗新宝石放进背包（掉落入口）。
 * @param {string} kind 宝石种类 id
 * @param {number} [lv] 宝石等级（掉落永远是 1；合成产物会带更高等级进来）
 * @returns {{ok:boolean, gem?:object, reason?:string}} 背包满时 ok=false
 */
function addGem(kind, lv) {
  const m = get();
  const g = normalizeGem(kind, lv === undefined ? 1 : lv);
  if (!g) return { ok: false, reason: 'unknown' };
  if (m.gems.length >= m.bagSlots) return { ok: false, reason: 'full' };
  m.gemSeq = (m.gemSeq || 0) + 1;
  const gem = { uid: 'g' + m.gemSeq, kind: g.kind, lv: g.lv };
  m.gems.push(gem);
  save();
  return { ok: true, gem: gem };
}

/**
 * 一次性把 count 颗同类宝石放进背包（通关/失败结算奖励用）。
 * 背包满则能放几颗放几颗，绝不"掉了但看不见"；返回实际放入数量。
 * @param {string} kind 宝石种类 id
 * @param {number} count 想放几颗
 * @param {number} [lv] 宝石等级（默认 1）
 * @returns {{ok:boolean, added:number, reason?:string}} added<count 时 ok=false（背包满）
 */
function addGemsByKind(kind, count, lv) {
  const m = get();
  const g = normalizeGem(kind, lv === undefined ? 1 : lv);
  if (!g) return { ok: false, added: 0, reason: 'unknown' };
  let added = 0;
  for (let i = 0; i < (count || 0); i++) {
    if (m.gems.length >= m.bagSlots) break;   // 背包满，停止放入
    m.gemSeq = (m.gemSeq || 0) + 1;
    m.gems.push({ uid: 'g' + m.gemSeq, kind: g.kind, lv: g.lv });
    added++;
  }
  if (added > 0) save();
  return { ok: added === count, added: added, reason: added < count ? 'full' : undefined };
}

/** 背包里宝石总数（容量占用判定用） */
function bagGemCount() {
  return get().gems.length;
}

/** 按 uid 取出（不删除）背包里的宝石 */
function findGem(uid) {
  return get().gems.filter((g) => g.uid === uid)[0] || null;
}

/**
 * 该塔型的嵌入槽数量 = 图签等级（1~5），未解锁 = 0。
 * 这就是需求里的"图签每升级一次解锁一个嵌入宝石槽，最多 5 个"。
 */
function socketCount(type) {
  const lv = codexLevel(type);
  if (lv <= 0) return 0;
  return Math.min(GEM.maxSlots, lv);
}

/**
 * 该塔型的槽位状态（长度固定 GEM.maxSlots，便于 UI 定长绘制）。
 * @returns {Array<{index:number, kind:string|null, lv:number, unlocked:boolean}>}
 */
function gemSockets(type) {
  const n = socketCount(type);
  const arr = (get().socketed[type] || []);
  const out = [];
  for (let i = 0; i < GEM.maxSlots; i++) {
    const e = (i < n && arr[i]) ? arr[i] : null;
    // 兼容旧档字符串条目（无等级 → Lv.1）
    const kind = e ? ((typeof e === 'string') ? e : e.kind) : null;
    const lv = e ? ((typeof e === 'string') ? 1 : clampGemLv(e.lv)) : 1;
    out.push({
      index: i,
      kind: (kind && GEM_BY_ID[kind]) ? kind : null,
      lv: lv,
      unlocked: i < n,
    });
  }
  return out;
}

/** 已嵌入的宝石种类数组（长度 ≤ socketCount，按槽位顺序，忽略空槽） */
function embeddedGems(type) {
  return gemSockets(type).filter((s) => !!s.kind).map((s) => s.kind);
}

/** 已嵌入的宝石条目 [{kind, lv}]（加成按等级缩放，战斗与面板共用） */
function embeddedEntries(type) {
  return gemSockets(type).filter((s) => !!s.kind).map((s) => ({ kind: s.kind, lv: s.lv || 1 }));
}

// ==================== 各塔型"达到过的最高星级"（持久化）====================
// 功能性宝石「镇守宝石」的 3★ 判定依赖它：玩家一旦把某类型塔进阶到 3★（战斗中合成），
// 之后这个值就永久是 3，即使当前这局没放该塔、即使这局没上场。与战斗 setStage 同一处写入
// （见 src/tower.js 的 setStage → meta.recordStage），保证"达到过 3★"可追溯。
/** 该塔型历史最高星级（未记录 = 0） */
function getStage(type) {
  const m = get();
  return (m.stages && m.stages[type]) || 0;
}

/**
 * 记录某塔型达到过的星级（只升不降，保留历史最高）。
 * @param {string} type 塔类型（非法类型直接忽略，绝不写脏数据）
 * @param {number} stars 本次星级
 */
function recordStage(type, stars) {
  if (!type || !TOWER_DEFS[type]) return;
  const s = Math.max(0, Math.min(MAX_STAGE, Math.floor(Number(stars) || 0)));
  const m = get();
  if (!m.stages) m.stages = {};
  if (!m.stages[type] || s > m.stages[type]) {
    m.stages[type] = s;
    save(true);
  }
}

/**
 * 嵌入宝石：从背包移除 → 写进该塔型的槽位（宝石与技能绑定，背包里不再显示）。
 * 槽位记录 {kind, lv} —— 加成按等级缩放，取出时等级也要原样带回背包。
 * @returns {{ok:boolean, kind?:string, reason?:string}}
 */
function embedGem(type, index, uid) {
  const m = get();
  if (!TOWER_DEFS[type]) return { ok: false, reason: 'unknown' };
  const n = socketCount(type);
  if (index < 0 || index >= n) return { ok: false, reason: 'locked' };
  const gem = m.gems.filter((g) => g.uid === uid)[0];
  if (!gem) return { ok: false, reason: 'nogem' };
  const slots = m.socketed[type] || [];
  for (let i = 0; i < GEM.maxSlots; i++) if (!slots[i]) slots[i] = null;
  if (slots[index]) return { ok: false, reason: 'occupied' };
  // 需求 2026-09-19：同类宝石全塔唯一 —— 该塔系【任意】槽位已嵌同家族宝石即拒绝
  //（不只目标槽；槽位条目读档时已折算成家族 id，直接比对 kind 即可）
  for (let i = 0; i < slots.length; i++) {
    const s = slots[i];
    if (s && s.kind === gem.kind) return { ok: false, reason: 'same_kind' };
  }

  slots[index] = { kind: gem.kind, lv: clampGemLv(gem.lv) };
  m.socketed[type] = slots;
  m.gems = m.gems.filter((g) => g.uid !== uid);   // ⚠️ 从这里开始它不在背包里了
  save(true);
  return { ok: true, kind: gem.kind, lv: slots[index].lv };
}

/**
 * 取出槽里的宝石，放回背包（背包满则拒绝，绝不吞掉玩家的宝石）。
 * @returns {{ok:boolean, kind?:string, reason?:string}}
 */
function takeGem(type, index) {
  const m = get();
  const slots = m.socketed[type];
  const entry = slots ? slots[index] : null;
  if (!entry) return { ok: false, reason: 'empty' };
  if (m.gems.length >= m.bagSlots) return { ok: false, reason: 'full' };
  const g = (typeof entry === 'string') ? normalizeGem(entry, 1) : normalizeGem(entry.kind, entry.lv);
  if (!g) { slots[index] = null; return { ok: false, reason: 'empty' }; }
  slots[index] = null;
  if (!slots.some((k) => !!k)) delete m.socketed[type];
  m.gemSeq = (m.gemSeq || 0) + 1;
  m.gems.push({ uid: 'g' + m.gemSeq, kind: g.kind, lv: g.lv });
  save(true);
  return { ok: true, kind: g.kind, lv: g.lv };
}

/** 宝石定义（配置表查表；旧 kind 折算到家族；未知返回 null） */
function gemDef(kind) {
  if (GEM_BY_ID[kind]) return GEM_BY_ID[kind];
  const r = resolveGem(kind, 1);
  return r ? (GEM_BY_ID[r.id] || null) : null;
}

// ---------- 合成宝石（需求 2026-09-18）----------
// 规则：minCount 颗【同级】起 → 基础成功率 baseRate%；每额外多 1 颗同级 +perExtra%（封顶 maxRate%）。
// 成功 → 产物 = 所选材料范围内【随机一种家族】、等级 = 材料等级 + 1。
// 失败 → 材料照常消耗（合成浮层上有明示，玩家自己权衡）。
// ⚠️ 成功率与产物法则的唯一实现在 src/config.js（gemSynthRate / gemSynthResult）——
//    本文件只负责"校验 + 扣材料 + 入账"，别在这里再写一份产物规则
//    （旧实现就是在这里随手滚了一个 tier，才让 3 颗 Lv.1 合出 tier-5 宝石）。

/** 选 n 颗同级宝石的合成成功率（0~1） */
function synthRate(count) {
  return gemSynthRate(count);
}

/**
 * 执行一次合成：消耗所选宝石，按成功率产出 +1 级宝石。
 *
 * 校验（全过才动存档）：
 *   · 至少 minCount 颗、uid 合法且不重复
 *   · 全部同级（lv 一致）—— 不同级的混选在 UI 层就被拦住，这里再兜一道底
 *
 * 产物空间：材料 ≥3 颗被消耗、至多 +1 颗产出，所以背包永远不会因合成而溢出。
 *
 * @param {string[]} uids 所选宝石 uid 列表
 * @returns {{ok:boolean, success?:boolean, rate?:number, gem?:object, reason?:string}}
 */
function synthesizeGems(uids) {
  const m = get();
  const list = Array.isArray(uids) ? uids : [];
  if (list.length < GEM.synth.minCount) return { ok: false, reason: 'count' };

  const chosen = [];
  const seen = {};
  for (const uid of list) {
    if (seen[uid]) return { ok: false, reason: 'dup' };
    seen[uid] = 1;
    const g = m.gems.filter((x) => x.uid === uid)[0];
    if (!g) return { ok: false, reason: 'nogem' };
    chosen.push(g);
  }
  const lv = clampGemLv(chosen[0].lv);
  if (chosen.some((g) => clampGemLv(g.lv) !== lv)) return { ok: false, reason: 'level' };
  // 到顶的宝石不能当材料（材料同级 → 同级都到顶；产物法则也会返回 null）
  if (!gemSynthResult(chosen.map((g) => g.kind), lv)) return { ok: false, reason: 'maxlevel' };

  const rate = synthRate(chosen.length);
  const success = Math.random() < rate;

  // 无论成败，材料都消耗掉
  m.gems = m.gems.filter((g) => !seen[g.uid]);

  let made = null;
  if (success) {
    // 产物：家族取自材料范围（随机一种）、等级 = 材料等级 + 1（法则见 config.gemSynthResult）
    const r = gemSynthResult(chosen.map((g) => g.kind), lv);
    if (r) {
      m.gemSeq = (m.gemSeq || 0) + 1;
      made = { uid: 'g' + m.gemSeq, kind: r.kind, lv: r.lv };
      m.gems.push(made);
    }
  }
  save(true);
  return { ok: true, success: success, rate: rate, gem: made };
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

/**
 * 学习天赋到第 level 级需要多少天赋点。
 *
 * 口径（2026-09-18 定稿）：**花费 = 等级 × 基础花费**，线性增长。
 *   基础花费 = def.cost（配置里没写就用 TALENT_COST.default），
 *   于是 cost=1 的天赋 Lv.1..Lv.10 = 1,2,…,10；cost=2 的 = 2,4,…,20。
 *
 * ⚠️ 唯一真源：talents.js 的按钮报价与 learnTalent 的扣费都必须调这里，
 *    别再各自去读"每条天赋手写的那串价格"（旧静态价格表已随本次改造删除，
 *    probe-talent.js 会扫源码守住这条）。
 *
 * @param {string} id 天赋 id
 * @param {number} level 目标等级（1 起；会夹到 [1, def.max]）
 * @returns {number} 需要的天赋点；天赋不存在返回 Infinity（视为不可学）
 */
function talentCost(id, level) {
  const def = TALENTS.filter((t) => t.id === id)[0];
  if (!def) return Infinity;
  const base = (typeof def.cost === 'number' && def.cost > 0)
    ? def.cost
    : (TALENT_COST.default || 1);
  const n = Math.floor(Number(level) || 0);
  if (!isFinite(n) || n <= 0) return 0;
  return Math.min(def.max, n) * base;
}

/** 学习下一级天赋 */
function learnTalent(id) {
  const m = get();
  const def = TALENTS.filter((t) => t.id === id)[0];
  if (!def) return { ok: false, reason: 'unknown' };
  const cur = m.talents[id] || 0;
  if (cur >= def.max) return { ok: false, reason: 'maxed', level: cur };

  const cost = talentCost(id, cur + 1);
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
  // 存档归一化（迁移 + 坏档兜底）。导出是为了让探针能直接喂一份"恶意存档"验证
  // 它不会造出非法状态（越界槽位 / 未知宝石 / 重复 uid），而不是靠手改存档去撞。
  normalize,
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
  // 宝石 / 背包
  gemList,
  bagSlots,
  clampGemLv,
  normalizeGem,
  canExpandBag,
  expandBag,
  addGem,
  addGemsByKind,
  bagGemCount,
  // 各塔型历史最高星级（功能性宝石"镇守宝石"判定用）
  getStage,
  recordStage,
  findGem,
  socketCount,
  gemSockets,
  embeddedGems,
  embeddedEntries,
  embedGem,
  takeGem,
  gemDef,
  synthRate,
  synthesizeGems,
  // 天赋
  talentLevel,
  talentCost,
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
