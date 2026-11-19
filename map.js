// Tomecraft world map: the home screen. MapLibre + OpenFreeMap tiles, phone GPS, and a three.js layer that stands
// the wizard, wild familiars and rift portals on the map in 3D. Location never leaves the device.
import * as THREE from 'three';
import * as World from './world.js?v=14';
import * as Col from './collection.js?v=14';

const MAPLIBRE_JS = 'https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.js';
const MAPLIBRE_CSS = 'https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.css';
const STYLE = 'https://tiles.openfreemap.org/styles/liberty';
const ZOOM = 17.6, PITCH = 58;

const $ = (id) => document.getElementById(id);
let H; // hooks from game.js
const st = { map: null, pos: null, acc: 0, prevFix: null, tooFast: false, watch: null, demo: false, demoTarget: null, gotFix: false,
  markers: new Map(), rifts: new Map(), spawns: [], sites: [], lastScan: 0, ready: false, open: false, safetyOk: false, follow: true, heading: 0, moving: 0 };

export const mapSupported = () => !/claudeusercontent\.com$|claude\.ai$/.test(location.hostname);
export const worldOpen = () => st.open;
export const nearbyState = () => ({ spawns: st.spawns, sites: st.sites, pos: st.pos, acc: st.acc });

export function initWorld(hooks) {
  H = hooks;
  st.safetyOk = H.store.get('tc.safety', false);
  $('safetyOk').onclick = () => { st.safetyOk = true; H.store.set('tc.safety', true); $('safety').hidden = true; startLocation(); };
  $('demoBtn').onclick = () => { st.safetyOk = true; H.store.set('tc.safety', true); $('safety').hidden = true; startDemo('Demo mode.'); };
  $('locRetry').onclick = () => { $('locHelp').hidden = true; if (st.watch) { navigator.geolocation.clearWatch(st.watch); st.watch = null; } startLocation(); };
  $('locDemo').onclick = () => { $('locHelp').hidden = true; startDemo('Demo mode.'); };
  $('locGps').onclick = () => { st.demo = false; st.demoTarget = null; st.gotFix = false; $('locGps').hidden = true; startLocation(); };
  $('recenter').onclick = () => { st.follow = true; if (st.pos && st.map) st.map.easeTo({ center: [st.pos.lon, st.pos.lat], zoom: ZOOM, pitch: PITCH }); };
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
  st.map = new maplibregl.Map({ container: 'worldMap', style: STYLE, center: [start.lon, start.lat], zoom: ZOOM, pitch: PITCH, bearing: -20,
    attributionControl: { compact: true }, maxPitch: 70, minZoom: 15, dragRotate: true, touchPitch: true });
  st.map.on('load', () => { fantasyStyle(st.map); addOverlays(); st.map.addLayer(layer3d); st.ready = true; scan(true); });
  st.map.on('click', (e) => { if (st.demo) st.demoTarget = { lat: e.lngLat.lat, lon: e.lngLat.lng }; });
  st.map.on('dragstart', () => { st.follow = false; });
}

// Dark fantasy palette over OpenFreeMap's "liberty" style: mossy ground, slate roofs, amber paths, deep water.
function fantasyStyle(map) {
  const set = (id, prop, v) => { try { map.setPaintProperty(id, prop, v); } catch {} };
  const hide = (id) => { try { map.setLayoutProperty(id, 'visibility', 'none'); } catch {} };
  for (const l of map.getStyle().layers) {
    const id = l.id;
    if (l.type === 'background') set(id, 'background-color', '#24302a');
    else if (l.type === 'fill') {
      if (/water/.test(id)) set(id, 'fill-color', '#163f4a');
      else if (/park|wood|forest|grass|landcover|scrub|wetland|farmland|cemetery|pitch/.test(id)) set(id, 'fill-color', '#2f4a33');
      else if (/building/.test(id)) set(id, 'fill-color', '#3a3d40');
      else set(id, 'fill-color', '#29352e');
      set(id, 'fill-outline-color', 'rgba(0,0,0,0)');
    } else if (l.type === 'fill-extrusion') { set(id, 'fill-extrusion-color', '#4a4f55'); set(id, 'fill-extrusion-opacity', 0.92); }
    else if (l.type === 'line') {
      if (/water|river|stream|canal/.test(id)) set(id, 'line-color', '#1f5f6e');
      else if (/path|footway|track|pedestrian|cycle|steps/.test(id)) { set(id, 'line-color', '#d6b26a'); set(id, 'line-opacity', 0.75); }
      else if (/road|street|highway|motorway|trunk|primary|secondary|tertiary|minor|service|bridge|tunnel/.test(id)) set(id, 'line-color', /casing/.test(id) ? '#1a201c' : '#8a7652');
      else if (/boundary|admin/.test(id)) hide(id);
      else if (/rail/.test(id)) set(id, 'line-color', '#55504a');
    } else if (l.type === 'symbol') {
      if (/poi|transit|shield|aeroway/.test(id)) hide(id);
      else { set(id, 'text-color', '#efe3c6'); set(id, 'text-halo-color', '#121816'); set(id, 'text-halo-width', 1.4); }
    }
  }
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
const g3 = { scene: null, cam: null, renderer: null, origin: null, wizard: null, things: new Map(), clock: new THREE.Clock(), merc: null };
const SCALE = 3.4; // creatures are drawn larger than life so they read at street zoom, as map games do
const layer3d = {
  id: 'tomecraft-3d', type: 'custom', renderingMode: '3d',
  onAdd(map, gl) {
    g3.scene = new THREE.Scene(); g3.cam = new THREE.Camera();
    g3.scene.add(new THREE.HemisphereLight(0xdfe8ff, 0x3a2e20, 1.7));
    const sun = new THREE.DirectionalLight(0xffe2b8, 2.0); sun.position.set(30, 80, 20); g3.scene.add(sun);
    g3.renderer = new THREE.WebGLRenderer({ canvas: map.getCanvas(), context: gl, antialias: true });
    g3.renderer.autoClear = false; g3.renderer.outputColorSpace = THREE.SRGBColorSpace;
    buildWizard();
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
    }
    g3.renderer.resetState(); g3.renderer.render(g3.scene, g3.cam);
    st.map.triggerRepaint();
  },
};
function setOrigin(pos) {
  g3.origin = { ...pos }; g3.merc = maplibregl.MercatorCoordinate.fromLngLat([pos.lon, pos.lat], 0);
  for (const th of g3.things.values()) { const p = local(th.userData.at); th.position.set(p.x, 0, p.z); }
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
  if (body) { body.userData.s0 = SCALE * 0.9; body.scale.setScalar(SCALE * 0.9); body.userData.anim?.setLoco({ idle: 0.7, menace: 0.3 }); g.add(body); g.userData.body = body; g.userData.anim = body.userData.anim; }
  const ring = groundRing(new THREE.Color(r.color), 2.6, 3.4); g.add(ring); g.userData.ring = ring;
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
  const p = local(site); g.position.set(p.x, 0, p.z); g3.scene.add(g); g3.things.set(site.id, g);
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
  if (first) st.map.jumpTo({ center: [lon, lat], zoom: ZOOM });
  else if (st.follow) st.map.setCenter([lon, lat]);
  const src = st.map.getSource('reach');
  if (src) src.setData({ type: 'FeatureCollection', features: [circle(lat, lon, H.cfg.world.interactRadiusM)] });
  $('speedWarn').hidden = !tooFast;
  status(st.demo ? 'Demo mode' : `GPS ±${Math.round(acc)} m`);
  scan(false);
}

// ---------- spawns and portals ----------
function scan(force) {
  if (!st.ready || !st.pos) return;
  const now = Date.now();
  if (!force && now - st.lastScan < 1500) { refreshRanges(); return; }
  st.lastScan = now;
  const W = H.cfg.world, col = H.col();
  const spawns = World.nearbySpawns(H.cfg, st.pos, now, W.viewRadiusM).filter((s) => !col.closed.includes(s.id) && !safeSkip(s));
  const sites = World.riftSites(H.cfg, st.pos, W.viewRadiusM * 1.5);
  const keep = new Set([...spawns.map((s) => s.id), ...sites.map((s) => s.id)]);
  for (const [id, m] of [...st.markers, ...st.rifts]) if (!keep.has(id)) { m.remove(); st.markers.delete(id); st.rifts.delete(id); removeThing(id); }
  for (const s of spawns) if (!st.markers.has(s.id)) { st.markers.set(s.id, hitMarker(s, () => tapSpawn(s), spawnLabel(s))); addFamiliar3d(s); }
  for (const s of sites) if (!st.rifts.has(s.id)) { st.rifts.set(s.id, hitMarker(s, () => tapRift(s), H.cfg.rifts.find((r) => r.id === s.riftId).name, 'rift')); addPortal3d(s); }
  st.spawns = spawns; st.sites = sites;
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
  H.openBinding(enc.id, 'map');
}
function tapRift(site) {
  const rift = H.cfg.rifts.find((r) => r.id === site.riftId);
  H.openRift(rift, World.riftInRange(H.cfg, st.pos, site, st.acc) ? null : Math.round(World.distanceM(st.pos, site)));
}
export function flyTo(p) { st.follow = false; st.map?.easeTo({ center: [p.lon, p.lat], zoom: ZOOM }); }

// Demo walking and periodic rescans
export function tickWorld(dt) {
  if (!st.open || !st.pos) return;
  if (st.demo && st.demoTarget) {
    const d = World.distanceM(st.pos, st.demoTarget), step = H.cfg.world.demoWalkMps * dt;
    if (d <= step) { setPosition(st.demoTarget.lat, st.demoTarget.lon, 5, false); st.demoTarget = null; }
    else { const k = step / d; setPosition(st.pos.lat + (st.demoTarget.lat - st.pos.lat) * k, st.pos.lon + (st.demoTarget.lon - st.pos.lon) * k, 5, false); }
  } else if (Date.now() - st.lastScan > 5000) scan(true);
}
