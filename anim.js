// Runtime animation retargeting: Synty POLYGON animation packs (new rig) -> older Synty character rig.
// Each character gets a hidden copy of the animation rig with its own AnimationMixer; every frame the rig's
// bone rotations are transferred onto the character's bones (rest-pose corrected, facing aligned).
import * as THREE from 'three';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';

// character (old rig) bone -> animation rig bone
export const BONE_MAP = {
  Pelvis: 'Hips', spine_01: 'Spine_01', spine_02: 'Spine_02', spine_03: 'Spine_03', neck_01: 'Neck', head: 'Head',
  clavicle_l: 'Clavicle_L', UpperArm_L: 'Shoulder_L', lowerarm_l: 'Elbow_L', Hand_L: 'Hand_L',
  clavicle_r: 'Clavicle_R', UpperArm_R: 'Shoulder_R', lowerarm_r: 'Elbow_R', Hand_R: 'Hand_R',
  Thigh_L: 'UpperLeg_L', calf_l: 'LowerLeg_L', Foot_L: 'Ankle_L', ball_l: 'Ball_L',
  Thigh_R: 'UpperLeg_R', calf_r: 'LowerLeg_R', Foot_R: 'Ankle_R', ball_r: 'Ball_R',
};
// which child defines each bone's direction (used to correct rest-pose differences)
const DIR_CHILD = {
  // torso bones measure to the head: adjacent spine bones can sit almost on top of each other (big rigs)
  Pelvis: 'head', spine_01: 'head', spine_02: 'head', spine_03: 'head', neck_01: 'head',
  clavicle_l: 'UpperArm_L', UpperArm_L: 'lowerarm_l', lowerarm_l: 'Hand_L',
  clavicle_r: 'UpperArm_R', UpperArm_R: 'lowerarm_r', lowerarm_r: 'Hand_R',
  Thigh_L: 'calf_l', calf_l: 'Foot_L', Foot_L: 'ball_l', Thigh_R: 'calf_r', calf_r: 'Foot_R', Foot_R: 'ball_r',
};
const clean = (n) => n.replace(/^.*[:|]/, '');
// Same tables for models already on the new rig (e.g. Dark Fantasy Gargoyle): identity map.
const NEW_MAP = Object.fromEntries(Object.values(BONE_MAP).map((n) => [n, n]));
const NEW_DIR = Object.fromEntries(Object.entries(DIR_CHILD).map(([k, v]) => [BONE_MAP[k], BONE_MAP[v]]));

const _p = new THREE.Vector3(), _s = new THREE.Vector3(), _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion();

function boneIndex(root) {
  const m = {}; root.traverse((o) => { if (o.isBone || o.type === 'Bone' || BONE_MAP[clean(o.name)] || Object.values(BONE_MAP).includes(clean(o.name))) m[clean(o.name)] = m[clean(o.name)] || o; }); return m;
}
function worldQ(o, out) { o.matrixWorld.decompose(_p, out, _s); return out; }
function worldP(o, out) { return out.setFromMatrixPosition(o.matrixWorld); }

/** Prepare the animation library from the parsed rig and clip FBX objects. */
export function makeLibrary(rigObj, clipObjs) {
  const clips = {};
  for (const [name, obj] of Object.entries(clipObjs)) {
    const src = obj.animations[0];
    if (!src) continue;
    const tracks = [];
    for (const t of src.tracks) {
      const dot = t.name.lastIndexOf('.'), bone = clean(t.name.slice(0, dot)), prop = t.name.slice(dot + 1);
      if (prop === 'scale') continue;
      if (prop === 'position' && bone !== 'Hips') continue;
      const c = t.clone(); c.name = `${bone}.${prop}`; tracks.push(c);
    }
    clips[name] = new THREE.AnimationClip(name, src.duration, tracks);
  }
  // Rename rig nodes to clean names so tracks bind.
  rigObj.traverse((o) => { o.name = clean(o.name); });
  rigObj.updateMatrixWorld(true);
  return { rig: rigObj, clips };
}

export class Animator {
  /** @param lib from makeLibrary  @param model the character's FBX root (inside a wrapper group) */
  constructor(lib, model) {
    this.lib = lib; this.model = model; this.frame = model.parent;
    this.src = SkeletonUtils.clone(lib.rig);
    this.src.updateMatrixWorld(true);
    this.mixer = new THREE.AnimationMixer(this.src);
    this.actions = {};
    for (const [n, c] of Object.entries(lib.clips)) this.actions[n] = this.mixer.clipAction(c);
    const S = boneIndex(this.src), T = boneIndex(model);
    const newRig = !T.Pelvis && !!T.Hips;
    const MAP = newRig ? NEW_MAP : BONE_MAP, DIR = newRig ? NEW_DIR : DIR_CHILD;
    const tL = newRig ? T.UpperLeg_L : T.Thigh_L, tR = newRig ? T.UpperLeg_R : T.Thigh_R;
    this.frame.updateMatrixWorld(true);
    const fInv = worldQ(this.frame, new THREE.Quaternion()).invert();
    const tModelQ = (b) => fInv.clone().multiply(worldQ(b, new THREE.Quaternion()));
    const tModelP = (b) => this.frame.worldToLocal(worldP(b, new THREE.Vector3()));

    // Facing alignment: rotate source space about Y so its left-right hip axis matches the character's.
    const sAxis = worldP(S.UpperLeg_L, new THREE.Vector3()).sub(worldP(S.UpperLeg_R, new THREE.Vector3())).setY(0).normalize();
    const tAxis = tModelP(tL).sub(tModelP(tR)).setY(0).normalize();
    // Both Synty rigs face +Z; only correct a rig that faces backwards (a stance can tilt the hip axis a little).
    this.Y = sAxis.dot(tAxis) < 0 ? new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI) : new THREE.Quaternion();
    this.Yinv = this.Y.clone().invert();

    this.pairs = [];
    const byT = new Map();
    model.traverse((o) => {
      const tn = clean(o.name), sn = MAP[tn];
      if (!sn || !S[sn] || T[tn] !== o) return;
      const s = S[sn];
      const sRest = this.Y.clone().multiply(worldQ(s, new THREE.Quaternion()));
      const tRest = tModelQ(o);
      // rest-direction correction C: turn the character bone's rest direction onto the rig bone's rest direction
      let C = new THREE.Quaternion();
      const tc = T[DIR[tn]], sc = tc && S[MAP[clean(tc.name)]];
      let done = false;
      if (tc && sc) {
        const td = tModelP(tc).sub(tModelP(o)), sd = worldP(sc, new THREE.Vector3()).sub(worldP(s, new THREE.Vector3())).applyQuaternion(this.Y);
        if (td.length() > 1e-3 && sd.length() > 1e-3) { C.setFromUnitVectors(td.normalize(), sd.normalize()); done = true; }
      }
      if (!done && o.parent && byT.has(o.parent)) C = byT.get(o.parent).C.clone();
      const parentPair = byT.get(o.parent) || null;
      const pair = { t: o, s, sRestInv: sRest.invert(), tRest, C, parentPair, parentRest: parentPair ? null : tModelQ(o.parent), cur: new THREE.Quaternion() };
      byT.set(o, pair); this.pairs.push(pair);
    });
    this.ok = this.pairs.length >= 14;
    // hips translation
    if (this.ok) {
      this.hipsT = newRig ? T.Hips : T.Pelvis; this.hipsS = S.Hips;
      this.tHipsRest = tModelP(this.hipsT);
      this.sHipsRest = worldP(S.Hips, new THREE.Vector3());
      this.hRatio = this.tHipsRest.y / Math.max(1e-4, this.sHipsRest.y);

    }
    this.cur = null; this.oneShot = null; this.loco = {};
  }

  setLoco(weights, timeScale = 1) {
    // weights: {name: w}; locomotion clips loop and are blended by weight
    for (const [n, w] of Object.entries(weights)) {
      const a = this.actions[n]; if (!a) continue;
      if (!a.isRunning()) { a.setLoop(THREE.LoopRepeat); a.play(); }
      this.loco[n] = w; a.timeScale = timeScale;
    }
  }
  playOnce(name, duration, onDone) {
    const a = this.actions[name]; if (!a) return;
    if (this.oneShot && this.oneShot.a !== a) this.oneShot.a.stop();
    a.reset(); a.setLoop(THREE.LoopOnce); a.clampWhenFinished = true;
    a.timeScale = duration ? a.getClip().duration / duration : 1;
    a.play();
    this.oneShot = { a, t: 0, len: a.getClip().duration / a.timeScale, hold: name === 'death', onDone, w: 0 };
  }
  update(dt) {
    let ow = 0;
    if (this.oneShot) {
      const o = this.oneShot; o.t += dt;
      const fadeOut = Math.min(0.15, o.len * 0.3);
      ow = Math.min(1, o.t / 0.08);
      if (!o.hold && o.t > o.len - fadeOut) ow = Math.max(0, (o.len - o.t) / fadeOut);
      o.a.setEffectiveWeight(ow);
      if (!o.hold && o.t >= o.len) { o.a.stop(); this.oneShot = null; if (o.onDone) o.onDone(); ow = 0; }
    }
    let sum = 0; for (const w of Object.values(this.loco)) sum += w;
    for (const [n, w] of Object.entries(this.loco)) this.actions[n].setEffectiveWeight(sum > 0 ? (w / sum) * (1 - ow) : 0);
    this.mixer.update(dt);
    this.apply();
  }
  apply() {
    if (!this.ok) return;
    this.src.updateMatrixWorld(true);
    for (const p of this.pairs) {
      // delta of the rig bone from its rest, expressed in the character's frame
      const sCur = this.Y.clone().multiply(worldQ(p.s, _q));
      const delta = sCur.multiply(p.sRestInv);                // world delta
      p.cur.copy(delta).multiply(p.C).multiply(p.tRest);     // character bone, model space
      const parentQ = p.parentPair ? p.parentPair.cur : p.parentRest;
      p.t.quaternion.copy(_q2.copy(parentQ).invert().multiply(p.cur));
    }
    // hips: vertical and planar offsets (in-place clips keep this small)
    const sNow = worldP(this.hipsS, _p).clone();
    const d = sNow.sub(this.sHipsRest).applyQuaternion(this.Y).multiplyScalar(this.hRatio);
    const target = this.tHipsRest.clone().add(d);
    this.frame.updateMatrixWorld(true);
    const world = this.frame.localToWorld(target);
    this.hipsT.parent.updateMatrixWorld(true);
    this.hipsT.position.copy(this.hipsT.parent.worldToLocal(world));
  }
  /** Freeze in a single pose (used for familiar ghosts). */
  pose(name, t = 0.3) {
    const a = this.actions[name]; if (!a) return;
    a.reset(); a.play(); a.setEffectiveWeight(1); this.mixer.setTime(t); this.apply(); a.stop();
  }
}

export async function gunzipB64(b64) {
  const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  const stream = new Blob([bin]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Response(stream).arrayBuffer();
}
