// Tomecraft progression rules (M3): wizard XP and levels, Gold and Arcane Essence, idempotent rewards,
// familiar Mastery from real battle contribution, Ascension spending, ability modifiers, saved loadouts.
// Pure logic (GDD §6, §13, §17): runs in the browser now, on a server later.

export const PROFILE_VERSION = 1;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

export function newProfile(cfg) {
  return { version: PROFILE_VERSION, xp: 0, gold: 0, essence: 0, processed: [], familiars: {},
    presets: Array(cfg.progression.presets).fill(null), stats: { battles: 0, bestWave: 0, kills: 0 } };
}
export function loadProfile(cfg, raw) {
  const p = newProfile(cfg);
  if (!raw || raw.version !== PROFILE_VERSION) return p;
  p.xp = Math.max(0, +raw.xp || 0); p.gold = Math.max(0, +raw.gold || 0); p.essence = Math.max(0, +raw.essence || 0);
  p.processed = (raw.processed || []).slice(-500);
  for (const [fid, f] of Object.entries(raw.familiars || {})) if (cfg.familiars[fid]) {
    const mod = f.modifierId && cfg.modifiers[f.modifierId]?.abilityId === cfg.familiars[fid].abilityId ? f.modifierId : null;
    p.familiars[fid] = { masteryXp: Math.max(0, +f.masteryXp || 0), modifierId: mod };
  }
  (raw.presets || []).slice(0, p.presets.length).forEach((x, i) => { if (Array.isArray(x) && x.length === 3 && x.every((f) => cfg.familiars[f])) p.presets[i] = [...x]; });
  Object.assign(p.stats, raw.stats || {});
  return p;
}
const fam = (p, fid) => (p.familiars[fid] ||= { masteryXp: 0, modifierId: null });

// ---- wizard level ----
export function xpForLevel(cfg, level) { // xp needed to go from `level` to level+1
  const c = cfg.progression.xpCurve; return Math.round(c.base * c.growth ** (level - 1));
}
export function levelInfo(cfg, xp) {
  let level = 1, left = xp;
  while (level < cfg.progression.levelCap && left >= xpForLevel(cfg, level)) { left -= xpForLevel(cfg, level); level++; }
  return { level, into: left, need: level < cfg.progression.levelCap ? xpForLevel(cfg, level) : 0 };
}

// ---- mastery ----
export function masteryInfo(cfg, xp) {
  const t = cfg.progression.mastery.cumulativeXp;
  let level = 1; for (let i = 1; i < t.length; i++) if (xp >= t[i]) level = i + 1;
  return { level, xp, nextAt: level < t.length ? t[level] : null, prevAt: t[level - 1] };
}

/** Battle rewards. No reward for a run with no kills (AFK); Mastery only for familiars that actually contributed. */
export function battleRewards(cfg, result) {
  const B = cfg.progression.battle, M = cfg.progression.mastery;
  const out = { xp: 0, gold: 0, essence: 0, mastery: {} };
  if (result.kills < B.minKillsForReward) return out;
  const waves = Math.min(result.wavesCleared, B.maxWavesRewarded);
  out.xp = B.xpPerKill * result.kills + B.xpPerWave * waves;
  out.gold = B.goldPerKill * result.kills + B.goldPerWave * waves;
  out.essence = B.essencePerWave * waves;
  for (const s of result.slots) {
    const contrib = s.damage * M.xpPerDamage + s.absorbed * M.xpPerAbsorb + s.hits * M.xpPerHit;
    if (contrib <= 0) continue; // casting into empty space earns nothing (GDD §6)
    out.mastery[s.familiarId] = Math.round(Math.min(M.perBattleCap, M.participationXp + contrib));
  }
  return out;
}
export function bindingRewards(cfg, res) {
  const R = cfg.progression.binding;
  if (res.outcome !== 'bound') return { xp: 0, gold: 0, essence: 0, mastery: {} };
  return res.first ? { xp: R.firstXp, gold: R.firstGold, essence: 0, mastery: {} } : { xp: R.dupeXp, gold: R.dupeGold, essence: R.dupeEssence, mastery: {} };
}

/** Apply a reward exactly once per transaction id (GDD §17 idempotency). Returns level-ups for the results screen. */
export function grant(cfg, p, txId, d) {
  if (p.processed.includes(txId)) return { applied: false };
  p.processed.push(txId); if (p.processed.length > 500) p.processed.shift();
  const before = levelInfo(cfg, p.xp).level;
  p.xp += d.xp || 0; p.gold += d.gold || 0; p.essence += d.essence || 0;
  const mastery = {};
  for (const [fid, x] of Object.entries(d.mastery || {})) {
    const f = fam(p, fid), from = masteryInfo(cfg, f.masteryXp).level;
    f.masteryXp += x; mastery[fid] = { gained: x, from, to: masteryInfo(cfg, f.masteryXp).level };
  }
  return { applied: true, wizard: { from: before, to: levelInfo(cfg, p.xp).level }, mastery };
}

// ---- ascension (credits live in the collection's owned record) ----
export function ascensionCost(cfg, col, fid) {
  const o = col.owned[fid]; if (!o) return null;
  const rank = o.ascension || 0, inc = cfg.ascension.incrementalCredits;
  if (rank >= inc.length - 1) return { rank, maxed: true };
  const need = inc[rank + 1], fromCredits = Math.min(need, o.credits), short = need - fromCredits;
  return { rank, next: rank + 1, need, have: o.credits, short, essenceForShort: short * cfg.progression.ascension.essencePerCredit, maxed: false };
}
/** Spend credits (and Universal Essence for any shortfall if allowed) to raise one rank. */
export function ascend(cfg, col, p, fid, useEssence) {
  const c = ascensionCost(cfg, col, fid);
  if (!c) return { ok: false, reason: 'not-owned' };
  if (c.maxed) return { ok: false, reason: 'maxed' };
  if (c.short > 0 && !useEssence) return { ok: false, reason: 'credits' };
  if (c.short > 0 && p.essence < c.essenceForShort) return { ok: false, reason: 'essence' };
  const o = col.owned[fid];
  o.credits -= c.need - c.short; if (c.short > 0) p.essence -= c.essenceForShort;
  o.ascension = c.next;
  return { ok: true, rank: c.next };
}

// ---- modifiers (sidegrades; free to change, GDD §6) ----
export function modifiersFor(cfg, fid) {
  const ab = cfg.familiars[fid].abilityId;
  return Object.entries(cfg.modifiers).filter(([, m]) => m.abilityId === ab).map(([id, m]) => ({ id, ...m }));
}
export function setModifier(cfg, p, fid, modId) {
  if (modId !== null) {
    const m = cfg.modifiers[modId];
    if (!m || m.abilityId !== cfg.familiars[fid].abilityId) return { ok: false, reason: 'wrong-ability' };
    if (masteryInfo(cfg, fam(p, fid).masteryXp).level < cfg.progression.mastery.branchAt) return { ok: false, reason: 'locked' };
  }
  fam(p, fid).modifierId = modId; return { ok: true };
}

const POTENCY_STATS = ['damage', 'chargeDamage', 'dps', 'shield'];
/** The ability as it plays: base → chosen modifier → Ascension potency (bounded, ~12.5% at max rank). */
export function effectiveAbility(cfg, col, p, fid) {
  const f = cfg.familiars[fid], ab = { ...cfg.abilities[f.abilityId], abilityId: f.abilityId };
  const modId = p.familiars[fid]?.modifierId, m = modId && cfg.modifiers[modId];
  if (m) {
    for (const [k, v] of Object.entries(m.mult || {})) if (k in ab) ab[k] *= v;
    for (const [k, v] of Object.entries(m.add || {})) if (k in ab) ab[k] += v;
    for (const [k, v] of Object.entries(m.set || {})) ab[k] = v;
  }
  const rank = col.owned[fid]?.ascension || 0, pot = 1 + rank * cfg.progression.ascension.potencyPerRank;
  for (const k of POTENCY_STATS) if (k in ab) ab[k] *= pot;
  if ('damageReductionPct' in ab) ab.damageReductionPct = clamp(ab.damageReductionPct, 0, 60);
  if ('slowPct' in ab) ab.slowPct = clamp(ab.slowPct, 0, cfg.status.slowCapPct);
  if ('count' in ab) ab.count = Math.max(1, Math.round(ab.count));
  ab.modifierName = m ? m.name : null; ab.ascension = rank;
  return ab;
}

export function savePreset(cfg, p, i, ids) {
  if (i < 0 || i >= p.presets.length || ids.length !== 3 || !ids.every((f) => cfg.familiars[f])) return false;
  p.presets[i] = [...ids]; return true;
}
