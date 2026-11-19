// Run: node --test world.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as W from './world.js';
import * as C from './collection.js';

const cfg = JSON.parse(readFileSync(new URL('./data/config.json', import.meta.url)));
const NOW = 1_800_000_000_000;
const here = { lat: 40.7812, lon: -73.9665 };

test('distance is accurate (1 degree latitude ~ 111 km)', () => {
  assert.ok(Math.abs(W.distanceM({ lat: 0, lon: 0 }, { lat: 1, lon: 0 }) - 111195) < 200);
});

test('spawns are deterministic for the same place and time window', () => {
  assert.deepEqual(W.nearbySpawns(cfg, here, NOW, 400), W.nearbySpawns(cfg, here, NOW + 1000, 400));
});

test('a spawn keeps the same id and position when seen from neighbouring cells', () => {
  const a = W.nearbySpawns(cfg, here, NOW, 600);
  const moved = { lat: here.lat + 0.0021, lon: here.lon + 0.0024 }; // ~250 m away, different cell and row
  const b = W.nearbySpawns(cfg, moved, NOW, 600);
  const common = a.filter((s) => b.find((t) => t.id === s.id));
  assert.ok(common.length > 0);
  for (const s of common) { const t = b.find((x) => x.id === s.id); assert.equal(t.lat, s.lat); assert.equal(t.lon, s.lon); assert.equal(t.familiarId, s.familiarId); }
});

test('spawns change between time windows', () => {
  const w = cfg.world.windowMin * 60000;
  assert.notDeepEqual(W.nearbySpawns(cfg, here, NOW, 400).map((s) => s.id), W.nearbySpawns(cfg, here, NOW + w, 400).map((s) => s.id));
});

test('spawn density is reasonable (roughly 1 per cell on average)', () => {
  const s = W.nearbySpawns(cfg, here, NOW, 1000);
  const cells = Math.PI * 1000 ** 2 / cfg.world.cellM ** 2;
  const per = s.length / cells;
  assert.ok(per > 0.5 && per < 1.3, `per cell ${per}`);
});

test('range check allows capped GPS uncertainty only', () => {
  const s = { lat: here.lat + 50 / 111320, lon: here.lon }; // 50 m north
  assert.equal(W.inRange(cfg, here, s, 0), false);
  assert.equal(W.inRange(cfg, here, s, 15), true);
  const far = { lat: here.lat + 90 / 111320, lon: here.lon };
  assert.equal(W.inRange(cfg, here, far, 500), false); // accuracy allowance is capped
});

test('speed gate pauses interaction when driving', () => {
  const p = { ...here, t: 0 };
  const walk = { lat: here.lat + 15 / 111320, lon: here.lon, t: 10000 };
  const drive = { lat: here.lat + 200 / 111320, lon: here.lon, t: 10000 };
  assert.equal(W.speedGate(cfg, p, walk).tooFast, false);
  assert.equal(W.speedGate(cfg, p, drive).tooFast, true);
  assert.equal(W.speedGate(cfg, null, { speed: 12 }).tooFast, true);
});

test('a bound map spawn cannot be bound again; a fled one does not come back', () => {
  const c = C.newCollection();
  const [s1, s2] = W.nearbySpawns(cfg, here, NOW, 800);
  const e1 = C.registerWorldEncounter(c, W.toEncounter(cfg, s1, NOW));
  assert.equal(C.resolveBinding(cfg, c, e1.id, 1, 1, () => 0, NOW).outcome, 'bound');
  assert.equal(C.registerWorldEncounter(c, W.toEncounter(cfg, s1, NOW)), null);
  const e2 = C.registerWorldEncounter(c, W.toEncounter(cfg, s2, NOW));
  for (let i = 1; i <= 3; i++) C.resolveBinding(cfg, c, e2.id, i, 0, () => 0.999, NOW);
  C.pruneEncounters(c, NOW + 3600_000);
  assert.equal(C.registerWorldEncounter(c, W.toEncounter(cfg, s2, NOW)), null);
});

test('rift portals sit at fixed places, the same for everyone, and only map rifts appear', () => {
  const pos = cfg.world.demoStart;
  const a = W.riftSites(cfg, pos, 1500), b = W.riftSites(cfg, { lat: pos.lat + 0.0003, lon: pos.lon }, 1500);
  assert.ok(a.length > 0);
  const ids = new Set(b.map((s) => s.id));
  for (const s of a.filter((x) => x.distance < 1200)) assert.ok(ids.has(s.id), 'stable across small moves');
  for (const s of a) assert.ok(cfg.rifts.find((r) => r.id === s.riftId).onMap);
  assert.ok(W.riftInRange(cfg, a[0], a[0]));
});
