// Tomecraft world map (M6 alpha): MapLibre + OpenFreeMap vector tiles, phone GPS, familiar markers.
// Location never leaves the device. Needs the hosted site: Claude artifact pages block location and map tiles.
import * as World from './world.js?v=10';
import * as Col from './collection.js?v=10';

const MAPLIBRE_JS = 'https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.js';
const MAPLIBRE_CSS = 'https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.css';
const STYLE = 'https://tiles.openfreemap.org/styles/liberty';

const $ = (id) => document.getElementById(id);
let H; // hooks from game.js
const st = { map: null, me: null, meEl: null, pos: null, acc: 0, prevFix: null, tooFast: false, watch: null, demo: false,
  demoTarget: null, markers: new Map(), lastScan: 0, ready: false, open: false, safetyOk: false };

export const mapSupported = () => !/claudeusercontent\.com$|claude\.ai$/.test(location.hostname);

export function initWorld(hooks) {
  H = hooks;
  $('worldBack').onclick = closeWorld;
  $('safetyOk').onclick = () => { st.safetyOk = true; $('safety').hidden = true; startLocation(); };
  $('demoBtn').onclick = () => { st.safetyOk = true; $('safety').hidden = true; startDemo('You chose demo mode.'); };
  $('locRetry').onclick = () => { $('locHelp').hidden = true; if (st.watch) { navigator.geolocation.clearWatch(st.watch); st.watch = null; } startLocation(); };
  $('locDemo').onclick = () => { $('locHelp').hidden = true; startDemo('Demo mode.'); };
  $('locGps').onclick = () => { st.demo = false; st.demoTarget = null; st.gotFix = false; $('locGps').hidden = true; startLocation(); };
  $('recenter').onclick = () => st.pos && st.map && st.map.easeTo({ center: [st.pos.lon, st.pos.lat], zoom: 17.3 });
}

function loadMapLibre() {
  if (window.maplibregl) return Promise.resolve();
  return new Promise((res, rej) => {
    const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = MAPLIBRE_CSS; document.head.appendChild(l);
    const s = document.createElement('script'); s.src = MAPLIBRE_JS; s.onload = res; s.onerror = () => rej(new Error('Map library failed to load')); document.head.appendChild(s);
  });
}

export async function openWorld() {
  $('world').hidden = false; st.open = true; H.pause(true);
  if (!mapSupported()) { $('worldMsg').textContent = 'The real-world map only works on the hosted version of the game (Claude pages block location and map images). Use the Explore list here instead.'; $('worldStatus').textContent = 'Map unavailable here'; return; }
  try { await loadMapLibre(); } catch (e) { $('worldMsg').textContent = `${e.message}. Check your connection.`; return; }
  if (!st.map) createMap();
  if (!st.safetyOk) { $('safety').hidden = false; return; }
  if (!st.watch && !st.demo) startLocation();
  setTimeout(() => st.map && st.map.resize(), 50);
}
export function closeWorld() { $('world').hidden = true; st.open = false; H.pause(false); H.openMenu('explore'); }
export const worldOpen = () => st.open;

function createMap() {
  const start = H.cfg.world.demoStart;
  st.map = new maplibregl.Map({ container: 'worldMap', style: STYLE, center: [start.lon, start.lat], zoom: 16.8, pitch: 50, bearing: -20,
    attributionControl: { compact: true }, maxPitch: 60, dragRotate: true });
  st.map.on('load', () => { fantasyStyle(st.map); addOverlays(); st.ready = true; scan(true); });
  st.map.on('click', (e) => { if (st.demo) st.demoTarget = { lat: e.lngLat.lat, lon: e.lngLat.lng }; });
  st.meEl = document.createElement('div'); st.meEl.className = 'me';
  st.meEl.innerHTML = '<i class="ico" style="--m:var(--u-sigilM);--c:#b08bff"></i><span></span>';
  st.me = new maplibregl.Marker({ element: st.meEl, pitchAlignment: 'map', rotationAlignment: 'map' }).setLngLat([start.lon, start.lat]).addTo(st.map);
}

// Recolour OpenFreeMap's "liberty" style into a dark fantasy palette.
function fantasyStyle(map) {
  const set = (id, prop, v) => { try { map.setPaintProperty(id, prop, v); } catch {} };
  for (const l of map.getStyle().layers) {
    const id = l.id;
    if (l.type === 'background') set(id, 'background-color', '#18201d');
    else if (l.type === 'fill') {
      if (/water/.test(id)) set(id, 'fill-color', '#0f3640');
      else if (/park|wood|forest|grass|landcover|scrub|wetland|farmland/.test(id)) set(id, 'fill-color', '#21382a');
      else if (/building/.test(id)) set(id, 'fill-color', '#2e3134');
      else set(id, 'fill-color', '#1d2622');
    } else if (l.type === 'fill-extrusion') { set(id, 'fill-extrusion-color', '#34383c'); set(id, 'fill-extrusion-opacity', 0.85); }
    else if (l.type === 'line') {
      if (/water|river|stream|canal/.test(id)) set(id, 'line-color', '#155061');
      else if (/path|footway|track|pedestrian|cycle/.test(id)) set(id, 'line-color', '#8f7b55');
      else if (/road|street|highway|motorway|trunk|primary|secondary|tertiary|minor|service|bridge|tunnel/.test(id)) set(id, 'line-color', '#6b5a3c');
      else if (/boundary|admin/.test(id)) set(id, 'line-color', '#3a4a44');
    } else if (l.type === 'symbol') { set(id, 'text-color', '#e9dcc0'); set(id, 'text-halo-color', '#0b0f10'); set(id, 'icon-opacity', 0.6); }
  }
}

function circle(lat, lon, r, n = 48) {
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * Math.PI * 2;
    pts.push([lon + (r * Math.sin(a)) / (111320 * Math.cos((lat * Math.PI) / 180)), lat + (r * Math.cos(a)) / 111320]);
  }
  return { type: 'Feature', geometry: { type: 'Polygon', coordinates: [pts] } };
}
function addOverlays() {
  st.map.addSource('reach', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
  st.map.addLayer({ id: 'reach-fill', type: 'fill', source: 'reach', paint: { 'fill-color': '#b08bff', 'fill-opacity': 0.08 } });
  st.map.addLayer({ id: 'reach-line', type: 'line', source: 'reach', paint: { 'line-color': '#b08bff', 'line-width': 2, 'line-opacity': 0.7, 'line-dasharray': [2, 2] } });
}

// ---- location ----
const inAppBrowser = () => /Claude\/|FBAN|FBAV|Instagram|Line\/|; wv\)/.test(navigator.userAgent);
const isIOS = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
function showLocHelp(kind) {
  const url = location.origin + location.pathname;
  const how = isIOS()
    ? 'On iPhone: Settings → Privacy & Security → Location Services must be on, and Safari Websites set to "While Using". Then in Safari tap the <b>aA</b> button → Website Settings → Location → Allow, and tap Try again.'
    : /Android/.test(navigator.userAgent)
      ? 'On Android: make sure Location is on in quick settings. In Chrome, tap the icon left of the address → Permissions → Location → Allow, then tap Try again.'
      : 'On a computer: click the icon left of the address bar → Location → Allow. On a Mac, also check System Settings → Privacy & Security → Location Services for your browser. Desktops often have no GPS, so the game is best on a phone.';
  const text = {
    inapp: `This browser can't share your location (the Claude app's built-in browser and some in-app browsers block it). Open <b>${url}</b> in Safari or Chrome on your phone.`,
    denied: `Location is blocked for this site. ${how}`,
    slow: 'Still waiting for a GPS fix. Step outside or near a window; it can take up to a minute the first time. The game keeps trying.',
    none: 'This browser has no location support. Open the game in Safari or Chrome on your phone.',
  }[kind];
  $('locText').innerHTML = text;
  if (kind !== 'slow') $('worldStatus').textContent = 'Location unavailable';
  $('locHelp').hidden = false;
  $('locRetry').hidden = kind === 'none' || kind === 'inapp';
}
function startLocation() {
  if (st.demo || st.watch) return;
  $('locHelp').hidden = true;
  if (!('geolocation' in navigator)) return showLocHelp('none');
  // Ask straight away, inside the tap: some phones only show the permission prompt during a user gesture.
  $('worldStatus').textContent = 'Finding your location…';
  // Quick coarse fix first (fast indoors), then keep a high-accuracy watch running.
  navigator.geolocation.getCurrentPosition(onFix, () => {}, { enableHighAccuracy: false, maximumAge: 60000, timeout: 15000 });
  st.slowTimer = setTimeout(() => { if (!st.gotFix && !st.demo) showLocHelp('slow'); }, 20000);
  st.watch = navigator.geolocation.watchPosition(onFix, (err) => {
    if (err.code === 1) { navigator.geolocation.clearWatch(st.watch); st.watch = null; showLocHelp(inAppBrowser() ? 'inapp' : 'denied'); }
    else $('worldStatus').textContent = err.code === 3 ? 'Waiting for GPS…' : 'GPS signal weak, retrying…';
  }, { enableHighAccuracy: true, maximumAge: 2000 });
}
function onFix(p) {
  if (st.demo) return;
  clearTimeout(st.slowTimer); $('locHelp').hidden = true;
  if (!st.gotFix) { st.gotFix = true; if (st.map) st.map.jumpTo({ center: [p.coords.longitude, p.coords.latitude], zoom: 17.3 }); }
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
  $('worldMsg').textContent = `${reason} Tap the map to walk there.`;
  $('locGps').hidden = false;
}
function setPosition(lat, lon, acc, tooFast) {
  const first = !st.pos;
  st.pos = { lat, lon }; st.acc = acc; st.tooFast = tooFast;
  if (!st.map) return;
  st.me.setLngLat([lon, lat]);
  if (first) st.map.jumpTo({ center: [lon, lat], zoom: 17.3 });
  const src = st.map.getSource('reach');
  if (src) src.setData({ type: 'FeatureCollection', features: [circle(lat, lon, H.cfg.world.interactRadiusM)] });
  $('speedWarn').hidden = !tooFast;
  $('worldStatus').textContent = st.demo ? 'Demo mode (no GPS)' : `GPS ±${Math.round(acc)} m`;
  scan(false);
}

// ---- spawns ----
function scan(force) {
  if (!st.ready || !st.pos) return;
  const now = Date.now();
  if (!force && now - st.lastScan < 1500) { refreshRanges(); return; }
  st.lastScan = now;
  const W = H.cfg.world, col = H.col();
  const spawns = World.nearbySpawns(H.cfg, st.pos, now, W.viewRadiusM).filter((s) => !col.closed.includes(s.id) && !safeSkip(s));
  const keep = new Set(spawns.map((s) => s.id));
  for (const [id, m] of st.markers) if (!keep.has(id)) { m.marker.remove(); st.markers.delete(id); }
  for (const s of spawns) if (!st.markers.has(s.id)) st.markers.set(s.id, { spawn: s, marker: makeMarker(s) });
  refreshRanges();
  const near = spawns.filter((s) => World.inRange(H.cfg, st.pos, s, st.acc)).length;
  $('worldMsg').textContent = `${spawns.length} familiar${spawns.length === 1 ? '' : 's'} nearby · ${near} in reach${st.demo ? ' · tap the map to walk' : ''}`;
}
// Don't place familiars on water or roads (GDD §11). Only checkable for points the map has drawn.
function safeSkip(s) {
  const p = st.map.project([s.lon, s.lat]), c = st.map.getCanvas();
  if (p.x < 0 || p.y < 0 || p.x > c.clientWidth || p.y > c.clientHeight) return false;
  const feats = st.map.queryRenderedFeatures([[p.x - 3, p.y - 3], [p.x + 3, p.y + 3]]);
  return feats.some((f) => (f.layer.type === 'fill' && /water/.test(f.layer.id)) ||
    (f.layer.type === 'line' && /motorway|trunk|primary|secondary|rail/.test(f.layer.id)));
}
function makeMarker(s) {
  const f = H.cfg.familiars[s.familiarId], r = H.rarityCfg(s.rarity);
  const el = document.createElement('button'); el.className = 'spawn'; el.style.setProperty('--rc', r.color); el.style.setProperty('--tc', H.css(f.type));
  el.setAttribute('aria-label', `${f.name}, ${r.label} ${f.type}`);
  el.innerHTML = `<span class="orbit"></span>${H.icon(`i_${f.abilityId}`, H.css(f.type))}<b>${'◆'.repeat(r.pips)}</b><em>${f.name}</em>`;
  if (H.cfg.rarities.indexOf(r) >= 3) el.classList.add('glow');
  el.onclick = (e) => { e.stopPropagation(); tapSpawn(s); };
  const m = new maplibregl.Marker({ element: el }).setLngLat([s.lon, s.lat]).addTo(st.map);
  el.setAttribute('aria-label', `${f.name}, ${r.label} ${f.type}`); // MapLibre replaces it with "Map marker"
  return m;
}
function refreshRanges() {
  for (const { spawn, marker } of st.markers.values()) marker.getElement().classList.toggle('near', World.inRange(H.cfg, st.pos, spawn, st.acc));
}
function tapSpawn(s) {
  const f = H.cfg.familiars[s.familiarId], r = H.rarityCfg(s.rarity);
  if (st.tooFast) return H.toast('You are moving too fast. Interactions pause above walking or jogging pace.');
  const d = Math.round(World.distanceM(st.pos, s));
  if (!World.inRange(H.cfg, st.pos, s, st.acc)) return H.toast(`${f.name} (${r.label}) is ${d} m away. Walk within ${H.cfg.world.interactRadiusM} m. Stay on paths and public places.`, r.color);
  const col = H.col();
  const enc = Col.registerWorldEncounter(col, World.toEncounter(H.cfg, s, Date.now()));
  if (!enc) { H.toast('That familiar is gone.'); scan(true); return; }
  H.saveCol();
  $('world').hidden = true;
  H.openBinding(enc.id, 'map');
}
export function returnToWorld() { $('world').hidden = false; st.open = true; scan(true); }

// Demo walking and periodic rescans
export function tickWorld(dt) {
  if (!st.open || !st.pos) return;
  if (st.demo && st.demoTarget) {
    const d = World.distanceM(st.pos, st.demoTarget), step = H.cfg.world.demoWalkMps * dt;
    if (d <= step) { setPosition(st.demoTarget.lat, st.demoTarget.lon, 5, false); st.demoTarget = null; }
    else { const k = step / d; setPosition(st.pos.lat + (st.demoTarget.lat - st.pos.lat) * k, st.pos.lon + (st.demoTarget.lon - st.pos.lon) * k, 5, false); }
  } else if (Date.now() - st.lastScan > 5000) scan(true);
}
