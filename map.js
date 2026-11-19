// Tomecraft world map: the home screen. MapLibre + OpenFreeMap tiles, phone GPS, and a three.js layer that stands
// the wizard, wild familiars and rift portals on the map in 3D. Location never leaves the device.
import * as THREE from 'three';
import * as World from './world.js?v=32';
import * as Col from './collection.js?v=32';

const MAPLIBRE_JS = 'https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.js';
const MAPLIBRE_CSS = 'https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.css';
const STYLE = 'https://tiles.openfreemap.org/styles/liberty';
const ZOOM = 17.8, PITCH = 60;

const $ = (id) => document.getElementById(id);
let H; // hooks from game.js
const st = { map: null, pos: null, acc: 0, prevFix: null, tooFast: false, watch: null, demo: false, demoTarget: null, gotFix: false,
  markers: new Map(), rifts: new Map(), shrines: new Map(), spawns: [], sites: [], shrineSites: [], lastScan: 0, ready: false, open: false, safetyOk: false, heading: 0, moving: 0 };

window.__map = { st, g3: null };
export const mapSupported = () => !/claudeusercontent\.com$|claude\.ai$/.test(location.hostname);
export const worldOpen = () => st.open;
export const nearbyState = () => ({ spawns: st.spawns, sites: st.sites, shrines: st.shrineSites, pos: st.pos, acc: st.acc });

export function initWorld(hooks) {
  H = hooks;
  st.safetyOk = H.store.get('tc.safety', false);
  $('safetyOk').onclick = () => { st.safetyOk = true; H.store.set('tc.safety', true); $('safety').hidden = true; startLocation(); };
  $('demoBtn').onclick = () => { st.safetyOk = true; H.store.set('tc.safety', true); $('safety').hidden = true; startDemo('Demo mode.'); };
  $('locRetry').onclick = () => { $('locHelp').hidden = true; if (st.watch) { navigator.geolocation.clearWatch(st.watch); st.watch = null; } startLocation(); };
  $('locDemo').onclick = () => { $('locHelp').hidden = true; startDemo('Demo mode.'); };
  $('locGps').onclick = () => { st.demo = false; st.demoTarget = null; st.gotFix = false; $('locGps').hidden = true; startLocation(); };
  $('recenter').onclick = () => { if (st.pos && st.map) st.map.easeTo({ center: [st.pos.lon, st.pos.lat], zoom: ZOOM, pitch: PITCH, bearing: 0 }); };
}

function loadMapLibre() {
  if (window.maplibregl) return Promise.resolve();
  return new Promise((res, rej) => {
    const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = MAPLIBRE_CSS; document.head.appendChild(l);
    const s = document.createElement('script'); s.src = MAPLIBRE_JS; s.onload = res; s.onerror = () => rej(new Error('The map library failed to load')); document.head.appendChild(s);
  });
}

/** Show the map (it is the home screen; pages and battles cover it). */
export async function openWorld() {
  $('world').hidden = false; st.open = true;
  if (!mapSupported()) { $('worldMsg').hidden = false; $('worldMsg').textContent = 'The world map only works on the hosted game. Sightings still appear in Nearby.'; return; }
  if (!st.map) {
    try { await loadMapLibre(); } catch (e) { $('worldMsg').hidden = false; $('worldMsg').textContent = `${e.message}. Check your connection.`; return; }
    createMap();
  }
  if (!st.safetyOk) { $('safety').hidden = false; return; }
  if (!st.watch && !st.demo) startLocation();
  setTimeout(() => st.map && st.map.resize(), 50);
}
export function hideWorld() { $('world').hidden = true; st.open = false; }
export function returnToWorld() { $('world').hidden = false; st.open = true; scan(true); }

function createMap() {
  const start = H.cfg.world.demoStart;
  // The camera is locked to the wizard: dragging turns it around them, pinch and wheel zoom in and out around them.
  st.map = new maplibregl.Map({ container: 'worldMap', style: STYLE, center: [start.lon, start.lat], zoom: ZOOM, pitch: PITCH, bearing: 0,
    attributionControl: false, maxPitch: 72, minZoom: 16.6, maxZoom: 20.3, dragPan: false, dragRotate: false, keyboard: false, doubleClickZoom: false, touchPitch: false });
  st.map.scrollZoom.enable({ around: 'center' }); st.map.touchZoomRotate.enable({ around: 'center' });
  orbitControls(st.map.getCanvasContainer());
  st.map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-right');
  st.map.once('idle', () => document.querySelector('.maplibregl-ctrl-attrib')?.classList.remove('maplibregl-compact-show')); // map data credit stays visible, clear of the game buttons
  st.map.on('load', () => { fantasyStyle(st.map); addOverlays(); st.map.addLayer(layer3d); st.ready = true; scan(true); });
  st.map.on('click', (e) => { if (st.demo) st.demoTarget = { lat: e.lngLat.lat, lon: e.lngLat.lng }; });
}

// Moonlit fantasy palette over OpenFreeMap's "liberty" style: violet dusk, mossy glades, glowing ley-line paths, deep glowing water.
function fantasyStyle(map) {
  const set = (id, prop, v) => { try { map.setPaintProperty(id, prop, v); } catch {} };
  const hide = (id) => { try { map.setLayoutProperty(id, 'visibility', 'none'); } catch {} };
  const paths = [];
  for (const l of map.getStyle().layers) {
    const id = l.id;
    if (l.type === 'background') set(id, 'background-color', '#232a33');
    else if (l.type === 'fill') {
      if (/water/.test(id)) set(id, 'fill-color', '#1b5a72');
      else if (/park|wood|forest|grass|landcover|scrub|wetland|farmland|cemetery|pitch/.test(id)) set(id, 'fill-color', '#2c4d3e');
      else if (/building/.test(id)) set(id, 'fill-color', '#3d3a4f');
      else set(id, 'fill-color', '#29303a');
      set(id, 'fill-outline-color', 'rgba(0,0,0,0)');
    } else if (l.type === 'fill-extrusion') { set(id, 'fill-extrusion-color', ['interpolate', ['linear'], ['coalesce', ['get', 'render_height'], 10], 0, '#3b3650', 40, '#57507a']); set(id, 'fill-extrusion-opacity', 0.94); }
    else if (l.type === 'line') {
      if (/water|river|stream|canal/.test(id)) set(id, 'line-color', '#2a8fa8');
      else if (/path|footway|track|pedestrian|cycle|steps/.test(id)) { set(id, 'line-color', '#f2cf86'); set(id, 'line-opacity', 0.85); set(id, 'line-dasharray', [1, 0]); paths.push(l); }
      else if (/road|street|highway|motorway|trunk|primary|secondary|tertiary|minor|service|bridge|tunnel/.test(id)) set(id, 'line-color', /casing/.test(id) ? '#171b22' : '#6e6250');
      else if (/boundary|admin/.test(id)) hide(id);
      else if (/rail/.test(id)) set(id, 'line-color', '#4c4658');
    } else if (l.type === 'symbol') {
      if (!/water_name|waterway|place|park/.test(id)) hide(id); // street names and shop labels clutter the view; keep only place, park and water names
      else { set(id, 'text-color', '#efe3c6'); set(id, 'text-halo-color', '#14121c'); set(id, 'text-halo-width', 1.6); }
    }
  }
  // Ley lines: a soft glow under every footpath, drawn first so the crisp path sits on top.
  for (const l of paths) {
    try { map.addLayer({ id: `${l.id}-glow`, type: 'line', source: l.source, 'source-layer': l['source-layer'], filter: l.filter, layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': '#ffcf6a', 'line-width': ['interpolate', ['linear'], ['zoom'], 16, 6, 20, 26], 'line-blur': ['interpolate', ['linear'], ['zoom'], 16, 4, 20, 16], 'line-opacity': 0.32 } }, l.id); } catch {}
  }
  try { map.setSky({ 'sky-color': '#1c1736', 'horizon-color': '#4b5f86', 'fog-color': '#243046', 'sky-horizon-blend': 0.7, 'horizon-fog-blend': 0.6, 'fog-ground-blend': 0.75, 'atmosphere-blend': 0.8 }); } catch {}
}
function circle(lat, lon, r, n = 64) {
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * Math.PI * 2;
    pts.push([lon + (r * Math.sin(a)) / (111320 * Math.cos((lat * Math.PI) / 180)), lat + (r * Math.cos(a)) / 111320]);
  }
  return { type: 'Feature', geometry: { type: 'Polygon', coordinates: [pts] } };
}
function addOverlays() {
  st.map.addSource('reach', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
  st.map.addLayer({ id: 'reach-fill', type: 'fill', source: 'reach', paint: { 'fill-color': '#e0a35a', 'fill-opacity': 0.07 } });
  st.map.addLayer({ id: 'reach-line', type: 'line', source: 'reach', paint: { 'line-color': '#f0c27a', 'line-width': 2.5, 'line-opacity': 0.8, 'line-blur': 1 } });
}

// ---------- the 3D layer: wizard, familiars and portals standing on the map ----------
const g3 = window.__map.g3 = { scene: null, cam: null, renderer: null, origin: null, wizard: null, things: new Map(), clock: new THREE.Clock(), merc: null };
const SCALE = 5.5; // creatures are drawn larger than life so they read at street zoom, as map games do
const layer3d = {
  id: 'tomecraft-3d', type: 'custom', renderingMode: '3d',
  onAdd(map, gl) {
    g3.scene = new THREE.Scene(); g3.cam = new THREE.Camera();
    g3.scene.add(new THREE.HemisphereLight(0xdfe8ff, 0x3a2e20, 1.7));
    const sun = new THREE.DirectionalLight(0xffe2b8, 2.0); sun.position.set(30, 80, 20); g3.scene.add(sun);
    g3.renderer = new THREE.WebGLRenderer({ canvas: map.getCanvas(), context: gl, antialias: true });
    g3.renderer.autoClear = false; g3.renderer.outputColorSpace = THREE.SRGBColorSpace;
    buildWizard(); buildMotes();
  },
  render(gl, matrix) {
    if (!st.pos) return;
    const dt = Math.min(0.1, g3.clock.getDelta()), t = g3.clock.elapsedTime;
    if (!g3.origin || World.distanceM(g3.origin, st.pos) > 1500) setOrigin(st.pos);
    const m = new THREE.Matrix4().fromArray(matrix);
    const o = g3.merc, s = o.meterInMercatorCoordinateUnits();
    const l = new THREE.Matrix4().makeTranslation(o.x, o.y, o.z).scale(new THREE.Vector3(s, -s, s)).multiply(new THREE.Matrix4().makeRotationX(Math.PI / 2));
    g3.cam.projectionMatrix = m.multiply(l);
    if (g3.wizard) {
      const p = local(st.pos); g3.wizard.position.set(p.x, 0, p.z);
      const tgt = st.heading; let d = tgt - g3.wizard.rotation.y; d = Math.atan2(Math.sin(d), Math.cos(d)); g3.wizard.rotation.y += d * Math.min(1, dt * 8);
      const an = g3.wizard.userData.anim;
      if (an) { const run = st.moving > 0 ? 1 : 0; an.setLoco({ idle: 1 - run, walk: run, stance: 0 }, 1); an.update(dt); }
      st.moving = Math.max(0, st.moving - dt);
      g3.ring.position.set(p.x, 0.15, p.z); g3.ring.rotation.z = t * 0.4;
    }
    for (const th of g3.things.values()) {
      th.userData.anim?.update(dt);
      if (th.userData.model) H.creatureIdle(th.userData.body, th.userData.model, t + th.userData.phase);
      if (th.userData.spin) th.userData.spin.rotation.y = t * 0.8;
      if (th.userData.ring) th.userData.ring.material.opacity = 0.55 + 0.25 * Math.sin(t * 3 + th.userData.phase);
      if (th.userData.halo) { const k = 1 + 0.08 * Math.sin(t * 2 + th.userData.phase); th.userData.halo.scale.set(k * th.userData.haloSize, k * th.userData.haloSize, 1); }
    }
    if (g3.motes) {
      const p = g3.motes.geometry.attributes.position, w = g3.wizard ? g3.wizard.position : { x: 0, z: 0 };
      g3.motes.position.set(w.x, 0, w.z);
      for (let i = 0; i < p.count; i++) { let y = p.getY(i) + dt * (0.6 + (i % 5) * 0.15); if (y > 14) y = 0.5; p.setY(i, y); p.setX(i, p.getX(i) + Math.sin(t + i) * dt * 0.4); }
      p.needsUpdate = true; g3.motes.material.opacity = 0.55 + 0.25 * Math.sin(t * 1.3);
    }

    g3.renderer.resetState(); g3.renderer.render(g3.scene, g3.cam);
    st.map.triggerRepaint();
  },
};
function buildMotes() { // fireflies and drifting sparks around the wizard
  const n = 140, pos = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { const a = Math.random() * Math.PI * 2, r = 6 + Math.random() * 70; pos.set([Math.cos(a) * r, Math.random() * 14, Math.sin(a) * r], i * 3); }
  const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g3.motes = new THREE.Points(geo, new THREE.PointsMaterial({ color: 0xffd98a, size: 0.9, transparent: true, opacity: 0.7, depthWrite: false, blending: THREE.AdditiveBlending, map: glowTex() }));
  g3.scene.add(g3.motes);
}
let _glow;
function glowTex() {
  if (_glow) return _glow;
  const c = document.createElement('canvas'); c.width = c.height = 64; const x = c.getContext('2d'), g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.3, 'rgba(255,255,255,.6)'); g.addColorStop(1, 'rgba(255,255,255,0)'); x.fillStyle = g; x.fillRect(0, 0, 64, 64);
  _glow = new THREE.CanvasTexture(c); return _glow;
}
function halo(color, size) {
  const m = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex(), color, transparent: true, opacity: 0.8, depthWrite: false, blending: THREE.AdditiveBlending }));
  m.scale.set(size, size, 1); return m;
}
async function fitModel(name, height) {
  const m = await H.loadModel(name, true); if (!m) return null;
  const b = new THREE.Box3().setFromObject(m), k = height / Math.max(1e-3, b.max.y - b.min.y);
  m.scale.setScalar(k); m.position.y = -b.min.y * k; return m;
}
async function addShrine3d(site) {
  const T = H.cfg.shrines.types[site.type], g = new THREE.Group(); g.userData = { at: site, phase: Math.random() * 6, haloSize: 16 };
  g3.things.set(site.id, g); const p = local(site); g.position.set(p.x, 0, p.z); g3.scene.add(g);
  const ring = groundRing(new THREE.Color(T.glow), 4.2, 5.2); g.add(ring); g.userData.ring = ring;
  const h = halo(new THREE.Color(T.glow), 16); h.position.y = 6; g.add(h); g.userData.halo = h;
  const m = await fitModel(T.model, 9); if (m && g3.things.get(site.id) === g) g.add(m);
}
async function addRuins(g) { // a broken ruin and two torches make every portal a landmark
  const r = await fitModel('df_ruin2', 15); if (r) { r.position.z = -9; g.add(r); }
  for (const x of [-10, 10]) { const t = await fitModel('df_torch', 6); if (!t) continue; t.position.x = x; t.position.z = 3; g.add(t); const hl = halo(0xff9a4a, 6); hl.position.set(x, 6, 3); g.add(hl); }
}
function setOrigin(pos) {
  g3.origin = { ...pos }; g3.merc = maplibregl.MercatorCoordinate.fromLngLat([pos.lon, pos.lat], 0);
  for (const th of [...g3.things.values(), ...(trees.group?.children || [])]) { const p = local(th.userData.at); th.position.set(p.x, 0, p.z); }
}
/** Metres east (x) and south (z) of the layer origin. */
function local(p) {
  const k = 111320, o = g3.origin;
  return { x: (p.lon - o.lon) * k * Math.cos((o.lat * Math.PI) / 180), z: -(p.lat - o.lat) * k };
}
async function buildWizard() {
  const w = H.instance('mage'); if (!w) return;
  w.scale.setScalar(SCALE); g3.scene.add(w); g3.wizard = w;
  await H.attachStaff(w, H.staffModel());
  const ring = new THREE.Mesh(new THREE.RingGeometry(3.2, 4.2, 48), new THREE.MeshBasicMaterial({ color: 0xf0c27a, transparent: true, opacity: 0.55, depthWrite: false, side: THREE.DoubleSide }));
  ring.rotation.x = -Math.PI / 2; g3.scene.add(ring); g3.ring = ring;
}
export async function refreshWizardGear() { if (g3.wizard) await H.attachStaff(g3.wizard, H.staffModel()); }
function groundRing(color, r0, r1) {
  const m = new THREE.Mesh(new THREE.RingGeometry(r0, r1, 48), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.7, depthWrite: false, side: THREE.DoubleSide }));
  m.rotation.x = -Math.PI / 2; m.position.y = 0.2; return m;
}
function addFamiliar3d(s) {
  const f = H.cfg.familiars[s.familiarId], r = H.rarityCfg(s.rarity);
  const g = new THREE.Group(); g.userData = { at: s, model: f.model, phase: Math.random() * 6 };
  const body = H.instance(f.model);
  if (body) { body.userData.s0 = SCALE * 1.3; body.scale.setScalar(SCALE * 1.3); body.userData.anim?.setLoco({ idle: 0.7, menace: 0.3 }); g.add(body); g.userData.body = body; g.userData.anim = body.userData.anim; }
  const ring = groundRing(new THREE.Color(r.color), 3.6, 4.8); g.add(ring); g.userData.ring = ring;
  g.rotation.y = Math.random() * Math.PI * 2;
  const p = local(s); g.position.set(p.x, 0, p.z); g3.scene.add(g); g3.things.set(s.id, g);
}
function addPortal3d(site) {
  const g = new THREE.Group(); g.userData = { at: site, phase: Math.random() * 6 };
  const col = 0xc8463a, glow = new THREE.MeshBasicMaterial({ color: 0xff8a5c, transparent: true, opacity: 0.85 });
  const spin = new THREE.Group(); g.add(spin); g.userData.spin = spin;
  const torus = new THREE.Mesh(new THREE.TorusGeometry(7, 0.7, 10, 48), new THREE.MeshLambertMaterial({ color: 0x3b3f44, emissive: col, emissiveIntensity: 0.6 }));
  torus.position.y = 8.5; spin.add(torus);
  const inner = new THREE.Mesh(new THREE.CircleGeometry(6.4, 40), new THREE.MeshBasicMaterial({ color: 0x5a1a40, transparent: true, opacity: 0.55, side: THREE.DoubleSide, depthWrite: false }));
  inner.position.y = 8.5; spin.add(inner);
  for (let i = 0; i < 6; i++) { const shard = new THREE.Mesh(new THREE.OctahedronGeometry(0.9), glow); const a = (i / 6) * Math.PI * 2; shard.position.set(Math.cos(a) * 9, 8.5 + Math.sin(a) * 9, 0); spin.add(shard); }
  const ring = groundRing(col, 7, 9); g.add(ring); g.userData.ring = ring;
  g.userData.haloSize = 26; const hl = halo(0xff6a5c, 26); hl.position.y = 8.5; g.add(hl); g.userData.halo = hl; addRuins(g);
  const p = local(site); g.position.set(p.x, 0, p.z); g3.scene.add(g); g3.things.set(site.id, g);
}
// Scenery: trees on the map's parks and grass, at fixed spots per cell so they never shuffle. Cheap Kingdom tree model.
const trees = { cells: new Set(), group: null };
// Groves, not a sprinkle: each 60 m patch of park or woodland gets at most one grove of 3-6 trees with shrubs at their feet,
// spaced apart, kept clear of shrines and portals, and only drawn near the wizard so the distance stays readable.
const FLORA = { park: [['tree', 14, 17], ['tree2', 13, 16], ['tree3', 13, 16], ['oak', 17, 21]], wood: [['pines', 18, 24], ['pines2', 18, 24], ['thin', 14, 18], ['tree3', 13, 16]], under: [['shrubs', 2.4, 3.4], ['fern', 1.6, 2.4], ['bush1', 2, 2.8]] }; // larger than life, in step with the figures
async function floraModel(name) {
  trees.src[name] ||= (async () => { const m = await H.loadModel(name, true); if (!m) return null; const b = new THREE.Box3().setFromObject(m); return { m, h: b.max.y - b.min.y }; })();
  return trees.src[name];
}
async function plantTrees() {
  if (!g3.scene || !g3.origin) return;
  if (!trees.group) { trees.group = new THREE.Group(); g3.scene.add(trees.group); trees.src = {}; }
  const W = { ...H.cfg.world, cellM: 60 }, c = World.cellOf(W, st.pos.lat, st.pos.lon), cv = st.map.getCanvas();
  const rng = (h) => () => ((h = (h * 1664525 + 1013904223) >>> 0) / 4294967296);
  const green = (p) => { const q = st.map.project([p.lon, p.lat]); if (q.x < 0 || q.y < 0 || q.x > cv.clientWidth || q.y > cv.clientHeight) return null;
    const f = st.map.queryRenderedFeatures([q.x, q.y]); if (f.some((x) => /water|building|road|street|path|rail/.test(x.layer.id))) return null;
    const g = f.find((x) => x.layer.type === 'fill' && /park|wood|forest|grass|scrub|cemetery|garden|meadow/.test(x.layer.id)); return g ? (/wood|forest/.test(g.layer.id) ? 'wood' : 'park') : null; };
  const clear = (p) => [...(st.shrineSites || []), ...(st.sites || [])].every((s) => World.distanceM(s, p) > 16);
  for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
    const key = `${c.cx + dx}:${c.cy + dy}`; if (trees.cells.has(key)) continue;
    const lat0 = (c.cy + dy) * c.latStep, lon0 = (c.cx + dx) * c.lonStep, mid = st.map.project([lon0 + c.lonStep / 2, lat0 + c.latStep / 2]);
    if (mid.x < 0 || mid.y < 0 || mid.x > cv.clientWidth || mid.y > cv.clientHeight) continue; // only judge ground the map has drawn
    trees.cells.add(key);
    let h = 0; for (const ch of key) h = (h * 31 + ch.charCodeAt(0)) >>> 0; const r = rng(h);
    if (r() > 0.7) continue; // open lawns between groves
    const centre = { lat: lat0 + (0.2 + r() * 0.6) * c.latStep, lon: lon0 + (0.2 + r() * 0.6) * c.lonStep }, kind = green(centre);
    if (!kind || !clear(centre)) continue;
    const mPerLat = 111320, mPerLon = 111320 * Math.cos((centre.lat * Math.PI) / 180), placed = [];
    const add = async (pool, n, sigma, minGap) => {
      for (let i = 0; i < n; i++) {
        const gx = (r() + r() + r() - 1.5) * sigma, gz = (r() + r() + r() - 1.5) * sigma, p = { lat: centre.lat + gz / mPerLat, lon: centre.lon + gx / mPerLon };
        if (placed.some((q) => Math.hypot(q[0] - gx, q[1] - gz) < minGap) || !green(p) || !clear(p)) continue;
        const [name, h0, h1] = pool[Math.floor(r() * pool.length)], src = await floraModel(name); if (!src) continue;
        const t = src.m.clone(); t.scale.setScalar((h0 + r() * (h1 - h0)) / Math.max(1e-3, src.h)); t.rotation.y = r() * 6.28;
        const l = local(p); t.position.set(l.x, 0, l.z); t.userData.at = p; trees.group.add(t); placed.push([gx, gz]);
      }
    };
    await add(FLORA[kind], 3 + Math.floor(r() * 4), 11, 8);
    await add(FLORA.under, 2 + Math.floor(r() * 3), 6, 2.5);
  }
  for (const t of trees.group.children) t.visible = Math.hypot(t.position.x - local(st.pos).x, t.position.z - local(st.pos).z) < 330;
}
function removeThing(id) { const g = g3.things.get(id); if (g) { g3.scene.remove(g); g3.things.delete(id); } }

// ---------- location ----------
const inAppBrowser = () => /Claude\/|FBAN|FBAV|Instagram|Line\/|; wv\)/.test(navigator.userAgent);
const isIOS = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
function showLocHelp(kind) {
  const url = location.origin + location.pathname;
  const how = isIOS()
    ? 'On iPhone: Settings → Privacy & Security → Location Services must be on, and Safari Websites set to "While Using". Then in Safari tap the <b>aA</b> button → Website Settings → Location → Allow, and tap Try again.'
    : /Android/.test(navigator.userAgent)
      ? 'On Android: make sure Location is on in quick settings. In Chrome, tap the icon left of the address → Permissions → Location → Allow, then tap Try again.'
      : 'On a computer: click the icon left of the address bar → Location → Allow. Desktops often have no GPS, so the game is best on a phone.';
  const text = {
    inapp: `This browser can't share your location (the Claude app's built-in browser and some in-app browsers block it). Open <b>${url}</b> in Safari or Chrome on your phone.`,
    denied: `Location is blocked for this site. ${how}`,
    slow: 'Still waiting for a GPS fix. Step outside or near a window; it can take up to a minute the first time. The game keeps trying.',
    none: 'This browser has no location support. Open the game in Safari or Chrome on your phone.',
  }[kind];
  $('locText').innerHTML = text;
  if (kind !== 'slow') status('Location unavailable');
  $('locHelp').hidden = false;
  $('locRetry').hidden = kind === 'none' || kind === 'inapp';
}
const status = (t) => { $('worldStatus').textContent = t; };
function startLocation() {
  if (st.demo || st.watch) return;
  $('locHelp').hidden = true;
  if (!('geolocation' in navigator)) return showLocHelp('none');
  status('Finding you…');
  navigator.geolocation.getCurrentPosition(onFix, () => {}, { enableHighAccuracy: false, maximumAge: 60000, timeout: 15000 });
  st.slowTimer = setTimeout(() => { if (!st.gotFix && !st.demo) showLocHelp('slow'); }, 20000);
  st.watch = navigator.geolocation.watchPosition(onFix, (err) => {
    if (err.code === 1) { navigator.geolocation.clearWatch(st.watch); st.watch = null; showLocHelp(inAppBrowser() ? 'inapp' : 'denied'); }
    else status(err.code === 3 ? 'Waiting for GPS…' : 'Weak GPS, retrying…');
  }, { enableHighAccuracy: true, maximumAge: 2000 });
}
function onFix(p) {
  if (st.demo) return;
  clearTimeout(st.slowTimer); $('locHelp').hidden = true;
  if (!st.gotFix) { st.gotFix = true; if (st.map) st.map.jumpTo({ center: [p.coords.longitude, p.coords.latitude], zoom: ZOOM }); }
  const fix = { lat: p.coords.latitude, lon: p.coords.longitude, t: p.timestamp || Date.now(), speed: p.coords.speed };
  const g = World.speedGate(H.cfg, st.prevFix, fix);
  fix.speedEst = g.speed; st.prevFix = fix;
  setPosition(fix.lat, fix.lon, p.coords.accuracy || 0, g.tooFast);
}
function startDemo(reason) {
  if (st.watch) { navigator.geolocation.clearWatch(st.watch); st.watch = null; }
  st.demo = true;
  const s = st.pos || H.cfg.world.demoStart;
  setPosition(s.lat, s.lon, 5, false);
  H.toast(`${reason} Tap the map to walk there.`);
  $('locGps').hidden = false;
}
function setPosition(lat, lon, acc, tooFast) {
  const first = !st.pos, prev = st.pos;
  if (prev) {
    const d = World.distanceM(prev, { lat, lon });
    if (d > 0.3) { st.heading = Math.atan2((lon - prev.lon) * Math.cos((lat * Math.PI) / 180), -(lat - prev.lat)); st.moving = 0.6; } // facing +z (south) is 0
  }
  st.pos = { lat, lon }; st.acc = acc; st.tooFast = tooFast;
  if (!st.map) return;
  st.map.jumpTo({ center: [lon, lat], ...(first ? { zoom: ZOOM } : {}) });
  const src = st.map.getSource('reach');
  if (src) src.setData({ type: 'FeatureCollection', features: [circle(lat, lon, H.cfg.world.interactRadiusM)] });
  $('speedWarn').hidden = !tooFast;
  status(st.demo ? 'Demo mode' : `GPS ±${Math.round(acc)} m`);
  scan(false);
}

// ---------- spawns and portals ----------
function scan(force) {
  if (!st.ready || !st.pos) return;
  if (!g3.origin) setOrigin(st.pos); // the first scan can run before the first frame sets the origin
  const now = Date.now();
  if (!force && now - st.lastScan < 1500) { refreshRanges(); return; }
  st.lastScan = now;
  const W = H.cfg.world, col = H.col();
  const spawns = World.nearbySpawns(H.cfg, st.pos, now, W.viewRadiusM).filter((s) => !col.closed.includes(s.id) && !safeSkip(s));
  const sites = World.riftSites(H.cfg, st.pos, W.viewRadiusM * 1.5);
  const shrineSites = World.shrineSites(H.cfg, st.pos, W.viewRadiusM, pois());
  const keep = new Set([...spawns.map((s) => s.id), ...sites.map((s) => s.id), ...shrineSites.map((s) => s.id)]);
  for (const [id, m] of [...st.markers, ...st.rifts, ...st.shrines]) if (!keep.has(id)) { m.remove(); st.markers.delete(id); st.rifts.delete(id); st.shrines.delete(id); removeThing(id); }
  for (const s of shrineSites) if (!st.shrines.has(s.id)) { st.shrines.set(s.id, hitMarker(s, () => tapShrine(s), s.name || H.cfg.shrines.types[s.type].name, 'shrine')); addShrine3d(s); }
  for (const s of spawns) if (!st.markers.has(s.id)) { st.markers.set(s.id, hitMarker(s, () => tapSpawn(s), spawnLabel(s))); addFamiliar3d(s); }
  for (const s of sites) if (!st.rifts.has(s.id)) { st.rifts.set(s.id, hitMarker(s, () => tapRift(s), H.cfg.rifts.find((r) => r.id === s.riftId).name, 'rift')); addPortal3d(s); }
  st.spawns = spawns; st.sites = sites; st.shrineSites = shrineSites;
  plantTrees();
  refreshRanges(); H.onNearby();
}
// Don't place familiars on water or roads (GDD §11). Only checkable for points the map has drawn.
function safeSkip(s) {
  const p = st.map.project([s.lon, s.lat]), c = st.map.getCanvas();
  if (p.x < 0 || p.y < 0 || p.x > c.clientWidth || p.y > c.clientHeight) return false;
  const feats = st.map.queryRenderedFeatures([[p.x - 3, p.y - 3], [p.x + 3, p.y + 3]]);
  return feats.some((f) => (f.layer.type === 'fill' && /water/.test(f.layer.id)) ||
    (f.layer.type === 'line' && /motorway|trunk|primary|secondary|rail/.test(f.layer.id)));
}
const spawnLabel = (s) => { const f = H.cfg.familiars[s.familiarId], r = H.rarityCfg(s.rarity); return `${f.name}, ${r.label}`; };
/** An invisible, focusable hit area over each 3D figure; the name tag shows once it is in reach. */
function hitMarker(s, onTap, label, kind = 'spawn') {
  const el = document.createElement('button'); el.className = `hit ${kind}`;
  el.innerHTML = `<em>${label}</em>`;
  el.onclick = (e) => { e.stopPropagation(); onTap(); };
  const m = new maplibregl.Marker({ element: el, anchor: 'bottom' }).setLngLat([s.lon, s.lat]).addTo(st.map);
  el.setAttribute('aria-label', label); // MapLibre replaces it with "Map marker"
  m.spawn = s; return m;
}
function refreshRanges() {
  for (const m of st.markers.values()) m.getElement().classList.toggle('near', World.inRange(H.cfg, st.pos, m.spawn, st.acc));
  for (const m of st.rifts.values()) m.getElement().classList.toggle('near', World.riftInRange(H.cfg, st.pos, m.spawn, st.acc));
  for (const m of st.shrines.values()) m.getElement().classList.toggle('near', shrineInRange(m.spawn));
}
function tapSpawn(s) {
  const f = H.cfg.familiars[s.familiarId], r = H.rarityCfg(s.rarity);
  if (st.tooFast) return H.toast('You are moving too fast. Interactions pause above walking or jogging pace.');
  const d = Math.round(World.distanceM(st.pos, s));
  if (!World.inRange(H.cfg, st.pos, s, st.acc)) return H.toast(`${f.name} (${r.label}) is ${d} m away. Walk within ${H.cfg.world.interactRadiusM} m, keeping to paths and public places.`, r.color);
  const col = H.col();
  const enc = Col.registerWorldEncounter(col, World.toEncounter(H.cfg, s, Date.now()));
  if (!enc) { H.toast('That familiar has gone.'); scan(true); return; }
  H.saveCol();
  channelAt(s, () => H.openBinding(enc.id, 'map'));
}
/** The wizard turns to the target and channels (custom Blender clip) before the next screen opens. */
function channelAt(p, then) {
  const an = g3.wizard?.userData.anim;
  if (!an || !an.actions.channel) return then();
  const l = local(p); st.heading = Math.atan2(l.x, l.z);
  an.playOnce('channel', 0.9); setTimeout(then, 700);
}
function tapRift(site) {
  const rift = H.cfg.rifts.find((r) => r.id === site.riftId);
  H.openRift(rift, World.riftInRange(H.cfg, st.pos, site, st.acc) ? null : Math.round(World.distanceM(st.pos, site)));
}
const shrineInRange = (s) => World.distanceM(st.pos, s) - Math.min(st.acc, H.cfg.world.accuracyAllowanceM) <= H.cfg.shrines.radiusM;
function tapShrine(s) {
  if (st.tooFast) return H.toast('You are moving too fast. Interactions pause above walking or jogging pace.');
  if (shrineInRange(s)) channelAt(s, () => H.visitShrine(s, null)); else H.visitShrine(s, Math.round(World.distanceM(st.pos, s)));
}
/** Points of interest the map has loaded (shops, cafes, monuments...), for shrines to stand on. */
function pois() {
  try {
    return st.map.querySourceFeatures('openmaptiles', { sourceLayer: 'poi' }).filter((f) => f.geometry.type === 'Point')
      .map((f) => ({ id: f.id ?? f.properties.name, name: f.properties.name || null, lon: f.geometry.coordinates[0], lat: f.geometry.coordinates[1] }));
  } catch { return []; }
}
/** Turn the camera to face something nearby; the wizard stays in the centre. */
export function flyTo(p) {
  if (!st.map || !st.pos) return;
  const b = (Math.atan2((p.lon - st.pos.lon) * Math.cos((st.pos.lat * Math.PI) / 180), p.lat - st.pos.lat) * 180) / Math.PI;
  st.map.easeTo({ bearing: b, zoom: Math.min(st.map.getZoom(), 18.4), duration: 900 });
}
function orbitControls(el) {
  const ptrs = new Map(); let moved = 0;
  el.addEventListener('pointerdown', (e) => { ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY }); moved = 0; });
  el.addEventListener('pointermove', (e) => {
    const p = ptrs.get(e.pointerId); if (!p || ptrs.size !== 1) return;
    const dx = e.clientX - p.x, dy = e.clientY - p.y; p.x = e.clientX; p.y = e.clientY; moved += Math.abs(dx) + Math.abs(dy);
    if (moved < 6) return;
    st.map.setBearing(st.map.getBearing() - dx * 0.35);
    st.map.setPitch(Math.max(40, Math.min(72, st.map.getPitch() - dy * 0.15)));
  });
  const up = (e) => ptrs.delete(e.pointerId);
  el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
}

// Demo walking and periodic rescans
export function tickWorld(dt) {
  if (!st.open || !st.pos) return;
  if (st.demo && st.demoTarget) {
    const d = World.distanceM(st.pos, st.demoTarget), step = H.cfg.world.demoWalkMps * dt;
    if (d <= step) { setPosition(st.demoTarget.lat, st.demoTarget.lon, 5, false); st.demoTarget = null; }
    else { const k = step / d; setPosition(st.pos.lat + (st.demoTarget.lat - st.pos.lat) * k, st.pos.lon + (st.demoTarget.lon - st.pos.lon) * k, 5, false); }
  } else if (Date.now() - st.lastScan > 5000) scan(true);
}
