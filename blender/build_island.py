# Tomecraft Sanctuary island: sculpted terrain + Synty Fantasy Kingdom set dressing, exported for the game.
# Blender -b --factory-startup -P build_island.py [-- preview]
#   out/sanctuary_island.fbx   terrain (vertex colours), underside, water, and every scenery prop
#   out/island_*.png           preview renders from the game's camera angles
# Blender axes: +Z up, the game camera looks from -Y toward +Y. The 24 x 24 m build plot is centred and flat at z = 0.
import bpy, bmesh, math, os, random, sys
from mathutils import Vector, noise
K = '/Users/smoothief/Desktop/Assets/POLYGON_Fantasy_Kingdom_SourceFiles_v6'
ATLAS = f'{K}/Textures/PolygonFantasyKingdom_Texture_01_A.png'
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'out'); os.makedirs(OUT, exist_ok=True)
PREVIEW = 'preview' in sys.argv
random.seed(7)
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
env = bpy.data.collections.new('Island'); scene.collection.children.link(env)
lib = bpy.data.collections.new('Lib'); scene.collection.children.link(lib)
show = bpy.data.collections.new('PreviewOnly'); scene.collection.children.link(show)

def smooth(a, b, x): t = max(0.0, min(1.0, (x - a) / (b - a))); return t * t * (3 - 2 * t)
R = 34.0
def rim(theta): return R * (1 + 0.07 * noise.noise(Vector((math.cos(theta) * 2.1, math.sin(theta) * 2.1, 0.3))))
POND = Vector((21.0, -5.0)); BIGTREE = Vector((0.0, 25.0))
def height(x, y):
    d = max(abs(x), abs(y)); out = smooth(13.5, 19.0, d)
    hills = (noise.noise(Vector((x * 0.07, y * 0.07, 1.7))) * 0.5 + 0.5) * 2.4 + max(0.0, y - 6) * 0.11
    knoll = 1.6 * math.exp(-((x - BIGTREE.x) ** 2 + (y - BIGTREE.y) ** 2) / 50)
    pond = -2.2 * math.exp(-((x - POND.x) ** 2 + (y - POND.y) ** 2) / 26)
    r, th = math.hypot(x, y), math.atan2(y, x)
    edge = -1.2 * smooth(rim(th) * 0.86, rim(th), r)
    return out * (hills + knoll + pond) + edge

# ---------- terrain ----------
bpy.ops.mesh.primitive_grid_add(x_subdivisions=150, y_subdivisions=150, size=2 * R + 8)
ter = bpy.context.object; ter.name = 'Terrain'
bm = bmesh.new(); bm.from_mesh(ter.data)
kill = [v for v in bm.verts if math.hypot(v.co.x, v.co.y) > rim(math.atan2(v.co.y, v.co.x))]
bmesh.ops.delete(bm, geom=kill, context='VERTS')
for v in bm.verts: v.co.z = height(v.co.x, v.co.y)
edges = [e for e in bm.edges if e.is_boundary]
ext = bmesh.ops.extrude_edge_only(bm, edges=edges)
for v in [g for g in ext['geom'] if isinstance(g, bmesh.types.BMVert)]: v.co.z -= 1.6 + random.random() * 0.8; v.co.xy *= 0.985
bm.to_mesh(ter.data); bm.free()
# vertex colours: meadow greens, sun-bleached hilltops, worn plot, dark pond bed, rock on the skirt
col = ter.data.color_attributes.new('Col', 'BYTE_COLOR', 'CORNER')
def lerp3(a, b, t): return tuple(a[i] + (b[i] - a[i]) * t for i in range(3))
GRASS, GRASS2, DRY, WORN, ROCK, MUD = (0.24, 0.36, 0.15), (0.17, 0.30, 0.13), (0.42, 0.45, 0.20), (0.33, 0.36, 0.18), (0.34, 0.29, 0.25), (0.20, 0.17, 0.12)
for poly in ter.data.polygons:
    for li in poly.loop_indices:
        v = ter.data.vertices[ter.data.loops[li].vertex_index].co
        n = noise.noise(Vector((v.x * 0.25, v.y * 0.25, 4.0))) * 0.5 + 0.5
        c = lerp3(GRASS2, GRASS, n)
        c = lerp3(c, DRY, smooth(1.8, 4.0, v.z) * 0.6)
        if max(abs(v.x), abs(v.y)) < 13: c = lerp3(c, WORN, 0.35)
        c = lerp3(c, MUD, smooth(-0.6, -1.6, v.z))
        if poly.normal.z < 0.55 or v.z < -1.5: c = ROCK
        col.data[li].color = (*c, 1.0)
ter.data.shade_flat() if hasattr(ter.data, 'shade_flat') else None
env.objects.link(ter); scene.collection.objects.unlink(ter)

# underside: a jagged inverted cone of layered rock, darker and violet toward the tip
bm = bmesh.new(); rings = []
for i, (z, k) in enumerate([(-1.4, 0.99), (-4, 0.93), (-8, 0.78), (-13, 0.58), (-19, 0.36), (-25, 0.16)]):
    ring = []
    for j in range(48):
        th = j / 48 * 2 * math.pi; rr = rim(th) * k * (1 + (random.random() - 0.5) * 0.12)
        ring.append(bm.verts.new((math.cos(th) * rr, math.sin(th) * rr, z + (random.random() - 0.5) * 1.6 * (i > 0))))
    rings.append(ring)
tip = bm.verts.new((random.random() * 2, random.random() * 2, -31))
for a, b in zip(rings, rings[1:]):
    for j in range(48): bm.faces.new((a[j], a[(j + 1) % 48], b[(j + 1) % 48], b[j]))
for j in range(48): bm.faces.new((rings[-1][j], rings[-1][(j + 1) % 48], tip))
bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
me = bpy.data.meshes.new('Underside'); bm.to_mesh(me); bm.free()
und = bpy.data.objects.new('Underside', me); env.objects.link(und)
uc = me.color_attributes.new('Col', 'BYTE_COLOR', 'CORNER')
for poly in me.polygons:
    for li in poly.loop_indices:
        z = me.vertices[me.loops[li].vertex_index].co.z; t = smooth(-2, -28, z)
        c = lerp3((0.36, 0.30, 0.26), (0.16, 0.12, 0.22), t)
        strata = 0.06 * math.sin(z * 2.3); uc.data[li].color = (c[0] + strata, c[1] + strata, c[2] + strata, 1)

# water: the pond surface
bpy.ops.mesh.primitive_circle_add(vertices=40, radius=4.6, fill_type='NGON', location=(POND.x, POND.y, -0.75))
wat = bpy.context.object; wat.name = 'Water'; env.objects.link(wat); scene.collection.objects.unlink(wat)

# ---------- Synty props ----------
cache = {}
def tpl(name):
    if name in cache: return cache[name]
    before = set(bpy.data.objects)
    bpy.ops.import_scene.fbx(filepath=f'{K}/FBX/{name}.fbx')
    new = [o for o in bpy.data.objects if o not in before]
    meshes = [o for o in new if o.type == 'MESH']
    for o in new:
        for c in o.users_collection: c.objects.unlink(o)
        lib.objects.link(o)
    bpy.ops.object.select_all(action='DESELECT')
    for o in meshes: o.select_set(True)
    bpy.context.view_layer.objects.active = meshes[0]
    bpy.ops.object.parent_clear(type='CLEAR_KEEP_TRANSFORM')
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
    if len(meshes) > 1: bpy.ops.object.join()
    m = bpy.context.view_layer.objects.active; m.name = 'T_' + name
    uvs = m.data.uv_layers  # keep only the colour-atlas UVs: a second (lightmap) channel can come first in the export and turn leaves purple
    keep = next((u for u in uvs if u.active_render), uvs[0] if len(uvs) else None)
    for u in [u for u in uvs if u != keep]: uvs.remove(u)
    for o in new:
        if o != m and o.name in bpy.data.objects and o.type != 'MESH': bpy.data.objects.remove(o)
    lo = Vector((min(v.co[i] for v in m.data.vertices) for i in range(3))); hi = Vector((max(v.co[i] for v in m.data.vertices) for i in range(3)))
    cache[name] = (m, lo, hi); return cache[name]

placed = []
def put(name, x, y, h=None, w=None, rot=None, sink=0.0, coll=env, z=None, keep=1.0):
    """Place a copy of a Synty mesh standing on the terrain. h/w: target height/width in metres (keep: share of the asset's own scale)."""
    m, lo, hi = tpl(name); size = hi - lo
    k = h / max(1e-3, size.z) if h else (w / max(1e-3, max(size.x, size.y)) if w else keep)
    o = bpy.data.objects.new(f'{name}.{len(placed)}', m.data); coll.objects.link(o)
    o.scale = (k, k, k); o.rotation_euler.z = random.random() * 6.283 if rot is None else rot
    gz = height(x, y) if z is None else z
    c = Vector(((lo.x + hi.x) / 2, (lo.y + hi.y) / 2, 0)); c.rotate(o.rotation_euler)
    o.location = (x - c.x * k, y - c.y * k, gz - lo.z * k - sink * size.z * k); placed.append(o); return o

def ring_scatter(names, n, r0, r1, a0=0, a1=2 * math.pi, h=(5, 8), avoid=(), sink=0.05, jitter=0.35):
    for i in range(n):
        th = a0 + (a1 - a0) * (i + 0.5 + (random.random() - 0.5) * jitter) / n
        rr = r0 + random.random() * (r1 - r0); x, y = math.cos(th) * rr, math.sin(th) * rr
        if any(math.hypot(x - ax, y - ay) < ar for ax, ay, ar in avoid): continue
        put(random.choice(names), x, y, h=random.uniform(*h), sink=sink)

AVOID = [(POND.x, POND.y, 7), (BIGTREE.x, BIGTREE.y, 7), (0, -R, 9)]  # pond, the great tree, the front approach
# the great tree with fairy houses: the landmark behind the plot
put('SM_Bld_House_Observatory_01', BIGTREE.x, BIGTREE.y, h=11, rot=math.pi, sink=0.03)  # the stargazer's observatory crowns the knoll behind the plot
for a in (0.3, 2.2, 4.1): put('SM_Prop_Crystal_01', BIGTREE.x + 5.5 * math.cos(a), BIGTREE.y + 5.5 * math.sin(a), h=1.6 + random.random())
# woodland ring: pines at the back, broadleaf trees at the sides, thinner toward the front so the camera sees in
ring_scatter(['SM_Env_Tree_Pine_Cluster_01', 'SM_Env_Tree_Pine_Cluster_02', 'SM_Env_Tree_Pine_Cluster_04'], 9, R * 0.74, R * 0.9, math.radians(35), math.radians(145), h=(9, 13), avoid=AVOID)
ring_scatter(['SM_Env_Tree_Round_01', 'SM_Env_Tree_Round_02', 'SM_Env_Tree_Round_03', 'SM_Env_Tree_Large_01'], 8, R * 0.62, R * 0.86, math.radians(150), math.radians(250), h=(6, 9), avoid=AVOID)
ring_scatter(['SM_Env_Tree_Round_04', 'SM_Env_Tree_Thin_01', 'SM_Env_Tree_Thin_03', 'SM_Env_Tree_Large_02'], 7, R * 0.62, R * 0.86, math.radians(-70), math.radians(30), h=(6, 9), avoid=AVOID)
ring_scatter(['SM_Env_Tree_Thin_02', 'SM_Env_Tree_Thin_05'], 4, R * 0.8, R * 0.92, math.radians(250), math.radians(290), h=(5, 7), avoid=AVOID)
# undergrowth in clusters (never single props sprinkled evenly)
for cx, cy in [(-20, 10), (-24, -12), (17, 18), (25, 8), (-15, 22), (12, -22), (-12, -24), (26, -16)]:
    if any(math.hypot(cx - ax, cy - ay) < ar for ax, ay, ar in AVOID): continue
    for k in range(5):
        x, y = cx + random.gauss(0, 2.2), cy + random.gauss(0, 2.2)
        put(random.choice(['SM_Env_Bush_Cluster_01', 'SM_Env_Bush_Cluster_03', 'SM_Env_Bush_Flowers_02', 'SM_Env_Bush_Flowers_04', 'SM_Env_Fern_01', 'SM_Env_Fern_03']), x, y, h=random.uniform(0.8, 1.6))
    for k in range(4): put(random.choice(['SM_Env_Flowers_03', 'SM_Env_Flowers_07', 'SM_Env_Flowers_12', 'SM_Env_Grass_Tuft_02']), cx + random.gauss(0, 3), cy + random.gauss(0, 3), h=random.uniform(0.3, 0.6))
# rocks: big cliff faces on the rim, boulders in the meadow
for i in range(22):
    th = i / 22 * 2 * math.pi + random.random() * 0.15; rr = rim(th) * 0.97
    o = put(random.choice(['SM_Env_Rock_Cliff_01', 'SM_Env_Rock_Cliff_02', 'SM_Env_Rock_Cliff_03', 'SM_Env_Rock_Cliff_05']), math.cos(th) * rr, math.sin(th) * rr, h=random.uniform(3.5, 6), rot=th + math.pi / 2, z=-2.8)
for x, y in [(-17, 4), (19, 11), (-9, 18), (15, -15), (-27, 2), (8, 21)]: put(random.choice(['SM_Env_Rock_01', 'SM_Env_Rock_02', 'SM_Env_Rock_03']), x, y, h=random.uniform(1.0, 2.2), sink=0.25)
# the pond: reeds, lilies, stones, and a stream that tumbles over the edge as a waterfall
for i in range(9):
    th = i / 9 * 2 * math.pi; put(random.choice(['SM_Env_Reeds_01', 'SM_Env_Reeds_02', 'SM_Env_Reeds_03']), POND.x + 4.9 * math.cos(th), POND.y + 4.9 * math.sin(th), h=random.uniform(0.9, 1.5))
for i in range(4): put(random.choice(['SM_Env_Lily_01', 'SM_Env_Lily_02']), POND.x + random.gauss(0, 1.8), POND.y + random.gauss(0, 1.8), z=-0.73, w=0.9)
wf = put('SM_Env_Water_Slope_01', R * 0.99, POND.y, w=4.5, rot=0, z=-3.5)
# put('SM_Env_Bridge_Stone_01', POND.x - 6.2, POND.y + 1, w=5.5, rot=math.pi / 2)
# the approach: a stone arch on the front edge, a lantern-lined path to the plot, a statue and a gazebo to either side
put('SM_Bld_House_StoneArch_01', 0, -24.5, h=4.6, rot=0)
for i, y in enumerate([-22, -19, -16]):
    put('SM_Env_Path_Brick_Group_02', 0, y, w=3.4, rot=0, z=height(0, y) + 0.02)
    put('SM_Prop_Street_Lamp_01', -2.4 if i % 2 == 0 else 2.4, y + 0.5, h=3.4, rot=0)
put('SM_Prop_Statue_Plinth_02', -17, -15, h=1.2, rot=0.6); put('SM_Prop_Statue_Angel_01', -17, -15, h=3.2, rot=0.6, z=height(-17, -15) + 1.1)
put('SM_Prop_Gazebo_01', -22, 0, h=5.2, rot=math.pi / 2)
put('SM_Prop_Well_01', 18, 15, h=2.6, rot=-0.8)
# flowering bushes mark the plot corners (the open sides stay clear for walking in)
for cx, cy in [(-13.5, -13.5), (13.5, -13.5), (-13.5, 13.5), (13.5, 13.5)]:
    for k in range(3): put(random.choice(['SM_Env_Bush_Flowers_01', 'SM_Env_Bush_Flowers_03', 'SM_Env_Bush_Flowers_05']), cx + random.gauss(0, 0.9), cy + random.gauss(0, 0.9), h=random.uniform(1.0, 1.5))
# small floating islets around the main island for depth
for cx, cy, cz, s in [(-52, 18, -6, 1.0), (46, 34, -12, 0.8), (-34, -44, -16, 0.7), (58, -20, -3, 0.6)]:
    bpy.ops.mesh.primitive_cone_add(vertices=9, radius1=6 * s, depth=10 * s, location=(cx, cy, cz - 5 * s), rotation=(math.pi, 0, random.random()))
    c = bpy.context.object; c.name = 'Islet'; env.objects.link(c); scene.collection.objects.unlink(c)
    bpy.ops.object.select_all(action='DESELECT'); c.select_set(True); bpy.context.view_layer.objects.active = c
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=False)
    for v in c.data.vertices:
        if v.co.z < 4 * s: v.co.x += random.uniform(-1, 1) * s; v.co.y += random.uniform(-1, 1) * s
    c.data.update()
    ic = c.data.color_attributes.new('Col', 'BYTE_COLOR', 'CORNER')
    for poly in c.data.polygons:
        for li in poly.loop_indices: ic.data[li].color = (*(GRASS if poly.normal.z > 0.7 else (0.30, 0.25, 0.26)), 1)
    put(random.choice(['SM_Env_Tree_Pine_Cluster_01', 'SM_Env_Tree_Round_02']), cx, cy, h=8 * s, z=cz)
    put('SM_Env_Rock_02', cx + 2 * s, cy - 1 * s, h=1.4 * s, z=cz)

# ---------- export ----------
bpy.ops.object.select_all(action='DESELECT')
for o in env.objects: o.select_set(True)
bpy.ops.export_scene.fbx(filepath=os.path.join(OUT, 'sanctuary_island.fbx'), use_selection=True, object_types={'MESH'}, apply_unit_scale=True,
                         mesh_smooth_type='FACE', use_mesh_modifiers=True, add_leaf_bones=False, bake_anim=False)
print('EXPORTED', len(env.objects), 'objects')

# ---------- previews from the game's camera ----------
if PREVIEW:
    atlas = bpy.data.images.load(ATLAS)
    def mat_tex():
        m = bpy.data.materials.new('Atlas'); m.use_nodes = True; n = m.node_tree.nodes
        t = n.new('ShaderNodeTexImage'); t.image = atlas; t.interpolation = 'Closest'
        m.node_tree.links.new(t.outputs['Color'], n['Principled BSDF'].inputs['Base Color']); n['Principled BSDF'].inputs['Roughness'].default_value = 0.9; return m
    def mat_col():
        m = bpy.data.materials.new('VCol'); m.use_nodes = True; n = m.node_tree.nodes
        a = n.new('ShaderNodeVertexColor'); a.layer_name = 'Col'
        m.node_tree.links.new(a.outputs['Color'], n['Principled BSDF'].inputs['Base Color']); n['Principled BSDF'].inputs['Roughness'].default_value = 0.95; return m
    MT, MC = mat_tex(), mat_col()
    mw = bpy.data.materials.new('Water'); mw.use_nodes = True; mw.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (0.08, 0.32, 0.42, 1)
    for o in list(env.objects) + list(show.objects):
        o.data.materials.clear(); o.data.materials.append(MW if False else (mw if o.name.startswith('Water') or 'Water_Slope' in o.name else (MC if o.data.color_attributes.get('Col') else MT)))
    # stand-in buildings where the four facilities sit, for judging scale only
    for nm, (x, y) in {'SM_Bld_Preset_House_04_Optimized': (-7, 7), 'SM_Bld_Preset_House_05_Optimized': (7, 7), 'SM_Bld_Preset_Blacksmith_01_Optimized': (-7, -7), 'SM_Bld_Preset_Tower_01_Optimized': (7, -7)}.items():
        o = put(nm, x, y, w=7.2, rot=math.atan2(-y, -x) + math.pi / 2, coll=show, z=0); o.data.materials.clear(); o.data.materials.append(MT)
    w = bpy.data.worlds.new('Sky'); scene.world = w; w.use_nodes = True; bg = w.node_tree.nodes['Background']
    bg.inputs['Color'].default_value = (0.20, 0.17, 0.32, 1); bg.inputs['Strength'].default_value = 0.9
    sun = bpy.data.objects.new('Sun', bpy.data.lights.new('Sun', 'SUN')); scene.collection.objects.link(sun)
    sun.data.energy = 3.2; sun.data.color = (1.0, 0.85, 0.7); sun.rotation_euler = (math.radians(50), 0, math.radians(35))
    cam = bpy.data.objects.new('Cam', bpy.data.cameras.new('Cam')); scene.collection.objects.link(cam); scene.camera = cam
    cam.data.lens = 28
    for eng in ('BLENDER_EEVEE', 'BLENDER_EEVEE_NEXT', 'BLENDER_WORKBENCH'):
        try: scene.render.engine = eng; break
        except Exception: pass
    scene.render.resolution_x, scene.render.resolution_y = 1200, 800; scene.render.film_transparent = False
    for tag, loc, tgt in [('front', (0, -62, 38), (0, 2, -2)), ('side', (-58, -30, 30), (0, 2, -2)), ('phone', (0, -52, 46), (0, 4, -4))]:
        cam.location = loc; d = Vector(tgt) - Vector(loc); cam.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()
        if tag == 'phone': scene.render.resolution_x, scene.render.resolution_y = 600, 1000
        scene.render.filepath = os.path.join(OUT, f'island_{tag}.png'); bpy.ops.render.render(write_still=True)
    print('RENDERED', scene.render.engine)
