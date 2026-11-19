import * as THREE from 'three';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { createSim } from './sim.js?v=8';
import { Animator, makeLibrary, gunzipB64 } from './anim.js?v=8';
import * as Col from './collection.js?v=8';
import * as P from './progression.js?v=8';
import { initWorld, openWorld, returnToWorld, tickWorld, worldOpen } from './map.js?v=8';

const $ = (id) => document.getElementById(id);
const store = { get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} } };

const RARITY = ['common', 'uncommon', 'rare', 'epic', 'legendary', 'mythic', 'celestial', 'transcendent'];
const TYPE_HEX = { arcane: 0xa77bff, runic: 0x47d18c, ancient: 0x33c9c9 };
const css = (t) => `var(--${t})`;
const icon = (key, color) => `<i class="ico" style="--m:var(--u-${key});--c:${color}"></i>`;

// ---------- settings ----------
const settings = { reducedMotion: store.get('ww.rm', matchMedia('(prefers-reduced-motion: reduce)').matches), lefty: store.get('ww.lefty', false), sound: store.get('tc.sound', true) };
$('optSound').checked = settings.sound;
$('optSound').onchange = (e) => { settings.sound = e.target.checked; store.set('tc.sound', settings.sound); };
$('optMotion').checked = settings.reducedMotion; $('optLefty').checked = settings.lefty;
$('optMotion').onchange = (e) => { settings.reducedMotion = e.target.checked; store.set('ww.rm', settings.reducedMotion); };
$('optLefty').onchange = (e) => { settings.lefty = e.target.checked; store.set('ww.lefty', settings.lefty); document.body.classList.toggle('lefty', settings.lefty); };
document.body.classList.toggle('lefty', settings.lefty);
const isTouch = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
document.body.classList.toggle('touch', isTouch);

// ---------- three setup ----------
const renderer = new THREE.WebGLRenderer({ canvas: $('c'), antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0f1416);
scene.fog = new THREE.Fog(0x0f1416, 34, 60);
const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 200);
const CAM_OFF = new THREE.Vector3(14, 17, 14);
scene.add(new THREE.HemisphereLight(0xbfe3d6, 0x1d2426, 1.5));
const sun = new THREE.DirectionalLight(0xffe2b8, 2.3);
sun.position.set(10, 22, 6); sun.castShadow = true;
sun.shadow.mapSize.set(1024, 1024);
Object.assign(sun.shadow.camera, { left: -18, right: 18, top: 18, bottom: -18, near: 1, far: 60 });
scene.add(sun, sun.target);

const dbg = { close: false, freeze: false };
function resize() {
  const w = innerWidth, h = innerHeight, view = dbg.close ? 2.2 : (w < h ? 9.5 : 7);
  const a = w / h;
  Object.assign(cam, { left: -view * a, right: view * a, top: view, bottom: -view });
  cam.updateProjectionMatrix(); renderer.setSize(w, h, false);
}
addEventListener('resize', resize); resize();

const FWD = new THREE.Vector2(-1, -1).normalize(), RIGHT = new THREE.Vector2(1, -1).normalize();
const screenToWorld = (sx, sy) => ({ x: RIGHT.x * sx - FWD.x * sy, z: RIGHT.y * sx - FWD.y * sy }); // sy: screen down positive

// ---------- assets ----------
const manager = new THREE.LoadingManager();
const PIXEL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
manager.setURLModifier((u) => (/\.(png|tga|jpe?g|psd|tif)$/i.test(u) ? PIXEL : u)); // Synty FBX texture paths are replaced below
const fbx = new FBXLoader(manager);
const MODELS = { mage: ['kingdom', 1.85], spirit_demon: ['rivals', 2.1], fort_golem: ['rivals', 2.5], medusa: ['rivals', 2.1],
  troll: ['rivals', 2.7], dark_elf: ['rivals', 1.95], base_dungeon: ['rivals', 0],
  mystic: ['rivals', 2.0], elemental_golem: ['rivals', 2.5], fairy: ['kingdom', 1.5], gargoyle: ['darkfantasy', 2.3], parrot: ['pirate', 0.9], squid: ['pirate', 0.9],
  mech_golem: ['rivals', 2.6], ancient_warrior: ['rivals', 2.0], evil_god: ['rivals', 3.6] };
const ATLAS = { kingdom: 'assets/kingdom_atlas.png', rivals: 'assets/rivals_atlas.png', darkfantasy: 'assets/darkfantasy_atlas.png', pirate: 'assets/pirate_atlas.png' };
const UI_SPRITES = ['orbL', 'orbR', 'orbGlass', 'orbSheen', 'ring', 'ringBg', 'bar', 'barBg', 'box', 'circle', 'vignette', 'sigilL', 'sigilM', 'reticle',
  'i_arcane', 'i_runic', 'i_ancient', 'i_dodge', 'i_abl_arcane_bolt', 'i_abl_charged_blast', 'i_abl_spark_fan', 'i_abl_rune_shield',
  'i_abl_retaliation_circle', 'i_abl_stone_skin', 'i_abl_serpent_dash', 'i_abl_gust', 'i_abl_ink_pool'];
const assets = { atlas: {}, models: {}, tex: {}, lib: null };

async function loadImage(url) {
  const blob = await (await fetch(url)).blob();
  const src = URL.createObjectURL(blob);
  const img = new Image(); img.src = src; await img.decode(); return { img, src };
}
async function loadTexture(url) {
  const { img } = await loadImage(url);
  const t = new THREE.Texture(img); t.colorSpace = THREE.SRGBColorSpace; t.needsUpdate = true; return t;
}
// Synty rigs are bound in a T-pose. Used only if the animation packs fail to load.
function relaxArms(root) {
  root.updateMatrixWorld(true);
  const bones = []; root.traverse((o) => { if (o.isBone) bones.push(o); });
  for (const side of ['L', 'R']) {
    const re = new RegExp(`^(upperarm|shoulder|arm)[_ ]?${side}$`, 'i');
    const upper = bones.find((b) => re.test(b.name.replace(/.*:/, '')));
    const child = upper && upper.children.find((c) => c.isBone);
    if (!child) continue;
    const a = upper.getWorldPosition(new THREE.Vector3()), b = child.getWorldPosition(new THREE.Vector3());
    const cur = b.sub(a).normalize(), target = new THREE.Vector3(cur.x * 0.28, -1, cur.z * 0.28).normalize();
    const qWorld = new THREE.Quaternion().setFromUnitVectors(cur, target);
    const boneQ = upper.getWorldQuaternion(new THREE.Quaternion()), parentQ = upper.parent.getWorldQuaternion(new THREE.Quaternion());
    upper.quaternion.copy(parentQ.invert().multiply(qWorld).multiply(boneQ));
    root.updateMatrixWorld(true);
  }
}
function prep(obj, atlas, height) {
  obj.traverse((o) => { if (o.isMesh) { o.material = new THREE.MeshLambertMaterial({ map: atlas }); o.castShadow = true; o.receiveShadow = true; o.frustumCulled = false; } });
  obj.updateMatrixWorld(true);
  let box = new THREE.Box3().setFromObject(obj);
  if (height) obj.scale.multiplyScalar(height / Math.max(0.001, box.max.y - box.min.y));
  obj.updateMatrixWorld(true); box = new THREE.Box3().setFromObject(obj);
  const c = box.getCenter(new THREE.Vector3());
  obj.position.x -= c.x; obj.position.z -= c.z; obj.position.y -= box.min.y;
  const g = new THREE.Group(); g.add(obj); return g;
}
async function loadAll() {
  const steps = 5; let done = 0;
  const tick = (name) => { done++; $('loadI').style.width = `${(100 * done) / steps}%`; $('loadT').textContent = name; };
  // HUD sprites -> CSS variables (and a few as textures for ground effects)
  await Promise.all(UI_SPRITES.map(async (k) => {
    const { img, src } = await loadImage(`ui/${k}.png?v=8`);
    document.documentElement.style.setProperty(`--u-${k}`, `url("${src}")`);
    if (['sigilL', 'sigilM', 'reticle'].includes(k)) { const t = new THREE.Texture(img); t.colorSpace = THREE.SRGBColorSpace; t.needsUpdate = true; assets.tex[k] = t; }
  }));
  tick('Interface');
  for (const [k, f] of Object.entries(ATLAS)) assets.atlas[k] = await loadTexture(f);
  tick('Textures');
  try {
    if (typeof DecompressionStream === 'undefined') throw new Error('This browser cannot unpack animations');
    const packed = (await import('./pub/anims.js?v=8')).default;
    const objs = {};
    for (const [k, b64] of Object.entries(packed)) objs[k] = fbx.parse(await gunzipB64(b64), '');
    // The skeleton inside an animation file is the source rig, so clips and rest pose share one root orientation.
    const rig = SkeletonUtils.clone(objs.idle);
    assets.lib = makeLibrary(rig, objs);
    console.info('[anim] clips', Object.entries(assets.lib.clips).map(([n, c]) => `${n} ${c.duration.toFixed(2)}s/${c.tracks.length}tr`).join(', '));
  } catch (err) { console.warn('[anim] animations unavailable, using procedural motion', err); assets.lib = null; }
  tick('Animations');
  const models = { ...(await import('./pub/models.js?v=8')).default, ...(await import('./pub/models_m4.js?v=8')).default };
  for (const [k, [atl, h]] of Object.entries(MODELS)) {
    try {
      const obj = fbx.parse(await gunzipB64(models[k]), '');
      if (k === 'fairy') { // wings are separate meshes in the same space: pin them to the upper spine
        obj.updateMatrixWorld(true);
        let spine = null; obj.traverse((o) => { if (/spine_03$/i.test(o.name)) spine = o; });
        for (const w of ['fairy_wing_l', 'fairy_wing_r']) { const wing = fbx.parse(await gunzipB64(models[w]), ''); obj.add(wing); obj.updateMatrixWorld(true); if (spine) spine.attach(wing); }
      }
      if (h && !assets.lib) relaxArms(obj);
      assets.models[k] = prep(obj, assets.atlas[atl], h);
    } catch (err) { console.warn(`[assets] ${k} failed`, err); }
  }
  tick('Models');
}
// Returns a wrapper group; .userData.anim is an Animator when the animation packs loaded.
function instance(key) {
  const src = assets.models[key];
  if (!src) return null;
  const g = SkeletonUtils.clone(src);
  g.traverse((o) => { if (o.isMesh) o.material = o.material.clone(); });
  let hasBones = false; g.traverse((o) => { if (o.isBone) hasBones = true; });
  if (assets.lib && MODELS[key][1] && hasBones) {
    try {
      const an = new Animator(assets.lib, g.children[0]);
      if (an.ok) { g.userData.anim = an; an.setLoco({ idle: 1 }); an.update(0); }
      else console.warn(`[anim] ${key}: only ${an.pairs.length} bones matched`);
    } catch (err) { console.warn(`[anim] ${key} retarget failed`, err); }
  }
  return g;
}

// ---------- arena ----------
function groundTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 512; const x = c.getContext('2d');
  x.fillStyle = '#1e2527'; x.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 8; i++) for (let j = 0; j < 8; j++) {
    const v = 40 + ((i * 7 + j * 13) % 9) * 2;
    x.fillStyle = `rgb(${v - 6},${v + 2},${v + 2})`; x.fillRect(i * 64 + 2, j * 64 + 2, 60, 60);
  }
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(6, 6); t.colorSpace = THREE.SRGBColorSpace; return t;
}
function decal(tex, size, color, opacity = 0.8) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(size, size), new THREE.MeshBasicMaterial({ map: tex, color, transparent: true, opacity, depthWrite: false, blending: THREE.AdditiveBlending }));
  m.rotation.x = -Math.PI / 2; return m;
}
function buildArena(cfg) {
  const H = cfg.arena.halfSize;
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(H * 2, H * 2), new THREE.MeshLambertMaterial({ map: groundTexture() }));
  floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; scene.add(floor);
  if (assets.tex.sigilL) { const s = decal(assets.tex.sigilL, 9, 0x5fd6b8, 0.18); s.position.y = 0.01; scene.add(s); }
  const outer = new THREE.Mesh(new THREE.PlaneGeometry(H * 6, H * 6), new THREE.MeshLambertMaterial({ color: 0x0a0e0f }));
  outer.rotation.x = -Math.PI / 2; outer.position.y = -0.02; scene.add(outer);
  const wallMat = new THREE.MeshLambertMaterial({ color: 0x343d3f });
  for (const [x, z, w, d] of [[0, -H - 0.4, H * 2 + 1.6, 0.8], [0, H + 0.4, H * 2 + 1.6, 0.8], [-H - 0.4, 0, 0.8, H * 2], [H + 0.4, 0, 0.8, H * 2]]) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, 0.9, d), wallMat); m.position.set(x, 0.45, z); m.castShadow = m.receiveShadow = true; scene.add(m);
  }
  const pillarMat = new THREE.MeshLambertMaterial({ color: 0x55605f, flatShading: true });
  const runeMat = new THREE.MeshBasicMaterial({ color: 0x5fd6b8 });
  for (const p of cfg.arena.pillars) {
    const g = new THREE.Group(); g.position.set(p.x, 0, p.z);
    const col = new THREE.Mesh(new THREE.CylinderGeometry(p.r * 0.85, p.r, 3.2, 8), pillarMat); col.position.y = 1.6; col.castShadow = col.receiveShadow = true; g.add(col);
    const rune = new THREE.Mesh(new THREE.TorusGeometry(p.r * 0.9, 0.05, 6, 24), runeMat); rune.rotation.x = Math.PI / 2; rune.position.y = 2.2; g.add(rune);
    if (assets.models.base_dungeon) { const b = SkeletonUtils.clone(assets.models.base_dungeon); b.scale.multiplyScalar(p.r * 1.1); g.add(b); }
    scene.add(g);
  }
}

// ---------- game state ----------
let cfg, sim = null, running = false, paused = true, col = null, prof = null, runTx = null;
let loadout = store.get('ww.loadout', null);
const vis = { player: null, enemies: new Map(), projectiles: new Map(), zones: new Map(), fx: [] };
const tmpV = new THREE.Vector3();

function playerVisual() {
  const g = new THREE.Group();
  const body = instance('mage') || new THREE.Mesh(new THREE.CapsuleGeometry(0.4, 1, 4, 8), new THREE.MeshLambertMaterial({ color: 0x6a4fd8 }));
  g.add(body); g.userData.body = body; g.userData.anim = body.userData.anim;
  const aimPivot = new THREE.Group();
  const aim = new THREE.Mesh(new THREE.PlaneGeometry(0.1, 3.4), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.28, depthWrite: false }));
  aim.rotation.x = -Math.PI / 2; aim.position.set(0, 0.05, 2.3); aimPivot.add(aim);
  if (assets.tex.reticle) { const r = decal(assets.tex.reticle, 1.4, 0xffffff, 0.9); r.rotation.z = Math.PI; r.position.set(0, 0.06, 4.1); aimPivot.add(r); }
  scene.add(aimPivot); g.userData.aimPivot = aimPivot;
  const shield = new THREE.Mesh(new THREE.SphereGeometry(1.15, 20, 14), new THREE.MeshBasicMaterial({ color: TYPE_HEX.runic, transparent: true, opacity: 0.18, depthWrite: false }));
  shield.position.y = 1; shield.visible = false; g.add(shield); g.userData.shield = shield;
  if (assets.tex.sigilM) { const ring = decal(assets.tex.sigilM, 1.5, 0x9a7bff, 0.55); ring.position.y = 0.03; g.add(ring); g.userData.ring = ring; }
  scene.add(g); return g;
}
function enemyVisual(e) {
  const g = new THREE.Group();
  const body = instance(e.def.model) || new THREE.Mesh(new THREE.CapsuleGeometry(e.r * 0.8, 1.2, 4, 8), new THREE.MeshLambertMaterial({ color: 0x884444 }));
  g.add(body); g.userData.body = body; g.userData.anim = body.userData.anim;
  const hb = new THREE.Group();
  const bg = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 0.14), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.6, depthTest: false }));
  const fg = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 0.14), new THREE.MeshBasicMaterial({ color: 0xe0424f, depthTest: false }));
  fg.geometry.translate(0.6, 0, 0); fg.position.x = -0.6; fg.position.z = 0.001; bg.renderOrder = fg.renderOrder = 10;
  hb.add(bg, fg); hb.position.y = (MODELS[e.def.model]?.[1] || 2) + 0.4; g.add(hb);
  if (e.def.archetype === 'boss') hb.scale.set(2.2, 1.6, 1);
  if (e.def.guardPct) { // the guard arc is drawn on the ground in front of it, and vanishes while it attacks
    const half = (e.def.guardArcDeg * Math.PI) / 360;
    const arc = new THREE.Mesh(new THREE.RingGeometry(1.0, 1.35, 24, 1, -Math.PI / 2 - half, half * 2), new THREE.MeshBasicMaterial({ color: 0x9fd4ff, transparent: true, opacity: 0.55, depthWrite: false, side: THREE.DoubleSide }));
    arc.rotation.x = -Math.PI / 2; arc.position.y = 0.05; g.add(arc); g.userData.guard = arc;
  }
  g.userData.hb = hb; g.userData.fg = fg;
  g.position.set(e.x, 0, e.z); scene.add(g); return g;
}
function flash(g, color = 0xffffff, t = 0.12) {
  if (settings.reducedMotion) color = 0x553333;
  g.userData.body.traverse((o) => { if (o.isMesh && o.material.emissive) o.material.emissive.setHex(color); });
  g.userData.flashT = t;
}

// ---------- fx ----------
const fxGroup = new THREE.Group(); scene.add(fxGroup);
function addFx(mesh, life, update) { if (mesh) fxGroup.add(mesh); vis.fx.push({ mesh, life, t: 0, update }); }
function ringFx(x, z, color, r0, r1, life = 0.35) {
  const m = new THREE.Mesh(new THREE.RingGeometry(0.85, 1, 40), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide }));
  m.rotation.x = -Math.PI / 2; m.position.set(x, 0.06, z);
  addFx(m, life, (f, k) => { const s = r0 + (r1 - r0) * k; m.scale.set(s, s, s); m.material.opacity = 0.9 * (1 - k); });
}
function sigilFx(x, z, color, size, life) {
  if (!assets.tex.sigilL) return ringFx(x, z, color, 0.6, size / 2, life);
  const m = decal(assets.tex.sigilL, size, color, 1); m.position.set(x, 0.05, z);
  addFx(m, life, (f, k) => { m.rotation.z = k * 1.2; const s = 0.6 + 0.4 * Math.min(1, k * 3); m.scale.set(s, s, s); m.material.opacity = k < 0.6 ? 1 : (1 - k) / 0.4; });
}
function telegraphFx(ev, enemy) {
  const mat = new THREE.MeshBasicMaterial({ color: 0xff3b3b, transparent: true, opacity: 0.28, depthWrite: false, side: THREE.DoubleSide });
  let m;
  if (ev.shape === 'circle') { // ground target: drawn where it will land, not on the enemy
    m = new THREE.Mesh(new THREE.CircleGeometry(ev.radius, 40), mat); m.rotation.x = -Math.PI / 2; m.position.set(ev.x, 0.04, ev.z);
    const fill = m.clone(); fill.material = mat.clone(); fill.material.opacity = 0.35; fill.position.y = 0.05;
    addFx(m, ev.time, (f, k) => { m.material.opacity = 0.2 + 0.2 * Math.sin(k * 20) ** 2; });
    addFx(fill, ev.time, (f, k) => { fill.scale.set(k, k, k); });
    return;
  }
  if (ev.shape === 'arc') {
    const half = (ev.arcDeg * Math.PI) / 360;
    m = new THREE.Mesh(new THREE.CircleGeometry(ev.range, 28, Math.PI / 2 - half, half * 2), mat);
  } else {
    const g = new THREE.PlaneGeometry(0.6, ev.range); g.translate(0, ev.range / 2, 0); m = new THREE.Mesh(g, mat);
  }
  m.rotation.x = -Math.PI / 2;
  m.rotation.z = Math.atan2(ev.dir.x, ev.dir.z) - Math.PI;
  m.position.set(enemy.x, 0.04, enemy.z);
  const fill = m.clone(); fill.material = mat.clone(); fill.material.opacity = 0.35; fill.scale.set(0, 0, 0); fill.position.y = 0.05;
  addFx(m, ev.time, (f, k) => { m.material.opacity = 0.2 + 0.2 * Math.sin(k * 20) ** 2; });
  addFx(fill, ev.time, (f, k) => { fill.scale.set(ev.shape === 'arc' ? k : 1, k, 1); });
}
function ghostFx(familiarId, x, z, dir) {
  const fam = cfg.familiars[familiarId], col = TYPE_HEX[fam.type];
  sigilFx(x, z, col, 4.2, 0.8);
  if (!(fam.model && assets.models[fam.model])) return;
  const g = instance(fam.model);
  if (g.userData.anim) { g.userData.anim.pose('cast', 0.35); }
  g.traverse((o) => { if (o.isMesh) o.material = new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.6, depthWrite: false }); });
  g.position.set(x - dir.x * 1.2, 0, z - dir.z * 1.2); g.rotation.y = Math.atan2(dir.x, dir.z);
  addFx(g, 0.75, (f, k) => { const s = 0.7 + 0.35 * k; g.scale.set(s, s, s); g.position.y = k * 0.6; g.traverse((o) => { if (o.isMesh) o.material.opacity = 0.6 * (1 - k); }); });
}
const dmgLayer = $('hud');
function floatText(x, z, text, color, big) {
  const el = document.createElement('div'); el.className = 'dmg'; el.textContent = text; el.style.color = color; if (big) el.style.fontSize = '20px';
  dmgLayer.appendChild(el);
  const ox = (Math.random() - 0.5) * 0.6;
  vis.fx.push({ mesh: null, life: 0.8, t: 0, el, update: (f, k) => {
    tmpV.set(x + ox, 2.4 + k * 1.2, z).project(cam);
    el.style.left = `${(tmpV.x * 0.5 + 0.5) * innerWidth}px`; el.style.top = `${(-tmpV.y * 0.5 + 0.5) * innerHeight}px`; el.style.opacity = String(1 - k * k);
  } });
}
let shakeT = 0;
function banner(text) { const b = $('banner'); b.textContent = text; b.style.opacity = 1; clearTimeout(banner.t); banner.t = setTimeout(() => (b.style.opacity = 0), 1400); }

// ---------- HUD ----------
function buildAbilityButtons() {
  const wrap = $('abilities'); wrap.innerHTML = '';
  const keys = ['Q', 'E', 'R'];
  sim.state.slots.forEach((s, i) => {
    const b = document.createElement('div'); b.className = 'ab'; b.style.setProperty('--c', css(s.fam.type));
    b.innerHTML = `<span class="bgc"></span>${icon(`i_${s.fam.abilityId}`, css(s.fam.type))}<span class="cd" style="--p:0%"></span><span class="frame"></span>
      <span class="tp">${icon(`i_${s.fam.type}`, '#111')}${s.fam.type.toUpperCase()}</span><span class="nm">${s.ab.name}</span><span class="key">${isTouch ? '' : keys[i]}</span><b class="cdn"></b>`;
    b.setAttribute('aria-label', `${s.ab.name}, ${s.fam.name}, ${s.fam.type}`);
    wrap.appendChild(b); bindAbilityButton(b, i);
  });
}
function updateHud() {
  const p = sim.state.player, P = cfg.player;
  $('hpFill').style.height = `${(100 * p.hp) / p.maxHp}%`;
  $('hpT').textContent = Math.ceil(p.hp);
  $('shT').textContent = p.shield > 0 ? `+${Math.ceil(p.shield)}` : '';
  $('hpOrb').classList.toggle('shielded', p.shield > 0);
  $('mpFill').style.height = `${(100 * p.mana) / P.mana}%`; $('mpT').textContent = Math.floor(p.mana);
  $('stFill').style.transform = `scaleX(${p.stamina / P.stamina})`;
  $('stBar').classList.toggle('low', p.stamina < P.dodge.staminaCost);
  const boss = sim.state.enemies.find((e) => e.def.archetype === 'boss');
  $('topT').textContent = `${activeRift ? `${activeRift.name} · wave ${Math.max(1, sim.state.wave + 1)} of ${activeRift.waves.length}` : `Wave ${Math.max(1, sim.state.wave + 1)}`} · ${p.kills} defeated${boss ? ` · ${boss.def.name} ${Math.ceil((100 * boss.hp) / boss.maxHp)}%` : ''}`;
  $('vig').style.opacity = settings.reducedMotion ? 0 : Math.max(0, 0.9 - (p.hp / p.maxHp) * 2.6).toFixed(2);
  [...$('abilities').children].forEach((b, i) => {
    const ab = sim.state.slots[i].ab, cd = p.cds[i];
    b.querySelector('.cd').style.setProperty('--p', `${(100 * cd) / ab.cooldown}%`);
    b.querySelector('.cdn').textContent = cd > 0 ? Math.ceil(cd) : '';
    b.classList.toggle('nomana', p.mana < ab.manaCost && cd <= 0);
    b.classList.toggle('charging', p.charging[i] !== null);
  });
}

// ---------- input ----------
const keys = new Set();
const mouse = { x: 0, y: 0, down: false, has: false };
const touch = { ab: [null, null, null], release: [false, false, false], releaseAim: [null, null, null], releaseTarget: [null, null, null], dodge: false };
addEventListener('keydown', (e) => {
  if (location.hash === '#debug' && e.code === 'KeyZ') { dbg.close = !dbg.close; resize(); }
  if (location.hash === '#debug' && e.code === 'KeyP') dbg.freeze = !dbg.freeze;
  keys.add(e.code); if (e.code === 'Escape') toggleMenu(true); if (['Space', 'KeyQ', 'KeyE', 'KeyR'].includes(e.code)) e.preventDefault(); });
addEventListener('keyup', (e) => keys.delete(e.code));
addEventListener('blur', () => { keys.clear(); mouse.down = false; });
const canvas = $('c');
canvas.addEventListener('mousemove', (e) => { mouse.x = e.clientX; mouse.y = e.clientY; mouse.has = true; });
canvas.addEventListener('mousedown', (e) => { if (e.button === 0) mouse.down = true; });
addEventListener('mouseup', () => (mouse.down = false));
canvas.addEventListener('contextmenu', (e) => e.preventDefault());

const ray = new THREE.Raycaster(), groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), ndc = new THREE.Vector2();
function screenToGround(x, y) {
  ndc.set((x / innerWidth) * 2 - 1, -(y / innerHeight) * 2 + 1); ray.setFromCamera(ndc, cam);
  const hit = new THREE.Vector3(); return ray.ray.intersectPlane(groundPlane, hit) ? hit : null;
}
const STICK_R = 55;
const sticks = { L: { el: $('stickL'), id: null, ox: 0, oy: 0, v: null }, R: { el: $('stickR'), id: null, ox: 0, oy: 0, v: null } };
function stickFor(x) { const leftHalf = x < innerWidth / 2; return (leftHalf !== settings.lefty) ? sticks.L : sticks.R; }
canvas.addEventListener('pointerdown', (e) => {
  if (e.pointerType === 'mouse') return;
  const s = stickFor(e.clientX); if (s.id !== null) return;
  s.id = e.pointerId; s.ox = e.clientX; s.oy = e.clientY; s.v = { x: 0, y: 0 };
  s.el.style.display = 'block'; s.el.style.left = `${s.ox}px`; s.el.style.top = `${s.oy}px`; s.el.firstElementChild.style.transform = '';
  canvas.setPointerCapture(e.pointerId);
});
canvas.addEventListener('pointermove', (e) => {
  for (const s of Object.values(sticks)) if (s.id === e.pointerId) {
    let dx = e.clientX - s.ox, dy = e.clientY - s.oy; const l = Math.hypot(dx, dy);
    if (l > STICK_R) { dx *= STICK_R / l; dy *= STICK_R / l; }
    s.v = { x: dx / STICK_R, y: dy / STICK_R }; s.el.firstElementChild.style.transform = `translate(${dx}px,${dy}px)`;
  }
});
const endStick = (e) => { for (const s of Object.values(sticks)) if (s.id === e.pointerId) { s.id = null; s.v = null; s.el.style.display = 'none'; } };
canvas.addEventListener('pointerup', endStick); canvas.addEventListener('pointercancel', endStick);

let reticle;
function bindAbilityButton(btn, i) {
  btn.addEventListener('pointerdown', (e) => {
    e.preventDefault(); e.stopPropagation(); btn.setPointerCapture(e.pointerId);
    const r = btn.getBoundingClientRect();
    touch.ab[i] = { id: e.pointerId, cx: r.left + r.width / 2, cy: r.top + r.height / 2, dir: null, frac: 0 };
  });
  btn.addEventListener('pointermove', (e) => {
    const a = touch.ab[i]; if (!a || a.id !== e.pointerId) return;
    const dx = e.clientX - a.cx, dy = e.clientY - a.cy, l = Math.hypot(dx, dy);
    if (l > 14) { a.dir = screenToWorld(dx / l, dy / l); a.frac = Math.min(1, l / 120); } else a.dir = null;
  });
  const up = (e) => {
    const a = touch.ab[i]; if (!a || a.id !== e.pointerId) return;
    touch.release[i] = true; touch.releaseAim[i] = a.dir; touch.releaseTarget[i] = a.dir ? targetFor(i, a.dir, a.frac) : null; touch.ab[i] = null;
  };
  btn.addEventListener('pointerup', up); btn.addEventListener('pointercancel', up);
}
function targetFor(i, dir, frac) {
  const ab = sim.state.slots[i].ab, p = sim.state.player;
  if (ab.castMode !== 'placed') return null;
  return { x: p.x + dir.x * ab.range * frac, z: p.z + dir.z * ab.range * frac };
}
const dodgeBtn = $('dodgeBtn');
dodgeBtn.addEventListener('pointerdown', (e) => { e.preventDefault(); touch.dodge = true; });
dodgeBtn.addEventListener('pointerup', () => (touch.dodge = false)); dodgeBtn.addEventListener('pointercancel', () => (touch.dodge = false));

function buildInput() {
  const p = sim.state.player;
  const input = { move: null, aim: null, fire: false, abilities: [false, false, false], target: null, dodge: false };
  const sx = (keys.has('KeyD') || keys.has('ArrowRight') ? 1 : 0) - (keys.has('KeyA') || keys.has('ArrowLeft') ? 1 : 0);
  const sy = (keys.has('KeyS') || keys.has('ArrowDown') ? 1 : 0) - (keys.has('KeyW') || keys.has('ArrowUp') ? 1 : 0);
  if (sx || sy) input.move = screenToWorld(sx, sy);
  if (mouse.has) {
    const g = screenToGround(mouse.x, mouse.y);
    if (g) { input.aim = { x: g.x - p.x, z: g.z - p.z }; input.target = { x: g.x, z: g.z }; }
  }
  input.fire = mouse.down;
  input.dodge = keys.has('Space');
  ['KeyQ', 'KeyE', 'KeyR'].forEach((k, i) => { if (keys.has(k) || keys.has(`Digit${i + 1}`)) input.abilities[i] = true; });
  const L = sticks.L.v, R = sticks.R.v;
  if (L && Math.hypot(L.x, L.y) > 0.18) input.move = screenToWorld(L.x, L.y);
  if (R && Math.hypot(R.x, R.y) > 0.2) { input.aim = screenToWorld(R.x, R.y); input.target = null; input.fire = Math.hypot(R.x, R.y) > 0.35; }
  if (touch.dodge) input.dodge = true;
  for (let i = 0; i < 3; i++) {
    const ab = sim.state.slots[i].ab, a = touch.ab[i];
    if (ab.castMode === 'charge' && a) input.abilities[i] = true;
    if (touch.release[i]) {
      if (ab.castMode !== 'charge') input.abilities[i] = true;
      if (touch.releaseAim[i]) input.aim = touch.releaseAim[i];
      if (touch.releaseTarget[i]) input.target = touch.releaseTarget[i];
      touch.release[i] = false;
    }
  }
  return input;
}

// ---------- animation helpers ----------
const lastPos = new Map();
// Smoothed velocity per entity (the sim may step 0-2 times per rendered frame).
function velocity(id, x, z, dt) {
  const L = lastPos.get(id) || { x, z, vx: 0, vz: 0 };
  const ix = (x - L.x) / Math.max(dt, 1e-3), iz = (z - L.z) / Math.max(dt, 1e-3);
  const v = { x, z, vx: L.vx * 0.75 + ix * 0.25, vz: L.vz * 0.75 + iz * 0.25 };
  lastPos.set(id, v); return v;
}
function locoWeights(vx, vz, fx, fz, speed) {
  if (speed < 0.3) return { idle: 1, runF: 0, runB: 0, runL: 0, runR: 0 };
  const nx = vx / speed, nz = vz / speed;
  const fwd = nx * fx + nz * fz, side = nx * -fz + nz * fx; // + = character's right
  return { idle: 0, runF: Math.max(0, fwd), runB: Math.max(0, -fwd), runR: Math.max(0, side), runL: Math.max(0, -side) };
}
function rollFor(dir, facing) {
  const fwd = dir.x * facing.x + dir.z * facing.z, side = dir.x * -facing.z + dir.z * facing.x;
  return Math.abs(fwd) >= Math.abs(side) ? (fwd >= 0 ? 'rollF' : 'rollB') : (side >= 0 ? 'rollR' : 'rollL');
}

// ---------- reconcile visuals ----------
function sync(dt, t) {
  const st = sim.state, p = st.player, pv = vis.player;
  const { vx, vz } = velocity(0, p.x, p.z, dt);
  pv.position.set(p.x, 0, p.z);
  pv.rotation.y = Math.atan2(p.facing.x, p.facing.z);
  const body = pv.userData.body, an = pv.userData.anim;
  if (an) {
    if (!st.over) an.setLoco(locoWeights(vx, vz, p.facing.x, p.facing.z, Math.hypot(vx, vz)), Math.min(1.4, 0.6 + Math.hypot(vx, vz) / 7));
    an.update(dt);
  } else {
    body.position.y = p.moving && !settings.reducedMotion ? Math.abs(Math.sin(t * 11)) * 0.09 : 0;
    body.rotation.x = p.moving ? 0.12 : 0;
    body.rotation.z = p.dodgeT > 0 ? Math.sin(t * 40) * 0.4 : 0;
  }
  pv.userData.shield.visible = p.shield > 0;
  pv.userData.shield.material.opacity = 0.12 + 0.06 * Math.sin(t * 6);
  if (pv.userData.ring) pv.userData.ring.rotation.z = t * 0.4;
  body.traverse((o) => { if (o.isMesh && o.material.color) o.material.color.setHex(p.stoneT > 0 ? 0x9a9aa6 : (p.invulnT > 0 ? 0xbfe8ff : 0xffffff)); });
  const ap = pv.userData.aimPivot; ap.position.set(p.x, 0, p.z); ap.rotation.y = Math.atan2(p.facing.x, p.facing.z); ap.visible = !st.over;
  // enemies
  const alive = new Set();
  for (const e of st.enemies) {
    alive.add(e.id);
    let g = vis.enemies.get(e.id); if (!g) { g = enemyVisual(e); vis.enemies.set(e.id, g); }
    const ev = velocity(e.id, e.x, e.z, dt), sp = Math.hypot(ev.vx, ev.vz);
    g.position.lerp(tmpV.set(e.x, 0, e.z), 0.6);
    if (e.face) g.rotation.y = Math.atan2(e.face.x, e.face.z);
    if (g.userData.guard) g.userData.guard.visible = e.mode === 'move';
    const ea = g.userData.anim;
    if (ea) {
      ea.setLoco(sp > 0.3 ? { idle: 0, walk: 1 } : { idle: 1, walk: 0 }, sp > 0.3 ? Math.max(0.6, sp / 1.6) : 1);
      ea.update(dt);
    } else {
      g.userData.body.rotation.x = e.mode === 'windup' ? -0.28 : 0;
      g.userData.body.position.y = settings.reducedMotion ? 0 : Math.abs(Math.sin(t * 7 + e.id)) * 0.06;
    }
    g.userData.fg.scale.x = Math.max(0, e.hp / e.maxHp);
    g.userData.hb.quaternion.copy(g.quaternion).invert().multiply(cam.quaternion);
  }
  for (const [id, g] of vis.enemies) if (!alive.has(id)) {
    vis.enemies.delete(id); lastPos.delete(id); g.userData.hb.visible = false;
    const ea = g.userData.anim;
    if (ea) ea.playOnce('death', 1.0);
    addFx(g, 2.0, (f, k) => { if (ea) ea.update(1 / 60); if (k > 0.6) g.position.y = -((k - 0.6) / 0.4) * 1.5; });
  }
  for (const g of [pv, ...vis.enemies.values()]) if (g.userData.flashT > 0 && (g.userData.flashT -= dt) <= 0)
    g.userData.body.traverse((o) => { if (o.isMesh && o.material.emissive) o.material.emissive.setHex(0); });
  // projectiles
  const live = new Set();
  for (const pr of st.projectiles) {
    live.add(pr.id); let m = vis.projectiles.get(pr.id);
    if (!m) {
      const slot = pr.source.startsWith('slot') ? +pr.source[4] : -1;
      const col = pr.team === 'enemy' ? 0xff6a3d : slot >= 0 ? TYPE_HEX[st.slots[slot].fam.type] : 0xe9ddff;
      m = new THREE.Group();
      const core = new THREE.Mesh(new THREE.SphereGeometry(pr.r, 12, 8), new THREE.MeshBasicMaterial({ color: 0xffffff }));
      const glow = new THREE.Mesh(new THREE.SphereGeometry(pr.r * 2, 12, 8), new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.45, depthWrite: false, blending: THREE.AdditiveBlending }));
      const trail = new THREE.Mesh(new THREE.PlaneGeometry(pr.r * 1.6, 1.4), new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.35, depthWrite: false, blending: THREE.AdditiveBlending }));
      trail.geometry.translate(0, -0.7, 0); trail.rotation.x = -Math.PI / 2; trail.rotation.z = Math.PI;
      const tp = new THREE.Group(); tp.add(trail); tp.rotation.y = Math.atan2(pr.dx, pr.dz);
      m.add(core, glow, tp); scene.add(m); vis.projectiles.set(pr.id, m);
    }
    m.position.set(pr.x, 1.1, pr.z);
  }
  for (const [id, m] of vis.projectiles) if (!live.has(id)) { scene.remove(m); vis.projectiles.delete(id); }
  // zones
  const lz = new Set();
  for (const z of st.zones) {
    lz.add(z.id); let m = vis.zones.get(z.id);
    if (!m) {
      const col = z.team === 'enemy' ? 0xff3b3b : TYPE_HEX[st.slots[z.slot].fam.type], dark = z.slowPct > 0;
      m = new THREE.Group();
      const disk = new THREE.Mesh(new THREE.CircleGeometry(z.radius, 40), new THREE.MeshBasicMaterial({ color: dark ? 0x241433 : col, transparent: true, opacity: dark ? 0.75 : 0.18, depthWrite: false }));
      disk.rotation.x = -Math.PI / 2; disk.position.y = 0.03; m.add(disk);
      const edge = assets.tex.sigilM ? decal(assets.tex.sigilM, z.radius * 2.15, col, 0.9)
        : new THREE.Mesh(new THREE.RingGeometry(z.radius - 0.12, z.radius, 48), new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.9, depthWrite: false }));
      edge.rotation.x = -Math.PI / 2; edge.position.y = 0.04; m.add(edge);
      scene.add(m); vis.zones.set(z.id, m);
    }
    m.position.set(z.x, 0, z.z); m.children[1].rotation.z = t * 0.6; m.children[1].material.opacity = (0.55 + 0.35 * Math.sin(t * 6) ** 2) * Math.min(1, z.t);
  }
  for (const [id, m] of vis.zones) if (!lz.has(id)) { scene.remove(m); vis.zones.delete(id); }
  // placement reticle while dragging a placed ability
  let showRet = false;
  for (let i = 0; i < 3; i++) { const a = touch.ab[i]; if (a && a.dir && st.slots[i].ab.castMode === 'placed') {
    const tg = targetFor(i, a.dir, a.frac), r = st.slots[i].ab.radius;
    if (!reticle) { reticle = assets.tex.sigilM ? decal(assets.tex.sigilM, 2, 0xffffff, 0.8) : new THREE.Mesh(new THREE.RingGeometry(0.9, 1, 40), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.7, depthWrite: false })); reticle.rotation.x = -Math.PI / 2; scene.add(reticle); }
    reticle.scale.set(r, r, r); reticle.position.set(tg.x, 0.07, tg.z); showRet = true; } }
  if (reticle) reticle.visible = showRet;
}

function handleEvents(events) {
  const pa = vis.player && vis.player.userData.anim;
  for (const ev of events) {
    switch (ev.type) {
      case 'damage': {
        const g = ev.id === 0 ? vis.player : vis.enemies.get(ev.id);
        if (g) flash(g, ev.id === 0 ? 0xff2222 : 0xffffff);
        if (ev.amount >= 1) floatText(ev.x, ev.z, Math.round(ev.amount), ev.team === 'player' ? '#ff5a5a' : '#fff', ev.amount >= 150);
        if (ev.id === 0) { if (!settings.reducedMotion) shakeT = 0.2; if (pa && !pa.oneShot && ev.amount >= 60 && !sim.state.over) pa.playOnce('hit', 0.45); }
        break;
      }
      case 'absorbed': if (ev.amount >= 1) floatText(ev.x, ev.z, `-${Math.round(ev.amount)} shield`, '#7fffc4'); break;
      case 'dodged': floatText(ev.x, ev.z, 'Dodged', '#bfe8ff'); break;
      case 'blocked': floatText(ev.x, ev.z, 'Blocked', '#9fd4ff'); break;
      case 'phase': banner(`Phase ${ev.phase}: ${ev.name}`); if (!settings.reducedMotion) shakeT = 0.4; break;
      case 'spawn': if (ev.boss) banner(cfg.enemies[ev.enemyId].name); break;
      case 'victory':
        running = false;
        { const r = settleRun(); setTimeout(() => showResults(r, 'won'), 900); }
        break;
      case 'telegraph': {
        const e = sim.state.enemies.find((x) => x.id === ev.id); if (e) telegraphFx(ev, e);
        const g = vis.enemies.get(ev.id), ea = g && g.userData.anim;
        if (ea && !ea.oneShot) ea.playOnce(ev.shape === 'arc' ? 'heavy' : 'stab', ev.time / 0.45);
        break;
      }
      case 'cast': ghostFx(ev.familiarId, ev.x, ev.z, ev.dir); if (pa) pa.playOnce('cast', 0.55); break;
      case 'dodge': ringFx(ev.x, ev.z, 0xe8c547, 0.4, 1.4, 0.3); if (pa) pa.playOnce(rollFor(ev.dir, sim.state.player.facing), 0.5); break;
      case 'projectileEnd': ringFx(ev.x, ev.z, ev.team === 'enemy' ? 0xff6a3d : 0xe9ddff, 0.1, 0.6, 0.2); break;
      case 'notReady': { const b = $('abilities').children[ev.slot]; if (b) { b.classList.remove('shake'); void b.offsetWidth; b.classList.add('shake'); } break; }
      case 'wave': banner(ev.of ? `Wave ${ev.wave} of ${ev.of}` : `Wave ${ev.wave}`); if (ev.wave > 1) waveDiscovery(); break;
      case 'defeat':
        running = false; if (pa) pa.playOnce('death', 1.2);
        { const r = settleRun(); setTimeout(() => showResults(r, 'defeat'), 1400); }
        break;
    }
  }
}

// ---------- menu ----------
function buildMenu() {
  const grid = $('famGrid'); grid.innerHTML = '';
  for (const [fid, f] of Object.entries(cfg.familiars)) {
    const ab = cfg.abilities[f.abilityId], rIdx = RARITY.indexOf(f.rarity), owned = !!col.owned[fid];
    if (!owned && !col.seen[fid]) continue; // undiscovered familiars stay hidden here (see Journal)
    const b = document.createElement('button'); b.className = `fam${owned ? '' : ' locked'}`; b.dataset.fid = fid; b.style.setProperty('--c', css(f.type));
    b.innerHTML = `<span class="slot"></span>
      <div class="famIco">${icon(`i_${f.abilityId}`, css(f.type))}</div>
      <div class="famBody"><div class="row"><span class="name">${f.name}</span></div>
      <div class="row"><span class="badge" style="--c:${css(f.type)}">${icon(`i_${f.type}`, css(f.type))}${f.type.toUpperCase()}</span>
      <span class="badge" style="--c:${css(f.rarity)}"><span class="pips">${'◆'.repeat(rIdx + 1)}</span>${f.rarity.toUpperCase()}</span></div>
      <div class="abn">${ab.name}</div><div class="desc">${owned ? ab.counterplay : '<span class="lock">Not bound yet. Find it in Explore.</span>'}</div></div>`;
    b.onclick = () => { if (!owned) return; const i = loadout.indexOf(fid); if (i >= 0) loadout.splice(i, 1); else if (loadout.length < 3) loadout.push(fid); else { loadout.shift(); loadout.push(fid); } refreshMenu(); };
    grid.appendChild(b);
  }
  refreshMenu();
}
function refreshMenu() {
  for (const b of $('famGrid').children) { const i = loadout.indexOf(b.dataset.fid); b.classList.toggle('sel', i >= 0); b.querySelector('.slot').textContent = i >= 0 ? i + 1 : ''; }
  const letters = { arcane: 'A', runic: 'R', ancient: 'N' };
  const comp = loadout.map((f) => letters[cfg.familiars[f].type]).sort((a, b) => 'ARN'.indexOf(a) - 'ARN'.indexOf(b)).join('');
  $('compT').textContent = loadout.length === 3 ? `· composition ${comp}` : '';
  $('pickT').textContent = loadout.length === 3 ? (sim && running && !sameLoadout() ? 'Changing familiars restarts the battle.' : '') : `Pick ${3 - loadout.length} more`;
  $('startBtn').disabled = loadout.length !== 3;
  $('startBtn').textContent = sim && running && sameLoadout() ? 'Resume' : 'Training waves';
  $('endBtn').hidden = !(sim && running);
  renderPresets(); renderRifts();
}
const mkBtn = (text, fn, cls = 'btn alt sm') => { const b = document.createElement('button'); b.className = cls; b.textContent = text; b.onclick = fn; return b; };
function renderPresets() {
  const box = $('presets'); box.innerHTML = '';
  prof.presets.forEach((ps, i) => {
    const d = document.createElement('div'); d.className = 'preset';
    d.innerHTML = `<div class="grow"><b>Loadout ${i + 1}</b><div class="s">${ps ? ps.map((f) => cfg.familiars[f].name).join(' · ') : 'Empty'}</div></div>`;
    const use = mkBtn('Use', () => { loadout = [...ps]; refreshMenu(); }); use.disabled = !ps;
    const save = mkBtn(ps ? 'Replace' : 'Save current', () => { P.savePreset(cfg, prof, i, loadout); saveProf(); renderPresets(); }); save.disabled = loadout.length !== 3;
    d.append(use, save); box.appendChild(d);
  });
}
function saveProf() { store.set('tc.profile', prof); renderWallet(); }
function renderWallet() {
  const L = P.levelInfo(cfg, prof.xp);
  $('wallet').innerHTML = `<span><b>Wizard level ${L.level}</b></span><span class="bar sm"><i style="width:${L.need ? Math.round((100 * L.into) / L.need) : 100}%"></i></span>
    <span>${L.need ? `${L.into}/${L.need} XP` : 'max level'}</span><span><b>${prof.gold}</b> Gold</span><span><b>${prof.essence}</b> Arcane Essence</span>`;
}
function masteryBar(fid) {
  const mi = P.masteryInfo(cfg, prof.familiars[fid]?.masteryXp || 0);
  const pct = mi.nextAt === null ? 100 : Math.round((100 * (mi.xp - mi.prevAt)) / (mi.nextAt - mi.prevAt));
  return `<span class="bar"><i style="width:${pct}%"></i></span><div class="s">Mastery ${mi.level}${mi.nextAt === null ? ' (max)' : ` · ${Math.floor(mi.xp)}/${mi.nextAt} XP`}</div>`;
}

// ---------- runs and results (M3) ----------
/** Grant this run's rewards once. Safe to call twice: the transaction id is spent on the first call. */
function settleRun() {
  if (!sim || !runTx) return null;
  const st = sim.state, tx = runTx; runTx = null;
  const cleared = Math.max(0, st.wave + (st.enemies.some((e) => e.hp > 0) ? 0 : 1));
  const won = st.won && !!activeRift;
  const rw = P.battleRewards(cfg, { kills: st.player.kills, wavesCleared: cleared, clearReward: won ? activeRift.clearReward : null, slots: st.slots.map((s) => ({ familiarId: s.familiarId, ...s.contrib })) });
  const g = P.grant(cfg, prof, tx, rw);
  if (g.applied) Object.assign(prof.stats, { battles: prof.stats.battles + 1, bestWave: Math.max(prof.stats.bestWave, cleared), kills: prof.stats.kills + st.player.kills });
  saveProf();
  if (g.applied && won) prof.stats.rifts = { ...(prof.stats.rifts || {}), [activeRift.id]: ((prof.stats.rifts || {})[activeRift.id] || 0) + 1 };
  saveProf();
  return { cleared, kills: st.player.kills, rw, g, won, rift: activeRift, fids: st.slots.map((s) => s.familiarId) };
}
function showResults(r, outcome) {
  $('resH').textContent = outcome === 'won' ? `${r.rift.name} cleared!` : outcome === 'defeat' ? 'Defeated' : 'Run complete';
  $('defeatT').textContent = `Waves cleared: ${r.cleared} · Enemies defeated: ${r.kills}`;
  const M = cfg.progression.mastery;
  let h = r.won ? `<p class="lvl">Clear bonus: +${r.rift.clearReward.xp} XP · +${r.rift.clearReward.gold} Gold · +${r.rift.clearReward.essence} Arcane Essence (included below)</p>` : '';
  h += r.rw.xp ? `<p><b>+${r.rw.xp} XP · +${r.rw.gold} Gold${r.rw.essence ? ` · +${r.rw.essence} Arcane Essence` : ''}</b></p>` : '<p>No rewards this time. Defeat at least one enemy to earn rewards.</p>';
  if (r.g.applied && r.g.wizard.to > r.g.wizard.from) h += `<p class="lvl">Wizard level ${r.g.wizard.to}!</p>`;
  for (const fid of r.fids) {
    const m = r.g.mastery?.[fid], f = cfg.familiars[fid];
    const note = m ? `+${m.gained} Mastery${m.to > m.from ? ` · <span class="lvl">Mastery ${m.to}!${m.from < M.branchAt && m.to >= M.branchAt ? ' Modifiers unlocked.' : ''}</span>` : ''}`
      : r.rw.xp ? 'No Mastery: it didn\'t hit or block anything this run.' : '';
    h += `<div class="res"><div class="famIco" style="--c:${css(f.type)}">${icon(`i_${f.abilityId}`, css(f.type))}</div><div class="grow"><b>${f.name}</b><div class="s">${note}</div>${masteryBar(fid)}</div></div>`;
  }
  h += `<p class="s"><b>Next goal:</b> ${nextGoal(r.fids)}</p>`;
  $('resBody').innerHTML = h; $('defeat').hidden = false; paused = true;
}
function nextGoal(fids) {
  const ranks = cfg.ascension.ranks;
  for (const fid of Object.keys(col.owned)) { const c = P.ascensionCost(cfg, col, fid); if (c && !c.maxed && !c.short) return `${cfg.familiars[fid].name} can Ascend to ${ranks[c.next]}. Open it in the Journal.`; }
  const best = fids.map((fid) => ({ fid, mi: P.masteryInfo(cfg, prof.familiars[fid]?.masteryXp || 0) })).filter((x) => x.mi.nextAt !== null).sort((a, b) => (a.mi.nextAt - a.mi.xp) - (b.mi.nextAt - b.mi.xp))[0];
  return best ? `${Math.ceil(best.mi.nextAt - best.mi.xp)} more Mastery for ${cfg.familiars[best.fid].name} to reach Mastery ${best.mi.level + 1}.` : 'Bind more familiars in Explore.';
}

// ---------- familiar detail: Mastery, Ascension, modifier (M3) ----------
let detFid = null;
function openDetail(fid) { detFid = fid; $('menu').hidden = true; $('famDet').hidden = false; renderDetail(); }
function renderDetail() {
  const fid = detFid, f = cfg.familiars[fid], ab = P.effectiveAbility(cfg, col, prof, fid), ranks = cfg.ascension.ranks;
  const mi = P.masteryInfo(cfg, prof.familiars[fid]?.masteryXp || 0), c = P.ascensionCost(cfg, col, fid), M = cfg.progression.mastery;
  const cur = prof.familiars[fid]?.modifierId || null, locked = mi.level < M.branchAt;
  const asc = c.maxed ? 'Fully ascended.' : `Next rank, <b>${ranks[c.next]}</b>, needs ${c.need} duplicate ${c.need === 1 ? 'credit' : 'credits'}. You have ${c.have}.${c.short ? ` You can cover the missing ${c.short} with ${c.essenceForShort} Arcane Essence (you have ${prof.essence}).` : ''}`;
  $('detBody').innerHTML = `<h1>${f.name}</h1><div class="s">${f.type.toUpperCase()} · ${f.rarity} · <b>${ab.name}</b>${ab.modifierName ? ` with ${ab.modifierName}` : ''}. Changes apply from your next battle.</div>
    <h2>Mastery</h2>${masteryBar(fid)}<p class="s">Earned when this familiar's ability damages enemies or blocks damage in battle.</p>
    <h2>Ascension · ${ranks[c.rank]} (${c.rank} of ${ranks.length - 1})</h2><p class="s">Each rank adds ${Math.round(cfg.progression.ascension.potencyPerRank * 1000) / 10}% to ${ab.name}'s power. ${asc}</p><div class="actions" id="ascAct"></div>
    <h2>Modifier <span class="comp">${locked ? `unlocks at Mastery ${M.branchAt}` : 'free to change'}</span></h2><div class="mods" id="mods"></div>`;
  if (!c.maxed) {
    const b = mkBtn(c.short ? `Ascend (${c.need - c.short} credits + ${c.essenceForShort} Essence)` : `Ascend (${c.need} ${c.need === 1 ? 'credit' : 'credits'})`, () => {
      const r = P.ascend(cfg, col, prof, fid, c.short > 0);
      if (r.ok) { saveCol(); saveProf(); toast(`${f.name} reached ${ranks[r.rank]}.`, '#d9b46a'); }
      renderDetail();
    }, 'btn');
    b.disabled = c.short > 0 && prof.essence < c.essenceForShort;
    $('ascAct').appendChild(b);
  }
  for (const m of [{ id: null, name: 'No modifier', desc: 'The standard ability' }, ...P.modifiersFor(cfg, fid)]) {
    const b = mkBtn('', () => { if (P.setModifier(cfg, prof, fid, m.id).ok) { saveProf(); renderDetail(); } }, cur === m.id ? 'on' : '');
    b.innerHTML = `${m.name}<div class="s">${m.desc}</div>`; b.disabled = locked && m.id !== null; b.setAttribute('aria-pressed', cur === m.id);
    $('mods').appendChild(b);
  }
}
$('detClose').onclick = () => { $('famDet').hidden = true; toggleMenu(true, 'journal'); };
$('endBtn').onclick = () => { const r = settleRun(); running = false; $('menu').hidden = true; if (r) showResults(r, 'ended'); };
let activeLoadout = null;
const sameLoadout = () => activeLoadout && activeLoadout.join() === loadout.join();
function toggleMenu(open, tab) { $('menu').hidden = !open; paused = open; if (open) { if (tab) showTab(tab); refreshMenu(); renderExplore(); renderJournal(); renderWallet(); } }
function showTab(tab) {
  for (const b of document.querySelectorAll('.tab')) b.classList.toggle('on', b.dataset.tab === tab);
  for (const p of document.querySelectorAll('.pane')) p.hidden = p.id !== `pane-${tab}`;
  if (tab === 'explore') document.querySelector('.tab[data-tab=explore]').classList.remove('alert');
  if (tab === 'battle') buildMenu();
}
for (const b of document.querySelectorAll('.tab')) b.onclick = () => showTab(b.dataset.tab);
$('menuBtn').onclick = () => toggleMenu(true);
$('startBtn').onclick = () => { if (!(sim && running && sameLoadout())) startBattle(); toggleMenu(false); };
function renderRifts() {
  const box = $('rifts'); box.innerHTML = '';
  const lvl = P.levelInfo(cfg, prof.xp).level;
  for (const r of cfg.rifts) {
    const locked = lvl < r.minLevel, done = prof.stats.rifts?.[r.id] || 0, c = r.clearReward;
    const mods = r.modifiers.map((m) => `<b>${cfg.riftModifiers[m].name}</b>: ${cfg.riftModifiers[m].desc}`).join(' · ');
    const d = document.createElement('div'); d.className = 'preset';
    d.innerHTML = `<div class="grow"><b>${r.name}</b> <span class="comp">${r.waves.length} ${r.waves.length === 1 ? 'wave' : 'waves'}${done ? ` · cleared ${done}×` : ''}</span>
      <div class="s">${r.desc}${mods ? `<br>${mods}` : ''}<br>Clear bonus: ${c.xp} XP · ${c.gold} Gold · ${c.essence} Essence${locked ? `<br><span class="lock">Unlocks at wizard level ${r.minLevel}</span>` : ''}</div></div>`;
    const b = mkBtn('Enter', () => { startBattle(r); toggleMenu(false); }, 'btn sm'); b.disabled = locked || loadout.length !== 3;
    d.appendChild(b); box.appendChild(d);
  }
}
$('retryBtn').onclick = () => { $('defeat').hidden = true; startBattle(activeRift); paused = false; };
$('loadoutBtn').onclick = () => { $('defeat').hidden = true; toggleMenu(true); };

function clearVisuals() {
  for (const g of vis.enemies.values()) scene.remove(g);
  for (const m of vis.projectiles.values()) scene.remove(m);
  for (const m of vis.zones.values()) scene.remove(m);
  for (const f of vis.fx) { if (f.mesh) fxGroup.remove(f.mesh); if (f.el) f.el.remove(); }
  vis.enemies.clear(); vis.projectiles.clear(); vis.zones.clear(); vis.fx.length = 0; lastPos.clear();
}
let activeRift = null;
function startBattle(rift = null) {
  store.set('ww.loadout', loadout);
  const prev = settleRun(); // switching loadouts mid-run still pays out the run so far
  if (prev && prev.rw.xp) toast(`Previous run: +${prev.rw.xp} XP, +${prev.rw.gold} Gold`);
  activeLoadout = [...loadout]; activeRift = rift;
  clearVisuals();
  const seed = (Math.random() * 1e9) | 0;
  sim = createSim(cfg, { weaponId: cfg.defaultLoadout.weaponId, familiarIds: activeLoadout, abilities: activeLoadout.map((fid) => P.effectiveAbility(cfg, col, prof, fid)) }, seed, { encounter: rift });
  runTx = `battle:${Date.now().toString(36)}:${seed}`;
  if (vis.player) scene.remove(vis.player, vis.player.userData.aimPivot);
  vis.player = playerVisual();
  buildAbilityButtons(); running = true;
}

// ---------- collection (M2) ----------
const rarityCfg = (id) => cfg.rarities.find((r) => r.id === id);
const clientRng = () => Math.random(); // ponytail: client-side rolls for the prototype; GDD §17 moves these to the server
function saveCol() { store.set('tc.collection', col); }
const fmtTime = (ms) => { const s = Math.max(0, Math.ceil(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
let toastT;
function toast(text, color, onClick) {
  const t = $('toast'); t.textContent = text; t.style.setProperty('--rc', color || '#d9b46a'); t.hidden = false;
  t.onclick = () => { t.hidden = true; if (onClick) onClick(); };
  clearTimeout(toastT); toastT = setTimeout(() => (t.hidden = true), 4500);
}
function announce(e) {
  const f = cfg.familiars[e.familiarId], r = rarityCfg(e.rarity);
  document.querySelector('.tab[data-tab=explore]').classList.add('alert');
  if (!$('bind').hidden || !$('reveal').hidden || worldOpen()) return; // don't interrupt a binding or the map
  toast(`A wild ${f.name} (${r.label}, ${f.type}) appeared nearby. Tap to find it.`, r.color, () => toggleMenu(true, 'explore'));
  if (e.rarity !== 'common' && e.rarity !== 'uncommon') chime(r);
}
function tickWilds() {
  const now = Date.now();
  Col.pruneEncounters(col, now);
  if (now - col.lastSpawnAt > cfg.explore.spawnEverySec * 1000) {
    const e = Col.spawnEncounter(cfg, col, clientRng, now, 'wilds');
    if (e) { saveCol(); announce(e); } else col.lastSpawnAt = now;
  }
  if (!$('menu').hidden && !$('pane-explore').hidden) renderExplore();
}
function waveDiscovery() {
  if (Math.random() > cfg.explore.waveDiscoveryChance) return;
  const e = Col.spawnEncounter(cfg, col, clientRng, Date.now(), 'battle');
  if (e) { saveCol(); announce(e); }
}
function renderExplore() {
  if (!col) return;
  const now = Date.now(), list = $('encList');
  const open = col.encounters.filter((e) => e.state === 'open');
  const next = cfg.explore.spawnEverySec * 1000 - (now - col.lastSpawnAt);
  $('nextT').textContent = open.length >= cfg.explore.maxActive ? '· the wilds are full' : `· next sighting in about ${fmtTime(next)}`;
  if (!open.length) { list.innerHTML = '<div class="empty">Nothing nearby yet. Familiars appear every so often, and clearing battle waves can draw them out.</div>'; return; }
  list.innerHTML = '';
  for (const e of open) {
    const f = cfg.familiars[e.familiarId], r = rarityCfg(e.rarity), owned = col.owned[e.familiarId];
    const d = document.createElement('div'); d.className = 'enc'; d.style.setProperty('--rc', r.color);
    const left = Math.max(e.expiresAt, e.engagedUntil) - now;
    d.innerHTML = `<div class="famIco" style="--c:${css(f.type)}">${icon(`i_${f.abilityId}`, css(f.type))}</div>
      <div class="grow"><div class="rb">${'◆'.repeat(r.pips)} ${r.label.toUpperCase()}</div><div class="nm">${f.name}</div>
      <div class="row" style="display:flex;gap:6px;margin-top:4px"><span class="badge" style="--c:${css(f.type)}">${icon(`i_${f.type}`, css(f.type))}${f.type.toUpperCase()}</span></div>
      <div class="meta">${owned ? `Owned · binding again gives a duplicate credit` : 'New familiar · binding unlocks its ability'} · ${e.attemptsLeft} ${e.attemptsLeft === 1 ? 'try' : 'tries'} left · leaves in ${fmtTime(left)}${e.source === 'battle' ? ' · drawn out by battle' : ''}</div></div>`;
    const b = document.createElement('button'); b.className = 'btn'; b.textContent = 'Bind'; b.onclick = () => openBinding(e.id);
    d.appendChild(b); list.appendChild(d);
  }
}
function renderLegend() {
  $('legend').innerHTML = cfg.rarities.map((r) => {
    const has = Object.values(cfg.familiars).some((f) => f.rarity === r.id);
    return `<div style="--c:${r.color}"><b>${'◆'.repeat(r.pips)} ${r.label}</b> ${r.share}%${has ? '' : ' (none yet)'}</div>`;
  }).join('');
}
function renderJournal() {
  if (!col) return;
  const ids = Object.keys(cfg.familiars), owned = ids.filter((f) => col.owned[f]);
  $('colT').textContent = `· ${owned.length} of ${ids.length} bound`;
  $('journal').onclick = (ev) => { const b = ev.target.closest('[data-det]'); if (b) openDetail(b.dataset.det); };
  $('journal').innerHTML = ids.map((fid) => {
    const f = cfg.familiars[fid], o = col.owned[fid], seen = col.seen[fid], r = rarityCfg(f.rarity), ab = cfg.abilities[f.abilityId];
    if (!o && !seen) return `<div class="jc unknown"><div class="famIco" style="--c:#555">${icon('i_arcane', '#555')}</div><div><div class="t">Undiscovered</div><div class="s">Keep exploring.</div></div></div>`;
    const c = o && P.ascensionCost(cfg, col, fid);
    return `<div class="jc"><div class="famIco" style="--c:${css(f.type)}">${icon(`i_${f.abilityId}`, css(f.type))}</div><div>
      <div class="t">${f.name}</div>
      <div class="row" style="display:flex;gap:5px;flex-wrap:wrap;margin:4px 0"><span class="badge" style="--c:${css(f.type)}">${icon(`i_${f.type}`, css(f.type))}${f.type.toUpperCase()}</span><span class="badge" style="--c:${r.color}">${'◆'.repeat(r.pips)} ${r.label.toUpperCase()}</span></div>
      <div class="s">${o ? `Ability: <b>${ab.name}</b><br>Bound ${o.captures}× · ${o.credits} duplicate ${o.credits === 1 ? 'credit' : 'credits'}<br>Ascension: <b>${cfg.ascension.ranks[c.rank]}</b>${c.maxed ? '' : c.short ? ` · ${c.short} more for the next rank` : ' · <span class="lvl">ready to Ascend</span>'}</div>${masteryBar(fid)}<button class="btn alt sm" data-det="${fid}" style="margin-top:8px">Manage</button>` : 'Seen in the wilds. Not bound yet.</div>'}</div></div>`;
  }).join('');
}

// Shared small 3D preview for binding and reveal screens.
const preview = { renderer: null, scene: null, cam: null, model: null, anim: null };
function showPreview(container, familiarId, color) {
  if (!preview.renderer) {
    const c = document.createElement('canvas'); c.id = 'bindPrev';
    preview.renderer = new THREE.WebGLRenderer({ canvas: c, antialias: true, alpha: true });
    preview.renderer.outputColorSpace = THREE.SRGBColorSpace;
    preview.scene = new THREE.Scene();
    preview.scene.add(new THREE.HemisphereLight(0xffffff, 0x223030, 2.2));
    const d = new THREE.DirectionalLight(0xffffff, 1.8); d.position.set(2, 4, 3); preview.scene.add(d);
    preview.cam = new THREE.PerspectiveCamera(30, 1, 0.1, 50);
  }
  const canvasEl = preview.renderer.domElement; container.appendChild(canvasEl);
  const size = Math.max(10, Math.round(container.clientWidth * 0.64));
  preview.renderer.setPixelRatio(Math.min(devicePixelRatio, 2)); preview.renderer.setSize(size, size, false);
  if (preview.model) preview.scene.remove(preview.model);
  const f = cfg.familiars[familiarId];
  const g = instance(f.model) || new THREE.Mesh(new THREE.IcosahedronGeometry(0.6), new THREE.MeshLambertMaterial({ color }));
  const box = new THREE.Box3().setFromObject(g), h = Math.max(0.5, box.max.y - box.min.y);
  preview.cam.position.set(0, h * 0.6, h * 2.05); preview.cam.lookAt(0, h * 0.5, 0);
  preview.model = g; preview.anim = g.userData && g.userData.anim; preview.scene.add(g);
}
function updatePreview(dt) {
  if (!preview.model || ($('bind').hidden && $('reveal').hidden)) return;
  preview.model.rotation.y += dt * (settings.reducedMotion ? 0.2 : 0.6);
  if (preview.anim) preview.anim.update(dt);
  preview.renderer.render(preview.scene, preview.cam);
}

let audioCtx;
function chime(r) {
  if (!settings.sound) return;
  try {
    audioCtx ||= new (window.AudioContext || window.webkitAudioContext)();
    const tier = cfg.rarities.indexOf(r), notes = [523, 659, 784, 1047, 1319].slice(0, Math.min(5, 2 + tier));
    notes.forEach((hz, i) => {
      const o = audioCtx.createOscillator(), g = audioCtx.createGain(), t = audioCtx.currentTime + i * 0.11;
      o.type = tier >= 4 ? 'triangle' : 'sine'; o.frequency.value = hz;
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.18, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.6);
      o.connect(g).connect(audioCtx.destination); o.start(t); o.stop(t + 0.65);
    });
  } catch {}
}

// Binding challenge: a light circles the rune ring; tap while it is inside the glowing arc.
const bind = { enc: null, active: false, stage: 0, hits: 0, misses: 0, quality: [], angle: 0, arcAt: 0, arcDeg: 60, speed: 1, dir: 1, timeLeft: 0, flash: 0 };
let bindFrom = 'explore';
function openBinding(encId, from = 'explore') {
  bindFrom = from;
  const e = Col.engage(cfg, col, encId, Date.now()); if (!e) { toast('That familiar has gone.'); renderExplore(); return; }
  saveCol();
  const f = cfg.familiars[e.familiarId], r = rarityCfg(e.rarity);
  bind.enc = e; bind.active = false;
  $('bindCard').style.setProperty('--rc', r.color);
  $('bindBadge').textContent = `${'◆'.repeat(r.pips)} ${r.label.toUpperCase()}`;
  $('bindName').textContent = f.name;
  $('bindType').innerHTML = `${icon(`i_${f.type}`, css(f.type))} ${f.type.toUpperCase()} · ${cfg.abilities[f.abilityId].name} · ${r.stages === 2 ? 'two-stage binding' : 'one-stage binding'}`;
  $('bindMsg').textContent = `Tap (or press Space) when the light is inside the glowing arc. ${cfg.capture.hitsPerStage} hits per stage, ${cfg.capture.timeLimitSec} seconds. Better timing raises your chance. ${e.attemptsLeft} ${e.attemptsLeft === 1 ? 'try' : 'tries'} left.`;
  $('bindGo').hidden = false; $('bindGo').textContent = 'Begin binding'; $('bindLeave').textContent = 'Leave';
  $('menu').hidden = true; $('bind').hidden = false; paused = true;
  showPreview($('bindStage'), e.familiarId, TYPE_HEX[f.type]);
  drawRing();
}
function startStage(stage) {
  const r = rarityCfg(bind.enc.rarity);
  Object.assign(bind, { active: true, stage, hits: 0, angle: Math.random() * 360, dir: stage === 2 ? -1 : 1,
    arcDeg: r.arcDeg * (stage === 2 ? 0.75 : 1), speed: (360 / r.turnSec) * (stage === 2 ? 1.25 : 1), timeLeft: cfg.capture.timeLimitSec });
  newArc();
  $('bindGo').hidden = true;
  $('bindMsg').textContent = r.stages === 2 ? `Stage ${stage} of 2` : 'Bind it!';
}
function newArc() { bind.arcAt = (bind.angle + (bind.dir > 0 ? 120 : -120) + Math.random() * 120) % 360; }
function angDiff(a, b) { return ((a - b + 540) % 360) - 180; }
function bindTap() {
  if (!bind.active) return;
  const off = Math.abs(angDiff(bind.angle, bind.arcAt));
  if (off <= bind.arcDeg / 2) { bind.hits++; bind.quality.push(1 - off / (bind.arcDeg / 2)); bind.flash = 0.25; newArc(); if (bind.hits >= cfg.capture.hitsPerStage) stageDone(); }
  else { bind.misses++; bind.flash = -0.25; }
}
function stageDone() {
  const r = rarityCfg(bind.enc.rarity);
  if (bind.stage < r.stages && bind.hits >= cfg.capture.hitsPerStage) { bind.active = false; $('bindMsg').textContent = 'Stage 1 complete. Get ready…'; setTimeout(() => startStage(bind.stage + 1), 900); return; }
  finishBinding();
}
function finishBinding() {
  bind.active = false;
  const r = rarityCfg(bind.enc.rarity), needed = cfg.capture.hitsPerStage * r.stages;
  const got = bind.quality.length, avg = got ? bind.quality.reduce((a, b) => a + b, 0) / got : 0;
  const skill = Math.max(0, Math.min(1, (got / needed) * (0.55 + 0.45 * avg) - 0.05 * bind.misses));
  const attemptNo = cfg.capture.attempts - bind.enc.attemptsLeft + 1;
  const res = Col.resolveBinding(cfg, col, bind.enc.id, attemptNo, skill, clientRng, Date.now());
  saveCol();
  bind.quality = []; bind.misses = 0;
  const pct = Math.round((res.chance || 0) * 100);
  if (res.outcome === 'bound') {
    const rw = P.bindingRewards(cfg, res), g = P.grant(cfg, prof, `bind:${bind.enc.id}`, rw); saveProf();
    $('bind').hidden = true; showReveal(res, g.applied ? rw : null);
  }
  else if (res.outcome === 'resisted') {
    $('bindMsg').textContent = `It resisted (your chance was ${pct}%). ${res.attemptsLeft} ${res.attemptsLeft === 1 ? 'try' : 'tries'} left.`;
    $('bindGo').hidden = false; $('bindGo').textContent = 'Try again';
  } else {
    $('bindMsg').textContent = res.outcome === 'fled' ? `It fled (your chance was ${pct}%). It may appear again.` : 'That familiar is no longer here.';
    $('bindLeave').textContent = 'Back';
  }
  drawRing();
}
function drawRing() {
  const cv = $('bindRing'), x = cv.getContext('2d'), W = cv.width, c = W / 2, R = W * 0.44;
  x.clearRect(0, 0, W, W);
  const rc = rarityCfg(bind.enc ? bind.enc.rarity : 'common').color;
  x.lineWidth = 18; x.strokeStyle = '#ffffff18'; x.beginPath(); x.arc(c, c, R, 0, Math.PI * 2); x.stroke();
  const rad = (d) => ((d - 90) * Math.PI) / 180;
  if (bind.active) {
    x.strokeStyle = rc; x.lineWidth = 30; x.shadowColor = rc; x.shadowBlur = 24;
    x.beginPath(); x.arc(c, c, R, rad(bind.arcAt - bind.arcDeg / 2), rad(bind.arcAt + bind.arcDeg / 2)); x.stroke(); x.shadowBlur = 0;
  }
  const need = cfg.capture.hitsPerStage;
  for (let i = 0; i < need; i++) {
    const a = rad(-30 + (60 * i) / Math.max(1, need - 1) + 180);
    x.fillStyle = i < bind.hits ? rc : '#ffffff22';
    x.beginPath(); x.arc(c + Math.cos(a) * (R + 46), c + Math.sin(a) * (R + 46), 13, 0, Math.PI * 2); x.fill();
  }
  if (bind.active) {
    const a = rad(bind.angle);
    x.fillStyle = '#fff'; x.shadowColor = '#fff'; x.shadowBlur = 20;
    x.beginPath(); x.arc(c + Math.cos(a) * R, c + Math.sin(a) * R, 17, 0, Math.PI * 2); x.fill(); x.shadowBlur = 0;
    x.fillStyle = '#fff'; x.font = '800 30px Inter'; x.textAlign = 'center'; x.fillText(`${Math.ceil(bind.timeLeft)}s`, c, 34);
  }
  if (bind.flash && !settings.reducedMotion) { x.strokeStyle = bind.flash > 0 ? '#ffffffaa' : '#ff4d4daa'; x.lineWidth = 8; x.beginPath(); x.arc(c, c, R + 22, 0, Math.PI * 2); x.stroke(); }
}
function updateBinding(dt) {
  if ($('bind').hidden || !bind.enc) return;
  if (bind.active) {
    bind.angle = (bind.angle + bind.dir * bind.speed * dt + 360) % 360;
    bind.timeLeft -= dt;
    if (bind.timeLeft <= 0) { $('bindMsg').textContent = 'Out of time.'; finishBinding(); }
  }
  if (bind.flash) bind.flash = Math.sign(bind.flash) * Math.max(0, Math.abs(bind.flash) - dt);
  drawRing();
}
$('bindStage').addEventListener('pointerdown', (e) => { e.preventDefault(); bindTap(); });
$('bindGo').onclick = () => startStage(1);
$('bindLeave').onclick = () => { bind.active = false; $('bind').hidden = true; if (bindFrom === 'map') returnToWorld(); else toggleMenu(true, 'explore'); };
addEventListener('keydown', (e) => { if (!$('bind').hidden && (e.code === 'Space' || e.code === 'Enter')) { e.preventDefault(); bindTap(); } });

function showReveal(res, rw) {
  const f = cfg.familiars[res.familiarId], r = rarityCfg(res.rarity), tier = cfg.rarities.indexOf(r), ab = cfg.abilities[f.abilityId];
  const card = $('revealCard'); card.style.setProperty('--rc', r.color);
  card.classList.toggle('big', tier >= 4 && !settings.reducedMotion);
  $('revBadge').textContent = `${'◆'.repeat(r.pips)} ${r.label.toUpperCase()}`;
  $('revName').textContent = res.first ? `${f.name} bound!` : `${f.name} bound again`;
  $('revType').innerHTML = `${icon(`i_${f.type}`, css(f.type))} ${f.type.toUpperCase()}`;
  const c = P.ascensionCost(cfg, col, res.familiarId), ranks = cfg.ascension.ranks;
  $('revMsg').innerHTML = res.first
    ? `New familiar. Ability unlocked: <b>${ab.name}</b>. Equip it from the Battle tab.`
    : `Duplicate: +1 credit (${res.credits} total). ${c.maxed ? 'Already fully ascended.' : c.short ? `${c.short} more for ${ranks[c.next]}.` : `Ready to Ascend to ${ranks[c.next]} in the Journal.`}`;
  if (rw) $('revMsg').innerHTML += `<br><b>+${rw.xp} XP · +${rw.gold} Gold${rw.essence ? ` · +${rw.essence} Arcane Essence` : ''}</b>`;
  $('reveal').hidden = false; paused = true;
  showPreview($('revStage'), res.familiarId, TYPE_HEX[f.type]);
  if (tier >= 2) chime(r);
  if (tier >= 3 && !settings.reducedMotion) {
    for (let i = 0; i < 14 + tier * 8; i++) {
      const sp = document.createElement('span'); sp.className = 'spark';
      const a = Math.random() * Math.PI * 2, d = 120 + Math.random() * 160;
      sp.style.cssText = `left:50%;top:45%;--dx:${Math.cos(a) * d}px;--dy:${Math.sin(a) * d}px;animation-delay:${Math.random() * 0.3}s`;
      $('revStage').appendChild(sp); setTimeout(() => sp.remove(), 2200);
    }
  }
}
$('revOk').onclick = () => { $('reveal').hidden = true; if (bindFrom === 'map') returnToWorld(); else toggleMenu(true, 'journal'); };

// ---------- loop ----------
const clock = new THREE.Clock(); let acc = 0; const DT = 1 / 60;
const camTarget = new THREE.Vector3();
function frame() {
  requestAnimationFrame(frame);
  const dt = Math.min(0.1, clock.getDelta()), t = clock.elapsedTime;
  if (sim && running && !paused && !dbg.freeze) {
    acc += dt;
    while (acc >= DT) { sim.step(buildInput(), DT); acc -= DT; handleEvents(sim.drainEvents()); }
  }
  if (sim && !paused) {
    sync(dt, t);
    updateHud();
    debugInfo();
  }
  if (sim) {
    const p = sim.state.player;
    camTarget.lerp(tmpV.set(p.x + p.facing.x * 1.5 * !dbg.close, dbg.close ? 1 : 0, p.z + p.facing.z * 1.5 * !dbg.close), 0.08);
    cam.position.copy(camTarget).add(CAM_OFF); cam.lookAt(camTarget);
    if (shakeT > 0) { shakeT -= dt; cam.position.x += (Math.random() - 0.5) * 0.3; cam.position.z += (Math.random() - 0.5) * 0.3; }
    sun.position.set(camTarget.x + 10, 22, camTarget.z + 6); sun.target.position.copy(camTarget);
  }
  if (!paused || !sim) for (let i = vis.fx.length - 1; i >= 0; i--) {
    const f = vis.fx[i]; f.t += dt; const k = Math.min(1, f.t / f.life); f.update(f, k);
    if (k >= 1) { if (f.mesh) { fxGroup.remove(f.mesh); scene.remove(f.mesh); } if (f.el) f.el.remove(); vis.fx.splice(i, 1); }
  }
  renderer.render(scene, cam);
  updateBinding(dt); updatePreview(dt); tickWorld(dt);
}

// Debug readout: open the page with #debug to show animation diagnostics on screen.
function debugInfo() {
  if (location.hash !== '#debug') return;
  let el = $('dbg'); if (!el) { el = document.createElement('pre'); el.id = 'dbg'; el.style.cssText = 'position:fixed;left:8px;top:140px;font:11px monospace;color:#9f9;background:#000a;padding:6px;pointer-events:none;z-index:5;max-width:60vw;white-space:pre-wrap'; document.body.appendChild(el); }
  const lines = [`anim lib: ${assets.lib ? Object.keys(assets.lib.clips).length + ' clips' : 'none'}`];
  const all = [['player', vis.player], ...[...vis.enemies.entries()].map(([id, g]) => [`enemy${id}`, g])];
  for (const [n, g] of all) {
    const a = g && g.userData.anim; if (!a) { lines.push(`${n}: no animator`); continue; }
    const pel = a.pairs.find((p) => p.s.name === 'Hips');
    const ang = (q) => (2 * Math.acos(Math.min(1, Math.abs(q.w))) * 180 / Math.PI).toFixed(0);
    lines.push(`${n}: bones ${a.pairs.length} Y ${ang(a.Y)}° hipsC ${pel ? ang(pel.C) : '-'}° ratio ${a.hRatio?.toFixed(3)}`);
  }
  el.textContent = lines.join('\n');
}
// Dev hook for automated checks in the browser console.
window.__tomecraft = { get sim() { return sim; }, get assets() { return assets; }, vis };

// ---------- boot ----------
(async () => {
  try {
    cfg = await (await fetch('data/config.json?v=8')).json();
    await loadAll();
    buildArena(cfg);
    col = Col.loadCollection(cfg, store.get('tc.collection', null));
    if (!Object.keys(col.owned).length) Col.grantStarters(cfg, col, Date.now());
    saveCol();
    prof = P.loadProfile(cfg, store.get('tc.profile', null));
    if (!loadout || loadout.length !== 3 || loadout.some((f) => !col.owned[f])) loadout = [...cfg.starters];
    renderLegend();
    setInterval(tickWilds, 1000);
    initWorld({ cfg, col: () => col, saveCol, rarityCfg, icon, css, toast, openBinding,
      pause: (p) => { paused = p; }, openMenu: (tab) => toggleMenu(true, tab) });
    $('openMap').onclick = () => { $('menu').hidden = true; openWorld(); };
    buildMenu();
    $('loading').remove();
    toggleMenu(true);
    camTarget.set(0, 0, 4); cam.position.copy(camTarget).add(CAM_OFF); cam.lookAt(camTarget);
    frame();
  } catch (err) {
    console.error(err);
    $('loadT').textContent = `Could not start: ${err.message}`;
  }
})();
