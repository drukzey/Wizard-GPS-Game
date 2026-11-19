// Wizard World combat simulation (M1).
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
  const P = cfg.player;
  const rng = rngFrom(seed);
  const weapon = cfg.weapons[loadout.weaponId];
  const slots = loadout.familiarIds.map((fid, i) => {
    const fam = cfg.familiars[fid];
    if (!fam) throw new Error(`Unknown familiar ${fid}`);
    // Progression (ascension potency, mastery modifiers) arrives as a per-slot ability override.
    const ab = loadout.abilities?.[i] || cfg.abilities[fam.abilityId];
    if (!ab) throw new Error(`Familiar ${fid} references missing ability ${fam.abilityId}`);
    return { familiarId: fid, fam, ab, contrib: { damage: 0, absorbed: 0, hits: 0 } };
  });
  if (slots.length !== 3) throw new Error('Loadout needs exactly 3 familiars');

  const state = {
    t: 0, wave: -1, waveDelay: 1.0, over: false, nextId: 1,
    player: {
      id: 0, team: 'player', x: 0, z: 6, r: P.radius,
      hp: P.health, maxHp: P.health, mana: P.mana, stamina: P.stamina,
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
  function applyDamage(target, amount, source, slot = /^slot\d$/.test(source) ? +source[4] : -1, tick = false) {
    if (target.hp <= 0) return 0;
    if (target.invulnT > 0) { emit({ type: 'dodged', id: target.id, x: target.x, z: target.z }); return 0; }
    let dmg = amount;
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

  function spawnWave() {
    state.wave++;
    const list = cfg.waves[Math.min(state.wave, cfg.waves.length - 1)];
    const extra = Math.max(0, state.wave - (cfg.waves.length - 1));
    list.forEach((eid, i) => {
      const d = cfg.enemies[eid];
      const ang = rng() * Math.PI * 2;
      const e = {
        id: state.nextId++, team: 'enemy', def: d, enemyId: eid,
        x: Math.cos(ang) * (A.halfSize - 2), z: Math.sin(ang) * (A.halfSize - 2) - 2,
        r: d.radius, hp: d.health * (1 + 0.15 * extra), maxHp: d.health * (1 + 0.15 * extra),
        shield: 0, invulnT: 0, stoneT: 0, mode: 'move', modeT: 0, cd: 0.8 + i * 0.4, lockDir: null,
      };
      resolve(e);
      state.enemies.push(e);
      emit({ type: 'spawn', id: e.id, enemyId: eid, x: e.x, z: e.z });
    });
    emit({ type: 'wave', wave: state.wave + 1 });
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
          applyDamage(e, ab.damage, `slot${i}`);
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
          p.dash.hit.add(e.id); applyDamage(e, p.dash.damage, 'dash', p.dash.slot);
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
      spawnProjectile('player', p.x + aim.x * 0.6, p.z + aim.z * 0.6, aim, weapon, 'weapon');
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

  function stepEnemies(dt) {
    const p = state.player;
    for (const e of state.enemies) {
      const d = e.def, dx = p.x - e.x, dz = p.z - e.z, dist = Math.hypot(dx, dz) || 1e-6;
      const sp = d.speed * (1 - enemySlowPct(e));
      e.cd -= dt;
      if (e.mode === 'windup') {
        e.modeT -= dt;
        if (e.modeT <= 0) {
          e.mode = 'move'; e.cd = d.attackCooldown;
          if (d.archetype === 'melee_pursuer') {
            // Swing in the direction locked at windup start (telegraphed arc).
            const ang = Math.acos(Math.max(-1, Math.min(1, (dx * e.lockDir.x + dz * e.lockDir.z) / dist)));
            const hit = dist <= d.attackRange + e.r + p.r * 0.5 && ang <= (d.arcDeg * Math.PI) / 360;
            emit({ type: 'enemyAttack', id: e.id, hit });
            if (hit && !state.over) applyDamage(p, d.damage, e.enemyId);
          } else {
            spawnProjectile('enemy', e.x + e.lockDir.x * 0.7, e.z + e.lockDir.z * 0.7, e.lockDir,
              { speed: d.projectileSpeed, range: d.projectileRange, radius: d.projectileRadius, damage: d.damage }, e.enemyId);
            emit({ type: 'enemyAttack', id: e.id, hit: null });
          }
        }
        continue;
      }
      if (d.archetype === 'melee_pursuer') {
        if (dist <= d.attackRange + e.r && e.cd <= 0) {
          e.mode = 'windup'; e.modeT = d.windup; e.lockDir = { x: dx / dist, z: dz / dist };
          emit({ type: 'telegraph', id: e.id, shape: 'arc', dir: e.lockDir, range: d.attackRange + e.r, arcDeg: d.arcDeg, time: d.windup });
        } else if (dist > d.attackRange * 0.8 + e.r) moveBy(e, (dx / dist) * sp * dt, (dz / dist) * sp * dt);
      } else {
        if (dist < d.projectileRange && e.cd <= 0) {
          e.mode = 'windup'; e.modeT = d.windup; e.lockDir = { x: dx / dist, z: dz / dist };
          emit({ type: 'telegraph', id: e.id, shape: 'line', dir: e.lockDir, range: d.projectileRange, time: d.windup });
        } else if (dist > d.preferredRange + 1) moveBy(e, (dx / dist) * sp * dt, (dz / dist) * sp * dt);
        else if (dist < d.preferredRange - 1) moveBy(e, (-dx / dist) * sp * dt, (-dz / dist) * sp * dt);
      }
      e.face = { x: dx / dist, z: dz / dist };
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
            applyDamage(t, pr.damage, pr.source);
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
    for (const z of state.zones) if (z.dps > 0) for (const e of state.enemies)
      if (Math.hypot(e.x - z.x, e.z - z.z) < z.radius + e.r) applyDamage(e, z.dps * dt, 'zone', z.slot, true);
  }

  function step(input = {}, dt = 1 / 60) {
    if (state.over) return state;
    state.t += dt;
    stepPlayer(input, dt);
    stepEnemies(dt);
    stepProjectiles(dt);
    stepZones(dt);
    state.enemies = state.enemies.filter((e) => e.hp > 0);
    if (opts.waves !== false && state.enemies.length === 0 && !state.over && (state.waveDelay -= dt) <= 0) { spawnWave(); state.waveDelay = 2.5; }
    return state;
  }

  const drainEvents = () => state.events.splice(0);

  // Test/dev helpers (not used by gameplay code).
  function debugSpawn(enemyId, x, z) {
    const d = cfg.enemies[enemyId];
    const e = { id: state.nextId++, team: 'enemy', def: d, enemyId, x, z, r: d.radius, hp: d.health, maxHp: d.health, shield: 0, invulnT: 0, stoneT: 0, mode: 'move', modeT: 0, cd: 99, lockDir: null };
    state.enemies.push(e); return e;
  }

  return { state, step, drainEvents, debugSpawn, applyDamage, spawnProjectile };
}
