// Run: node --test progression.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as P from './progression.js';
import * as C from './collection.js';

const cfg = JSON.parse(readFileSync(new URL('./data/config.json', import.meta.url)));
const NOW = 1_800_000_000_000;
const setup = () => ({ p: P.newProfile(cfg), col: C.grantStarters(cfg, C.newCollection(), NOW) });

test('wizard levels follow the curve and stop at the cap', () => {
  assert.equal(P.levelInfo(cfg, 0).level, 1);
  assert.equal(P.levelInfo(cfg, P.xpForLevel(cfg, 1)).level, 2);
  assert.equal(P.levelInfo(cfg, 1e12).level, cfg.progression.levelCap);
});

test('mastery levels use the GDD thresholds (1-10)', () => {
  assert.equal(P.masteryInfo(cfg, 0).level, 1);
  assert.equal(P.masteryInfo(cfg, 100).level, 2);
  assert.equal(P.masteryInfo(cfg, 499).level, 3);
  assert.equal(P.masteryInfo(cfg, 5400).level, 10);
  assert.equal(P.masteryInfo(cfg, 5400).nextAt, null);
});

test('no rewards for a run with no kills, and no mastery for familiars that did nothing', () => {
  const zero = P.battleRewards(cfg, { kills: 0, wavesCleared: 3, slots: [{ familiarId: 'fam_medusa', damage: 500, absorbed: 0, hits: 2 }] });
  assert.deepEqual(zero, { xp: 0, gold: 0, essence: 0, mastery: {} });
  const r = P.battleRewards(cfg, { kills: 5, wavesCleared: 2, slots: [
    { familiarId: 'fam_spirit_demon', damage: 800, absorbed: 0, hits: 4 },
    { familiarId: 'fam_fort_golem', damage: 0, absorbed: 0, hits: 0 }, // shield never absorbed anything
    { familiarId: 'fam_medusa', damage: 0, absorbed: 0, hits: 0 }] });
  assert.ok(r.xp > 0 && r.gold > 0 && r.essence > 0);
  assert.deepEqual(Object.keys(r.mastery), ['fam_spirit_demon']);
});

test('mastery per battle is capped', () => {
  const r = P.battleRewards(cfg, { kills: 9, wavesCleared: 4, slots: [{ familiarId: 'fam_spirit_demon', damage: 1e7, absorbed: 0, hits: 99 }] });
  assert.equal(r.mastery.fam_spirit_demon, cfg.progression.mastery.perBattleCap);
});

test('rewards apply exactly once per transaction id (no duplication on retry)', () => {
  const { p } = setup();
  const d = { xp: 100, gold: 50, essence: 5, mastery: { fam_medusa: 120 } };
  assert.equal(P.grant(cfg, p, 'battle:1', d).applied, true);
  assert.equal(P.grant(cfg, p, 'battle:1', d).applied, false);
  assert.deepEqual([p.xp, p.gold, p.essence, p.familiars.fam_medusa.masteryXp], [100, 50, 5, 120]);
});

test('ascension spends credits along the 1,2,3,5,8 ladder', () => {
  const { p, col } = setup();
  col.owned.fam_medusa.credits = 3;
  assert.equal(P.ascend(cfg, col, p, 'fam_medusa', false).rank, 1);
  assert.equal(col.owned.fam_medusa.credits, 2);
  assert.equal(P.ascend(cfg, col, p, 'fam_medusa', false).rank, 2);
  assert.equal(col.owned.fam_medusa.credits, 0);
  assert.equal(P.ascend(cfg, col, p, 'fam_medusa', false).reason, 'credits');
});

test('universal essence covers a credit shortfall only when chosen and affordable', () => {
  const { p, col } = setup();
  const per = cfg.progression.ascension.essencePerCredit;
  p.essence = per - 1;
  assert.equal(P.ascend(cfg, col, p, 'fam_medusa', true).reason, 'essence');
  p.essence = per;
  assert.equal(P.ascend(cfg, col, p, 'fam_medusa', true).ok, true);
  assert.equal(p.essence, 0);
});

test('every rarity can reach full ascension through essence alone', () => {
  const { p, col } = setup();
  p.essence = 1e6;
  for (let i = 0; i < 5; i++) assert.equal(P.ascend(cfg, col, p, 'fam_spirit_demon', true).ok, true);
  assert.equal(P.ascend(cfg, col, p, 'fam_spirit_demon', true).reason, 'maxed');
});

test('ascension potency is bounded at about 12.5% at max rank', () => {
  const { p, col } = setup();
  const base = cfg.abilities.abl_arcane_bolt.damage;
  col.owned.fam_spirit_demon.ascension = 5;
  const ab = P.effectiveAbility(cfg, col, p, 'fam_spirit_demon');
  assert.ok(Math.abs(ab.damage / base - 1.125) < 1e-9);
  assert.equal(ab.cooldown, cfg.abilities.abl_arcane_bolt.cooldown); // potency doesn't touch cooldowns
});

test('modifiers unlock at mastery 3, are sidegrades, and can be changed or removed freely', () => {
  const { p, col } = setup();
  assert.equal(P.setModifier(cfg, p, 'fam_spirit_demon', 'mod_bolt_pierce').reason, 'locked');
  p.familiars.fam_spirit_demon = { masteryXp: 250, modifierId: null };
  assert.equal(P.setModifier(cfg, p, 'fam_spirit_demon', 'mod_shield_long').reason, 'wrong-ability');
  assert.equal(P.setModifier(cfg, p, 'fam_spirit_demon', 'mod_bolt_pierce').ok, true);
  const ab = P.effectiveAbility(cfg, col, p, 'fam_spirit_demon');
  assert.equal(ab.pierce, true); assert.ok(ab.damage < cfg.abilities.abl_arcane_bolt.damage);
  assert.equal(P.setModifier(cfg, p, 'fam_spirit_demon', null).ok, true);
  assert.equal(P.effectiveAbility(cfg, col, p, 'fam_spirit_demon').damage, cfg.abilities.abl_arcane_bolt.damage);
});

test('every ability has exactly two modifiers, each with a cost', () => {
  for (const ab of Object.keys(cfg.abilities)) {
    const mods = Object.values(cfg.modifiers).filter((m) => m.abilityId === ab);
    assert.equal(mods.length, 2, ab);
    for (const m of mods) assert.match(m.desc, /[-+;]/, m.name);
  }
});

test('modifier stats stay inside status caps', () => {
  const { p, col } = setup();
  p.familiars.fam_squid = { masteryXp: 9999, modifierId: 'mod_ink_thick' };
  col.owned.fam_squid = { credits: 0, captures: 1, ascension: 5 };
  assert.ok(P.effectiveAbility(cfg, col, p, 'fam_squid').slowPct <= cfg.status.slowCapPct);
});

test('profile and ascension survive save and load', () => {
  const { p, col } = setup();
  col.owned.fam_medusa.ascension = 2; p.gold = 77; P.savePreset(cfg, p, 0, ['fam_medusa', 'fam_fort_golem', 'fam_spirit_demon']);
  const p2 = P.loadProfile(cfg, JSON.parse(JSON.stringify(p)));
  const c2 = C.loadCollection(cfg, JSON.parse(JSON.stringify(col)));
  assert.equal(p2.gold, 77); assert.deepEqual(p2.presets[0], ['fam_medusa', 'fam_fort_golem', 'fam_spirit_demon']);
  assert.equal(c2.owned.fam_medusa.ascension, 2);
});

test('a rift clear bonus is added only to a won run', () => {
  const rift = cfg.rifts.find((r) => r.id === 'rift_shallow');
  const base = { kills: 6, wavesCleared: 3, slots: [] };
  const lost = P.battleRewards(cfg, base), won = P.battleRewards(cfg, { ...base, clearReward: rift.clearReward });
  assert.equal(won.xp - lost.xp, rift.clearReward.xp);
  assert.equal(won.essence - lost.essence, rift.clearReward.essence);
});
