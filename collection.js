// Tomecraft collection rules (M2): encounters, binding outcome, ownership, duplicates.
// Pure logic, no rendering: runs in the browser now and on a server later (GDD §17: server owns spawn rolls and capture outcomes).

export const SAVE_VERSION = 1;

export function rngFrom(seed) {
  let s = seed >>> 0 || 1;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

export const rarityOf = (cfg, id) => cfg.rarities.find((r) => r.id === id);

export function newCollection() {
  return { version: SAVE_VERSION, owned: {}, seen: {}, encounters: [], processed: [], closed: [], nextId: 1, lastSpawnAt: 0, log: [] };
}

/** Load a saved collection, dropping anything that no longer matches the content config. */
export function loadCollection(cfg, raw) {
  const c = newCollection();
  if (!raw || raw.version !== SAVE_VERSION) return c;
  for (const [fid, o] of Object.entries(raw.owned || {})) if (cfg.familiars[fid]) c.owned[fid] = { firstAt: o.firstAt, credits: Math.max(0, o.credits | 0), captures: Math.max(1, o.captures | 0), locked: !!o.locked, ascension: Math.max(0, Math.min(cfg.ascension.incrementalCredits.length - 1, o.ascension | 0)) };
  for (const fid of Object.keys(raw.seen || {})) if (cfg.familiars[fid]) c.seen[fid] = true;
  c.encounters = (raw.encounters || []).filter((e) => cfg.familiars[e.familiarId]);
  c.processed = (raw.processed || []).slice(-300);
  c.closed = (raw.closed || []).slice(-500);
  c.nextId = raw.nextId || 1; c.lastSpawnAt = raw.lastSpawnAt || 0;
  return c;
}

/** Onboarding (GDD §16): three guaranteed starters, one per type, no travel needed. */
export function grantStarters(cfg, c, now) {
  for (const fid of cfg.starters) applyCapture(c, fid, `starter:${fid}`, now);
  return c;
}

/** Species weights: each rarity's share is split evenly across the species of that rarity in the pool. */
export function speciesWeights(cfg, pool = Object.keys(cfg.familiars)) {
  const byR = {};
  for (const fid of pool) (byR[cfg.familiars[fid].rarity] ||= []).push(fid);
  const w = {};
  for (const [r, list] of Object.entries(byR)) for (const fid of list) w[fid] = rarityOf(cfg, r).share / list.length;
  const total = Object.values(w).reduce((a, b) => a + b, 0);
  for (const k of Object.keys(w)) w[k] /= total;
  return w;
}

export function rollSpecies(cfg, rng, pool) {
  const w = speciesWeights(cfg, pool);
  let x = rng();
  for (const [fid, p] of Object.entries(w)) { if ((x -= p) <= 0) return fid; }
  return Object.keys(w).at(-1);
}

export function spawnEncounter(cfg, c, rng, now, source = 'wilds') {
  const active = c.encounters.filter((e) => e.state === 'open' && e.expiresAt > now);
  if (active.length >= cfg.explore.maxActive) return null;
  const familiarId = rollSpecies(cfg, rng);
  const f = cfg.familiars[familiarId];
  const e = { id: `enc${c.nextId++}`, familiarId, rarity: f.rarity, type: f.type, source, createdAt: now,
    expiresAt: now + cfg.capture.encounterLifetimeSec * 1000, attemptsLeft: cfg.capture.attempts, state: 'open', engagedUntil: 0 };
  c.encounters.push(e); c.seen[familiarId] = true; c.lastSpawnAt = now;
  return e;
}

/** Engaging freezes the encounter and grants a completion window (GDD §5: never chase a disappearing encounter). */
export function engage(cfg, c, encounterId, now) {
  const e = c.encounters.find((x) => x.id === encounterId);
  if (!e || e.state !== 'open') return null;
  if (e.expiresAt <= now && e.engagedUntil <= now) return null;
  e.engagedUntil = Math.max(e.engagedUntil, now + cfg.capture.graceSec * 1000);
  e.expiresAt = Math.max(e.expiresAt, e.engagedUntil);
  return e;
}

/** Disclosed bounds: zero skill gives minChance; perfect skill gives the rarity's base + half the skill bonus (capped). Linear between. */
export function bindChance(cfg, rarity, skill) {
  const r = rarityOf(cfg, rarity), C = cfg.capture;
  const s = Math.max(0, Math.min(1, skill));
  const top = Math.min(C.maxChance, r.bindBase + C.skillBonus * 0.5);
  return C.minChance + (Math.max(C.minChance, top) - C.minChance) * s;
}

/**
 * Resolve one binding attempt. Idempotent: resolving the same encounter+attempt twice returns the stored result.
 * The roll happens here (server side in production), never in the client challenge.
 */
export function resolveBinding(cfg, c, encounterId, attemptNo, skill, rng, now) {
  const key = `${encounterId}#${attemptNo}`;
  const done = c.log.find((l) => l.key === key);
  if (done) return done.result;
  const e = c.encounters.find((x) => x.id === encounterId);
  if (!e || e.state !== 'open') return { outcome: 'unavailable' };
  if (e.attemptsLeft <= 0) return { outcome: 'unavailable' };
  e.attemptsLeft--;
  const chance = bindChance(cfg, e.rarity, skill);
  const bound = rng() < chance;
  let result;
  if (bound) {
    e.state = 'bound';
    const r = applyCapture(c, e.familiarId, `bind:${e.id}`, now);
    result = { outcome: 'bound', familiarId: e.familiarId, rarity: e.rarity, chance, ...r };
  } else if (e.attemptsLeft <= 0) {
    e.state = 'fled';
    result = { outcome: 'fled', familiarId: e.familiarId, rarity: e.rarity, chance };
  } else result = { outcome: 'resisted', familiarId: e.familiarId, rarity: e.rarity, chance, attemptsLeft: e.attemptsLeft };
  if (e.state !== 'open') { c.closed.push(e.id); if (c.closed.length > 500) c.closed.shift(); }
  c.log.push({ key, result }); if (c.log.length > 100) c.log.shift();
  return result;
}

/** First capture unlocks the species (and its ability); later captures add one duplicate credit. Idempotent per key. */
export function applyCapture(c, familiarId, key, now) {
  if (c.processed.includes(key)) return { first: false, duplicate: false, repeated: true, credits: c.owned[familiarId]?.credits ?? 0 };
  c.processed.push(key); if (c.processed.length > 300) c.processed.shift();
  c.seen[familiarId] = true;
  const o = c.owned[familiarId];
  if (!o) { c.owned[familiarId] = { firstAt: now, credits: 0, captures: 1, locked: false }; return { first: true, duplicate: false, credits: 0 }; }
  o.credits += 1; o.captures += 1;
  return { first: false, duplicate: true, credits: o.credits };
}

/** Ascension progress from credits (display in M2; spending credits arrives in M3). */
export function ascensionInfo(cfg, credits) {
  const inc = cfg.ascension.incrementalCredits;
  let rank = 0, need = 0;
  for (let i = 1; i < inc.length; i++) { if (credits >= need + inc[i]) { need += inc[i]; rank = i; } else break; }
  const next = rank + 1 < inc.length ? need + inc[rank + 1] : null;
  return { possibleRank: rank, rankName: cfg.ascension.ranks[rank], nextAt: next };
}

export function pruneEncounters(c, now) {
  c.encounters = c.encounters.filter((e) => e.state === 'open' ? (e.expiresAt > now || e.engagedUntil > now) : now - e.createdAt < 60_000);
}

export const ownedIds = (c) => Object.keys(c.owned);

/** Add a map spawn as an encounter when the player engages it. Bound or fled map spawns never come back. */
export function registerWorldEncounter(c, enc) {
  if (c.closed.includes(enc.id)) return null;
  const have = c.encounters.find((e) => e.id === enc.id);
  if (have) return have.state === 'open' ? have : null;
  c.encounters.push(enc); c.seen[enc.familiarId] = true;
  return enc;
}
