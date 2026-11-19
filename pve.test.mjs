// Run: node --test pve.test.mjs   (M4: new enemy archetypes, boss, rifts)
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createSim } from './sim.js';

const cfg = JSON.parse(readFileSync(new URL('./data/config.json', import.meta.url)));
const fresh = (familiarIds = cfg.defaultLoadout.familiarIds, opts = { waves: false }) => {
  const s = createSim(cfg, { weaponId: cfg.defaultLoadout.weaponId, familiarIds }, 1, opts);
  s.state.player.x = 0; s.state.player.z = 0; return s;
};
const run = (s, input, seconds) => { for (let i = 0; i < Math.round(seconds * 60); i++) s.step(input); };
const G = cfg.enemies.enm_ancient_warrior;

test('zone controller telegraphs the spot first, and the pool only hurts if you stay', () => {
  const s = fresh(); const g = s.debugSpawn('enm_mech_golem', 0, -9); g.cd = 0;
  s.step({});
  const tel = s.drainEvents().find((e) => e.type === 'telegraph');
  assert.equal(tel.shape, 'circle'); assert.ok(Math.hypot(tel.x, tel.z) < 0.1, 'marks where the player stood');
  const stay = s.state.player.hp;
  run(s, {}, 1.0 + 1.5);
  assert.ok(s.state.player.hp < stay, 'standing in the pool hurts');

  const s2 = fresh(); const g2 = s2.debugSpawn('enm_mech_golem', 0, -9); g2.cd = 0;
  s2.step({}); run(s2, { move: { x: 1, z: 0 } }, 0.9); // walk out before it lands
  run(s2, {}, 1.5);
  assert.equal(s2.state.player.hp, s2.state.player.maxHp);
});

test('guardian blocks hits from the front but not from behind, during its swing, or from zones', () => {
  const s = fresh(); const g = s.debugSpawn('enm_ancient_warrior', 0, -6); g.face = { x: 0, z: 1 };
  s.applyDamage(g, 100, 'slot0', { dir: { x: 0, z: -1 } }); // arrives at its face
  assert.ok(Math.abs(g.maxHp - g.hp - 100 * (1 - G.guardPct / 100)) < 1e-9);
  let hp = g.hp; s.applyDamage(g, 100, 'slot0', { dir: { x: 0, z: 1 } }); // from behind
  assert.equal(hp - g.hp, 100);
  hp = g.hp; s.applyDamage(g, 100, 'zone', { slot: 1, tick: true }); // zone damage has no direction
  assert.equal(hp - g.hp, 100);
  g.mode = 'windup'; hp = g.hp; s.applyDamage(g, 100, 'slot0', { dir: { x: 0, z: -1 } });
  assert.equal(hp - g.hp, 100, 'guard is down while it attacks');
});

test('guardian turns slowly, so a fast flank exposes its back', () => {
  const s = fresh(); const g = s.debugSpawn('enm_ancient_warrior', 0, -6); g.face = { x: 0, z: 1 };
  s.state.player.x = 0; s.state.player.z = -12; // jump behind it
  s.step({});
  assert.ok(g.face.z > 0.9, 'still facing the old way after one frame');
  run(s, {}, 2);
  assert.ok(g.face.z < -0.9, 'eventually turns round');
});

test('every familiar type has an answer to the new enemies', () => {
  // Arcane: a bolt into a guardian's side lands in full.
  const a = fresh(['fam_spirit_demon', 'fam_fort_golem', 'fam_medusa']); const g = a.debugSpawn('enm_ancient_warrior', 6, 0); g.face = { x: 0, z: 1 };
  a.step({ aim: { x: 1, z: 0 }, abilities: [true, false, false] }); run(a, {}, 1);
  assert.equal(g.maxHp - g.hp, cfg.abilities.abl_arcane_bolt.damage);
  // Runic: Rune Shield soaks a zone controller's pool.
  const r = fresh(['fam_spirit_demon', 'fam_fort_golem', 'fam_medusa']); const z = r.debugSpawn('enm_mech_golem', 0, -9); z.cd = 0;
  r.step({}); r.step({ abilities: [false, true, false] }); run(r, {}, 2);
  assert.equal(r.state.player.hp, r.state.player.maxHp); assert.ok(r.state.slots[1].contrib.absorbed > 0);
  // Ancient: Ink Pool damages and slows a guardian regardless of its shield.
  const n = fresh(['fam_spirit_demon', 'fam_fort_golem', 'fam_squid']); const g2 = n.debugSpawn('enm_ancient_warrior', 0, -6);
  n.step({ aim: { x: 0, z: -1 }, abilities: [false, false, true] }); n.step({ aim: { x: 0, z: -1 } }); run(n, {}, 1);
  assert.ok(g2.hp < g2.maxHp && n.state.slots[2].contrib.damage > 0);
});

test('boss changes phase at its health thresholds and summons help', () => {
  const s = fresh(); const b = s.debugSpawn('enm_evil_god', 0, -8);
  s.step({}); s.drainEvents();
  b.hp = b.maxHp * 0.59; s.step({});
  let ev = s.drainEvents();
  assert.ok(ev.some((e) => e.type === 'phase' && e.phase === 2));
  assert.equal(ev.filter((e) => e.type === 'spawn').length, 2);
  b.hp = b.maxHp * 0.2; s.step({});
  ev = s.drainEvents();
  assert.ok(ev.some((e) => e.type === 'phase' && e.phase === 3));
});

test('every boss attack is telegraphed before it can deal damage', () => {
  const s = fresh(); const b = s.debugSpawn('enm_evil_god', 0, -3); b.cd = 0;
  let telegraphed = false;
  for (let i = 0; i < 60 * 12; i++) {
    s.step({});
    for (const e of s.drainEvents()) {
      if (e.type === 'telegraph') telegraphed = true;
      if (e.type === 'damage' && e.team === 'player') assert.ok(telegraphed, 'damage without a telegraph');
    }
    if (s.state.over) break;
  }
  assert.ok(telegraphed);
});

test('the nova ring misses a player who leaves it in time', () => {
  const s = fresh(); const b = s.debugSpawn('enm_evil_god', 0, -3);
  b.hp = b.maxHp * 0.2; s.step({}); s.state.enemies.splice(1); s.drainEvents(); // phase 3 opens with nova; drop the summon
  b.cd = 0; s.step({});
  const tel = s.drainEvents().find((e) => e.type === 'telegraph');
  assert.equal(tel.shape, 'circle'); assert.equal(tel.radius, cfg.enemies.enm_evil_god.attacks.nova.radius);
  run(s, { move: { x: 0, z: 1 } }, tel.time); s.step({});
  assert.equal(s.state.player.hp, s.state.player.maxHp);
});

test('a rift has a fixed number of waves and ends in victory', () => {
  const rift = cfg.rifts.find((r) => r.id === 'skirmish');
  const s = fresh(undefined, { encounter: rift });
  run(s, {}, 2);
  assert.equal(s.state.wave, 0);
  for (const e of s.state.enemies) s.applyDamage(e, 1e6, 'slot0');
  s.step({});
  assert.equal(s.state.won, true); assert.equal(s.state.over, true);
  assert.ok(s.drainEvents().some((e) => e.type === 'victory'));
});

test('rift modifiers change tactics, not enemy health', () => {
  const base = fresh(undefined, { waves: false }), fast = fresh(undefined, { waves: false, encounter: { waves: [[]], modifiers: ['haste'] } });
  const a = base.debugSpawn('enm_troll', 0, -9), b = fast.debugSpawn('enm_troll', 0, -9);
  assert.equal(a.maxHp, b.maxHp);
  run(base, {}, 0.5); run(fast, {}, 0.5);
  assert.ok(b.z > a.z, 'hasted troll closes faster');
});

test('rift and enemy data is valid', () => {
  for (const r of cfg.rifts) {
    for (const w of r.waves) for (const e of w) assert.ok(cfg.enemies[e], `${r.id}: ${e}`);
    for (const m of r.modifiers) assert.ok(cfg.riftModifiers[m], `${r.id}: ${m}`);
  }
  const boss = cfg.enemies.enm_evil_god;
  for (const ph of boss.phases) for (const a of ph.attacks) assert.ok(boss.attacks[a], a);
  for (const [id, e] of Object.entries(cfg.enemies)) assert.ok(e.counterplay || ['enm_troll', 'enm_dark_elf'].includes(id), id);
});
