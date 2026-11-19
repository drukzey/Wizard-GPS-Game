# Tomecraft custom wizard animations, built on the Synty animation rig (same rig as Anim1-3 packs).
# Run: Blender -b --factory-startup -P make_anims.py   -> writes out/*.fbx and out/*.png previews
import bpy, math, os
from mathutils import Vector
A3 = '/Users/smoothief/Desktop/Assets/Anim3/Animations/Polygon/Masculine'
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'out'); os.makedirs(OUT, exist_ok=True)
FPS = 30

def load(path):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.fbx(filepath=path)
    arm = [o for o in bpy.data.objects if o.type == 'ARMATURE'][0]
    act = arm.animation_data.action
    return arm, act

def hips_at(arm, f):
    bpy.context.scene.frame_set(f); return arm.matrix_world @ arm.pose.bones['Hips'].head

def ik(arm, bone, name, pole):
    t = bpy.data.objects.new(name, None); bpy.context.collection.objects.link(t)
    p = bpy.data.objects.new(name + '_pole', None); bpy.context.collection.objects.link(p); p.location = pole
    c = arm.pose.bones[bone].constraints.new('IK'); c.target = t; c.pole_target = p; c.chain_count = 2; c.pole_angle = -math.pi / 2
    return t, c

def key_targets(arm, f0, f1, tracks):
    """tracks: {empty: fn(frame, hips)->Vector world target or None to leave IK off}"""
    for f in range(f0, f1 + 1):
        h = hips_at(arm, f)
        for (e, c), fn in tracks.items():
            v = fn(f, h)
            c.influence = 0.0 if v is None else 1.0; c.keyframe_insert('influence', frame=f)
            if v is not None: e.location = v; e.keyframe_insert('location', frame=f)

def wrist(arm, bone, f0, f1, fn):
    """fn(frame)->(x,y,z) extra euler on the hand, layered on the base pose"""
    pb = arm.pose.bones[bone]; pb.rotation_mode = 'XYZ'
    # read base quaternion keys are on the action; add a Transform constraint-free offset by keying a delta in a second action is complex,
    # so use a Rotation constraint offset instead: limit-free 'Transformation' is overkill -> use 'CHILD_OF' none; keep simple: rotate via constraint
    c = pb.constraints.new('TRANSFORM'); c.target = None

def bake_export(arm, name, f0, f1):
    sc = bpy.context.scene; sc.frame_start, sc.frame_end = f0, f1; sc.render.fps = FPS
    bpy.context.view_layer.objects.active = arm; arm.select_set(True)
    bpy.ops.object.mode_set(mode='POSE'); bpy.ops.pose.select_all(action='SELECT')
    bpy.ops.nla.bake(frame_start=f0, frame_end=f1, only_selected=False, visual_keying=True, clear_constraints=True, use_current_action=False, bake_types={'POSE'})
    bpy.ops.object.mode_set(mode='OBJECT')
    arm.animation_data.action.name = name
    for o in list(bpy.data.objects):
        if o.type == 'EMPTY': bpy.data.objects.remove(o)
    bpy.ops.export_scene.fbx(filepath=os.path.join(OUT, f'{name}.fbx'), object_types={'ARMATURE'}, use_selection=False, add_leaf_bones=False,
                             bake_anim=True, bake_anim_use_all_actions=False, bake_anim_use_nla_strips=False, bake_anim_force_startend_keying=True,
                             bake_anim_simplify_factor=0.0)

# The character faces -Y; its right side is -X. Positions are metres, relative to the hips each frame.
HOLD_R = Vector((-0.27, -0.16, 0.10))      # staff hand: beside the hip, forearm forward
POLE_R = Vector((-0.9, 0.6, 1.0))
POLE_L = Vector((0.9, 0.6, 1.0))

def lerp(a, b, t): return a + (b - a) * max(0.0, min(1.0, t))
def ease(t): t = max(0.0, min(1.0, t)); return t * t * (3 - 2 * t)
def keys(frames, f):
    """frames: [(frame, Vector)] -> eased interpolation"""
    for (fa, va), (fb, vb) in zip(frames, frames[1:]):
        if fa <= f <= fb: return lerp(va, vb, ease((f - fa) / max(1, fb - fa)))
    return frames[-1][1] if f > frames[-1][0] else frames[0][1]

# 1. staffIdle: the standing idle with the right hand gripping the staff at the hip
arm, act = load(f'{A3}/Idle/A_Idle_Standing_Masc.fbx'); f0, f1 = map(int, act.frame_range)
r = ik(arm, 'Hand_R', 'tR', POLE_R)
key_targets(arm, f0, f1, {r: lambda f, h: h + HOLD_R})
bake_export(arm, 'staffIdle', f0, f1)

# 2. staffWalk: the walk with the staff hand held steady (a little bob with the hips)
arm, act = load(f'{A3}/Locomotion/Walk/A_Walk_F_Masc.fbx'); f0, f1 = map(int, act.frame_range)
r = ik(arm, 'Hand_R', 'tR', POLE_R)
key_targets(arm, f0, f1, {r: lambda f, h: h + HOLD_R + Vector((0, -0.03 * math.sin((f - f0) / (f1 - f0) * 4 * math.pi), 0))})
bake_export(arm, 'staffWalk', f0, f1)

# 3. staffCast: raise the staff, then thrust it forward while the free hand pushes out (0.7 s)
arm, act = load(f'{A3}/Idle/A_Idle_Standing_Masc.fbx'); f0 = int(act.frame_range[0]); f1 = f0 + 21
R = [(f0, HOLD_R), (f0 + 6, Vector((-0.24, -0.05, 0.62))), (f0 + 11, Vector((-0.18, -0.55, 0.48))), (f0 + 15, Vector((-0.18, -0.52, 0.45))), (f1, HOLD_R)]
L = [(f0, None), (f0 + 5, Vector((0.25, -0.15, 0.35))), (f0 + 11, Vector((0.12, -0.55, 0.50))), (f0 + 16, Vector((0.14, -0.50, 0.46))), (f1, None)]
r = ik(arm, 'Hand_R', 'tR', POLE_R); l = ik(arm, 'Hand_L', 'tL', POLE_L)
def lkey(f, h):
    if f <= L[0][0] or f >= L[-1][0]: return None
    pts = [(L[0][0], L[1][1] * 0 + Vector((0.32, 0.0, -0.05))), *L[1:-1], (L[-1][0], Vector((0.32, 0.0, -0.05)))]
    return h + keys(pts, f)
key_targets(arm, f0, f1, {r: lambda f, h: h + keys(R, f), l: lkey})
bake_export(arm, 'staffCast', f0, f1)

# 4. channel: both hands raised and reaching, a slow pulse (loop, 2 s) - used when calling a familiar or drawing on a shrine
arm, act = load(f'{A3}/Idle/A_Idle_Standing_Masc.fbx'); f0 = int(act.frame_range[0]); f1 = f0 + 60
r = ik(arm, 'Hand_R', 'tR', POLE_R); l = ik(arm, 'Hand_L', 'tL', POLE_L)
def ch(side):
    def fn(f, h):
        s = math.sin((f - f0) / 60 * 2 * math.pi)
        base = Vector((-0.22 if side == 'R' else 0.22, -0.42, 0.52 + 0.04 * s))
        if side == 'R': base = lerp(h + HOLD_R, h + base, ease(min(1, (f - f0) / 8))) - h
        return h + base
    return fn
key_targets(arm, f0, f1, {r: ch('R'), l: ch('L')})
bake_export(arm, 'channel', f0, f1)
print('DONE', sorted(os.listdir(OUT)))
