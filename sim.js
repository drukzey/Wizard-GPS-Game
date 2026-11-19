// Wizard World combat simulation (M1, enemies and rifts M4).
// Pure logic, no rendering: runs in the browser now and in Node (tests, future server).
// Rule (GDD §3, LOCKED): player attacks follow the input aim vector exactly. No target lookup, no homing.

export const TYPES = ['arcane', 'runic', 'ancient'];

const norm = (v) => {
  if (!v) return null;
  const l = Math.hypot(v.x, v.z);
  return l > 1e-6 ? { x: v.x / l, z: v.z / l } : null;
};

// Aggregate slows, capped (GDD §8 status system).
export function combinedSlow(pcts, capPct) {
  const total = pcts.reduce((a, b) => a + b, 0);
  return Math.min(total, capPct) / 100;
}

function rngFrom(seed) {
  let s = seed >>> 0 || 1;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

export function createSim(cfg, loadout = cfg.defaultLoadout, seed = 1, opts = {}) {
  const P = { ...cfg.player, ...(loadout.player || {}) }; // gear-adjusted stats (M5) arrive precomputed and capped
  const rng = rngFrom(seed);
  const weapon = loadout.weapon || cfg.weapons[loadout.weaponId];
  const slots = loadout.familiarIds.map((fid, i) => {
    const fam = cfg.familiars[fid];
    if (!fam) throw new Error(`Unknown familiar ${fid}`);
    // Progression (ascension potency, mastery modifiers) arrives as a per-slot ability override.
    const ab = loadout.abilities?.[i] || cfg.abilities[fam.abilityId];
    if (!ab) throw new Error(`Familiar ${fid} references missing ability ${fam.abilityId}`);
    return { familiarId: fid, fam, ab, contrib: { damage: 0, absorbed: 0, hits: 0 } };
  });
  if (slots.length !== 3) throw new Error('Loadout needs exactly 3 familiars');

  // A rift (M4) is a finite list of waves plus named modifiers; without one the arena runs endless training waves.
  const enc = opts.encounter || null;
  const M = { speed: 1, cooldown: 1, zoneDuration: 1 };
  for (const id of enc?.modifiers || []) { const m = cfg.riftModifiers[id]; M.speed *= m.enemySpeedMult || 1; M.cooldown *= m.cooldownMult || 1; M.zoneDuration *= m.zoneDurationMult || 1; }
  const state = {
    won: false,
    t: 0, wave: -1, waveDelay: 1.0, over: false, nextId: 1,
    player: {
      id: 0, team: 'player', x: 0, z: 6, r: P.radius,
      hp: P.health, maxHp: P.health, mana: P.mana, maxMana: P.mana, stamina: P.stamina, maxStamina: P.stamina,
      shield: 0, shieldT: 0, stoneT: 0, facing: { x: 0, z: -1 },
      dodgeT: 0, dodgeDir: null, invulnT: 0, dodgeCd: 0, dash: null,
      fireCd: 0, cds: [0, 0, 0], charging: [null, null, null], held: [false, false, false], dodgeHeld: false,
      moving: false, kills: 0,
    },
    slots, enemies: [], projectiles: [], zones: [], events: [],
  };
  const emit = (e) => state.events.push(e);
  const A = cfg.arena;

  function resolve(e) {
    const h = A.halfSize - e.r;
    e.x = Math.max(-h, Math.min(h, e.x));
    e.z = Math.max(-h, Math.min(h, e.z));
    for (const p of A.pillars) {
      const dx = e.x - p.x, dz = e.z - p.z, d = Math.hypot(dx, dz), min = p.r + e.r;
      if (d < min) {
        const k = d > 1e-6 ? min / d : 1;
        e.x = p.x + (d > 1e-6 ? dx * k : min);
        e.z = p.z + (d > 1e-6 ? dz * k : 0);
      }
    }
  }
  // Move in small steps so nothing can be pushed through a pillar or wall.
  function moveBy(e, dx, dz) {
    const dist = Math.hypot(dx, dz), n = Math.max(1, Math.ceil(dist / 0.2));
    for (let i = 0; i < n; i++) { e.x += dx / n; e.z += dz / n; resolve(e); }
  }
  const blocked = (x, z, r) =>
    Math.abs(x) > A.halfSize || Math.abs(z) > A.halfSize ||
    A.pillars.some((p) => Math.hypot(x - p.x, z - p.z) < p.r + r);

  // Mastery contribution: credited to the slot whose ability actually did the work.
  const credit = (i, k, v) => { if (i >= 0 && state.slots[i]) state.slots[i].contrib[k] += v; };
  // o.slot: which familiar slot gets Mastery credit; o.tick: per-frame zone damage; o.dir: travel direction of the hit (for guards).
  function applyDamage(target, amount, source, o = {}) {
    const slot = o.slot ?? (/^slot\d$/.test(source) ? +source[4] : -1), tick = !!o.tick;
    if (target.hp <= 0) return 0;
    if (target.invulnT > 0) { if (!tick) emit({ type: 'dodged', id: target.id, x: target.x, z: target.z }); return 0; }
    let dmg = amount;
    const g = target.def;
    // Defensive guardian: hits travelling into its front arc are mostly blocked while it isn't attacking. Flank it or use area damage.
    if (g?.guardPct && o.dir && target.mode === 'move' && target.face &&
        -(o.dir.x * target.face.x + o.dir.z * target.face.z) > Math.cos((g.guardArcDeg * Math.PI) / 360)) {
      const cut = (dmg * g.guardPct) / 100; dmg -= cut;
      emit({ type: 'blocked', id: target.id, amount: cut, x: target.x, z: target.z });
    }
    if (target.stoneT > 0) { const cut = dmg * target.stoneDr / 100; dmg -= cut; credit(target.stoneSlot ?? -1, 'absorbed', cut); }
    if (target.shield > 0) {
      const absorbed = Math.min(target.shield, dmg);
      target.shield -= absorbed; dmg -= absorbed;
      credit(target.shieldSlot ?? -1, 'absorbed', absorbed);
      emit({ type: 'absorbed', id: target.id, amount: absorbed, x: target.x, z: target.z });
    }
    if (target.team === 'enemy') { credit(slot, 'damage', Math.min(dmg, target.hp)); if (!tick) credit(slot, 'hits', 1); }
    target.hp = Math.max(0, target.hp - dmg);
    emit({ type: 'damage', id: target.id, team: target.team, amount: dmg, source, x: target.x, z: target.z });
    if (target.hp <= 0) {
      emit({ type: 'death', id: target.id, team: target.team, x: target.x, z: target.z });
      if (target.team === 'enemy') state.player.kills++;
      else { state.over = true; emit({ type: 'defeat' }); }
    }
    return dmg;
  }

  function spawnProjectile(team, x, z, dir, spec, source) {
    state.projectiles.push({
      id: state.nextId++, team, x, z, dx: dir.x, dz: dir.z,
      speed: spec.speed, range: spec.range, traveled: 0, r: spec.radius,
      damage: spec.damage, pierce: !!spec.pierce, hit: new Set(), source,
    });
  }

  function makeEnemy(enemyId, x, z, hpMult = 1, cd = 99) {
    const d = cfg.enemies[enemyId], hp = d.health * hpMult;
    return { id: state.nextId++, team: 'enemy', def: d, enemyId, x, z, r: d.radius, hp, maxHp: hp, shield: 0, invulnT: 0, stoneT: 0,
      mode: 'move', modeT: 0, cd, lockDir: null, face: norm({ x: -x, z: -z }) || { x: 0, z: 1 }, phase: 0, ri: 0 };
  }
  function addEnemy(e) { resolve(e); state.enemies.push(e); emit({ type: 'spawn', id: e.id, enemyId: e.enemyId, x: e.x, z: e.z, boss: e.def.archetype === 'boss' }); return e; }
  function edgeSpawn(enemyId, i, hpMult) {
    const ang = rng() * Math.PI * 2;
    return addEnemy(makeEnemy(enemyId, Math.cos(ang) * (A.halfSize - 2), Math.sin(ang) * (A.halfSize - 2) - 2, hpMult, 0.8 + i * 0.4));
  }
  const waveList = () => enc ? enc.waves : cfg.waves;
  function spawnWave() {
    state.wave++;
    const W = waveList(), list = W[Math.min(state.wave, W.length - 1)];
    const extra = enc ? 0 : Math.max(0, state.wave - (W.length - 1)); // endless training only
    list.forEach((eid, i) => edgeSpawn(eid, i, 1 + 0.15 * extra));
    emit({ type: 'wave', wave: state.wave + 1, of: enc ? W.length : null });
  }

  function playerSlowPct() {
    const p = state.player, list = [];
    if (p.stoneT > 0) list.push(p.stoneSlow);
    return combinedSlow(list, cfg.status.slowCapPct);
  }
  function enemySlowPct(e) {
    const list = state.zones.filter((z) => z.slowPct > 0 && Math.hypot(e.x - z.x, e.z - z.z) < z.radius + e.r).map((z) => z.slowPct);
    return combinedSlow(list, cfg.status.slowCapPct);
  }

  function castAbility(i, aim, target, chargeFrac) {
    const p = state.player, { ab, familiarId } = state.slots[i];
    p.cds[i] = ab.cooldown;
    p.mana -= ab.manaCost;
    emit({ type: 'cast', slot: i, familiarId, abilityId: ab.abilityId || state.slots[i].fam.abilityId, kind: ab.kind, x: p.x, z: p.z, dir: aim });
    switch (ab.kind) {
      case 'projectile': {
        const damage = ab.castMode === 'charge' ? ab.damage + (ab.chargeDamage - ab.damage) * chargeFrac : ab.damage;
        const n = ab.count, spread = (ab.spreadDeg * Math.PI) / 180;
        for (let k = 0; k < n; k++) {
          const a = n === 1 ? 0 : -spread + (2 * spread * k) / (n - 1);
          const c = Math.cos(a), s = Math.sin(a);
          // Spread is a fixed pattern around the player's own aim vector, never toward a target.
          const dir = { x: aim.x * c - aim.z * s, z: aim.x * s + aim.z * c };
          spawnProjectile('player', p.x + dir.x * 0.6, p.z + dir.z * 0.6, dir, { ...ab, damage }, `slot${i}`);
        }
        break;
      }
      case 'shield': p.shield = ab.shield; p.shieldT = ab.duration; p.shieldSlot = i; break;
      case 'stoneskin': p.stoneT = ab.duration; p.stoneDr = ab.damageReductionPct; p.stoneSlow = ab.slowPct; p.stoneSlot = i; break;
      case 'dash':
        p.dash = { dx: aim.x, dz: aim.z, left: ab.distance, speed: ab.distance / ab.duration, damage: ab.damage, width: ab.width, hit: new Set(), slot: i };
        break;
      case 'cone': {
        const half = (ab.angleDeg * Math.PI) / 360;
        for (const e of state.enemies) {
          const dx = e.x - p.x, dz = e.z - p.z, d = Math.hypot(dx, dz);
          if (d > ab.range + e.r || d < 1e-6) continue;
          const ang = Math.acos(Math.max(-1, Math.min(1, (dx * aim.x + dz * aim.z) / d)));
          if (ang > half) continue;
          applyDamage(e, ab.damage, `slot${i}`, { dir: aim });
          moveBy(e, (dx / d) * ab.knockback, (dz / d) * ab.knockback);
        }
        break;
      }
      case 'zone': {
        let tx = target ? target.x : p.x + aim.x * ab.range, tz = target ? target.z : p.z + aim.z * ab.range;
        const dx = tx - p.x, dz = tz - p.z, d = Math.hypot(dx, dz);
        if (d > ab.range) { tx = p.x + (dx / d) * ab.range; tz = p.z + (dz / d) * ab.range; }
        state.zones.push({ id: state.nextId++, x: tx, z: tz, radius: ab.radius, t: ab.duration, duration: ab.duration, dps: ab.dps, slowPct: ab.slowPct, slot: i });
        break;
      }
    }
  }

  function stepPlayer(input, dt) {
    const p = state.player;
    const move = norm(input.move);
    const aim = norm(input.aim) || p.facing;
    if (norm(input.aim)) p.facing = aim; else if (move) p.facing = move;

    p.fireCd -= dt; p.dodgeCd -= dt; p.invulnT -= dt;
    for (let i = 0; i < 3; i++) p.cds[i] = Math.max(0, p.cds[i] - dt);
    if (p.shieldT > 0 && (p.shieldT -= dt) <= 0) p.shield = 0;
    if (p.stoneT > 0) p.stoneT -= dt;

    // Dodge
    if (input.dodge && !p.dodgeHeld && p.dodgeCd <= 0 && p.stamina >= P.dodge.staminaCost && !p.dash) {
      p.stamina -= P.dodge.staminaCost;
      p.dodgeT = P.dodge.duration; p.invulnT = P.dodge.invulnerable; p.dodgeCd = P.dodge.cooldown;
      p.dodgeDir = move || aim;
      emit({ type: 'dodge', x: p.x, z: p.z, dir: p.dodgeDir });
    }
    p.dodgeHeld = !!input.dodge;

    p.moving = false;
    if (p.dash) {
      const step = Math.min(p.dash.left, p.dash.speed * dt);
      moveBy(p, p.dash.dx * step, p.dash.dz * step);
      p.dash.left -= step;
      for (const e of state.enemies) {
        if (!p.dash.hit.has(e.id) && Math.hypot(e.x - p.x, e.z - p.z) < e.r + p.r + p.dash.width / 2) {
          p.dash.hit.add(e.id); applyDamage(e, p.dash.damage, 'dash', { slot: p.dash.slot, dir: { x: p.dash.dx, z: p.dash.dz } });
        }
      }
      if (p.dash.left <= 1e-6) p.dash = null;
      p.moving = true;
    } else if (p.dodgeT > 0) {
      const sp = P.dodge.distance / P.dodge.duration;
      moveBy(p, p.dodgeDir.x * sp * dt, p.dodgeDir.z * sp * dt);
      p.dodgeT -= dt; p.moving = true;
    } else if (move) {
      const sp = P.speed * (1 - playerSlowPct());
      moveBy(p, move.x * sp * dt, move.z * sp * dt);
      p.moving = true;
    }

    // Basic weapon: hold to fire along the aim vector.
    if (input.fire && p.fireCd <= 0 && !p.dash) {
      p.fireCd = weapon.fireInterval;
      const n = weapon.count || 1, sp = ((weapon.spreadDeg || 0) * Math.PI) / 180;
      for (let k = 0; k < n; k++) { // a fixed fan around the aim vector, never toward a target
        const a = n === 1 ? 0 : -sp + (2 * sp * k) / (n - 1), c = Math.cos(a), s = Math.sin(a);
        const dir = { x: aim.x * c - aim.z * s, z: aim.x * s + aim.z * c };
        spawnProjectile('player', p.x + dir.x * 0.6, p.z + dir.z * 0.6, dir, weapon, 'weapon');
      }
      emit({ type: 'fire', x: p.x, z: p.z, dir: aim });
    }

    // Familiar abilities
    const held = input.abilities || [false, false, false];
    for (let i = 0; i < 3; i++) {
      const ab = state.slots[i].ab, now = !!held[i], was = p.held[i];
      const ready = p.cds[i] <= 0 && p.mana >= ab.manaCost && !p.dash;
      if (ab.castMode === 'charge') {
        if (now && !was && ready) { p.charging[i] = 0; emit({ type: 'chargeStart', slot: i }); }
        if (now && p.charging[i] !== null) p.charging[i] = Math.min(ab.chargeTime, p.charging[i] + dt);
        if (!now && was && p.charging[i] !== null) {
          castAbility(i, aim, input.target, p.charging[i] / ab.chargeTime); p.charging[i] = null;
        }
      } else if (now && !was) {
        if (ready) castAbility(i, aim, input.target, 0);
        else emit({ type: 'notReady', slot: i, reason: p.cds[i] > 0 ? 'cooldown' : 'mana' });
      }
      p.held[i] = now;
    }

    if (p.dodgeT <= 0) p.stamina = Math.min(P.stamina, p.stamina + P.staminaRegen * dt);
    p.mana = Math.min(P.mana, p.mana + P.manaRegen * dt);
  }

  // Every enemy attack is one telegraphed shape; it resolves exactly as telegraphed (aim locked at windup start).
  function attackOf(e) {
    const d = e.def;
    if (d.archetype === 'ranged_caster') return { shape: 'line', range: d.projectileRange, speed: d.projectileSpeed, radius: d.projectileRadius, damage: d.damage, windup: d.windup, cooldown: d.attackCooldown };
    if (d.archetype === 'zone_controller') return { shape: 'circle', range: d.castRange, radius: d.zoneRadius, duration: d.zoneDuration, dps: d.zoneDps, windup: d.windup, cooldown: d.attackCooldown };
    return { shape: 'arc', range: d.attackRange, arcDeg: d.arcDeg, damage: d.damage, windup: d.windup, cooldown: d.attackCooldown };
  }
  function inReach(e, a, dist) {
    if (a.shape === 'arc') return dist <= a.range + e.r;
    if (a.shape === 'ring') return dist <= a.radius + 1;
    return dist < a.range;
  }
  const rot = (v, rad) => ({ x: v.x * Math.cos(rad) - v.z * Math.sin(rad), z: v.x * Math.sin(rad) + v.z * Math.cos(rad) });
  function beginAttack(e, a, dx, dz, dist) {
    const p = state.player;
    e.mode = 'windup'; e.modeT = a.windup; e.atk = a; e.lockDir = { x: dx / dist, z: dz / dist }; e.lockAt = { x: p.x, z: p.z };
    const base = { type: 'telegraph', id: e.id, time: a.windup };
    if (a.shape === 'arc') emit({ ...base, shape: 'arc', dir: e.lockDir, range: a.range + e.r, arcDeg: a.arcDeg });
    else if (a.shape === 'line') emit({ ...base, shape: 'line', dir: e.lockDir, range: a.range });
    else if (a.shape === 'fan') for (const dir of fanDirs(e.lockDir, a)) emit({ ...base, shape: 'line', dir, range: a.range });
    else if (a.shape === 'circle') emit({ ...base, shape: 'circle', x: p.x, z: p.z, radius: a.radius });
    else if (a.shape === 'ring') emit({ ...base, shape: 'circle', x: e.x, z: e.z, radius: a.radius });
  }
  const fanDirs = (dir, a) => Array.from({ length: a.count }, (_, k) => rot(dir, ((-a.spreadDeg / 2 + (a.spreadDeg * k) / (a.count - 1)) * Math.PI) / 180));
  function releaseAttack(e) {
    const p = state.player, a = e.atk, dx = p.x - e.x, dz = p.z - e.z, dist = Math.hypot(dx, dz) || 1e-6;
    e.mode = 'move'; e.cd = a.cooldown * M.cooldown;
    let hit = null;
    if (a.shape === 'arc') {
      const ang = Math.acos(Math.max(-1, Math.min(1, (dx * e.lockDir.x + dz * e.lockDir.z) / dist)));
      hit = dist <= a.range + e.r + p.r * 0.5 && ang <= (a.arcDeg * Math.PI) / 360;
    } else if (a.shape === 'ring') hit = dist <= a.radius + p.r;
    else if (a.shape === 'circle') {
      const t = a.duration * M.zoneDuration;
      state.zones.push({ id: state.nextId++, team: 'enemy', x: e.lockAt.x, z: e.lockAt.z, radius: a.radius, t, duration: t, dps: a.dps, slowPct: 0, source: e.enemyId });
    } else {
      const spec = { speed: a.speed, range: a.range, radius: a.radius, damage: a.damage };
      for (const dir of a.shape === 'fan' ? fanDirs(e.lockDir, a) : [e.lockDir]) spawnProjectile('enemy', e.x + dir.x * 0.7, e.z + dir.z * 0.7, dir, spec, e.enemyId);
    }
    emit({ type: 'enemyAttack', id: e.id, hit, shape: a.shape });
    if (hit && !state.over) applyDamage(p, a.damage, e.enemyId);
  }
  // Boss: health thresholds move it to the next phase (new attack rotation, summons, faster cooldowns).
  function bossPhase(e) {
    const ph = e.def.phases;
    while (e.phase + 1 < ph.length && e.hp / e.maxHp <= ph[e.phase + 1].at) {
      e.phase++; e.ri = 0; e.cd = 1.2;
      emit({ type: 'phase', id: e.id, phase: e.phase + 1, name: ph[e.phase].name });
      (ph[e.phase].summon || []).forEach((eid, i) => edgeSpawn(eid, i + 1, 1));
    }
    const P2 = ph[e.phase], list = P2.attacks;
    e.cdMult = P2.cooldownMult || 1;
    return list;
  }
  function stepEnemies(dt) {
    const p = state.player;
    for (const e of [...state.enemies]) {
      const d = e.def, dx = p.x - e.x, dz = p.z - e.z, dist = Math.hypot(dx, dz) || 1e-6;
      const sp = d.speed * M.speed * (1 - enemySlowPct(e));
      e.cd -= dt * (e.cdMult ? 1 / e.cdMult : 1);
      if (e.mode === 'windup') { if ((e.modeT -= dt) <= 0) releaseAttack(e); continue; }
      let a;
      if (d.archetype === 'boss') {
        const list = bossPhase(e);
        if (e.cd <= 0)
        // Fixed rotation; skip an attack that can't reach yet so the boss never stalls.
        for (let k = 0; k < list.length && !a; k++) { const n = list[(e.ri + k) % list.length]; if (inReach(e, d.attacks[n], dist)) { a = d.attacks[n]; e.ri = (e.ri + k + 1) % list.length; } }
      } else a = attackOf(e);
      if (a && e.cd <= 0 && inReach(e, a, dist)) { beginAttack(e, a, dx, dz, dist); continue; }
      const keep = d.preferredRange;
      if (keep) {
        if (dist > keep + 1) moveBy(e, (dx / dist) * sp * dt, (dz / dist) * sp * dt);
        else if (dist < keep - 1) moveBy(e, (-dx / dist) * sp * dt, (-dz / dist) * sp * dt);
      } else if (dist > (d.attackRange || 2) * 0.8 + e.r) moveBy(e, (dx / dist) * sp * dt, (dz / dist) * sp * dt);
      // Facing: instant for most; a guardian turns slowly so a dodge past its shield opens its back.
      const want = { x: dx / dist, z: dz / dist };
      if (d.turnRateDeg) {
        const cross = e.face.x * want.z - e.face.z * want.x, dot = e.face.x * want.x + e.face.z * want.z;
        const ang = Math.atan2(cross, dot), max = (d.turnRateDeg * Math.PI * dt) / 180;
        e.face = rot(e.face, Math.max(-max, Math.min(max, ang)));
      } else e.face = want;
    }
    // Keep enemies from stacking.
    for (let i = 0; i < state.enemies.length; i++) for (let j = i + 1; j < state.enemies.length; j++) {
      const a = state.enemies[i], b = state.enemies[j];
      const dx = b.x - a.x, dz = b.z - a.z, d = Math.hypot(dx, dz), min = a.r + b.r;
      if (d < min && d > 1e-6) { const k = (min - d) / 2 / d; moveBy(a, -dx * k, -dz * k); moveBy(b, dx * k, dz * k); }
    }
  }

  function stepProjectiles(dt) {
    const keep = [];
    for (const pr of state.projectiles) {
      const dist = pr.speed * dt, n = Math.max(1, Math.ceil(dist / Math.max(0.1, pr.r)));
      let alive = true;
      for (let s = 0; s < n && alive; s++) {
        pr.x += (pr.dx * dist) / n; pr.z += (pr.dz * dist) / n; pr.traveled += dist / n;
        if (pr.traveled >= pr.range || blocked(pr.x, pr.z, pr.r * 0.5)) { alive = false; emit({ type: 'projectileEnd', id: pr.id, x: pr.x, z: pr.z, team: pr.team }); break; }
        const targets = pr.team === 'player' ? state.enemies : [state.player];
        for (const t of targets) {
          if (t.hp <= 0 || pr.hit.has(t.id)) continue;
          if (Math.hypot(t.x - pr.x, t.z - pr.z) < t.r + pr.r) {
            pr.hit.add(t.id);
            applyDamage(t, pr.damage, pr.source, { dir: { x: pr.dx, z: pr.dz } });
            if (!pr.pierce) { alive = false; emit({ type: 'projectileEnd', id: pr.id, x: pr.x, z: pr.z, team: pr.team }); break; }
          }
        }
      }
      if (alive) keep.push(pr);
    }
    state.projectiles = keep;
  }

  function stepZones(dt) {
    state.zones = state.zones.filter((z) => (z.t -= dt) > 0);
    const p = state.player;
    for (const z of state.zones) {
      if (z.team === 'enemy') { if (z.dps > 0 && !state.over && Math.hypot(p.x - z.x, p.z - z.z) < z.radius + p.r) applyDamage(p, z.dps * dt, z.source, { tick: true }); continue; }
      if (z.dps > 0) for (const e of state.enemies)
        if (Math.hypot(e.x - z.x, e.z - z.z) < z.radius + e.r) applyDamage(e, z.dps * dt, 'zone', { slot: z.slot, tick: true });
    }
  }

  function step(input = {}, dt = 1 / 60) {
    if (state.over) return state;
    state.t += dt;
    stepPlayer(input, dt);
    stepEnemies(dt);
    stepProjectiles(dt);
    stepZones(dt);
    state.enemies = state.enemies.filter((e) => e.hp > 0);
    if (opts.waves !== false && state.enemies.length === 0 && !state.over) {
      if (enc && state.wave >= enc.waves.length - 1) { state.over = true; state.won = true; emit({ type: 'victory' }); }
      else if ((state.waveDelay -= dt) <= 0) { spawnWave(); state.waveDelay = 2.5; }
    }
    return state;
  }

  const drainEvents = () => state.events.splice(0);

  // Test/dev helpers (not used by gameplay code).
  function debugSpawn(enemyId, x, z) {
    const e = makeEnemy(enemyId, x, z); state.enemies.push(e); return e;
  }

  return { state, step, drainEvents, debugSpawn, applyDamage, spawnProjectile };
}
