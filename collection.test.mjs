// Run: node --test collection.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as C from './collection.js';

const cfg = JSON.parse(readFileSync(new URL('./data/config.json', import.meta.url)));
const NOW = 1_800_000_000_000;

test('all eight rarity tiers exist, with labels, and shares sum to 100%', () => {
  assert.deepEqual(cfg.rarities.map((r) => r.id), ['common', 'uncommon', 'rare', 'epic', 'legendary', 'mythic', 'celestial', 'transcendent']);
  for (const r of cfg.rarities) assert.ok(r.label && r.color && r.pips >= 1, r.id);
  assert.ok(Math.abs(cfg.rarities.reduce((a, r) => a + r.share, 0) - 100) < 1e-9);
});

test('species rolls follow rarity shares within the available pool', () => {
  const rng = C.rngFrom(7), counts = {};
  const N = 200_000;
  for (let i = 0; i < N; i++) { const f = C.rollSpecies(cfg, rng); counts[f] = (counts[f] || 0) + 1; }
  const w = C.speciesWeights(cfg);
  for (const [f, p] of Object.entries(w)) assert.ok(Math.abs(counts[f] / N - p) < 0.01, `${f} ${counts[f] / N} vs ${p}`);
  // Commons appear far more often than epics
  const commons = ["fam_spirit_demon", "fam_fort_golem", "fam_medusa"].reduce((a, f) => a + counts[f], 0);
  assert.ok(Math.abs(commons / N - 45 / 95) < 0.01); // only Common..Epic species exist yet, so shares renormalise over 95%
});

test('starters give one familiar of each type', () => {
  const c = C.grantStarters(cfg, C.newCollection(), NOW);
  assert.deepEqual(Object.keys(c.owned).map((f) => cfg.familiars[f].type).sort(), ['ancient', 'arcane', 'runic']);
});

test('first capture unlocks, the next adds one duplicate credit, the same key never counts twice', () => {
  const c = C.newCollection();
  assert.deepEqual(C.applyCapture(c, 'fam_squid', 'k1', NOW), { first: true, duplicate: false, credits: 0 });
  assert.equal(C.applyCapture(c, 'fam_squid', 'k2', NOW).credits, 1);
  assert.equal(C.applyCapture(c, 'fam_squid', 'k2', NOW).repeated, true);
  assert.equal(c.owned.fam_squid.credits, 1);
  assert.equal(c.owned.fam_squid.captures, 2);
});

test('binding resolution is idempotent per attempt and failure never removes ownership', () => {
  const c = C.grantStarters(cfg, C.newCollection(), NOW);
  const before = JSON.stringify(c.owned);
  const e = C.spawnEncounter(cfg, c, C.rngFrom(3), NOW);
  const alwaysFail = () => 0.999999;
  const r1 = C.resolveBinding(cfg, c, e.id, 1, 0, alwaysFail, NOW);
  const r1again = C.resolveBinding(cfg, c, e.id, 1, 0, () => 0, NOW);
  assert.equal(r1.outcome, 'resisted'); assert.deepEqual(r1again, r1);
  C.resolveBinding(cfg, c, e.id, 2, 0, alwaysFail, NOW);
  const r3 = C.resolveBinding(cfg, c, e.id, 3, 0, alwaysFail, NOW);
  assert.equal(r3.outcome, 'fled');
  assert.equal(C.resolveBinding(cfg, c, e.id, 4, 1, () => 0, NOW).outcome, 'unavailable');
  assert.equal(JSON.stringify(c.owned), before);
});

test('successful binding of a new species unlocks it immediately', () => {
  const c = C.newCollection();
  const e = C.spawnEncounter(cfg, c, () => 0.99, NOW); // last species in the weight table
  const r = C.resolveBinding(cfg, c, e.id, 1, 1, () => 0, NOW);
  assert.equal(r.outcome, 'bound'); assert.equal(r.first, true);
  assert.ok(c.owned[e.familiarId]);
});

test('bind chance stays inside disclosed bounds and rises with skill', () => {
  for (const r of cfg.rarities) {
    const lo = C.bindChance(cfg, r.id, 0), hi = C.bindChance(cfg, r.id, 1);
    assert.ok(lo >= cfg.capture.minChance && hi <= cfg.capture.maxChance && hi > lo, r.id);
  }
});

test('engaging freezes an encounter so it cannot expire mid-challenge', () => {
  const c = C.newCollection();
  const e = C.spawnEncounter(cfg, c, C.rngFrom(1), NOW);
  const late = e.expiresAt - 1000;
  C.engage(cfg, c, e.id, late);
  C.pruneEncounters(c, late + 60_000);
  assert.ok(c.encounters.find((x) => x.id === e.id));
});

test('no more than maxActive open encounters', () => {
  const c = C.newCollection(), rng = C.rngFrom(9);
  for (let i = 0; i < 10; i++) C.spawnEncounter(cfg, c, rng, NOW);
  assert.equal(c.encounters.length, cfg.explore.maxActive);
});

test('ascension info uses the GDD credit ladder (1,2,3,5,8)', () => {
  assert.equal(C.ascensionInfo(cfg, 0).possibleRank, 0);
  assert.equal(C.ascensionInfo(cfg, 1).possibleRank, 1);
  assert.equal(C.ascensionInfo(cfg, 3).possibleRank, 2);
  assert.equal(C.ascensionInfo(cfg, 19).possibleRank, 5);
  assert.equal(C.ascensionInfo(cfg, 19).nextAt, null);
});

test('save data round-trips and ignores unknown familiars', () => {
  const c = C.grantStarters(cfg, C.newCollection(), NOW);
  const raw = JSON.parse(JSON.stringify(c)); raw.owned.fam_unknown = { credits: 3 };
  const back = C.loadCollection(cfg, raw);
  assert.deepEqual(Object.keys(back.owned).sort(), Object.keys(c.owned).sort());
});
