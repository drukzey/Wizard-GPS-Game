// Run: node --test sanctuary.test.mjs   (M5: gear, Forge, facilities, decor placement, research)
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as S from './sanctuary.js';
import * as P from './progression.js';
import * as C from './collection.js';
import { createSim } from './sim.js';

const cfg = JSON.parse(readFileSync(new URL('./data/config.json', import.meta.url)));
const rich = () => { const p = P.newProfile(cfg); p.gold = 1e6; p.essence = 1e6; for (const k in p.materials) p.materials[k] = 1e6; return p; };
const roundtrip = (h) => S.loadHome(cfg, JSON.parse(JSON.stringify(h)));

test('a new home has the starter staff equipped and level 1 facilities', () => {
  const h = S.newHome(cfg);
  assert.equal(h.items.length, 1);
  assert.equal(cfg.gear.bases[h.items[0].baseId].slot, 'weapon');
  assert.equal(h.equipped.weapon, h.items[0].uid);
  for (const v of Object.values(h.facilities)) assert.equal(v, 1);
});

test('crafting needs a known recipe and the full cost, and pays exactly once', () => {
  const h = S.newHome(cfg), p = P.newProfile(cfg);
  assert.equal(S.craft(cfg, h, p, 'robe_warded').reason, 'cost');
  assert.equal(S.craft(cfg, h, rich(), 'ring_haste').reason, 'recipe');
  Object.assign(p, { gold: 80 }); p.materials.ore = 5;
  assert.equal(S.craft(cfg, h, p, 'robe_warded').ok, true);
  assert.equal(p.gold, 0); assert.equal(p.materials.ore, 0);
});

test('upgrades never fail or destroy, and promotion waits for the Forge level', () => {
  const h = S.newHome(cfg), p = rich(), it = S.craft(cfg, h, p, 'robe_warded').item;
  for (let i = 1; i < S.tierCap(cfg, 0); i++) assert.equal(S.upgrade(cfg, h, p, it.uid).ok, true);
  assert.equal(S.upgradeInfo(cfg, h, it.uid).kind, 'promote');
  assert.equal(S.upgrade(cfg, h, p, it.uid).reason, 'forge');
  assert.ok(h.items.includes(it), 'item still there');
  S.upgradeFacility(cfg, h, p, 'forge');
  assert.equal(S.upgrade(cfg, h, p, it.uid).ok, true);
  assert.equal(it.tier, 1);
});

test('gear trade-offs stay, upsides grow with level, and totals are capped', () => {
  const h = S.newHome(cfg), p = rich();
  const robe = S.craft(cfg, h, p, 'robe_warded').item; S.equip(cfg, h, robe.uid);
  const l1 = S.itemStats(cfg, robe);
  robe.level = 3; const l3 = S.itemStats(cfg, robe);
  assert.ok(l3.health > l1.health); assert.equal(l3.speed, l1.speed);
  robe.level = 99; // even a silly level stays inside the cap
  const L = S.combatLoadout(cfg, h);
  assert.ok(L.player.health <= cfg.player.health * (1 + cfg.gear.statCapPct / 100) + 1e-9);
  assert.ok(L.player.speed < cfg.player.speed);
});

test('the equipped weapon and stats reach the battle', () => {
  const h = S.newHome(cfg), p = rich();
  h.recipes.push('wpn_scatter_staff');
  const w = S.craft(cfg, h, p, 'wpn_scatter_staff').item; S.equip(cfg, h, w.uid);
  const L = S.combatLoadout(cfg, h);
  const sim = createSim(cfg, { ...cfg.defaultLoadout, weapon: L.weapon, player: L.player }, 1, { waves: false });
  sim.step({ aim: { x: 0, z: -1 }, fire: true });
  assert.equal(sim.state.projectiles.length, cfg.weapons.wpn_scatter_staff.count);
  const dirs = sim.state.projectiles.map((q) => q.dx).sort((a, b) => a - b);
  assert.ok(Math.abs(dirs[0] + dirs[2]) < 1e-9, 'fan is symmetric around the aim, not bent toward anything');
});

test('the weapon slot can never be empty', () => {
  const h = S.newHome(cfg);
  assert.equal(S.unequip(cfg, h, 'weapon'), false);
  delete h.equipped.weapon;
  assert.ok(roundtrip(h).equipped.weapon);
});

test('facility upgrades cost what they say and change what they promise', () => {
  const h = S.newHome(cfg), p = rich();
  const before = S.facilityEffect(cfg, h, 'chamber').presets;
  const gold = p.gold, cost = S.facilityUpgradeCost(cfg, h, 'chamber');
  assert.equal(S.upgradeFacility(cfg, h, p, 'chamber').ok, true);
  assert.equal(p.gold, gold - cost.gold);
  assert.equal(S.facilityEffect(cfg, h, 'chamber').presets, before + 1);
  assert.equal(p.presets.length, before + 1);
  for (let i = 0; i < 5; i++) S.upgradeFacility(cfg, h, p, 'chamber');
  assert.equal(S.upgradeFacility(cfg, h, p, 'chamber').reason, 'max');
});

test('decor placement checks the grid, buildings, other decor and slot limits', () => {
  const h = S.newHome(cfg), p = rich(), F = cfg.sanctuary.facilities.dwelling;
  S.buyDecor(cfg, h, p, 'tree'); S.buyDecor(cfg, h, p, 'tree');
  assert.equal(S.placeDecor(cfg, h, 'tree', F.at[0], F.at[1]).reason, 'blocked', 'on a building');
  assert.equal(S.placeDecor(cfg, h, 'tree', -1, 0).reason, 'blocked', 'off the plot');
  assert.equal(S.placeDecor(cfg, h, 'tree', 0, 6).ok, true);
  assert.equal(S.placeDecor(cfg, h, 'tree', 0, 6).reason, 'blocked', 'tile taken');
  assert.equal(S.placeDecor(cfg, h, 'tree', 0, 0).ok, true);
  assert.equal(S.placeDecor(cfg, h, 'tree', 6, 6).reason, 'none-left');
  S.rotateDecor(h, 0); S.rotateDecor(h, 0);
  assert.equal(h.decor.placed[0].rot, 2);
  assert.equal(S.moveDecor(cfg, h, 0, 0, 0), false, 'cannot move onto another piece');
  assert.equal(S.moveDecor(cfg, h, 0, 6, 6), true);
  S.storeDecor(h, 1); assert.equal(h.decor.placed.length, 1); assert.equal(h.decor.owned.tree, 2);
  for (let i = 0; i < 20; i++) S.buyDecor(cfg, h, p, 'flowers');
  let placed = 0; for (let x = 0; x < 12; x++) if (S.placeDecor(cfg, h, 'flowers', x, 11).ok) placed++;
  assert.equal(h.decor.placed.length, S.decorSlots(cfg, h), 'stops at the dwelling limit');
});

test('the home survives save and load (re-entering it is persistent)', () => {
  const h = S.newHome(cfg), p = rich();
  const r = S.craft(cfg, h, p, 'ring_tides').item; S.equip(cfg, h, r.uid); S.upgrade(cfg, h, p, r.uid);
  S.upgradeFacility(cfg, h, p, 'forge'); S.buyDecor(cfg, h, p, 'lamp'); S.placeDecor(cfg, h, 'lamp', 6, 6, 3);
  const h2 = roundtrip(h);
  assert.deepEqual(h2.equipped, h.equipped); assert.equal(h2.items.find((i) => i.uid === r.uid).level, 2);
  assert.equal(h2.facilities.forge, 2); assert.deepEqual(h2.decor.placed, [{ id: 'lamp', x: 6, z: 6, rot: 3 }]);
  const p2 = P.loadProfile(cfg, JSON.parse(JSON.stringify(p)));
  assert.equal(p2.materials.ore, p.materials.ore);
});

test('research needs progress, an open branch and the cost, then unlocks its recipe once', () => {
  const h = S.newHome(cfg), p = rich(), col = C.grantStarters(cfg, C.newCollection(), 1);
  assert.equal(S.completeResearch(cfg, h, p, col, 'res_kills').reason, 'progress');
  p.stats.kills = 50;
  assert.equal(S.completeResearch(cfg, h, p, col, 'res_kills').ok, true);
  assert.ok(h.recipes.includes('wpn_seer_staff'));
  assert.equal(S.completeResearch(cfg, h, p, col, 'res_kills').reason, 'done');
  p.stats.rifts = { skirmish: 3 };
  assert.equal(S.completeResearch(cfg, h, p, col, 'res_rifts').reason, 'locked', 'combat branch needs Library 2');
  S.upgradeFacility(cfg, h, p, 'library');
  assert.equal(S.completeResearch(cfg, h, p, col, 'res_rifts').ok, true);
});

test('rifts and bindings pay materials through the same once-only ledger', () => {
  const p = P.newProfile(cfg), rift = cfg.rifts.find((r) => r.id === 'rift_shallow');
  const rw = P.battleRewards(cfg, { kills: 5, wavesCleared: 3, slots: [], clearReward: rift.clearReward });
  P.grant(cfg, p, 'x', rw); P.grant(cfg, p, 'x', rw);
  assert.equal(p.materials.ore, rw.materials.ore);
  assert.ok(rw.materials.ore >= rift.clearReward.materials.ore);
});

test('gear and sanctuary data is valid', () => {
  for (const [id, b] of Object.entries(cfg.gear.bases)) {
    assert.ok(cfg.gear.slots.includes(b.slot), id);
    if (b.slot === 'weapon') assert.ok(cfg.weapons[b.weaponId], id);
    else { const e = Object.entries(b.stats); assert.ok(e.some(([k, v]) => S.isUpside(cfg, k, v)) && e.some(([k, v]) => !S.isUpside(cfg, k, v)), `${id} needs a trade-off`); }
  }
  for (const r of cfg.research.projects) if (r.reward.recipe) assert.ok(cfg.gear.bases[r.reward.recipe], r.id);
  const recipes = new Set([...cfg.gear.starterRecipes, ...cfg.gear.starterItems, ...cfg.research.projects.map((r) => r.reward.recipe)]);
  for (const id of Object.keys(cfg.gear.bases)) assert.ok(recipes.has(id), `${id} is obtainable`);
});
