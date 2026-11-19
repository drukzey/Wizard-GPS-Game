// Tomecraft Sanctuary rules (M5): gear (craft, upgrade, equip), facilities, decor placement, research.
// Pure logic (GDD §7, §12, §14). Gold, Essence and materials live in the profile; everything else in `home`.

export const HOME_VERSION = 1;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

export function newHome(cfg) {
  const h = { version: HOME_VERSION, nextUid: 1, items: [], equipped: {}, recipes: [...cfg.gear.starterRecipes],
    facilities: Object.fromEntries(Object.keys(cfg.sanctuary.facilities).map((k) => [k, 1])),
    decor: { owned: {}, placed: [] }, research: [] };
  for (const b of cfg.gear.starterItems) equip(cfg, h, addItem(h, b).uid);
  return h;
}
export function loadHome(cfg, raw) {
  if (!raw || raw.version !== HOME_VERSION) return newHome(cfg);
  const h = newHome(cfg);
  h.items = (raw.items || []).filter((i) => cfg.gear.bases[i.baseId]).map((i) => ({ uid: i.uid | 0, baseId: i.baseId,
    tier: clamp(i.tier | 0, 0, cfg.gear.tiers.length - 1), level: Math.max(1, i.level | 0) }));
  h.nextUid = Math.max(raw.nextUid | 0, ...h.items.map((i) => i.uid + 1), 1);
  h.equipped = {};
  for (const [slot, uid] of Object.entries(raw.equipped || {})) { const it = h.items.find((i) => i.uid === uid); if (it && cfg.gear.bases[it.baseId].slot === slot) h.equipped[slot] = uid; }
  if (!h.equipped.weapon) { const w = h.items.find((i) => cfg.gear.bases[i.baseId].slot === 'weapon') || addItem(h, cfg.gear.starterItems[0]); h.equipped.weapon = w.uid; }
  h.recipes = [...new Set([...cfg.gear.starterRecipes, ...(raw.recipes || []).filter((r) => cfg.gear.bases[r])])];
  for (const k of Object.keys(h.facilities)) h.facilities[k] = clamp((raw.facilities || {})[k] | 0 || 1, 1, cfg.sanctuary.facilityCosts[k].length);
  for (const [k, n] of Object.entries(raw.decor?.owned || {})) if (cfg.sanctuary.decor[k]) h.decor.owned[k] = Math.max(0, n | 0);
  h.research = (raw.research || []).filter((id) => cfg.research.projects.some((p) => p.id === id));
  for (const d of raw.decor?.placed || []) placeDecor(cfg, h, d.id, d.x, d.z, d.rot);
  return h;
}

// ---- costs and wallet (gold + materials on the profile) ----
const have = (prof, k) => (k === 'gold' ? prof.gold : k === 'essence' ? prof.essence : prof.materials[k] || 0);
export const canAfford = (prof, cost) => Object.entries(cost || {}).every(([k, v]) => have(prof, k) >= v);
function pay(prof, cost) {
  for (const [k, v] of Object.entries(cost || {})) { if (k === 'gold') prof.gold -= v; else if (k === 'essence') prof.essence -= v; else prof.materials[k] -= v; }
}
function spend(prof, cost) { if (!canAfford(prof, cost)) return false; pay(prof, cost); return true; }

// ---- gear ----
function addItem(h, baseId) { const it = { uid: h.nextUid++, baseId, tier: 0, level: 1 }; h.items.push(it); return it; }
const item = (h, uid) => h.items.find((i) => i.uid === uid);
export const tierCap = (cfg, tier) => (tier + 1) * cfg.gear.levelsPerTier;
/** Highest tier the Forge can work: Apprentice at level 1, Adept at 2, Enchanted at 3. */
export const forgeTier = (cfg, h) => Math.min(cfg.gear.tiers.length - 1, h.facilities.forge - 1);

export function craftCost(cfg, baseId) { return cfg.gear.craftCost[cfg.gear.bases[baseId].slot]; }
export function craft(cfg, h, prof, baseId) {
  if (!h.recipes.includes(baseId)) return { ok: false, reason: 'recipe' };
  if (!spend(prof, craftCost(cfg, baseId))) return { ok: false, reason: 'cost' };
  return { ok: true, item: addItem(h, baseId) };
}
/** Next step for an item: another level within its tier, or promotion to the next tier. Upgrades never fail or destroy. */
export function upgradeInfo(cfg, h, uid) {
  const it = item(h, uid); if (!it) return null;
  if (it.level < tierCap(cfg, it.tier)) {
    const U = cfg.gear.upgradeCost, k = U.growth ** (it.level - 1);
    return { kind: 'level', cost: { gold: Math.round(U.gold * k), ore: Math.round(U.ore * k) } };
  }
  if (it.tier + 1 >= cfg.gear.tiers.length) return { kind: 'max' };
  const P = cfg.gear.promoteCost, k = P.growth ** it.tier;
  return { kind: 'promote', cost: { gold: Math.round(P.gold * k), arcaneStone: Math.round(P.arcaneStone * k) }, locked: it.tier + 1 > forgeTier(cfg, h) };
}
export function upgrade(cfg, h, prof, uid) {
  const u = upgradeInfo(cfg, h, uid), it = item(h, uid);
  if (!u || u.kind === 'max') return { ok: false, reason: 'max' };
  if (u.locked) return { ok: false, reason: 'forge' };
  if (!spend(prof, u.cost)) return { ok: false, reason: 'cost' };
  if (u.kind === 'level') it.level++; else { it.tier++; it.level++; }
  return { ok: true, item: it };
}
export function equip(cfg, h, uid) {
  const it = item(h, uid); if (!it) return false;
  h.equipped[cfg.gear.bases[it.baseId].slot] = uid; return true;
}
export function unequip(cfg, h, slot) { if (slot === 'weapon') return false; delete h.equipped[slot]; return true; } // a wizard always has a weapon

export const isUpside = (cfg, k, v) => (cfg.gear.lowerIsBetter.includes(k) ? v < 0 : v > 0);
/** An item's stat changes in percent. Only the upside grows with level; the trade-off stays (GDD §7). */
export function itemStats(cfg, it) {
  const b = cfg.gear.bases[it.baseId], out = {}, up = 1 + cfg.gear.bonusPerLevel * (it.level - 1);
  for (const [k, v] of Object.entries(b.stats)) out[k] = isUpside(cfg, k, v) ? +(v * up).toFixed(1) : v;
  if (b.slot === 'weapon') out.damage = +(cfg.gear.weaponLevelDamagePct * (it.level - 1)).toFixed(1);
  return out;
}
/** Everything the battle needs from gear: player stats, the weapon, and a cooldown multiplier. Totals are capped (fair gear bounds). */
export function combatLoadout(cfg, h) {
  const tot = {};
  for (const uid of Object.values(h.equipped)) for (const [k, v] of Object.entries(itemStats(cfg, item(h, uid)))) tot[k] = (tot[k] || 0) + v;
  const cap = cfg.gear.statCapPct, pct = (k) => clamp(tot[k] || 0, -cap, cap) / 100;
  const P = cfg.player, player = {};
  for (const k of ['health', 'mana', 'manaRegen', 'stamina', 'staminaRegen', 'speed']) player[k] = P[k] * (1 + pct(k));
  const w = item(h, h.equipped.weapon), weaponId = cfg.gear.bases[w.baseId].weaponId;
  const weapon = { ...cfg.weapons[weaponId], damage: cfg.weapons[weaponId].damage * (1 + pct('damage')) };
  return { player, weapon, weaponId, cooldownMult: 1 + pct('cooldown'), totals: Object.fromEntries(Object.keys(tot).map((k) => [k, clamp(tot[k], -cap, cap)])) };
}
export const itemName = (cfg, it) => `${cfg.gear.tiers[it.tier]} ${cfg.gear.bases[it.baseId].name}`;

// ---- facilities ----
export function facilityEffect(cfg, h, id, level = h.facilities[id]) {
  const S = cfg.sanctuary;
  switch (S.facilities[id].effect) {
    case 'decor': return { decorSlots: S.decorSlotsBase + S.decorSlotsPerLevel * (level - 1) };
    case 'presets': return { presets: cfg.progression.presets + (level - 1) };
    case 'tier': return { tier: cfg.gear.tiers[Math.min(cfg.gear.tiers.length - 1, level - 1)] };
    case 'branches': return { branches: cfg.research.branches.slice(0, level) };
  }
}
export function facilityUpgradeCost(cfg, h, id) { return cfg.sanctuary.facilityCosts[id][h.facilities[id]] || null; }
export function upgradeFacility(cfg, h, prof, id) {
  const cost = facilityUpgradeCost(cfg, h, id);
  if (!cost) return { ok: false, reason: 'max' };
  if (!spend(prof, cost)) return { ok: false, reason: 'cost' };
  h.facilities[id]++;
  if (id === 'chamber') while (prof.presets.length < facilityEffect(cfg, h, 'chamber').presets) prof.presets.push(null);
  return { ok: true, level: h.facilities[id] };
}

// ---- plot and decor: grid placement with rotation and collision checks ----
export function blockedTiles(cfg, h, ignoreIndex = -1) {
  const S = cfg.sanctuary, set = new Set();
  for (const f of Object.values(S.facilities)) for (let x = 0; x < f.size[0]; x++) for (let z = 0; z < f.size[1]; z++) set.add(`${f.at[0] + x},${f.at[1] + z}`);
  h.decor.placed.forEach((d, i) => { if (i !== ignoreIndex) set.add(`${d.x},${d.z}`); });
  return set;
}
export function canPlace(cfg, h, x, z, ignoreIndex = -1) {
  const G = cfg.sanctuary.grid;
  return Number.isInteger(x) && Number.isInteger(z) && x >= 0 && z >= 0 && x < G && z < G && !blockedTiles(cfg, h, ignoreIndex).has(`${x},${z}`);
}
export const decorSlots = (cfg, h) => facilityEffect(cfg, h, 'dwelling').decorSlots;
export function buyDecor(cfg, h, prof, id) {
  const d = cfg.sanctuary.decor[id]; if (!d) return { ok: false, reason: 'unknown' };
  if (!spend(prof, d.cost)) return { ok: false, reason: 'cost' };
  h.decor.owned[id] = (h.decor.owned[id] || 0) + 1; return { ok: true };
}
const placedCount = (h, id) => h.decor.placed.filter((d) => d.id === id).length;
export function placeDecor(cfg, h, id, x, z, rot = 0) {
  if (!cfg.sanctuary.decor[id]) return { ok: false, reason: 'unknown' };
  if (placedCount(h, id) >= (h.decor.owned[id] || 0)) return { ok: false, reason: 'none-left' };
  if (h.decor.placed.length >= decorSlots(cfg, h)) return { ok: false, reason: 'full' };
  if (!canPlace(cfg, h, x, z)) return { ok: false, reason: 'blocked' };
  h.decor.placed.push({ id, x, z, rot: ((rot | 0) % 4 + 4) % 4 }); return { ok: true, index: h.decor.placed.length - 1 };
}
export function moveDecor(cfg, h, index, x, z) {
  if (!h.decor.placed[index] || !canPlace(cfg, h, x, z, index)) return false;
  Object.assign(h.decor.placed[index], { x, z }); return true;
}
export function rotateDecor(h, index) { const d = h.decor.placed[index]; if (!d) return false; d.rot = (d.rot + 1) % 4; return true; }
export function storeDecor(h, index) { return h.decor.placed.splice(index, 1).length === 1; } // back to storage, nothing lost

// ---- research (Library) ----
export function researchStat(cfg, prof, col, stat) {
  const owned = Object.keys(col.owned);
  switch (stat) {
    case 'species': return owned.length;
    case 'types': return new Set(owned.map((f) => cfg.familiars[f].type)).size;
    case 'kills': return prof.stats.kills || 0;
    case 'rifts': return Object.values(prof.stats.rifts || {}).reduce((a, b) => a + b, 0);
    case 'boss': return (prof.stats.rifts || {}).rift_godfall || 0;
    case 'mastery': { const t = cfg.progression.mastery.cumulativeXp; return Math.max(1, ...Object.values(prof.familiars).map((f) => t.filter((x) => f.masteryXp >= x).length)); }
    case 'ascension': return Math.max(0, ...Object.values(col.owned).map((o) => o.ascension || 0));
  }
  return 0;
}
export function researchState(cfg, h, prof, col) {
  const branches = facilityEffect(cfg, h, 'library').branches;
  return cfg.research.projects.map((p) => {
    const progress = Math.min(p.target, researchStat(cfg, prof, col, p.stat));
    const done = h.research.includes(p.id), open = branches.includes(p.branch);
    return { ...p, progress, done, open, ready: open && !done && progress >= p.target };
  });
}
export function completeResearch(cfg, h, prof, col, id) {
  const r = researchState(cfg, h, prof, col).find((x) => x.id === id);
  if (!r) return { ok: false, reason: 'unknown' };
  if (r.done) return { ok: false, reason: 'done' };
  if (!r.open) return { ok: false, reason: 'locked' };
  if (r.progress < r.target) return { ok: false, reason: 'progress' };
  if (!spend(prof, r.cost)) return { ok: false, reason: 'cost' };
  h.research.push(id);
  if (r.reward.recipe && !h.recipes.includes(r.reward.recipe)) h.recipes.push(r.reward.recipe);
  if (r.reward.essence) prof.essence += r.reward.essence;
  if (r.reward.arcaneStone) prof.materials.arcaneStone += r.reward.arcaneStone;
  return { ok: true, reward: r.reward };
}
