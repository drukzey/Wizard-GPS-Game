// Tomecraft GPS overworld rules (M6 alpha): map cells, deterministic spawns, range and speed checks.
// Pure logic. Spawns come from a hash of (cell, time window), so everyone in the same place sees the same
// familiars without a server, and nothing about the player's location leaves the device.
import { rollSpecies, rngFrom } from './collection.js?v=19';

const R_EARTH = 6371000;
export function distanceM(a, b) {
  const toR = Math.PI / 180, dLat = (b.lat - a.lat) * toR, dLon = (b.lon - a.lon) * toR;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * toR) * Math.cos(b.lat * toR) * Math.sin(dLon / 2) ** 2;
  return 2 * R_EARTH * Math.asin(Math.min(1, Math.sqrt(s)));
}

/** Cells are a fixed lat/lon grid (~cellM metres north-south); longitude step widens toward the equator-equivalent size. */
export function cellOf(W, lat, lon) {
  const latStep = W.cellM / 111320;
  const cy = Math.floor(lat / latStep);
  const lonStep = lonStepForRow(W, cy, latStep);
  return { cx: Math.floor(lon / lonStep), cy, latStep, lonStep };
}
const lonStepForRow = (W, cy, latStep) => W.cellM / (111320 * Math.max(0.2, Math.cos(((cy + 0.5) * latStep * Math.PI) / 180)));
export const windowOf = (W, now) => Math.floor(now / (W.windowMin * 60000));

function hash(...parts) {
  let h = 2166136261 >>> 0;
  for (const ch of parts.join('|')) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619) >>> 0; }
  return h;
}

/** Deterministic spawns for one cell in one time window. */
export function cellSpawns(cfg, cx, cy, win, latStep, lonStep) {
  const W = cfg.world, rng = rngFrom(hash(W.seed, cx, cy, win));
  const n = rng() < W.emptyCellChance ? 0 : 1 + (rng() < W.secondSpawnChance ? 1 : 0);
  const out = [];
  for (let i = 0; i < n; i++) {
    const familiarId = rollSpecies(cfg, rng);
    const f = cfg.familiars[familiarId];
    out.push({
      id: `w:${cx}:${cy}:${win}:${i}`, familiarId, rarity: f.rarity, type: f.type,
      lat: (cy + 0.15 + rng() * 0.7) * latStep, lon: (cx + 0.15 + rng() * 0.7) * lonStep,
      expiresAt: (win + 1) * W.windowMin * 60000,
    });
  }
  return out;
}

/** All spawns within radius metres of a position. */
export function nearbySpawns(cfg, pos, now, radiusM) {
  const W = cfg.world, c = cellOf(W, pos.lat, pos.lon), win = windowOf(W, now);
  const reach = Math.ceil(radiusM / W.cellM) + 1, out = [];
  for (let dy = -reach; dy <= reach; dy++) {
    const cy = c.cy + dy, lonStep = lonStepForRow(W, cy, c.latStep), cx0 = Math.floor(pos.lon / lonStep);
    for (let dx = -reach; dx <= reach; dx++) for (const s of cellSpawns(cfg, cx0 + dx, cy, win, c.latStep, lonStep)) {
      const d = distanceM(pos, s);
      if (d <= radiusM) out.push({ ...s, distance: d });
    }
  }
  return out.sort((a, b) => a.distance - b.distance);
}

/** In range if the distance minus a capped share of GPS uncertainty is within the interaction radius. */
export function inRange(cfg, pos, spawn, accuracyM = 0) {
  return distanceM(pos, spawn) - Math.min(accuracyM, cfg.world.accuracyAllowanceM) <= cfg.world.interactRadiusM;
}

/** Speed gate (GDD §11): pause interaction when moving faster than walking/jogging pace. */
export function speedGate(cfg, prev, cur) {
  if (cur.speed != null && cur.speed >= 0) return { speed: cur.speed, tooFast: cur.speed > cfg.world.maxSpeedMps };
  if (!prev) return { speed: 0, tooFast: false };
  const dt = (cur.t - prev.t) / 1000;
  if (dt < 1) return { speed: prev.speedEst || 0, tooFast: (prev.speedEst || 0) > cfg.world.maxSpeedMps };
  const v = distanceM(prev, cur) / dt;
  return { speed: v, tooFast: v > cfg.world.maxSpeedMps };
}

/** Convert a world spawn into a collection encounter (keeps the deterministic id, so a bound spawn never pays out twice). */
export function toEncounter(cfg, spawn, now) {
  return { id: spawn.id, familiarId: spawn.familiarId, rarity: spawn.rarity, type: spawn.type, source: 'map', createdAt: now,
    expiresAt: spawn.expiresAt, attemptsLeft: cfg.capture.attempts, state: 'open', engagedUntil: 0 };
}

/** Rift portals (M5 map): one fixed site per rift cell, the same for everyone, chosen from rifts the config marks as map-placed. */
export function riftSites(cfg, pos, radiusM) {
  const W = { ...cfg.world, cellM: cfg.world.riftCellM }, c = cellOf(W, pos.lat, pos.lon), pool = cfg.rifts.filter((r) => r.onMap);
  const reach = Math.ceil(radiusM / W.cellM) + 1, out = [];
  if (!pool.length) return out;
  for (let dy = -reach; dy <= reach; dy++) {
    const cy = c.cy + dy, lonStep = lonStepForRow(W, cy, c.latStep), cx0 = Math.floor(pos.lon / lonStep);
    for (let dx = -reach; dx <= reach; dx++) {
      const cx = cx0 + dx, rng = rngFrom(hash(W.seed, 'rift', cx, cy));
      const rift = pool[Math.floor(rng() * pool.length)];
      const site = { id: `r:${cx}:${cy}`, riftId: rift.id, lat: (cy + 0.2 + rng() * 0.6) * c.latStep, lon: (cx + 0.2 + rng() * 0.6) * lonStep };
      site.distance = distanceM(pos, site);
      if (site.distance <= radiusM) out.push(site);
    }
  }
  return out.sort((a, b) => a.distance - b.distance);
}
export const riftInRange = (cfg, pos, site, acc = 0) => distanceM(pos, site) - Math.min(acc, cfg.world.accuracyAllowanceM) <= cfg.world.riftRadiusM;
