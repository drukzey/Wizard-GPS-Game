# Tomecraft Sanctuary island v2. Follows docs/sanctuary_design.md in the game repo.
# Blender -b --factory-startup -P build_island.py [-- preview]
#   out/sanctuary_island.fbx: Terrain (RGB = grass/dirt/rock weights), Cliff (vertex colours), Water, Stream, Falls, Islets, props
#   out/island_*.png: preview renders from the game's camera
# Axes: +Z up, -Y is the front (the game camera's side). The 24 x 24 m plot is centred and flat at z = 0.
import bpy, bmesh, math, os, random, sys
from mathutils import Vector, noise
K = '/Users/smoothief/Desktop/Assets/POLYGON_Fantasy_Kingdom_SourceFiles_v6'
TEX = f'{K}/Textures'
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'out'); os.makedirs(OUT, exist_ok=True)
PREVIEW = 'preview' in sys.argv
random.seed(11)
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
env = bpy.data.collections.new('Island'); scene.collection.children.link(env)
lib = bpy.data.collections.new('Lib'); scene.collection.children.link(lib)
show = bpy.data.collections.new('PreviewOnly'); scene.collection.children.link(show)

def sm(a, b, x): t = max(0.0, min(1.0, (x - a) / (b - a))); return t * t * (3 - 2 * t)
def nz(x, y, s=1.0, o=0.0): return noise.noise(Vector((x * s, y * s, o)))
R = 33.0
def rim(th): return R * (1 + 0.06 * nz(math.cos(th) * 2.2, math.sin(th) * 2.2, 0.3) + 0.025 * math.sin(th * 7))

# ---------- the plan: paths, features ----------
POND = Vector((21.0, -3.0)); POND_R = 4.6
HEARTH = Vector((0.0, 25.0)); GAZEBO = Vector((-22.0, 3.0)); LANDING = Vector((0.0, -29.5))
PATHS = [[(0, -30), (0, -13.6)], [(0, 13.6), (0, 19.5), (0, 22)], [(13.6, 0), (17.5, -1.8), (16.8, -2.6)], [(-13.6, 0), (-17.5, 1.6), (-19.2, 2.6)]]
STREAM = [(POND.x + POND_R - 0.6, -3.0), (27.5, -3.4), (rim(math.atan2(-3.6, 31)) - 0.3, -3.6)]
def seg_dist(px, py, a, b):
    ax, ay = a; bx, by = b; dx, dy = bx - ax, by - ay; L = dx * dx + dy * dy
    t = 0 if L == 0 else max(0, min(1, ((px - ax) * dx + (py - ay) * dy) / L)); return math.hypot(px - (ax + t * dx), py - (ay + t * dy))
def path_dist(x, y, lines=PATHS): return min(seg_dist(x, y, l[i], l[i + 1]) for l in lines for i in range(len(l) - 1))

def height(x, y):
    d = max(abs(x), abs(y)); out = sm(13.5, 18.0, d)
    ridge = 3.8 * sm(12.0, 30.0, y) * (0.85 + 0.15 * nz(x, y, 0.08, 2))
    roll = 1.1 * nz(x, y, 0.07, 1.7)
    h = out * (ridge + roll)
    h -= out * 2.5 * math.exp(-((x - POND.x) ** 2 + (y - POND.y) ** 2) / 20)            # the spring's hollow
    h -= 0.55 * math.exp(-(seg_dist(x, y, STREAM[0], STREAM[1]) if x < STREAM[1][0] else seg_dist(x, y, STREAM[1], STREAM[2])) ** 2 / 1.6) * sm(POND.x + 3, POND.x + 5, x)
    hd = math.hypot(x - HEARTH.x, y - HEARTH.y); hz = 3.8 * sm(12.0, 30.0, HEARTH.y) * 0.95
    h = h + (hz - h) * (1 - sm(5.5, 11.0, hd))                                              # the hearth's level crest
    ld = math.hypot(x - LANDING.x, y - LANDING.y); h = h + (0.15 - h) * (1 - sm(3.5, 6.0, ld)) # the arrival landing
    r, th = math.hypot(x, y), math.atan2(y, x)
    h -= 0.5 * sm(rim(th) - 1.8, rim(th), r)                                               # a soft lip before the cliff
    return h

# ---------- terrain: polar mesh so its outer ring is exactly the cliff's top ring ----------
NR, NS = 64, 192
def ring_pts(k):  # k-th ring, 0 = centre
    f = (k / NR) ** 0.85
    return [(math.cos(2 * math.pi * j / NS) * rim(2 * math.pi * j / NS) * f, math.sin(2 * math.pi * j / NS) * rim(2 * math.pi * j / NS) * f) for j in range(NS)]
bm = bmesh.new(); centre = bm.verts.new((0, 0, height(0, 0))); rings = []
for k in range(1, NR + 1): rings.append([bm.verts.new((x, y, height(x, y))) for x, y in ring_pts(k)])
for j in range(NS): bm.faces.new((centre, rings[0][j], rings[0][(j + 1) % NS]))
for a, b in zip(rings, rings[1:]):
    for j in range(NS): bm.faces.new((a[j], b[j], b[(j + 1) % NS], a[(j + 1) % NS]))
bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
rim_top = [v.co.copy() for v in rings[-1]]
me = bpy.data.meshes.new('Terrain'); bm.to_mesh(me); bm.free()
ter = bpy.data.objects.new('Terrain', me); env.objects.link(ter)
for f in me.polygons:
    if f.normal.z < 0: f.flip()
me.update()
# weights for the game's ground shader: R grass, G dirt, B rock
col = me.color_attributes.new('Col', 'BYTE_COLOR', 'CORNER')
me.calc_normals_split() if hasattr(me, 'calc_normals_split') else None
for poly in me.polygons:
    slope = 1 - poly.normal.z
    for li in poly.loop_indices:
        v = me.vertices[me.loops[li].vertex_index].co
        pd = path_dist(v.x, v.y)
        dirt = 1 - sm(0.9, 2.1, pd + 0.4 * nz(v.x, v.y, 0.6, 5))
        if max(abs(v.x), abs(v.y)) < 14.5: dirt = max(dirt, 0.18 + 0.12 * nz(v.x, v.y, 0.3, 8))   # the worn clearing
        dirt = max(dirt, 1 - sm(3.0, 5.5, math.hypot(v.x - HEARTH.x, v.y - HEARTH.y)))            # trodden hearth
        dirt = max(dirt, 1 - sm(2.5, 4.5, math.hypot(v.x - LANDING.x, v.y - LANDING.y)))
        dirt = max(dirt, (1 - sm(POND_R + 0.2, POND_R + 1.6, math.hypot(v.x - POND.x, v.y - POND.y))) * 0.8)  # muddy banks
        rock = sm(0.28, 0.45, slope) + sm(rim(math.atan2(v.y, v.x)) - 1.4, rim(math.atan2(v.y, v.x)), math.hypot(v.x, v.y))
        rock = min(1, rock); dirt = min(1 - rock, dirt); grass = max(0, 1 - rock - dirt)
        col.data[li].color = (grass, dirt, rock, 1.0)

# ---------- cliff: shares the rim, then layered strata tapering to a point ----------
bm = bmesh.new(); layers = [[bm.verts.new(p) for p in rim_top]]
DEPTHS = [(0.9, 1.0), (2.6, 0.985), (5.0, 0.93), (8.5, 0.82), (13.0, 0.64), (18.5, 0.44), (24.0, 0.26), (28.5, 0.12)]
for d, k in DEPTHS:
    ring = []
    for j, p in enumerate(rim_top):
        th = 2 * math.pi * j / NS; jit = 1 + 0.07 * nz(math.cos(th) * 3, math.sin(th) * 3, d * 0.3) + (0.04 if (j // 3) % 2 else -0.02)
        ring.append(bm.verts.new((p.x * k * jit, p.y * k * jit, p.z - d - 0.8 * nz(p.x, p.y, 0.2, d))))
    layers.append(ring)
tip = bm.verts.new((1.5, -1.0, rim_top[0].z - 33))
for a, b in zip(layers, layers[1:]):
    for j in range(NS): bm.faces.new((a[j], a[(j + 1) % NS], b[(j + 1) % NS], b[j]))
for j in range(NS): bm.faces.new((layers[-1][j], layers[-1][(j + 1) % NS], tip))
bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
me = bpy.data.meshes.new('Cliff'); bm.to_mesh(me); bm.free()
cliff = bpy.data.objects.new('Cliff', me); env.objects.link(cliff)
cc = me.color_attributes.new('Col', 'BYTE_COLOR', 'CORNER')
for poly in me.polygons:
    for li in poly.loop_indices:
        z = me.vertices[me.loops[li].vertex_index].co.z; t = sm(-1, -30, z); band = 0.07 * math.sin(z * 1.7) + 0.04 * math.sin(z * 4.3)
        c = [0.33 * (1 - t) + 0.13 * t, 0.28 * (1 - t) + 0.10 * t, 0.25 * (1 - t) + 0.20 * t]
        if z > -1.2: c = [0.30, 0.34, 0.20]   # a grassy overhang at the very top
        cc.data[li].color = (c[0] + band, c[1] + band, c[2] + band, 1)

# ---------- water: pond, stream, waterfall ----------
def disc(name, cx, cy, r, z, n=40):
    bm = bmesh.new(); vs = [bm.verts.new((cx + math.cos(2 * math.pi * i / n) * r, cy + math.sin(2 * math.pi * i / n) * r, z)) for i in range(n)]; bm.faces.new(vs)
    me = bpy.data.meshes.new(name); bm.to_mesh(me); bm.free(); o = bpy.data.objects.new(name, me); env.objects.link(o); return o
disc('Water', POND.x, POND.y, POND_R + 0.4, -1.15)
def strip(name, pts, w0, w1, zf):
    bm = bmesh.new(); L, R2 = [], []
    for i, (x, y) in enumerate(pts):
        a = pts[min(i + 1, len(pts) - 1)]; b = pts[max(i - 1, 0)]; dx, dy = a[0] - b[0], a[1] - b[1]; n = math.hypot(dx, dy) or 1; nx, ny = -dy / n, dx / n
        w = w0 + (w1 - w0) * i / (len(pts) - 1); z = zf(x, y)
        L.append(bm.verts.new((x + nx * w, y + ny * w, z))); R2.append(bm.verts.new((x - nx * w, y - ny * w, z)))
    for i in range(len(pts) - 1): bm.faces.new((L[i], R2[i], R2[i + 1], L[i + 1]))
    me = bpy.data.meshes.new(name); bm.to_mesh(me); bm.free(); o = bpy.data.objects.new(name, me); env.objects.link(o); return o
sp = []
for i in range(len(STREAM) - 1):
    for t in range(8): a, b = STREAM[i], STREAM[i + 1]; sp.append((a[0] + (b[0] - a[0]) * t / 8, a[1] + (b[1] - a[1]) * t / 8))
sp.append(STREAM[-1])
strip('WaterStream', sp, 0.7, 1.1, lambda x, y: height(x, y) + 0.12)
# the falls: a ribbon from the lip down the cliff face, widening as it drops
ex, ey = STREAM[-1]; ez = height(ex, ey); bm = bmesh.new(); prev = None; uv_v = []
for i in range(14):
    t = i / 13; z = ez + 0.1 - t * 26; out = 0.6 + t * 4.0 + 1.2 * t * t; w = 1.1 + t * 2.4
    a = bm.verts.new((ex + out, ey - w, z)); b = bm.verts.new((ex + out, ey + w, z)); uv_v.append(t)
    if prev: bm.faces.new((prev[0], prev[1], b, a))
    prev = (a, b)
me = bpy.data.meshes.new('Falls'); bm.to_mesh(me); bm.free(); falls = bpy.data.objects.new('Falls', me); env.objects.link(falls)
uv = me.uv_layers.new(name='UVMap')
for poly in me.polygons:
    for li in poly.loop_indices:
        v = me.vertices[me.loops[li].vertex_index].co; uv.data[li].uv = ((v.y - ey) / 7 + 0.5, (ez - v.z) / 26)

# ---------- props, with footprints that may not overlap ----------
cache = {}
def tpl(name):
    if name in cache: return cache[name]
    before = set(bpy.data.objects); bpy.ops.import_scene.fbx(filepath=f'{K}/FBX/{name}.fbx')
    new = [o for o in bpy.data.objects if o not in before]; meshes = [o for o in new if o.type == 'MESH']
    for o in new:
        for c in o.users_collection: c.objects.unlink(o)
        lib.objects.link(o)
    bpy.ops.object.select_all(action='DESELECT')
    for o in meshes: o.select_set(True)
    bpy.context.view_layer.objects.active = meshes[0]
    bpy.ops.object.parent_clear(type='CLEAR_KEEP_TRANSFORM'); bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
    if len(meshes) > 1: bpy.ops.object.join()
    m = bpy.context.view_layer.objects.active; m.name = 'T_' + name
    uvs = m.data.uv_layers; keep = next((u for u in uvs if u.active_render), uvs[0] if len(uvs) else None)
    for u in [u for u in uvs if u != keep]: uvs.remove(u)
    for o in new:
        if o != m and o.name in bpy.data.objects and o.type != 'MESH': bpy.data.objects.remove(o)
    lo = Vector((min(v.co[i] for v in m.data.vertices) for i in range(3))); hi = Vector((max(v.co[i] for v in m.data.vertices) for i in range(3)))
    cache[name] = (m, lo, hi); return m, lo, hi

occupied = []  # (x, y, r)
def free(x, y, r, paths=True):
    if max(abs(x), abs(y)) < 13.6 + r: return False
    if paths and path_dist(x, y) < 1.5 + r: return False
    if math.hypot(x - POND.x, y - POND.y) < POND_R + 0.6 + r: return False
    if x > POND.x and abs(y - STREAM[1][1]) < 1.6 + r: return False
    if math.hypot(x, y) > rim(math.atan2(y, x)) - 1.2 - r: return False
    return all(math.hypot(x - ox, y - oy) > r + orr for ox, oy, orr in occupied)
placed = 0
def put(name, x, y, h=None, w=None, rot=None, sink=0.0, z=None, check=True, pad=0.0, coll=None):
    global placed
    m, lo, hi = tpl(name); size = hi - lo
    k = h / max(1e-3, size.z) if h else (w / max(1e-3, max(size.x, size.y)) if w else 0.8)
    r = 0.5 * max(size.x, size.y) * k * 0.8 + pad
    if check and not free(x, y, r): return None
    o = bpy.data.objects.new(f'{name}.{placed}', m.data); (coll or env).objects.link(o); placed += 1
    o.scale = (k, k, k); o.rotation_euler.z = random.uniform(0, 6.283) if rot is None else rot
    c = Vector(((lo.x + hi.x) / 2, (lo.y + hi.y) / 2, 0)); c.rotate(o.rotation_euler)
    # stand on the lowest ground under the footprint so nothing floats on a slope
    gz = min(height(x + dx * r * 0.7, y + dy * r * 0.7) for dx, dy in [(0, 0), (1, 0), (-1, 0), (0, 1), (0, -1)]) if z is None else z
    o.location = (x - c.x * k, y - c.y * k, gz - lo.z * k - sink * size.z * k)
    if check or pad >= 0: occupied.append((x, y, r))
    return o
def face(x, y, tx, ty): return math.atan2(ty - y, tx - x) - math.pi / 2  # Synty props face -Y

def grove(cx, cy, names, n, sigma, big, small, under=None):
    # one large tree at the heart, smaller ones around it; undergrowth at their feet
    put(names[0], cx, cy, h=big, sink=0.04)
    tries = 0
    while n > 1 and tries < 60:
        tries += 1; a = random.uniform(0, 6.283); d = random.uniform(sigma * 0.6, sigma * 1.4)
        if put(random.choice(names), cx + math.cos(a) * d, cy + math.sin(a) * d, h=random.uniform(*small), sink=0.04): n -= 1
    for i in range(3 if under else 0):
        a = random.uniform(0, 6.283); put(random.choice(under), cx + math.cos(a) * sigma * 0.8, cy + math.sin(a) * sigma * 0.8, h=random.uniform(0.9, 1.5))

# 1. the Ley Hearth on the crest: standing stones in a ring around a brazier
put('SM_Prop_Camp_Brazier_01', HEARTH.x, HEARTH.y, h=1.3, rot=0, check=False)
for i in range(7):
    a = i / 7 * 2 * math.pi + 0.2; x, y = HEARTH.x + math.cos(a) * 4.4, HEARTH.y + math.sin(a) * 4.4
    if abs(math.degrees(a) % 360 - 270) < 25: continue   # the opening faces the north path
    put('SM_Env_StoneWall_Pillar_01', x, y, h=random.uniform(2.6, 3.4), rot=face(x, y, HEARTH.x, HEARTH.y), check=False, sink=0.06)
occupied.append((HEARTH.x, HEARTH.y, 5.6))
# 2. the ridge woods: pine groups framing the skyline behind the hearth
PINES = ['SM_Env_Tree_Pine_Cluster_01', 'SM_Env_Tree_Pine_Cluster_02', 'SM_Env_Tree_Thin_01']
for th in (52, 72, 108, 128, 146, 34):
    t = math.radians(th); rr = rim(t) * random.uniform(0.8, 0.88); grove(math.cos(t) * rr, math.sin(t) * rr, PINES, 6, 3.6, 13, (8, 11))
# 3. the garden (west): gazebo facing the path, a ring of flower beds, a bench, the well, ornamental trees
put('SM_Prop_Gazebo_01', GAZEBO.x, GAZEBO.y, h=4.6, rot=face(GAZEBO.x, GAZEBO.y, -13.6, 0), check=False); occupied.append((GAZEBO.x, GAZEBO.y, 3.4))
for i in range(6):
    a = math.radians(40 + i * 56); x, y = GAZEBO.x + math.cos(a) * 4.6, GAZEBO.y + math.sin(a) * 4.6
    put(['SM_Env_Bush_Flowers_01', 'SM_Env_Bush_Flowers_03', 'SM_Env_Bush_Flowers_05'][i % 3], x, y, h=1.2)
put('SM_Prop_Bench_Seat_01', -17.6, 5.2, h=1.0, rot=face(-17.6, 5.2, -17.6, 1.0))
put('SM_Prop_Well_01', -18.0, -7.5, h=2.4, rot=face(-18, -7.5, -13.6, 0))
ROUND = ['SM_Env_Tree_Round_01', 'SM_Env_Tree_Round_02', 'SM_Env_Tree_Round_03', 'SM_Env_Tree_Round_04']
grove(-25.5, -12.0, ROUND, 3, 3.2, 8.5, (5.5, 7), ['SM_Env_Bush_Cluster_01', 'SM_Env_Fern_01'])
grove(-25.0, 13.5, ROUND, 4, 3.4, 9, (6, 7.5), ['SM_Env_Bush_Cluster_03', 'SM_Env_Fern_03'])
# 4. the spring (east): reeds on the north and south banks, lilies, bank stones, willow-like thin trees
for i in range(12):
    a = math.radians(i * 30 + random.uniform(-6, 6))
    if -40 < math.degrees(a) % 360 - 360 < 40 or abs(math.degrees(a) - 180) < 30 or abs(math.degrees(a)) < 35: continue  # keep the outlet and the path side open
    put(random.choice(['SM_Env_Reeds_01', 'SM_Env_Reeds_02', 'SM_Env_Reeds_03']), POND.x + math.cos(a) * (POND_R + 0.4), POND.y + math.sin(a) * (POND_R + 0.4), h=random.uniform(1.0, 1.5), check=False)
for i in range(4): a = random.uniform(0, 6.283); d = random.uniform(1, 3.2); put(random.choice(['SM_Env_Lily_01', 'SM_Env_Lily_02']), POND.x + math.cos(a) * d, POND.y + math.sin(a) * d, w=0.9, z=-1.13, check=False)
for a in (60, 125, 235, 300): t = math.radians(a); put(random.choice(['SM_Env_Rock_01', 'SM_Env_Rock_02']), POND.x + math.cos(t) * (POND_R + 1.4), POND.y + math.sin(t) * (POND_R + 1.4), h=1.0, sink=0.3)
grove(25.0, 8.0, ['SM_Env_Tree_Thin_01', 'SM_Env_Tree_Thin_03', 'SM_Env_Tree_Round_02'], 3, 2.8, 8, (6, 7), ['SM_Env_Fern_01'])
grove(19.0, -13.0, ['SM_Env_Tree_Round_04', 'SM_Env_Tree_Thin_02'], 3, 2.8, 7.5, (5.5, 6.5), ['SM_Env_Bush_Cluster_01'])
# 5. the arrival: a stone landing at the edge, lanterns, a signpost
for i in range(9):  # a ring of flat stones marks the landing
    a = i / 9 * 2 * math.pi; put(random.choice(['SM_Env_Rock_01', 'SM_Env_Rock_03']), LANDING.x + math.cos(a) * 3.4, LANDING.y + math.sin(a) * 3.4, h=0.55, sink=0.35, check=False)
for x in (-2.8, 2.8): put('SM_Prop_Street_Lamp_01', x, LANDING.y + 2.2, h=3.2, rot=0, check=False)
put('SM_Prop_Direction_Sign_01', 2.4, -21.0, h=2.2, rot=face(2.4, -21, 0, -21))
# lanterns mark where each path leaves the clearing
for (x, y) in [(0, -14.6), (0, 14.6), (14.6, 0), (-14.6, 0)]:
    nx, ny = (1.7, 0) if x == 0 else (0, 1.7)
    for s in (-1, 1): put('SM_Prop_Camp_Lanturn_01', x + nx * s, y + ny * s, h=1.3, rot=0, check=False)
# 6. low framing in the foreground; boulders where the ridge rises
for x, y in [(-15, -21), (-22, -16), (15, -21), (23, -15), (-8, -24), (8, -24)]:
    put(random.choice(['SM_Env_Bush_Cluster_01', 'SM_Env_Bush_Cluster_03', 'SM_Env_Bush_Flowers_02']), x, y, h=random.uniform(1.0, 1.4))
for x, y in [(-9, 16.5), (10, 17), (-20, 18.5), (19, 19), (-4, 18)]: put(random.choice(['SM_Env_Rock_01', 'SM_Env_Rock_02', 'SM_Env_Rock_03']), x, y, h=random.uniform(1.2, 2.0), sink=0.3)
# path edging: small tufts and flowers every few metres, alternating sides
for line in PATHS:
    for i in range(len(line) - 1):
        (ax, ay), (bx, by) = line[i], line[i + 1]; L = math.hypot(bx - ax, by - ay)
        for d in range(2, int(L), 3):
            u = d / L; x, y = ax + (bx - ax) * u, ay + (by - ay) * u; nx, ny = -(by - ay) / L, (bx - ax) / L; s = 1 if d % 2 else -1
            put(random.choice(['SM_Env_Grass_Tuft_02', 'SM_Env_Flowers_03', 'SM_Env_Flowers_07']), x + nx * 1.6 * s, y + ny * 1.6 * s, h=0.35, check=False, pad=-1)
# a few rim boulders break the cliff silhouette (flush with the ground, leaning out)
for th in (15, 80, 160, 200, 250, 320):
    t = math.radians(th); rr = rim(t) - 0.4; x, y = math.cos(t) * rr, math.sin(t) * rr
    o = put(random.choice(['SM_Env_Rock_Cliff_01', 'SM_Env_Rock_Cliff_03']), x, y, h=4.0, rot=t + math.pi / 2, z=height(x, y) - 3.2, check=False)

# ---------- distant islets for depth (same construction, no props on their sides) ----------
for idx, (cx, cy, cz, s) in enumerate([(-54, 22, -8, 0.22), (50, 36, -14, 0.17), (-40, -46, -18, 0.15)]):
    bm = bmesh.new(); top = [bm.verts.new((cx + math.cos(2 * math.pi * j / 24) * R * s * (1 + 0.1 * random.random()), cy + math.sin(2 * math.pi * j / 24) * R * s * (1 + 0.1 * random.random()), cz)) for j in range(24)]
    c0 = bm.verts.new((cx, cy, cz + 0.2)); [bm.faces.new((c0, top[j], top[(j + 1) % 24])) for j in range(24)]
    prev = top
    for d, k in [(1.2, 0.95), (4, 0.7), (8, 0.4)]:
        ring = [bm.verts.new((cx + (v.co.x - cx) * k, cy + (v.co.y - cy) * k, cz - d * s * 4)) for v in top]
        for j in range(24): bm.faces.new((prev[j], prev[(j + 1) % 24], ring[(j + 1) % 24], ring[j]))
        prev = ring
    t2 = bm.verts.new((cx, cy, cz - 12 * s * 4)); [bm.faces.new((prev[j], prev[(j + 1) % 24], t2)) for j in range(24)]
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    me = bpy.data.meshes.new(f'Islet{idx}'); bm.to_mesh(me); bm.free(); o = bpy.data.objects.new(f'Islet{idx}', me); env.objects.link(o)
    ic = me.color_attributes.new('Col', 'BYTE_COLOR', 'CORNER')
    for poly in me.polygons:
        for li in poly.loop_indices: ic.data[li].color = ((0.24, 0.33, 0.17, 1) if poly.normal.z > 0.6 else (0.33, 0.27, 0.27, 1))
    put('SM_Env_Tree_Pine_Cluster_01', cx, cy, h=9 * s * 4, z=cz, check=False)

# ---------- export ----------
bpy.ops.object.select_all(action='DESELECT')
for o in env.objects: o.select_set(True)
bpy.ops.export_scene.fbx(filepath=os.path.join(OUT, 'sanctuary_island.fbx'), use_selection=True, object_types={'MESH'}, apply_unit_scale=True, mesh_smooth_type='FACE', add_leaf_bones=False, bake_anim=False)
print('EXPORTED', len(env.objects), 'objects,', len(occupied), 'footprints')

# ---------- previews ----------
if PREVIEW:
    def img(n): return bpy.data.images.load(f'{TEX}/{n}.png')
    atlas = img('PolygonFantasyKingdom_Texture_01_A')
    def mat_atlas():
        m = bpy.data.materials.new('Atlas'); m.use_nodes = True; n = m.node_tree.nodes; t = n.new('ShaderNodeTexImage'); t.image = atlas
        m.node_tree.links.new(t.outputs['Color'], n['Principled BSDF'].inputs['Base Color']); n['Principled BSDF'].inputs['Roughness'].default_value = 0.9; return m
    def mat_ground():
        m = bpy.data.materials.new('Ground'); m.use_nodes = True; nt = m.node_tree; n = nt.nodes; L = nt.links
        tc = n.new('ShaderNodeTexCoord'); mp = n.new('ShaderNodeMapping'); mp.inputs['Scale'].default_value = (0.12, 0.12, 0.12); L.new(tc.outputs['Object'], mp.inputs['Vector'])
        tx = {}
        for k, f in [('g', 'PFK_Texture_Ground_Grass_03'), ('d', 'PFK_Texture_Ground_Mud_02'), ('r', 'PFK_Texture_Ground_Sand_03')]:
            t = n.new('ShaderNodeTexImage'); t.image = img(f); L.new(mp.outputs['Vector'], t.inputs['Vector']); tx[k] = t
        va = n.new('ShaderNodeVertexColor'); va.layer_name = 'Col'; sep = n.new('ShaderNodeSeparateColor'); L.new(va.outputs['Color'], sep.inputs['Color'])
        m1 = n.new('ShaderNodeMix'); m1.data_type = 'RGBA'; L.new(sep.outputs['Green'], m1.inputs['Factor']); L.new(tx['g'].outputs['Color'], m1.inputs['A']); L.new(tx['d'].outputs['Color'], m1.inputs['B'])
        m2 = n.new('ShaderNodeMix'); m2.data_type = 'RGBA'; L.new(sep.outputs['Blue'], m2.inputs['Factor']); L.new(m1.outputs['Result'], m2.inputs['A']); L.new(tx['r'].outputs['Color'], m2.inputs['B'])
        L.new(m2.outputs['Result'], n['Principled BSDF'].inputs['Base Color']); n['Principled BSDF'].inputs['Roughness'].default_value = 0.95; return m
    def mat_vcol():
        m = bpy.data.materials.new('VCol'); m.use_nodes = True; n = m.node_tree.nodes; a = n.new('ShaderNodeVertexColor'); a.layer_name = 'Col'
        m.node_tree.links.new(a.outputs['Color'], n['Principled BSDF'].inputs['Base Color']); return m
    MA, MG, MV = mat_atlas(), mat_ground(), mat_vcol()
    mw = bpy.data.materials.new('Water'); mw.use_nodes = True; mw.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (0.12, 0.40, 0.52, 1)
    for o in env.objects:
        o.data.materials.clear()
        o.data.materials.append(MG if o.name == 'Terrain' else mw if o.name.startswith(('Water', 'Falls')) else MV if o.name.startswith(('Cliff', 'Islet')) else MA)
    for nm, (x, y) in {'SM_Bld_Preset_Hut_01_Optimized': (-7, 7), 'SM_Bld_Preset_House_08_Optimized': (7, 7), 'SM_Bld_Preset_House_03_Optimized': (-7, -7), 'SM_Bld_Preset_House_04_Optimized': (7, -7)}.items():
        o = put(nm, x, y, w=7.2, rot=face(x, y, 0, 0), z=0, check=False, coll=show); o.data.materials.clear(); o.data.materials.append(MA)
    w = bpy.data.worlds.new('Sky'); scene.world = w; w.use_nodes = True; bg = w.node_tree.nodes['Background']; bg.inputs['Color'].default_value = (0.16, 0.13, 0.28, 1); bg.inputs['Strength'].default_value = 0.8
    sun = bpy.data.objects.new('Sun', bpy.data.lights.new('Sun', 'SUN')); scene.collection.objects.link(sun); sun.data.energy = 3.0; sun.data.color = (1, 0.86, 0.72); sun.rotation_euler = (math.radians(52), 0, math.radians(30))
    cam = bpy.data.objects.new('Cam', bpy.data.cameras.new('Cam')); scene.collection.objects.link(cam); scene.camera = cam; cam.data.lens = 28
    scene.render.engine = 'BLENDER_EEVEE'; scene.render.resolution_x, scene.render.resolution_y = 1200, 800
    for tag, loc, tgt in [('front', (0, -62, 40), (0, 4, -2)), ('side', (-60, -34, 30), (0, 2, -4)), ('low', (42, -46, 6), (0, 0, -6))]:
        cam.location = loc; d = Vector(tgt) - Vector(loc); cam.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()
        scene.render.filepath = os.path.join(OUT, f'island_{tag}.png'); bpy.ops.render.render(write_still=True)
    print('RENDERED')
