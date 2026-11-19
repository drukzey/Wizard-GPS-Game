import test from 'node:test'; import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs'; import { goalProgress, currentGoal } from './progression.js';
const cfg = JSON.parse(readFileSync(new URL('./data/config.json', import.meta.url)));
test('goals read progress from state and advance in order', () => {
  const ctx = { binds: 0, shrines: 2, rifts: { skirmish: 1 }, level: 2, gear: 0, species: 3, ascended: 0 };
  assert.deepEqual(goalProgress(cfg.goals[1], ctx), { have: 1, done: true });
  assert.equal(goalProgress(cfg.goals.find((g) => g.id === 'skirmish'), ctx).done, true);
  assert.deepEqual(goalProgress(cfg.goals.find((g) => g.id === 'level3'), ctx), { have: 2, done: false });
  assert.equal(currentGoal(cfg, []).id, 'bind_map');
  assert.equal(currentGoal(cfg, ['bind_map']).id, 'shrine');
  assert.equal(currentGoal(cfg, cfg.goals.map((g) => g.id)), null);
});
