// Run: node --test sim.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createSim, combinedSlow, TYPES } from './sim.js';

const cfg = JSON.parse(readFileSync(new URL('./data/config.json', import.meta.url)));
const fresh = (loadout, seed = 1) => {
  const s = createSim(cfg, loadout, seed, { waves: false });
  s.state.player.x = 0; s.state.player.z = 0;
  return s;
};
const run = (s, input, seconds) => { for (let i = 0; i < Math.round(seconds * 60); i++) s.step(input); };

test('no aim assist: projectile keeps the exact input vector and misses an off-line enemy', () => {
  const s = fresh();
  const e = s.debugSpawn('enm_dark_elf', 1.5, -8); // 1.5 m off the firing line; radii sum is 0.72
  const aim = { x: 0, z: -1 };
  s.step({ aim, fire: true });
  const pr = s.state.projectiles[0];
  for (let i = 0; i < 60; i++) {
    if (!s.state.projectiles.includes(pr)) break;
    assert.equal(pr.dx, 0); assert.equal(pr.dz, -1);
    s.step({ aim });
  }
  assert.equal(e.hp, e.maxHp);
});

test('manual aim at the enemy hits it', () => {
  const s = fresh();
  const e = s.debugSpawn('enm_dark_elf', 1.5, -8);
  const l = Math.hypot(1.5, -8);
  s.step({ aim: { x: 1.5 / l, z: -8 / l }, fire: true });
  run(s, {}, 1);
  assert.equal(e.hp, e.maxHp - cfg.weapons.wpn_apprentice_staff.damage);
});

test('every player ability ignores enemy positions (no target selection)', () => {
  for (const fid of Object.keys(cfg.familiars)) {
    const a = fresh({ weaponId: 'wpn_apprentice_staff', familiarIds: [fid, 'fam_fort_golem', 'fam_medusa'] });
    const b = fresh({ weaponId: 'wpn_apprentice_staff', familiarIds: [fid, 'fam_fort_golem', 'fam_medusa'] });
    b.debugSpawn('enm_troll', 4, -3); // enemy nearby, off the aim line, in sim b only
    const aim = { x: 0, z: -1 };
    for (const s of [a, b]) { s.step({ aim, abilities: [true, false, false] }); s.step({ aim }); }
    const dirs = (s) => s.state.projectiles.map((p) => [p.dx, p.dz]);
    assert.deepEqual(dirs(a), dirs(b), fid);
    assert.deepEqual([a.state.player.x, a.state.player.z], [b.state.player.x, b.state.player.z], fid);
  }
});

test('pillars block projectiles', () => {
  const s = fresh();
  s.state.player.x = -6; s.state.player.z = -1; // pillar at (-6,-5) r 1.1
  const e = s.debugSpawn('enm_dark_elf', -6, -9);
  s.step({ aim: { x: 0, z: -1 }, fire: true });
  run(s, {}, 1.5);
  assert.equal(e.hp, e.maxHp);
});

test('dodge gives invulnerability, then damage applies again', () => {
  const s = fresh(); const p = s.state.player;
  s.step({ dodge: true, move: { x: 1, z: 0 } });
  assert.ok(p.invulnT > 0);
  s.applyDamage(p, 100, 'test');
  assert.equal(p.hp, p.maxHp);
  run(s, {}, 0.5);
  s.applyDamage(p, 100, 'test');
  assert.equal(p.hp, p.maxHp - 100);
  assert.ok(p.stamina < cfg.player.stamina);
});

test('dodge costs stamina and is refused when stamina is too low', () => {
  const s = fresh(); const p = s.state.player;
  p.stamina = cfg.player.dodge.staminaCost - 1;
  s.step({ dodge: true, move: { x: 1, z: 0 } });
  assert.equal(p.dodgeT, 0);
});

test('cooldown and mana gate abilities', () => {
  const s = fresh(); const p = s.state.player;
  const cast = () => { s.step({ aim: { x: 0, z: -1 }, abilities: [true, false, false] }); s.step({}); };
  cast(); cast();
  assert.equal(s.state.projectiles.length, 1, 'second cast blocked by cooldown');
  const s2 = fresh(); s2.state.player.mana = 5;
  s2.step({ aim: { x: 0, z: -1 }, abilities: [true, false, false] });
  assert.equal(s2.state.projectiles.length, 0, 'blocked by mana');
  assert.ok(s2.drainEvents().some((e) => e.type === 'notReady' && e.reason === 'mana'));
});

test('rune shield absorbs damage before health', () => {
  const s = fresh(); const p = s.state.player;
  s.step({ abilities: [false, true, false] });
  assert.equal(p.shield, 300);
  s.applyDamage(p, 200, 'test');
  assert.equal(p.hp, p.maxHp); assert.equal(p.shield, 100);
  s.applyDamage(p, 200, 'test');
  assert.equal(p.hp, p.maxHp - 100);
});

test('slows stack only up to the cap', () => {
  assert.equal(combinedSlow([30, 30], cfg.status.slowCapPct), 0.35);
  assert.equal(combinedSlow([10], cfg.status.slowCapPct), 0.1);
});

test('knockback cannot push an enemy through a pillar', () => {
  const s = fresh({ weaponId: 'wpn_apprentice_staff', familiarIds: ['fam_parrot', 'fam_fort_golem', 'fam_medusa'] });
  s.state.player.x = 0; s.state.player.z = -5;
  const e = s.debugSpawn('enm_dark_elf', 4.5, -5); // pillar at (6,-5) r 1.1 directly behind
  s.step({ aim: { x: 1, z: 0 }, abilities: [true, false, false] });
  assert.ok(Math.hypot(e.x - 6, e.z + 5) >= 1.1 + e.r - 1e-6);
  assert.ok(e.x < 6);
});

test('melee windup is telegraphed and can be escaped', () => {
  const s = fresh(); const p = s.state.player;
  const t = s.debugSpawn('enm_troll', 0, -2.2); t.cd = 0;
  s.step({});
  assert.equal(t.mode, 'windup');
  assert.ok(s.drainEvents().some((e) => e.type === 'telegraph' && e.shape === 'arc'));
  run(s, { move: { x: 0, z: 1 } }, 0.8); // walk away during the windup
  assert.equal(p.hp, p.maxHp);
  const s2 = fresh(); const t2 = s2.debugSpawn('enm_troll', 0, -2.2); t2.cd = 0;
  run(s2, {}, 0.8); // stand still
  assert.equal(s2.state.player.hp, s2.state.player.maxHp - cfg.enemies.enm_troll.damage);
});

test('same seed and inputs give the same result (deterministic)', () => {
  const play = () => {
    const s = createSim(cfg, cfg.defaultLoadout, 42);
    for (let i = 0; i < 600; i++) s.step({ move: { x: Math.sin(i / 30), z: 1 }, aim: { x: 0, z: -1 }, fire: i % 2 === 0, abilities: [i % 90 === 0, i % 200 === 0, i % 150 === 0] });
    const st = s.state;
    return JSON.stringify([st.player.x, st.player.z, st.player.hp, st.enemies.map((e) => [e.x, e.z, e.hp])]);
  };
  assert.equal(play(), play());
});

test('all ten type compositions build and every slot can cast', () => {
  const byType = Object.fromEntries(TYPES.map((t) => [t, Object.keys(cfg.familiars).filter((f) => cfg.familiars[f].type === t)]));
  const combos = [];
  for (let a = 0; a < 3; a++) for (let b = a; b < 3; b++) for (let c = b; c < 3; c++) combos.push([TYPES[a], TYPES[b], TYPES[c]]);
  assert.equal(combos.length, 10);
  for (const combo of combos) {
    const used = {};
    const ids = combo.map((t) => byType[t][(used[t] = (used[t] ?? -1) + 1)]);
    const s = fresh({ weaponId: 'wpn_apprentice_staff', familiarIds: ids });
    const casts = [];
    for (let i = 0; i < 3; i++) {
      s.step({ aim: { x: 0, z: -1 }, abilities: [i === 0, i === 1, i === 2] });
      run(s, { aim: { x: 0, z: -1 } }, 1.3); // also releases charge abilities
      casts.push(...s.drainEvents().filter((e) => e.type === 'cast').map((e) => e.slot));
    }
    assert.deepEqual(casts.sort(), [0, 1, 2], combo.join(''));
  }
});

test('config references are valid', () => {
  for (const [fid, f] of Object.entries(cfg.familiars)) {
    assert.ok(cfg.abilities[f.abilityId], `${fid} ability`);
    assert.ok(TYPES.includes(f.type), `${fid} type`);
  }
  for (const w of cfg.waves) for (const e of w) assert.ok(cfg.enemies[e], e);
});
