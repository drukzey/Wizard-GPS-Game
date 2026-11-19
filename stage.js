// Tomecraft 3D stages outside battle (M5): the camp stage behind the menus, and the Sanctuary plot.
// Both draw into the game's renderer; game.js decides which scene is on screen.
import * as THREE from 'three';

let D; // deps from game.js: { instance, assets, loadModel(name) -> Promise<Object3D>, atlas, decal, reducedMotion() }
export function initStage(deps) { D = deps; }

// ---------- shared ----------
const HOVER = { parrot: 0.35, squid: 0.25, fairy: 0.25 };
/** Gentle life for any creature: breathing for all, bob for fliers and floaters, a flap-tilt for the parrot. */
export function creatureIdle(g, model, t) {
  const k = HOVER[model] || 0, rm = D.reducedMotion() ? 0.3 : 1;
  g.position.y = (g.userData.baseY || 0) + k * (0.5 + 0.5 * Math.sin(t * 2.1)) * rm;
  const b = 1 + 0.015 * Math.sin(t * 1.7) * rm;
  g.scale.set(g.userData.s0 * b, g.userData.s0 * (2 - b), g.userData.s0 * b);
  if (model === 'parrot') g.rotation.z = Math.sin(t * 9) * 0.06 * rm;
  if (model === 'squid') g.rotation.y += 0.004 * rm;
}
function prepCreature(g, model, scale = 1) { g.userData.s0 = scale; g.userData.model = model; g.scale.setScalar(scale); return g; }

function makeLights(scene, key = 0xffd9a0, rim = 0x7fd6c4) {
  scene.add(new THREE.HemisphereLight(0x8fa6a0, 0x14100c, 1.1));
  const k = new THREE.DirectionalLight(key, 2.4); k.position.set(4, 7, 6); k.castShadow = true;
  k.shadow.mapSize.set(1024, 1024); Object.assign(k.shadow.camera, { left: -8, right: 8, top: 8, bottom: -8, near: 1, far: 30 });
  const r = new THREE.DirectionalLight(rim, 2.0); r.position.set(-5, 4, -6);
  scene.add(k, r); return k;
}

// ---------- camp stage: the wizard, their gear and their three familiars ----------
export const hub = { scene: null, cam: null, wizard: null, staff: null, team: [], teamIds: [], weaponModel: null, yaw: 0.35, yawV: 0, platform: null, motes: null, zoom: 1 };

export function buildHub() {
  const s = hub.scene = new THREE.Scene();
  s.background = new THREE.Color(0x121618); s.fog = new THREE.Fog(0x121618, 14, 60);
  makeLights(s);
  hub.cam = new THREE.PerspectiveCamera(32, 1, 0.1, 60);
  const plat = hub.platform = new THREE.Group(); s.add(plat);
  const stone = new THREE.Mesh(new THREE.CylinderGeometry(3.6, 3.9, 0.35, 48), new THREE.MeshLambertMaterial({ color: 0x2a3033 }));
  stone.position.y = -0.18; stone.receiveShadow = true; plat.add(stone);
  if (D.assets.tex.sigilL) { const r = D.decal(D.assets.tex.sigilL, 6.6, 0xc8463a, 0.55); r.position.y = 0.01; plat.add(r); hub.ring = r; }
  const floor = new THREE.Mesh(new THREE.CircleGeometry(30, 48), new THREE.MeshLambertMaterial({ color: 0x0e1112 }));
  floor.rotation.x = -Math.PI / 2; floor.position.y = -0.36; s.add(floor);
  // a few drifting embers: the one ambient motion on this screen
  const n = 60, pos = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { const a = Math.random() * Math.PI * 2, r = 1.5 + Math.random() * 5; pos.set([Math.cos(a) * r, Math.random() * 4, Math.sin(a) * r - 1], i * 3); }
  const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  hub.motes = new THREE.Points(geo, new THREE.PointsMaterial({ color: 0xffb070, size: 0.05, transparent: true, opacity: 0.7, depthWrite: false }));
  s.add(hub.motes);
  hub.wizard = D.instance('mage');
  if (hub.wizard) { plat.add(hub.wizard); hub.hand = findBone(hub.wizard, /hand_r$/i); hub.wizard.userData.anim?.setLoco({ idle: 1 }); } // centred, so turning the platform turns the wizard in place
}
const findBone = (root, re) => { let b = null; root.traverse((o) => { if (!b && o.isBone && re.test(o.name)) b = o; }); return b; };

// How a staff sits in the old Synty rig's right hand (tuned by eye; the hand's local X runs along the fingers).
export const staffTune = { len: 1.75, rx: -4.28, ry: 2.02, rz: 2.68, grip: 0.53, ox: -0.0719, oy: 0.0083, oz: 0.0852, curl: 0 }; // solved in the browser against the wizard's hand mesh: shaft through the fist, foot on the ground
/** Close the hand around the shaft: the animations don't drive finger bones, so they keep this pose. */
function curlFingers(hand, amount) {
  hand.traverse((b) => { if (!b.isBone || b === hand) return;
    if (b.userData.q0) b.quaternion.copy(b.userData.q0); else b.userData.q0 = b.quaternion.clone();
    const thumb = /thumb/i.test(b.name);
    b.rotateOnAxis(new THREE.Vector3(0, 0, 1), (thumb ? 0.5 : 1) * amount * (thumb ? -0.6 : 1));
  });
}
/** Put a weapon model in the wizard's right hand (shared with the battle visual). */
export async function attachStaff(wizard, modelName) {
  const hand = findBone(wizard, /hand_r$/i); if (!hand) return null;
  const old = hand.children.find((c) => c.userData.isStaff); if (old) hand.remove(old);
  const obj = await D.loadModel(modelName); if (!obj) return null;
  // Synty staffs are modelled upright with the grip at the origin; the old rig's hand points down its local X.
  obj.userData.isStaff = true;
  wizard.updateMatrixWorld(true);
  const ws = new THREE.Vector3(), rs = new THREE.Vector3(); hand.getWorldScale(ws); wizard.getWorldScale(rs); ws.divide(rs); // hand scale relative to the character, so the staff matches however big the character is drawn
  const T = staffTune, box = new THREE.Box3().setFromObject(obj), len = Math.max(1e-3, box.max.y - box.min.y);
  const k = T.len / len / ws.x; obj.scale.setScalar(k);
  obj.rotation.set(T.rx, T.ry, T.rz);
  obj.position.set(T.ox / ws.x, T.oy / ws.x, T.oz / ws.x); obj.translateY(-(box.min.y + T.grip * len) * k); // grip point, measured up the shaft
  curlFingers(hand, T.curl);
  hand.add(obj); return obj;
}

export async function setHubLoadout(teamIds, weaponModel) {
  if (weaponModel !== hub.weaponModel && hub.wizard) { hub.weaponModel = weaponModel; await attachStaff(hub.wizard, weaponModel); }
  if (teamIds.join() === hub.teamIds.join()) return;
  hub.teamIds = [...teamIds];
  for (const g of hub.team) hub.platform.remove(g);
  const spots = [[-2.5, 0.2, 0.25], [0, -0.5, 0], [2.5, 0.2, -0.25]]; // a row across the platform, centred on the middle one
  hub.team = teamIds.map((fid, i) => {
    const f = D.cfg().familiars[fid], g = D.instance(f.model); if (!g) return null;
    prepCreature(g, f.model, 1); g.position.set(spots[i][0], 0, spots[i][1]); g.rotation.y = spots[i][2];
    g.userData.anim?.setLoco({ idle: 1 }); g.userData.phase = i * 1.3;
    hub.platform.add(g); return g;
  }).filter(Boolean);
}

/** Frame the stage around the open sheet: wizard sits above a bottom sheet (portrait) or left of a side panel (landscape). */
export function zoomHub(dz) { hub.zoom = Math.max(0.4, Math.min(1.8, hub.zoom * (1 + dz))); }
export function renderHub(renderer, dt, t, layout) {
  const w = innerWidth, h = innerHeight, c = hub.cam;
  c.aspect = w / h;
  const portrait = w < h;
  c.fov = portrait ? 50 : 32;
  // pull back so the whole platform fits in the part of the screen the sheet leaves free
  const free = portrait ? 1 - (layout.sheet || 0) * 0.8 : 1 - (layout.panel || 0) / w;
  const k = Math.min(2.8, 1.15 / Math.max(0.35, free));
  const z = hub.zoom, close = Math.max(0, 1 - z) / 0.6; // pinch or wheel: 0.4 (face and hands) to 1.8 (whole platform)
  if (hub.focus === 'wizard') { // the profile view: your wizard alone in the middle, close enough to see the staff
    const ly = 1.0 + close * 0.35; c.position.set(0, ly + 0.45 - close * 0.2, (portrait ? 5.4 : 4.6) * Math.min(1.8, k) * z); c.lookAt(0, ly, 0);
  } else { // the team: three familiars side by side, framed to fill the free part of the screen
    c.position.set(0, 2.2, (portrait ? 11.5 : 8.6) * Math.min(2.2, k) * z); c.lookAt(0, 1.1, 0);
  }
  c.clearViewOffset();
  if (layout.sheet) {
    if (portrait) c.setViewOffset(w, h, 0, h * layout.sheet * 0.5, w, h); // shift the scene up by half the sheet height
    else c.setViewOffset(w, h, layout.panel * 0.5, 0, w, h);             // shift left by half the side panel
  }
  c.updateProjectionMatrix();
  hub.yaw += hub.yawV * dt; hub.yawV *= Math.pow(0.04, dt);
  hub.platform.rotation.y = hub.yaw;
  if (hub.ring) hub.ring.rotation.z = t * 0.05;
  if (hub.motes && !D.reducedMotion()) { const p = hub.motes.geometry.attributes.position; for (let i = 0; i < p.count; i++) { let y = p.getY(i) + dt * 0.25; if (y > 4) y = 0; p.setY(i, y); } p.needsUpdate = true; }
  hub.wizard?.userData.anim?.update(dt);
  for (const g of hub.team) { g.userData.anim?.update(dt); creatureIdle(g, g.userData.model, t + g.userData.phase); }
  renderer.render(hub.scene, c);
}
export function setHubFocus(f) { hub.focus = f; for (const g of hub.team) g.visible = f !== 'wizard'; if (hub.wizard) hub.wizard.visible = f === 'wizard'; hub.yaw = 0; hub.yawV = 0; }
export function spinHub(dx) { hub.yawV = dx * 3; hub.yaw += dx; }

// ---------- Sanctuary plot ----------
export const home = { scene: null, cam: null, root: null, facilities: {}, decor: [], ghost: null, yaw: Math.PI / 4, pitch: 0.72, dist: 66, tiles: null, target: new THREE.Vector3(), built: '' };

export function buildHome(cfg) {
  const s = home.scene = new THREE.Scene();
  s.background = new THREE.Color(0x1a2124); s.fog = new THREE.Fog(0x1a2124, 60, 160);
  const key = makeLights(s, 0xffe2b8, 0x9fd4ff);
  Object.assign(key.shadow.camera, { left: -40, right: 40, top: 40, bottom: -40, far: 140 }); key.shadow.mapSize.set(2048, 2048); key.position.set(24, 48, 20);
  home.cam = new THREE.PerspectiveCamera(36, 1, 0.5, 500);
  const S = cfg.sanctuary, size = S.grid * S.tile;
  home.root = new THREE.Group(); s.add(home.root);
  // A floating island above the clouds: grass top, a jagged rock underside, mist below and a dusk sky.
  s.background = skyTexture(); s.fog = new THREE.Fog(0x2b2440, 150, 340);
  const R = 34; // the island itself (terrain, cliffs, pond, woods, observatory) is authored in Blender: blender/build_island.py
  home.ground = new THREE.Mesh(new THREE.PlaneGeometry(size, size), new THREE.MeshBasicMaterial({ visible: false })); // the buildable plot, for picking
  home.ground.rotation.x = -Math.PI / 2; s.add(home.ground);
  const mist = new THREE.Group(); s.add(mist); home.mist = mist; // drifting cloud puffs below the island
  const puff = cloudTexture();
  for (let i = 0; i < 26; i++) { const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: puff, color: 0x8f80b8, transparent: true, opacity: 0.32, depthWrite: false }));
    const a = Math.random() * Math.PI * 2, r = R * (0.6 + Math.random() * 1.4); sp.position.set(Math.cos(a) * r, -16 - Math.random() * 16, Math.sin(a) * r); sp.scale.setScalar(26 + Math.random() * 22); mist.add(sp); }
  home.scenery = new THREE.Group(); s.add(home.scenery); home.R = R;
  // tile grid, shown while placing decorations
  const pts = [];
  for (let i = 0; i <= S.grid; i++) { const v = -size / 2 + i * S.tile; pts.push(v, 0.03, -size / 2, v, 0.03, size / 2, -size / 2, 0.03, v, size / 2, 0.03, v); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  home.tiles = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0xe9dfc9, transparent: true, opacity: 0.25 }));
  home.tiles.visible = false; s.add(home.tiles);
  home.tileSel = new THREE.Mesh(new THREE.PlaneGeometry(S.tile * 0.92, S.tile * 0.92), new THREE.MeshBasicMaterial({ color: 0x7fd6a0, transparent: true, opacity: 0.45, depthWrite: false }));
  home.tileSel.rotation.x = -Math.PI / 2; home.tileSel.visible = false; s.add(home.tileSel);
}
function skyTexture() {
  const c = document.createElement('canvas'); c.width = 4; c.height = 256; const x = c.getContext('2d'), g = x.createLinearGradient(0, 0, 0, 256);
  g.addColorStop(0, '#191433'); g.addColorStop(0.5, '#3d3866'); g.addColorStop(0.8, '#a06f6a'); g.addColorStop(1, '#d7a46d'); x.fillStyle = g; x.fillRect(0, 0, 4, 256);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
function cloudTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 128; const x = c.getContext('2d');
  for (let i = 0; i < 7; i++) { const cx = 30 + Math.random() * 68, cy = 40 + Math.random() * 48, r = 22 + Math.random() * 20, g = x.createRadialGradient(cx, cy, 0, cx, cy, r);
    g.addColorStop(0, 'rgba(255,255,255,.3)'); g.addColorStop(1, 'rgba(255,255,255,0)'); x.fillStyle = g; x.fillRect(0, 0, 128, 128); }
  return new THREE.CanvasTexture(c);
}
/** Load the Blender-built island once: vertex-coloured terrain and rock, a pond, and Synty Kingdom set dressing. */
/** Ground shader for the island top: Blender stores grass/dirt/rock weights in the vertex colours (RGB);
 *  here they blend Fantasy Kingdom ground textures, sampled in world space so there are no UV seams. */
function groundMaterial() {
  const L = new THREE.TextureLoader(), tex = (n) => { const t = L.load(`assets/ground_${n}.jpg?v=${D.ver || 1}`); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t; };
  const m = new THREE.MeshLambertMaterial({ vertexColors: true });
  const u = { tG1: { value: tex('g1') }, tG2: { value: tex('g2') }, tG3: { value: tex('g3') }, tDirt: { value: tex('dirt') }, tRock: { value: tex('rock') } };
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, u);
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vW;').replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvW = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
      varying vec3 vW; uniform sampler2D tG1, tG2, tG3, tDirt, tRock;
      float wav(vec2 p){ return 0.5 + 0.25 * sin(p.x * 0.11 + sin(p.y * 0.07) * 2.0) + 0.25 * sin(p.y * 0.13 + sin(p.x * 0.05) * 2.3); }`)
      .replace('#include <color_fragment>', `
        vec2 uv = vW.xz * 0.085; float n1 = smoothstep(0.35, 0.65, wav(vW.xz)), n2 = smoothstep(0.62, 0.8, wav(vW.zx * 1.7 + 40.0));
        vec3 grass = mix(texture2D(tG1, uv).rgb, texture2D(tG2, uv * 0.9).rgb, n1); grass = mix(grass, texture2D(tG3, uv).rgb, n2 * 0.85);
        vec3 dirt = texture2D(tDirt, uv * 1.3).rgb, rock = texture2D(tRock, uv * 0.7).rgb * vec3(0.62, 0.6, 0.62);
        vec3 w = vColor.rgb / max(0.001, vColor.r + vColor.g + vColor.b);
        diffuseColor.rgb *= grass * w.r + dirt * w.g + rock * w.b;`);
  };
  return m;
}
export async function dressIsland() {
  if (home.dressed) return; home.dressed = true;
  const isl = await D.loadModel('island', true); if (!isl) return;
  const water = new THREE.MeshLambertMaterial({ color: 0x2f8aa6, emissive: 0x0c3a4c, transparent: true, opacity: 0.86 });
  const rock = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, side: THREE.DoubleSide });
  const falls = new THREE.ShaderMaterial({ uniforms: { t: { value: 0 } }, transparent: true, depthWrite: false, side: THREE.DoubleSide,
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `uniform float t; varying vec2 vUv; void main(){
      float streak = 0.55 + 0.45 * sin(vUv.x * 40.0 + sin(vUv.x * 7.0) * 3.0) * sin((vUv.y * 9.0 - t * 2.2) + vUv.x * 5.0);
      vec3 c = mix(vec3(0.25, 0.62, 0.74), vec3(0.85, 0.95, 1.0), streak * 0.6);
      float edge = smoothstep(0.0, 0.18, vUv.x) * smoothstep(1.0, 0.82, vUv.x);
      gl_FragColor = vec4(c, (0.55 + 0.3 * streak) * edge * (1.0 - smoothstep(0.55, 1.0, vUv.y))); }` });
  const ground = groundMaterial();
  isl.traverse((o) => {
    if (!o.isMesh) return;
    if (/^falls/i.test(o.name)) { o.material = falls; home.falls = falls; o.castShadow = false; }
    else if (/^water/i.test(o.name)) { o.material = water; o.receiveShadow = true; o.castShadow = false; }
    else if (/^terrain/i.test(o.name)) { o.material = ground; o.receiveShadow = true; }
    else if (/^(cliff|islet)/i.test(o.name)) { o.material = rock; o.receiveShadow = true; o.castShadow = true; } // Synty props carry vertex colours too, so match by name
  });
  isl.updateMatrixWorld(true);
  const w = new THREE.Box3().setFromObject(isl).getSize(new THREE.Vector3()).x;
  isl.scale.multiplyScalar(w > 1000 ? 0.01 : 1); isl.updateMatrixWorld(true); // FBX from Blender arrives in centimetres
  home.scenery.add(isl); home.island = isl;
}
export const tileCenter = (cfg, x, z) => { const S = cfg.sanctuary, o = -S.grid * S.tile / 2 + S.tile / 2; return new THREE.Vector3(o + x * S.tile, 0, o + z * S.tile); };

function fit(obj, maxSide, sink = 0) { // scale a building to fit its footprint, ground it, centre it
  obj.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(obj), sz = box.getSize(new THREE.Vector3());
  const k = maxSide / Math.max(sz.x, sz.z, 0.01); obj.scale.multiplyScalar(k);
  obj.updateMatrixWorld(true); box.setFromObject(obj); const c = box.getCenter(new THREE.Vector3());
  obj.position.x -= c.x; obj.position.z -= c.z; obj.position.y -= box.min.y + sink * sz.y * k;
  const g = new THREE.Group(); g.add(obj); return g;
}
/** Rebuild whatever changed since the last call (facility levels, decor list). */
export async function syncHome(cfg, h) {
  const S = cfg.sanctuary; dressIsland();
  for (const [id, f] of Object.entries(S.facilities)) {
    const model = f.models[h.facilities[id] - 1];
    if (home.facilities[id]?.userData.model === model) continue;
    const obj = await D.loadModel(model, true); if (!obj) continue;
    const glass = await D.loadModel(`${model}_glass`, true);
    if (glass) { glass.traverse((o) => { if (o.isMesh) o.material = new THREE.MeshLambertMaterial({ color: 0xffcf7a, emissive: 0x6a4410, transparent: true, opacity: 0.85 }); }); obj.add(glass); }
    const g = fit(obj, (f.size[0] - 0.4) * S.tile * (h.facilities[id] === 1 ? 0.85 : 1), (S.sink || {})[model] || 0); // sink stilted or plinthed models into the grass
    const c = tileCenter(cfg, f.at[0] + (f.size[0] - 1) / 2, f.at[1] + (f.size[1] - 1) / 2);
    g.position.copy(c); g.rotation.y = Math.atan2(-c.x, -c.z); // doors face the middle of the plot
    g.userData = { model, facility: id }; g.traverse((o) => { if (o.isMesh) { o.castShadow = o.receiveShadow = true; o.userData.facility = id; } });
    if (home.facilities[id]) home.root.remove(home.facilities[id]);
    home.root.add(g); home.facilities[id] = g;
  }
  const key = JSON.stringify(h.decor.placed);
  if (key === home.built) return;
  home.built = key;
  for (const g of home.decor) home.root.remove(g);
  home.decor = [];
  for (const [i, d] of h.decor.placed.entries()) {
    const obj = await D.loadModel(S.decor[d.id].model, true); if (!obj) continue;
    const g = fit(obj, S.tile * 0.9); g.position.copy(tileCenter(cfg, d.x, d.z)); g.rotation.y = d.rot * Math.PI / 2;
    g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.userData.decor = i; } });
    home.root.add(g); home.decor.push(g);
  }
}
export async function setGhost(cfg, decorId) {
  if (home.ghost) { home.scene.remove(home.ghost); home.ghost = null; }
  home.tiles.visible = !!decorId; home.tileSel.visible = !!decorId;
  if (!decorId) return;
  const obj = await D.loadModel(cfg.sanctuary.decor[decorId].model, true); if (!obj) return;
  obj.traverse((o) => { if (o.isMesh) o.material = new THREE.MeshLambertMaterial({ color: 0xbfe6d0, transparent: true, opacity: 0.6 }); });
  home.ghost = fit(obj, cfg.sanctuary.tile * 0.9); home.scene.add(home.ghost);
}
export function moveGhost(cfg, x, z, rot, ok) {
  const c = tileCenter(cfg, x, z);
  home.tileSel.position.set(c.x, 0.04, c.z); home.tileSel.material.color.setHex(ok ? 0x7fd6a0 : 0xd8584a);
  if (home.ghost) { home.ghost.position.copy(c); home.ghost.rotation.y = rot * Math.PI / 2; }
}
const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
/** What is under a screen point: a facility, a placed decoration, and the plot tile. */
export function pickHome(cfg, sx, sy) {
  ndc.set((sx / innerWidth) * 2 - 1, -(sy / innerHeight) * 2 + 1);
  ray.setFromCamera(ndc, home.cam);
  const hits = ray.intersectObjects(home.root.children, true);
  const hit = hits.find((x) => x.object.userData.facility || x.object.userData.decor !== undefined);
  const g = ray.intersectObject(home.ground)[0];
  const S = cfg.sanctuary, size = S.grid * S.tile;
  const tile = g ? { x: Math.floor((g.point.x + size / 2) / S.tile), z: Math.floor((g.point.z + size / 2) / S.tile) } : null;
  return { facility: hit?.object.userData.facility || null, decor: hit && hit.object.userData.decor !== undefined ? hit.object.userData.decor : null, tile };
}
export function renderHome(renderer, dt, layout) {
  if (home.falls) home.falls.uniforms.t.value += dt;
  const w = innerWidth, h = innerHeight, c = home.cam;
  c.aspect = w / h;
  const portrait = w < h, free = portrait ? 1 - (layout.sheet || 0) * 0.8 : 1 - (layout.panel || 0) / w;
  c.fov = portrait ? 50 : 36;
  const dist = home.dist * Math.min(2, 1 / Math.max(0.4, free)) * (portrait ? 1.15 : 1), cp = Math.cos(home.pitch);
  c.position.set(home.target.x + Math.sin(home.yaw) * cp * dist, Math.sin(home.pitch) * dist, home.target.z + Math.cos(home.yaw) * cp * dist);
  c.lookAt(home.target);
  c.clearViewOffset();
  if (layout.sheet && w < h) c.setViewOffset(w, h, 0, h * layout.sheet * 0.5, w, h);
  else if (layout.panel) c.setViewOffset(w, h, layout.panel * 0.5, 0, w, h);
  c.updateProjectionMatrix();
  renderer.render(home.scene, c);
}
export function orbitHome(dx, dy, dz) {
  home.yaw -= dx * 0.008; home.pitch = Math.max(0.35, Math.min(1.35, home.pitch + dy * 0.005));
  home.dist = Math.max(18, Math.min(95, home.dist * (1 + dz)));
}
/** Screen position of a facility's roof, for its floating label. */
export function labelPos(id) {
  const g = home.facilities[id]; if (!g) return null;
  const box = new THREE.Box3().setFromObject(g), p = new THREE.Vector3((box.min.x + box.max.x) / 2, box.max.y + 0.6, (box.min.z + box.max.z) / 2).project(home.cam);
  return p.z > 1 ? null : { x: (p.x * 0.5 + 0.5) * innerWidth, y: (-p.y * 0.5 + 0.5) * innerHeight };
}
