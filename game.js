import * as THREE from 'three';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { createSim } from './sim.js?v=36';
import { Animator, makeLibrary, gunzipB64 } from './anim.js?v=36';
import * as Col from './collection.js?v=36';
import * as P from './progression.js?v=36';
import * as S from './sanctuary.js?v=36';
import * as Stage from './stage.js?v=36';
import { initWorld, openWorld, returnToWorld, tickWorld, worldOpen, hideWorld, nearbyState, flyTo, refreshWizardGear } from './map.js?v=36';
import * as World from './world.js?v=36';

const $ = (id) => document.getElementById(id);
const VER = 36; // cache-busting version, kept in step by stamp.py
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
  'i_abl_retaliation_circle', 'i_abl_stone_skin', 'i_abl_serpent_dash', 'i_abl_gust', 'i_abl_ink_pool',
  'f_panel', 'f_wide', 'f_card', 'f_card2', 'f_btn', 'f_tab', 'f_btn2', 'f_ring', 'f_diamond', 'f_bar', 'f_brackets', 'f_crest', 'f_line',
  'n_play', 'n_journal', 'n_wizard', 'n_home', 'n_map', 'n_settings', 'n_scroll', 'n_medal', 'c_gold', 'c_essence', 'm_rune', 'm_stone', 'm_ore', 'chest',
  's_weapon', 's_robe', 's_boots', 's_amulet', 's_ring', 'n_craft', 'n_research', 'n_forge', 'n_dwelling', 'n_chamber', 'n_library', 'n_lock',
  'g_bar', 'g_card', 'g_wide', 'g_archbg', 'g_arch', 'g_row', 'g_slot', 'g_goal', 'g_obj_on', 'g_obj_off', 'g_parch', 'g_tip', 'g_close', 'g_notice', 'g_flag', 'g_tog_bg', 'g_tog_l', 'g_tog_r', 'g_fill', 'g_glow',
  'p_monster', 'p_magic', 'p_skull', 'p_unknown', 'p_ring', 'p_ringu', 'p_dia', 'p_diau', 'p_dia2', 'p_dia2u'];
const assets = { atlas: {}, models: {}, tex: {}, lib: null };
const uiSrc = {}, spriteUrl = (k) => uiSrc[k] || '';

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
    const { img, src } = await loadImage(`ui/${k}.png?v=36`);
    document.documentElement.style.setProperty(`--u-${k}`, `url("${src}")`); uiSrc[k] = src;
    if (['sigilL', 'sigilM', 'reticle'].includes(k)) { const t = new THREE.Texture(img); t.colorSpace = THREE.SRGBColorSpace; t.needsUpdate = true; assets.tex[k] = t; }
  }));
  tick('Interface');
  for (const [k, f] of Object.entries(ATLAS)) assets.atlas[k] = await loadTexture(f);
  tick('Textures');
  try {
    if (typeof DecompressionStream === 'undefined') throw new Error('This browser cannot unpack animations');
    const packed = { ...(await import('./pub/anims.js?v=36')).default, ...(await import('./pub/anims_m5.js?v=36')).default, ...(await import('./pub/anims_custom.js?v=36')).default };
    const objs = {};
    for (const [k, b64] of Object.entries(packed)) objs[k] = fbx.parse(await gunzipB64(b64), '');
    // The skeleton inside an animation file is the source rig, so clips and rest pose share one root orientation.
    const rig = SkeletonUtils.clone(objs.idle);
    assets.lib = makeLibrary(rig, objs);
    console.info('[anim] clips', Object.entries(assets.lib.clips).map(([n, c]) => `${n} ${c.duration.toFixed(2)}s/${c.tracks.length}tr`).join(', '));
  } catch (err) { console.warn('[anim] animations unavailable, using procedural motion', err); assets.lib = null; }
  tick('Animations');
  const models = { ...(await import('./pub/models.js?v=36')).default, ...(await import('./pub/models_m4.js?v=36')).default };
  for (const [k, [atl, h]] of Object.entries(MODELS)) {
    try {
      const obj = fbx.parse(await gunzipB64(models[k]), '');
      if (k === 'fairy') { // wings are separate meshes in the same space: pin them to the upper spine
        obj.updateMatrixWorld(true);
        let spine = null; obj.traverse((o) => { if (/spine_03$/i.test(o.name)) spine = o; });
        for (const w of ['fairy_wing_l', 'fairy_wing_r']) {
          const wing = fbx.parse(await gunzipB64(models[w]), ''); obj.add(wing); obj.updateMatrixWorld(true);
          if (spine) { // the wing meshes come in at hip height: lift each so its middle sits just below the upper spine, then pin it there
            const c = new THREE.Box3().setFromObject(wing).getCenter(new THREE.Vector3()), sp = spine.getWorldPosition(new THREE.Vector3());
            const box = new THREE.Box3().setFromObject(obj), H = box.max.y - box.min.y;
            const to = c.clone(); to.y = sp.y - H * 0.04;
            wing.position.add(obj.worldToLocal(to.clone()).sub(obj.worldToLocal(c.clone())));
            obj.updateMatrixWorld(true); spine.attach(wing);
          }
        }
      }
      if (h && !assets.lib) relaxArms(obj);
      assets.models[k] = prep(obj, assets.atlas[atl], h);
    } catch (err) { console.warn(`[assets] ${k} failed`, err); }
  }
  tick('Models');
}
// Sanctuary buildings, decorations and staffs load on first use (Kingdom atlas), then are cloned.
const modelCache = {};
const GLASS = new Set(['house_04', 'house_08', 'house_05', 'blacksmith', 'house_03', 'tower']);
async function loadModel(name, sanct) {
  if (name.endsWith('_glass') && !GLASS.has(name.slice(0, -6))) return null;
  modelCache[name] ||= (async () => {
    try {
      const b64 = sanct ? (await import(`./pub/sanct/${name}.js?v=${VER}`)).default[name] : (assets.gear ||= (await import('./pub/gear.js?v=36')).default)[name];
      if (!b64) return null;
      const obj = fbx.parse(await gunzipB64(b64), '');
      const df = name.startsWith('df_'); // Dark Fantasy pieces use their own atlas, and their fire and runes glow
      if (df && !assets.dfGlow) assets.dfGlow = await loadTexture('assets/darkfantasy_emissive.jpg').catch(() => null);
      obj.traverse((o) => { if (o.isMesh) { o.material = new THREE.MeshLambertMaterial(df ? { map: assets.atlas.darkfantasy, emissiveMap: assets.dfGlow, emissive: assets.dfGlow ? 0xffffff : 0x000000, emissiveIntensity: 1.6 } : { map: assets.atlas.kingdom }); o.castShadow = o.receiveShadow = true; } });
      return obj;
    } catch (err) { console.warn('[model]', name, err); return null; }
  })();
  const src = await modelCache[name]; return src ? src.clone(true) : null;
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
      if (an.ok) {
        if (key === 'mage') { // the rig's wrist comes out of retargeting palm-down; turn it so the fist faces forward around the staff (solved from the hand mesh)
          let hand = null; g.traverse((o) => { if (o.name === 'Hand_R') hand = o; });
          if (hand) an.post.push([hand, new THREE.Quaternion(-0.6176, -0.1715, -0.0517, 0.7658)]);
        }
        if (key === 'mage') an.alias = Object.fromEntries(Object.entries({ idle: 'staffIdle', walk: 'staffWalk', cast: 'staffCast' }).filter(([, c]) => assets.lib.clips[c])); // custom Blender clips: the wizard always holds the staff
        g.userData.anim = an; an.setLoco({ idle: 1 }); an.update(0);
      }
      else console.warn(`[anim] ${key}: only ${an.pairs.length} bones matched`);
    } catch (err) { console.warn(`[anim] ${key} retarget failed`, err); }
  }
  return g;
}

// Portraits: each familiar (and the wizard's face) rendered once from its real model, used across the interface.
const portraits = {};
function makePortraits() {
  const r = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  r.setSize(256, 256, false); r.outputColorSpace = THREE.SRGBColorSpace;
  const sc = new THREE.Scene(); sc.add(new THREE.HemisphereLight(0xe8eef0, 0x2a2018, 2.2));
  const key = new THREE.DirectionalLight(0xffe2b8, 2.2); key.position.set(2, 3, 4); sc.add(key);
  const rim = new THREE.DirectionalLight(0x7fd6c4, 1.6); rim.position.set(-3, 2, -3); sc.add(rim);
  const camP = new THREE.PerspectiveCamera(30, 1, 0.05, 50);
  const shot = (key, face) => {
    const g = instance(key); if (!g) return null;
    sc.add(g); g.rotation.y = face ? 0 : 0.45;
    const box = new THREE.Box3().setFromObject(g), h = box.max.y - box.min.y;
    if (face) { camP.position.set(0, h * 0.8, h * 1.05); camP.lookAt(0, h * 0.76, 0); } // head and shoulders
    else { camP.position.set(0, h * 0.55, h * 2.05); camP.lookAt(0, h * 0.48, 0); }
    r.render(sc, camP); sc.remove(g); return r.domElement.toDataURL('image/png');
  };
  for (const [fid, f] of Object.entries(cfg.familiars)) portraits[fid] = shot(f.model, false);
  portraits.mage = shot('mage', true);
  for (const [eid, e] of Object.entries(cfg.enemies)) portraits[eid] = shot(e.model, false);
  r.dispose();
}
/** Round portrait with the ability glyph as a small badge, so identity is the creature and the ability stays readable. */
const famFace = (fid, unknown = false) => { const f = cfg.familiars[fid];
  return `<div class="famIco pic${unknown ? ' unknown' : ''}" style="--c:${css(f.type)}"><img src="${portraits[fid] || ''}" alt="">${unknown ? '' : `<i class="abBadge">${icon(`i_${f.abilityId}`, css(f.type))}</i>`}</div>`; };
const portraitImg = (fid, cls = '') => `<img class="pt ${cls}" src="${portraits[fid] || ''}" alt="">`;

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
let cfg, sim = null, running = false, paused = true, col = null, prof = null, home = null, runTx = null;
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
  $('mpFill').style.height = `${(100 * p.mana) / p.maxMana}%`; $('mpT').textContent = Math.floor(p.mana);
  $('stFill').style.transform = `scaleX(${p.stamina / p.maxStamina})`;
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
  keys.add(e.code); if (e.code === 'Escape' && sim && running && $('menu').hidden) toggleMenu(true, 'battle'); if (['Space', 'KeyQ', 'KeyE', 'KeyR'].includes(e.code)) e.preventDefault(); });
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
// Camp: drag turns the wizard's platform or orbits the Sanctuary; a tap selects; pinch or wheel zooms the Sanctuary.
const campPtr = new Map(); let campMoved = 0, pinchD = 0;
const campOpen = () => !$('menu').hidden && STAGE_PAGES.has(campTab);
canvas.addEventListener('pointerdown', (e) => {
  if (!campOpen()) return;
  campPtr.set(e.pointerId, { x: e.clientX, y: e.clientY }); campMoved = 0; canvas.setPointerCapture(e.pointerId);
  if (campPtr.size === 2) { const [a, b] = [...campPtr.values()]; pinchD = Math.hypot(a.x - b.x, a.y - b.y); }
});
canvas.addEventListener('pointermove', (e) => {
  if (!campOpen()) return;
  if (campTab === 'home') homeHover(e.clientX, e.clientY);
  const p = campPtr.get(e.pointerId); if (!p) return;
  const dx = e.clientX - p.x, dy = e.clientY - p.y; p.x = e.clientX; p.y = e.clientY; campMoved += Math.abs(dx) + Math.abs(dy);
  if (campPtr.size === 2) { const [a, b] = [...campPtr.values()], d = Math.hypot(a.x - b.x, a.y - b.y); if (campTab === 'home') Stage.orbitHome(0, 0, (pinchD - d) * 0.004); else Stage.zoomHub((pinchD - d) * 0.004); pinchD = d; return; }
  if (campTab === 'home') Stage.orbitHome(dx, dy, 0); else Stage.spinHub(dx * 0.008);
});
const campUp = (e) => {
  if (!campPtr.has(e.pointerId)) return;
  campPtr.delete(e.pointerId);
  if (campMoved < 8 && campTab === 'home' && e.type === 'pointerup') homeTap(e.clientX, e.clientY);
};
canvas.addEventListener('pointerup', campUp); canvas.addEventListener('pointercancel', campUp);
canvas.addEventListener('wheel', (e) => { if (!campOpen()) return; e.preventDefault(); if (campTab === 'home') Stage.orbitHome(0, 0, e.deltaY * 0.001); else Stage.zoomHub(e.deltaY * 0.001); }, { passive: false });
canvas.addEventListener('pointerdown', (e) => {
  if (campOpen() || e.pointerType === 'mouse') return;
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

// ---------- camp (M5): one screen with the living stage behind a sheet; five places in the dock ----------
const sprite = (k, extra = '') => `<span class="sprite" style="--m:var(--u-${k})${extra}"></span>`;
const MAT_ICON = { gold: 'c_gold', essence: 'c_essence', ore: 'm_ore', arcaneStone: 'm_stone', runeFragments: 'm_rune' };
const matName = (k) => (k === 'gold' ? 'Gold' : k === 'essence' ? 'Arcane Essence' : cfg.materials[k].name);
const haveOf = (k) => (k === 'gold' ? prof.gold : k === 'essence' ? prof.essence : prof.materials[k] || 0);
const costHtml = (cost) => `<span class="cost">${Object.entries(cost || {}).map(([k, v]) => `<span class="reward${haveOf(k) < v ? ' short' : ''}" title="${matName(k)}">${sprite(MAT_ICON[k])}${v}</span>`).join('')}</span>`;
const rewardHtml = (r) => `${r.xp ? `<span class="reward">${r.xp} XP</span>` : ''}${['gold', 'essence'].map((k) => (r[k] ? `<span class="reward" title="${matName(k)}">${sprite(MAT_ICON[k])}${r[k]}</span>` : '')).join('')}${Object.entries(r.materials || {}).map(([k, v]) => (v ? `<span class="reward" title="${matName(k)}">${sprite(MAT_ICON[k])}${v}</span>` : '')).join('')}`;
const mkBtn = (text, fn, cls = 'btn sm') => { const b = document.createElement('button'); b.className = cls; b.textContent = text; b.onclick = fn; return b; };
function saveProf() { store.set('tc.profile', prof); renderWallet(); }
function saveHome() { store.set('tc.home', home); }
function renderPurse(id) { $(id).innerHTML = ['gold', 'essence'].map((k) => `<span class="coin" title="${matName(k)}">${sprite(MAT_ICON[k])}${haveOf(k)}</span>`).join(''); }
function renderTomeTiles() { const lead = loadout[0]; const t = document.querySelector('.tile[data-go=familiars] .sprite'); if (lead && portraits[lead] && t) t.outerHTML = `<img class="tileFace" src="${portraits[lead]}" alt="">`; else { const im = document.querySelector('.tile[data-go=familiars] .tileFace'); if (im && portraits[lead]) im.src = portraits[lead]; } }
function renderAvatar() {
  const L = P.levelInfo(cfg, prof.xp);
  $('lvT').textContent = L.level; $('xpRing').style.setProperty('--xp', `${L.need ? Math.round((100 * L.into) / L.need) : 100}%`);
  if (portraits.mage) $('avatarImg').src = portraits.mage;
  renderGoals();
}
// ----- goals: one objective at a time on the map, the full list in the Journal -----
const goalCtx = () => ({ binds: prof.stats.binds || 0, shrines: prof.stats.shrines || 0, rifts: prof.stats.rifts || {}, level: P.levelInfo(cfg, prof.xp).level,
  gear: home ? home.items.length : 0, species: Object.keys(col.owned).length, ascended: Object.values(col.owned).filter((o) => (o.ascension || 0) > 0).length });
function goGoal(g) {
  if (g.go === 'nearby') { $('nearbyPanel').hidden = false; renderNearby(); } else toggleMenu(true, g.go);
}
function claimGoal(g) {
  const r = P.grant(cfg, prof, `goal:${g.id}`, { mastery: {}, ...g.reward });
  if (!prof.goals.includes(g.id)) prof.goals.push(g.id);
  saveProf(); toast(`Goal complete: ${g.text}`, 'var(--brass)');
  if (r.applied && r.wizard.to > r.wizard.from) toast(`Wizard level ${r.wizard.to}`, 'var(--brass)');
  renderAvatar(); if (!$('menu').hidden) { renderWallet(); if (campTab === 'journal') renderJournal(); }
}
function renderGoals() {
  if (!col || !prof) return;
  const g = P.currentGoal(cfg, prof.goals), card = $('goalCard');
  card.hidden = !g; if (!g) return;
  const pr = P.goalProgress(g, goalCtx());
  card.classList.toggle('done', pr.done);
  $('goalHead').textContent = pr.done ? 'Goal complete' : `Goal ${cfg.goals.indexOf(g) + 1} of ${cfg.goals.length}`;
  $('goalText').textContent = g.text;
  $('goalFill').style.width = `${Math.round((100 * pr.have) / g.n)}%`;
  $('goalGo').textContent = pr.done ? 'Claim' : 'Go';
  card.onclick = () => (pr.done ? claimGoal(g) : goGoal(g));
}
function goalListHtml() {
  const ctx = goalCtx();
  return cfg.goals.map((g, i) => {
    const pr = P.goalProgress(g, ctx), claimed = prof.goals.includes(g.id);
    return `<div class="goalRow${claimed ? ' claimed' : pr.done ? ' done' : ''}"><span class="gIcon"></span><div class="grow"><b>${g.text}</b><div class="s">${claimed ? 'Claimed' : `${pr.have} of ${g.n}`}</div></div><div class="cost">${rewardHtml(g.reward)}</div></div>`;
  }).join('');
}
function renderWallet() {
  const L = P.levelInfo(cfg, prof.xp);
  renderAvatar();
  $('wallet').innerHTML = ['gold', 'essence'].map((k) => `<span class="coin" title="${matName(k)}">${sprite(MAT_ICON[k])}${haveOf(k)}</span>`).join('');
}
function masteryBar(fid) {
  const mi = P.masteryInfo(cfg, prof.familiars[fid]?.masteryXp || 0);
  const pct = mi.nextAt === null ? 100 : Math.round((100 * (mi.xp - mi.prevAt)) / (mi.nextAt - mi.prevAt));
  return `<span class="bar"><i style="width:${pct}%"></i></span><div class="s">Mastery ${mi.level}${mi.nextAt === null ? ' (highest)' : ` · ${Math.floor(mi.xp)} of ${mi.nextAt}`}</div>`;
}
const gearView = () => S.combatLoadout(cfg, home);
const weaponModel = () => cfg.weapons[gearView().weaponId].model;

// ----- navigation: the map is home; the Tome opens pages; every page closes back to the map -----
let campTab = 'battle';
const PAGES = { battle: 'Battle', familiars: 'Familiars', wizard: 'Wizard', home: 'Sanctuary', journal: 'Journal' };
const STAGE_PAGES = new Set(['familiars', 'wizard', 'home']);
function sheetFraction() {
  const el = $('sheet'); if ($('menu').hidden || !STAGE_PAGES.has(campTab)) return 0;
  return innerWidth < innerHeight || innerWidth < 900 ? (el.getBoundingClientRect().height + 96) / innerHeight : 0;
}
/** What is on screen underneath the pages: the battle if one is running, otherwise the map. */
function updateBase() {
  const pageOpen = !$('menu').hidden, battle = sim && running;
  document.body.classList.toggle('mapHome', !battle && !(pageOpen && STAGE_PAGES.has(campTab)));
  $('hud').hidden = pageOpen || !battle;
  if (!battle && !pageOpen && $('bind').hidden && $('reveal').hidden && $('defeat').hidden) openWorld(); else if (battle) hideWorld();
}
function toggleMenu(open, tab) {
  $('menu').hidden = !open; $('tomeMenu').hidden = true; paused = open || paused && !running;
  if (open) { showTab(tab || campTab); renderWallet(); }
  else { $('homeLabels').hidden = true; paused = false; }
  updateBase();
}
function showTab(tab) {
  campTab = tab;
  $('pageTitle').textContent = PAGES[tab];
  for (const p of document.querySelectorAll('.pane')) p.hidden = p.id !== `pane-${tab}`;
  $('menu').classList.toggle('full', !STAGE_PAGES.has(tab));
  $('sheet').classList.toggle('low', tab === 'home'); $('sheet').classList.toggle('mid', tab === 'familiars' || tab === 'wizard');
  $('homeLabels').hidden = tab !== 'home';
  if (tab !== 'home') { placing = null; selDecor = null; Stage.setGhost(cfg, null); }
  ({ battle: renderPlay, familiars: renderTeam, wizard: renderWizard, home: renderHome, journal: renderJournal })[tab]();
  if (tab === 'familiars' || tab === 'wizard') { Stage.setHubLoadout(loadout, weaponModel()).then(() => Stage.setHubFocus(tab === 'wizard' ? 'wizard' : 'team')); Stage.setHubFocus(tab === 'wizard' ? 'wizard' : 'team'); }
  $('sheet').scrollTop = 0;
  updateBase();
}
$('pageClose').onclick = () => toggleMenu(false);
$('menuBtn').onclick = () => toggleMenu(true, 'battle');
$('setClose').onclick = () => { $('settingsOv').hidden = true; };
$('tomeBtn').onclick = () => { $('tomeMenu').hidden = false; $('nearbyPanel').hidden = true; renderPurse('tmPurse'); renderTomeTiles(); };
$('tomeClose').onclick = () => { $('tomeMenu').hidden = true; };
for (const t of document.querySelectorAll('#tomeMenu [data-go]')) t.onclick = () => {
  if (t.dataset.go === 'settings') { $('settingsOv').hidden = false; return; }
  toggleMenu(true, t.dataset.go);
};
$('avatarBtn').onclick = () => toggleMenu(true, 'wizard');
$('nearbyBtn').onclick = () => { $('nearbyPanel').hidden = !$('nearbyPanel').hidden; if (!$('nearbyPanel').hidden) renderNearby(); };
$('nearbyClose').onclick = () => { $('nearbyPanel').hidden = true; };

// ----- Nearby: map familiars, rift portals and wild sightings, nearest first -----
const unknownSpecies = (fid) => !col.owned[fid] && !col.seen[fid];
const faceImg = (fid) => `<img src="${portraits[fid] || ''}" alt=""${unknownSpecies(fid) ? ' class="unknown"' : ''}>`;
function renderNearbyButton() {
  const { spawns, sites, shrines } = nearbyState(), wild = col.encounters.filter((e) => e.state === 'open');
  const faces = [...spawns.map((s) => s.familiarId), ...wild.map((e) => e.familiarId)].slice(0, 3);
  $('nearFaces').innerHTML = [0, 1, 2].map((i) => `<span class="slot">${faces[i] ? faceImg(faces[i]) : ''}</span>`).join('');
  const n = spawns.length + wild.length, places = (sites || []).length + (shrines || []).length;
  $('nearCount').textContent = n ? `${n} ${n === 1 ? 'familiar' : 'familiars'}` : places ? `${places} places` : 'Look around';
  $('nearbyBtn').classList.toggle('has', n > 0);
}
function renderNearby() {
  renderNearbyButton();
  if ($('nearbyPanel').hidden) return;
  const { spawns, sites, pos, acc } = nearbyState(), list = $('nearList'); list.innerHTML = '';
  const row = (html, rc, onClick) => { const b = document.createElement('button'); b.className = 'nearRow'; b.style.setProperty('--rc', rc); b.innerHTML = html; b.onclick = onClick; list.appendChild(b); };
  const head = (t) => list.insertAdjacentHTML('beforeend', `<h2 style="margin:10px 0 6px;font-size:18px">${t}</h2>`);
  if (spawns.length) head('On the map');
  for (const s of spawns) {
    const f = cfg.familiars[s.familiarId], r = rarityCfg(s.rarity), near = World.inRange(cfg, pos, s, acc);
    row(`${faceImg(s.familiarId)}<span class="grow"><b>${unknownSpecies(s.familiarId) ? 'Unknown familiar' : f.name}</b><span class="s">${r.label} · ${Math.round(s.distance)} m</span></span>${near ? '<span class="tag" style="--c:var(--brass)">In reach</span>' : ''}`,
      r.color, () => { flyTo(s); $('nearbyPanel').hidden = true; });
  }
  if (sites.length) head('Rift portals');
  for (const s of sites.slice(0, 3)) {
    const rf = cfg.rifts.find((x) => x.id === s.riftId);
    row(`<img src="${spriteUrl('n_play')}" alt="" style="background:#2a1210;padding:8px"><span class="grow"><b>${rf.name}</b><span class="s">${Math.round(s.distance)} m · portal bonus</span></span>`, '#c8463a', () => { flyTo(s); $('nearbyPanel').hidden = true; });
  }
  const shrines = (nearbyState().shrines || []).slice(0, 3);
  if (shrines.length) head('Shrines');
  for (const s of shrines) {
    const t = cfg.shrines.types[s.type], ready = !prof.processed.includes(World.shrineVisit(cfg, s, Date.now()).txId);
    row(`<img src="${spriteUrl('g_glow')}" alt="" style="background:#1d1830;padding:6px"><span class="grow"><b>${s.name || t.name}</b><span class="s">${t.name} · ${Math.round(s.distance)} m</span></span>${ready ? '<span class="tag" style="--c:var(--brass)">Ready</span>' : ''}`,
      t.glow, () => { flyTo(s); $('nearbyPanel').hidden = true; });
  }
  const wild = col.encounters.filter((e) => e.state === 'open');
  head('Sightings <span class="comp">bind from anywhere</span>');
  if (!wild.length) list.insertAdjacentHTML('beforeend', `<p class="s">Sightings turn up every few minutes and when you clear battle waves.</p>`);
  for (const e of wild) {
    const f = cfg.familiars[e.familiarId], r = rarityCfg(e.rarity), left = Math.max(e.expiresAt, e.engagedUntil) - Date.now();
    row(`${faceImg(e.familiarId)}<span class="grow"><b>${f.name}</b><span class="s">${r.label} · leaves in ${fmtTime(left)} · ${e.attemptsLeft} ${e.attemptsLeft === 1 ? 'try' : 'tries'}</span></span><span class="tag" style="--c:var(--ember2)">Bind</span>`,
      r.color, () => { $('nearbyPanel').hidden = true; openBinding(e.id, 'map'); });
  }
}
function renderExplore() { renderNearby(); }

// ----- rift portals on the map -----
let pendingRift = null;
function openRift(rift, distance) {
  pendingRift = { rift, portal: distance === null };
  $('riftGo').textContent = 'Enter rift'; $('riftGo').hidden = false;
  const c = rift.clearReward, lvl = P.levelInfo(cfg, prof.xp).level, locked = lvl < rift.minLevel;
  const boss = rift.waves.flat().some((e) => /god/.test(e));
  $('riftBody').innerHTML = `<div class="riftHead"><span class="pin pRift"><i></i></span><div><small>Rift · level ${rift.minLevel}+ · ${rift.waves.length} waves${boss ? ' · boss' : ''}</small><h1>${rift.name}</h1></div></div>
    <p>${rift.desc}</p>
    ${rift.modifiers.length ? `<div class="riftMods">${rift.modifiers.map((m) => `<div><b>${cfg.riftModifiers[m].name}</b><span>${cfg.riftModifiers[m].desc}</span></div>`).join('')}</div>` : ''}
    <div class="riftWhere${distance === null ? ' here' : ''}">${distance === null ? 'You stand at the portal: clear bonus +50%' : `Portal ${distance} m away. Walk there for +50%, or enter from here.`}</div>
    <div class="cost">${rewardHtml(distance === null ? scaleReward(c, cfg.world.portalBonus) : c)}</div>${locked ? `<p class="lock">Reach wizard level ${rift.minLevel} to enter</p>` : ''}`;
  $('riftGo').disabled = locked || loadout.length !== 3;
  $('riftOv').hidden = false;
}
const scaleReward = (c, k) => ({ ...c, xp: Math.round(c.xp * k), gold: Math.round(c.gold * k), essence: Math.round(c.essence * k), materials: Object.fromEntries(Object.entries(c.materials || {}).map(([m, v]) => [m, Math.round(v * k)])) });
$('riftClose').onclick = () => { $('riftOv').hidden = true; };
$('riftGo').onclick = () => { $('riftOv').hidden = true; if (pendingRift.shrine) return; startBattle(pendingRift.rift, pendingRift.portal); toggleMenu(false); };

// ----- shrines: walk up and tap for materials, once per cooldown window -----
function visitShrine(site, distance) {
  const t = cfg.shrines.types[site.type], v = World.shrineVisit(cfg, site, Date.now());
  pendingRift = { shrine: true };
  let note = '';
  if (distance !== null) note = `<p class="s">The shrine is ${distance} m away. Walk within ${cfg.shrines.radiusM} m to draw on it.</p><div class="cost">${rewardHtml(v.reward)}</div>`;
  else if (prof.processed.includes(v.txId)) note = `<p class="s">Already drawn on. It recharges in ${fmtTime(v.readyAt - Date.now())}.</p>`;
  else {
    const g = P.grant(cfg, prof, v.txId, v.reward);
    if (g.applied) { prof.stats.shrines = (prof.stats.shrines || 0) + 1; saveProf(); renderAvatar(); }
    note = `<p class="s">The shrine answers. It recharges in ${fmtTime(v.readyAt - Date.now())}.</p><div class="cost">${rewardHtml(v.reward)}</div>${g.wizard && g.wizard.to > g.wizard.from ? `<p class="lvl">Wizard level ${g.wizard.to}</p>` : ''}`;
  }
  $('riftBody').innerHTML = `<h1 style="font-size:32px;color:${t.glow}">${site.name || t.name}</h1>${site.name ? `<p class="s">${t.name}</p>` : ''}<p>${t.desc}</p>${note}`;
  $('riftGo').hidden = true; $('riftOv').hidden = false;
}

// ----- Play -----
function renderPlay() {
  const box = $('resumeBox');
  if (sim && running) {
    box.innerHTML = `<div class="fr"><div class="card2"><div class="grow"><h3>${activeRift ? activeRift.name : 'Training'} in progress</h3><p>Wave ${Math.max(1, sim.state.wave + 1)}${activeRift ? ` of ${activeRift.waves.length}` : ''}, ${sim.state.player.kills} defeated so far.${!sameLoadout() ? ' Your team has changed: resuming keeps the old team until the run ends.' : ''}</p></div></div>
      <div class="actions" style="margin:4px 6px 4px"></div></div>`;
    const a = box.querySelector('.actions');
    a.append(mkBtn('Resume', () => toggleMenu(false), 'btn'), mkBtn('End run', () => { const r = settleRun(); running = false; $('menu').hidden = true; if (r) showResults(r, 'ended'); }, 'btn alt'));
  } else box.innerHTML = '';
  renderRifts();
  $('startBtn').disabled = loadout.length !== 3;
  $('startBtn').textContent = loadout.length === 3 ? 'Start' : `Pick ${3 - loadout.length} more`;
}
function renderRifts() {
  const box = $('rifts'); box.innerHTML = '';
  const lvl = P.levelInfo(cfg, prof.xp).level;
  for (const r of cfg.rifts) {
    const locked = lvl < r.minLevel, done = prof.stats.rifts?.[r.id] || 0, boss = r.waves.flat().some((e) => cfg.enemies[e].archetype === 'boss');
    const d = document.createElement('div'); d.className = 'fr quiet';
    const lead = r.waves.flat().reduce((a, e) => (cfg.enemies[e].health > cfg.enemies[a].health ? e : a));
    d.innerHTML = `<div class="card2"><div class="riftArt${boss ? ' boss' : ''}"><img src="${portraits[lead] || ''}" alt=""></div><div class="grow"><h3>${r.name}</h3><p>${r.desc}</p>
      <div class="tags"><span class="tag">${r.waves.length} ${r.waves.length === 1 ? 'wave' : 'waves'}</span>${boss ? '<span class="tag" style="--c:var(--ember2)">Boss</span>' : ''}
      ${r.modifiers.map((m) => `<span class="tag" style="--c:var(--brass)" title="${cfg.riftModifiers[m].desc}">${cfg.riftModifiers[m].name}: ${cfg.riftModifiers[m].desc.toLowerCase()}</span>`).join('')}
      ${done ? `<span class="tag" style="--c:var(--verd)">Cleared ${done}×</span>` : ''}</div>
      <div class="cost" style="margin-top:8px">${rewardHtml(r.clearReward)}</div>
      ${locked ? `<p class="lock">Reach wizard level ${r.minLevel} to enter</p>` : ''}</div></div>`;
    const b = mkBtn('Enter', () => { startBattle(r); toggleMenu(false); }, 'btn sm go'); b.disabled = locked || loadout.length !== 3;
    d.querySelector('.card2').appendChild(b); box.appendChild(d);
  }
}
$('startBtn').onclick = () => { startBattle(); toggleMenu(false); };

// ----- Wizard: team, gear, bag -----
let seg = 'gear', gearSlot = 'weapon';
for (const b of document.querySelectorAll('.seg button')) b.onclick = () => { seg = b.dataset.seg; renderWizard(); };
function renderWizard() {
  for (const b of document.querySelectorAll('.seg button')) b.classList.toggle('on', b.dataset.seg === seg);
  for (const s of ['gear', 'bag']) $(`seg-${s}`).hidden = s !== seg;
  ({ gear: renderGear, bag: renderBag })[seg]();
  Stage.setHubLoadout(loadout, weaponModel());
}
function renderTeam() {
  $('teamSlots').innerHTML = [0, 1, 2].map((i) => {
    const fid = loadout[i], f = fid && cfg.familiars[fid];
    return f ? `<button class="fcard slot" data-i="${i}" style="--c:${css(f.type)}" aria-label="Remove ${f.name}"><span class="fpic">${portraitImg(fid)}<i class="abBadge">${icon(`i_${f.abilityId}`, css(f.type))}</i></span><b>${f.name}</b><small>${cfg.abilities[f.abilityId].name}</small><span class="n">${i + 1}</span></button>`
      : `<button class="fcard slot empty" data-i="${i}" aria-label="Empty slot"><span class="fpic">${icon('i_arcane', '#666')}</span><b>Empty</b><small>Pick below</small></button>`;
  }).join('');
  for (const b of $('teamSlots').children) b.onclick = () => { const fid = loadout[+b.dataset.i]; if (fid) { loadout.splice(+b.dataset.i, 1); teamChanged(); } };
  const letters = { arcane: 'Arcane', runic: 'Runic', ancient: 'Ancient' };
  $('compT').textContent = loadout.length === 3 ? `Team: ${loadout.map((f) => letters[cfg.familiars[f].type]).join(', ')}.` : '';
  $('pickT').textContent = loadout.length === 3 ? '' : `Choose ${3 - loadout.length} more.`;
  const grid = $('famGrid'); grid.innerHTML = '';
  for (const [fid, f] of Object.entries(cfg.familiars)) {
    if (!col.owned[fid]) continue;
    const i = loadout.indexOf(fid), ab = P.effectiveAbility(cfg, col, prof, fid), mi = P.masteryInfo(cfg, prof.familiars[fid]?.masteryXp || 0);
    const b = document.createElement('button'); b.className = `fcard${i >= 0 ? ' sel' : ''}`; b.style.setProperty('--c', css(f.type)); b.style.setProperty('--rc', rarityCfg(f.rarity).color);
    b.setAttribute('aria-pressed', i >= 0);
    b.innerHTML = `<span class="fpic">${portraitImg(fid)}<i class="abBadge">${icon(`i_${f.abilityId}`, css(f.type))}</i></span><b>${f.name}</b><small>${ab.name}</small><small class="m">Mastery ${mi.level}</small>${i >= 0 ? `<span class="n">${i + 1}</span>` : ''}`;
    b.onclick = () => { if (i >= 0) loadout.splice(i, 1); else if (loadout.length < 3) loadout.push(fid); else { loadout[2] = fid; } teamChanged(); };
    grid.appendChild(b);
  }
  renderPresets();
}
function teamChanged() { store.set('ww.loadout', loadout); renderTeam(); Stage.setHubLoadout(loadout, weaponModel()); }
function renderPresets() {
  const box = $('presets'); box.innerHTML = '';
  prof.presets.forEach((ps, i) => {
    const d = document.createElement('div'); d.className = 'row2';
    d.innerHTML = `<div class="grow"><b>Team ${i + 1}</b><div class="s">${ps ? ps.map((f) => cfg.familiars[f].name).join(', ') : 'Empty'}</div></div>`;
    const use = mkBtn('Use', () => { loadout = ps.filter((f) => col.owned[f]); teamChanged(); }); use.disabled = !ps;
    const save = mkBtn(ps ? 'Replace' : 'Save', () => { P.savePreset(cfg, prof, i, loadout); saveProf(); renderPresets(); }); save.disabled = loadout.length !== 3;
    d.append(use, save); box.appendChild(d);
  });
  const more = S.facilityUpgradeCost(cfg, home, 'chamber');
  if (more) box.insertAdjacentHTML('beforeend', '<p class="s">Upgrade the Familiar Chamber in your Sanctuary to save more teams.</p>');
}
function statLines(totals) {
  const G = cfg.gear;
  const rows = Object.entries(totals).filter(([, v]) => v).map(([k, v]) => `<span>${G.stats[k]}</span><b class="${S.isUpside(cfg, k, v) ? 'up' : 'down'}">${v > 0 ? '+' : ''}${Math.round(v * 10) / 10}%</b>`);
  return rows.length ? rows.join('') : '<span>No changes from your base stats.</span><b></b>';
}
function renderGear() {
  const G = cfg.gear;
  $('gearSlots').innerHTML = G.slots.map((s) => `<button class="slotD${s === gearSlot ? ' on' : ''}" data-s="${s}" aria-label="${G.slotNames[s]}" aria-pressed="${s === gearSlot}">${sprite(`s_${s}`, home.equipped[s] ? '' : ';opacity:.35')}<small>${G.slotNames[s]}</small></button>`).join('');
  for (const b of $('gearSlots').children) b.onclick = () => { gearSlot = b.dataset.s; renderGear(); };
  const items = home.items.filter((it) => G.bases[it.baseId].slot === gearSlot);
  const list = $('gearList');
  list.innerHTML = `<h2>${G.slotNames[gearSlot]} <span class="comp">${items.length ? 'tap to equip' : ''}</span></h2>`;
  const rows = document.createElement('div'); rows.className = 'rows';
  if (!items.length) rows.innerHTML = `<div class="empty">No ${G.slotNames[gearSlot].toLowerCase()} yet. Craft one at the Arcane Forge in your Sanctuary.</div>`;
  for (const it of items) {
    const on = home.equipped[gearSlot] === it.uid, st = S.itemStats(cfg, it), w = G.bases[it.baseId].weaponId;
    const d = document.createElement('div'); d.className = `row2${on ? ' focus' : ''}`;
    d.innerHTML = `<div class="grow"><b>${S.itemName(cfg, it)}</b> <span class="s">level ${it.level}</span>
      <div class="s">${w ? cfg.weapons[w].desc + ' ' : ''}${Object.entries(st).filter(([, v]) => v).map(([k, v]) => `<span class="${S.isUpside(cfg, k, v) ? 'lvl' : 'lock'}" style="font-weight:600;color:${S.isUpside(cfg, k, v) ? '#9fd68a' : 'var(--ember2)'}">${G.stats[k]} ${v > 0 ? '+' : ''}${v}%</span>`).join(', ')}</div></div>`;
    d.appendChild(on ? (gearSlot === 'weapon' ? Object.assign(document.createElement('span'), { className: 's', textContent: 'Equipped' }) : mkBtn('Remove', () => { S.unequip(cfg, home, gearSlot); saveHome(); renderGear(); }))
      : mkBtn('Equip', () => { S.equip(cfg, home, it.uid); saveHome(); renderGear(); Stage.setHubLoadout(loadout, weaponModel()); refreshWizardGear(); }, 'btn sm go'));
    rows.appendChild(d);
  }
  list.appendChild(rows);
  const L = gearView();
  $('statSum').innerHTML = `<span>Weapon</span><b>${cfg.weapons[L.weaponId].name}</b>${statLines(L.totals)}<span class="s" style="grid-column:1/-1">Gear bonuses are capped at ${G.statCapPct}% each, so gear helps without deciding fights.</span>`;
}
function renderBag() {
  $('bagMats').innerHTML = ['gold', 'essence', ...Object.keys(cfg.materials)].map((k) => `<div class="row2">${sprite(MAT_ICON[k], ';width:30px;height:30px')}<div class="grow"><b>${matName(k)}</b><div class="s">${cfg.materials[k]?.desc || (k === 'gold' ? 'Spent on building and crafting.' : 'Spent on Ascension and research rewards.')}</div></div><b>${haveOf(k)}</b></div>`).join('');
  $('bagItems').innerHTML = home.items.map((it) => `<div class="row2">${sprite(`s_${cfg.gear.bases[it.baseId].slot}`, ';width:28px;height:28px')}<div class="grow"><b>${S.itemName(cfg, it)}</b><div class="s">Level ${it.level}${Object.values(home.equipped).includes(it.uid) ? ' · equipped' : ''}</div></div></div>`).join('') || '<div class="empty">No equipment yet.</div>';
}

// ----- Sanctuary -----
let homeView = null, placing = null, selDecor = null;
function renderHome() {
  Stage.syncHome(cfg, home);
  const box = $('homeBody'), F = cfg.sanctuary.facilities;
  if (!homeView) {
    box.innerHTML = `<h2>Sanctuary <span class="comp">tap a building to go inside</span></h2><div class="rows" id="facRows"></div>`;
    for (const [id, f] of Object.entries(F)) {
      const d = document.createElement('div'); d.className = 'row2';
      d.innerHTML = `${sprite(`n_${id}`, ';width:30px;height:30px')}<div class="grow"><b>${f.name}</b> <span class="lvl">level ${home.facilities[id]}</span><div class="s">${effectText(id)}</div></div>`;
      d.appendChild(mkBtn('Open', () => openFacility(id), 'btn sm go')); $('facRows').appendChild(d);
    }
    return;
  }
  const id = homeView, f = F[id], up = S.facilityUpgradeCost(cfg, home, id);
  box.innerHTML = `<div class="placeBar" style="margin-top:6px"><button class="btn sm" id="facBack">‹ Sanctuary</button></div>
    <h2>${f.name} <span class="comp">level ${home.facilities[id]}</span></h2><p>${f.desc} ${effectText(id)}</p>
    <div class="row2"><div class="grow">${up ? `<b>Upgrade to level ${home.facilities[id] + 1}</b><div class="s">${effectText(id, home.facilities[id] + 1)}</div>${costHtml(up)}` : '<b>Fully upgraded</b><div class="s">More levels arrive in a later update.</div>'}</div></div>
    <div id="facBody"></div>`;
  $('facBack').onclick = () => { homeView = null; placing = null; Stage.setGhost(cfg, null); renderHome(); };
  if (up) {
    const b = mkBtn('Upgrade', () => { const r = S.upgradeFacility(cfg, home, prof, id); if (r.ok) { saveHome(); saveProf(); toast(`${f.name} upgraded to level ${r.level}.`, '#d7b26b'); } renderHome(); }, 'btn sm go');
    b.disabled = !S.canAfford(prof, up); box.querySelector('.row2').appendChild(b);
  }
  ({ chamber: facChamber, forge: facForge, library: facLibrary, dwelling: facDwelling })[id]($('facBody'));
}
function effectText(id, level) {
  const e = S.facilityEffect(cfg, home, id, level ?? home.facilities[id]);
  if (e.decorSlots) return `Room for ${e.decorSlots} decorations.`;
  if (e.presets) return `${e.presets} saved teams.`;
  if (e.tier) return `Crafts and upgrades gear up to ${e.tier}.`;
  if (e.branches) return `Research: ${e.branches.map((b) => cfg.research.branchNames[b].toLowerCase()).join(', ')}.`;
  return '';
}
function openFacility(id) { homeView = id; if (id !== 'dwelling') { placing = null; selDecor = null; Stage.setGhost(cfg, null); } showTab('home'); }
function facChamber(el) {
  el.innerHTML = '<h2>Familiars <span class="comp">Ascension and modifiers</span></h2><div class="rows" id="chRows"></div>';
  for (const fid of Object.keys(col.owned)) {
    const f = cfg.familiars[fid], c = P.ascensionCost(cfg, col, fid), ready = c && !c.maxed && !c.short;
    const d = document.createElement('div'); d.className = `row2${ready ? ' focus' : ''}`;
    d.innerHTML = `${famFace(fid)}<div class="grow"><b>${f.name}</b> <span class="s">${cfg.ascension.ranks[c.rank]}${ready ? ' · <span class="lvl">ready to Ascend</span>' : ''}</span>${masteryBar(fid)}</div>`;
    d.appendChild(mkBtn('Manage', () => openDetail(fid))); $('chRows').appendChild(d);
  }
}
function facForge(el) {
  const G = cfg.gear;
  el.innerHTML = `<h2>Craft <span class="comp">designs you know</span></h2><div class="rows" id="fgCraft"></div><h2>Upgrade <span class="comp">never fails or breaks</span></h2><div class="rows" id="fgUp"></div>`;
  for (const id of home.recipes) {
    const b = G.bases[id], cost = S.craftCost(cfg, id), d = document.createElement('div'); d.className = 'row2';
    d.innerHTML = `${sprite(`s_${b.slot}`, ';width:28px;height:28px')}<div class="grow"><b>${b.name}</b><div class="s">${b.weaponId ? cfg.weapons[b.weaponId].desc : Object.entries(b.stats).map(([k, v]) => `${G.stats[k]} ${v > 0 ? '+' : ''}${v}%`).join(', ')}</div>${costHtml(cost)}</div>`;
    const btn = mkBtn('Craft', () => { const r = S.craft(cfg, home, prof, id); if (r.ok) { saveHome(); saveProf(); toast(`Crafted ${S.itemName(cfg, r.item)}. Equip it from Wizard › Gear.`, '#d7b26b', () => { seg = 'gear'; gearSlot = b.slot; showTab('wizard'); }); } renderHome(); }, 'btn sm go');
    btn.disabled = !S.canAfford(prof, cost); d.appendChild(btn); $('fgCraft').appendChild(d);
  }
  const locked = G.slots.flatMap((s) => Object.keys(G.bases).filter((b) => G.bases[b].slot === s && !home.recipes.includes(b)));
  if (locked.length) $('fgCraft').insertAdjacentHTML('beforeend', `<p class="s">${locked.length} more designs can be found through research at the Library.</p>`);
  for (const it of home.items) {
    const u = S.upgradeInfo(cfg, home, it.uid), d = document.createElement('div'); d.className = 'row2';
    const what = u.kind === 'level' ? `Level ${it.level} → ${it.level + 1}` : u.kind === 'promote' ? `Temper into ${G.tiers[it.tier + 1]}${u.locked ? ` (needs Forge level ${it.tier + 2})` : ''}` : 'At the highest tier';
    d.innerHTML = `${sprite(`s_${G.bases[it.baseId].slot}`, ';width:28px;height:28px')}<div class="grow"><b>${S.itemName(cfg, it)}</b><div class="s">${what}</div>${u.cost ? costHtml(u.cost) : ''}</div>`;
    if (u.cost) { const btn = mkBtn(u.kind === 'promote' ? 'Temper' : 'Upgrade', () => { if (S.upgrade(cfg, home, prof, it.uid).ok) { saveHome(); saveProf(); } renderHome(); }); btn.disabled = u.locked || !S.canAfford(prof, u.cost); d.appendChild(btn); }
    $('fgUp').appendChild(d);
  }
}
function facLibrary(el) {
  el.innerHTML = '<h2>Research</h2><div class="rows" id="lbRows"></div>';
  for (const r of S.researchState(cfg, home, prof, col)) {
    const d = document.createElement('div'); d.className = `row2${r.done ? ' done' : r.ready ? ' focus' : ''}`;
    const rw = r.reward.recipe ? `Unlocks the ${cfg.gear.bases[r.reward.recipe].name} design` : '';
    const extra = [r.reward.essence ? `${r.reward.essence} Arcane Essence` : '', r.reward.arcaneStone ? `${r.reward.arcaneStone} Arcane Stone` : ''].filter(Boolean).join(' and ');
    d.innerHTML = `${sprite('n_research', ';width:28px;height:28px')}<div class="grow"><b>${r.name}</b> <span class="s">${cfg.research.branchNames[r.branch]}</span>
      <div class="s">${r.goal}: ${r.progress} of ${r.target}. ${[rw, extra].filter(Boolean).join(', plus ')}.</div>
      <span class="bar"><i style="width:${(100 * r.progress) / r.target}%"></i></span>${r.done ? '' : costHtml(r.cost)}
      ${!r.open ? '<div class="lock">Upgrade the Library to open this branch</div>' : ''}</div>`;
    if (!r.done) { const b = mkBtn('Study', () => { if (S.completeResearch(cfg, home, prof, col, r.id).ok) { saveHome(); saveProf(); toast(`Research complete: ${r.name}.`, '#d7b26b'); } renderHome(); }, 'btn sm go'); b.disabled = !r.ready || !S.canAfford(prof, r.cost); d.appendChild(b); }
    else d.insertAdjacentHTML('beforeend', '<span class="s">Done</span>');
    $('lbRows').appendChild(d);
  }
}
function facDwelling(el) {
  const D2 = cfg.sanctuary.decor, slots = S.decorSlots(cfg, home);
  el.innerHTML = `<h2>Decorations <span class="comp">${home.decor.placed.length} of ${slots} placed</span></h2>
    ${placing !== null ? `<div class="fr quiet"><div class="card2"><div class="grow"><b>${selDecor !== null ? 'Move' : 'Place'} the ${D2[placing].name}</b><div class="s">Tap a tile on the plot. Green means it fits.</div></div></div><div class="placeBar" style="margin:4px 6px"><button class="btn sm" id="plRot">Rotate</button><button class="btn sm" id="plCancel">Done</button></div></div>` : ''}
    ${selDecor !== null && placing === null ? `<div class="fr quiet"><div class="card2"><div class="grow"><b>${D2[home.decor.placed[selDecor].id].name}</b><div class="s">Selected on the plot.</div></div></div><div class="placeBar" style="margin:4px 6px"><button class="btn sm" id="dMove">Move</button><button class="btn sm" id="dRot">Rotate</button><button class="btn sm" id="dStore">Put away</button><button class="btn sm" id="dDone">Done</button></div></div>` : ''}
    <div class="rows" id="dcRows"></div>`;
  if ($('plRot')) $('plRot').onclick = () => { placeRot = (placeRot + 1) % 4; if (selDecor !== null) { S.rotateDecor(home, selDecor); saveHome(); Stage.syncHome(cfg, home); } };
  if ($('plCancel')) $('plCancel').onclick = () => { placing = null; selDecor = null; Stage.setGhost(cfg, null); renderHome(); };
  if ($('dMove')) $('dMove').onclick = () => { placing = home.decor.placed[selDecor].id; placeRot = home.decor.placed[selDecor].rot; Stage.setGhost(cfg, placing); renderHome(); };
  if ($('dRot')) $('dRot').onclick = () => { S.rotateDecor(home, selDecor); saveHome(); Stage.syncHome(cfg, home); };
  if ($('dStore')) $('dStore').onclick = () => { S.storeDecor(home, selDecor); selDecor = null; saveHome(); renderHome(); };
  if ($('dDone')) $('dDone').onclick = () => { selDecor = null; renderHome(); };
  for (const [id, d] of Object.entries(D2)) {
    const owned = home.decor.owned[id] || 0, used = home.decor.placed.filter((p) => p.id === id).length;
    const row = document.createElement('div'); row.className = 'row2';
    row.innerHTML = `<div class="grow"><b>${d.name}</b> <span class="s">${owned ? `${used} of ${owned} placed` : ''}</span>${costHtml(d.cost)}</div>`;
    const buy = mkBtn('Buy', () => { if (S.buyDecor(cfg, home, prof, id).ok) { saveHome(); saveProf(); } renderHome(); }); buy.disabled = !S.canAfford(prof, d.cost);
    const place = mkBtn('Place', () => { placing = id; selDecor = null; placeRot = 0; Stage.setGhost(cfg, id); renderHome(); }, 'btn sm go');
    place.disabled = used >= owned || home.decor.placed.length >= slots;
    row.append(buy, place); $('dcRows').appendChild(row);
  }
}
let placeRot = 0;
function homeTap(sx, sy) {
  const hit = Stage.pickHome(cfg, sx, sy);
  if (placing !== null && hit.tile) {
    if (selDecor !== null) { if (S.moveDecor(cfg, home, selDecor, hit.tile.x, hit.tile.z)) { saveHome(); placing = null; Stage.setGhost(cfg, null); } else toast('That tile is taken.'); }
    else { const r = S.placeDecor(cfg, home, placing, hit.tile.x, hit.tile.z, placeRot); if (r.ok) { saveHome(); if ((home.decor.owned[placing] || 0) <= home.decor.placed.filter((p) => p.id === placing).length) { placing = null; Stage.setGhost(cfg, null); } } else toast(r.reason === 'full' ? 'No room left. Upgrade your Dwelling for more.' : 'That spot is taken.'); }
    renderHome(); return;
  }
  if (hit.decor !== null) { homeView = 'dwelling'; selDecor = hit.decor; placing = null; renderHome(); return; }
  if (hit.facility) openFacility(hit.facility);
}
function homeHover(sx, sy) {
  if (placing === null) return;
  const hit = Stage.pickHome(cfg, sx, sy); if (!hit.tile) return;
  Stage.moveGhost(cfg, hit.tile.x, hit.tile.z, placeRot, S.canPlace(cfg, home, hit.tile.x, hit.tile.z, selDecor ?? -1));
}
function updateHomeLabels() {
  const box = $('homeLabels'); if (box.hidden) return;
  for (const id of Object.keys(cfg.sanctuary.facilities)) {
    let el = box.querySelector(`[data-f=${id}]`);
    if (!el) { el = document.createElement('button'); el.className = 'hLabel'; el.dataset.f = id; el.onclick = () => openFacility(id); box.appendChild(el); }
    el.innerHTML = `${sprite(`n_${id}`)}<span class="hName">${cfg.sanctuary.facilities[id].name}</span><small>${home.facilities[id]}</small>`; el.title = cfg.sanctuary.facilities[id].name;
    el.style.pointerEvents = placing !== null ? 'none' : '';
    const p = Stage.labelPos(id); el.style.display = p ? '' : 'none'; if (p) { el.style.left = `${p.x}px`; el.style.top = `${p.y}px`; }
  }
}

// ----- Journal -----
function renderJournal() {
  if (!col) return;
  const ids = Object.keys(cfg.familiars), owned = ids.filter((f) => col.owned[f]);
  $('colT').textContent = `${owned.length} of ${ids.length} bound`;
  $('goalList').innerHTML = goalListHtml();
  $('journal').innerHTML = ids.map((fid) => {
    const f = cfg.familiars[fid], o = col.owned[fid], seen = col.seen[fid], r = rarityCfg(f.rarity), ab = cfg.abilities[f.abilityId];
    if (!o && !seen) return `<div class="jc unknown">${famFace(fid, true)}<div><div class="t">Undiscovered</div><div class="s">Keep exploring.</div></div></div>`;
    const c = o && P.ascensionCost(cfg, col, fid);
    return `<div class="jc">${famFace(fid)}<div class="grow" style="flex:1">
      <div class="t">${f.name}</div>
      <div style="display:flex;gap:5px;flex-wrap:wrap;margin:4px 0"><span class="badge" style="--c:${css(f.type)}">${icon(`i_${f.type}`, css(f.type))}${f.type[0].toUpperCase() + f.type.slice(1)}</span><span class="badge" style="--c:${r.color}">${'◆'.repeat(r.pips)} ${r.label}</span></div>
      <div class="s">${o ? `${ab.name} · bound ${o.captures}× · ${o.credits} ${o.credits === 1 ? 'credit' : 'credits'} · ${cfg.ascension.ranks[c.rank]}` : 'Seen in the wilds. Not bound yet.'}</div>
      ${o ? `${masteryBar(fid)}<button class="btn sm" data-det="${fid}" style="margin-top:8px">Manage</button>` : ''}</div></div>`;
  }).join('');
  $('journal').onclick = (ev) => { const b = ev.target.closest('[data-det]'); if (b) openDetail(b.dataset.det); };
}

// ---------- runs and results ----------
/** Grant this run's rewards once. Safe to call twice: the transaction id is spent on the first call. */
function settleRun() {
  if (!sim || !runTx) return null;
  const st = sim.state, tx = runTx; runTx = null;
  const cleared = Math.max(0, st.wave + (st.enemies.some((e) => e.hp > 0) ? 0 : 1));
  const won = st.won && !!activeRift;
  const rw = P.battleRewards(cfg, { kills: st.player.kills, wavesCleared: cleared, clearReward: won ? activeRift.clearReward : null, slots: st.slots.map((s) => ({ familiarId: s.familiarId, ...s.contrib })) });
  const g = P.grant(cfg, prof, tx, rw);
  if (g.applied) {
    Object.assign(prof.stats, { battles: prof.stats.battles + 1, bestWave: Math.max(prof.stats.bestWave, cleared), kills: prof.stats.kills + st.player.kills });
    if (won) prof.stats.rifts = { ...(prof.stats.rifts || {}), [activeRift.id]: ((prof.stats.rifts || {})[activeRift.id] || 0) + 1 };
  }
  saveProf();
  return { cleared, kills: st.player.kills, rw, g, won, rift: activeRift, fids: st.slots.map((s) => s.familiarId) };
}
function showResults(r, outcome) {
  $('hud').hidden = true;
  $('resH').textContent = outcome === 'won' ? `${r.rift.name} cleared` : outcome === 'defeat' ? 'Defeated' : 'Run complete';
  $('defeatT').textContent = `${r.cleared} ${r.cleared === 1 ? 'wave' : 'waves'} cleared, ${r.kills} ${r.kills === 1 ? 'enemy' : 'enemies'} defeated`;
  const M = cfg.progression.mastery;
  let h = r.rw.xp ? `<div class="fr quiet"><div class="card2">${sprite('chest', ';width:64px;height:64px')}<div class="grow"><h3>Rewards</h3><div class="cost">${rewardHtml(r.rw)}</div>${r.won ? '<div class="s">Includes the rift clear bonus.</div>' : ''}</div></div></div>`
    : '<p>No rewards this time. Defeat at least one enemy to earn rewards.</p>';
  if (r.g.applied && r.g.wizard.to > r.g.wizard.from) h += `<p class="lvl" style="text-align:center;font-size:18px">Wizard level ${r.g.wizard.to}</p>`;
  for (const fid of r.fids) {
    const m = r.g.mastery?.[fid], f = cfg.familiars[fid];
    const note = m ? `+${m.gained} Mastery${m.to > m.from ? ` · <span class="lvl">Mastery ${m.to}${m.from < M.branchAt && m.to >= M.branchAt ? ', modifiers unlocked' : ''}</span>` : ''}`
      : r.rw.xp ? 'No Mastery: it didn\'t hit or block anything this run.' : '';
    h += `<div class="res">${famFace(fid)}<div class="grow"><b style="font:700 17px var(--display)">${f.name}</b><div class="s">${note}</div>${masteryBar(fid)}</div></div>`;
  }
  h += `<p class="s" style="margin-top:12px"><b style="color:var(--bone)">Next:</b> ${nextGoal(r.fids)}</p>`;
  $('resBody').innerHTML = h; $('defeat').hidden = false; paused = true;
  $('retryBtn').textContent = r.rift ? `Enter ${r.rift.name} again` : 'Train again';
}
function nextGoal(fids) {
  const ranks = cfg.ascension.ranks;
  for (const fid of Object.keys(col.owned)) { const c = P.ascensionCost(cfg, col, fid); if (c && !c.maxed && !c.short) return `${cfg.familiars[fid].name} can Ascend to ${ranks[c.next]} in the Familiar Chamber.`; }
  const r = S.researchState(cfg, home, prof, col).find((x) => x.ready && S.canAfford(prof, x.cost));
  if (r) return `Research "${r.name}" is ready at the Library.`;
  const up = Object.keys(cfg.sanctuary.facilities).find((id) => { const c = S.facilityUpgradeCost(cfg, home, id); return c && S.canAfford(prof, c); });
  if (up) return `You can afford to upgrade the ${cfg.sanctuary.facilities[up].name}.`;
  const best = fids.map((fid) => ({ fid, mi: P.masteryInfo(cfg, prof.familiars[fid]?.masteryXp || 0) })).filter((x) => x.mi.nextAt !== null).sort((a, b) => (a.mi.nextAt - a.mi.xp) - (b.mi.nextAt - b.mi.xp))[0];
  return best ? `${Math.ceil(best.mi.nextAt - best.mi.xp)} more Mastery for ${cfg.familiars[best.fid].name} to reach Mastery ${best.mi.level + 1}.` : 'Bind more familiars from the Map.';
}
$('retryBtn').onclick = () => { $('defeat').hidden = true; startBattle(activeRift?.portal ? cfg.rifts.find((r) => r.id === activeRift.id) : activeRift, !!activeRift?.portal); paused = false; updateBase(); };
$('loadoutBtn').textContent = 'Back to the map';
$('loadoutBtn').onclick = () => { $('defeat').hidden = true; sim = null; clearVisuals(); updateBase(); };

// ---------- familiar detail: Mastery, Ascension, modifier ----------
let detFid = null;
function openDetail(fid) { detFid = fid; $('famDet').hidden = false; renderDetail(); }
function renderDetail() {
  const fid = detFid, f = cfg.familiars[fid], ab = P.effectiveAbility(cfg, col, prof, fid), ranks = cfg.ascension.ranks;
  const mi = P.masteryInfo(cfg, prof.familiars[fid]?.masteryXp || 0), c = P.ascensionCost(cfg, col, fid), M = cfg.progression.mastery;
  const cur = prof.familiars[fid]?.modifierId || null, locked = mi.level < M.branchAt;
  const asc = c.maxed ? 'Fully ascended.' : `The next rank, ${ranks[c.next]}, needs ${c.need} duplicate ${c.need === 1 ? 'credit' : 'credits'}. You have ${c.have}.${c.short ? ` You can cover the missing ${c.short} with ${c.essenceForShort} Arcane Essence (you have ${prof.essence}).` : ''}`;
  $('detBody').innerHTML = `<h1>${f.name}</h1><p>${f.type[0].toUpperCase() + f.type.slice(1)}, ${f.rarity}. Ability: <b style="color:var(--bone)">${ab.name}</b>${ab.modifierName ? ` with ${ab.modifierName}` : ''}. Changes apply from your next battle.</p>
    <h2>Mastery</h2>${masteryBar(fid)}<p class="s">Earned when this familiar's ability damages enemies or blocks damage in battle.</p>
    <h2>Ascension <span class="comp">${ranks[c.rank]}, ${c.rank} of ${ranks.length - 1}</span></h2><p class="s">Each rank adds ${Math.round(cfg.progression.ascension.potencyPerRank * 1000) / 10}% to ${ab.name}'s power. ${asc}</p><div class="actions" id="ascAct"></div>
    <h2>Modifier <span class="comp">${locked ? `unlocks at Mastery ${M.branchAt}` : 'free to change'}</span></h2><div class="mods" id="mods"></div>`;
  if (!c.maxed) {
    const b = mkBtn(c.short ? `Ascend (${c.need - c.short} credits + ${c.essenceForShort} Essence)` : `Ascend (${c.need} ${c.need === 1 ? 'credit' : 'credits'})`, () => {
      const r = P.ascend(cfg, col, prof, fid, c.short > 0);
      if (r.ok) { saveCol(); saveProf(); toast(`${f.name} reached ${ranks[r.rank]}.`, '#d7b26b'); }
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
$('detClose').onclick = () => { $('famDet').hidden = true; if (!$('menu').hidden) showTab(campTab); };

// ---------- starting a battle ----------
let activeLoadout = null, activeRift = null;
const sameLoadout = () => activeLoadout && activeLoadout.join() === loadout.join();
function clearVisuals() {
  for (const g of vis.enemies.values()) scene.remove(g);
  for (const m of vis.projectiles.values()) scene.remove(m);
  for (const m of vis.zones.values()) scene.remove(m);
  for (const f of vis.fx) { if (f.mesh) fxGroup.remove(f.mesh); if (f.el) f.el.remove(); }
  vis.enemies.clear(); vis.projectiles.clear(); vis.zones.clear(); vis.fx.length = 0; lastPos.clear();
}
function startBattle(rift = null, portal = false) {
  store.set('ww.loadout', loadout);
  const prev = settleRun(); // starting again mid-run still pays out the run so far
  if (prev && prev.rw.xp) toast(`Previous run: +${prev.rw.xp} XP, +${prev.rw.gold} Gold`);
  activeLoadout = [...loadout]; activeRift = rift && portal ? { ...rift, clearReward: scaleReward(rift.clearReward, cfg.world.portalBonus), portal: true } : rift;
  clearVisuals();
  const seed = (Math.random() * 1e9) | 0, G = gearView();
  const abilities = activeLoadout.map((fid) => { const ab = P.effectiveAbility(cfg, col, prof, fid); return { ...ab, cooldown: ab.cooldown * G.cooldownMult }; });
  sim = createSim(cfg, { weaponId: G.weaponId, weapon: G.weapon, player: G.player, familiarIds: activeLoadout, abilities }, seed, { encounter: rift });
  runTx = `battle:${Date.now().toString(36)}:${seed}`;
  if (vis.player) scene.remove(vis.player, vis.player.userData.aimPivot);
  vis.player = playerVisual();
  Stage.attachStaff(vis.player.userData.body, cfg.weapons[G.weaponId].model);
  buildAbilityButtons(); running = true; $('hud').hidden = false;
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
  document.querySelector('.tab[data-tab=explore]')?.classList.add('alert');
  if (!$('bind').hidden || !$('reveal').hidden || (sim && running)) return; // don't interrupt a binding or a battle
  toast(`A wild ${f.name} (${r.label}) was sighted. Tap to see it in Nearby.`, r.color, () => { toggleMenu(false); $('nearbyPanel').hidden = false; renderNearby(); });
  if (e.rarity !== 'common' && e.rarity !== 'uncommon') chime(r);
}
function tickWilds() {
  const now = Date.now();
  Col.pruneEncounters(col, now);
  if (now - col.lastSpawnAt > cfg.explore.spawnEverySec * 1000) {
    const e = Col.spawnEncounter(cfg, col, clientRng, now, 'wilds');
    if (e) { saveCol(); announce(e); } else col.lastSpawnAt = now;
  }
  renderNearby();
}
function waveDiscovery() {
  if (Math.random() > cfg.explore.waveDiscoveryChance) return;
  const e = Col.spawnEncounter(cfg, col, clientRng, Date.now(), 'battle');
  if (e) { saveCol(); announce(e); }
}
function renderLegend() {
  $('legend').innerHTML = cfg.rarities.map((r) => {
    const has = Object.values(cfg.familiars).some((f) => f.rarity === r.id);
    return `<div style="--c:${r.color}"><b>${'◆'.repeat(r.pips)} ${r.label}</b> ${r.share}%${has ? '' : ' (none yet)'}</div>`;
  }).join('');
}
// Shared small 3D preview for binding and reveal screens.
const preview = { renderer: null, scene: null, cam: null, model: null, anim: null };
function showPreview(container, familiarId, color, mood = 'idle') {
  if (!preview.renderer) {
    const c = document.createElement('canvas'); c.id = 'bindPrev';
    preview.renderer = new THREE.WebGLRenderer({ canvas: c, antialias: true, alpha: true });
    preview.renderer.outputColorSpace = THREE.SRGBColorSpace;
    preview.scene = new THREE.Scene();
    preview.scene.add(new THREE.HemisphereLight(0xffffff, 0x223030, 2.2));
    const d = new THREE.DirectionalLight(0xffffff, 1.8); d.position.set(2, 4, 3); preview.scene.add(d);
    preview.cam = new THREE.PerspectiveCamera(30, 1, 0.1, 50);
  }
  const canvasEl = preview.renderer.domElement; container.prepend(canvasEl);
  // Encounters fill the screen: the creature stands on a patch of ground under a dusk sky. Reveals stay in their frame.
  const full = mood === 'menace';
  if (!preview.ground) {
    const sky = document.createElement('canvas'); sky.width = 4; sky.height = 256; const sx = sky.getContext('2d');
    const gr = sx.createLinearGradient(0, 0, 0, 256); gr.addColorStop(0, '#0e1517'); gr.addColorStop(0.55, '#2a3a3a'); gr.addColorStop(1, '#3d4a3a'); sx.fillStyle = gr; sx.fillRect(0, 0, 4, 256);
    preview.sky = new THREE.CanvasTexture(sky); preview.sky.colorSpace = THREE.SRGBColorSpace;
    preview.ground = new THREE.Group();
    const disc = new THREE.Mesh(new THREE.CircleGeometry(30, 48), new THREE.MeshLambertMaterial({ color: 0x3b5236 })); disc.rotation.x = -Math.PI / 2; preview.ground.add(disc);
    const shade = new THREE.Mesh(new THREE.CircleGeometry(1, 32), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.35, depthWrite: false })); shade.rotation.x = -Math.PI / 2; shade.position.y = 0.01; preview.ground.add(shade); preview.shade = shade;
    for (let i = 0; i < 40; i++) { const tuft = new THREE.Mesh(new THREE.ConeGeometry(0.05 + Math.random() * 0.05, 0.25 + Math.random() * 0.2, 4), new THREE.MeshLambertMaterial({ color: 0x4f6b40 })); const a = Math.random() * Math.PI * 2, d = 1.2 + Math.random() * 6; tuft.position.set(Math.cos(a) * d, 0.1, Math.sin(a) * d - 1); preview.ground.add(tuft); }
    preview.scene.add(preview.ground);
  }
  preview.ground.visible = full; preview.scene.background = full ? preview.sky : null; preview.scene.fog = full ? new THREE.Fog(0x2a3a3a, 8, 26) : null;
  const w = full ? innerWidth : Math.max(10, Math.round(container.clientWidth * 0.64)), hh = full ? innerHeight : w;
  preview.renderer.setPixelRatio(Math.min(devicePixelRatio, 2)); preview.renderer.setSize(w, hh, false); preview.cam.aspect = w / hh; preview.cam.updateProjectionMatrix();
  if (preview.model) preview.scene.remove(preview.model);
  const f = cfg.familiars[familiarId];
  const g = instance(f.model) || new THREE.Mesh(new THREE.IcosahedronGeometry(0.6), new THREE.MeshLambertMaterial({ color }));
  const box = new THREE.Box3().setFromObject(g), h = Math.max(0.5, box.max.y - box.min.y);
  if (full) { const d = h * 3.7 / Math.min(1, preview.cam.aspect * 1.3); preview.cam.position.set(0, h * 0.42, d); preview.cam.lookAt(0, h * 0.5, 0); preview.shade.scale.setScalar(Math.max(0.5, h * 0.28)); }
  else { preview.cam.position.set(0, h * 0.6, h * 2.05); preview.cam.lookAt(0, h * 0.5, 0); }
  g.userData.s0 = 1; g.userData.baseY = 0;
  preview.model = g; preview.modelKey = f.model; preview.t = 0; preview.anim = g.userData && g.userData.anim; preview.scene.add(g);
  // Rigged creatures hold a stance: a wary crouch while you bind them, an easy idle once they're yours.
  if (preview.anim) preview.anim.setLoco(mood === 'menace' ? { idle: 0.25, menace: 0.75 } : { idle: 0.6, stance: 0.4 });
}
function updatePreview(dt) {
  if (!preview.model || ($('bind').hidden && $('reveal').hidden)) return;
  preview.t += dt;
  preview.model.rotation.y = Math.sin(preview.t * 0.45) * (settings.reducedMotion ? 0.15 : 0.6); // turns to look around, stays facing you
  Stage.creatureIdle(preview.model, preview.modelKey, preview.t);
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
  $('bindGo').hidden = false; $('bindGo').textContent = 'Begin binding';
  $('menu').hidden = true; $('tomeMenu').hidden = true; $('nearbyPanel').hidden = true; $('bind').hidden = false; paused = true;
  showPreview($('bindStage'), e.familiarId, TYPE_HEX[f.type], 'menace');
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
    const rw = P.bindingRewards(cfg, res), g = P.grant(cfg, prof, `bind:${bind.enc.id}`, rw); if (g.applied) prof.stats.binds = (prof.stats.binds || 0) + 1; saveProf();
    $('bind').hidden = true; showReveal(res, g.applied ? rw : null);
  }
  else if (res.outcome === 'resisted') {
    $('bindMsg').textContent = `It resisted (your chance was ${pct}%). ${res.attemptsLeft} ${res.attemptsLeft === 1 ? 'try' : 'tries'} left.`;
    $('bindGo').hidden = false; $('bindGo').textContent = 'Try again';
  } else {
    $('bindMsg').textContent = res.outcome === 'fled' ? `It fled (your chance was ${pct}%). It may appear again.` : 'That familiar is no longer here.';
    $('bindGo').hidden = true;
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
    x.fillStyle = '#fff'; x.font = '700 32px "Alegreya Sans"'; x.textAlign = 'center'; x.fillText(`${Math.ceil(bind.timeLeft)}s`, c, 34);
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
$('bindLeave').onclick = () => { bind.active = false; $('bind').hidden = true; updateBase(); };
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
$('revOk').onclick = () => { $('reveal').hidden = true; updateBase(); renderNearby(); renderAvatar(); };

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
  if (campOpen()) {
    const lay = { sheet: sheetFraction(), panel: innerWidth >= 900 && innerWidth > innerHeight ? 440 : 0 };
    if (campTab === 'home') { Stage.renderHome(renderer, dt, lay); updateHomeLabels(); } else Stage.renderHub(renderer, dt, t, lay);
  } else if (sim) renderer.render(scene, cam);
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
window.__tomecraft = { get sim() { return sim; }, get assets() { return assets; }, vis, Stage, get home() { return home; }, get prof() { return prof; } };

// ---------- boot ----------
(async () => {
  try {
    cfg = await (await fetch('data/config.json?v=36')).json();
    await loadAll();
    buildArena(cfg);
    col = Col.loadCollection(cfg, store.get('tc.collection', null));
    if (!Object.keys(col.owned).length) Col.grantStarters(cfg, col, Date.now());
    saveCol();
    prof = P.loadProfile(cfg, store.get('tc.profile', null));
    home = S.loadHome(cfg, store.get('tc.home', null));
    while (prof.presets.length < S.facilityEffect(cfg, home, 'chamber').presets) prof.presets.push(null);
    Stage.initStage({ instance, assets, loadModel, decal, ver: VER, cfg: () => cfg, reducedMotion: () => settings.reducedMotion });
    Stage.buildHub(); Stage.buildHome(cfg);
    if (!loadout || loadout.length !== 3 || loadout.some((f) => !col.owned[f])) loadout = [...cfg.starters];
    renderLegend();
    setInterval(tickWilds, 1000);
    initWorld({ cfg, col: () => col, saveCol, rarityCfg, icon, css, toast, openBinding,
      store, instance, loadModel, attachStaff: Stage.attachStaff, staffModel: () => weaponModel(), creatureIdle: Stage.creatureIdle, openRift, visitShrine, onNearby: renderNearby,
      face: (fid) => (unknownSpecies(fid) ? '' : portraits[fid] || ''), sigil: assets.tex.sigilL });
    await Stage.setHubLoadout(loadout, weaponModel());
    $('loading').remove();
    makePortraits(); renderAvatar(); renderNearbyButton();
    toggleMenu(false);
    camTarget.set(0, 0, 4); cam.position.copy(camTarget).add(CAM_OFF); cam.lookAt(camTarget);
    frame();
  } catch (err) {
    console.error(err);
    $('loadT').textContent = `Could not start: ${err.message}`;
  }
})();
