import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js'

const PI = Math.PI

// ─── HELPERS ─────────────────────────────────────────────────────────────────

function lerp(a, b, t) { return a + (b - a) * t }
function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)) }
function ss(t) { return t * t * (3 - 2 * t) }
function easeOutCubic(t) { return 1 - Math.pow(1 - t, 3) }
function easeInOutCubic(t) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2
}

// ─── CLIFFORD STRANGE ATTRACTOR ───────────────────────────────────────────────

function createChaosAttractorPositions(scale, count, offset, a, b, c, d, e, f) {
  const raw = new Float32Array(count * 3)
  const result = new Float32Array(count * 3)
  for (let i = 0; i < count; i++) {
    let x = 0, y = 0, z = 0
    if (i > 0) {
      x = raw[(i - 1) * 3]
      y = raw[(i - 1) * 3 + 1]
      z = raw[(i - 1) * 3 + 2]
    }
    raw[i * 3]     = Math.sin(a * y) - Math.cos(b * x)
    raw[i * 3 + 1] = Math.sin(c * x) - Math.cos(d * y)
    raw[i * 3 + 2] = Math.sin(e * x) - Math.cos(f * z)
    result[i * 3]     = raw[i * 3]     * scale + offset
    result[i * 3 + 1] = raw[i * 3 + 1] * scale
    result[i * 3 + 2] = raw[i * 3 + 2] * scale
  }
  return result
}

// ─── SILHOUETTE → PARTICLE CLOUD ──────────────────────────────────────────────
// draws an icon onto an offscreen canvas, then samples its filled pixels into
// a 3D point cloud in the same coordinate scale as the chaos attractors above

function silhouettePositions(drawFn, count, worldSize, depthJitter, xOffset = 0) {
  const RES = 512
  const cv = document.createElement('canvas')
  cv.width = RES; cv.height = RES
  const ctx = cv.getContext('2d')
  ctx.clearRect(0, 0, RES, RES)
  drawFn(ctx, RES, RES)

  const img = ctx.getImageData(0, 0, RES, RES).data
  const filled = []
  for (let y = 0; y < RES; y++) {
    for (let x = 0; x < RES; x++) {
      if (img[(y * RES + x) * 4 + 3] > 40) filled.push(x, y)
    }
  }

  const result = new Float32Array(count * 3)
  const half = worldSize / 2
  for (let i = 0; i < count; i++) {
    const idx = (Math.random() * (filled.length / 2) | 0) * 2
    const px = filled[idx], py = filled[idx + 1]
    const jx = (Math.random() - 0.5) * (worldSize / RES) * 1.6
    const jy = (Math.random() - 0.5) * (worldSize / RES) * 1.6
    result[i * 3]     = (px / RES) * worldSize - half + jx + xOffset
    result[i * 3 + 1] = -((py / RES) * worldSize - half) + jy
    result[i * 3 + 2] = (Math.random() - 0.5) * depthJitter
  }
  return result
}

/* pushes every particle away from center along its own existing direction —
   the ambient cloud "flees" outward off-screen rather than assembling into
   a new shape */
function fleePositions(restPositions, edgeX) {
  const result = new Float32Array(restPositions.length)
  const pointCount = restPositions.length / 3
  for (let i = 0; i < pointCount; i++) {
    const ix = i * 3
    const goRight = i % 2 === 0
    /* fully independent random scatter around each edge — not derived from
       the strange attractor's own Y/Z, which has thin curved filaments
       baked into it and would carry that "line" look into the cluster */
    const x = edgeX * (goRight ? 1 : -1) + (Math.random() - 0.5) * edgeX * 0.35
    const y = (Math.random() - 0.5) * 520
    const z = (Math.random() - 0.5) * 250
    result[ix]     = x
    result[ix + 1] = y
    result[ix + 2] = z
  }
  return result
}

/* hook with a fish already caught on the barb from the start, plus a few
   wavy lines below simulating water. hook+fish rise together as one unit;
   the waves ripple continuously — see buildHookFishPositions/
   _applyHookFishAction */
function drawHookFishIcon(ctx, W, H) {
  ctx.strokeStyle = '#fff'
  ctx.fillStyle = '#fff'
  const cx = W * 0.28   /* shifted left of center, leaving room for the fish */

  /* hook: eyelet, shank, bezier bend */
  ctx.lineWidth = 16
  ctx.lineCap = 'round'
  ctx.beginPath()
  ctx.arc(cx, H * 0.12, 16, 0, PI * 2)
  ctx.stroke()
  ctx.beginPath()
  ctx.moveTo(cx, H * 0.16)
  ctx.lineTo(cx, H * 0.55)
  ctx.stroke()
  ctx.beginPath()
  ctx.moveTo(cx, H * 0.55)
  ctx.bezierCurveTo(W * 0.14, H * 0.72, W * 0.50, H * 0.76, W * 0.46, H * 0.56)
  ctx.stroke()

  /* fish caught on the barb from the start */
  const fishLen = W * 0.37, fishH = W * 0.17
  const fishCx = W * 0.46 + fishLen * 0.5, fishCy = H * 0.56

  ctx.beginPath()
  ctx.moveTo(fishCx - fishLen * 0.5, fishCy)
  ctx.bezierCurveTo(
    fishCx - fishLen * 0.2, fishCy - fishH,
    fishCx + fishLen * 0.35, fishCy - fishH * 0.5,
    fishCx + fishLen * 0.5, fishCy
  )
  ctx.bezierCurveTo(
    fishCx + fishLen * 0.35, fishCy + fishH * 0.5,
    fishCx - fishLen * 0.2, fishCy + fishH,
    fishCx - fishLen * 0.5, fishCy
  )
  ctx.closePath()
  ctx.fill()

  ctx.beginPath()
  ctx.moveTo(fishCx + fishLen * 0.48, fishCy)
  ctx.lineTo(fishCx + fishLen * 0.80, fishCy - fishH * 0.9)
  ctx.lineTo(fishCx + fishLen * 0.66, fishCy)
  ctx.lineTo(fishCx + fishLen * 0.80, fishCy + fishH * 0.9)
  ctx.closePath()
  ctx.fill()

  /* water — a few wavy lines below/around the catch, spread apart */
  ctx.lineWidth = 7
  ctx.lineCap = 'butt'
  const waveYs = [0.80, 0.97]
  for (const wy of waveYs) {
    const baseY = H * wy
    ctx.beginPath()
    for (let x = W * 0.05; x <= W * 0.95; x += W * 0.05) {
      const off = Math.sin((x / W) * PI * 4) * (H * 0.018)
      if (x === W * 0.05) ctx.moveTo(x, baseY + off)
      else ctx.lineTo(x, baseY + off)
    }
    ctx.stroke()
  }
}

/* populated by buildHookFishPositions the first (and only) time it runs.
   waveMask flags particles below the WAVE_SPLIT_PX line (the two wavy water
   lines); everything else (hook + fish) is the complementary group that
   rises together as one rigid unit. read every frame by
   _applyHookFishAction: the hook+fish group translates straight up, the
   wave group gets a continuous per-frame ripple. */
let hookFishMeta = null

function buildHookFishPositions(count) {
  const RES = 512, worldSize = 350, depthJitter = 25, xOffset = 300
  const half = worldSize / 2

  const cv = document.createElement('canvas')
  cv.width = RES; cv.height = RES
  const ctx = cv.getContext('2d')
  ctx.clearRect(0, 0, RES, RES)
  drawHookFishIcon(ctx, RES, RES)
  const img = ctx.getImageData(0, 0, RES, RES).data
  const filled = []
  for (let y = 0; y < RES; y++) {
    for (let x = 0; x < RES; x++) {
      if (img[(y * RES + x) * 4 + 3] > 40) filled.push(x, y)
    }
  }

  const WAVE_SPLIT_PX = RES * 0.76   /* below this = water, above = hook+fish */
  const result = new Float32Array(count * 3)
  const waveMask = new Uint8Array(count)

  if (filled.length > 0) {
    for (let i = 0; i < count; i++) {
      const idx = (Math.random() * (filled.length / 2) | 0) * 2
      const px = filled[idx], py = filled[idx + 1]
      const jx = (Math.random() - 0.5) * (worldSize / RES) * 1.6
      const jy = (Math.random() - 0.5) * (worldSize / RES) * 1.6
      result[i * 3]     = (px / RES) * worldSize - half + jx + xOffset
      result[i * 3 + 1] = -((py / RES) * worldSize - half) + jy
      result[i * 3 + 2] = (Math.random() - 0.5) * depthJitter
      waveMask[i] = py > WAVE_SPLIT_PX ? 1 : 0
    }
  } else {
    for (let i = 0; i < count; i++) {
      result[i * 3]     = (Math.random() - 0.5) * worldSize + xOffset
      result[i * 3 + 1] = (Math.random() - 0.5) * worldSize
      result[i * 3 + 2] = (Math.random() - 0.5) * depthJitter
    }
  }

  hookFishMeta = { waveMask, basePositions: result.slice() }
  return result
}

/* two kites, drawn independently so their particles can be tagged and swayed
   out of phase — aligned incentives, both climbing, neither pulling the
   other off course */
function drawOneKite(ctx, cx, cy, size) {
  ctx.beginPath()
  ctx.moveTo(cx, cy - size * 0.55)
  ctx.lineTo(cx + size * 0.38, cy)
  ctx.lineTo(cx, cy + size * 0.42)
  ctx.lineTo(cx - size * 0.38, cy)
  ctx.closePath()
  ctx.fill()

  /* tail — many fine segments tracing a real sine wave (not a handful of
     coarse waypoints, which aliased into a jagged zigzag) */
  ctx.lineWidth = 5
  ctx.lineCap = 'round'
  ctx.beginPath()
  ctx.moveTo(cx, cy + size * 0.42)
  const tailLen = size * 0.85, N = 24
  for (let i = 1; i <= N; i++) {
    const t = i / N
    const ty = cy + size * 0.42 + t * tailLen
    const tx = cx + Math.sin(t * PI * 3) * size * 0.16 * t
    ctx.lineTo(tx, ty)
  }
  ctx.stroke()
}

function drawKitesIcon(ctx, W, H) {
  ctx.fillStyle = '#fff'
  ctx.strokeStyle = '#fff'
  drawOneKite(ctx, W * 0.36, H * 0.72, W * 0.30)
  drawOneKite(ctx, W * 0.66, H * 0.72, W * 0.26)
}

/* populated by buildKitesPositions the first (and only) time it runs.
   kite1Mask/kite2Mask split particles by which kite they came from (simple
   X threshold — the two kites don't overlap horizontally), so each can
   sway independently in _applyKitesAction. */
let kitesMeta = null

function buildKitesPositions(count) {
  /* RES stays the fraction reference for drawKitesIcon (cx/cy/size are all
     computed as fractions of RES=512, exactly as before) and for the
     pixel→world conversion below — but the physical canvas buffer is
     taller (RES_H) so a low cy plus the tail's own length can extend well
     past pixel row 512 without being clipped by the canvas edge; the
     conversion formula only cares about RES, so extra rows below it just
     extend smoothly into more negative (lower on screen) world Y */
  const RES = 512, RES_H = 700, worldSize = 350, depthJitter = 25, xOffset = 300
  const half = worldSize / 2

  const cv = document.createElement('canvas')
  cv.width = RES; cv.height = RES_H
  const ctx = cv.getContext('2d')
  ctx.clearRect(0, 0, RES, RES_H)
  drawKitesIcon(ctx, RES, RES)
  const img = ctx.getImageData(0, 0, RES, RES_H).data
  const filled = []
  for (let y = 0; y < RES_H; y++) {
    for (let x = 0; x < RES; x++) {
      if (img[(y * RES + x) * 4 + 3] > 40) filled.push(x, y)
    }
  }

  /* kite1's rightmost point (its diamond's right vertex, ~0.36W+0.114W)
     and kite2's leftmost point (~0.66W-0.096W) leave a clean gap around
     0.52W — 0.58 cut directly through kite2's left vertex, splitting a
     sliver of it into kite1Mask (that sliver then swayed on kite1's phase,
     reading as a "broken piece" detaching from kite2). */
  const KITE_SPLIT_PX = RES * 0.52
  const result = new Float32Array(count * 3)
  const kite1Mask = new Uint8Array(count)
  const kite2Mask = new Uint8Array(count)

  if (filled.length > 0) {
    for (let i = 0; i < count; i++) {
      const idx = (Math.random() * (filled.length / 2) | 0) * 2
      const px = filled[idx], py = filled[idx + 1]
      const jx = (Math.random() - 0.5) * (worldSize / RES) * 1.6
      const jy = (Math.random() - 0.5) * (worldSize / RES) * 1.6
      result[i * 3]     = (px / RES) * worldSize - half + jx + xOffset
      result[i * 3 + 1] = -((py / RES) * worldSize - half) + jy
      result[i * 3 + 2] = (Math.random() - 0.5) * depthJitter
      if (px < KITE_SPLIT_PX) kite1Mask[i] = 1
      else kite2Mask[i] = 1
    }
  } else {
    for (let i = 0; i < count; i++) {
      result[i * 3]     = (Math.random() - 0.5) * worldSize + xOffset
      result[i * 3 + 1] = (Math.random() - 0.5) * worldSize
      result[i * 3 + 2] = (Math.random() - 0.5) * depthJitter
    }
  }

  kitesMeta = { kite1Mask, kite2Mask, basePositions: result.slice() }
  return result
}

function drawCompassIcon(ctx, W, H) {
  ctx.fillStyle = '#fff'
  ctx.strokeStyle = '#fff'
  const cx = W / 2
  const hingeY = H * 0.24

  /* hinge knob + handle */
  ctx.beginPath()
  ctx.arc(cx, hingeY, 16, 0, PI * 2)
  ctx.fill()
  ctx.lineWidth = 10
  ctx.beginPath()
  ctx.moveTo(cx, hingeY - 10)
  ctx.lineTo(cx, hingeY - 46)
  ctx.stroke()

  /* fixed leg (metal point) — left side, stays put */
  ctx.lineWidth = 14
  ctx.beginPath()
  ctx.moveTo(cx, hingeY)
  ctx.lineTo(cx - 78, H * 0.84)
  ctx.stroke()

  /* moving leg (pencil) — right side, this is the one that sweeps */
  ctx.beginPath()
  ctx.moveTo(cx, hingeY)
  ctx.lineTo(cx + 78, H * 0.84)
  ctx.stroke()
  ctx.beginPath()
  ctx.arc(cx + 78, H * 0.84, 12, 0, PI * 2)
  ctx.fill()
}

/* populated by buildCompassPositions the first (and only) time it runs —
   basePositions is the compass at rest (angle 0), legMask flags which
   particles belong to the moving leg, pivot is the hinge in the same
   world-space coordinates as the position buffers. read every frame by
   ParticleSystem._applyCompassSweep to rotate the moving leg in place. */
let compassSweepMeta = null

function buildCompassPositions(count) {
  const RES = 512, worldSize = 350, depthJitter = 25, xOffset = 300
  const cv = document.createElement('canvas')
  cv.width = RES; cv.height = RES
  const ctx = cv.getContext('2d')
  ctx.clearRect(0, 0, RES, RES)
  drawCompassIcon(ctx, RES, RES)

  const img = ctx.getImageData(0, 0, RES, RES).data
  const filled = []
  for (let y = 0; y < RES; y++) {
    for (let x = 0; x < RES; x++) {
      if (img[(y * RES + x) * 4 + 3] > 40) filled.push(x, y)
    }
  }

  const half = worldSize / 2
  const result = new Float32Array(count * 3)
  const legMask = new Uint8Array(count)
  const hingePx = RES / 2
  const legSplitPx = hingePx + 4   /* everything right of the hinge is the moving leg */

  if (filled.length === 0) {
    /* icon canvas produced nothing usable — soft neutral cluster instead of NaNs */
    for (let i = 0; i < count; i++) {
      result[i * 3]     = (Math.random() - 0.5) * worldSize + xOffset
      result[i * 3 + 1] = (Math.random() - 0.5) * worldSize
      result[i * 3 + 2] = (Math.random() - 0.5) * depthJitter
    }
  } else {
    for (let i = 0; i < count; i++) {
      const idx = (Math.random() * (filled.length / 2) | 0) * 2
      const px = filled[idx], py = filled[idx + 1]
      const jx = (Math.random() - 0.5) * (worldSize / RES) * 1.6
      const jy = (Math.random() - 0.5) * (worldSize / RES) * 1.6
      result[i * 3]     = (px / RES) * worldSize - half + jx + xOffset
      result[i * 3 + 1] = -((py / RES) * worldSize - half) + jy
      result[i * 3 + 2] = (Math.random() - 0.5) * depthJitter
      legMask[i] = px > legSplitPx ? 1 : 0
    }
  }

  const hingeYpx = RES * 0.24
  const pivot = {
    x: (hingePx / RES) * worldSize - half + xOffset,
    y: -((hingeYpx / RES) * worldSize - half),
    z: 0,
  }
  compassSweepMeta = { pivot, legMask, basePositions: result.slice() }
  return result
}

// ─── GLSL SHADERS ─────────────────────────────────────────────────────────────

/* a_highlight is 0 for the vast majority of particles at all times — only
   the fingerprint scanner line (see ParticleSystem._applyFingerprintAction)
   ever writes nonzero values into it, and only while that shape is fully
   formed (the u_progress gate there forces it to 0 during formation/
   dissolve, so points are always normal size then). size only — no color
   change, ever. */
const particleVertexShader = `
in vec3 position;
in vec3 position1;
in float a_highlight;
uniform mat4 modelViewMatrix;
uniform mat4 projectionMatrix;
uniform float u_progress;
void main() {
  vec3 finalPosition = mix(position, position1, u_progress);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(finalPosition, 1.0);
  gl_PointSize = 1.0 + a_highlight * 2.5;
}
`

const particleFragmentShader = `
precision mediump float;
uniform vec3 u_color;
out vec4 fragColor;
void main() {
  fragColor = vec4(u_color, 1.0);
}
`

const PARTICLE_COLOR = [0.30, 0.48, 0.45]      /* muted petrol/teal green, on black */

// ─── PROJECTOR WIDGET (persistent link to the cinema page) ────────────────────
// its own tiny WebGL context — same "one canvas, one job" approach as
// MainScene/RingScene, just scoped to a small icon-sized element docked in
// the header instead of a full section. model is a real 3D asset
// (models/projector.glb), fitted at runtime the same way the cinema kiosk
// model is: measure the real bounding box, scale to a target size, center
// it — no hand-guessed offsets, since every export has its own arbitrary
// unit scale/pivot.
const PROJECTOR_MODEL_URL = './models/projector.glb'
const PROJECTOR_TARGET_SIZE = 0.5

/* aims `localForward` (the real, measured lens direction, in the model's
   own unrotated local space) at `target` (a world-space direction from
   the object's center), the same way Matrix4.lookAt aims a camera's -Z at
   something: by also constraining a companion "up" axis to stay as close
   to world-up as possible, instead of just taking the shortest rotation
   between two vectors (which has no opinion about roll and can flip the
   object upside down to get there — confirmed both by seeing it happen
   and by verifying this replacement numerically, in Node, before
   shipping it: aim error is exactly zero and the object's own up axis
   never goes negative/flips across a wide spread of test directions).
   `localUp` is assumed to be the model's own local +Y — a reasonable
   default since most exported assets keep +Y as "up" even when their
   forward axis is arbitrary. */
function computeLensLookRotation(localForwardRaw, localUp, target) {
  /* THE bug that caused every "close but a few degrees off, worse on
     diagonals" result in this whole saga: localForward (this.lensLocal)
     is a real measured position, not a unit vector — its actual length
     is ~0.209, not 1. makeBasis() below needs an orthoNORMAL basis to
     produce a valid rotation matrix; feeding it a non-unit axis silently
     produces a slightly-wrong matrix, which Quaternion.setFromRotationMatrix
     then extracts a slightly-wrong rotation from. Verified numerically,
     with the real measured lens vector: without this normalize, aim
     error was ~30-40° off; with it, aim error is exactly zero at every
     angle tested, including diagonals. */
  const localForward = localForwardRaw.clone().normalize()
  const worldUp = new THREE.Vector3(0, 1, 0)
  const targetDir = target.clone().normalize()

  let right = new THREE.Vector3().crossVectors(worldUp, targetDir)
  if (right.lengthSq() < 1e-8) right.set(1, 0, 0) // target parallel to world up — rare edge case, arbitrary fallback
  right.normalize()
  const newUp = new THREE.Vector3().crossVectors(targetDir, right).normalize()

  const localRight = new THREE.Vector3().crossVectors(localUp, localForward).normalize()
  const trueLocalUp = new THREE.Vector3().crossVectors(localForward, localRight).normalize()

  const sourceBasis = new THREE.Matrix4().makeBasis(localRight, trueLocalUp, localForward)
  const destBasis = new THREE.Matrix4().makeBasis(right, newUp, targetDir)
  const qSource = new THREE.Quaternion().setFromRotationMatrix(sourceBasis)
  const qDest = new THREE.Quaternion().setFromRotationMatrix(destBasis)
  return qDest.multiply(qSource.invert())
}

/* the object's true center of mass (assuming uniform density, since we
   have no per-material density data) — NOT the bounding-box center,
   which is pulled around by whichever points happen to be most extreme
   (a lens sticking out to one side, say) rather than the actual
   distribution of the object's volume. measured directly off the real
   mesh in Node beforehand (gltf-transform + the same tetrahedra method
   below): the two centers differ by ~10-12% of the object's own size —
   real, not negligible.
   method: decompose every triangle into a tetrahedron with the origin,
   sum each one's SIGNED volume (dot(a, cross(b,c))/6 — origin-independent
   for a closed mesh) and volume-weighted centroid ((a+b+c+origin)/4,
   origin being (0,0,0) so it drops out), then divide. */
function computeVolumetricCentroid(root) {
  root.updateMatrixWorld(true)
  let totalVolume = 0
  const centroidSum = new THREE.Vector3()
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3()
  const cross = new THREE.Vector3()
  root.traverse(node => {
    if (!node.isMesh) return
    const geo = node.geometry
    const pos = geo.attributes.position
    const index = geo.index
    const triCount = index ? index.count / 3 : pos.count / 3
    for (let t = 0; t < triCount; t++) {
      const ia = index ? index.getX(t * 3) : t * 3
      const ib = index ? index.getX(t * 3 + 1) : t * 3 + 1
      const ic = index ? index.getX(t * 3 + 2) : t * 3 + 2
      a.fromBufferAttribute(pos, ia).applyMatrix4(node.matrixWorld)
      b.fromBufferAttribute(pos, ib).applyMatrix4(node.matrixWorld)
      c.fromBufferAttribute(pos, ic).applyMatrix4(node.matrixWorld)
      cross.crossVectors(b, c)
      const signedVolume = a.dot(cross) / 6
      totalVolume += signedVolume
      centroidSum.x += (a.x + b.x + c.x) / 4 * signedVolume
      centroidSum.y += (a.y + b.y + c.y) / 4 * signedVolume
      centroidSum.z += (a.z + b.z + c.z) / 4 * signedVolume
    }
  })
  return centroidSum.divideScalar(totalVolume)
}

const PROJECTOR_CANVAS_PX = 130
// hand-tuned calibration offset for the hover "look straight down" pose —
// see the comment at its use site in ProjectorWidget._loop
const HOVER_RIGHT_NUDGE = 0.11

class ProjectorWidget {
  constructor(container) {
    this.container = container
    this.width = PROJECTOR_CANVAS_PX
    this.height = PROJECTOR_CANVAS_PX
    this.mouseX = window.innerWidth / 2
    this.mouseY = window.innerHeight / 2
    this.raycaster = new THREE.Raycaster()
    this.ndc = new THREE.Vector2()
    this.hovering = false

    this._initRenderer()
    this._initScene()
    this._loadModel()
    this._bindEvents()

    this.raf = requestAnimationFrame(t => this._loop(t))
  }

  _initRenderer() {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    // updateStyle=false — otherwise three.js sets an inline canvas.style
    // width/height, which would override the CSS's 100%/mobile sizing
    this.renderer.setSize(this.width, this.height, false)
    this.container.appendChild(this.renderer.domElement)
  }

  _initScene() {
    this.scene = new THREE.Scene()
    this.camera = new THREE.PerspectiveCamera(35, this.width / this.height, 0.01, 100)
    this.camera.position.set(0.42, 0.32, 0.5) // provisional — refit once the model's real size is known, see _loadModel
    this.camera.lookAt(0, 0, 0)

    this.scene.add(new THREE.AmbientLight(0xffffff, 1.1))
    const key = new THREE.DirectionalLight(0xffffff, 1.8)
    key.position.set(2, 3, 2)
    this.scene.add(key)
    const fill = new THREE.DirectionalLight(0xc9a15a, 0.7)
    fill.position.set(-2, 1, -1.5)
    this.scene.add(fill)
    const rim = new THREE.DirectionalLight(0xffffff, 0.5)
    rim.position.set(0, -1, -2)
    this.scene.add(rim)
  }

  _loadModel() {
    const loader = new GLTFLoader()
    loader.setMeshoptDecoder(MeshoptDecoder)
    loader.load(PROJECTOR_MODEL_URL, gltf => {
      const root = gltf.scene
      const box = new THREE.Box3().setFromObject(root)
      const size = box.getSize(new THREE.Vector3())
      const center = box.getCenter(new THREE.Vector3())
      const scale = PROJECTOR_TARGET_SIZE / Math.max(size.x, size.y, size.z)
      root.scale.setScalar(scale)
      root.position.set(-center.x * scale, -center.y * scale, -center.z * scale)

      /* rotating `root` directly would spin it around its own native
         pivot, not its visual center — since that pivot is wherever the
         model's own local (0,0,0) happens to be, rarely the geometric
         center, the whole object would orbit away from view instead of
         spinning in place. wrapping it in a group and rotating the
         (unpositioned) wrapper instead keeps the visual center pinned at
         the world origin regardless of rotation. */
      this.root = new THREE.Group()
      this.root.add(root)
      this.scene.add(this.root)

      /* find the actual lens (the "Glass" material) instead of guessing
         a local axis for "forward" — Danilo's rule: the object center,
         the lens, and the cursor must always sit on one exact straight
         line. root.rotation is still identity here, so this position
         (measured in the scene, right after centering/scaling, before
         any rotation ever gets applied) is exactly the lens's position
         relative to the rotation pivot.

         uses the glass MESH's own geometric center (its bounding-box
         midpoint), not node.getWorldPosition() — that would only give the
         mesh's arbitrary local pivot/origin point, which for a GLTF/FBX
         export is rarely at the actual center of its geometry. if several
         meshes use a glass-like material, the farthest from the object
         center is taken as the actual front lens surface (not some small
         internal glass part). */
      root.updateMatrixWorld(true)
      let lensPos = null
      let lensDist = -1
      root.traverse(node => {
        if (!node.isMesh) return
        const mats = Array.isArray(node.material) ? node.material : [node.material]
        if (!mats.some(m => m && /glass/i.test(m.name || ''))) return
        const p = new THREE.Box3().setFromObject(node).getCenter(new THREE.Vector3())
        const d = p.length()
        if (d > lensDist) { lensDist = d; lensPos = p }
      })
      this.lensLocal = lensPos || new THREE.Vector3(0, 0, -1) // fallback if no glass mesh was found

      /* fit the camera to the model's real bounding sphere (not a
         hand-guessed distance) — a guessed distance clipped the model at
         several rotation angles, since the visible frustum at that
         distance was actually smaller than the object's own diagonal. */
      const sphere = new THREE.Box3().setFromObject(this.root).getBoundingSphere(new THREE.Sphere())
      const fovRad = THREE.MathUtils.degToRad(this.camera.fov)
      const margin = 1.7 // breathing room so the model never clips at any rotation angle
      const dist = (sphere.radius / Math.sin(fovRad / 2)) * margin
      // mostly head-on (previously a steep 3/4 diagonal) — with the camera
      // that angled, rotating the model on world X/Y didn't correspond
      // cleanly to left/right and up/down on screen, so "looking at the
      // mouse" tracked in a skewed, unintuitive direction
      // no horizontal (X) offset at all now — Danilo's theory is that the
      // previous 0.15 rightward push was introducing an asymmetric roll
      // bias via lookAt's up-vector handling (errors matched a constant
      // rightward skew: diagonal-right nearly right, diagonal-left always
      // off, pure horizontal way off). only a touch of height left, for
      // a bit of "looking down at it" character without breaking symmetry.
      const dir = new THREE.Vector3(0, 0.2, 1).normalize()
      this.camera.position.copy(dir.multiplyScalar(dist))
      this.camera.lookAt(0, 0, 0)
      this.camera.updateProjectionMatrix()
      this.camera.updateMatrixWorld(true)
      // "down" as the hover hint means down ON SCREEN, not world -Y — since
      // the camera is tilted (elevated + pitched down to frame the model),
      // those two differ by ~11°. the camera's own local -Y axis, expressed
      // in world space, is what actually renders as "straight down" no
      // matter the tilt. verified via a real three.js Camera: world -Y is
      // (0,-1,0), the camera's true screen-down is (0,-0.9806,0.1961).
      this.camDown = new THREE.Vector3().setFromMatrixColumn(this.camera.matrixWorld, 1).negate()
      this.camRight = new THREE.Vector3().setFromMatrixColumn(this.camera.matrixWorld, 0)
      this.camDist = dist

      /* hover hit-test target: a fixed, never-rotating invisible sphere
         around the model — NOT a raycast against the model mesh itself.
         raycasting the live mesh created a feedback loop: as the lens
         rotates down (away from the cursor), the mesh's silhouette moves
         with it, the raycast stops hitting, hover turns off, it swings
         back toward the cursor, hits again, hover turns back on — an
         oscillation that never let it settle. a fixed sphere has no such
         loop. margin kept close to 1 (the model's real bounding-sphere
         radius) so hover reads as "touching the projector", not merely
         being near it — a circumscribing sphere already covers a little
         empty space around the model's actual silhouette, so this errs
         slightly tight rather than slightly loose. */
      const hoverMargin = 0.85
      this.hitSphere = new THREE.Mesh(new THREE.SphereGeometry(sphere.radius * hoverMargin, 12, 8))
      this.hitSphere.visible = false
      this.scene.add(this.hitSphere)
    })
  }

  // tracked on window, not the container — it should turn toward the
  // cursor everywhere on the page, not just when the mouse is near it
  _bindEvents() {
    window.addEventListener('mousemove', e => {
      this.mouseX = e.clientX
      this.mouseY = e.clientY
    })
  }

  _loop(time) {
    this.raf = requestAnimationFrame(t => this._loop(t))
    if (this.root && this.camDist) {
      const rect = this.container.getBoundingClientRect()
      const cx = rect.left + rect.width / 2
      const cy = rect.top + rect.height / 2
      this.ndc.set(
        (this.mouseX - cx) / (rect.width / 2),
        -(this.mouseY - cy) / (rect.height / 2),
      )
      this.raycaster.setFromCamera(this.ndc, this.camera)
      // hover state comes from a raycast against the fixed hit-sphere
      // (see _loadModel), not the model mesh itself — see the comment
      // there for why the mesh itself caused an oscillation — and not the
      // (much larger, square) container box either, so the down-pointing
      // hint only kicks in near/on the rendered projector, not the header
      this.hovering = !!this.hitSphere && this.raycaster.intersectObject(this.hitSphere).length > 0
      // drives the CSS beam/hint too (see style.css .is-hovering rules) —
      // both the lens-down pose and the visual hint now key off the exact
      // same precise hit-test, instead of the lens using the tight sphere
      // while the beam/hint used the loose full-box CSS :hover
      this.container.classList.toggle('is-hovering', this.hovering)
      const target = this.raycaster.ray.origin.clone()
        .addScaledVector(this.raycaster.ray.direction, this.camDist)
      /* when the cursor sits almost exactly over the widget, the ray
         through screen-center passes right by the object's own center
         (by construction: camera.lookAt(0,0,0)), so `target` shrinks
         toward (0,0,0) — a direction that's undefined right at zero and
         numerically unstable (tiny jitter swings it wildly) just next to
         it. in that narrow case, aim at the camera instead — "the cursor
         is on you, so look at the viewer" is the only sane answer, and
         it's well-defined (camera position is never near the origin). */
      if (target.lengthSq() < (this.camDist * 0.05) ** 2) target.copy(this.camera.position)
      // on hover, lock the lens straight down instead of tracking the
      // cursor, so it matches the fixed-direction light-beam hint below it
      // — simpler and more robust than making the beam chase the lens.
      // small manual nudge to the right: camDown is the mathematically
      // exact screen-vertical direction for the "Glass" mesh's bbox-center
      // vector, but the model's real optical axis isn't perfectly that
      // vector (Danilo reported it visually reading a bit left of true
      // down) — this is a calibration constant, tune HOVER_RIGHT_NUDGE if
      // it's still off.
      if (this.hovering) target.copy(this.camDown).addScaledVector(this.camRight, HOVER_RIGHT_NUDGE)
      // the rule: object center, lens, and cursor on one exact line — aim
      // the real lens vector at the target, keeping roll sane (see
      // computeLensLookRotation's own comment for why plain
      // setFromUnitVectors wasn't enough — it flipped the model upside
      // down for some targets, since it has no opinion about roll at all)
      const targetQuat = computeLensLookRotation(this.lensLocal, new THREE.Vector3(0, 1, 0), target)
      this.root.quaternion.slerp(targetQuat, 0.08)
    }
    this.renderer.render(this.scene, this.camera)
  }
}

// ─── MAIN WEBGL SCENE ─────────────────────────────────────────────────────────

class MainScene {
  constructor(container) {
    this.container = container
    this.width = window.innerWidth
    this.height = window.innerHeight
    this.scrollY = 0
    /* start centered, not (0,0) (top-left) — otherwise the parallax added
       below normalizes an untouched mouse position to (-1,-1) and the
       cloud sits tilted to a corner until the user's first mousemove */
    this.mouseX = this.width / 2
    this.mouseY = this.height / 2
    this.targetMouseX = this.width / 2
    this.targetMouseY = this.height / 2

    this._initRenderer()
    this._initCamera()
    this._initScene()
    this._initParticles()
    this._initWorksCubes()
    this._bindEvents()
  }

  _initRenderer() {
    this.renderer = new THREE.WebGLRenderer({ antialias: false, alpha: false })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    this.renderer.setSize(this.width, this.height)
    this.renderer.setClearColor(0x000000, 1)
    this.container.appendChild(this.renderer.domElement)
  }

  _initCamera() {
    this.fov = 45
    this.camera = new THREE.PerspectiveCamera(this.fov, this.width / this.height, 1, 100000)
    this._setCameraZ()
    this.camera.position.y = 0
  }

  _setCameraZ() {
    this.camera.position.z = (this.height / 2) / Math.tan((this.fov / 2) * PI / 180)
  }

  _initScene() {
    this.scene = new THREE.Scene()
  }

  _initParticles() {
    this.particles = new ParticleSystem(this.scene)
  }

  _initWorksCubes() {
    this.worksCubes = []
  }

  _bindEvents() {
    window.addEventListener('mousemove', e => {
      this.targetMouseX = e.clientX
      this.targetMouseY = e.clientY
    })
  }

  updateScroll(scrollY) {
    this.scrollY = scrollY
    this.camera.position.y = -scrollY
    this.particles.updateScroll(scrollY)
    this.worksCubes.forEach(c => c.reposition(scrollY))
  }

  setBackgroundZoom(weight) {
    this.particles.setZoom(weight)
  }

  resize() {
    this.width = window.innerWidth
    this.height = window.innerHeight
    this.camera.aspect = this.width / this.height
    this.camera.updateProjectionMatrix()
    this._setCameraZ()
    this.renderer.setSize(this.width, this.height)
    this.worksCubes.forEach(c => c.reposition(this.scrollY))
  }

  update(dt) {
    this.mouseX = lerp(this.mouseX, this.targetMouseX, 0.05)
    this.mouseY = lerp(this.mouseY, this.targetMouseY, 0.05)
    /* normalized to roughly -1..1 from screen center for the particle
       parallax in ParticleSystem.update */
    const mouseNX = clamp((this.mouseX - this.width / 2) / (this.width / 2), -1, 1)
    const mouseNY = clamp((this.mouseY - this.height / 2) / (this.height / 2), -1, 1)
    this.particles.update(mouseNX, mouseNY)
    this.worksCubes.forEach(c => c.update(this.scrollY))
    this.renderer.render(this.scene, this.camera)
  }
}

/* owl modeled on a reference illustration the user provided: dramatic
   swept, pointed ear-tips flaring out from the top of one continuous
   silhouette (not small tufts sitting on a separate round body), angled
   brow cuts over big nearly-touching eyes, a diamond beak between them,
   and a body that tapers into two separated feet at the bottom. the
   outline is one smooth closed curve through a set of waypoints (mirrored
   left/right), traced with quadraticCurveTo through each pair's midpoint —
   verified with a PowerShell preview using this exact technique (not
   GDI+'s DrawCurve/AddClosedCurve spline, which reads close in a preview
   but doesn't match plain canvas curves — see the kite-tail lesson
   earlier in this file's history) before landing here. eyes/brows/beak
   are all destination-out cuts into that silhouette, with a pupil
   re-filled in each eye. no per-frame action — sampled once via the
   generic silhouettePositions helper. */
function drawOwlIcon(ctx, W, H) {
  ctx.fillStyle = '#fff'
  const cx = W * 0.5

  /* right-half waypoints [dx as fraction of W from center, y as fraction
     of H]; mirrored (reversed + negated dx) for the left half so the two
     halves join into one continuous loop */
  const right = [
    [0.00, 0.19], [0.30, 0.10], [0.27, 0.27], [0.30, 0.50],
    [0.24, 0.74], [0.16, 0.84], [0.11, 0.92], [0.05, 0.86], [0.00, 0.84],
  ]
  const left = [...right].reverse().map(([dx, y]) => [-dx, y])
  const pts = right.concat(left).map(([dx, y]) => [cx + dx * W, y * H])

  const n = pts.length
  const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]
  const m0 = mid(pts[n - 1], pts[0])
  ctx.beginPath()
  ctx.moveTo(m0[0], m0[1])
  for (let i = 0; i < n; i++) {
    const m = mid(pts[i], pts[(i + 1) % n])
    ctx.quadraticCurveTo(pts[i][0], pts[i][1], m[0], m[1])
  }
  ctx.closePath()
  ctx.fill()

  /* eyes, brows and beak are all cut out of the silhouette above */
  ctx.save()
  ctx.globalCompositeOperation = 'destination-out'

  const eyeR = W * 0.095
  const eyeLx = cx - W * 0.135, eyeRx = cx + W * 0.135, eyeY = H * 0.32
  ctx.beginPath()
  ctx.arc(eyeLx, eyeY, eyeR, 0, PI * 2)
  ctx.fill()
  ctx.beginPath()
  ctx.arc(eyeRx, eyeY, eyeR, 0, PI * 2)
  ctx.fill()

  const brow = sign => {
    ctx.beginPath()
    ctx.moveTo(cx + sign * W * 0.24, H * 0.20)
    ctx.lineTo(cx + sign * W * 0.06, H * 0.235)
    ctx.lineTo(cx + sign * W * 0.08, H * 0.265)
    ctx.lineTo(cx + sign * W * 0.24, H * 0.245)
    ctx.closePath()
    ctx.fill()
  }
  brow(-1)
  brow(1)

  ctx.beginPath()
  ctx.moveTo(cx, H * 0.29)
  ctx.lineTo(cx + W * 0.045, H * 0.335)
  ctx.lineTo(cx, H * 0.39)
  ctx.lineTo(cx - W * 0.045, H * 0.335)
  ctx.closePath()
  ctx.fill()

  ctx.restore()

  /* pupils re-filled inside the eye holes */
  ctx.fillStyle = '#fff'
  const pupR = W * 0.032
  ctx.beginPath()
  ctx.arc(eyeLx, eyeY, pupR, 0, PI * 2)
  ctx.fill()
  ctx.beginPath()
  ctx.arc(eyeRx, eyeY, pupR, 0, PI * 2)
  ctx.fill()
}

/* populated by buildOwlPositions the first (and only) time it runs.
   wingLeftMask/wingRightMask flag the outer shoulder-to-lower-body band on
   each side (the part of the outline standing in for folded wings) — Y
   is bounded to that band specifically so the classification doesn't also
   grab the ear tips or the feet, which also poke out past the same X
   threshold. pivotLeft/pivotRight are the shoulder points those bands
   rotate around. read every frame by ParticleSystem._applyOwlAction. */
let owlMeta = null

function buildOwlPositions(count) {
  const RES = 512, worldSize = 350, depthJitter = 25, xOffset = 300
  const half = worldSize / 2

  const cv = document.createElement('canvas')
  cv.width = RES; cv.height = RES
  const ctx = cv.getContext('2d')
  ctx.clearRect(0, 0, RES, RES)
  drawOwlIcon(ctx, RES, RES)
  const img = ctx.getImageData(0, 0, RES, RES).data
  const filled = []
  for (let y = 0; y < RES; y++) {
    for (let x = 0; x < RES; x++) {
      if (img[(y * RES + x) * 4 + 3] > 40) filled.push(x, y)
    }
  }

  const cxPx = RES * 0.5
  const WING_BAND_X = RES * 0.20
  /* the eyes sit at y=0.32, spanning roughly 0.225-0.415 — Y_LO must clear
     that range with margin, or the cheek silhouette right beside the eye
     (same height, past the X threshold) gets swept into the wing mask and
     rotates away with it, reading as "a piece of the eye becoming a wing" */
  const WING_BAND_Y_LO = RES * 0.44, WING_BAND_Y_HI = RES * 0.78

  const result = new Float32Array(count * 3)
  const wingLeftMask = new Uint8Array(count)
  const wingRightMask = new Uint8Array(count)

  if (filled.length > 0) {
    for (let i = 0; i < count; i++) {
      const idx = (Math.random() * (filled.length / 2) | 0) * 2
      const px = filled[idx], py = filled[idx + 1]
      const jx = (Math.random() - 0.5) * (worldSize / RES) * 1.6
      const jy = (Math.random() - 0.5) * (worldSize / RES) * 1.6
      result[i * 3]     = (px / RES) * worldSize - half + jx + xOffset
      result[i * 3 + 1] = -((py / RES) * worldSize - half) + jy
      result[i * 3 + 2] = (Math.random() - 0.5) * depthJitter

      if (py > WING_BAND_Y_LO && py < WING_BAND_Y_HI) {
        const dx = px - cxPx
        if (dx < -WING_BAND_X) wingLeftMask[i] = 1
        else if (dx > WING_BAND_X) wingRightMask[i] = 1
      }
    }
  } else {
    for (let i = 0; i < count; i++) {
      result[i * 3]     = (Math.random() - 0.5) * worldSize + xOffset
      result[i * 3 + 1] = (Math.random() - 0.5) * worldSize
      result[i * 3 + 2] = (Math.random() - 0.5) * depthJitter
    }
  }

  const pivotFromPx = (px, py) => ({
    x: (px / RES) * worldSize - half + xOffset,
    y: -((py / RES) * worldSize - half),
  })

  owlMeta = {
    wingLeftMask, wingRightMask,
    pivotLeft:  pivotFromPx(cxPx - RES * 0.20, RES * 0.42),
    pivotRight: pivotFromPx(cxPx + RES * 0.20, RES * 0.42),
    basePositions: result.slice(),
  }
  return result
}

/* Danilo wanted 100% fidelity to a real fingerprint photo, not a
   procedural approximation. Loading that photo as an <img> at runtime
   made this shape the ONLY one in PARTICLE_SHAPES with an async
   dependency — every other build() below is a synchronous canvas draw.
   That gap was the actual bug (a refresh landing already-scrolled here
   could show an unformed cloud while the photo loaded), and three
   different patches on top of the async load (a fallback cluster, a
   rebuild-on-load, an activation gate) never fully closed it — they just
   moved the symptom around. Real fix: the dark-ink pixel coordinates were
   extracted from the photo ONCE, offline (a PowerShell/.NET one-off, not
   checked in), and are baked in below as plain data. No <img>, no canvas,
   no waiting, ever — buildFingerprintPositions is exactly as synchronous
   as buildCompassPositions or any other shape's builder now. */
const FINGERPRINT_PIXELS_RES = 256
const FINGERPRINT_PIXELS_B64 = "LQAtAC4ALgAvAC8AMAAwADEAMQAyADIAMwAzADQANAA1ADUANgA2ADcANwA4ADgAOQA5ADoAOgA7ADsAPAA8AD0APQA+AD4APwA/AEAAQABBAEEAQgBCAEMAQwBEAEQARQBFAEYARgBHAEcASABIAEkASQBKAEoASwBLAEwATABNAE0ATgBOAE8ATwBQAFAAUQBRAFIAUgBTAFMAVABUAFUAVQBWAFYAVwBXAFgAWABZAFkAWgBaAFsAWwBcAFwAXQBdAF4AXgBfAF8AYABgAGEAYQBiAGIAYwBjAGQAZABlAGUAZgBmAGcAZwBoAGgAaQBpAGoAagBrAGsAbABsAG0AbQBuAG4AbwBvAHAAcABxAHEAcgByAHMAcwB0AHQAdQB1AHYAdgB3AHcAeAB4AHkAeQB6AHoAewB7AHwAfAB9AH0AfgB+AH8AfwCAAIAAgQCBAIIAggCDAIMAhACEAIUAhQCGAIYAhwCHAIgAiACJAIkAigCKAIsAiwCMAIwAjQCNAI4AjgCPAI8AkACQAJEAkQCSAJIAkwCTAJQAlACVAJUAlgCWAJcAlwCYAJgAmQCZAJoAmgCbAJsAnACcAJ0AnQCeAJ4AnwCfAKAAoAChAKEAogCiAKMAowCkAKQApQClAKYApgCnAKcAqACoAKkAqQCqAKoAqwCrAKwArACtAK0ArgCuAK8ArwCwALAAsQCxALIAsgCzALMAtAC0ALUAtQC2ALYAtwC3ALgAuAC5ALkAugC6ALsAuwC8ALwAvQC9AL4AvgC/AL8AwADAAMEAwQDCAMIAwwDDAMQAxADFAMUAxgDGAMcAxwDIAMgAyQDJAMoAygDLAMsAzADMAM0AzQDOAM4AzwDPANAA0ADRANEA0gDSAC0ALQDRANIA0gAtAS0B0QHSAdIBLQEtAdEB0gHSAS0CLQLRAtIC0gItAi0C0QLSAtICLQMtA9ED0gPSAy0DLQPRA9ID0gMtBC0E0QTSBNIELQQtBNEE0gTSBC0FLQXRBdIF0gUtBS0F0QXSBdIFLQYtBtEG0gbSBi0GLQbRBtIG0gYtBy0H0QfSB9IHLQctB9EH0gfSBy0ILQjRCNII0ggtCC0I0QjSCNIILQktCdEJ0gnSCS0JLQnRCdIJ0gktCi0K0QrSCtIKLQotCnsKewp8CnwKfQrRCtIK0gotCy0Lewt7C3wLfAt9C9EL0gvSCy0LLQt6C3oLewt7C3wLfAt9C30LgAuAC4ELhAuEC40LjQuOC44LjwvRC9IL0gstDC0Megx6DHsMewx8DHwMfQyADIEMigyLDI0MjQyODI4MjwyPDJAMkAyTDNEM0gzSDC0MLQx6DHoMewx7DHwMfAx9DIAMgQyKDIsMjQyNDI4MjgyPDI8MkAyQDJMM0QzSDNIMLQ0tDXoNeg17DXsNfA2ODY4Njw2PDZANkA2TDdEN0g3SDS0NLQ16DXoNew17DXwNjg2ODY8Njw2QDZANkw3RDdIN0g0tDi0OmQ6aDtEO0g7SDi0OLQ6EDoQOhQ6FDoYOhg6HDpkOmg6aDpsOmw7RDtIO0g4tDy0PhA+ED4UPhQ+GD4YPhw+ZD5oPmg+bD5sP0Q/SD9IPLQ8tD4QPhA+FD4UPhg+GD4cPhw+ID4gPiQ+JD4oPig+LD4sPjA+MD40PjQ+OD5oPmw+bD9EP0g/SDy0QLRCEEIQQhRCFEIYQhhCHEIcQiBCIEIkQiRCKEIoQixCLEIwQjBCNEI0QjhCaEJsQmxDRENIQ0hAtEC0QehB6EHsQexB8EHwQfRB9EIYQhxCHEIgQiBCJEIkQihCKEIsQixCMEIwQjRCNEI4QjhCPEI8QkBCQEJEQkRDRENIQ0hAtES0RbBFsEW0RcBFwEXERcRFyEXIRcxFzEXQRdBF1EXURdhF2EXgReRF5EXoRehF7EXsRfBF8EX0RfRF+EX4RfxF/EYARgBGBEYERghGJEYoRihGLEY4RjhGPEY8RkBGQEZERkRGSEZIRkxHREdIR0hEtES0RbBFsEW0RcBFwEXERcRFyEXIRcxFzEXQRdBF1EXURdhF2EXgReRF5EXoRehF7EXsRfBF8EX0RfRF+EX4RfxF/EYARgBGBEYERghGJEYoRihGLEY4RjhGPEY8RkBGQEZERkRGSEZIRkxHREdIR0hEtEi0SbBJsEm0SbRJuEm8ScBJwEnEScRJyEnIScxJzEnQSdBJ1EnUSdhJ2EngSeRJ5EnoSehJ7EnsSfBJ8En0SfRJ+En4SfxJ/EoASgBKBEoESghKCEoMSgxKEEoQShRKFEoYSjxKQEpASkRKREpISkhKTEpMSlBKUEpUSlRLREtIS0hItEi0SbBJsEm0SbRJuEm8ScBJwEnEScRJyEnIScxJzEnQSdBJ1EnUSdhJ2EngSeRJ5EnoSehJ7EnsSfBJ8En0SfRJ+En4SfxJ/EoASgBKBEoESghKCEoMSgxKEEoQShRKFEoYSjxKQEpASkRKREpISkhKTEpMSlBKUEpUSlRLREtIS0hItEy0TbRNzE3QTdBN1E3UTeRN5E3oTehN7E34TfhN/E38TgBOAE4ETgROCE4ITgxODE4QThBOFE4UThhOGE4cThxOSE5ITkxOTE5QTlBOVE5UTlhOWE5cTlxOYE9ET0hPSEy0TLRODE4MThBOEE4UThROGE4YThxOHE4gTiBOJE4kTihOLE4wTjBONE40TjhOOE48TlBOVE5UTlhOWE5cTlxOYE5wT0RPSE9ITLRQtFIMUgxSEFIQUhRSFFIYUhhSHFIcUiBSIFIkUiRSKFIsUjBSMFI0UjRSOFI4UjxSUFJUUlRSWFJYUlxSXFJgUnBTRFNIU0hQtFC0UihSLFIsUjBSMFI0UjRSOFI4UjxSPFJAUkBSWFJYUlxSXFJsUmxScFJwUnRTRFNIU0hQtFS0VihWLFYsVjBWMFY0VjRWOFY4VjxWPFZAVkBWWFZYVlxWXFZsVmxWcFZwVnRXRFdIV0hUtFS0VbhVvFW8VjBWMFY0VjRWOFY4VjxWPFZAVkBWbFZsVnBWcFZ0VnRWeFZ4VnxWfFaAVoBXRFdIV0hUtFi0WaxZrFmwWbBZtFm0WbhZuFm8WbxZ7FnwWfBZ9Fn0WfhZ+Fo4WjxaPFpAWnBadFp0WnhaeFp8WnxagFqAWoRahFqIW0RbSFtIWLRYtFmsWaxZsFmwWbRZtFm4WbhZvFm8WexZ8FnwWfRZ9Fn4WfhaOFo8WjxaQFpwWnRadFp4WnhafFp8WoBagFqEWoRaiFtEW0hbSFi0XLRdoF2gXaRdpF2oXahdrF2sXbBdsF20XeBd5F3kXehd6F3sXexd8F3wXfRd9F34Xfhd/F38XgBeAF4EXgReCF4IXgxeDF4QXhBeFF4UXhheGF4cXiReJF4oXnReeF54XnxefF6AXoBehF6EXoheiF6MXoxfRF9IX0hctFy0XaBdoF2kXaRdqF2oXaxdrF2wXbBdtF3gXeRd5F3oXehd7F3sXfBd8F30XfRd+F34Xfxd/F4AXgBeBF4EXgheCF4MXgxeEF4QXhReFF4YXhheHF4kXiReKF50XnheeF58XnxegF6AXoRehF6IXohejF6MX0RfSF9IXLRgtGGYYZhhnGGcYaBhoGGkYaRhqGGoYaxhrGGwYbBhtGHQYdRh1GHYYdhh4GHkYeRh6GHoYexh7GHwYfBh9GH0Yfhh+GH8YfxiAGIAYgRiBGIIYghiDGIMYhBiEGIUYhRiGGIYYhxiHGIgYiBiJGIkYihiKGIsYixiMGIwYjRiNGJ4YoBigGKEYoRiiGKIYoxijGKQYpBimGKYYpxjRGNIY0hgtGC0YZBhlGGUYZhhmGGcYZxhoGGgYaRhpGGoYaxhrGGwYbBhxGHEYchhyGHMYcxh0GHQYdRh1GHYYdhh8GH0YfRh+GH4YhBiEGIUYhRiGGIYYhxiHGIgYiBiJGIkYihiKGIsYixiMGIwYjRiNGI4YjhiPGI8YkBiQGJEYkRiSGJIYkxiTGJQYlBiVGJUYlhiWGJcYlxiYGKIYoxijGKQYpBilGKUYphimGKcYpxioGNEY0hjSGC0ZLRlkGWUZZRlmGWYZZxlnGWgZaBlpGWkZahlrGWsZbBlsGXEZcRlyGXIZcxlzGXQZdBl1GXUZdhl2GXwZfRl9GX4ZfhmEGYQZhRmFGYYZhhmHGYcZiBmIGYkZiRmKGYoZixmLGYwZjBmNGY0ZjhmOGY8ZjxmQGZAZkRmRGZIZkhmTGZMZlBmUGZUZlRmWGZYZlxmXGZgZohmjGaMZpBmkGaUZpRmmGaYZpxmnGagZ0RnSGdIZLRktGWQZZBllGWUZZhlmGWcZZxloGW0ZbhluGW8ZbxlwGXAZcRlxGXIZchlzGXMZdBl0GY0ZjRmOGY8ZkBmQGZEZkRmSGZIZkxmTGZQZlhmWGZcZlxmYGZgZmRmZGZoZmhmlGaUZphmmGacZpxmoGdEZ0hnSGS0aLRpkGmQaZRplGmYaZhpnGmcaaBptGm4abhpvGm8acBpwGnEacRpyGnIacxpzGnQadBqNGo0ajhqPGpAakBqRGpEakhqSGpMakxqUGpYalhqXGpcamBqYGpkamRqaGpoapRqlGqYaphqnGqcaqBrRGtIa0hotGi0aXxpgGmAaYRptGm0abhpuGm8abxpwGnAacRpxGpAakRqRGpUalhqWGpcalxqYGpgamRqZGpoamhqmGqYapxqnGqgaqBrRGtIa0hotGy0bXxtgG2AbYRthG2sbaxtsG2wbbRttG24bbhtvG28blxuXG5gbmBuZG5kbmhuaG5sbmxucG5wbnRudG54bnhufG58boBugG6EbphunG6cbqBuoG9Eb0hvSGy0bLRtfG2AbYBthG2EbaxtrG2wbbBttG20bbhtuG28bbxuXG5cbmBuYG5kbmRuaG5obmxubG5wbnBudG50bnhueG58bnxugG6AboRumG6cbpxuoG6gb0RvSG9IbLRwtHF8cYBxgHGEcahxrHGscbBxsHHcceBx4HHkceRx6HHocexyFHIYchhyHHIcciByIHIkciRyKHJscmxycHJwcnRydHJ4cnhyfHJ8coBygHKEcoRyiHKIcoxzRHNIc0hwtHC0cXRxdHF4cXhxlHGYcZhxnHGccaBxqHGscaxx2HHYcdxx3HHgceBx5HHkcehx6HHschRyFHIYchhyHHIcciByIHIkciRyKHIocixyLHIwcjByNHI0cjhyOHI8cjxyQHJ0cnhyeHJ8cnxygHKAcoRyhHKIcohyjHKMcpBykHNEc0hzSHC0dLR1dHV0dXh1eHWUdZh1mHWcdZx1oHWodax1rHXYddh13HXcdeB14HXkdeR16HXodex2FHYUdhh2GHYcdhx2IHYgdiR2JHYodih2LHYsdjB2MHY0djR2OHY4djx2PHZAdnR2eHZ4dnx2fHaAdoB2hHaEdoh2iHaMdox2kHaQd0R3SHdIdLR0tHV0dXR1kHWUdZR1mHWYdZx1nHWgdch1yHXMddB11HXUddh12HXcddx14HXgdeR15HXodeh17HYUdhR2GHYYdhx2HHYgdiB2JHYkdih2KHYsdix2MHYwdjR2NHY4djh2PHY8dkB2QHZEdkR2SHZIdnx2fHaAdoB2hHaEdoh2iHaMdox2kHaQdpR2lHaYd0R3SHdIdLR4tHl0eXR5kHmUeZR5mHmYeZx5nHmgech5yHnMedB51HnUedh52Hncedx54HngeeR55Hnoeeh57HoUehR6GHoYehx6HHogeiB6JHokeih6KHoseix6MHowejR6NHo4ejh6PHo8ekB6QHpEekR6SHpIenx6fHqAeoB6hHqEeoh6iHqMeox6kHqQepR6lHqYe0R7SHtIeLR4tHmMeYx5kHmQeZR5lHmYeZh5nHmcecB5wHnEecR5yHnIecx50HnUedR52HnYedx53HngeeB6GHocehx6MHowejR6NHo4ejh6PHo8ekB6QHpEekR6SHpIekx6THpQelB6VHpcelx6fHp8eoB6gHqEeoR6iHqIeox6jHqQepB6lHqUeph6mHqce0R7SHtIeLR8tH1kfWR9aH2EfYh9iH2MfYx9kH2QfZR9uH28fbx9wH3AfcR9xH3IfdR91H44fjx+PH5AfkB+RH5Efkh+SH5Mfkx+UH5QflR+VH5Yflh+XH5cfmB+YH5kfmR+aH6MfpB+kH6UfpR+mH6Yfpx+nH6gf0R/SH9IfLR8tH1kfWR9aH2EfYh9iH2MfYx9kH2QfZR9uH28fbx9wH3AfcR9xH3IfdR91H44fjx+PH5AfkB+RH5Efkh+SH5Mfkx+UH5QflR+VH5Yflh+XH5cfmB+YH5kfmR+aH6MfpB+kH6UfpR+mH6Yfpx+nH6gf0R/SH9IfLSAtIF8gYCBgIGEgYSBtIG4gbiBvIG8gcCBwIHEgcSByIJMgkyCUIJQglSCWIJYglyCXIJggmCCZIJkgmiCaIJsgmyCcIJwgnSCdIJ4gpSClIKYgpiCnIKcgqCCoIKkgqSDRINIg0iAtIC0gXyBgIGAgYSBhIG0gbiBuIG8gbyBwIHAgcSBxIHIgkyCTIJQglCCVIJYgliCXIJcgmCCYIJkgmSCaIJogmyCbIJwgnCCdIJ0gniClIKUgpiCmIKcgpyCoIKggqSCpINEg0iDSIC0hLSFeIV4hXyFfIWAhYCFhIWkhaiFqIWshayFvIYMhgyGEIYQhmCGYIZkhmSGaIZohmyGbIZwhnCGdIZ0hniGeIZ8hnyGgIaAhpiGnIachqCGoIakhqSGqIaoh0SHSIdIhLSEtIV0hXSFeIV4hXyFfIWAhYCFhIWkhaiFqIXUhdSF2IXYhdyF3IXgheCF5IXkheiF6IXsheyF8IYIhgyGDIYQhhCGFIYUhhiGGIYchhyGIIYghiSGJIYohjCGMIY0hjSGOIZohmyGbIZwhnCGdIZ0hniGeIZ8hnyGgIaAhoSGpIakhqiGqIawhrSHRIdIh0iEtIi0iXSJdIl4iXiJfIl8iYCJgImEiaSJqImoidSJ1InYidiJ3IncieCJ4InkieSJ6InoieyJ7InwigiKDIoMihCKEIoUihSKGIoYihyKHIogiiCKJIokiiiKMIowijSKNIo4imiKbIpsinCKcIp0inSKeIp4inyKfIqAioCKhIqkiqSKqIqoirCKtItEi0iLSIi0iLSJVIlUiViJbIlwiXCJdIl0iXiJeIl8iXyJgImUiZiJmImciZyJyInUidSJ2InYidyJ3IngieCJ5InkieiJ6InsigyKDIoQihCKFIoUihiKGIocihyKIIogiiSKJIooijCKMIo0ijSKOIo4ijyKPIpAikCKRIpEikiKSIpMikyKUIpQilSKbIpsinCKcIp0inSKeIp4inyKfIqAioCKhIqoiqiKrIqsirCKsIq0irSKuIq4i0SLSItIiLSMtI1UjVSNWI1sjXCNcI10jXSNeI14jXyNfI2AjZSNmI2YjZyNnI3IjdSN1I3YjdiN3I3cjeCN4I3kjeSN6I3ojeyODI4MjhCOEI4UjhSOGI4YjhyOHI4gjiCOJI4kjiiOMI4wjjSONI44jjiOPI48jkCOQI5EjkSOSI5IjkyOTI5QjlCOVI5sjmyOcI5wjnSOdI54jniOfI58joCOgI6EjqiOqI6sjqyOsI6wjrSOtI64jriPRI9Ij0iMtIy0jVSNVI1YjWiNbI1sjXCNcI10jXSNeI14jXyNkI2UjZSNmI2YjZyNnI28jcCNwI3EjcSNyI3UjdSN2I3YjdyN3I3gjeCN5I3kjeiN6I3sjhCOEI40jjSOOI44jjyOPI5AjkCORI5EjkiOSI5MjkyOUI5QjlSOVI5YjliOdI54jniOfI58joCOgI6EjoSOiI6sjrCOsI60jrSOuI64jryPRI9Ij0iMtJC0kWiRaJFskWyRcJFwkYyRjJGQkZCRlJGUkZiRmJG0kbiRuJG8kbyRwJHAkkSSRJJIkkiSTJJMklCSUJJUklSSWJJYklySXJJ4knySfJKAkoCShJKMkpCSkJKUkpSSmJKYkpyStJK4kriSvJK8ksCTRJNIk0iQtJC0kWiRaJFskWyRcJFwkYyRjJGQkZCRlJGUkZiRmJG0kbiRuJG8kbyRwJHAkkSSRJJIkkiSTJJMklCSUJJUklSSWJJYklySXJJ4knySfJKAkoCShJKMkpCSkJKUkpSSmJKYkpyStJK4kriSvJK8ksCTRJNIk0iQtJS0lWSVZJVolWiVbJWElYiViJWMlYyVkJWQlZSVsJWwlbSVtJW4lbiVvJW8lkyWTJZQllCWVJZUlliWWJZcllyWYJZglmSWjJaQlpCWlJaUlpiWmJaclpyWoJaglqSWpJa8lryWwJdEl0iXSJS0lLSVZJVklWiVaJVslYSViJWIlYyVjJWQlZCVlJWwlbCVtJW0lbiVuJW8lbyWTJZMllCWUJZUllSWWJZYllyWXJZglmCWZJaMlpCWkJaUlpSWmJaYlpyWnJaglqCWpJaklryWvJbAl0SXSJdIlLSYtJlcmWCZYJlkmWSZaJmAmYSZhJmImYiZjJmMmZCZqJmsmayZsJmwmbSZtJm4mgiaDJoMmhCaEJoYmhyaHJogmiCaJJokmiiaKJosmiyaMJowmlSaWJpYmlyaXJpgmmCaZJpkmmiaaJpsmmyacJqUmpSamJqYmpyanJqgmqCapJqkmqiaqJq8msCawJrEm0SbSJtImLSYtJlUmViZWJlcmVyZYJlgmWSZZJl4mXiZfJl8mYCZgJmEmYSZiJmImYyZjJmgmaSZpJmomaiZrJmsmbCZsJnUmdSZ2JnYmdyZ3JngmeCZ+Jn4mfyZ/JoAmgCaBJoEmgiaCJoMmgyaEJoQmhSaFJoYmhiaHJocmiCaIJokmiSaKJoomiyaLJowmjCaNJo0mmCaYJpkmmSaaJpommyabJpwmnCadJp0mniamJqcmpyaoJqgmqSapJqomqiarJtEm0ibSJi0nLSdVJ1YnVidXJ1cnWCdYJ1knWSdeJ14nXydfJ2AnYCdhJ2EnYidiJ2MnYydoJ2knaSdqJ2onaydrJ2wnbCd1J3Undid2J3cndyd4J3gnfid+J38nfyeAJ4AngSeBJ4IngieDJ4MnhCeEJ4UnhSeGJ4YnhyeHJ4gniCeJJ4kniieKJ4sniyeMJ4wnjSeNJ5gnmCeZJ5knmieaJ5snmyecJ5wnnSedJ54npienJ6cnqCeoJ6knqSeqJ6onqyfRJ9In0ictJy0nVCdUJ1UnVSdWJ1YnVydXJ1gnWCddJ10nXideJ18nXydgJ2AnYSdmJ2YnZydnJ2gnaCdpJ2knaidxJ3EncidyJ3MndSd1J3Yndid3J3cneCd4J3kneSd9J34nfid/J38ngCeAJ4EngSeCJ4IngyeDJ4QnhCeFJ4UnhieGJ4cnhyeIJ4gniSeJJ4oniieLJ4snjCeMJ40njSeOJ44njyePJ5AnkCeRJ5EnkieSJ5MnmSeaJ5onmyebJ5wnnCedJ50nnieeJ58nnyegJ6AnqCepJ6knqieqJ6snqyesJ6wnrSfRJ9In0ictKC0oVChUKFUoVShWKFYoVyhXKFgoWChdKF0oXiheKF8oXyhgKGAoYShmKGYoZyhnKGgoaChpKGkoaihxKHEocihyKHModSh1KHYodih3KHcoeCh4KHkoeSh9KH4ofih/KH8ogCiAKIEogSiCKIIogyiDKIQohCiFKIUohiiGKIcohyiIKIgoiSiJKIooiiiLKIsojCiMKI0ojSiOKI4ojyiPKJAokCiRKJEokiiSKJMomSiaKJoomyibKJwonCidKJ0oniieKJ8onyigKKAoqCipKKkoqiiqKKsoqyisKKworSjRKNIo0igtKC0oUyhTKFQoVChVKFUoVihWKFcoXChdKF0oXiheKF8oZShmKGYoZyhnKGgobyhwKHAocShxKHIocihzKI4ojyiPKJAokCiRKJEokiiSKJMokyiUKJQolSiVKJYoliiXKJcomyibKJwonCidKJ0oniieKJ8onyigKKAooSihKKIooiijKKMopCikKKkoqSiqKKooqyirKKworCitKK0oriiuKNEo0ijSKC0pLSlTKVMpWylcKVwpXSldKWQpZSllKWYpZilnKWcpbSluKW4pbylvKXApcClxKXEpcimTKZQplCmVKZUplimWKZcplymYKZgpmSmdKZ4pnimfKZ8poCmgKaEpoSmiKaIpoymjKaQppCmlKaUppimrKawprCmtKa0primuKa8p0SnSKdIpLSktKVMpUylbKVwpXCldKV0pZCllKWUpZilmKWcpZyltKW4pbilvKW8pcClwKXEpcSlyKZMplCmUKZUplSmWKZYplymXKZgpmCmZKZ0pnimeKZ8pnymgKaApoSmhKaIpoimjKaMppCmkKaUppSmmKasprCmsKa0prSmuKa4prynRKdIp0iktKi0qWSpZKloqWipbKlsqXCpcKmIqYipjKmMqZCpkKmUqbCpsKm0qbSpuKm4qbypvKnAqcCp3KncqeCp4KpQqlSqVKpYqliqXKpcqmCqYKpkqmSqaKpoqnyqfKqAqoCqhKqEqoiqiKqMqoyqkKqQqpSqlKqYqpiqnKqwqrSqtKq4qriqvKq8qsCrRKtIq0iotKi0qWSpZKloqWipbKlsqXCpcKmIqYipjKmMqZCpkKmUqbCpsKm0qbSpuKm4qbypvKnAqcCp3KncqeCp4KpQqlSqVKpYqliqXKpcqmCqYKpkqmSqaKpoqnyqfKqAqoCqhKqEqoiqiKqMqoyqkKqQqpSqlKqYqpiqnKqwqrSqtKq4qriqvKq8qsCrRKtIq0iotKy0rUStXK1grWCtZK1krWitaK1srYStiK2IrYytjK2QraitrK2srbCtsK20rbStuK3Yrdit3K3creCt4K3kreSuBK4IrhCuEK4UriiuLK4srjCuMK40rjSuOK44rjyuXK5crmCuYK5krmSuaK5ormyubK6EroSuiK6IroyujK6QrpCulK6UrpiumK6crpyuoK6grrSuuK64rryuvK7ArsCuxK9Er0ivSKy0rLStVK1UrVitWK1crVytYK1grWStZK2ArYSthK2IrYitjK2MraCtoK2kraStqK2oraytrK3IrdCt1K3Urdit2K3crdyt4K3grfSt+K34rfyt/K4ArgCuBK4ErgiuEK4QrhSuFK4YrhiuHK4criCuIK4kriSuKK4oriyuLK4wrjCuNK40rjiuOK48rjyuQK5ArkSuRK5grmSuZK5ormiubK5srnCucK50roSuiK6IroyujK6QrpCumK6crpyuoK6grqSupK6orqiuuK64rryuvK7ArsCuxK7ErsiuyK9Er0ivSKy0sLSxVLFUsVixWLFcsVyxYLFgsWSxZLGAsYSxhLGIsYixjLGMsaCxoLGksaSxqLGosayxrLHIsdCx1LHUsdix2LHcsdyx4LHgsfSx+LH4sfyx/LIAsgCyBLIEsgiyELIQshSyFLIYshiyHLIcsiCyILIksiSyKLIosiyyLLIwsjCyNLI0sjiyOLI8sjyyQLJAskSyRLJgsmSyZLJosmiybLJssnCycLJ0soSyiLKIsoyyjLKQspCymLKcspyyoLKgsqSypLKosqiyuLK4sryyvLLAssCyxLLEssiyyLNEs0izSLC0sLSxULFQsVSxVLFYsVixXLFcsWCxYLF8sXyxgLGAsYSxhLGIsYixmLGYsZyxnLGgsaCxpLHAscCxxLHEscixyLHMscyx0LHQsdSx1LHYsdix3LHwsfSx9LH4sfix/LH8sgCyALIEsiyyMLIwsjSyNLI4sjiyPLI8skCyQLJEskSySLJIskyycLJwsnSydLJ4sniyfLJ8soiyjLKMspCykLKcsqCyoLKksqSyqLKosqyyvLLAssCyxLLEssiyyLLMssyy0LNEs0izSLC0tLS1ULVQtVS1VLVYtVi1XLVctWC1YLV8tXy1gLWAtYS1hLWItYi1mLWYtZy1nLWgtaC1pLXAtcC1xLXEtci1yLXMtcy10LXQtdS11LXYtdi13LXwtfS19LX4tfi1/LX8tgC2ALYEtiy2MLYwtjS2NLY4tji2PLY8tkC2QLZEtkS2SLZItky2cLZwtnS2dLZ4tni2fLZ8toi2jLaMtpC2kLactqC2oLaktqS2qLaotqy2vLbAtsC2xLbEtsi2yLbMtsy20LdEt0i3SLS0tLS1TLVMtVC1ULVUtVS1WLVYtVy1XLV4tXi1fLV8tYC1gLWEtZS1mLWYtZy1nLWgtaC1pLW0tbi1uLW8tby1wLXAtcS1xLXItci1zLXMtdC17LXstfC18LX0tfS1+LX4tfy1/LY4tji2PLY8tkC2QLZEtkS2SLZItky2TLZQtlC2VLZUtli2WLZwtnS2dLZ4tni2fLZ8toC2gLaMtpC2kLaUtpS2mLagtqS2pLaotqi2rLastrC2sLa0tsS2yLbItsy2zLbQt0S3SLdItLS4tLlIuUy5TLlQuVC5VLlUuVi5dLl0uXi5eLl8uZS5mLmYuZy5nLmgubS5tLm4ubi5vLm8ucC5wLnEucS5yLnkueS56Lnouey57LnwufC59Ln0ufi5+LpQulS6VLpYuli6XLpcumC6YLpkunS6eLp4uny6fLqAuoC6hLqEuoi6kLqQupS6lLqYupi6nLqouqi6rLqsurC6sLq0urS6zLrMutC60LrUu0S7SLtIuLS4tLlIuUy5TLlQuVC5VLlUuVi5dLl0uXi5eLl8uZS5mLmYuZy5nLmgubS5tLm4ubi5vLm8ucC5wLnEucS5yLnkueS56Lnouey57LnwufC59Ln0ufi5+LpQulS6VLpYuli6XLpcumC6YLpkunS6eLp4uny6fLqAuoC6hLqEuoi6kLqQupS6lLqYupi6nLqouqi6rLqsurC6sLq0urS6zLrMutC60LrUu0S7SLtIuLS8tL1EvUi9SL1MvUy9UL1QvVS9cL10vXS9eL14vZC9kL2UvZS9mL2YvZy9nL2svay9sL2wvbS9tL24vdy93L3gveC95L3kvei96L3svey98L3wvfS+DL4MvhC+EL4UvhS+GL4Yvhy+HL4gviC+VL5Yvli+XL5cvmC+YL5kvny+fL6AvoC+hL6Evoi+iL6MvpS+lL6Yvpi+nL6cvqC+rL6wvrC+tL60vri+uL7QvtC+1L7Uvti/RL9Iv0i8tLy0vUC9QL1EvUS9SL1IvUy9TL1QvVC9bL1wvXC9dL10vYy9jL2QvZC9lL2ovay9rL2wvbC93L3cveC+AL4EvgS+CL4Ivgy+DL4QvhC+FL4Uvhi+GL4cvhy+IL4gviS+JL4ovii+LL4svjC+ML40vjS+XL5cvmC+YL5kvmS+aL5ovmy+bL5wvoC+gL6EvoS+iL6Ivoy+jL6QvpC+lL6Uvpi+mL6cvpy+oL6gvrC+tL60vri+uL68vry+wL7QvtS+1L7Yvti/RL9Iv0i8tMC0wUDBQMFEwUTBSMFIwUzBTMFQwVDBbMFwwXDBdMF0wYzBjMGQwZDBlMGowazBrMGwwbDB3MHcweDCAMIEwgTCCMIIwgzCDMIQwhDCFMIUwhjCGMIcwhzCIMIgwiTCJMIowijCLMIswjDCMMI0wjTCXMJcwmDCYMJkwmTCaMJowmzCbMJwwoDCgMKEwoTCiMKIwozCjMKQwpDClMKUwpjCmMKcwpzCoMKgwrDCtMK0wrjCuMK8wrzCwMLQwtTC1MLYwtjDRMNIw0jAtMC0wTjBPME8wUDBQMFEwUTBSMFIwUzBTMFgwWDBZMFkwWjBaMFswWzBcMFwwYjBiMGMwYzBoMGkwaTBqMGowazBrMH8wfzCAMIAwgTCBMIIwgjCDMIMwhDCEMIUwhTCGMIYwhzCHMIgwiDCJMIkwijCKMIswizCMMIwwjTCNMI4wjjCPMI8wkDCQMJEwkTCSMJIwkzCZMJowmjCbMJswnDCcMJ0wnTCeMKEwojCiMKMwozCkMKQwpTClMKYwqDCuMK4wrzCvMLAwsDCxMLEwtTC2MLYw0TDSMNIwLTEtMU4xTzFPMVAxUDFRMVExUjFSMVMxUzFYMVgxWTFZMVoxWjFbMVsxXDFcMWIxYjFjMWMxaDFpMWkxajFqMWsxazF/MX8xgDGAMYExgTGCMYIxgzGDMYQxhDGFMYUxhjGGMYcxhzGIMYgxiTGJMYoxijGLMYsxjDGMMY0xjTGOMY4xjzGPMZAxkDGRMZExkjGSMZMxmTGaMZoxmzGbMZwxnDGdMZ0xnjGhMaIxojGjMaMxpDGkMaUxpTGmMagxrjGuMa8xrzGwMbAxsTGxMbUxtjG2MdEx0jHSMS0xLTFNMU4xTjFPMU8xUDFQMVExUTFSMVIxVzFYMVgxWTFZMVoxWjFbMVsxXDFhMWcxZzFoMWgxaTFpMWoxajFwMXAxcTFxMXIxcjFzMX0xfjF+MX8xfzGAMYAxgTGBMYIxgjGPMZAxkDGRMZExkjGSMZMxkzGUMZQxlTGVMZoxmzGbMZwxnDGdMZ0xnjGeMaIxozGjMaQxpDGlMaUxpjGvMbAxsDGxMbExsjGyMdEx0jHSMS0yLTJMMk0yTTJOMk4yTzJPMlAyUDJRMlUyVjJWMlcyVzJYMlgyWTJZMloyYDJhMmYyZjJnMmcyaDJuMm8ybzJwMnAycTJxMnIyezJ7MnwyfDJ9Mn0yfjJ+Mn8yfzKAMoAygTKTMpMylDKUMpUylTKWMpYylzKXMpwynDKdMp0ynjKeMp8ynzKgMqAyozKkMqQypTKlMqYypjKnMqsyrDKsMq0ysDKxMrEysjKyMrMyszK0MtEy0jLSMi0yLTJMMk0yTTJOMk4yTzJPMlAyUDJRMlUyVjJWMlcyVzJYMlgyWTJZMloyYDJhMmYyZjJnMmcyaDJuMm8ybzJwMnAycTJxMnIyezJ7MnwyfDJ9Mn0yfjJ+Mn8yfzKAMoAygTKTMpMylDKUMpUylTKWMpYylzKXMpwynDKdMp0ynjKeMp8ynzKgMqAyozKkMqQypTKlMqYypjKnMqsyrDKsMq0ysDKxMrEysjKyMrMyszK0MtEy0jLSMi0zLTNMM0wzTTNNM04zTjNPM08zVTNVM1YzVjNXM1czWDNYM1kzWTNaM14zXjNfM18zYDNmM2YzcDNwM3kzeTN6M3ozezN7M3wzfDN9M30zfjN+M38zfzOUM5UzlTOWM5YzlzOXM5gzmDOZM5kzmjOdM54znjOfM58zoDOgM6EzpTOlM6YzpjOnM6czqDOoM6szrDOsM60zrTOxM7IzsjOzM7MztDO0M7UztTO2M9Ez0jPSMy0zLTNMM0wzTTNNM04zTjNPM08zVTNVM1YzVjNXM1czWDNYM1kzWTNaM14zXjNfM18zYDNmM2YzcDNwM3kzeTN6M3ozezN7M3wzfDN9M30zfjN+M38zfzOUM5UzlTOWM5YzlzOXM5gzmDOZM5kzmjOdM54znjOfM58zoDOgM6EzpTOlM6YzpjOnM6czqDOoM6szrDOsM60zrTOxM7IzsjOzM7MztDO0M7UztTO2M9Ez0jPSMy00LTRLNEs0TDRMNE00TTRONE40UzRTNFQ0VDRVNFU0VjRWNFc0VzRYNFg0WTRZNF00XTReNF40XzRlNGY0ZjR2NHY0dzR5NHk0ejR6NIU0hjSGNIc0hzSINIg0iTSJNIo0ijSLNIs0jDSMNI00jTSONJY0ljSXNJc0mDSYNJk0mTSaNJo0mzSbNJ80nzSgNKA0oTSmNKY0pzSnNKg0qDSpNKk0rDStNK00rjSuNLM0szS0NLQ0tTS1NLY0tjTRNNI00jQtNC00SzRLNEw0TDRNNE00TjRSNFM0UzRUNFQ0VTRVNFY0VjRXNFc0XDRdNF00XjReNF80ZDRkNGU0ZTRrNGs0bDRsNHU0dTR2NHY0dzSDNIM0hDSENIU0hTSGNIY0hzSHNIg0iDSJNIk0ijSKNIs0izSMNIw0jTSNNI40jjSPNI80kDSQNJg0mDSZNJk0mjSaNJs0mzScNKA0oDShNKE0ojSiNKM0pjSnNKc0qDSoNKk0qTSqNKo0tDS0NLU0tTS2NLY0tzS3NNE00jTSNC01LTVLNUs1TDVMNU01TTVONVI1UzVTNVQ1VDVVNVU1VjVWNVc1VzVcNV01XTVeNV41XzVkNWQ1ZTVlNWs1azVsNWw1dTV1NXY1djV3NYM1gzWENYQ1hTWFNYY1hjWHNYc1iDWINYk1iTWKNYo1izWLNYw1jDWNNY01jjWONY81jzWQNZA1mDWYNZk1mTWaNZo1mzWbNZw1oDWgNaE1oTWiNaI1ozWmNac1pzWoNag1qTWpNao1qjW0NbQ1tTW1NbY1tjW3Nbc10TXSNdI1LTUtNUo1SjVLNUs1TDVRNVI1UjVTNVM1VDVUNVU1VTVWNVs1XDVcNV01XTVeNV41YzVjNWQ1ZDVlNWk1ajVqNWs1azVwNXA1cTVxNXQ1dTV1NXY1djV3NX41fjV/NX81gDWENYQ1hTWFNYY1hjWHNYc1iDWINYk1iTWKNYo1izWLNYw1jDWNNY01jjWONY81jzWQNZA1kTWRNZI1kjWTNZM1lDWUNZU1mDWZNZk1mjWaNZs1mzWcNZw1nTWhNaE1ojWiNaM1ozWkNaQ1qDWpNak1qjWqNas1sDWxNbU1tjW2Nbc1tzXRNdI10jUtNi02SjZKNks2SzZMNlE2UjZSNlM2UzZUNlQ2VTZVNlY2WzZcNlw2XTZdNl42XjZjNmM2ZDZkNmU2aTZqNmo2azZrNnA2cDZxNnE2dDZ1NnU2djZ2Nnc2fjZ+Nn82fzaANoQ2hDaFNoU2hjaGNoc2hzaINog2iTaJNoo2ijaLNos2jDaMNo02jTaONo42jzaPNpA2kDaRNpE2kjaSNpM2kzaUNpQ2lTaYNpk2mTaaNpo2mzabNpw2nDadNqE2oTaiNqI2ozajNqQ2pDaoNqk2qTaqNqo2qzawNrE2tTa2NrY2tza3NtE20jbSNi02LTZJNko2SjZLNks2UTZRNlI2UjZTNlM2WjZaNls2WzZcNlw2XTZdNmI2YjZjNmM2ZDZpNmo2cDZwNnE2cTZzNnQ2dDZ1NnU2ezZ8Nnw2fTZ9Nn42fjZ/Nn82gDaANoE2hzaONo42jzaPNpA2kDaRNpE2kjaSNpM2kzaUNpQ2lTaVNpk2mjaaNps2mzacNpw2nTadNp42njaiNqM2ozakNqQ2pTalNqY2sDaxNrE2sjayNrY2tza3Nrg2uDbRNtI20jYtNy03STdKN0o3UDdQN1E3UTdSN1k3WTdaN1o3WzdbN1w3XDdhN2I3YjdzN3Q3dDd7N3s3fDd8N303fTd+N343fzd/N5I3kjeTN5M3lDeUN5U3lTeWN5Y3lzeXN5s3mzecN5w3nTedN543njefN583pDekN6U3pTemN6Y3pzesN603rTexN7I3sjezN7M3uDe4N9E30jfSNy03LTdJN0o3SjdQN1A3UTdRN1I3WTdZN1o3WjdbN1s3XDdcN2E3YjdiN3M3dDd0N3s3ezd8N3w3fTd9N343fjd/N383kjeSN5M3kzeUN5Q3lTeVN5Y3ljeXN5c3mzebN5w3nDedN503njeeN583nzekN6Q3pTelN6Y3pjenN6w3rTetN7E3sjeyN7M3sze4N7g30TfSN9I3LTgtOEg4SThJOFA4UDhROFg4WDhZOFk4WjhaOFs4WzhcOFw4YDhhOGE4ZzhnOGg4azhrOGw4bDhtOHI4cjhzOHo4ejh7OHs4fDh8OH04fTiTOJQ4lDiVOJU4ljiWOJc4lziYOJg4mTidOJ44njifOJ84oDigOKE4pTilOKY4pjinOKc4qDioOKw4rTitOK44rjivOLI4sjizOLM40TjSONI4LTgtOEg4SThJOFA4UDhROFg4WDhZOFk4WjhaOFs4WzhcOFw4YDhhOGE4ZzhnOGg4azhrOGw4bDhtOHI4cjhzOHo4ejh7OHs4fDh8OH04fTiTOJQ4lDiVOJU4ljiWOJc4lziYOJg4mTidOJ44njifOJ84oDigOKE4pTilOKY4pjinOKc4qDioOKw4rTitOK44rjivOLI4sjizOLM40TjSONI4LTktOUc5SDlIOUk5WDlYOVk5WTlaOVo5WzlbOVw5XzlfOWA5YDlhOWY5ZjlnOWc5ajlrOWs5bDlsOXE5cTlyOXc5dzl4OXg5eTl5OXo5ejl7OYc5iDmIOYk5iTmKOYo5izmLOYw5jDmNOY05jjmVOZY5ljmXOZc5mDmYOZk5mTmaOZ85nzmgOaA5oTmhOaI5pjmmOac5pzmoOag5qTmpOa05rjmuOa85rzmwOdE50jnSOS05LTlHOUc5SDlMOU05TTlOOU45UzlTOVQ5VDlYOVg5WTlZOVo5WjlbOV85XzlgOWU5ZjlmOWc5ZzlqOWs5azlsOWw5bzlwOXA5dTl1OXY5djl3OXc5eDl4OXk5eTmCOYM5gzmEOYQ5hjmHOYc5iDmIOYk5iTmKOYo5izmLOYw5jDmNOY05jjmOOY85jzmQOZg5mDmZOZk5mjmaOZs5mzmgOaA5oTmhOaI5ojmjOaM5pjmmOac5pzmoOag5qTmpOao5qjmuOa45rzmvObA50TnSOdI5LTotOkc6RzpIOkw6TTpNOk46TjpTOlM6VDpUOlg6WDpZOlk6WjpaOls6XzpfOmA6ZTpmOmY6ZzpnOmo6azprOmw6bDpvOnA6cDp1OnU6djp2Onc6dzp4Ong6eTp5OoI6gzqDOoQ6hDqGOoc6hzqIOog6iTqJOoo6ijqLOos6jDqMOo06jTqOOo46jzqPOpA6mDqYOpk6mTqaOpo6mzqbOqA6oDqhOqE6ojqiOqM6ozqmOqY6pzqnOqg6qDqpOqk6qjqqOq46rjqvOq86sDrROtI60jotOi06RzpMOk06TTpOOk46UjpTOlM6VzpYOlg6WTpZOlo6XjpeOl86ZDplOmU6ZjpmOnQ6dTp1OnY6djp3Onc6eDp+On46fzp/OoA6gDqBOoE6gjqCOoM6gzqEOoQ6hTqKOos6izqMOow6jTqNOo46jjqPOo86kDqQOpE6kTqSOpI6kzqZOpo6mjqbOps6nDqhOqE6ojqiOqM6ozqkOqQ6pTqlOqc6qDqoOqk6qTqqOqo6qzqvOq86sDqwOrE6tTq2OrY60TrSOtI6LTstO0c7TDtNO007TjtOO1I7UztTO1c7WDtYO1k7WTtaO147XjtfO2Q7ZTtlO2Y7Zjt0O3U7dTt2O3Y7dzt3O3g7fjt+O387fzuAO4A7gTuBO4I7gjuDO4M7hDuEO4U7ijuLO4s7jDuMO407jTuOO447jzuPO5A7kDuRO5E7kjuSO5M7mTuaO5o7mzubO5w7oTuhO6I7ojujO6M7pDukO6U7pTunO6g7qDupO6k7qjuqO6s7rzuvO7A7sDuxO7U7tju2O9E70jvSOy07LTtMO0w7TTtNO047UTtSO1I7UztTO1c7WDtYO107XTteO147ZDtkO2U7ZTtzO3Q7dDt1O3U7fDt9O307fjt+O387fzuAO4A7gTuBO4I7gjuPO5A7kDuRO5E7kjuSO5M7kzuUO5o7mzubO5w7nDudO6E7ojuiO6M7ozukO6Q7pTulO6g7qTupO6o7qjurO6s7rDuvO7A7sDuxO7E7sjuyO7Y7tzu3O7g7uDvRO9I70jstPC08TDxMPE08TTxOPFE8UTxSPFI8VjxXPFc8WDxYPFw8XTxdPGM8YzxkPGQ8ZTxqPGs8azxsPGw8cTxxPHI8cjxzPHM8dDx0PHg8eTx5PHo8ejx7PHs8fDx8PH08fTx+PH48fzx/PIA8kTyRPJI8kjyTPJM8lDyUPJU8lTyWPJY8nDydPJ08njyePKI8ozyjPKQ8pDylPKU8pjyqPKo8qzyrPKw8rDytPK08rzywPLA8sTyxPLI8sjyzPLM8tzy3PLg8uDy5PLk8ujzRPNI80jwtPC08TDxMPE08TTxOPFE8UTxSPFI8VjxXPFc8WDxYPFw8XTxdPGM8YzxkPGQ8ZTxqPGs8azxsPGw8cTxxPHI8cjxzPHM8dDx0PHg8eTx5PHo8ejx7PHs8fDx8PH08fTx+PH48fzx/PIA8kTyRPJI8kjyTPJM8lDyUPJU8lTyWPJY8nDydPJ08njyePKI8ozyjPKQ8pDylPKU8pjyqPKo8qzyrPKw8rDytPK08rzywPLA8sTyxPLI8sjyzPLM8tzy3PLg8uDy5PLk8ujzRPNI80jwtPS09Sj1KPUs9Sz1MPUw9TT1RPVE9Uj1VPVY9Vj1XPVc9Wz1cPVw9XT1dPWM9Yz1kPWk9aj1qPWs9az1wPXA9cT1xPXI9cj1zPXM9dD13PXc9eD14PXk9eT16PXo9ez17PXw9fD19PZM9kz2UPZQ9lT2VPZY9lj2XPZc9mD2dPZ49nj2fPZ89oz2kPaQ9pT2lPaY9pj2nPas9qz2sPaw9rT2tPa49rj2wPbE9sT2yPbI9sz2zPbc9tz24Pbg9uT25Pbo90T3SPdI9LT0tPUo9Sj1LPUs9TD1MPU09UT1RPVI9VT1WPVY9Vz1XPVs9XD1cPV09XT1jPWM9ZD1pPWo9aj1rPWs9cD1wPXE9cT1yPXI9cz1zPXQ9dz13PXg9eD15PXk9ej16PXs9ez18PXw9fT2TPZM9lD2UPZU9lT2WPZY9lz2XPZg9nT2ePZ49nz2fPaM9pD2kPaU9pT2mPaY9pz2rPas9rD2sPa09rT2uPa49sD2xPbE9sj2yPbM9sz23Pbc9uD24Pbk9uT26PdE90j3SPS0+LT5JPko+Sj5LPks+TD5QPlA+UT5RPlI+VT5VPlY+Vj5XPlc+Wj5bPls+XD5cPmg+aT5pPmo+aj5uPm8+bz5wPnA+cT5xPnI+dz53Png+eD55Pnk+ej56Pns+hT6FPoY+hj6HPoc+iD6IPok+iT6KPoo+iz6LPow+jD6NPo0+lT6WPpY+lz6XPpg+mD6ZPpk+mj6dPp4+nj6fPp8+oD6gPqQ+pD6lPqU+pj6mPqc+pz6oPqg+qz6sPqw+rT6tPq4+rj6vPrg+uD65Prk+uj66Prs+0T7SPtI+LT4tPkg+ST5JPko+Sj5LPks+Tz5PPlA+UD5RPlU+VT5WPlY+Vz5aPls+Wz5cPmc+Zz5oPmg+aT5pPmo+bT5uPm4+bz5vPnA+cD5xPnE+dz54Png+gD6BPoE+gj6CPoM+gz6EPoQ+hT6FPoY+hj6HPoc+iD6IPok+iT6KPoo+iz6LPow+jD6NPo0+jj6OPo8+jz6QPpA+lj6WPpc+lz6YPpg+mT6ZPpo+mj6fPp8+oD6gPqE+pj6mPqc+pz6oPqg+rD6tPq0+rj6uPq8+rz6wPrQ+tT61PrY+uT65Pro+uj67PtE+0j7SPi0/LT9IP0k/ST9KP0o/Sz9LP08/Tz9QP1A/UT9VP1U/Vj9WP1c/Wj9bP1s/XD9nP2c/aD9oP2k/aT9qP20/bj9uP28/bz9wP3A/cT9xP3c/eD94P4A/gT+BP4I/gj+DP4M/hD+EP4U/hT+GP4Y/hz+HP4g/iD+JP4k/ij+KP4s/iz+MP4w/jT+NP44/jj+PP48/kD+QP5Y/lj+XP5c/mD+YP5k/mT+aP5o/nz+fP6A/oD+hP6Y/pj+nP6c/qD+oP6w/rT+tP64/rj+vP68/sD+0P7U/tT+2P7k/uT+6P7o/uz/RP9I/0j8tPy0/SD9JP0k/Sj9KP0s/Sz9OP08/Tz9QP1A/VT9VP1Y/Wj9aP1s/Wz9cP2Y/Zj9nP2c/aD9oP2k/bT9tP24/bj9vP28/cD9wP4A/gD+BP4E/gj+CP4M/gz+EP4Q/hT+FP4Y/iT+JP4o/ij+LP4s/jD+MP40/jT+OP44/jz+PP5A/kD+RP5E/mD+YP5k/mT+aP5o/mz+bP5w/oD+gP6E/oT+iP6Y/pz+nP6g/qD+pP6k/rj+uP68/rz+wP7A/sT+0P7Q/tT+1P7Y/tj+5P7o/uj+7P7s/vD+8P9E/0j/SPy1ALUBHQEhASEBJQElASkBKQE5AT0BPQFRAVEBVQFpAWkBbQGRAZUBlQGZAZkBnQGdAaEBsQGxAbUBtQG5AbkBvQG9AfUB+QH5Af0B/QIBAgECBQIFAgkCCQI5AjkCPQI9AkECQQJFAkUCSQJJAk0CTQJRAmECZQJlAmkCaQJtAm0CcQJxAnUChQKFAokCiQKNAo0CnQKhAqECpQKlAr0CvQLBAsECxQLRAtUC1QLZAtkC3QLdAukC7QLtAvEC8QNFA0kDSQC1ALUBHQEhASEBJQElASkBKQE5AT0BPQFRAVEBVQFpAWkBbQGRAZUBlQGZAZkBnQGdAaEBsQGxAbUBtQG5AbkBvQG9AfUB+QH5Af0B/QIBAgECBQIFAgkCCQI5AjkCPQI9AkECQQJFAkUCSQJJAk0CTQJRAmECZQJlAmkCaQJtAm0CcQJxAnUChQKFAokCiQKNAo0CnQKhAqECpQKlAr0CvQLBAsECxQLRAtUC1QLZAtkC3QLdAukC7QLtAvEC8QNFA0kDSQC1BLUFHQUhBSEFJQU1BTkFOQU9BT0FUQVRBVUFZQVlBWkFeQV5BX0FfQWBBZEFkQWVBZUFmQWZBa0FrQWxBbEFtQW1BbkF3QXhBeEF5QXlBfEF9QX1BfkF+QX9Bf0GAQYBBgUGQQZFBkUGSQZJBk0GTQZRBlEGVQZVBmUGaQZpBm0GbQZxBnEGdQZ1BnkGhQaJBokGjQaNBpEGkQalBqUGqQapBq0GrQaxBr0GvQbBBsEGxQbFBtUG2QbZBt0G3QbtBvEG8QdFB0kHSQS1BLUFHQUhBSEFJQU1BTkFOQU9BT0FUQVRBVUFZQVlBWkFeQV5BX0FfQWBBZEFkQWVBZUFmQWZBa0FrQWxBbEFtQW1BbkF3QXhBeEF5QXlBfEF9QX1BfkF+QX9Bf0GAQYBBgUGQQZFBkUGSQZJBk0GTQZRBlEGVQZVBmUGaQZpBm0GbQZxBnEGdQZ1BnkGhQaJBokGjQaNBpEGkQalBqUGqQapBq0GrQaxBr0GvQbBBsEGxQbFBtUG2QbZBt0G3QbtBvEG8QdFB0kHSQS1CLUJHQkdCSEJNQk5CTkJTQlNCVEJUQlhCWEJZQllCXUJdQl5CXkJfQl9CYEJkQmRCZUJlQmlCakJqQmtCa0JsQmxCcUJxQnJCckJzQndCd0J4QnhCe0J8QnxCfUJ9Qn5CfkJ/Qn9Ch0KIQohCiUKTQpNClEKUQpVClUKWQpZCm0KbQpxCnEKdQp1CnkKeQqJCo0KjQqRCpEKlQqVCpkKmQqdCqkKqQqtCq0KsQqxCrUKvQrBCsEKxQrFCskKyQrZCt0K3QrhCuELRQtJC0kItQi1CR0JMQk1CUkJTQlNCWEJYQl1CXUJeQl5CX0JjQmNCZEJkQmVCaEJpQmlCakJqQmtCa0JwQnBCcUJxQnZCdkJ3QndCeEJ4QntCe0J8QnxCfUJ9Qn5CfkKEQoRChUKFQoZChkKHQodCiEKIQolCiUKKQopCi0KLQpRClUKVQpZClkKXQpdCmEKcQpxCnUKdQp5CnkKfQp9CoEKgQqNCpEKkQqVCpUKmQqZCp0KnQqhCq0KsQqxCrUKtQrBCsUKxQrJCskKzQrNCtEK2QrdCt0K4QrhCuUK5QrpCvkK+Qr9C0ULSQtJCLUMtQ0dDTENNQ1JDU0NTQ1hDWENdQ11DXkNeQ19DY0NjQ2RDZENlQ2hDaUNpQ2pDakNrQ2tDcENwQ3FDcUN2Q3ZDd0N3Q3hDeEN7Q3tDfEN8Q31DfUN+Q35DhEOEQ4VDhUOGQ4ZDh0OHQ4hDiEOJQ4lDikOKQ4tDi0OUQ5VDlUOWQ5ZDl0OXQ5hDnEOcQ51DnUOeQ55Dn0OfQ6BDoEOjQ6RDpEOlQ6VDpkOmQ6dDp0OoQ6tDrEOsQ61DrUOwQ7FDsUOyQ7JDs0OzQ7RDtkO3Q7dDuEO4Q7lDuUO6Q75DvkO/Q9FD0kPSQy1DLUNGQ0ZDR0NMQ0xDTUNRQ1JDUkNXQ1hDWENcQ11DXUNeQ15DYkNiQ2NDY0NkQ2hDaENpQ2lDakNvQ3BDcEN0Q3VDdUN2Q3ZDd0N6Q3pDe0N7Q3xDfEN9Q31DgUOCQ4JDg0ODQ4RDhEOFQ4VDhkOGQ4dDh0OIQ4hDiUOJQ4pDikOLQ4tDjEOMQ41DjUOOQ45Dj0OPQ5BDlUOWQ5ZDl0OXQ5hDmEOZQ5xDnUOdQ55DnkOfQ59DoEOgQ6FDo0OkQ6RDpUOlQ6ZDpkOnQ6dDqEOoQ6xDrUOtQ65DrkOxQ7JDskOzQ7NDtEO0Q7VDt0O3Q7hDuEO5Q7lDukO+Q79D0UPSQ9JDLUQtREZERkRHRExETERNRFFEUkRSRFdEWERYRFxEXURdRF5EXkRiRGJEY0RjRGREaERoRGlEaURqRG9EcERwRHREdUR1RHZEdkR3RHpEekR7RHtEfER8RH1EfUSBRIJEgkSDRINEhESERIVEhUSGRIZEh0SHRIhEiESJRIlEikSKRItEi0SMRIxEjUSNRI5EjkSPRI9EkESVRJZElkSXRJdEmESYRJlEnESdRJ1EnkSeRJ9En0SgRKBEoUSjRKREpESlRKVEpkSmRKdEp0SoRKhErEStRK1ErkSuRLFEskSyRLNEs0S0RLREtUS3RLdEuES4RLlEuUS6RL5Ev0TRRNJE0kQtRC1ERURFREZERkRHREtES0RMRExETURRRFFEUkRSRFZEV0RXRFtEXERcRF1EXURhRGJEYkRjRGNEZ0RnRGhEaERpRG1EbkRuRG9Eb0R0RHVEdUR2RHZEeUR5RHpEekR7RHtEfESARIBEgUSBRIJEgkSDRINEhESERIVEhUSGRIZEh0SHRIhEiESJRIlEikSKRItEi0SMRIxEjUSNRI5EjkSPRI9EkESQRJFEkUSWRJZEl0SXRJhEmESZRJlEmkSdRJ5EnkSfRJ9EoESgRKFEpESkRKVEpUSmRKhEqUSpRK1ErkSuRK9EskSyRLNEs0S0RLREtUS1RLZEuES4RLlEuUS6RLpEu0TRRNJE0kQtRS1FREVFRUVFRkVGRUpFSkVLRUtFTEVMRU1FUEVQRVFFUUVSRVZFV0VXRVpFW0VbRVxFXEVdRV1FYEVhRWFFYkViRWdFZ0VoRWhFaUVtRW1FbkVuRW9FckVzRXVFdUV4RXlFeUV6RXpFe0V/RX9FgEWARYFFgUWCRYJFg0WDRYpFi0WLRYxFjEWNRY1FjkWORY9Fj0WQRZBFkUWRRZJFkkWTRZhFmEWZRZlFmkWaRZtFm0WeRZ9Fn0WgRaBFoUWhRaJFpUWlRaZFqUWpRa5FrkWvRa9FsEWzRbNFtEW0RbVFtUW2RbhFuEW5RblFukW6RbtFu0XRRdJF0kUtRS1FREVFRUVFRkVGRUpFSkVLRUtFTEVMRU1FUEVQRVFFUUVSRVZFV0VXRVpFW0VbRVxFXEVdRV1FYEVhRWFFYkViRWdFZ0VoRWhFaUVtRW1FbkVuRW9FckVzRXVFdUV4RXlFeUV6RXpFe0V/RX9FgEWARYFFgUWCRYJFg0WDRYpFi0WLRYxFjEWNRY1FjkWORY9Fj0WQRZBFkUWRRZJFkkWTRZhFmEWZRZlFmkWaRZtFm0WeRZ9Fn0WgRaBFoUWhRaJFpUWlRaZFqUWpRa5FrkWvRa9FsEWzRbNFtEW0RbVFtUW2RbhFuEW5RblFukW6RbtFu0XRRdJF0kUtRi1GREZFRkVGSkZKRktGS0ZMRkxGTUZQRlBGUUZRRlJGVUZWRlZGV0ZaRltGW0ZcRlxGX0ZgRmBGYUZhRmZGZkZnRmdGaEZrRmtGbEZsRm1GbUZuRnJGckZzRndGeEZ4RnlGeUZ6RnpGf0Z/RoBGgEaBRoFGgkaPRpBGkEaRRpFGkkaSRpNGk0aURpRGlUaYRplGmUaaRppGm0abRpxGn0afRqBGoEahRqFGokaiRqNGpkamRqdGqkaqRqtGq0asRq9Gr0awRrBGsUazRrNGtEa0RrVGtUa2RrZGuUa5RrpGuka7RrtGwEbRRtJG0kYtRi1GREZFRkVGSkZKRktGS0ZMRkxGTUZQRlBGUUZRRlJGVUZWRlZGV0ZaRltGW0ZcRlxGX0ZgRmBGYUZhRmZGZkZnRmdGaEZrRmtGbEZsRm1GbUZuRnJGckZzRndGeEZ4RnlGeUZ6RnpGf0Z/RoBGgEaBRoFGgkaPRpBGkEaRRpFGkkaSRpNGk0aURpRGlUaYRplGmUaaRppGm0abRpxGn0afRqBGoEahRqFGokaiRqNGpkamRqdGqkaqRqtGq0asRq9Gr0awRrBGsUazRrNGtEa0RrVGtUa2RrZGuUa5RrpGuka7RrtGwEbRRtJG0kYtRy1HQ0dER0RHSUdKR0pHUEdQR1FHVUdVR1ZHWkdaR1tHW0dcR19HYEdgR2FHZkdmR2dHZ0dqR2tHa0dsR2xHbUdxR3FHckdyR3NHd0d3R3hHeEd5R3lHfUd+R35Hf0d/R4BHgEeBR5JHkkeTR5NHlEeUR5VHlUeYR5lHmUeaR5pHm0ebR5xHnEedR6BHoEehR6FHokeiR6NHpkemR6dHp0eoR6tHq0esR6xHrUevR7BHsEexR7FHtEe0R7VHtUe2R7ZHt0e3R7pHu0e7R7xHvEfRR9JH0kctRy1HQkdDR0NHREdER0hHSUdJR0pHSkdOR09HT0dQR1BHVUdaR1pHW0dbR1xHX0dfR2BHZEdlR2VHakdrR2tHbEdsR3BHcEdxR3FHdkd2R3dHd0d4R3hHfEd9R31Hfkd+R39Hf0eAR4ZHh0eHR5NHk0eUR5RHlUeVR5ZHlkeZR5pHmkebR5tHnEecR51HnUeeR6FHoUeiR6JHo0ejR6ZHpkenR6dHqEeoR6tHq0esR6xHrUetR69HsEewR7FHsUeyR7JHtUe2R7ZHt0e3R7tHvEe8R71HvUfRR9JH0kctSC1IQkhDSENIREhESEhISUhJSEpISkhOSE9IT0hQSFBIVUhaSFpIW0hbSFxIX0hfSGBIZEhlSGVIakhrSGtIbEhsSHBIcEhxSHFIdkh2SHdId0h4SHhIfEh9SH1Ifkh+SH9If0iASIZIh0iHSJNIk0iUSJRIlUiVSJZIlkiZSJpImkibSJtInEicSJ1InUieSKFIoUiiSKJIo0ijSKZIpkinSKdIqEioSKtIq0isSKxIrUitSK9IsEiwSLFIsUiySLJItUi2SLZIt0i3SLtIvEi8SL1IvUjRSNJI0kgtSC1IQkhCSENIQ0hESERISEhJSElISkhKSE1ITkhOSE9IT0hUSFRIWUhZSFpIWkhbSF5IXkhfSF9IYEhkSGRIZUhlSGpIa0hrSG9IcEhwSHVIdUh2SHZId0h3SHhIe0h8SHxIfUh9SH5IfkiESIRIhUiFSIZIhkiHSIdIiEiISIlIiUiKSIpIi0iLSIxIjEiNSI1IjkiTSJRIlEiVSJVIlkiWSJdIl0iYSJpIm0ibSJxInEidSJ1InkihSKFIokiiSKNIo0imSKdIp0ioSKhIqUipSKtIq0isSKxIrUitSK5IrkiwSLFIsUiySLJItUi2SLZIt0i3SLhIuEi8SLxI0UjSSNJILUktSUJJQklDSUNJRElESUhJSUlJSUpJSklNSU5JTklPSU9JVElUSVlJWUlaSVpJW0leSV5JX0lfSWBJZElkSWVJZUlqSWtJa0lvSXBJcEl1SXVJdkl2SXdJd0l4SXtJfEl8SX1JfUl+SX5JhEmESYVJhUmGSYZJh0mHSYhJiEmJSYlJikmKSYtJi0mMSYxJjUmNSY5Jk0mUSZRJlUmVSZZJlkmXSZdJmEmaSZtJm0mcSZxJnUmdSZ5JoUmhSaJJokmjSaNJpkmnSadJqEmoSalJqUmrSatJrEmsSa1JrUmuSa5JsEmxSbFJskmySbVJtkm2SbdJt0m4SbhJvEm8SdFJ0knSSS1JLUlCSUJJQ0lDSURJR0lISUhJSUlJSU1JTklOSU9JT0laSV1JXUleSV5JY0ljSWRJZEllSW5Jb0lvSXBJcEl0SXVJdUl2SXZJd0l6SXpJe0l7SXxJfEl9SX1JgkmDSYNJhEmESYVJhUmGSYZJh0mHSYhJiEmJSYpJikmLSYtJjEmMSY1JjUmOSY5Jj0mPSZBJlEmVSZVJlkmWSZdJl0mYSZhJmUmbSZtJnEmcSZ1JnUmeSZ5JoUmiSaJJo0mjSaRJpEmmSadJp0moSahJqUmpSapJqkmrSaxJrEmtSa1JrkmuSbFJskmySbNJs0m2SbdJt0m4SbhJuUnRSdJJ0kktSi1KQUpBSkJKR0pHSkhKSEpJSkxKTUpNSk5KTkpcSl1KXUpeSl5KY0pjSmRKaEppSmlKakpuSm9Kb0pzSnRKdEp1SnVKdkp2SnlKeUp6SnpKe0p7SnxKfEp9SoFKgkqCSoNKg0qESoRKhUqFSoZKhkqHSodKikqLSotKjEqMSo1KjUqOSo5Kj0qPSpBKkEqRSpFKlkqWSpdKl0qYSphKmUqZSppKnEqcSp1KnUqeSp5KoUqiSqJKo0qjSqRKpEqlSqVKp0qoSqhKqUqpSqpKqkqsSq1KrUquSq5Kr0qySrJKs0qzSrRKt0q3SrhKuEq5Sr5Kvkq/StFK0krSSi1KLUpBSkFKQkpHSkdKSEpISklKTEpNSk1KTkpOSlxKXUpdSl5KXkpjSmNKZEpoSmlKaUpqSm5Kb0pvSnNKdEp0SnVKdUp2SnZKeUp5SnpKekp7SntKfEp8Sn1KgUqCSoJKg0qDSoRKhEqFSoVKhkqGSodKh0qKSotKi0qMSoxKjUqNSo5KjkqPSo9KkEqQSpFKkUqWSpZKl0qXSphKmEqZSplKmkqcSpxKnUqdSp5KnkqhSqJKokqjSqNKpEqkSqVKpUqnSqhKqEqpSqlKqkqqSqxKrUqtSq5KrkqvSrJKskqzSrNKtEq3SrdKuEq4SrlKvkq+Sr9K0UrSStJKLUstS0FLQUtHS0dLSEtIS0lLTEtNS01LTktOS1JLV0tYS1hLXEtdS11LYktiS2NLY0tkS2hLaEtpS2lLakttS25LbktvS3JLc0tzS3RLdEt1S3VLeEt5S3lLekt6S3tLe0t8S4FLgkuCS4NLg0uES4RLjkuOS49Lj0uQS5BLkUuRS5JLkkuXS5dLmEuYS5lLmUuaS5xLnUudS55LnkufS59LokujS6NLpEukS6VLpUuoS6lLqUuqS6pLq0utS65LrkuvS7NLs0u0S7RLtUu4S7hLuUu5S7pLvku+S79Lv0vAS9FL0kvSSy1LLUtBS0FLR0tHS0hLSEtJS0xLTUtNS05LTktSS1dLWEtYS1xLXUtdS2JLYktjS2NLZEtoS2hLaUtpS2pLbUtuS25Lb0tyS3NLc0t0S3RLdUt1S3hLeUt5S3pLekt7S3tLfEuBS4JLgkuDS4NLhEuES45LjkuPS49LkEuQS5FLkUuSS5JLl0uXS5hLmEuZS5lLmkucS51LnUueS55Ln0ufS6JLo0ujS6RLpEulS6VLqEupS6lLqkuqS6tLrUuuS65Lr0uzS7NLtEu0S7VLuEu4S7lLuUu6S75Lvku/S79LwEvRS9JL0kstTC1MQExBTEFMRkxGTEdMR0xITExMTExNTE1MTkxOTFFMUkxSTFNMU0xWTFdMV0xYTFhMW0xcTFxMYExhTGFMYkxiTGNMY0xnTGdMaExoTGlMbUxtTG5MckxyTHNMc0x0THdMeEx4THlMeUx6THpMe0x/TH9MgEyATIFMgUyCTIJMj0yQTJBMkUyRTJJMkkyTTJhMmEyZTJlMmkyaTJ1MnkyeTJ9Mn0yjTKRMpEylTKVMpkyoTKlMqUyqTKpMq0yrTKxMr0yvTLBMtEy0TLVMuUy5TLpMuky7TL5Mvky/TL9MwEzRTNJM0kwtTC1MRkxGTEdMTExMTE1MTUxOTFFMUkxSTFNMU0xWTFdMV0xbTFxMXExfTGBMYExhTGFMYkxiTGZMZkxnTGdMaExoTGlMbExsTG1MbUxuTHJMckxzTHNMdEx3THhMeEx5THlMekx6TH1Mfkx+TH9Mf0yATIBMgUyBTIJMkEyRTJFMkkySTJNMk0yUTJhMmUyZTJpMmkybTJtMnkyfTJ9MoEygTKNMpEykTKVMpUymTKZMp0ypTKlMqkyqTKtMq0ysTKxMrUyvTLBMsEyxTLRMtEy1TLVMtky5TLpMuky7TL5Mv0y/TMBMwEzRTNJM0kwtTS1NRk1GTUdNTE1MTU1NTU1OTVFNUk1STVNNU01WTVdNV01bTVxNXE1fTWBNYE1hTWFNYk1iTWZNZk1nTWdNaE1oTWlNbE1sTW1NbU1uTXJNck1zTXNNdE13TXhNeE15TXlNek16TX1Nfk1+TX9Nf02ATYBNgU2BTYJNkE2RTZFNkk2STZNNk02UTZhNmU2ZTZpNmk2bTZtNnk2fTZ9NoE2gTaNNpE2kTaVNpU2mTaZNp02pTalNqk2qTatNq02sTaxNrU2vTbBNsE2xTbRNtE21TbVNtk25TbpNuk27Tb5Nv02/TcBNwE3RTdJN0k0tTS1NRU1FTUZNRk1HTUtNS01MTUxNTU1NTU5NUU1RTVJNUk1WTVdNWk1bTVtNXE1cTV9NYE1gTWFNYU1lTWZNZk1nTWdNaE1rTWtNbE1sTW1NbU1uTXFNcU1yTXJNc013TXdNeE14TXlNeU19TX5Nfk1/TX9NkU2RTZJNkk2TTZNNlE2UTZVNmE2ZTZlNmk2aTZtNm02eTZ9Nn02gTaBNoU2kTaRNpU2lTaZNpk2nTapNqk2rTatNrE2sTa1Nr02wTbBNsU20TbVNtU22TbZNv03ATcBNwU3BTdFN0k3STS1OLU5FTkVORk5GTkdOS05LTkxOTE5NTk1OTk5RTlFOUk5STlZOV05aTltOW05cTlxOX05gTmBOYU5hTmVOZk5mTmdOZ05oTmtOa05sTmxObU5tTm5OcU5xTnJOck5zTndOd054TnhOeU55Tn1Ofk5+Tn9Of06RTpFOkk6STpNOk06UTpROlU6YTplOmU6aTppOm06bTp5On06fTqBOoE6hTqROpE6lTqVOpk6mTqdOqk6qTqtOq06sTqxOrU6vTrBOsE6xTrROtU61TrZOtk6/TsBOwE7BTsFO0U7STtJOLU4tTkVORU5LTktOTE5MTk1OUU5RTlJOVU5WTlZOV05aTlpOW05bTlxOX05fTmBOYE5hTmVOZk5mTmdOZ05rTmtObE5sTm1OcE5wTnFOcU5yTnJOc052TnZOd053TnhOeE58Tn1OfU5+Tn5OhE6EToVOhU6GToZOh06HTohOiE6JTolOik6KTotOi06TTpNOlE6UTpVOlU6WTpZOmU6aTppOm06bTpxOn06fTqBOoE6hTqFOok6lTqVOpk6mTqdOp06oTqpOqk6rTqtOrE6sTq1OrU6vTrBOsE6xTrFOtE61TrVOtk62TrdOt07ATsFOwU7RTtJO0k4tTy1PRE9FT0VPS09LT0xPTE9NT1BPUE9RT1FPUk9VT1pPWk9bT1tPXE9fT19PYE9gT2FPZU9mT2ZPak9rT2tPbE9sT21PcE9wT3FPcU9yT3JPc092T3ZPd093T3hPe098T3xPfU99T35Pfk+DT4NPhE+ET4VPhU+GT4ZPh0+HT4hPiE+JT4lPik+KT4tPi0+MT4xPk0+UT5RPlU+VT5ZPlk+ZT5pPmk+bT5tPnE+cT51Pn0+fT6BPoE+hT6FPok+mT6ZPp0+nT6hPqE+rT6tPrE+sT61PrU+wT7FPsU+1T7ZPtk+3T7dPvE+8T71PvU/BT8FPwk/CT8NP0U/ST9JPLU8tT0RPRU9FT0tPS09MT0xPTU9QT1BPUU9RT1JPVU9aT1pPW09bT1xPX09fT2BPYE9hT2VPZk9mT2pPa09rT2xPbE9tT3BPcE9xT3FPck9yT3NPdk92T3dPd094T3tPfE98T31PfU9+T35Pg0+DT4RPhE+FT4VPhk+GT4dPh0+IT4hPiU+JT4pPik+LT4tPjE+MT5NPlE+UT5VPlU+WT5ZPmU+aT5pPm0+bT5xPnE+dT59Pn0+gT6BPoU+hT6JPpk+mT6dPp0+oT6hPq0+rT6xPrE+tT61PsE+xT7FPtU+2T7ZPt0+3T7xPvE+9T71PwU/BT8JPwk/DT9FP0k/STy1QLVBEUEVQRVBLUEtQTFBPUE9QUFBQUFFQVFBUUFVQWlBaUFtQX1BfUGBQZFBlUGVQalBrUGtQbFBsUG9QcFBwUHFQcVByUHZQdlB3UHtQe1B8UHxQfVB9UIFQglCCUINQg1CEUIRQhVCFUIZQhlCHUIdQiFCIUIlQiVCKUIpQi1CLUIxQjFCNUI1QjlCOUI9Qk1CUUJRQlVCVUJZQllCXUJdQmlCbUJtQnFCcUJ1QoFCgUKFQoVCiUKJQo1CmUKZQp1CnUKhQqFCpUKlQq1CrUKxQrFCtUK1QtVC2ULZQt1C3ULhQuFC8ULxQvVC9UL5QwlDCUMNQ0VDSUNJQLVAtUERQRVBFUEtQS1BMUE9QT1BQUFBQUVBUUFRQVVBaUFpQW1BfUF9QYFBkUGVQZVBqUGtQa1BsUGxQb1BwUHBQcVBxUHJQdlB2UHdQe1B7UHxQfFB9UH1QgVCCUIJQg1CDUIRQhFCFUIVQhlCGUIdQh1CIUIhQiVCJUIpQilCLUItQjFCMUI1QjVCOUI5Qj1CTUJRQlFCVUJVQllCWUJdQl1CaUJtQm1CcUJxQnVCgUKBQoVChUKJQolCjUKZQplCnUKdQqFCoUKlQqVCrUKtQrFCsUK1QrVC1ULZQtlC3ULdQuFC4ULxQvFC9UL1QvlDCUMJQw1DRUNJQ0lAtUS1RRFFFUUVRSlFKUUtRS1FOUU9RT1FQUVBRVFFUUVVRWlFeUV5RX1FkUWRRZVFpUWpRalFrUWtRbFFsUW5Rb1FvUXBRcFFxUXFRdVF1UXZRdlF3UXpRelF7UXtRfFF8UX1RgFGBUYFRglGCUYNRg1GEUYRRhVGFUYZRhlGHUYtRjFGMUY1RjVGOUY5Rj1GPUZBRkFGUUZVRlVGWUZZRl1GXUZhRmlGbUZtRnFGcUZ1RnVGeUaFRoVGiUaJRo1GmUadRp1GoUahRqVGpUatRrFGsUa1RrVGuUa5Rs1GzUbZRt1G3UbhRuFG5UbxRvFG9Ub1RvlG+Ub9RwlHDUcNRxFHRUdJR0lEtUS1RQ1FEUURRSVFKUUpRS1FLUU5RT1FPUVBRUFFUUVRRVVFZUVlRWlFdUV1RXlFeUV9RZFFkUWVRZVFpUWpRalFrUWtRblFvUW9RcFFwUXRRdVF1UXZRdlF5UXlRelF6UXtRe1F8UYBRgFGBUYFRglGCUY5Rj1GPUZBRkFGRUZFRklGSUZVRllGWUZdRl1GYUZtRm1GcUZxRnVGdUZ5RoVGhUaJRolGjUaNRplGnUadRqFGoUalRqVGqUapRrFGtUa1RrlGuUbJRslGzUbNRtFG3UbdRuFG4UblRvVG9Ub5RvlG/UdFR0lHSUS1SLVJDUkRSRFJJUkpSSlJLUktSTlJPUk9SUFJQUlRSVFJVUllSWVJaUl1SXVJeUl5SX1JkUmRSZVJlUmlSalJqUmtSa1JuUm9Sb1JwUnBSdFJ1UnVSdlJ2UnlSeVJ6UnpSe1J7UnxSgFKAUoFSgVKCUoJSjlKPUo9SkFKQUpFSkVKSUpJSlVKWUpZSl1KXUphSm1KbUpxSnFKdUp1SnlKhUqFSolKiUqNSo1KmUqdSp1KoUqhSqVKpUqpSqlKsUq1SrVKuUq5SslKyUrNSs1K0UrdSt1K4UrhSuVK9Ur1SvlK+Ur9S0VLSUtJSLVItUj9SQFJAUkNSRFJEUklSSlJKUktSS1JNUk5STlJPUk9SU1JTUlRSVFJVUlhSWFJZUllSWlJdUl1SXlJeUl9SZFJlUmVSaVJqUmpSa1JrUm1SblJuUm9Sb1JwUnBSc1J0UnRSdVJ1UnZSdlJ5UnlSelJ6UntSf1J/UoBSgFKBUoFSglKPUpBSkFKRUpFSklKSUpNSllKWUpdSl1KYUphSmVKcUpxSnVKdUp5SnlKhUqFSolKiUqNSo1KkUqRSp1KoUqhSqVKpUqpSqlKsUq1SrVKuUq5Sr1KyUrJSs1KzUrRStFK1UrdSt1K4UrhSuVK5UrpSvlK+Ur9Sv1LAUtFS0lLSUi1TLVM+Uz9TP1NAU0BTQ1NEU0RTSFNJU0lTSlNKU01TTlNOU1JTU1NTU1RTVFNVU1hTWFNZU1lTXFNdU11TXlNeU2FTYlNiU2RTZVNoU2lTaVNqU2pTbVNuU25Tb1NvU3JTc1NzU3RTdFN1U3VTeFN5U3lTelN6U3tTflN+U39Tf1OAU4BTgVOQU5FTkVOSU5JTk1OTU5RTllOWU5dTl1OYU5hTmVOZU5pTnFOcU51TnVOeU55ToVOiU6JTo1OjU6RTpFOoU6lTqVOqU6pTq1OtU65TrlOvU69TsFOzU7NTtFO0U7VTuFO4U7lTuVO6U75TvlO/U79TwFPRU9JT0lMtUy1TPlM/Uz9TQFNAU0NTRFNEU0hTSVNJU0pTSlNNU05TTlNSU1NTU1NUU1RTVVNYU1hTWVNZU1xTXVNdU15TXlNhU2JTYlNkU2VTaFNpU2lTalNqU21TblNuU29Tb1NyU3NTc1N0U3RTdVN1U3hTeVN5U3pTelN7U35TflN/U39TgFOAU4FTkFORU5FTklOSU5NTk1OUU5ZTllOXU5dTmFOYU5lTmVOaU5xTnFOdU51TnlOeU6FTolOiU6NTo1OkU6RTqFOpU6lTqlOqU6tTrVOuU65Tr1OvU7BTs1OzU7RTtFO1U7hTuFO5U7lTulO+U75Tv1O/U8BT0VPSU9JTLVQtVD5UP1Q/VEBUQlRDVENURFREVEdUSFRIVElUSVRNVE5UTlRRVFJUUlRTVFNUVFRUVFdUWFRYVFlUWVRcVF1UXVReVF5UYFRhVGFUZFRkVGVUaFRpVGlUalRqVG1UbVRuVG5Ub1RvVHJUc1RzVHRUdFR1VHVUeFR5VHlUelR6VH5UflR/VH9UgFSGVIdUh1SIVIhUiVSJVIpUilSLVItUjFSMVJFUkVSSVJJUk1STVJRUlFSVVJVUllSWVJdUl1SYVJhUmVSZVJpUnFSdVJ1UnlSeVKJUo1SjVKRUpFSlVKVUqVSpVKpUqlSrVK5UrlSvVK9UsFSwVLFUs1SzVLRUtFS1VLlUuVS6VLpUu1S+VL9Uv1TAVMBU0VTSVNJULVQtVD5UP1Q/VEBUQlRDVENURFREVEdUSFRIVElUSVRNVE5UTlRRVFJUUlRTVFNUVFRUVFdUWFRYVFlUWVRcVF1UXVReVF5UYFRhVGFUZFRkVGVUaFRpVGlUalRqVG1UbVRuVG5Ub1RvVHJUc1RzVHRUdFR1VHVUeFR5VHlUelR6VH5UflR/VH9UgFSGVIdUh1SIVIhUiVSJVIpUilSLVItUjFSMVJFUkVSSVJJUk1STVJRUlFSVVJVUllSWVJdUl1SYVJhUmVSZVJpUnFSdVJ1UnlSeVKJUo1SjVKRUpFSlVKVUqVSpVKpUqlSrVK5UrlSvVK9UsFSwVLFUs1SzVLRUtFS1VLlUuVS6VLpUu1S+VL9Uv1TAVMBU0VTSVNJULVUtVT5VP1U/VUBVQlVDVUNVRFVHVUhVSFVJVUxVTVVNVU5VTlVRVVJVUlVTVVNVVFVUVVdVWFVYVVlVWVVbVVxVXFVdVV1VX1VgVWBVYVVhVWRVZFVlVWhVaVVpVWpVbVVtVW5VblVvVXJVclVzVXNVdFV0VXdVeFV4VXlVeVV6VXpVfVV+VX5Vf1V/VYVVhVWGVYZVh1WHVYhViFWJVYlVilWKVYtVi1WMVYxVjVWNVZJVklWTVZNVlFWUVZVVlVWXVZdVmFWYVZlVmVWaVZxVnVWdVZ5VnlWfVZ9VolWjVaNVpFWkVaVVpVWmValVqVWqVapVq1WrVaxVrlWuVa9Vr1WwVbBVsVW0VbRVtVW1VbZVuVW5VbpVulW7Vb5Vv1W/VcBVwFXRVdJV0lUtVS1VPlU/VT9VQFVCVUNVQ1VEVUdVSFVMVU1VTVVOVU5VUVVSVVJVU1VTVVZVV1VXVVhVWFVbVVxVXFVfVWBVYFVhVWRVZFVlVWhVaFVpVWlValVtVW1VblVuVW9VclVyVXNVc1V0VXRVd1V4VXhVeVV5VXxVfVV9VX5VflV/VX9VhFWEVYVVhVWGVYZVh1WHVYhViFWJVYlVilWKVYtVi1WMVYxVjVWNVY5VklWSVZNVk1WUVZRVlVWVVZhVmFWZVZlVmlWaVZ1VnlWeVZ9Vn1WiVaNVo1WkVaRVpVWlVaZVqlWqVatVq1WsVa9Vr1WwVbBVsVWxVbRVtFW1VbVVtlW2VblVuVW6VbpVu1W7Vb9VwFXAVdFV0lXSVS1WLVY+Vj9WP1ZAVkJWQ1ZDVkRWR1ZIVkxWTVZNVk5WTlZRVlJWUlZTVlNWVlZXVldWWFZYVltWXFZcVl9WYFZgVmFWZFZkVmVWaFZoVmlWaVZqVm1WbVZuVm5Wb1ZyVnJWc1ZzVnRWdFZ3VnhWeFZ5VnlWfFZ9Vn1WflZ+Vn9Wf1aEVoRWhVaFVoZWhlaHVodWiFaIVolWiVaKVopWi1aLVoxWjFaNVo1WjlaSVpJWk1aTVpRWlFaVVpVWmFaYVplWmVaaVppWnVaeVp5Wn1afVqJWo1ajVqRWpFalVqVWplaqVqpWq1arVqxWr1avVrBWsFaxVrFWtFa0VrVWtVa2VrZWuVa5VrpWula7VrtWv1bAVsBW0VbSVtJWLVYtVj5WPlY/VkJWQ1ZHVkdWSFZIVklWTFZNVk1WTlZRVlJWUlZVVlZWVlZXVldWWFZYVltWXFZcVl9WYFZgVmFWY1ZjVmRWZFZlVmdWZ1ZoVmhWaVZsVmxWbVZtVm5WblZvVnJWclZzVnNWdFZ3VndWeFZ4VnxWfVZ9Vn5WflZ/Vn9Wg1aDVoRWhFaFVoVWhlaGVodWh1aIVohWiVaJVopWilaLVotWjFaMVo1WjVaOVo5Wj1aTVpNWlFaUVpVWlVaWVpZWmFaZVplWmlaaVptWm1adVp5WnlafVp9WolajVqNWpFakVqVWpVamVqZWp1aqVqpWq1arVqxWr1awVrBWsVaxVrRWtVa1VrZWtla3VrdWuVa6VrpWu1a7VsBWwVbBVtFW0lbSVi1XLVc+Vz5XP1dCV0NXR1dHV0hXSFdJV0xXTVdNV05XUVdSV1JXVVdWV1ZXV1dXV1hXWFdbV1xXXFdfV2BXYFdhV2NXY1dkV2RXZVdnV2dXaFdoV2lXbFdsV21XbVduV25Xb1dyV3JXc1dzV3RXd1d3V3hXeFd8V31XfVd+V35Xf1d/V4NXg1eEV4RXhVeFV4ZXhleHV4dXiFeIV4lXiVeKV4pXi1eLV4xXjFeNV41XjleOV49Xk1eTV5RXlFeVV5VXlleWV5hXmVeZV5pXmlebV5tXnVeeV55Xn1efV6JXo1ejV6RXpFelV6VXplemV6dXqleqV6tXq1esV69XsFewV7FXsVe0V7VXtVe2V7ZXt1e3V7lXule6V7tXu1fAV8FXwVfRV9JX0lctVy1XQVdBV0JXR1dHV0hXTFdMV01XUVdRV1JXVVdWV1ZXV1dXV1tXXFdfV19XYFdgV2FXY1djV2RXZFdlV2dXZ1doV2hXaVdsV2xXbVdtV25XcVdxV3JXcldzV3dXd1d4V3hXe1d8V3xXfVd9V35XfleCV4NXg1eEV4RXhVeFV4ZXi1eMV4xXjVeNV45XjlePV49XkFeQV5NXlFeUV5VXlVeWV5ZXmFeZV5lXmleaV5tXm1eeV59Xn1eiV6NXo1ekV6RXplenV6dXqFerV6tXrFesV61XrVewV7FXsVe0V7VXtVe2V7ZXt1e3V7lXule6V7tXu1fAV8FXwVfRV9JX0lctWC1YQFhBWEFYQlhHWEtYS1hMWExYTVhRWFFYUlhVWFZYVlhXWFdYWlhbWFtYXFhfWF9YYFhiWGJYY1hjWGRYZlhmWGdYZ1hoWGhYaVhrWGtYbFhsWG1YbVhuWHBYcFhxWHFYclhyWHNYdlh2WHdYd1h4WHhYe1h8WHxYfVh9WIBYgViBWIJYgliDWINYhFiEWIVYjViNWI5YjliPWI9YkFiQWJFYkViUWJVYlViWWJZYl1iXWJlYmliaWJtYm1ieWJ9Yn1igWKBYolijWKNYpFikWKZYp1inWKhYq1irWKxYrFitWK1YrliuWK9YtVi2WLZYt1i3WLpYu1i7WLxYvFjAWMFYwVjCWNFY0ljSWC1YLVhAWEFYQVhCWEdYS1hLWExYTFhNWFFYUVhSWFVYVlhWWFdYV1haWFtYW1hcWF9YX1hgWGJYYlhjWGNYZFhmWGZYZ1hnWGhYaFhpWGtYa1hsWGxYbVhtWG5YcFhwWHFYcVhyWHJYc1h2WHZYd1h3WHhYeFh7WHxYfFh9WH1YgFiBWIFYgliCWINYg1iEWIRYhViNWI1YjliOWI9Yj1iQWJBYkViRWJRYlViVWJZYlliXWJdYmViaWJpYm1ibWJ5Yn1ifWKBYoFiiWKNYo1ikWKRYplinWKdYqFirWKtYrFisWK1YrViuWK5Yr1i1WLZYtli3WLdYuli7WLtYvFi8WMBYwVjBWMJY0VjSWNJYLVktWUBZQVlBWUJZS1lLWUxZTFlNWVFZVVlWWVZZV1laWVpZW1leWV5ZX1lfWWBZYlliWWNZY1lkWWZZZllnWWdZaFlqWWtZa1lsWWxZbVltWW5ZcFlwWXFZcVlyWXJZc1l1WXVZdll2WXdZd1l4WXtZe1l8WXxZfVl9WYBZgVmBWYJZglmDWYNZhFmEWY5ZjlmPWY9ZkFmQWZFZkVmSWZJZlVmWWZZZl1mXWZlZmlmaWZtZm1mcWZ5Zn1mfWaBZoFmiWaNZo1mkWaRZpVmlWadZqFmoWatZq1msWa5ZrlmvWbJZslm1WbZZtlm3WbdZuFm4WbtZvFm8WcBZwVnBWcJZ0VnSWdJZLVktWUBZQVlBWUJZS1lLWUxZTFlNWVFZVVlWWVZZV1laWVpZW1leWV5ZX1lfWWBZYlliWWNZY1lkWWZZZllnWWdZaFlqWWtZa1lsWWxZbVltWW5ZcFlwWXFZcVlyWXJZc1l1WXVZdll2WXdZd1l4WXtZe1l8WXxZfVl9WYBZgVmBWYJZglmDWYNZhFmEWY5ZjlmPWY9ZkFmQWZFZkVmSWZJZlVmWWZZZl1mXWZlZmlmaWZtZm1mcWZ5Zn1mfWaBZoFmiWaNZo1mkWaRZpVmlWadZqFmoWatZq1msWa5ZrlmvWbJZslm1WbZZtlm3WbdZuFm4WbtZvFm8WcBZwVnBWcJZ0VnSWdJZLVotWkBaQVpBWkJaRlpGWktaS1pMWkxaTVpQWlBaUVpVWlVaVlpWWldaWlpaWltaXlpeWl9aX1pgWmJaYlpjWmNaZFpmWmZaZ1pnWmhaalprWmtabFpsWm1acFpwWnFacVpyWnVadVp2WnZad1p3Wnhaelp6Wntae1p8WnxafVp9WoBagFqBWoFaglqCWoNag1qJWo5aj1qPWpBakFqRWpFaklqSWpVallqWWpdal1qYWplamlqaWptam1qcWp5an1qfWqBaoFqhWqJao1qjWqRapFqlWqVap1qoWqhaq1qrWqxarlquWq9ar1qwWrJaslqzWrNatlq3WrdauFq4WrxavFrAWsFawVrCWtFa0lrSWi1aLVo6WjtaO1o/WkBaQFpBWkFaQlpFWkVaRlpGWkdaS1pLWkxaTFpNWlBaUFpRWlRaVFpVWlVaVlpaWlpaW1pdWl1aXlpeWl9aX1pgWmBaYVphWmJaYlpjWmNaZVpmWmZaZ1pnWmlaalpqWmtaa1psWmxabVpvWnBacFpxWnFaclp1WnVadlp2Wndad1p4WnlaeVp6Wnpae1p7WnxafFp9Wn9af1qAWoBagVqBWoJaglqDWoNah1qIWohaiVqJWopailqLWotaj1qQWpBakVqRWpJaklqTWpVallqWWpdal1qYWppam1qbWpxan1qfWqBaoFqhWqNapFqkWqVapVqnWqhaqFqpWqlaq1qsWq5arlqvWq9asFqyWrJas1qzWrRatlq3WrdauFq4WrtavFq8Wr1avVrBWsFawlrRWtJa0lotWy1bOls7WztbP1tAW0BbQVtBW0JbRVtFW0ZbRltHW0tbS1tMW0xbTVtQW1BbUVtUW1RbVVtVW1ZbWltaW1tbXVtdW15bXltfW19bYFtgW2FbYVtiW2JbY1tjW2VbZltmW2dbZ1tpW2pbaltrW2tbbFtsW21bb1twW3BbcVtxW3JbdVt1W3Zbdlt3W3dbeFt5W3lbelt6W3tbe1t8W3xbfVt/W39bgFuAW4FbgVuCW4Jbg1uDW4dbiFuIW4lbiVuKW4pbi1uLW49bkFuQW5FbkVuSW5Jbk1uVW5ZblluXW5dbmFuaW5tbm1ucW59bn1ugW6BboVujW6RbpFulW6Vbp1uoW6hbqVupW6tbrFuuW65br1uvW7BbsluyW7Nbs1u0W7Zbt1u3W7hbuFu7W7xbvFu9W71bwVvBW8Jb0VvSW9JbLVstWzpbO1s7Wz9bQFtAW0FbQVtFW0VbRltGW0pbSltLW0tbTFtQW1BbUVtUW1RbVVtVW1ZbWVtZW1pbWltbW11bXVteW15bX1thW2JbYltjW2NbZVtmW2ZbZ1tnW2pba1trW2xbbFtvW3BbcFtxW3Fbclt1W3Vbdlt2W3dbeVt5W3pbelt7W3tbfFt/W39bgFuAW4FbgVuCW4JbhluHW4dbiFuIW4lbiVuKW4pbi1uLW4xbjFuNW41bkVuRW5JbkluTW5NblFuUW5VblVuWW5Zbl1uXW5hbmlubW5tbnFucW51bn1ufW6BboFuhW6RbpFulW6VbqFupW6lbq1usW6xbrVuuW65br1uvW7BbsluyW7Nbs1u0W7Zbt1u3W7hbuFu5W7tbvFu8W71bvVu+W8FbwVvCW9Fb0lvSWy1cLVw6XDtcO1w/XEBcQFxBXEFcRVxFXEZcRlxKXEpcS1xLXExcUFxQXFFcVFxUXFVcVVxWXFlcWVxaXFpcW1xdXF1cXlxeXF9cYVxiXGJcY1xjXGVcZlxmXGdcZ1xqXGtca1xsXGxcb1xwXHBccVxxXHJcdVx1XHZcdlx3XHlceVx6XHpce1x7XHxcf1x/XIBcgFyBXIFcglyCXIZch1yHXIhciFyJXIlcilyKXItci1yMXIxcjVyNXJFckVySXJJck1yTXJRclFyVXJVcllyWXJdcl1yYXJpcm1ybXJxcnFydXJ9cn1ygXKBcoVykXKRcpVylXKhcqVypXKtcrFysXK1crlyuXK9cr1ywXLJcslyzXLNctFy2XLdct1y4XLhcuVy7XLxcvFy9XL1cvlzBXMFcwlzRXNJc0lwtXC1cP1xAXEBcQVxBXERcRVxFXEpcSlxLXEtcTFxPXE9cUFxQXFFcVFxUXFVcWVxZXFpcXVxdXF5cXlxfXGFcYlxiXGNcY1xlXGZcZlxnXGdcalxrXGtcbFxsXG9ccFxwXHFccVxyXHVcdVx2XHZcd1x5XHlcelx6XHtce1x8XH9cf1yAXIBcgVyBXIJchlyHXIdciFyIXIlciVyKXIpci1yLXIxcjFyNXI1cjlyRXJFcklySXJNck1yUXJRclVyVXJZcllyXXJdcmFyYXJlcmlybXJtcnFycXJ1cn1yfXKBcoFyhXKRcpFylXKVcqFypXKlcq1ysXKxcrVyuXK5cr1yvXLBcsFyxXLJcslyzXLNctFy3XLdcuFy4XLlcvFy8XL1cvVy+XMFcwVzCXMJcw1zRXNJc0lwtXS1dP11AXUBdRF1JXUpdSl1LXUtdTF1PXU9dUF1QXVRdVF1VXVhdWF1ZXVldWl1cXV1dXV1eXV5dYV1iXWJdZV1mXWZdal1rXWtdbF1sXW5db11vXXBdcF1xXXFddF11XXVddl12XXddd114XXhdeV15XXpdel17XX9df12AXYBdgV2FXYddiF2IXYldiV2KXYpdi12LXYxdjF2NXY1djl2RXZFdkl2SXZNdk12UXZZdll2XXZddmF2YXZldm12bXZxdnF2dXZ9dn12gXaBdoV2kXaRdpV2lXahdqV2pXapdql2sXa1drV2uXa5dr12vXbBdsF2xXbNds120Xbddt124XbhduV25XbpdvF28Xb1dvV2+Xb5dv13BXcFdwl3CXcNd0V3SXdJdLV0tXT9dQF1AXURdSV1KXUpdS11LXUxdT11PXVBdUF1UXVRdVV1YXVhdWV1ZXVpdXF1dXV1dXl1eXWFdYl1iXWVdZl1mXWpda11rXWxdbF1uXW9db11wXXBdcV1xXXRddV11XXZddl13XXddeF14XXldeV16XXpde11/XX9dgF2AXYFdhV2HXYhdiF2JXYldil2KXYtdi12MXYxdjV2NXY5dkV2RXZJdkl2TXZNdlF2WXZZdl12XXZhdmF2ZXZtdm12cXZxdnV2fXZ9doF2gXaFdpF2kXaVdpV2oXaldqV2qXapdrF2tXa1drl2uXa9dr12wXbBdsV2zXbNdtF23XbdduF24XblduV26XbxdvF29Xb1dvl2+Xb9dwV3BXcJdwl3DXdFd0l3SXS1eLV4+Xj9eP15AXkReSV5KXkpeS15LXk9eT15QXlBeU15TXlReVF5VXlheWF5ZXlleWl5cXl1eXV5eXl5eYF5hXmFeYl5iXmReZV5lXmZeZl5pXmpeal5rXmtebl5vXm9ecF5wXnFecV50XnVedV52XnZeeF55Xnleel56Xntefl5+Xn9ef16AXoBegV6EXoRehV6FXoZejV6NXo5ejl6PXpJekl6TXpNelF6UXpVel16XXphemF6ZXptem16cXpxenV6fXp9eoF6gXqFepF6kXqVepV6mXqheqV6pXqpeql6sXq1erV6vXq9esF6wXrFes16zXrRet163XrheuF65Xrleul69Xr1evl6+Xr9ewl7CXsNew17EXtFe0l7SXi1eLV4+Xj9eP15AXkReSV5KXkpeS15LXk9eT15QXlBeU15TXlReVF5VXlheWF5ZXlleWl5cXl1eXV5eXl5eYF5hXmFeYl5iXmReZV5lXmZeZl5pXmpeal5rXmtebl5vXm9ecF5wXnFecV50XnVedV52XnZeeF55Xnleel56Xntefl5+Xn9ef16AXoBegV6EXoRehV6FXoZejV6NXo5ejl6PXpJekl6TXpNelF6UXpVel16XXphemF6ZXptem16cXpxenV6fXp9eoF6gXqFepF6kXqVepV6mXqheqV6pXqpeql6sXq1erV6vXq9esF6wXrFes16zXrRet163XrheuF65Xrleul69Xr1evl6+Xr9ewl7CXsNew17EXtFe0l7SXi1fLV85XzpfPl8/Xz9fQF9DX0RfRF9FX0VfSF9JX0lfSl9KX0tfS19OX09fT19TX1NfVF9UX1VfWF9YX1lfWV9cX11fXV9gX2FfYV9iX2JfZF9kX2VfZV9mX2ZfaF9pX2lfal9qX2tfa19tX25fbl9vX29fcF9wX3FfcV90X3VfdV92X3ZfeF95X3lfel96X3tffl9+X39ff1+AX4Nfg1+EX4RfhV+FX4Zfjl+OX49fj1+QX5Nfk1+UX5RflV+XX5dfmF+YX5lfnF+cX51foF+gX6FfoV+iX6VfpV+mX6hfqV+pX6pfql+sX61frV+vX7BfsF+xX7RftF+1X7hfuF+5X7lful+9X71fvl++X79fv1/AX8FfwV/CX8Jfw1/DX8Rf0V/SX9JfLV8tXz5fPl8/Xz9fQF9DX0RfRF9FX0VfSF9JX0lfSl9KX05fU19TX1RfVF9XX1hfWF9bX1xfXF9dX11fYF9hX2FfZF9kX2VfZV9mX2ZfaF9pX2lfal9qX2tfa19tX25fbl9vX29fcF9wX3RfdV91X3Zfdl94X3lfeV96X3pfe19+X35ff19/X4Bfgl+DX4NfhF+EX4VfhV+GX4hfiF+OX45fj1+PX5Bfk1+TX5RflF+VX5Vfl1+XX5hfmF+ZX5xfnF+dX51fnl+gX6BfoV+hX6JfpV+lX6ZfqF+pX6lfql+qX6xfrV+tX65frl+vX7BfsF+xX7FftF+0X7VfuF+4X7lfuV+6X7pfu1+9X71fvl++X79fv1/AX8FfwV/CX8Jfw1/DX8Rf0V/SX9JfLWAtYD5gPmA/YD9gQGBDYERgRGBFYEVgSGBJYElgSmBKYE5gU2BTYFRgVGBXYFhgWGBbYFxgXGBdYF1gYGBhYGFgZGBkYGVgZWBmYGZgaGBpYGlgamBqYGtga2BtYG5gbmBvYG9gcGBwYHRgdWB1YHZgdmB4YHlgeWB6YHpge2B+YH5gf2B/YIBggmCDYINghGCEYIVghWCGYIhgiGCOYI5gj2CPYJBgk2CTYJRglGCVYJVgl2CXYJhgmGCZYJxgnGCdYJ1gnmCgYKBgoWChYKJgpWClYKZgqGCpYKlgqmCqYKxgrWCtYK5grmCvYLBgsGCxYLFgtGC0YLVguGC4YLlguWC6YLpgu2C9YL1gvmC+YL9gv2DAYMFgwWDCYMJgw2DDYMRg0WDSYNJgLWAtYD5gPmA/YD9gQGBDYERgRGBFYEVgSWBOYE9gT2BSYFNgU2BUYFRgV2BYYFhgW2BcYFxgXWBdYF9gYGBgYGFgYWBkYGRgZWBlYGhgaWBpYGpgamBrYGtgbWBuYG5gb2BvYHBgcGBzYHRgdGB1YHVgeGB5YHlgemB6YHtgfWB+YH5gf2B/YIBggmCDYINghGCEYIVghWCGYIhgiGCKYItgi2COYI9gj2CQYJBgk2CTYJRglGCVYJVglmCWYJdgl2CYYJhgmWCZYJpgnGCcYJ1gnWCeYJ5goGCgYKFgoWCiYKVgpWCmYKZgp2CnYKhgqGCpYKlgqmCqYKxgrWCtYK5grmCvYLBgsGCxYLFgtGC1YLVgtmC5YLlgumC6YLtgvmC+YL9gv2DAYMJgwmDDYMNgxGDEYNFg0mDSYC1hLWE+YT5hP2E/YUBhQ2FEYURhRWFFYUlhTmFPYU9hUmFTYVNhVGFUYVdhWGFYYVthXGFcYV1hXWFfYWBhYGFhYWFhZGFkYWVhZWFoYWlhaWFqYWpha2FrYW1hbmFuYW9hb2FwYXBhc2F0YXRhdWF1YXhheWF5YXphemF7YX1hfmF+YX9hf2GAYYJhg2GDYYRhhGGFYYVhhmGIYYhhimGLYYthjmGPYY9hkGGQYZNhk2GUYZRhlWGVYZZhlmGXYZdhmGGYYZlhmWGaYZxhnGGdYZ1hnmGeYaBhoGGhYaFhomGlYaVhpmGmYadhp2GoYahhqWGpYaphqmGsYa1hrWGuYa5hr2GwYbBhsWGxYbRhtWG1YbZhuWG5YbphumG7Yb5hvmG/Yb9hwGHCYcJhw2HDYcRhxGHRYdJh0mEtYS1hPmE+YT9hQ2FEYURhSGFJYUlhTWFOYU5hT2FPYVJhU2FTYVRhVGFXYVhhWGFbYVxhXGFdYV1hX2FgYWBhYWFhYWRhZGFlYWVhaGFpYWlhamFqYW1hbmFuYW9hb2FwYXBhc2F0YXRhdWF1YXdheGF4YXlheWF6YXphe2F9YX5hfmF/YX9hgmGDYYNhhGGEYYVhh2GKYYthi2GMYYxhjmGPYY9hkGGQYZFhkWGTYZNhlGGUYZVhlWGWYZZhl2GXYZhhmGGZYZlhmmGcYZxhnWGdYZ5hnmGfYZ9hoGGgYaFhoWGiYaVhpWGmYaZhp2GnYahhqGGpYalhqmGqYaxhrWGtYa5hrmGwYbFhsWG0YbVhtWG2YblhuWG6Ybphu2G+Yb5hv2G/YcBhwmHDYcNhxGHEYdFh0mHSYS1iLWI+YkJiQ2JDYkRiRGJIYkliSWJNYk5iTmJPYk9iUmJTYlNiVGJUYlZiV2JXYlhiWGJbYlxiXGJfYmBiYGJhYmFiZGJkYmViZWJoYmhiaWJpYmpiamJtYm1ibmJuYm9ib2JwYnBicmJzYnNidGJ0YnVidWJ3YnhieGJ5YnliemJ6Yn1ifmJ+Yn9if2KCYoNig2KEYoRih2KIYohiimKLYotijGKMYo9ikGKQYpFikWKTYpRilGKVYpVilmKWYphimGKZYplimmKcYpxinWKdYp5inmKgYqBioWKhYqJiomKjYqVipWKmYqZip2KpYqliqmKqYqxirWKtYq5irmKwYrFisWKyYrJitGK1YrVitmK2YrliuWK6Yrpiu2K+Yr9iv2LAYsBiw2LEYsRixWLFYtFi0mLSYi1iLWI+YkJiQ2JDYkRiRGJIYkliSWJNYk5iTmJPYk9iUmJTYlNiVGJUYlZiV2JXYlhiWGJbYlxiXGJfYmBiYGJhYmFiZGJkYmViZWJoYmhiaWJpYmpiamJtYm1ibmJuYm9ib2JwYnBicmJzYnNidGJ0YnVidWJ3YnhieGJ5YnliemJ6Yn1ifmJ+Yn9if2KCYoNig2KEYoRih2KIYohiimKLYotijGKMYo9ikGKQYpFikWKTYpRilGKVYpVilmKWYphimGKZYplimmKcYpxinWKdYp5inmKgYqBioWKhYqJiomKjYqVipWKmYqZip2KpYqliqmKqYqxirWKtYq5irmKwYrFisWKyYrJitGK1YrVitmK2YrliuWK6Yrpiu2K+Yr9iv2LAYsBiw2LEYsRixWLFYtFi0mLSYi1jLWM9Yz1jPmNCY0NjQ2NEY0djSGNIY0ljSWNNY05jTmNPY09jUmNTY1NjVmNXY1djW2NcY1xjX2NfY2BjYGNhY2FjZGNkY2VjaGNoY2ljaWNqY2pjbWNtY25jbmNvY29jcGNwY3JjcmNzY3NjdGN0Y3VjdWN3Y3hjeGN5Y3ljemN6Y31jfmN+Y39jf2OCY4Njg2OEY4RjhmOHY4djiGOIY4pji2OLY4xjjGONY41jj2OQY5BjkWORY5NjlGOUY5VjlWOWY5ZjmGOYY5ljmWOaY5xjnGOdY51jnmOhY6FjomOiY6NjpWOlY6ZjpmOnY6ljqWOqY6pjq2OtY65jrmOvY7BjsWOxY7JjsmO0Y7VjtWO2Y7ZjuWO6Y7pju2O7Y75jv2O/Y8BjwGPDY8RjxGPFY8Vj0WPSY9JjLWMtYz1jPWM+Y0JjQ2NDY0RjR2NIY0hjSWNJY01jTmNOY09jT2NSY1NjU2NWY1djV2NbY1xjXGNfY19jYGNgY2FjYWNkY2RjZWNoY2hjaWNpY2pjamNtY21jbmNuY29jb2NwY3BjcmNyY3Njc2N0Y3RjdWN1Y3djeGN4Y3ljeWN6Y3pjfWN+Y35jf2N/Y4Jjg2ODY4RjhGOGY4djh2OIY4hjimOLY4tjjGOMY41jjWOPY5BjkGORY5Fjk2OUY5RjlWOVY5ZjlmOYY5hjmWOZY5pjnGOcY51jnWOeY6FjoWOiY6Jjo2OlY6VjpmOmY6djqWOpY6pjqmOrY61jrmOuY69jsGOxY7FjsmOyY7RjtWO1Y7ZjtmO5Y7pjumO7Y7tjvmO/Y79jwGPAY8NjxGPEY8VjxWPRY9Jj0mMtZC1kPWQ9ZD5kPmQ/ZEJkQ2RDZERkR2RIZEhkSWRJZExkTWRNZE5kTmRRZFJkUmRTZFNkVmRXZFdkW2RcZF9kX2RgZGBkYWRkZGhkaGRpZGlkamRqZG1kbWRuZG5kb2RvZHBkcGRyZHNkc2R0ZHRkdWR1ZHdkeGR4ZHlkeWR6ZHpkfWR+ZH5kf2R/ZIJkg2SDZIRkhGSGZIdkh2SIZIhki2SMZIxkjWSNZI9kkGSQZJFkkWSUZJVklWSWZJZkmGSYZJlkmWSaZJpknGSdZJ1knmSeZKFkoWSiZKJko2SlZKVkpmSmZKdkqWSpZKpkqmSrZKtkrGStZK5krmSvZLBksWSxZLJksmS0ZLVktWS2ZLZkuWS6ZLpku2S7ZLxkvGS+ZL9kv2TAZMBkxGTFZMVkxmTGZNFk0mTSZC1kLWQ9ZD1kPmQ+ZD9kQmRCZENkR2RHZEhkSGRJZExkTWRNZE5kTmRRZFJkUmRTZFNkVmRXZFdkWmRbZFtkXGReZF5kX2RfZGBkYGRhZGNkY2RkZGhkaGRpZGlkamRtZG1kbmRuZG9kb2RyZHNkc2R0ZHRkdWR1ZHdkeGR4ZHlkeWR9ZH5kfmR/ZH9kgmSDZINkhGSEZIZkh2SHZIhkiGSLZIxkjGSNZI1kjmSQZJFkkWSSZJJklGSVZJVklmSWZJdkl2SYZJhkmWSZZJpknGSdZJ1knmSeZKFkoWSiZKJko2SjZKVkpWSmZKZkp2SpZKlkqmSqZKtkq2SsZK1krmSuZK9ksWSyZLJktWS2ZLZkt2S3ZLlkumS6ZLtku2S8ZLxkvmS/ZL9kwGTAZMRkxWTFZMZkxmTRZNJk0mQtZS1lPWU9ZT5lPmU/ZUJlQmVDZUdlR2VIZUhlSWVMZU1lTWVOZU5lUWVSZVJlU2VTZVZlV2VXZVplW2VbZVxlXmVeZV9lX2VgZWBlYWVjZWNlZGVoZWhlaWVpZWplbWVtZW5lbmVvZW9lcmVzZXNldGV0ZXVldWV3ZXhleGV5ZXllfWV+ZX5lf2V/ZYJlg2WDZYRlhGWGZYdlh2WIZYhli2WMZYxljWWNZY5lkGWRZZFlkmWSZZRllWWVZZZllmWXZZdlmGWYZZllmWWaZZxlnWWdZZ5lnmWhZaFlomWiZaNlo2WlZaVlpmWmZadlqWWpZaplqmWrZatlrGWtZa5lrmWvZbFlsmWyZbVltmW2Zbdlt2W5ZbplumW7ZbtlvGW8Zb5lv2W/ZcBlwGXEZcVlxWXGZcZl0WXSZdJlLWUtZTxlPGU9ZT1lPmU+ZT9lQmVCZUNlR2VHZUhlSGVJZUxlTWVNZU5lTmVRZVFlUmVSZVNlU2VWZVdlV2VaZVtlW2VcZV5lXmVfZV9lYGVgZWFlY2VjZWRlZ2VnZWhlaGVpZWllamVtZW1lbmVuZW9lb2VyZXNlc2V0ZXRldWV1ZXdleGV4ZXlleWV6ZXplfGV9ZX1lfmV+ZX9lf2WBZYJlgmWDZYNlhGWEZYZlh2WHZYhliGWLZYxljGWNZY1ljmWQZZFlkWWSZZJllGWVZZVllmWWZZdll2WYZZhlmWWZZZplnGWdZZ1lnmWeZaFloWWiZaJlo2WjZaVlpWWmZaZlp2WpZallqmWqZatlq2WsZa5lrmWvZbFlsmWyZbVltmW2Zbdlt2W5ZbplumW7ZbtlvGW8Zb9lwGXAZcRlxWXFZcZlxmXRZdJl0mUtZi1mPGY8Zj1mPWY+ZkFmQWZCZkJmQ2ZHZkdmSGZIZklmTGZMZk1mTWZOZk5mUWZRZlJmUmZTZlNmVWZWZlZmV2ZXZlpmW2ZbZlxmXmZeZl9mX2ZgZmNmY2ZkZmdmZ2ZoZmhmaWZtZm1mbmZuZm9mb2ZyZnNmc2Z0ZnRmdWZ1ZndmeGZ4ZnlmeWZ6ZnpmfGZ9Zn1mfmZ+Zn9mf2aBZoJmgmaDZoNmhGaEZoZmh2aHZohmiGaLZoxmjGaNZo1mjmaQZpFmkWaSZpJmlWaWZpZml2aXZphmmGaZZplmmmacZp1mnWaeZp5moWahZqJmomajZqNmpmamZqdmp2aoZqlmqWaqZqpmq2arZqxmrWauZq5mr2axZrJmsma1ZrZmtma3Zrdmuma7ZrtmvGa8Zr9mwGbAZsFmwWbEZsVmxWbGZsZmx2bRZtJm0mYtZi1mPGY8Zj1mPWY+ZkFmQWZCZkJmQ2ZHZkdmSGZIZklmTGZMZk1mTWZOZk5mUWZRZlJmUmZTZlNmVWZWZlZmV2ZXZlpmW2ZbZlxmXmZeZl9mX2ZgZmNmY2ZkZmdmZ2ZoZmhmaWZtZm1mbmZuZm9mb2ZyZnNmc2Z0ZnRmdWZ1ZndmeGZ4ZnlmeWZ6ZnpmfGZ9Zn1mfmZ+Zn9mf2aBZoJmgmaDZoNmhGaEZoZmh2aHZohmiGaLZoxmjGaNZo1mjmaQZpFmkWaSZpJmlWaWZpZml2aXZphmmGaZZplmmmacZp1mnWaeZp5moWahZqJmomajZqNmpmamZqdmp2aoZqlmqWaqZqpmq2arZqxmrWauZq5mr2axZrJmsma1ZrZmtma3Zrdmuma7ZrtmvGa8Zr9mwGbAZsFmwWbEZsVmxWbGZsZmx2bRZtJm0mYtZy1nPGc8Zz1nPWc+Z0FnQWdCZ0dnR2dIZ0xnTGdNZ01nTmdRZ1FnUmdSZ1VnVmdWZ1dnV2daZ1tnW2dcZ19nX2dgZ2JnYmdjZ2NnZGdnZ2dnaGdoZ2lnbWdtZ25nbmdvZ3Jnc2dzZ3RndGd1Z3Vnd2d3Z3hneGd5Z3lnfGd9Z31nfmd+Z39nf2eBZ4JngmeDZ4NnhGeEZ4Znh2eHZ4hniGeLZ4xnjGeNZ41njmeQZ5FnkWeSZ5JnlWeWZ5Znl2eXZ5hnmGeZZ5lnmmecZ51nnWeeZ55noWehZ6JnomejZ6ZnpmenZ6dnqGeqZ6pnq2erZ6xnrGetZ61nrmeuZ69nsWeyZ7JntWe2Z7Znt2e3Z7pnu2e7Z7xnvGe/Z8BnwGfBZ8FnxGfFZ8VnxmfGZ8dn0WfSZ9JnLWctZzxnPGc9Zz1nPmdBZ0FnQmdHZ0dnSGdMZ0xnTWdNZ05nUWdRZ1JnUmdVZ1ZnVmdXZ1dnWmdbZ1tnXGdfZ19nYGdiZ2JnY2djZ2RnZ2dnZ2hnaGdpZ21nbWduZ25nb2dyZ3Nnc2d0Z3RndWd1Z3dnd2d4Z3hneWd5Z3xnfWd9Z35nfmd/Z39ngWeCZ4Jng2eDZ4RnhGeGZ4dnh2eIZ4hni2eMZ4xnjWeNZ45nkGeRZ5FnkmeSZ5VnlmeWZ5dnl2eYZ5hnmWeZZ5pnnGedZ51nnmeeZ6FnoWeiZ6Jno2emZ6Znp2enZ6hnqmeqZ6tnq2esZ6xnrWetZ65nrmevZ7FnsmeyZ7Vntme2Z7dnt2e6Z7tnu2e8Z7xnv2fAZ8BnwWfBZ8RnxWfFZ8ZnxmfHZ9Fn0mfSZy1oLWg8aDxoPWg9aEFoQWhCaEZoRmhHaEdoSGhMaExoTWhNaE5oUWhRaFJoUmhVaFZoVmhXaFpoW2hbaFxoX2hfaGBoYmhiaGNoY2hkaGdoZ2hoaGhoaWhtaG1obmhuaG9ocmhzaHNodGh0aHVodWh3aHdoeGh4aHloeWh8aH1ofWh+aH5of2h/aIFogmiCaINog2iEaIRohWiHaIhoiGiMaIxojWiNaI5okWiRaJJokmiTaJVolmiWaJdol2iYaJhomWiZaJponGidaJ1onmieaKFooWiiaKJoo2imaKZop2inaKhoqmiqaKtoq2isaKxorWitaK5ormivaLJosmizaLNotWi2aLZot2i3aLloumi6aLtou2i8aLxov2jAaMBowWjBaMJoxWjFaMZoxmjHaNFo0mjSaC1oLWg8aDxoQWhBaEJoRmhGaEdoS2hLaExoTGhNaFFoUWhSaFVoVmhWaFdoWmhbaF9oYmhiaGNoY2hkaGdoZ2hoaG1obmhuaG9oc2h0aHRodWh1aHdod2h4aHhoeWh5aHpoemh8aH1ofWh+aH5of2h/aIFogmiCaINog2iEaIRohWiHaIhoiGiJaIxojGiNaI1ojmiRaJFokmiSaJNolmiWaJdol2iYaJhomWiZaJponGicaJ1onWieaJ5ooWihaKJoomijaKZopminaKdoqGiqaKpoq2iraKxorGitaK1ormiuaK9or2iwaLJosmizaLNotmi3aLdouGi4aLlouWi6aLpou2i7aLxovGjAaMFowWjCaMRoxWjFaMZoxmjHaMdoyGjRaNJo0mgtaS1pPGk8aUFpQWlCaUZpRmlHaUtpS2lMaUxpTWlRaVFpUmlVaVZpVmlXaVppW2lfaWJpYmljaWNpZGlnaWdpaGltaW5pbmlvaXNpdGl0aXVpdWl3aXdpeGl4aXlpeWl6aXppfGl9aX1pfml+aX9pf2mBaYJpgmmDaYNphGmEaYVph2mIaYhpiWmMaYxpjWmNaY5pkWmRaZJpkmmTaZZplmmXaZdpmGmYaZlpmWmaaZxpnGmdaZ1pnmmeaaFpoWmiaaJpo2mmaaZpp2mnaahpqmmqaatpq2msaaxprWmtaa5prmmvaa9psGmyabJps2mzabZpt2m3abhpuGm5ablpumm6abtpu2m8abxpwGnBacFpwmnEacVpxWnGacZpx2nHachp0WnSadJpLWktaTtpQWlBaUJpRmlGaUdpR2lIaUtpS2lMaUxpTWlRaVFpUmlSaVVpVWlWaVZpV2laaVppW2leaV5pX2liaWJpY2ljaWRpZmlmaWdpZ2loaWppa2lraW1pbmluaW9pc2l0aXRpdWl1aXdpd2l4aXhpeWl5aXppeml8aX1pfWl+aX5pf2l/aYFpgmmCaYNpg2mEaYRphWmHaYhpiGmJaYxpjGmNaY1pjmmRaZFpkmmSaZNplmmWaZdpl2mYaZhpmWmZaZppnGmcaZ1pnWmeaZ5poWmhaaJpommjaaNppmmmaadpp2moaappqmmraatprGmuaa5pr2mvabBpsmmyabNps2m2abdpt2m4abhpuWm6abtpu2m8abxpvWm9acBpwWnBacJpxWnFacZpxmnHacdpyGnRadJp0mktai1qO2pBakFqQmpGakZqR2pHakhqS2pLakxqTGpNalFqUWpSalJqVWpValZqVmpXalpqWmpbal5qXmpfamJqYmpjamNqZGpmamZqZ2pnamhqampramtqbWpuam5qb2pzanRqdGp1anVqd2p3anhqeGp5anlqemp6anxqfWp9an5qfmp/an9qgWqCaoJqg2qDaoRqhGqFaodqiGqIaolqjGqMao1qjWqOapFqkWqSapJqk2qWapZql2qXaphqmGqZaplqmmqcapxqnWqdap5qnmqhaqFqomqiaqNqo2qmaqZqp2qnaqhqqmqqaqtqq2qsaq5qrmqvaq9qsGqyarJqs2qzarZqt2q3arhquGq5arpqu2q7arxqvGq9ar1qwGrBasFqwmrFasVqxmrGasdqx2rIatFq0mrSai1qLWo6ajtqO2pBakFqQmpGakZqR2pHakhqTGpMak1qUWpRalJqUmpValVqVmpWaldqWmpaaltqXmpeal9qX2pgamJqYmpjamNqZGpmamZqZ2pnamhqampramtqbWptam5qbmpvam9qcGpwanFqcWpzanRqdGp1anVqd2p4anhqeWp5anpqemp8an1qfWp+an5qf2p/aoFqgmqCaoNqg2qEaoRqhWqHaohqiGqJaolqimqMaoxqjWqNao5qjmqPapFqkWqSapJqk2qTapRqlmqWapdql2qYaphqmWqZappqnGqdap1qnmqhaqFqomqiaqNqo2qmaqZqp2qnaqhqqmqqaqtqq2qsaq5qrmqvaq9qsGqyarJqs2qzarZqt2q3arhquGq5artqvGq8ar1qvWrAasFqwWrCasZqxmrHasdqyGrRatJq0motay1rOms7aztrP2tAa0BrQWtBa0JrRWtFa0ZrRmtHa0trS2tMa0xrTWtQa1BrUWtRa1JrUmtVa1VrVmtWa1drV2taa1prW2tea15rX2tfa2BrYmtia2NrY2tka2ZrZmtna2draGtqa2tra2tta21rbmtua29rb2twa3BrcWtxa3NrdGt0a3VrdWt3a3hreGt5a3lremt6a3xrfWt9a35rfmt/a39rgmuDa4NrhGuEa4Vrh2uIa4hriWuJa4prjGuMa41rjWuOa45rj2uRa5FrkmuSa5Nrk2uUa5ZrlmuXa5drmGuYa5lrmWuaa5xrnGuda51rnmuea6FroWuia6Jro2uja6Zrpmuna6drqGuqa6prq2ura6xrr2uva7Brs2uza7Zrt2u3a7hruGu5a7trvGu8a71rvWvAa8FrwWvCa8Jrw2vGa8Zrx2vHa8hr0WvSa9JrLWstazprO2s7az9rQGtAa0FrQWtCa0VrRWtGa0ZrR2tLa0trTGtMa01rUGtQa1FrUWtSa1JrVWtVa1ZrVmtXa1drWmtaa1trXmtea19rX2tga2JrYmtja2NrZGtma2ZrZ2tna2hramtra2trbWtta25rbmtva29rcGtwa3FrcWtza3RrdGt1a3Vrd2t4a3hreWt5a3premt8a31rfWt+a35rf2t/a4Jrg2uDa4RrhGuFa4driGuIa4lriWuKa4xrjGuNa41rjmuOa49rkWuRa5JrkmuTa5NrlGuWa5Zrl2uXa5hrmGuZa5lrmmuca5xrnWuda55rnmuha6Fromuia6Nro2uma6Zrp2una6hrqmuqa6trq2usa69rr2uwa7Nrs2u2a7drt2u4a7hruWu7a7xrvGu9a71rwGvBa8FrwmvCa8NrxmvGa8drx2vIa9Fr0mvSay1sLWw5bDpsOmw7bD9sQGxAbEFsQWxCbEVsRWxGbEZsR2xLbEtsTGxQbFBsUWxRbFJsUmxVbFVsVmxWbFdsWmxabFtsW2xcbF1sXWxebF5sX2xfbGBsYmxibGNsY2xkbGZsZmxnbGdsaGxqbGtsa2xtbG1sbmxvbHBscGxxbHFsc2x0bHRsdWx1bHhseWx5bHpsemx8bH1sfWx+bH5sf2x/bIBsgmyDbINshGyEbIVsh2yIbIhsiWyJbIpsjGyMbI1sjWyObI5sj2yRbJFskmySbJNsk2yUbJZslmyXbJdsmGyYbJlsmWyabJxsnGydbJ1snmyebKFsomyibKNso2ykbKRspmymbKdsp2yobKpsqmyrbKtsrGyubK5sr2yvbLBss2yzbLRstmy3bLdsuGy4bLlsu2y8bLxsvWy9bL5swGzBbMFswmzCbMNsw2zEbMZsxmzHbMdsyGzRbNJs0mwtbC1sOWw6bDpsO2w/bEBsQGxBbEFsQmxFbEVsRmxGbEdsS2xLbExsUGxQbFFsUWxSbFJsVWxVbFZsVmxXbFpsWmxbbFtsXGxdbF1sXmxebF9sX2xgbGJsYmxjbGNsZGxmbGZsZ2xnbGhsamxrbGtsbWxtbG5sb2xwbHBscWxxbHNsdGx0bHVsdWx4bHlseWx6bHpsfGx9bH1sfmx+bH9sf2yAbIJsg2yDbIRshGyFbIdsiGyIbIlsiWyKbIxsjGyNbI1sjmyObI9skWyRbJJskmyTbJNslGyWbJZsl2yXbJhsmGyZbJlsmmycbJxsnWydbJ5snmyhbKJsomyjbKNspGykbKZspmynbKdsqGyqbKpsq2yrbKxsrmyubK9sr2ywbLNss2y0bLZst2y3bLhsuGy5bLtsvGy8bL1svWy+bMBswWzBbMJswmzDbMNsxGzGbMZsx2zHbMhs0WzSbNJsLW0tbTltOm06bTttPm0/bT9tQG1AbUFtQW1FbUVtRm1GbUdtSm1KbUttS21MbVBtUG1RbVFtUm1VbVVtVm1WbVdtWW1ZbVptWm1bbV1tXW1ebV5tX21fbWBtYm1ibWNtY21mbWZtZ21nbWhtam1rbWttbW1tbW5tbm1vbW9tcG1wbXFtcW1zbXRtdG11bXVteG15bXltem16bX1tfm1+bX9tf22AbYJtg22DbYRthG2FbYhtiG2JbYltim2KbYttjG2MbY1tjW2ObY5tj22QbZFtkW2SbZJtk22TbZRtlm2WbZdtl22YbZhtmW2ZbZptnG2cbZ1tnW2ebZ5toW2ibaJto22jbaRtpG2mbaZtp22nbahtqG2qbaptq22rbaxtrm2uba9tr22wbbNts220bbdtt224bbhtuW28bbxtvW29bb5twG3BbcFtwm3CbcNtw23EbcZtxm3HbcdtyG3RbdJt0m0tbS1tOW06bTptO20+bT9tP21AbUBtQW1BbUVtRW1GbUZtR21HbUhtSm1KbUttS21MbVBtUG1RbVFtUm1VbVVtVm1WbVdtWm1abVttXm1ebV9tX21gbWJtYm1jbWNtZm1mbWdtZ21obWpta21rbWxtbG1tbW1tbm1ubW9tb21wbXBtcW1xbXNtdG10bXVtdW14bXlteW16bXptfW1+bX5tf21/bYBtgm2DbYNthG2EbYVtiG2IbYltiW2KbYpti22MbYxtjW2NbY5tjm2PbZBtkW2RbZJtkm2TbZNtlG2WbZZtl22XbZhtmG2ZbZltmm2cbZxtnW2dbZ5tnm2hbaFtom2ibaNto22kbaRtpm2mbadtp22obahtq22rbaxtrm2uba9tr22wbbNts220bbdtt224bbhtuW28bbxtvW29bb5twW3BbcJtwm3DbcNtxG3HbcdtyG3RbdJt0m0tbi1uOW46bjpuO24+bj9uP25AbkBuQW5BbkVuRW5GbkZuR25HbkhuSm5KbktuS25MblBuUG5RblFuUm5VblVuVm5WblduWm5abltuXm5ebl9uX25gbmJuYm5jbmNuZm5mbmduZ25obmpua25rbmxubG5tbm1ubm5ubm9ub25wbnBucW5xbnNudG50bnVudW54bnlueW56bnpufW5+bn5uf25/boBugm6DboNuhG6EboVuiG6IboluiW6Kbopui26MboxujW6Nbo5ujm6PbpBukW6RbpJukm6TbpNulG6WbpZul26XbphumG6Zbplumm6cbpxunW6dbp5unm6hbqFuom6ibqNuo26kbqRupm6mbqdup26obqhuq26rbqxurm6ubq9ur26wbrNus260brdut264brhuuW68brxuvW69br5uwW7BbsJuwm7DbsNuxG7HbsduyG7RbtJu0m4tbi1uOW46bj5uP24/bkBuQG5BbkFuRW5FbkZuRm5HbkduSG5KbkpuS25LbkxuT25PblBuUG5RblFuUm5VblZuVm5XblpuWm5bbl5uXm5fbl9uYG5ibmJuY25jbmZuZm5nbmduaG5qbmtua25sbmxub25wbnBucW5xbnNudG50bnVudW54bnlueW56bnpufW5+bn5uf25/boBug26DboRuhG6FboVuhm6IbohuiW6Jbopuim6LbotujG6Mbo1ujW6Obo5uj26QbpFukW6SbpJuk26TbpRulm6Wbpdul26YbphumW6cbpxunW6dbp5unm6hbqFuom6ibqNuo26kbqRupm6mbqdup26obqtuq26sbq5urm6vbq9usG6ybrJus26zbrRutG61brdut264brhuuW68brxuvW69br5uvm6/bsBuwW7BbsJuwm7DbsNuxG7EbtFu0m7Sbi1vLW85bzpvPm8/bz9vQG9Ab0FvQW9Fb0VvRm9Gb0dvR29Ib0pvSm9Lb0tvTG9Pb09vUG9Qb1FvUW9Sb1VvVm9Wb1dvWm9ab1tvXm9eb19vX29gb2JvYm9jb2NvZm9mb2dvZ29ob2pva29rb2xvbG9vb3BvcG9xb3Fvc290b3RvdW91b3hveW95b3pvem99b35vfm9/b39vgG+Db4NvhG+Eb4VvhW+Gb4hviG+Jb4lvim+Kb4tvi2+Mb4xvjW+Nb45vjm+Pb5BvkW+Rb5Jvkm+Tb5NvlG+Wb5Zvl2+Xb5hvmG+Zb5xvnG+db51vnm+eb6FvoW+ib6Jvo2+jb6RvpG+mb6Zvp2+nb6hvq2+rb6xvrm+ub69vr2+wb7Jvsm+zb7NvtG+0b7Vvt2+3b7hvuG+5b7xvvG+9b71vvm++b79vwG/Bb8Fvwm/Cb8Nvw2/Eb8Rv0W/Sb9JvLW8tbzlvOW86bz5vPm8/bz9vQG9Ab0FvQW9Gb0ZvR29Kb0pvS29Lb0xvT29Pb1BvUG9Rb1FvUm9Vb1ZvVm9Xb1pvWm9bb15vXm9fb2JvYm9jb2NvZm9mb2dvZ29ob2pva29rb2xvbG9vb3BvcG9xb3Fvc290b3RvdW91b3hveW95b3pvem97b31vfm9+b39vf2+Ab4Nvg2+Eb4RvhW+Fb4ZviW+Jb4pvim+Lb4tvjG+Mb41vjW+Ob45vj2+Qb5FvkW+Sb5Jvk2+Tb5Rvlm+Wb5dvl2+Yb5hvmW+cb5xvnW+db55vnm+fb59voW+hb6Jvom+jb6NvpG+kb6Zvpm+nb6dvqG+rb6tvrG+sb61vr2+vb7BvsG+xb7Jvsm+zb7NvtG+0b7Vvt2+3b7hvuG+5b7xvvG+9b71vvm++b79vwW/Bb8Jvwm/Db8NvxG/Eb9Fv0m/Sby1wLXA5cDlwOnA+cD5wP3A/cEBwQHBEcEVwRXBGcEZwSXBKcEpwS3BLcExwT3BPcFBwUHBRcFFwUnBVcFZwVnBXcFpwWnBbcF5wXnBfcGJwYnBjcGNwZ3BncGhwanBrcGtwbHBscG9wcHBwcHFwcXB0cHVwdXB2cHZweHB5cHlwenB6cHtwfXB+cH5wf3B/cIBwg3CDcIRwhHCFcIVwhnCJcIlwinCKcItwi3CMcIxwjXCNcI5wkHCRcJFwknCScJNwlnCWcJdwl3CYcJhwmXCccJxwnXCdcJ5wnnCfcJ9woXCicKJwo3CjcKZwpnCncKdwqHCocKpwqnCrcKtwrHCscK1wr3CvcLBwsHCxcLJwsnCzcLNwtHC0cLVwt3C3cLhwuHC5cLxwvHC9cL1wvnC+cL9wwXDBcMJwwnDDcMNwxHDEcMhwyXDJcNFw0nDScC1wLXA5cDlwOnA+cD5wP3A/cEBwQHBEcEVwRXBGcEZwSXBKcEpwS3BLcExwT3BPcFBwUHBRcFFwUnBVcFZwVnBXcFpwWnBbcF5wXnBfcGJwYnBjcGNwZ3BncGhwanBrcGtwbHBscG9wcHBwcHFwcXB0cHVwdXB2cHZweHB5cHlwenB6cHtwfXB+cH5wf3B/cIBwg3CDcIRwhHCFcIVwhnCJcIlwinCKcItwi3CMcIxwjXCNcI5wkHCRcJFwknCScJNwlnCWcJdwl3CYcJhwmXCccJxwnXCdcJ5wnnCfcJ9woXCicKJwo3CjcKZwpnCncKdwqHCocKpwqnCrcKtwrHCscK1wr3CvcLBwsHCxcLJwsnCzcLNwtHC0cLVwt3C3cLhwuHC5cLxwvHC9cL1wvnC+cL9wwXDBcMJwwnDDcMNwxHDEcMhwyXDJcNFw0nDScC1xLXE5cTpxPnE+cT9xP3FAcUBxQ3FEcURxRXFFcUZxRnFJcUpxSnFLcUtxT3FPcVBxUHFRcVVxVXFWcVZxV3FacVpxW3FecV5xX3FicWJxY3FjcWdxZ3FqcWtxa3FscWxxb3FwcXBxcXFxcXRxdXF1cXZxdnF5cXlxenF6cXtxfXF+cX5xf3F/cYBxgHGBcYNxg3GEcYRxhXGFcYZxhnGHcYlxinGKcYtxi3GMcYxxjXGNcY5xkHGRcZFxknGScZNxl3GXcZhxmHGZcZxxnXGdcZ5xnnGhcaJxonGjcaNxpnGmcadxp3GocahxqXGpcapxqnGrcatxrHGsca1xr3GvcbBxsHGxcbNxs3G0cbRxtXG3cbdxuHG4cblxvHG8cb1xvXG+cb5xv3HBccFxwnHCccNxw3HEccRxyHHJcclx0XHScdJxLXEtcTlxOnE+cT5xP3E/cUBxQHFDcURxRHFFcUVxRnFGcUlxSnFKcUtxS3FPcU9xUHFQcVFxVXFVcVZxVnFXcVpxWnFbcV5xXnFfcWJxYnFjcWNxZ3FncWpxa3FrcWxxbHFvcXBxcHFxcXFxdHF1cXVxdnF2cXlxeXF6cXpxe3F9cX5xfnF/cX9xgHGAcYFxg3GDcYRxhHGFcYVxhnGGcYdxiXGKcYpxi3GLcYxxjHGNcY1xjnGQcZFxkXGScZJxk3GXcZdxmHGYcZlxnHGdcZ1xnnGecaFxonGicaNxo3GmcaZxp3GncahxqHGpcalxqnGqcatxq3GscaxxrXGvca9xsHGwcbFxs3GzcbRxtHG1cbdxt3G4cbhxuXG8cbxxvXG9cb5xvnG/ccFxwXHCccJxw3HDccRxxHHIcclxyXHRcdJx0nEtci1yOXI6cj5yP3I/ckByQHJDckRyRHJFckVyRnJGckpySnJLcktyT3JPclByUHJRclVyVXJWclZyV3JaclpyW3Jecl5yX3JicmJyY3JjcmdyZ3Jqcmtya3Jscmxyb3JwcnBycXJxcnRydXJ1cnZydnJ3cnlyeXJ6cnpye3J7cnxyfnJ+cn9yf3KAcoBygXKDcoNyhHKEcoVyhXKGcoZyh3KKcotyi3KMcoxyjXKNco5ykHKRcpFyknKScpNynHKdcp1ynnKecqFyonKicqNyo3Kmcqdyp3Kocqhyq3KrcqxyrHKtcq9yr3KwcrBysXKycrJys3KzcrRytHK1crhyuHK5crlyunK8crxyvXK9cr5yvnK/csJywnLDcsNyxHLEctFy0nLSci1yLXI+cj9yP3JAckByQ3JEckRyRXJFckZyRnJKckpyS3JLck9yT3JQclByUXJVclVyVnJWcldyWnJacltyXnJecl9yYnJicmNyY3JmcmZyZ3Jncmpya3JrcmxybHJvcnBycHJxcnFydHJ1cnVydnJ2cndyeXJ5cnpyenJ7cntyfHJ+cn5yf3J/coBygHKBcoRyhHKFcoVyhnKGcodyh3KKcotyi3KMcoxyjXKNco5yjnKPcpBykXKRcpJyknKTcpxynXKdcp5ynnKicqNyo3Kmcqdyp3Kocqhyq3KrcqxyrHKtcq1yrnKucq9yr3KwcrBysXKzcrNytHK0crVytXK2crhyuHK5crlyunK8crxyvXK9cr5yvnK/csJyw3LDcsRyxHLRctJy0nItcy1zPnM/cz9zQHNAc0NzRHNEc0VzRXNGc0ZzSnNKc0tzS3NPc09zUHNQc1FzVXNVc1ZzVnNXc1pzWnNbc15zXnNfc2JzYnNjc2NzZnNmc2dzZ3Nqc2tza3Nsc2xzb3Nwc3BzcXNxc3RzdXN1c3ZzdnN3c3lzeXN6c3pze3N7c3xzfnN+c39zf3OAc4BzgXOEc4RzhXOFc4ZzhnOHc4dzinOLc4tzjHOMc41zjXOOc45zj3OQc5FzkXOSc5Jzk3Occ51znXOec55zonOjc6NzpnOnc6dzqHOoc6tzq3Osc6xzrXOtc65zrnOvc69zsHOwc7Fzs3Ozc7RztHO1c7VztnO4c7hzuXO5c7pzvHO8c71zvXO+c75zv3PCc8Nzw3PEc8Rz0XPSc9JzLXMtcz5zP3M/c0BzQ3NEc0RzRXNFc0lzSnNKc0tzS3NPc09zUHNQc1FzVHNUc1VzVXNWc1ZzV3Nac1pzW3Nec15zX3Nic2JzY3Njc2ZzZnNnc2dzanNrc2tzbHNsc29zcHNwc3FzcXN0c3VzdXN2c3Zzd3N5c3lzenN6c3tze3N8c35zfnN/c39zgHOAc4FzhHOEc4VzhXOGc4Zzh3OHc4hziHOMc4xzjXONc45zjnOPc49zkHOQc5FzkXOSc5Jzk3OXc5dzmHOYc5lznHOdc51znnOec6FzonOic6Nzo3Omc6dzp3Ooc6hzq3Orc6xzrHOtc61zrnOuc69zr3Owc7BzsXOzc7NztHO0c7VztXO2c7hzuHO5c7lzunO9c71zvnO+c79zv3PAc8Jzw3PDc8RzxHPRc9Jz0nMtdC10PnQ/dD90QHRDdER0RHRFdEV0SXRKdEp0S3RLdE90T3RQdFB0UXRUdFR0VXRVdFZ0VnRXdFp0WnRbdF50XnRfdGJ0YnRjdGN0ZnRmdGd0Z3RqdGt0a3RsdGx0b3RwdHB0cXRxdHR0dXR1dHZ0dnR3dHl0eXR6dHp0e3R7dHx0fnR+dH90f3SAdIB0gXSEdIR0hXSFdIZ0hnSHdId0iHSIdIx0jHSNdI10jnSOdI90j3SQdJB0kXSRdJJ0knSTdJd0l3SYdJh0mXScdJ10nXSedJ50oXSidKJ0o3SjdKZ0p3SndKh0qHSrdKt0rHSsdK10rXSudK50r3SvdLB0sHSxdLN0s3S0dLR0tXS1dLZ0uHS4dLl0uXS6dL10vXS+dL50v3S/dMB0wnTDdMN0xHTEdNF00nTSdC10LXQ+dD50P3Q/dEB0Q3REdER0RXRFdEl0SnRKdE90T3RQdFB0UXRRdFJ0VHRUdFV0VXRWdFZ0V3RZdFl0WnRadFt0XXRddF50XnRfdGJ0YnRjdGN0Z3RndGp0a3RrdGx0bHRvdHB0cHR0dHV0dXR2dHZ0d3R3dHh0enR6dHt0e3R8dH90f3SAdIB0gXSBdIJ0hHSEdIV0hXSGdIZ0h3SHdIh0iHSJdIx0jHSNdI10jnSOdI90j3SQdJB0kXSRdJJ0knSVdJZ0lnSXdJd0mHSYdJl0mXSadJx0nHSddJ10nnSedKF0oXSidKJ0o3SjdKd0qHSodKt0q3SsdKx0rXStdK90r3SwdLB0sXS0dLR0tXS1dLZ0uHS4dLl0uXS6dL10vXS+dL50v3S/dMB0wnTDdMN0xHTEdMV0xXTRdNJ00nQtdS11PnU+dT91P3VAdUJ1Q3VDdUR1RHVFdUV1SHVJdUl1SnVKdVB1UHVRdVF1UnVUdVR1VXVVdVZ1VnVXdVl1WXVadVp1W3VddV11XnVedV91YnVidWN1Y3VndWd1anVrdWt1bHVsdXR1dXV1dXZ1dnV3dXd1eHV6dXp1e3V7dXx1f3V/dYB1gHWBdYF1gnWFdYV1hnWGdYd1h3WIdYh1iXWJdYp1jHWMdY11jXWOdY51j3WPdZB1kHWRdZF1lXWWdZZ1l3WXdZh1mHWZdZl1mnWadZx1nHWddZ11nnWedaF1oXWidaJ1o3Wjdad1qHWrdax1rHWtda11r3WvdbB1sHWxdbF1tHW0dbV1tXW2dbh1uHW5dbl1unW6dbt1vXW9db51vnW/db91wHXCdcN1w3XEdcR1xXXFdcZ1xnXRddJ10nUtdS11PnU+dT91P3VAdUJ1Q3VDdUR1RHVFdUV1SHVJdUl1SnVKdVB1UHVRdVF1UnVUdVR1VXVVdVZ1VnVXdVl1WXVadVp1W3VddV11XnVedV91YnVidWN1Y3VndWd1anVrdWt1bHVsdXR1dXV1dXZ1dnV3dXd1eHV6dXp1e3V7dXx1f3V/dYB1gHWBdYF1gnWFdYV1hnWGdYd1h3WIdYh1iXWJdYp1jHWMdY11jXWOdY51j3WPdZB1kHWRdZF1lXWWdZZ1l3WXdZh1mHWZdZl1mnWadZx1nHWddZ11nnWedaF1oXWidaJ1o3Wjdad1qHWrdax1rHWtda11r3WvdbB1sHWxdbF1tHW0dbV1tXW2dbh1uHW5dbl1unW6dbt1vXW9db51vnW/db91wHXCdcN1w3XEdcR1xXXFdcZ1xnXRddJ10nUtdi12PXY9dj52PnY/dj92QHZCdkN2Q3ZEdkR2SHZJdkl2UHZQdlF2UXZSdlR2VHZVdlV2VnZWdld2WXZZdlp2WnZbdl12XXZedl52X3ZidmJ2Y3Zjdmd2Z3Zrdmt2bHZsdm92cnZzdnR2dXZ1dnZ2dnZ3dnd2eHZ7dnt2fHZ8dn12gHaAdoF2gXaCdoJ2hXaFdoZ2hnaHdod2iHaIdol2iXaKdot2jHaMdo12jXaOdo52j3aPdpB2kHaRdpF2lHaVdpV2lnaWdpd2l3aYdph2mXaZdpp2mnacdpx2nXaddp52nnahdqF2onaidqN2o3amdqd2p3aodqx2rXavdq92sHawdrF2sXa0drR2tXa1drZ2uHa4drl2uXa6drp2u3a8drx2vXa9dr52vna/dr92wHbCdsJ2w3bDdsR2xHbFdsV2xnbGdsd2x3bIdsh2yXbJdtF20nbSdi12LXY9dj12PnY+dj92P3ZAdkJ2Q3ZDdkR2RHZIdkl2SXZQdlB2UXZRdlJ2VHZUdlV2VXZWdlZ2V3ZZdll2WnZadlt2XXZddl52XnZfdmJ2YnZjdmN2Z3Zndmt2a3Zsdmx2b3ZydnN2dHZ1dnV2dnZ2dnd2d3Z4dnt2e3Z8dnx2fXaAdoB2gXaBdoJ2gnaFdoV2hnaGdod2h3aIdoh2iXaJdop2i3aMdox2jXaNdo52jnaPdo92kHaQdpF2kXaUdpV2lXaWdpZ2l3aXdph2mHaZdpl2mnaadpx2nHaddp12nnaedqF2oXaidqJ2o3ajdqZ2p3andqh2rHatdq92r3awdrB2sXaxdrR2tHa1drV2tna4drh2uXa5drp2una7drx2vHa9dr12vna+dr92v3bAdsJ2wnbDdsN2xHbEdsV2xXbGdsZ2x3bHdsh2yHbJdsl20XbSdtJ2LXctdz13PXc+dz53P3dCd0N3Q3dEd0R3SHdJd0l3SndKd1B3UHdRd1F3UndUd1R3VXdVd1Z3VndXd1l3WXdad1p3W3ded153X3did2J3Y3djd2Z3Zndnd2d3andrd2t3bHdsd253b3dvd3B3cHdyd3N3c3d0d3R3dXd1d3Z3dnd3d3d3eHd4d3p3end7d3t3fHd8d313fXeAd4B3gXeBd4J3gneDd4N3hXeGd4Z3h3eHd4h3iHeJd4l3ineKd4t3i3eMd4x3jXeNd453j3ePd5B3kHeRd5F3k3eUd5R3lXeVd5Z3lneYd5h3mXeZd5p3mnecd5x3nXedd553nnehd6F3oneid6N3o3emd6d3p3eod693sHewd7F3s3ezd7R3tHe1d7V3tne4d7h3uXe5d7p3une7d7x3vHe9d713vne+d793v3fAd8J3wnfDd8N3xHfEd8V3xXfGd8Z3x3fHd8h3yHfJd9F30nfSdy13LXc9dz13Pnc+dz93QndCd0N3Q3dEd0h3SXdJd0x3TXdQd1B3UXdRd1J3VHdUd1V3VXdWd1Z3V3dZd1l3Wndad1t3XXddd153Xndfd2J3Yndjd2N3ZHdmd2Z3Z3dnd2t3a3dsd2x3bndvd293cHdwd3J3c3dzd3R3dnd2d3d3d3d4d3h3e3d7d3x3fHd9d313gHeAd4F3gXeCd4J3g3eDd4Z3h3eHd4h3iHeJd4l3ineKd4t3i3eMd4x3j3eQd5B3k3eUd5R3lXeVd5h3mHeZd5l3mnead5x3nHedd513nneed6F3oXeid6J3o3ejd6Z3p3end6h3qHewd7F3tHe0d7V3uXe5d7p3une7d713vXe+d753v3e/d8B3wnfCd8N3w3fEd8R3xXfFd8Z3xnfHd8d3yHfId8l30XfSd9J3LXgteD14PXg+eD54P3hCeEJ4Q3hDeER4SHhJeEl4THhNeFB4UHhReFF4UnhUeFR4VXhVeFZ4VnhXeFl4WXhaeFp4W3hdeF14XnheeF94YnhieGN4Y3hkeGZ4ZnhneGd4a3hreGx4bHhueG94b3hweHB4cnhzeHN4dHh2eHZ4d3h3eHh4eHh7eHt4fHh8eH14fXiAeIB4gXiBeIJ4gniDeIN4hniHeId4iHiIeIl4iXiKeIp4i3iLeIx4jHiPeJB4kHiTeJR4lHiVeJV4mHiYeJl4mXiaeJp4nHiceJ14nXieeJ54oXiheKJ4onijeKN4pnineKd4qHioeLB4sXi0eLR4tXi5eLl4uni6eLt4vXi9eL54vni/eL94wHjCeMJ4w3jDeMR4xHjFeMV4xnjGeMd4x3jIeMh4yXjReNJ40ngteC14PXg9eD54QnhCeEN4Q3hEeEd4SHhIeEl4SXhMeEx4TXhNeE54UHhQeFF4UXhSeFR4VHhVeFV4VnhWeFd4WXhZeFp4WnhbeF14XXheeF54X3hheGJ4YnhjeGN4ZnhmeGd4Z3hreGt4bHhseG54b3hveHB4cHhyeHN4c3h0eHR4dXh1eHZ4dnh3eHd4eHh4eHt4e3h8eHx4fXh9eIB4gXiBeIJ4gniDeIN4hHiEeIl4iXiKeIp4i3iOeI54j3iPeJB4k3iTeJR4lHiVeJV4mHiYeJl4mXiaeJx4nHideJ14nnieeKF4oniieKN4o3imeKd4p3ioeKh4q3ireKx4rHiteLB4sXixeLR4tHi1eLV4tni5eLl4uni6eLt4u3i9eL14vni+eL94v3jAeMJ4wnjDeMN4xHjEeMV4xXjGeMZ4x3jHeMh4yHjJeNF40njSeC15LXk9eT15PnlCeUJ5Q3lDeUR5R3lIeUh5SXlMeUx5TXlNeU55UHlQeVF5UXlSeVR5VHlVeVV5VnlWeVd5WXlZeVp5WnlbeV15XXleeV55X3lieWJ5Y3ljeWR5ZnlmeWd5Z3lqeWt5a3lseWx5bnlveW95cHlweXJ5c3lzeXR5dHl1eXV5dnl2eXd5d3l4eXh5eXl5eXt5e3l8eXx5fXl9eX55fnmAeYF5gXmCeYJ5g3mDeYR5hHmFeYV5hnmJeYp5jXmNeY55jnmPeY95kHmSeZJ5k3mTeZR5lHmVeZV5mHmYeZl5mXmaeZx5nHmdeZ15nnmheaJ5onmjeaN5pnmnead5qHmoeal5qXmreat5rHmsea15r3mwebB5sXmxebR5tHm1ebV5tnm5ebl5unm6ebt5u3m9eb15vnm+eb95v3nAecJ5wnnDecN5xHnEecV5xXnGecZ5x3nHech5yHnJedF50nnSeS15LXk9eT15PnlCeUJ5Q3lDeUR5R3lIeUh5SXlMeUx5TXlNeU55UHlQeVF5UXlSeVR5VHlVeVV5VnlWeVd5WXlZeVp5WnlbeV15XXleeV55X3lieWJ5Y3ljeWR5ZnlmeWd5Z3lqeWt5a3lseWx5bnlveW95cHlweXJ5c3lzeXR5dHl1eXV5dnl2eXd5d3l4eXh5eXl5eXt5e3l8eXx5fXl9eX55fnmAeYF5gXmCeYJ5g3mDeYR5hHmFeYV5hnmJeYp5jXmNeY55jnmPeY95kHmSeZJ5k3mTeZR5lHmVeZV5mHmYeZl5mXmaeZx5nHmdeZ15nnmheaJ5onmjeaN5pnmnead5qHmoeal5qXmreat5rHmsea15r3mwebB5sXmxebR5tHm1ebV5tnm5ebl5unm6ebt5u3m9eb15vnm+eb95v3nAecJ5wnnDecN5xHnEecV5xXnGecZ5x3nHech5yHnJedF50nnSeS16LXo9ej16PnpCekJ6Q3pDekR6R3pHekh6SHpJekx6THpNek16TnpQelB6UXpRelJ6VHpUelV6VXpWelZ6V3paelp6W3pdel16Xnpeel96YnpiemN6Y3pkemZ6Znpnemd6anpremt6bHpsem56b3pvenB6cHpyenN6c3p0enR6d3p3enh6eHp5enl6e3p8enx6fXp9en56fnp/en96gXqCeoJ6g3qDeoR6hHqFeoV6hnqGeod6jXqNeo56jnqPeo96kHqRepF6knqSepN6k3qUepR6lXqXepd6mHqYepl6mXqaept6m3qcepx6nXqdep56oXqheqJ6onqjeqN6pnqneqd6qHqoeql6qXqreqt6rHqseq16r3qwerB6sXqxerR6tHq1erV6tnq4erh6uXq5erp6unq7er56vnq/er96wHrCesJ6w3rDesR6xHrFesV6xnrGesd6x3rIesh6yXrRetJ60notei16PXo9ej56QnpCekN6Q3pEekd6R3pIekh6SXpMekx6TXpNek56UHpQelF6UXpSelR6VHpVelV6VnpWeld6Wnpaelt6XXpdel56XnpfemJ6YnpjemN6ZHpmemZ6Z3pnemp6a3premx6bHpuem96b3pwenB6cnpzenN6dHp0end6d3p4enh6eXp5ent6fHp8en16fXp+en56f3p/eoF6gnqCeoN6g3qEeoR6hXqFeoZ6hnqHeo16jXqOeo56j3qPepB6kXqRepJ6knqTepN6lHqUepV6l3qXeph6mHqZepl6mnqbept6nHqcep16nXqeeqF6oXqieqJ6o3qjeqZ6p3qneqh6qHqpeql6q3qreqx6rHqteq96sHqwerF6sXq0erR6tXq1erZ6uHq4erl6uXq6erp6u3q+er56v3q/esB6wnrCesN6w3rEesR6xXrFesZ6xnrHesd6yHrIesl60XrSetJ6LXstezx7PHs9ez17QntCe0N7R3tHe0h7SHtJe0x7THtNe1B7UHtRe1V7VXtWe1Z7V3tZe1l7Wntde117Xntee197YXtie2J7Y3tje2Z7Zntne2d7antre2t7bHtse257b3tve3B7cHtye3N7c3t0e3R7dXt1e3d7d3t4e3h7eXt5e3p7ent7e3x7fHt9e317fnt+e397f3uBe4J7gnuDe4N7hHuEe4V7hXuGe4Z7h3uHe417jXuOe457j3uQe5F7kXuSe5J7k3uTe5R7lHuVe5d7l3uYe5h7mXube5t7nHuce517nnufe597oHuge6F7oXuie6J7o3ume6d7p3uoe6h7q3ure6x7rHute697r3uwe7B7sXuxe7N7s3u0e7R7tXu1e7Z7uHu4e7l7uXu6e7p7u3u+e757v3u/e8B7wnvCe8N7w3vEe8R7xXvFe8Z7xnvHe8d7yHvRe9J70nstey17OXs5ezp7PHs8ez17PXtBe0F7QntCe0N7R3tHe0h7SHtJe0x7THtNe1B7UHtRe1R7VHtVe1V7VntZe1l7Wntae1t7XXtde157Xntfe2F7Yntie2N7Y3tke2Z7Zntne2d7aHtqe2t7a3tse2x7bntve297cHtwe3F7cXtze3R7dHt1e3V7d3t4e3h7eXt5e3p7ent8e317fXt+e357f3t/e4B7gnuDe4N7hHuEe4V7hXuGe4Z7h3uHe4l7inuKe4t7i3uNe417jnuQe5F7kXuSe5J7k3uTe5R7l3uXe5h7mHuZe5t7m3uce5x7nXuee597n3uge6B7oXuhe6J7onuje6R7pHume6d7p3uoe6h7q3ure6x7rHute617r3uve7B7sHuxe7F7snuye7N7s3u0e7R7tXu1e7Z7tnu4e7h7uXu5e7p7unu7e757vnu/e797wHvCe8J7w3vDe8R7xHvFe8V7x3vHe8h7yHvJe9F70nvSey18LXw5fDl8Onw8fDx8PXw9fEF8QXxCfEJ8Q3xHfEd8SHxIfEl8THxMfE18UHxQfFF8VHxUfFV8VXxWfFl8WXxafFp8W3xdfF18XnxefF98YXxifGJ8Y3xjfGR8ZnxmfGd8Z3xofGp8a3xrfGx8bHxufG98b3xwfHB8cXxxfHN8dHx0fHV8dXx3fHh8eHx5fHl8enx6fHx8fXx9fH58fnx/fH98gHyCfIN8g3yEfIR8hXyFfIZ8hnyHfId8iXyKfIp8i3yLfI18jXyOfJB8kXyRfJJ8knyTfJN8lHyXfJd8mHyYfJl8m3ybfJx8nHydfJ58n3yffKB8oHyhfKF8onyifKN8pHykfKZ8p3ynfKh8qHyrfKt8rHysfK18rXyvfK98sHywfLF8sXyyfLJ8s3yzfLR8tHy1fLV8tny2fLh8uHy5fLl8uny6fLt8vny+fL98v3zAfMJ8wnzDfMN8xHzEfMV8xXzHfMd8yHzIfMl80XzSfNJ8LXwtfDl8OXw6fDx8PHw9fD18QXxBfEJ8QnxDfEd8R3xIfEh8SXxMfEx8TXxQfFB8UXxUfFR8VXxVfFZ8WXxZfFp8XXxdfF58XnxffGF8YnxifGN8Y3xkfGZ8ZnxnfGd8aHxqfGt8a3xsfGx8b3xwfHB8cXxxfHN8dHx0fHV8dXx3fHh8eHx5fHl8enx6fHt8fHx9fH18fnx+fH98f3yAfIB8gXyDfIN8hHyEfIV8hXyGfIZ8h3yHfIh8iHyJfIl8inyKfIt8i3yMfIx8jXyNfI58j3yQfJB8kXyRfJJ8knyTfJZ8lnyXfJd8mHyYfJl8m3ybfJx8nXyefJ58n3yffKB8oHyhfKF8onyifKN8pHykfKV8pXymfKd8p3yofKh8q3yrfKx8rHytfK18r3yvfLB8sHyxfLF8s3yzfLR8tHy1fLV8tny2fLl8uXy6fLp8u3y9fL18vny+fL98v3zAfMJ8w3zDfMR8xHzHfMh8yHzJfNF80nzSfC19LX05fTl9On08fTx9PX09fUF9QX1CfUJ9Q31HfUd9SH1IfUl9TH1MfU19UH1QfVF9VH1UfVV9VX1WfVl9WX1afV19XX1efV59X31hfWJ9Yn1jfWN9ZH1mfWZ9Z31nfWh9an1rfWt9bH1sfW99cH1wfXF9cX1zfXR9dH11fXV9d314fXh9eX15fXp9en17fXx9fX19fX59fn1/fX99gH2AfYF9g32DfYR9hH2FfYV9hn2GfYd9h32IfYh9iX2JfYp9in2LfYt9jH2MfY19jX2OfY99kH2QfZF9kX2SfZJ9k32WfZZ9l32XfZh9mH2ZfZt9m32cfZ19nn2efZ99n32gfaB9oX2hfaJ9on2jfaR9pH2lfaV9pn2nfad9qH2ofat9q32sfax9rX2tfa99r32wfbB9sX2xfbN9s320fbR9tX21fbZ9tn25fbl9un26fbt9vX29fb59vn2/fb99wH3CfcN9w33EfcR9x33Ifch9yX3RfdJ90n0tfS19OX05fTp9QX1BfUJ9Qn1DfUd9R31IfUt9S31MfUx9TX1QfVB9UX1UfVR9VX1VfVZ9WX1ZfVp9XX1dfV59Xn1ffWF9Yn1ifWN9Y31kfWZ9Zn1nfWd9aH1rfWt9bH1sfW99cH1wfXF9cX1zfXR9dH11fXV9d314fXh9eX15fXp9en17fX19fn1+fX99f32AfYB9gX2EfYR9hX2FfYZ9hn2HfYd9iH2IfYl9iX2KfYp9i32LfYx9jH2NfY19j32QfZB9kX2RfZJ9kn2TfZZ9ln2XfZd9mH2afZt9m32dfZ59nn2ffZ99oH2gfaF9oX2ifaN9pH2kfaV9pX2nfah9qH2rfat9rH2sfa19r32vfbB9sH2xfbF9tH20fbV9tX22fbZ9uX25fbp9un27fb59vn2/fb99wH3AfcJ9w33DfcR9xH3Hfch9yH3JfdF90n3SfS1+LX45fjl+On46fjt+QX5BfkJ+Qn5Dfkd+R35Ifkt+S35Mfkx+TX5QflB+UX5UflR+VX5VflZ+WX5Zflp+XX5dfl5+Xn5ffmJ+Yn5jfmN+Zn5mfmd+Z35ofmt+a35sfmx+b35wfnB+cX5xfnR+dX51fnd+eH54fnl+eX56fnp+e359fn5+fn5/fn9+gH6AfoF+hX6FfoZ+hn6Hfod+iH6Ifol+in6Kfot+i36Mfox+j36QfpB+kX6RfpJ+kn6TfpZ+ln6Xfpd+mn6bfpt+nX6efp5+n36ffqB+oH6hfqN+pH6kfqV+pX6nfqh+qH6rfqt+rH6sfq1+r36vfrB+sH6xfrF+tH60frV+tX62frZ+uH64frl+uX66frp+u36+fr5+v36/fsB+wn7DfsN+xH7Efsd+yH7Ifsl+0X7SftJ+LX4tfjl+OX46fjp+O35BfkF+Qn5CfkN+R35Hfkh+S35Lfkx+TH5NflB+UH5RflR+VH5VflV+Vn5Zfll+Wn5dfl1+Xn5efl9+Yn5ifmN+Y35mfmZ+Z35nfmh+a35rfmx+bH5vfnB+cH5xfnF+dH51fnV+d354fnh+eX55fnp+en57fn1+fn5+fn9+f36AfoB+gX6FfoV+hn6Gfod+h36Ifoh+iX6Kfop+i36Lfox+jH6PfpB+kH6RfpF+kn6SfpN+ln6Wfpd+l36afpt+m36dfp5+nn6ffp9+oH6gfqF+o36kfqR+pX6lfqd+qH6ofqt+q36sfqx+rX6vfq9+sH6wfrF+sX60frR+tX61frZ+tn64frh+uX65frp+un67fr5+vn6/fr9+wH7CfsN+w37EfsR+x37Ifsh+yX7RftJ+0n4tfy1/OX85fzp/On87fzt/PH88f0F/QX9Cf0J/Q39Hf0d/SH9Lf0t/TH9Mf01/UH9Qf1F/VH9Uf1V/VX9Wf1l/WX9af11/XX9ef15/X39if2J/Y39jf2Z/Zn9nf2d/aH9rf2t/bH9sf29/cH9wf3F/cX90f3V/dX94f3l/eX96f3p/e39+f35/f39/f4B/gH+Bf4F/gn+Ff4Z/hn+Hf4d/iH+If4l/in+Kf4t/i3+Pf5B/kH+Rf5F/l3+Xf5p/m3+bf51/nn+ef59/n3+gf6B/oX+hf6J/o3+kf6R/pn+nf6d/qH+of6t/q3+sf6x/rX+vf69/sH+wf7F/sX+0f7R/tX+1f7Z/tn+4f7h/uX+5f7p/un+7f7t/vn++f79/v3/Af8J/w3/Df8R/xH/Hf8h/yH/Jf9F/0n/Sfy1/LX85fzl/On86fzt/O388fzx/QX9Bf0J/Qn9Df0d/R39If0t/S39Mf0x/TX9Qf1B/UX9Uf1R/VX9Vf1Z/WX9Zf1p/XX9df15/Xn9ff2J/Yn9jf2N/Zn9mf2d/Z39of2t/a39sf2x/b39wf3B/cX9xf3R/dX91f3h/eX95f3p/en97f35/fn9/f39/gH+Af4F/gX+Cf4V/hn+Gf4d/h3+If4h/iX+Kf4p/i3+Lf49/kH+Qf5F/kX+Xf5d/mn+bf5t/nX+ef55/n3+ff6B/oH+hf6F/on+jf6R/pH+mf6d/p3+of6h/q3+rf6x/rH+tf69/r3+wf7B/sX+xf7R/tH+1f7V/tn+2f7h/uH+5f7l/un+6f7t/u3++f75/v3+/f8B/wn/Df8N/xH/Ef8d/yH/If8l/0X/Sf9J/LYAtgDmAOoA6gDuAO4A8gDyAQIBBgEGAQoBLgEuATIBMgE2AUIBQgFGAVIBUgFWAVYBWgFmAWYBagF2AXYBegF6AX4BigGKAY4BjgGSAZ4BngGiAa4BrgGyAbIBvgHCAcIBxgHGAdIB1gHWAdoB2gHiAeYB5gHqAeoB7gHuAfIB8gH2AfYB+gH6Af4B/gICAgICBgIGAgoCCgIWAhoCGgIeAh4CIgIiAiYCJgIqAioCLgI6Aj4CPgJCAkICVgJmAmoCagJuAm4CdgJ6AnoCfgJ+AoICggKGAoYCigKOApICkgKWApYCmgKaAp4CngKiAqICrgKuArICsgK2Ar4CvgLCAsICxgLGAtIC0gLWAtYC2gLaAuYC5gLqAuoC7gLuAvoC+gL+Av4DAgMCAwoDDgMOAxIDEgMeAyIDIgMmA0YDSgNKALYAtgDqAO4A7gDyAPIBAgEGAQYBCgEuAS4BMgFCAUIBRgFSAVIBVgFWAVoBZgFmAWoBdgF2AXoBegGKAYoBjgGOAZIBngGeAaIBwgHCAcYBxgHKAdIB1gHWAdoB2gHmAeYB6gHqAe4B7gHyAfIB9gH6AfoB/gH+AgICAgIGAgYCCgIKAg4CDgIaAh4CHgIiAiICJgImAioCOgI6Aj4CPgJCAkICTgJSAlICVgJWAmYCagJqAm4CbgJyAnYCdgJ6An4CfgKCAoIChgKOApICkgKaApoCngKeAqICogKuAq4CsgK+Ar4CwgLCAsYCxgLSAtIC1gLWAtoC2gLeAt4C5gLmAuoC6gLuAu4C+gL6Av4C/gMCAwIDCgMOAw4DEgMSAx4DIgMiAyYDRgNKA0oAtgS2BOoE7gTuBPIE8gUCBQYFBgUKBS4FLgUyBUIFQgVGBVIFUgVWBVYFWgVmBWYFagV2BXYFegV6BYoFigWOBY4FkgWeBZ4FogXCBcIFxgXGBcoF0gXWBdYF2gXaBeYF5gXqBeoF7gXuBfIF8gX2BfoF+gX+Bf4GAgYCBgYGBgYKBgoGDgYOBhoGHgYeBiIGIgYmBiYGKgY6BjoGPgY+BkIGQgZOBlIGUgZWBlYGZgZqBmoGbgZuBnIGdgZ2BnoGfgZ+BoIGggaGBo4GkgaSBpoGmgaeBp4GogaiBq4GrgayBr4GvgbCBsIGxgbGBtIG0gbWBtYG2gbaBt4G3gbmBuYG6gbqBu4G7gb6BvoG/gb+BwIHAgcKBw4HDgcSBxIHHgciByIHJgdGB0oHSgS2BLYE6gTuBO4E8gTyBQIFBgUGBQoFGgUaBR4FLgUuBTIFPgU+BUIFQgVGBVIFUgVWBWYFZgVqBYoFigWOBY4FkgWeBZ4FogWyBbIFwgXCBcYFxgXKBdIF1gXWBdoF2gXmBeYF6gXqBe4F7gXyBfIF9gX+Bf4GAgYCBgYGBgYKBgoGDgYOBhIGEgYWBhYGGgY6BjoGPgY+BkIGTgZOBlIGUgZWBlYGWgZaBmIGZgZmBmoGagZyBnYGdgZ6Bn4GfgaCBoIGjgaSBpIGmgaeBp4GogauBq4Gsga+BsIGwgbGBsYG0gbSBtYG1gbaBtoG3gbeBuYG5gbqBuoG7gbuBvoG+gb+Bv4HAgcCBwoHDgcOBxIHEgceByIHIgcmB0YHSgdKBLYItgjqCO4I7gjyCPIJAgkGCQYJCgkaCRoJHgkuCS4JMgk+CT4JQglCCUYJUglSCVYJZglmCWoJigmKCY4JjgmSCZ4JngmiCbIJsgnCCcIJxgnGCcoJ0gnWCdYJ2gnaCeYJ5gnqCeoJ7gnuCfIJ8gn2Cf4J/goCCgIKBgoGCgoKCgoOCg4KEgoSChYKFgoaCjoKOgo+Cj4KQgpOCk4KUgpSClYKVgpaCloKYgpmCmYKagpqCnIKdgp2CnoKfgp+CoIKggqOCpIKkgqaCp4KngqiCq4KrgqyCr4KwgrCCsYKxgrSCtIK1grWCtoK2greCt4K5grmCuoK6gruCu4K+gr6Cv4K/gsCCwILCgsOCw4LEgsSCx4LIgsiCyYLRgtKC0oItgi2CNII1gjmCOoI6gjuCO4I8gjyCP4JAgkCCQYJBgkKCRoJGgkeCS4JLgkyCT4JPglCCUIJRglSCVIJZglmCWoJagluCYoJigmOCY4JkgmeCZ4JogmiCaYJrgmuCbIJsgm2CcIJwgnGCcYJygnSCdYJ1gnaCdoJ3gnmCeYJ6gnqCe4J7gnyCfIJ9gn2CgIKAgoGCgYKCgoKCg4KDgoSChIKFgoWChoKGgoeCjIKMgo2CjYKOgo6Cj4KSgpKCk4KTgpSClIKVgpWCloKWgpiCmIKZgpmCmoKagpyCnIKdgp2CnoKfgp+CoIKggqKCo4KjgqSCpIKmgqeCp4KogquCq4Ksgq+CsIKwgrGCsYK0grSCtYK1graCtoK5grmCuoK6gruCu4K+gr6Cv4K/gsCCwoLDgsOCxILEgseCyILIgsmC0YLSgtKCLYMtgzSDNYM5gzqDOoM7gzuDP4NAg0CDQYNBg0KDRoNGg0eDR4NIg0qDSoNLg0uDTINPg0+DUINQg1GDVINUg1WDWYNZg1qDXoNeg2KDYoNjg2ODZINng2eDaINog2mDa4Nrg2yDbINtg22DboNwg3CDcYNxg3KDcoNzg3SDdYN1g3aDdoN3g3eDeIN5g3mDeoN6g3uDe4N8g3yDfYN9g4CDgYOBg4KDgoODg4ODhIOEg4WDhYOGg4aDh4OMg4yDjYONg46DjoOPg5GDkYOSg5KDk4OTg5SDlIOVg5WDmIOYg5mDmYOag5yDnIOdg52DnoOfg5+DoIOgg6GDooOjg6ODpIOkg6aDp4Ong6iDq4Org6yDrIOtg6+Dr4Owg7CDsYO0g7SDtYO1g7aDtoO5g7mDuoO6g7uDvoO+g7+Dv4PAg8KDw4PDg8SDxIPHg8iDyIPJg9GD0oPSgy2DLYM0gzWDOYM6gzqDO4M7gz+DQINAg0GDQYNCg0aDRoNHg0eDSINKg0qDS4NLg0yDT4NPg1CDUINRg1SDVINVg1mDWYNag16DXoNig2KDY4Njg2SDZ4Nng2iDaINpg2uDa4Nsg2yDbYNtg26DcINwg3GDcYNyg3KDc4N0g3WDdYN2g3aDd4N3g3iDeYN5g3qDeoN7g3uDfIN8g32DfYOAg4GDgYOCg4KDg4ODg4SDhIOFg4WDhoOGg4eDjIOMg42DjYOOg46Dj4ORg5GDkoOSg5ODk4OUg5SDlYOVg5iDmIOZg5mDmoOcg5yDnYOdg56Dn4Ofg6CDoIOhg6KDo4Ojg6SDpIOmg6eDp4Oog6uDq4Osg6yDrYOvg6+DsIOwg7GDtIO0g7WDtYO2g7aDuYO5g7qDuoO7g76DvoO/g7+DwIPCg8ODw4PEg8SDx4PIg8iDyYPRg9KD0oMthC2EOYQ6hDqEO4RAhEGEQYRChEaERoRHhEqESoRLhEuETIROhE+ET4RQhFCEUYRUhFSEVYRVhFaEWYRZhFqEXoRehF+EYoRihGOEY4RkhGeEZ4RohGiEaYRphGqEa4RrhGyEbIRthG2EboRwhHCEcYRxhHKEcoRzhHWEdYR2hHaEd4R3hHiEeoR6hHuEe4R8hHyEfYR9hH6EfoR/hH+EgYSChIKEg4SDhISEhISFhIWEhoSGhIeEh4SKhIuEjISMhI2EjYSOhJCEkYSRhJKEkoSThJOElISUhJWEl4SXhJiEmISZhJmEmoSchJyEnYSfhJ+EoISghKKEo4SjhKaEp4SnhKiEqISqhKqEq4SrhKyErISthK+Er4SwhLCEsYS0hLSEtYS1hLaEtoS5hLmEuoS6hLuEvoS/hMKEw4TDhMSExITHhMiEyITJhMmE0YTShNKELYQthDmEOoQ6hDuEQIRBhEGEQoRGhEaER4RKhEqES4RLhEyEToRPhE+EUIRQhFGEVIRUhFWEVYRWhFmEWYRahF6EXoRfhGKEYoRjhGOEZIRnhGeEaIRohGmEaYRqhGuEa4RshGyEbYRthG6EcIRwhHGEcYRyhHKEc4R1hHWEdoR2hHeEd4R4hHqEeoR7hHuEfIR8hH2EfYR+hH6Ef4R/hIGEgoSChIOEg4SEhISEhYSFhIaEhoSHhIeEioSLhIyEjISNhI2EjoSQhJGEkYSShJKEk4SThJSElISVhJeEl4SYhJiEmYSZhJqEnISchJ2En4SfhKCEoISihKOEo4SmhKeEp4SohKiEqoSqhKuEq4SshKyErYSvhK+EsISwhLGEtIS0hLWEtYS2hLaEuYS5hLqEuoS7hL6Ev4TChMOEw4TEhMSEx4TIhMiEyYTJhNGE0oTShC2FLYVAhUGFQYVChUaFRoVHhUqFSoVLhUuFTIVPhU+FUIVQhVGFVIVUhVWFVYVWhVmFWYVahV2FXYVehV6FX4VihWKFY4VjhWSFZ4VnhWiFaIVphWmFaoVrhWuFbIVshW2FbYVuhXCFcIVxhXGFcoVyhXOFdYV1hXaFdoV3hXeFeIV4hXqFeoV7hXuFfIV8hX2FfYV+hX6Ff4V/hYCFgoWDhYOFhIWEhYWFhYWGhYaFh4WHhYiFiIWJhYmFioWKhYuFi4WMhYyFkIWRhZGFkoWShZOFk4WUhZSFlYWXhZeFmIWYhZmFmYWahZuFm4WchZyFnYWihaOFo4WmhaeFp4WohauFq4WshayFrYWvha+FsIWwhbGFtIW0hbWFtYW2hbaFuYW5hbqFuoW7hbuFvoW/hcKFw4XDhcSFxIXFhcWFx4XIhciFyYXJhdGF0oXShS2FLYU7hTyFPIU9hT2FQIVBhUGFQoVFhUWFRoVGhUqFSoVLhUuFTIVPhU+FUIVQhVGFVIVUhVWFVYVWhVmFWYVahV2FXYVehV6FX4VihWKFY4VjhWSFZ4VnhWiFaIVphWmFaoVrhWuFbIVshW2FbYVuhW6Fb4VwhXCFcYVxhXKFcoVzhXWFdYV2hXaFd4V3hXiFeIV7hXuFfIV8hX2FfYV+hX6Ff4V/hYCFgIWBhYOFg4WEhYSFhYWFhYaFhoWHhYeFiIWIhYmFiYWKhYqFi4WLhY+FkIWQhZGFkYWShZKFk4WThZSFl4WXhZiFmIWZhZuFm4WchZyFnYWhhaKFooWjhaOFpoWnhaeFqIWqhaqFq4WrhayFrIWtha+Fr4WwhbCFsYW0hbWFtYW2hbaFuYW5hbqFuoW7hbuFvoW/hb+FwIXChcOFw4XEhcSFxYXFhceFx4XIhciFyYXJhdGF0oXShS2GLYY7hjyGPIY9hj2GQIZBhkGGQoZFhkWGRoZGhkqGSoZLhkuGTIZPhk+GUIZQhlGGVIZUhlWGVYZWhlmGWYZahl2GXYZehl6GX4ZihmKGY4ZjhmSGZ4ZnhmiGaIZphmmGaoZrhmuGbIZshm2GbYZuhm6Gb4ZwhnCGcYZxhnKGcoZzhnWGdYZ2hnaGd4Z3hniGeIZ7hnuGfIZ8hn2GfYZ+hn6Gf4Z/hoCGgIaBhoOGg4aEhoSGhYaFhoaGhoaHhoeGiIaIhomGiYaKhoqGi4aLho+GkIaQhpGGkYaShpKGk4aThpSGl4aXhpiGmIaZhpuGm4achpyGnYahhqKGooajhqOGpoanhqeGqIaqhqqGq4arhqyGrIathq+Gr4awhrCGsYa0hrWGtYa2hraGuYa5hrqGuoa7hruGvoa/hr+GwIbChsOGw4bEhsSGxYbFhseGx4bIhsiGyYbJhtGG0obShi2GLYY4hjiGOYY7hjyGPIY9hj2GQIZBhkGGQoZFhkWGRoZGhkeGSoZKhkuGS4ZPhk+GUIZQhlGGU4ZThlSGVIZVhlWGVoZahl6GXoZfhl+GYIZihmKGY4ZjhmSGaIZohmmGaYZqhmuGa4ZshmyGbYZthm6GboZvhnGGcYZyhnKGc4Z1hnWGdoZ2hneGd4Z4hniGe4Z7hnyGfIZ9hn2GfoZ+hn+Gf4aAhoCGgYaBhoKGhYaFhoaGhoaHhoeGiIaIhomGiYaKhoqGi4aOho+Gj4aQhpCGkYaRhpKGkoaThpaGloaXhpeGmIaYhpmGm4abhpyGnIadhp6Gn4afhqGGooaihqOGo4amhqeGp4aohqqGqoarhquGrIavhq+GsIawhrGGtIa1hrWGtoa5hrmGuoa6hruGu4a+hr+Gv4bAhsKGw4bDhsSGxIbFhsWGx4bHhsiGyIbJhsmG0YbShtKGLYcthziHOIc5hzuHPIc8hz2HPYdAh0GHQYdCh0WHRYdGh0aHR4dKh0qHS4dLh0+HT4dQh1CHUYdTh1OHVIdUh1WHVYdWh1qHXodeh1+HX4dgh2KHYodjh2OHZIdoh2iHaYdph2qHa4drh2yHbIdth22Hboduh2+HcYdxh3KHcodzh3WHdYd2h3aHd4d3h3iHeId7h3uHfId8h32HfYd+h36Hf4d/h4CHgIeBh4GHgoeFh4WHhoeGh4eHh4eIh4iHiYeJh4qHioeLh46Hj4ePh5CHkIeRh5GHkoeSh5OHloeWh5eHl4eYh5iHmYebh5uHnIech52Hnoefh5+HoYeih6KHo4ejh6aHp4enh6iHqoeqh6uHq4esh6+Hr4ewh7CHsYe0h7WHtYe2h7mHuYe6h7qHu4e7h76Hv4e/h8CHwofDh8OHxIfEh8WHxYfHh8eHyIfIh8mHyYfRh9KH0octhy2HOIc4hzmHO4c8hzyHPYc9h0CHQYdBh0KHRIdFh0WHRodGh0eHSodKh0uHS4dMh06HT4dPh1CHUIdRh1SHVIdVh1WHVodZh1mHWodeh16HX4dfh2CHY4djh2SHZIdlh2iHaIdph2mHaodsh2yHbYdth26Hbodvh3GHcYdyh3KHc4dzh3SHd4d3h3iHeId7h3yHfId9h32Hfod+h3+Hf4eAh4CHgYeBh4KHhoeHh4eHiIeIh4mHiYeKh4qHi4eLh42HjYeOh46Hj4ePh5CHkIeRh5GHlYeWh5aHl4eXh5iHm4ebh5yHnoefh5+HoYeih6KHo4ejh6aHpoenh6qHqoerh6uHrIeuh66Hr4evh7CHsIexh7SHtYe1h7aHtoe5h7mHuoe6h7uHu4e+h7+Hv4fAh8KHw4fDh8SHxIfFh8WHx4fIh8iHyYfJh9GH0ofShy2ILYg3iDeIOIg4iDmIO4g8iDyIPYg9iECIQYhBiESIRYhFiEaIRohJiEqISohLiEuITIhOiE+IT4hQiFCIVIhUiFWIVYhWiFmIWYhaiF2IXYheiF6IX4hfiGCIY4hjiGSIZIhliGiIaIhpiGmIaohsiGyIbYhtiG6IbohviHGIcYhyiHKIc4hziHSIdIh3iHeIeIh4iHmIeYh8iH2IfYh+iH6If4h/iICIgIiBiIGIgoiCiIOIg4iEiISIiIiIiImIiYiKiIqIi4iLiIyIjIiNiI2IjoiOiI+Ij4iQiJCIlYiWiJaIl4iXiJiImoibiJuInIieiJ+In4ihiKKIooijiKaIpoiniKqIqoiriKuIrIiuiK6Ir4iviLCIsIixiLSItYi1iLaItoi5iLmIuoi6iLuIu4i+iL+Iv4jAiMOIxIjEiMWIxYjHiMiIyIjJiMmI0YjSiNKILYgtiDeIN4g4iDiIOYg7iDyIPIg9iD2IQIhBiEGIRIhFiEWIRohGiEmISohKiEuIS4hMiE6IT4hPiFCIUIhUiFSIVYhViFaIWYhZiFqIXYhdiF6IXohfiF+IYIhjiGOIZIhkiGWIaIhoiGmIaYhqiGyIbIhtiG2IbohuiG+IcYhxiHKIcohziHOIdIh0iHeId4h4iHiIeYh5iHyIfYh9iH6Ifoh/iH+IgIiAiIGIgYiCiIKIg4iDiISIhIiIiIiIiYiJiIqIioiLiIuIjIiMiI2IjYiOiI6Ij4iPiJCIkIiViJaIloiXiJeImIiaiJuIm4iciJ6In4ifiKGIooiiiKOIpoimiKeIqoiqiKuIq4isiK6IroiviK+IsIiwiLGItIi1iLWItoi2iLmIuYi6iLqIu4i7iL6Iv4i/iMCIw4jEiMSIxYjFiMeIyIjIiMmIyYjRiNKI0ogtiS2JN4k3iTiJOIk7iTyJPIk9iT2JQIlBiUGJRIlFiUWJRolGiUmJSolKiUuJS4lMiU6JT4lPiVCJUIlUiVSJVYlViVaJWIlYiVmJWYlaiVqJW4ldiV2JXoleiV+JX4lgiWOJY4lkiWSJZYloiWiJaYlpiWqJbIlsiW2JbYluiW6Jb4lxiXGJcolyiXOJc4l0iXSJd4l3iXiJeIl5iXmJfIl9iX2Jfol+iX+Jf4mAiYCJgYmBiYKJgomDiYOJhImEiYWJiomLiYuJjImMiY2JjYmOiY6Jj4mViZaJlomXiZeJmombiZuJnYmeiZ6JpommiaeJqomqiauJq4msia6Jromvia+JsImxibKJsom0ibWJtYm2ibaJuYm5ibqJuom7ibuJvom/ib+JwInDicSJxInIicmJyYnRidKJ0oktiS2JN4k3iTiJOIk7iTyJPIk9iT2JQIlBiUGJRIlFiUWJRolGiUqJSolLiUuJTolPiU+JUIlQiVSJVIlViVWJVolYiViJWYlZiVqJWolbiV6JXolfiV+JYIljiWOJZIlkiWWJZYloiWiJaYlpiWqJbYltiW6JbolviXKJcolziXOJdIl0iXeJeIl4iXmJeYl6iXqJfYl+iX6Jf4l/iYCJgImBiYGJgomCiYOJg4mEiYSJhYmFiYaJjImMiY2JjYmSiZKJk4mViZaJlomZiZqJmombiZuJnYmeiaGJoYmiiaWJpYmmiaaJp4mqiaqJq4muia6Jr4mvibCJsYmyibKJtIm1ibWJtom2ibmJuYm6ibqJu4m7ib6Jv4m/icCJwInDicSJxInIicmJyYnRidKJ0oktii2KN4o3ijiKOIo7ijyKPIo9ij2KQIpBikGKRIpFikWKRopGikqKSopLikuKTopPik+KUIpQilSKVIpVilWKVopYiliKWYpZilqKWopbil6KXopfil+KYIpjimOKZIpkimWKZYpoimiKaYppimqKbYptim6KbopvinKKcopzinOKdIp0ineKeIp4inmKeYp6inqKfYp+in6Kf4p/ioCKgIqBioGKgoqCioOKg4qEioSKhYqFioaKjIqMio2KjYqSipKKk4qVipaKloqZipqKmoqbipuKnYqeiqGKoYqiiqWKpYqmiqaKp4qqiqqKq4quiq6Kr4qvirCKsYqyirKKtIq1irWKtoq2irmKuYq6irqKu4q7ir6Kv4q/isCKwIrDisSKxIrIismKyYrRitKK0ootii2KN4o3ijiKOIo7ijyKPIo9ij2KQIpEikWKRYpGikaKSopKik6KT4pPilCKUIpUilSKVYpVilaKWIpYilmKWYpailqKW4peil6KX4pfimCKY4pjimSKZIplimWKaIpoimmKaYpqimyKbIptim2Kbopuim+Kb4pyinKKc4pzinSKdIp3iniKeIp5inmKeop6in2Kfop+in+Kf4qAioCKgYqBioKKgoqDioOKhIqEioWKhYqGioaKh4qRipGKkoqSipOKlYqWipaKmYqaipqKnIqdip2KnoqhiqGKooqliqWKpoqmiqeKqoqqiquKroquiq+KsoqyirOKs4q0irSKtYq1iraKtoq5irmKuoq6iruKu4q+ir+Kv4rAisCKw4rEisSKx4rIisiKyYrJitGK0orSii2LLYs3izeLOIs4izuLPIs8iz2LPYtAi0SLRYtFi0aLRotKi0qLTotPi0+LUItQi1SLVItVi1WLVotYi1iLWYtZi1qLWotbi16LXotfi1+LYItji2OLZItki2WLZYtoi2iLaYtpi2qLbItsi22LbYtui26Lb4tvi3KLcotzi3OLdIt0i3eLeIt4i3mLeYt6i3qLfYt+i36Lf4t/i4CLgIuBi4GLgouCi4OLg4uEi4SLhYuFi4aLhouHi5GLkYuSi5KLk4uVi5aLlouZi5qLmouci52LnYuei6GLoYuii6WLpYumi6aLp4uqi6qLq4uui66Lr4uyi7KLs4uzi7SLtIu1i7WLtou2i7mLuYu6i7qLu4u7i76Lv4u/i8CLwIvDi8SLxIvHi8iLyIvJi8mL0YvSi9KLLYstizuLPIs8i0CLRItFi0WLRotGi0qLSotOi0+LT4tQi1CLVItUi1WLVYtWi1mLWYtai1qLW4tei16LX4tfi2CLYIthi2OLY4tki2SLZYtli2iLaYtpi2qLaotti22Lbotui2+Lb4twi3CLcotyi3OLc4t0i3SLdYt1i3eLeIt4i3mLeYt6i3qLe4t+i36Lf4t/i4CLgIuBi4GLgouCi4OLg4uEi4SLhYuFi4aLhouHi4eLiIuIi4mLiYuKi4qLi4uPi5CLkIuRi5GLlIuVi5WLlouWi5iLmYuZi5qLmouci52LnYuei6GLoYuii6WLpYumi6aLp4upi6mLqouqi6uLrouui6+LsYuyi7KLs4uzi7SLtIu1i7WLtou2i7mLuYu6i7qLu4u7i76Lvou/i7+LwIvAi8OLxIvEi8eLyIvIi8mLyYvRi9KL0ostjC2MO4w8jDyMQIxEjEWMRYxGjEaMSYxKjEqMToxPjE+MUIxQjFSMVIxVjFWMVoxZjFmMWoxajFuMXoxejF+MX4xgjGCMYYxjjGOMZIxkjGWMZYxojGmMaYxqjGqMbYxtjG6MboxvjG+McIxwjHKMcoxzjHOMdIx0jHWMdYx2jHaMeIx5jHmMeox6jHuMfox+jH+Mf4yAjICMgYyBjIKMgoyFjIaMhoyHjIeMiIyIjImMiYyKjIqMi4yLjI+MkIyQjJOMlIyUjJWMlYyYjJmMmYyajJyMnYydjJ6MoIygjKGMoYyijKWMpYymjKmMqYyqjKqMq4yxjLKMsoy0jLSMtYy1jLaMtoy5jLmMuoy6jLuMu4y+jL6Mv4y/jMCMwIzDjMSMxIzHjMiMyIzJjNGM0ozSjC2MLYw7jDyMPIxAjESMRYxFjEaMRoxJjEqMSoxOjE+MT4xQjFCMVIxUjFWMVYxWjFmMWYxajFqMW4xejF6MX4xfjGCMYIxhjGOMY4xkjGSMZYxljGiMaYxpjGqMaoxtjG2MboxujG+Mb4xwjHCMcoxyjHOMc4x0jHSMdYx1jHaMdox4jHmMeYx6jHqMe4x+jH6Mf4x/jICMgIyBjIGMgoyCjIWMhoyGjIeMh4yIjIiMiYyJjIqMioyLjIuMj4yQjJCMk4yUjJSMlYyVjJiMmYyZjJqMnIydjJ2MnoygjKCMoYyhjKKMpYyljKaMqYypjKqMqoyrjLGMsoyyjLSMtIy1jLWMtoy2jLmMuYy6jLqMu4y7jL6Mvoy/jL+MwIzAjMOMxIzEjMeMyIzIjMmM0YzSjNKMLY0tjTeNN407jT+NQI1AjUSNRY1FjUaNRo1IjUmNSY1KjUqNTo1PjU+NUI1QjVSNVI1VjVWNVo1ZjVmNWo1ajVuNXo1ejV+NX41gjWCNYY1kjWSNZY1ljWiNaY1pjWqNao1tjW2Nbo1ujW+Nb41yjXONc410jXSNdY11jXaNdo14jXmNeY16jXqNe417jXyNf41/jYCNgI2BjYGNgo2CjYWNho2GjYeNh42IjYiNiY2JjYqNio2LjYuNjo2PjY+NkI2QjZONk42UjZSNlY2YjZiNmY2ZjZqNnI2cjZ2NnY2ejaCNoI2hjaSNpI2ljaWNpo2pjamNqo2qjbGNso2yjbSNtY21jbaNto25jbmNuo26jbuNu42+jb6Nv42/jcCNwI3DjcSNxI3FjcWNyI3JjdGN0o3SjS2NLY03jTeNO40/jUCNQI1EjUWNRY1GjUaNSI1JjUmNSo1KjU6NT41PjVCNUI1UjVSNVY1VjVaNWY1ZjVqNWo1bjV6NXo1fjV+NYI1gjWGNZI1kjWWNZY1ojWmNaY1qjWqNbY1tjW6Nbo1vjW+Nco1zjXONdI10jXWNdY12jXaNeI15jXmNeo16jXuNe418jX+Nf42AjYCNgY2BjYKNgo2FjYaNho2HjYeNiI2IjYmNiY2KjYqNi42LjY6Nj42PjZCNkI2TjZONlI2UjZWNmI2YjZmNmY2ajZyNnI2djZ2Nno2gjaCNoY2kjaSNpY2ljaaNqY2pjaqNqo2xjbKNso20jbWNtY22jbaNuY25jbqNuo27jbuNvo2+jb+Nv43AjcCNw43EjcSNxY3FjciNyY3RjdKN0o0tji2ONo43jjeOOI44jjqOO447jj+OQI5AjkGOQY5EjkWORY5GjkaOSI5JjkmOSo5Kjk6OT45PjlCOUI5UjlSOVY5VjlaOWY5ZjlqOWo5bjluOXI5ejl6OX45fjmCOYI5hjmSOZI5ljmWOaI5pjmmOao5qjmuOa45tjm2Obo5ujm+Ob45wjnCOco5zjnOOdI50jnWOdY52jnaOd455jnmOeo56jnuOe458jnyOfY6AjoCOgY6BjoKOgo6DjoOOho6HjoeOiI6IjomOiY6Kjo6Ojo6Pjo+OkI6TjpOOlI6UjpWOl46XjpiOmI6ZjpyOnI6djqCOoI6hjqSOpI6ljqWOpo6pjqmOqo6qjq2Oro6ujrGOso6yjrSOtY61jraOto65jrmOuo66jruOvo6+jr+Ov47AjsCOw47EjsSOxY7FjsaOxo7IjsmO0Y7SjtKOLY4tjjWONo42jjeON446jjuOO44/jkCOQI5BjkGORI5FjkWOSY5KjkqOTo5Pjk+OUI5QjlSOVI5VjlWOVo5ZjlmOWo5ajluOW45cjl+OX45gjmCOYY5hjmSOZI5ljmWOaI5pjmmOao5qjmuOa45tjm2Obo5ujm+Ob45wjnCOc450jnSOdY51jnaOdo53jnqOeo57jnuOfI58jn2OgI6BjoGOgo6CjoOOg46EjoSOjY6Njo6Ojo6PjpKOko6TjpOOlI6XjpeOmI6YjpmOm46bjpyOnI6djp+On46gjqCOoY6kjqSOpY6ljqaOqY6pjqqOqo6tjq6Oro6wjrGOsY6yjrKOtI61jrWOto62jrmOuY66jrqOu46+jr6Ov46/jsCOw47EjsSOxY7FjsaOxo7IjsmO0Y7SjtKOLY8tjzWPNo82jzePN486jzuPO48/j0CPQI9Bj0GPRI9Fj0WPSY9Kj0qPTo9Pj0+PUI9Qj1SPVI9Vj1WPVo9Zj1mPWo9aj1uPW49cj1+PX49gj2CPYY9hj2SPZI9lj2WPaI9pj2mPao9qj2uPa49tj22Pbo9uj2+Pb49wj3CPc490j3SPdY91j3aPdo93j3qPeo97j3uPfI98j32PgI+Bj4GPgo+Cj4OPg4+Ej4SPjY+Nj46Pjo+Pj5KPko+Tj5OPlI+Xj5ePmI+Yj5mPm4+bj5yPnI+dj5+Pn4+gj6CPoY+kj6SPpY+lj6aPqY+pj6qPqo+tj66Pro+wj7GPsY+yj7KPtI+1j7WPto+2j7mPuY+6j7qPu4++j76Pv4+/j8CPw4/Ej8SPxY/Fj8aPxo/Ij8mP0Y/Sj9KPLY8tjzaPN483jzqPO487jz+PQI9Aj0GPQY9Ej0mPSo9Kj06PT49Pj1SPVI9Vj1WPVo9aj1qPW49bj1yPX49fj2CPYI9hj2GPZI9kj2WPZY9oj2mPaY9qj2qPa49rj2yPbI9tj22Pbo9uj2+Pb49wj3CPcY9xj3SPdY91j3aPdo93j3uPe498j3yPfY+Bj4KPgo+Dj4OPhI+Ej4WPi4+Mj4yPjY+Nj46Pjo+Pj5KPko+Tj5OPlI+Wj5aPl4+Xj5iPnI+fj5+PoI+gj6SPpI+lj6WPpo+oj6mPqY+qj6qPrY+uj66PsI+xj7GPso+yj7SPtY+1j7aPto+5j7mPuo+6j7uPvo++j7+Pv4/Aj8OPxI/Ej8WPxY/Hj8iPyI/Jj9GP0o/Sjy2QLZA2kDeQN5A6kDuQO5A/kECQQJBBkEGQRJBJkEqQSpBOkE+QT5BUkFSQVZBVkFaQWpBakFuQW5BckF+QX5BgkGCQYZBhkGSQZJBlkGWQaJBpkGmQapBqkGuQa5BskGyQbZBtkG6QbpBvkG+QcJBwkHGQcZB0kHWQdZB2kHaQd5B7kHuQfJB8kH2QgZCCkIKQg5CDkISQhJCFkIuQjJCMkI2QjZCOkI6Qj5CSkJKQk5CTkJSQlpCWkJeQl5CYkJyQn5CfkKCQoJCkkKSQpZClkKaQqJCpkKmQqpCqkK2QrpCukLCQsZCxkLKQspC0kLWQtZC2kLaQuZC5kLqQupC7kL6QvpC/kL+QwJDDkMSQxJDFkMWQx5DIkMiQyZDRkNKQ0pAtkC2QNpA3kDeQOpA7kDuQP5BAkECQQ5BEkESQSZBKkEqQTpBPkE+QUJBQkFSQVJBVkFqQWpBbkFuQXJBfkF+QYJBgkGGQYZBkkGWQZZBpkGqQapBrkGuQbZBukG6Qb5BvkHCQcJBxkHGQdJB1kHWQdpB2kHeQd5B4kHuQe5B8kHyQfZB9kIKQg5CDkISQhJCFkIWQhpCGkIeQh5CIkIiQiZCJkIqQipCLkIuQjJCMkI2QjZCOkI6Qj5CRkJGQkpCSkJOQlpCWkJeQl5CYkJ6Qn5CfkKSQpJClkKWQppCnkKiQqJCpkKmQrJCtkK2QrpCukLCQsZCxkLKQspC0kLWQtZC2kLaQuJC4kLmQuZC6kLqQu5C+kL6Qv5C/kMCQwJDCkMOQw5DEkMSQx5DIkMiQyZDRkNKQ0pAtkS2RNpE6kTuRO5E/kUCRQJFDkUSRRJFFkUWRSZFKkUqRTpFPkU+RUJFQkVSRVJFVkVWRVpFakVqRW5FfkV+RYJFgkWGRYZFkkWWRZZFmkWaRaZFqkWqRa5FrkW6Rb5FvkXCRcJFxkXGRdZF1kXaRdpF3kXeReJF7kXyRfJF9kX6RfpF/kX+RgJGEkYSRhZGFkYaRhpGHkYeRiJGIkYmRiZGKkYqRi5GLkYyRjJGNkY2RjpGRkZGRkpGSkZORlZGWkZaRl5GXkZqRnZGekZ6Rn5GfkaORpJGkkaWRpZGnkaiRqJGpkamRrJGtka2RrpGukbCRsZGxkbKRspG0kbSRtZG1kbaRtpG3kbeRuJG4kbmRuZG6kbqRu5G+kb6Rv5G/kcCRwJHCkcORw5HEkcSRxZHFkciRyZHJkdGR0pHSkS2RLZE2kTqRO5E7kT+RQJFAkUORRJFEkUWRRZFJkUqRSpFOkU+RT5FQkVCRVJFUkVWRVZFWkVqRWpFbkV+RX5FgkWCRYZFhkWSRZZFlkWaRZpFpkWqRapFrkWuRbpFvkW+RcJFwkXGRcZF1kXWRdpF2kXeRd5F4kXuRfJF8kX2RfpF+kX+Rf5GAkYSRhJGFkYWRhpGGkYeRh5GIkYiRiZGJkYqRipGLkYuRjJGMkY2RjZGOkZGRkZGSkZKRk5GVkZaRlpGXkZeRmpGdkZ6RnpGfkZ+Ro5GkkaSRpZGlkaeRqJGokamRqZGska2RrZGuka6RsJGxkbGRspGykbSRtJG1kbWRtpG2kbeRt5G4kbiRuZG5kbqRupG7kb6RvpG/kb+RwJHAkcKRw5HDkcSRxJHFkcWRyJHJkcmR0ZHSkdKRLZItkjWSNpI2kjqSO5I7kj+SQJJDkkSSRJJFkkWSSZJKkkqSTpJPkk+SUJJQklSSVJJVklWSVpJaklqSW5JbklySX5JgkmCSYZJhkmSSZZJlkmaSZpJpkmqSapJrkmuSbpJvkm+ScJJwknGScZJyknKSc5J2knaSd5J3kniSeJJ7knySfJJ9kn2SfpJ+kn+Sf5KAkoCSgZKFkoWShpKGkoeSh5KIkoiSiZKJkoqSipKLkouSjJKMko2SjZKQkpGSkZKSkpKSlJKVkpWSlpKWkpmSmpKakpuSm5Kdkp6SnpKfkp+SopKjkqOSpJKkkqeSqJKokqmSqZKskq2SrZKwkrGSsZKykrKStJK0krWStZK2kriSuJK5krmSupK6kruSu5K8krySvpK/kr+SwJLAksKSw5LDksSSxJLFksWSyJLJktGS0pLSki2SLZI1kjaSNpI6kjuSO5I/kkCSQ5JEkkSSRZJFkkmSSpJKkk6ST5JPklCSUJJUklSSVZJVklaSWpJakluSW5Jckl+SYJJgkmGSYZJkkmWSZZJmkmaSaZJqkmqSa5Jrkm6Sb5JvknCScJJxknGScpJyknOSdpJ2kneSd5J4kniSe5J8knySfZJ9kn6SfpJ/kn+SgJKAkoGShZKFkoaShpKHkoeSiJKIkomSiZKKkoqSi5KLkoySjJKNko2SkJKRkpGSkpKSkpSSlZKVkpaSlpKZkpqSmpKbkpuSnZKekp6Sn5KfkqKSo5KjkqSSpJKnkqiSqJKpkqmSrJKtkq2SsJKxkrGSspKykrSStJK1krWStpK4kriSuZK5krqSupK7kruSvJK8kr6Sv5K/ksCSwJLCksOSw5LEksSSxZLFksiSyZLRktKS0pItky2TOZM6kzqTO5M7k0OTRJNEk0WTRZNIk0mTSZNKk0qTTpNPk0+TUJNQk1STVJNVk1WTVpNWk1eTWZNZk1qTWpNbk1uTXJNck1+TYJNgk2GTYZNkk2WTZZNmk2aTaZNqk2qTa5Nrk2+TcJNwk3GTcZNyk3KTc5N2k3aTd5N3k3iTeJN5k3mTfJN9k32TfpN+k3+Tf5OAk4CTgZOBk4KTgpOQk5GTkZOUk5WTlZOWk5aTmJOZk5mTmpOak5uTm5Ock52TnZOek56Tn5Ofk6GTopOik6OTo5Okk6STppOnk6eTqJOok6mTqZOrk6yTrJOtk62Tr5Owk7CTsZOxk7STtJO1k7WTtpO4k7iTuZO5k7qTu5O8k7yTvZO9k76Tv5O/k8CTwJPCk8OTw5PEk8STxZPFk9GT0pPSky2TLZM5kzqTOpM7kzuTQ5NEk0STRZNFk0iTSZNJk0qTSpNPk0+TUJNQk1GTVJNUk1WTVZNWk1aTV5NZk1mTWpNak1uTW5Nck1yTX5Ngk2CTYZNhk2KTYpNkk2WTZZNmk2aTZ5Nnk2qTa5Nrk2yTbJNwk3CTcZNxk3KTcpNzk3OTdJN3k3eTeJN4k3mTeZN+k36Tf5N/k4CTgJOBk4GTgpOCk4OTg5OPk5CTkJORk5GTlJOVk5WTlpOWk5eTl5OYk5iTmZOZk5qTnJOdk52TnpOek5+Tn5Ohk6KTopOjk6OTppOnk6eTqJOok6mTqZOrk6yTrJOtk62Tr5Owk7CTsZOxk7STtJO1k7WTtpO4k7iTuZO5k7qTupO7k7uTvJO8k72TvZO+k76Tv5O/k8CTwJPCk8OTw5PEk8ST0ZPSk9KTLZQtlDmUOpQ6lDuUO5RDlESURJRFlEWUSJRJlEmUSpRKlE+UT5RQlFCUUZRUlFSUVZRVlFaUVpRXlFmUWZRalFqUW5RblFyUXJRflGCUYJRhlGGUYpRilGSUZZRllGaUZpRnlGeUapRrlGuUbJRslHCUcJRxlHGUcpRylHOUc5R0lHeUd5R4lHiUeZR5lH6UfpR/lH+UgJSAlIGUgZSClIKUg5SDlI+UkJSQlJGUkZSUlJWUlZSWlJaUl5SXlJiUmJSZlJmUmpSclJ2UnZSelJ6Un5SflKGUopSilKOUo5SmlKeUp5SolKiUqZSplKuUrJSslK2UrZSvlLCUsJSxlLGUtJS0lLWUtZS2lLiUuJS5lLmUupS6lLuUu5S8lLyUvZS9lL6UvpS/lL+UwJTAlMKUw5TDlMSUxJTRlNKU0pQtlC2UOpQ7lD6UP5Q/lECUQ5RElESURZRFlEiUSZRJlEqUSpRPlE+UUJRQlFGUVJRUlFWUVZRWlFaUV5RalFqUW5RblFyUXJRflGCUYJRhlGGUYpRilGSUZZRllGaUZpRnlGeUapRrlGuUbJRslG2UcJRwlHGUcZRylHKUc5RzlHSUdJR3lHiUeJR5lHmUepR6lH+Uf5SAlICUgZSBlIKUgpSDlIOUhJSElIeUjpSPlI+UkJSQlJOUlJSUlJWUlZSWlJaUl5SXlJiUmJSZlJmUmpSclJ2UnZSelJ6UoZSilKKUo5SjlKaUp5SnlKiUqJSrlKuUrJSslK2UrZSvlLCUsJSxlLGUtJS0lLWUuJS4lLmUuZS6lLqUu5S7lLyUvJS9lL2UvpS+lL+Uv5TAlMCUwpTDlMOUxJTElNGU0pTSlC2VLZU6lTuVPpU/lT+VQJVDlUSVRJVFlUWVSJVJlUmVSpVKlU+VT5VQlVCVUZVUlVSVVZVVlVaVVpVXlVqVWpVblVuVXJVclV+VYJVglWGVYZVilWKVZJVllWWVZpVmlWeVZ5VqlWuVa5VslWyVbZVwlXCVcZVxlXKVcpVzlXOVdJV0lXeVeJV4lXmVeZV6lXqVf5V/lYCVgJWBlYGVgpWClYOVg5WElYSVh5WOlY+Vj5WQlZCVk5WUlZSVlZWVlZaVlpWXlZeVmJWYlZmVmZWalZyVnZWdlZ6VnpWhlaKVopWjlaOVppWnlaeVqJWolauVq5WslayVrZWtla+VsJWwlbGVsZW0lbSVtZW4lbiVuZW5lbqVupW7lbuVvJW8lb2VvZW+lb6Vv5W/lcCVwJXClcOVw5XElcSV0ZXSldKVLZUtlT6VP5U/lUCVQ5VElUSVRZVFlUiVSZVJlUqVSpVPlU+VUJVQlVSVVJVVlVWVVpVWlVeVWpValVuVW5VclVyVXZVdlV+VYJVglWGVYZVilWKVZZVmlWaVZ5VnlWiVapVrlWuVbJVslW2VbZVulXGVcZVylXKVc5VzlXSVdJV4lXmVeZV6lXqVe5WAlYCVgZWBlYKVgpWDlYOVhJWElYWVhZWGlYaVh5WHlYiViJWJlY2VjZWOlY6Vj5WPlZCVkJWTlZSVlJWVlZWVlpWWlZeVl5WYlZiVmZWclZyVnZWdlZ6VnpWmlaaVp5WnlaiVqJWrlauVrJWsla2Vr5WwlbCVsZW0lbSVtZW3lbeVuJW4lbmVuZW6lbqVu5W7lbyVvJW9lb2VvpW+lb+Vv5XAlcCVwpXDlcOVxJXEldGV0pXSlS2WLZY+lj6WP5Y/lkCWQ5ZElkSWRZZFlkiWSZZJlkqWSpZOlk+WT5ZQllCWVJZUllWWVZZWllaWV5ZalluWW5ZcllyWXZZdll+WYJZglmGWYZZilmKWZZZmlmaWZ5ZnlmiWapZrlmuWbJZslm2WbZZulnGWcZZylnKWc5ZzlnSWdJZ5lnmWepZ6lnuWe5Z8loGWgpaCloOWg5aEloSWhZaFloaWhpaHloeWiJaIlomWiZaKloqWi5aLloyWjJaNlo2WjpaOlo+Wj5aQlpOWlJaUlpWWlZaWlpaWl5aXlpiWmJaZlpyWnJadlp2WnpamlqaWp5anlqiWq5arlqyWrJatlq+WsJawlrGWtJa0lrWWt5a3lriWuJa5lrmWupa6lruWu5a8lryWvZa9lr6Wv5a/lsCWwJbClsOWw5bElsSW0ZbSltKWLZYtlj6WPpY/lj+WQJZDlkSWRJZFlkWWSJZJlkmWSpZKlk6WT5ZPllCWUJZUllSWVZZVllaWVpZXllqWW5ZbllyWXJZdll2WX5ZglmCWYZZhlmKWYpZllmaWZpZnlmeWaJZqlmuWa5ZslmyWbZZtlm6WcZZxlnKWcpZzlnOWdJZ0lnmWeZZ6lnqWe5Z7lnyWgZaCloKWg5aDloSWhJaFloWWhpaGloeWh5aIloiWiZaJloqWipaLlouWjJaMlo2WjZaOlo6Wj5aPlpCWk5aUlpSWlZaVlpaWlpaXlpeWmJaYlpmWnJaclp2WnZaelqaWppanlqeWqJarlquWrJaslq2Wr5awlrCWsZa0lrSWtZa3lreWuJa4lrmWuZa6lrqWu5a7lryWvJa9lr2Wvpa/lr+WwJbAlsKWw5bDlsSWxJbRltKW0pYtly2XNZc2lz6XPpc/l0KXQ5dDl0SXRJdFl0WXSJdJl0mXSpdKl06XT5dPl1GXUpdVl1WXVpdWl1eXV5dZl1mXWpdbl1uXXJdcl12XXZdgl2GXYZdil2KXZZdml2aXZ5dnl2iXa5drl2yXbJdtl22Xbpdul2+Xcpdyl3OXc5d0l3SXdZd1l3qXepd7l3uXfJd8l32XfZd+l36Xg5eDl4SXhJeFl4WXhpeGl4eXh5eIl4iXiZeJl4qXipeLl4uXjJeMl42XjZeOl46Xj5eTl5SXlJeVl5WXlpeWl5eXl5eal5uXm5ecl5yXnZedl56XoZehl6KXpZell6aXppenl6eXqJerl6uXrJevl6+XsJe0l7SXtZe3l7eXuJe4l7mXuZe6l7qXu5e7l7yXvJe+l7+Xv5fAl8CXwpfDl8OXxJfRl9KX0pctly2XNZc2lz6XPpc/l0KXQ5dDl0SXRJdFl0WXSJdJl0mXSpdKl06XT5dPl1GXUpdVl1WXVpdWl1eXV5dZl1mXWpdbl1uXXJdcl12XXZdgl2GXYZdil2KXZZdml2aXZ5dnl2iXa5drl2yXbJdtl22Xbpdul2+Xcpdyl3OXc5d0l3SXdZd1l3qXepd7l3uXfJd8l32XfZd+l36Xg5eDl4SXhJeFl4WXhpeGl4eXh5eIl4iXiZeJl4qXipeLl4uXjJeMl42XjZeOl46Xj5eTl5SXlJeVl5WXlpeWl5eXl5eal5uXm5ecl5yXnZedl56XoZehl6KXpZell6aXppenl6eXqJerl6uXrJevl6+XsJe0l7SXtZe3l7eXuJe4l7mXuZe6l7qXu5e7l7yXvJe+l7+Xv5fAl8CXwpfDl8OXxJfRl9KX0pctmC2YNZg2mEOYRJhEmEWYRZhKmEqYTphPmE+YUZhSmFKYVZhVmFaYVphXmFeYWJhYmFmYWZhbmFyYXJhdmF2YYJhhmGGYYphimGWYZphmmGeYZ5homGyYbJhtmG2YbphumG+YcphzmHOYdJh0mHWYdZh2mHaYeph6mHuYe5h8mHyYfZh9mH6Yfph/mH+YgJiFmIaYhpiHmIeYiJiImImYiZiKmIqYi5iLmIyYjJiNmI2YjpiTmJOYlJiUmJWYlZiWmJaYmZiamJqYnJicmJ2YnZiemKCYoJihmKGYopilmKWYppimmKeYp5iomKqYqpirmKuYrJivmK+YsJi0mLSYtZi3mLeYuJi4mLmYuZi6mLqYu5i7mLyYvJi/mMCYwJjDmMSY0ZjSmNKYLZgtmDmYOZg6mDqYO5hDmESYRJhFmEWYS5hLmE6YT5hPmFGYUphSmFWYVZhWmFaYV5hXmFiYWJhZmFmYW5hcmFyYXZhdmGCYYZhhmGKYYphjmGOYZphmmGeYZ5homGiYaZhsmGyYbZhtmG6YbphvmHOYdJh0mHWYdZh2mHaYd5h3mHiYe5h8mHyYfZh9mH6Yfph/mH+YgJiAmIGYh5iImIiYiZiKmIqYi5iLmIyYjJiNmI2YjpiRmJGYkpiSmJOYk5iUmJSYlZiVmJaYlpiYmJmYmZiamJqYnJicmJ2YnZiemKCYoJihmKGYopilmKWYppimmKeYqpiqmKuYq5ismK6YrpivmK+YsJizmLOYtJi2mLeYt5i4mLiYuZi6mLuYu5i8mLyYvpi/mL+YwJjAmMOYxJjEmNGY0pjSmC2ZLZk5mTmZOpk6mTuZQ5lEmUSZRZlFmUuZS5lOmU+ZT5lRmVKZUplVmVWZVplWmVeZV5lYmViZWZlZmVuZXJlcmV2ZXZlgmWGZYZlimWKZY5ljmWaZZplnmWeZaJlomWmZbJlsmW2ZbZlumW6Zb5lzmXSZdJl1mXWZdpl2mXeZd5l4mXuZfJl8mX2ZfZl+mX6Zf5l/mYCZgJmBmYeZiJmImYmZipmKmYuZi5mMmYyZjZmNmY6ZkZmRmZKZkpmTmZOZlJmUmZWZlZmWmZaZmJmZmZmZmpmamZyZnJmdmZ2ZnpmgmaCZoZmhmaKZpZmlmaaZppmnmaqZqpmrmauZrJmuma6Zr5mvmbCZs5mzmbSZtpm3mbeZuJm4mbmZupm7mbuZvJm8mb6Zv5m/mcCZwJnDmcSZxJnRmdKZ0pktmS2ZOZk5mTqZOpk7mT6ZP5lDmUSZRJlLmUuZTJlOmU+ZT5lRmVKZUplTmVOZVZlWmVaZV5lXmViZWJlZmVmZWplcmV2ZXZlemV6ZYJlhmWGZYplimWOZY5lmmWaZZ5lnmWiZaJlpmW2ZbZlumW6Zb5lvmXOZdJl0mXWZdZl2mXaZd5l3mXiZfZl+mX6Zf5l/mYCZgJmBmYGZgpmFmYaZhpmHmYeZiJmImYmZipmKmYuZi5mMmYyZkJmRmZGZkpmSmZOZk5mUmZSZlZmYmZiZmZmZmZqZnJmcmZ2ZoJmgmaGZoZmimaSZpJmlmaWZppmmmaeZqpmqmauZq5msma6Zrpmvma+ZsJmwmbGZs5mzmbSZtpm3mbeZuJm4mbmZupm7mbuZvJm8mb6Zvpm/mb+ZwJnAmcGZwZnEmdGZ0pnSmS2aLZo5mjmaOpo6mjuaPpo/mkOaRJpEmkuaS5pMmk6aT5pPmlGaUppSmlOaU5pVmlaaVppXmleaWJpYmlmaWZpamlyaXZpdml6aXppgmmGaYZpimmKaY5pjmmaaZppnmmeaaJpommmabZptmm6abppvmm+ac5p0mnSadZp1mnaadpp3mneaeJp9mn6afpp/mn+agJqAmoGagZqCmoWahpqGmoeah5qImoiaiZqKmoqai5qLmoyajJqQmpGakZqSmpKak5qTmpSalJqVmpiamJqZmpmampqcmpyanZqgmqCaoZqhmqKapJqkmqWapZqmmqaap5qqmqqaq5qrmqyarpqumq+ar5qwmrCasZqzmrOatJq2mreat5q4mriauZq6mruau5q8mryavpq+mr+av5rAmsCawZrBmsSa0ZrSmtKaLZotmjmaOpo6mjuaPpo/mkOaRJpEmkyaT5pPmlGaUppSmlOaU5pVmlaaVppXmleaWJpYmlmaWZpamlyaXZpdml6aXppgmmGaYZpimmKaY5pjmmaaZppnmmeaaJpommmabZpumm6ab5pvmnCacJp1mnWadpp2mnead5p4mniafpp+mn+af5qAmoCagZqBmoKagpqDmoOahJqEmoWahZqGmoaah5qHmoiaiJqJmomaipqKmouai5qPmpCakJqRmpGakpqSmpOal5qXmpiamJqZmpmampqbmpuanJqcmp2an5qfmqCaoJqhmqSapJqlmqWappqmmqeaqZqpmqqaqpqrmquarJqumq6ar5qvmrCasJqxmrOas5q0mraat5q3mriauJq5mrqau5q7mryavJq9mr2avpq+mr+av5rAmsCawZrBmtGa0prSmi2bLZs5mzmbOps6mzubPps/m0ObRJtEm0ibSZtPm0+bUZtSm1KbU5tTm1abV5tXm1ibWJtZm1mbWptcm12bXZtem16bYJthm2GbYptim2ObY5tnm2ebaJtom2mbaZtqm26bb5tvm3CbcJtxm3Gbdpt2m3ebd5t4m3ibeZt5m3qbept+m36bf5t/m4CbgJuBm4GbgpuCm4Obg5uEm4SbhZuFm4abhpuHm4ebiJuIm4mbiZuKm4qbi5uOm4+bj5uQm5CbkZuRm5KbkpuWm5abl5uXm5ibmJuZm5mbmpuam5ubm5ucm5ybnZufm5+boJugm6GbpJukm6WbpZumm6mbqZuqm6qbq5uum66br5uvm7Cbspuym7Obs5u0m7abt5u3m7ibuJu5m7qbu5u7m7ybvJu9m72bvpu+m7+bv5vAm8CbwZvBm8Kbw5vDm8Sb0ZvSm9KbLZstmzmbOZs6mzqbO5s+mz+bQ5tEm0SbSJtJm0+bT5tRm1KbUptTm1ObVptXm1ebWJtYm1mbWZtam1ybXZtdm16bXptgm2GbYZtim2KbY5tjm2ebZ5tom2ibaZtpm2qbbptvm2+bcJtwm3GbcZt2m3abd5t3m3ibeJt5m3mbept6m36bfpt/m3+bgJuAm4GbgZuCm4Kbg5uDm4SbhJuFm4WbhpuGm4ebh5uIm4ibiZuJm4qbipuLm46bj5uPm5CbkJuRm5GbkpuSm5ablpuXm5ebmJuYm5mbmZuam5qbm5ubm5ybnJudm5+bn5ugm6CboZukm6SbpZulm6abqZupm6qbqpurm66brpuvm6+bsJuym7Kbs5uzm7Sbtpu3m7ebuJu4m7mbupu7m7ubvJu8m72bvZu+m76bv5u/m8CbwJvBm8GbwpvDm8ObxJvRm9Kb0pstnC2cOZw5nDqcOpw7nD6cP5w/nECcQpxDnEOcRJxEnEicSZxPnE+cUJxQnFGcUpxSnFOcU5xWnFecV5xYnFicXJxdnF2cXpxenF+cYZxinGKcY5xjnGScaJxonGmcaZxqnG+ccJxwnHGccZxynHKcc5x3nHeceJx5nHmcepx6nHucgJyAnIGcgpyDnIOchJyEnIWchZyGnIach5yHnIiciJyJnImcipyOnI6cj5yPnJCckJyRnJGclpyWnJecl5yZnJqcmpybnJucnJyfnJ+coJygnKGco5yknKScpZylnKacqZypnKqcqpyunK6cr5yvnLCcsZyynLKcs5yznLSctpy3nLecuJy4nLmcupy7nLucvJy8nL2cvZy+nL6cv5y/nMCcwJzBnMGcwpzDnMOcxJzEnNGc0pzSnC2cLZw5nDqcOpw7nD6cP5w/nECcQpxDnEOcRJxEnEicSZxPnE+cUJxQnFGcUZxSnFKcU5xTnFScVJxWnFecV5xYnFicXJxdnF2cXpxenF+cYpxinGOcY5xknGScZZxonGicaZxpnGqcapxtnG+ccJxwnHGccZxynHKcc5xznHSceJx5nHmcepx6nHuce5x8nHycfZx9nIiciJyNnI2cjpyOnI+cj5yQnJSclZyVnJaclpyXnJecmZyanJqcm5ybnJycnpyfnJ+coJygnKKco5yjnKScpJylnKWcqZypnKqcqpytnK6crpyvnK+csJyxnLKcspyznLOctJy2nLect5y4nLicuZy5nLqcupy7nLucvJy8nL6cvpy/nL+cwJzAnMGcwZzCnMKcw5zDnMScxJzRnNKc0pwtnS2dOZ06nTqdO50+nT+dP51AnUKdQ51DnUSdRJ1InUmdT51PnVCdUJ1RnVGdUp1SnVOdU51UnVSdVp1XnVedWJ1YnVydXZ1dnV6dXp1fnWKdYp1jnWOdZJ1knWWdaJ1onWmdaZ1qnWqdbZ1vnXCdcJ1xnXGdcp1ynXOdc510nXideZ15nXqdep17nXudfJ18nX2dfZ2InYidjZ2NnY6djp2PnY+dkJ2UnZWdlZ2WnZadl52XnZmdmp2anZudm52cnZ6dn52fnaCdoJ2inaOdo52knaSdpZ2lnamdqZ2qnaqdrZ2una6dr52vnbCdsZ2ynbKds52znbSdtp23nbeduJ24nbmduZ26nbqdu527nbydvJ2+nb6dv52/ncCdwJ3BncGdwp3CncOdw53EncSd0Z3SndKdLZ0tnTmdOp0+nT+dP51AnUKdQ51DnUSdRJ1InUmdSZ1MnUydTZ1PnU+dUJ1QnVGdUp1TnVOdVJ1UnVedWJ1YnVmdWZ1cnV2dXZ1enV6dX51inWKdY51jnWSdZJ1lnWWdaJ1onWmdaZ1qnWqdbZ1tnW6dbp1vnXGdcZ1ynXKdc51znXSddJ14nXmdeZ16nXqde517nXydfJ19nX2dfp1+nYydjJ2NnY2djp2OnY+dk52UnZSdlZ2VnZadlp2YnZmdmZ2anZqdm52bnZ2dnp2enZ+dn52inaOdo52knaSdpZ2lnaidqZ2pnaqdqp2tna6drp2vna+dsJ2xnbKdsp2znbOdtJ22nbedt524nbiduZ25nbqdup27nbudvp2/nb+dwJ3AncOdxJ3EndGd0p3SnS2eLZ45njqePp4/nj+eQJ5CnkOeQ55EnkSeSJ5JnkmeTJ5Mnk2eT55PnlCeUJ5RnlKeU55TnlSeVJ5XnlieWJ5ZnlmeXJ5dnl2eXp5enl+eYp5inmOeY55knmSeZZ5lnmieaJ5pnmmeap5qnm2ebZ5unm6eb55xnnGecp5ynnOec550nnSeeJ55nnmeep56nnuee558nnyefZ59nn6efp6MnoyejZ6Nno6ejp6PnpOelJ6UnpWelZ6WnpaemJ6Znpmemp6anpuem56dnp6enp6fnp+eop6jnqOepJ6knqWepZ6onqmeqZ6qnqqerZ6unq6er56vnrCesZ6ynrKes56znrSetp63nreeuJ64nrmeuZ66nrqeu567nr6ev56/nsCewJ7DnsSexJ7RntKe0p4tni2ePp4+nj+eQp5DnkOeRJ5EnkieSZ5JnkyeTZ5QnlCeUZ5SnlOeU55UnlSeV55YnlieWZ5ZnlyeXZ5dnl6eXp5fnl+eYJ5jnmOeZJ5knmWeZZ5onmmeaZ5qnmqebZ5tnm6ebp5vnm+ecp5ynnOec550nnSedZ51nnaedp56nnqee557nnyefJ59nn2efp5+nn+ef56Anomeip6Knouei56MnoyejZ6NnpOek56UnpSelZ6VnpiemJ6Znpmemp6anpuem56cnp2enZ6enp6eop6jnqOepJ6knqWepZ6onqmeqZ6tnq6erp6vnrGesp6ynrOes562nreet564nrieuZ65nrqeup67nr6ev56/nsCewJ7EntGe0p7Sni2fLZ8+nz6fP59Cn0OfQ59En0SfSJ9Jn0mfTJ9Nn1CfUJ9Rn1OfU59Un1SfV59Yn1ifWZ9Zn1qfXJ9dn12fXp9en1+fX59gn2OfY59kn2SfZZ9ln2afZp9pn2qfap9rn2ufbJ9sn22fbZ9un26fb59vn3CfcJ9yn3Ofc590n3SfdZ91n3afdp93n3ufe598n3yffZ99n36ffp9/n3+fgJ+An4GfgZ+Cn4Kfg5+Dn4SfhJ+Hn4ifiJ+Jn4mfip+Kn4ufi5+Mn4yfjZ+Nn5GfkZ+Sn5Kfk5+Tn5SflJ+Vn5efl5+Yn5ifmZ+Zn5qfmp+cn52fnZ+en56foZ+in6Kfo5+jn6SfpJ+nn6ifqJ+pn6mfrZ+un66fr5+xn7Kfsp+zn7Oftp+3n7efuJ+4n7mfuZ+6n7qfu5+7n76fv5+/n8CfwJ/Dn8SfxJ/Rn9Kf0p8tny2fPp8+nz+fQp9Dn0OfRJ9En0ifSZ9Jn0yfTZ9Qn1CfUZ9Tn1OfVJ9Un1efWJ9Yn1mfWZ9an1yfXZ9dn16fXp9fn1+fYJ9jn2OfZJ9kn2WfZZ9mn2afaZ9qn2qfa59rn2yfbJ9tn22fbp9un2+fb59wn3Cfcp9zn3OfdJ90n3WfdZ92n3afd597n3uffJ98n32ffZ9+n36ff59/n4CfgJ+Bn4Gfgp+Cn4Ofg5+En4Sfh5+In4ifiZ+Jn4qfip+Ln4ufjJ+Mn42fjZ+Rn5Gfkp+Sn5Ofk5+Un5SflZ+Xn5efmJ+Yn5mfmZ+an5qfnJ+dn52fnp+en6Gfop+in6Ofo5+kn6Sfp5+on6ifqZ+pn62frp+un6+fsZ+yn7Kfs5+zn7aft5+3n7ifuJ+5n7mfup+6n7ufu5++n7+fv5/An8Cfw5/En8Sf0Z/Sn9KfLaAtoD6gPqA/oEKgQ6BDoESgRKBIoEmgSaBKoEqgTKBNoFCgUKBRoFOgU6BUoFSgVaBXoFigWKBZoFmgWqBdoF2gXqBeoF+gX6BgoGOgY6BkoGSgZaBloGagZqBpoGqgaqBroGugbKBsoG2gbaBuoG6gb6BvoHCgcKBxoHGgc6B0oHSgdaB1oHagdqB3oHegeKB7oHygfKB9oH2gfqB+oH+gf6CAoICggaCBoIKggqCDoIOghKCEoIWghqCHoIegiKCIoImgiaCKoIqgi6CLoJCgkaCRoJKgkqCToJaglqCXoJegmKCYoJmgmaCaoJygnKCdoJ2gnqCeoKGgoqCioKOgo6CkoKSgp6CooKigraCuoK6gr6CxoLKgsqCzoLOgtaC2oLagt6C3oLiguKC5oLmguqC6oLugu6C8oLygvqC+oL+gv6DAoMCgwqDDoMOgxKDEoNGg0qDSoC2gLaA+oD6gP6BCoEOgQ6BEoESgSKBJoEmgSqBKoEygTaBQoFCgUaBToFOgVKBUoFWgV6BYoFigWaBZoFqgXaBdoF6gXqBfoF+gYKBjoGOgZKBkoGWgZaBmoGagaaBqoGqga6BroGygbKBtoG2gbqBuoG+gb6BwoHCgcaBxoHOgdKB0oHWgdaB2oHagd6B3oHige6B8oHygfaB9oH6gfqB/oH+ggKCAoIGggaCCoIKgg6CDoISghKCFoIagh6CHoIigiKCJoImgiqCKoIugi6CQoJGgkaCSoJKgk6CWoJagl6CXoJigmKCZoJmgmqCcoJygnaCdoJ6gnqChoKKgoqCjoKOgpKCkoKegqKCooK2grqCuoK+gsaCyoLKgs6CzoLWgtqC2oLegt6C4oLiguaC5oLqguqC7oLugvKC8oL6gvqC/oL+gwKDAoMKgw6DDoMSgxKDRoNKg0qAtoS2hOKE4oTmhOaE6oT6hPqE/oUOhRKFEoUihSaFJoUqhSqFQoVChUaFUoVShVaFXoVihWKFZoVmhWqFeoV6hX6FfoWChYKFhoWShZKFloWWhZqFmoWqha6FroWyhbKFtoW2hbqFuoW+hb6FwoXChcaFxoXKhdKF1oXWhdqF2oXehd6F4oXihe6F8oXyhfaF9oX6hfqF/oX+hgKGAoYGhgaGCoYKhg6GDoYShhKGFoYWhhqGGoYehh6GIoYihiaGJoYqhiqGLoYuhj6GQoZChkaGRoZKhkqGVoZahlqGXoZehmKGYoZmhnKGcoZ2hnaGeoZ6hoaGhoaKhoqGjoaOhpqGnoaehqKGooauhrKGsoa2hraGuoa6hsaGyobKhs6GzobWhtqG2obeht6G4obihuaG6obqhu6G7ob6hvqG/ob+hwKHCocOhw6HEocSh0aHSodKhLaEtoTihOKE5oTmhOqE+oT+hSKFJoUmhSqFKoVChUKFRoVGhUqFVoVihWKFZoVmhWqFeoV6hX6FfoWChYKFhoWGhZKFloWWhZqFmoWuha6FsoWyhbaFtoW6hbqFvoW+hcKFwoXGhcaFyoXKhc6F1oXWhdqF2oXehd6F4oXiheaF5oXqheqF7oXuhfKF8oX2hgKGAoYGhg6GDoYShhKGFoYWhhqGGoYehh6GIoYihiaGJoYqhiqGLoYuhjKGMoY6hj6GPoZChkKGRoZGhkqGSoZWhlqGWoZehl6GYoZuhm6GcoZyhnaGdoZ6hoKGgoaGhoaGioaKho6Gmoaehp6GooaihqaGpoauhrKGsoa2hraGwobGhsaGyobKhs6GzobWhtqG2obeht6G4obihuaG6obqhu6G7ob6hvqG/ob+hwKHCocOhw6HEocSh0aHSodKhLaItojiiOKI5ojmiOqI+oj+iSKJJokmiSqJKolCiUKJRolGiUqJVoliiWKJZolmiWqJeol6iX6JfomCiYKJhomGiZKJlomWiZqJmomuia6JsomyibaJtom6ibqJvom+icKJwonGicaJyonKic6J1onWidqJ2oneid6J4oniieaJ5onqieqJ7onuifKJ8on2igKKAooGig6KDooSihKKFooWihqKGooeih6KIooiiiaKJooqiiqKLoouijKKMoo6ij6KPopCikKKRopGikqKSopWilqKWopeil6KYopuim6KcopyinaKdop6ioKKgoqGioaKioqKio6Kmoqeip6KooqiiqaKpoquirKKsoq2iraKworGisaKyorKis6KzorWitqK2oreit6K4oriiuaK6orqiu6K7or6ivqK/or+iwKLCosOiw6LEosSi0aLSotKiLaItojiiOKI5ojmiOqJIokmiSaJKokqiTaJOolGiUaJSolWiWKJYolmiWaJaolyiX6JfomCiYKJhomGiZaJmomaiZ6Jnomuia6JsomyibaJtom6ibqJvonCicKJxonGicqJyonOid6J3oniieKJ5onmieqJ6onuie6J8onyifaKEooSihaKFooaihqKHooeiiqKLoouijKKMoo6ijqKPoo+ikKKQopGikaKUopWilaKWopail6KXopqim6KbopyinKKdoqCioKKhoqGioqKioqOio6Kmoqeip6Kooqiiq6KroqyirKKtoq2isKKxorGisqKyorWitqK2oreit6K5orqiuqK7oruivqK+or+iv6LAosKiw6LDosSixKLRotKi0qItoy2jOKM4ozmjOaM6o0ijSaNJo0qjSqNNo06jUaNRo1KjVaNYo1ijWaNZo1qjXKNfo1+jYKNgo2GjYaNlo2ajZqNno2eja6Nro2yjbKNto22jbqNuo2+jcKNwo3GjcaNyo3Kjc6N3o3ejeKN4o3mjeaN6o3qje6N7o3yjfKN9o4SjhKOFo4WjhqOGo4ejh6OKo4uji6OMo4yjjqOOo4+jj6OQo5CjkaORo5SjlaOVo5ajlqOXo5ejmqObo5ujnKOco52joKOgo6GjoaOio6Kjo6Ojo6ajp6Ono6ijqKOro6ujrKOso62jraOwo7GjsaOyo7KjtaO2o7ajt6O3o7mjuqO6o7uju6O+o76jv6O/o8CjwqPDo8OjxKPEo9Gj0qPSoy2jLaNJo0qjSqNLo0ujTqNRo1GjUqNSo1WjVaNWo1ijWKNZo1mjWqNao1ujW6Nco1yjXaNdo1+jX6Ngo2CjYaNho2KjYqNlo2ajZqNno2ejbKNso22jbaNuo26jb6Nyo3Kjc6Nzo3SjdKN1o3WjeKN5o3mjeqN6o3uje6N8o3yjfaN9o36jfqN/o3+jiqOLo4ujjKOMo42jjaOOo46jj6OPo5CjkKOTo5SjlKOVo5WjlqOWo5mjmqOao5ujm6Oco5+jn6Ogo6CjoaOho6KjoqOjo6ajpqOno6ejqKOoo6ujq6Oso6yjraOto7GjtaO2o7ajt6O3o7mjuqO6o7uju6O8o7yjvaO9o76jvqO/o7+jwKPCo8Ojw6PEo8Sj0aPSo9KjLaQtpESkRaRFpEmkSqRKpEukS6ROpFGkUaRSpFKkVaRVpFakWKRYpFmkWaRapFykXaRdpF+kYKRgpGGkYaRipGKkY6RjpGakZqRnpGekaKRopGmkbKRspG2kbaRupG6kb6RvpHKkcqRzpHOkdKR0pHWkdaR5pHmkeqR6pHuke6R8pHykfaR9pH6kfqR/pH+kgKSLpIykjKSNpI2kjqSOpI+kk6STpJSklKSVpJWklqSWpJikmaSZpJqkmqSbpJuknKSfpJ+kpaSlpKakpqSnpKekqKSrpKukrKSspK2kraSxpLWktqS2pLekt6S5pLqkuqS7pLukvKS8pL2kvaS+pL6kv6S/pMCkwqTDpMOkxKTEpNGk0qTSpC2kLaREpEWkRaRJpEqkSqRLpEukTqRRpFGkUqRSpFWkVaRWpFikWKRZpFmkWqRcpF2kXaRfpGCkYKRhpGGkYqRipGOkY6RmpGakZ6RnpGikaKRppGykbKRtpG2kbqRupG+kb6RypHKkc6RzpHSkdKR1pHWkeaR5pHqkeqR7pHukfKR8pH2kfaR+pH6kf6R/pICki6SMpIykjaSNpI6kjqSPpJOkk6SUpJSklaSVpJaklqSYpJmkmaSapJqkm6SbpJykn6SfpKWkpaSmpKakp6SnpKikq6SrpKykrKStpK2ksaS1pLaktqS3pLekuaS6pLqku6S7pLykvKS9pL2kvqS+pL+kv6TApMKkw6TDpMSkxKTRpNKk0qQtpS2lPqVBpUGlRKVFpUWlRqVGpUqlSqVLpUulTKVOpVGlUaVSpVKlVaVWpVilWKVZpVmlWqVcpV2lXaVepV6lYKVhpWGlYqVipWOlY6VmpWalZ6VnpWilaKVppWmlaqVtpW2lbqVupW+lb6VwpXClcqVypXOlc6V0pXSldaV1pXaldqV6pXqle6V7pXylfKV9pX2lfqV+pX+lf6WApYClgaWBpYKlgqWDpYOlhKWEpYWlhaWGpYalh6WHpYiliKWLpYyljKWNpY2ljqWSpZKlk6WTpZSllKWVpZWlmKWYpZmlmaWapZqlm6WbpZ6ln6WfpaWlpaWmpaalp6WnpailqqWqpaulq6WspaylraWtpa+lsKWwpbGlsaW1pbaltqW3pbeluaW6pbqlu6W9pb2lvqW+pb+lwqXDpcOlxKXEpdGl0qXSpS2lLaU+pUGlQaVEpUWlRaVGpUalSqVKpUulS6VMpU6lUaVRpVKlUqVVpValWKVYpVmlWaVapVylXaVdpV6lXqVgpWGlYaVipWKlY6VjpWalZqVnpWelaKVopWmlaaVqpW2lbaVupW6lb6VvpXClcKVypXKlc6VzpXSldKV1pXWldqV2pXqleqV7pXulfKV8pX2lfaV+pX6lf6V/pYClgKWBpYGlgqWCpYOlg6WEpYSlhaWFpYalhqWHpYeliKWIpYuljKWMpY2ljaWOpZKlkqWTpZOllKWUpZWllaWYpZilmaWZpZqlmqWbpZulnqWfpZ+lpaWlpaalpqWnpaelqKWqpaqlq6WrpaylrKWtpa2lr6WwpbClsaWxpbWltqW2pbelt6W5pbqluqW7pb2lvaW+pb6lv6XCpcOlw6XEpcSl0aXSpdKlLaYtpj2mPaY+pkGmQaZFpkWmRqZGpkqmSqZLpkumTKZOplGmUqZSplWmVqZWplemWaZZplqmXKZdpl2mXqZepmGmYqZipmOmY6ZkpmemZ6ZopmimaaZppmqmaqZtpm6mbqZvpm+mcKZwpnGmcaZypnKmc6ZzpnSmdKZ1pnWmdqZ2pnemd6Z4pnumfKZ8pn2mfaZ+pn6mf6Z/poCmgKaBpoGmgqaCpoOmg6aEpoSmhaaFpoamhqaHpoemiKaIpommiaaKpoqmi6aLpoymjKaNpo2mkaaRppKmkqaTppOmlKaUppWml6aXppimmKaZppmmmqaapp2mnqaepp+mn6agpqCmpKakpqWmpaampqamp6aqpqqmq6arpqymrKatpq+msKawprGmsaa1pramtqa5prqmuqa7pr2mvaa+psOmxKbRptKm0qYtpi2mOaY9pj2mPqZFpkWmRqZGpkumS6ZMplGmUqZSplWmVqZWplemWaZZplqmWqZbpl2mXaZepl6mYaZipmKmY6ZjpmSmaKZopmmmaaZqpmqma6Zrpm6mb6ZvpnCmcKZxpnGmcqZypnOmdqZ2pnemd6Z4pnimeaZ5pnqmeqZ/pn+mgKaApoGmgaaCpoKmg6aDpoSmhKaFpoWmhqaGpoemh6aIpoimiaaJpoqmiqaLpoumjKaMppCmkaaRppKmkqaTppOmlKaXppemmKaYppmmmaaappymnaadpp6mnqafpp+moKagpqOmpKakpqWmpaampqmmqaaqpqqmq6arpqymr6awprCmsaaxprSmtaa1pramtqa5prmmuqa6prumvaa9pr6mvqa/ptGm0qbSpi2nLac5pz2nPac+p0WnRadGp0anS6dLp0ynUadSp1KnVadWp1anV6dZp1mnWqdap1unXaddp16nXqdhp2KnYqdjp2OnZKdop2inaadpp2qnaqdrp2unbqdvp2+ncKdwp3Gncadyp3Knc6d2p3and6d3p3ineKd5p3mneqd6p3+nf6eAp4CngaeBp4KngqeDp4OnhKeEp4WnhaeGp4anh6eHp4iniKeJp4mniqeKp4uni6eMp4ynkKeRp5GnkqeSp5Onk6eUp5enl6eYp5inmaeZp5qnnKedp52nnqeep5+nn6egp6Cno6ekp6Snpaelp6anqaepp6qnqqerp6unrKevp7CnsKexp7GntKe1p7Wntqe2p7mnuae6p7qnu6e9p72nvqe+p7+n0afSp9KnLactpzmnPac9pz6nRadFp0anRqdMp1KnU6dTp1WnVqdWp1enV6dZp1mnWqdap1unXaddp16nXqdfp2KnYqdjp2OnZKdkp2WnaKdop2mnaadqp2qna6drp2ynbKdwp3Cncadxp3Kncqdzp3eneKd4p3mnead6p3qne6eIp4iniaeJp4qniqeLp46nj6ePp5CnkKeRp5GnkqeSp5OnlqeWp5enl6eYp5inmaecp5ynnaedp56nnqefp5+noqejp6OnpKekp6Wnpaemp6mnqaeqp6qnq6evp6+nsKewp7Gnsaeyp7KntKe1p7Wntqe2p7ent6e4p7inuae5p7qnuqe7p72nvae+p76nv6fCp9Gn0qfSpy2oLag5qD2oPag+qEWoRahGqEaoTKhSqFOoU6hVqFaoVqhXqFeoWahZqFqoWqhbqF2oXaheqF6oX6hiqGKoY6hjqGSoZKhlqGioaKhpqGmoaqhqqGuoa6hsqGyocKhwqHGocahyqHKoc6h3qHioeKh5qHmoeqh6qHuoiKiIqImoiaiKqIqoi6iOqI+oj6iQqJCokaiRqJKokqiTqJaolqiXqJeomKiYqJmonKicqJ2onaieqJ6on6ifqKKoo6ijqKSopKilqKWopqipqKmoqqiqqKuor6ivqLCosKixqLGosqiyqLSotai1qLaotqi3qLeouKi4qLmouai6qLqou6i9qL2ovqi+qL+owqjRqNKo0qgtqC2oOKg4qDmoPag9qD6oRahFqEioSahMqEyoTahPqE+oUqhTqFOoVahWqFaoV6hXqFqoWqhbqFuoXKheqF6oX6hfqGCoY6hjqGSoZKhlqGWoaahqqGqoa6hrqGyobKhtqG2obqhxqHGocqhyqHOoc6h0qHioeah5qHqoeqh7qHuofKh8qH2ohKiEqIioiKiJqImoiqiOqI6oj6iPqJCokKiRqJGokqiSqJWolqiWqJeol6iYqJuom6icqJyonaidqJ6onqihqKKooqijqKOopKikqKWopaioqKmoqaiqqKqoq6ivqK+osKixqLKosqizqLOotKi0qLWotai2qLaot6i3qLiouKi5qLmouqi6qLuovai9qL6ovqi/qMGowajCqMKow6jRqNKo0qgtqS2pOKk4qTmpPak9qT6pPqk/qUKpR6lIqUipSalJqUypTKlNqU+pT6lQqVCpUqlTqVOpValWqVapV6lXqVqpWqlbqVupXKleqV6pX6lfqWCpZKlkqWWpZalqqWupa6lsqWypbaltqW6pbqlvqXKpcqlzqXOpdKl0qXmpeal6qXqpe6l7qXypfKl9qX2pfql+qX+pf6mAqYGpgqmCqYOpg6mEqYSphamFqYaphqmHqYepiKmIqYmpjqmOqY+pj6mQqZCpk6mUqZSplamVqZaplqmXqZepmqmbqZupnKmcqZ2pnameqaGpoamiqaKpo6mjqaSppKmlqaWpqKmpqampqqmqqa6prqmvqa+psKmxqbKpsqmzqbOptKm0qbWptam2qbapuKm4qbmpuam6qbqpu6m+qcGpwanCqcKpw6nRqdKp0qktqS2pOKk4qTmpPak9qT6pPqk/qUKpR6lIqUipSalJqUypTKlNqU+pT6lQqVCpUqlTqVOpValWqVapV6lXqVqpWqlbqVupXKleqV6pX6lfqWCpZKlkqWWpZalqqWupa6lsqWypbaltqW6pbqlvqXKpcqlzqXOpdKl0qXmpeal6qXqpe6l7qXypfKl9qX2pfql+qX+pf6mAqYGpgqmCqYOpg6mEqYSphamFqYaphqmHqYepiKmIqYmpjqmOqY+pj6mQqZCpk6mUqZSplamVqZaplqmXqZepmqmbqZupnKmcqZ2pnameqaGpoamiqaKpo6mjqaSppKmlqaWpqKmpqampqqmqqa6prqmvqa+psKmxqbKpsqmzqbOptKm0qbWptam2qbapuKm4qbmpuam6qbqpu6m+qcGpwanCqcKpw6nRqdKp0qktqi2qOKo4qjmqPao9qj6qQqpGqkaqR6pHqkiqSKpJqkmqSqpKqkyqTKpNqk2qTqpQqlCqUqpTqlOqVKpUqlaqV6pXqliqWKpaqluqW6pcqlyqX6pfqmCqYKphqmSqZKplqmWqZqpmqmuqa6psqmyqbaptqm6qbqpvqm+qcqpzqnOqdKp0qnWqdap7qnuqfKp8qn2qfap+qn6qf6p/qoCqgKqBqoGqgqqCqoOqg6qEqoSqhaqFqoaqhqqHqoeqiKqIqo2qjaqOqo6qj6qPqpCqk6qTqpSqlKqVqpWqmqqbqpuqnKqcqp2qoKqgqqGqoaqiqqKqo6qjqqSqpKqnqqiqqKqpqqmqqqqqqq2qrqquqq+qr6qwqrCqsaqxqrKqsqqzqrOqtKq0qrWqtaq2qriquKq5qrmquqq6qruqu6q8qryq0arSqtKqLaotqjiqOKo5qj2qPao+qkKqRqpGqkeqR6pIqkiqSapJqkqqSqpMqkyqTapNqk6qUKpQqlKqU6pTqlSqVKpWqleqV6pYqliqWqpbqluqXKpcql+qX6pgqmCqYapkqmSqZaplqmaqZqprqmuqbKpsqm2qbapuqm6qb6pvqnKqc6pzqnSqdKp1qnWqe6p7qnyqfKp9qn2qfqp+qn+qf6qAqoCqgaqBqoKqgqqDqoOqhKqEqoWqhaqGqoaqh6qHqoiqiKqNqo2qjqqOqo+qj6qQqpOqk6qUqpSqlaqVqpqqm6qbqpyqnKqdqqCqoKqhqqGqoqqiqqOqo6qkqqSqp6qoqqiqqaqpqqqqqqqtqq6qrqqvqq+qsKqwqrGqsaqyqrKqs6qzqrSqtKq1qrWqtqq4qriquaq5qrqquqq7qruqvKq8qtGq0qrSqi2rLas9qz2rPqs+qz+rQqtHq0mrTKtMq02rTatOq1CrUKtTq1OrVKtUq1arV6tXq1irWKtbq1yrXKtdq12rX6tgq2CrYathq2SrZatlq2arZqtnq2erbatuq26rb6tvq3CrcKtzq3SrdKt1q3Wrdqt2q3erfat+q36rf6t/q4CrgKuBq4GrgquCq4Org6uEq4SrhauFq4arhquHq4eriquLq4urjKuMq42rjauOq5Ork6uUq5SrlauVq5qrm6ubq5yroKugq6Groauiq6Kro6ujq6erqKuoq6mrqauqq6qrrKutq62rrquuq6+rsauyq7Krs6uzq7SrtKu1q7Wrtqu4q7iruau5q7qr0avSq9KrLastqz2rPas+qz6rP6tCq0KrQ6tMq02rTatOq1CrUKtRq1OrU6tUq1SrVatXq1irWKtcq12rXateq16rX6tgq2CrYathq2KrYqtkq2WrZatmq2arZ6tnq26rb6tvq3CrcKtxq3Grcqt1q3Wrdqt2q3erd6t4q4GrgquCq4WrhquGq4erh6uIq4iriauJq4qriquLq4urjKuMq42rjauSq5Krk6uTq5SrlKuVq5irmKuZq5mrmquaq5urm6ufq5+roKugq6Groauiq6Kro6unq6irqKupq6mrrKutq62rrquuq6+rsauyq7Krs6uzq7SrtKu1q7Wrtqu2q7ert6u4q7iruau5q7qr0avSq9KrLawtrD2sPaw+rD6sP6xCrEKsQ6xMrE2sTaxOrFCsUKxRrFOsU6xUrFSsVaxXrFisWKxcrF2sXaxerF6sX6xgrGCsYaxhrGKsYqxkrGWsZaxmrGasZ6xnrG6sb6xvrHCscKxxrHGscqx1rHWsdqx2rHesd6x4rIGsgqyCrIWshqyGrIesh6yIrIisiayJrIqsiqyLrIusjKyMrI2sjaySrJKsk6yTrJSslKyVrJismKyZrJmsmqyarJusm6yfrJ+soKygrKGsoayirKKso6ynrKisqKyprKmsrKytrK2srqyurK+ssayyrLKss6yzrLSstKy1rLWstqy2rLest6y4rLisuay5rLqs0azSrNKsLawtrD6sPqw/rEKsQqxDrEOsRKxMrE2sTaxOrFGsVKxUrFWsVaxWrFisWKxZrFmsXaxdrF6sXqxgrGGsYaxirGKsY6xjrGWsZqxmrGesZ6xorGqsa6xrrGysbKxvrHCscKxxrHGscqxyrHOsdqx2rHesd6x4rHiseax5rHqseqx7rIWshqyGrIesh6yIrIisiayJrIqsiqyLrIusjKyMrJGskaySrJKsk6yTrJSsl6yXrJismKyZrJmsmqyarJ6sn6yfrKCsoKyhrKGsoqyirKOspqynrKesqKyorKysraytrK6srqyvrLGss6yzrLSstKy1rLWstqy2rLisuKy5rMCswazBrMKs0azSrNKsLa0trT6tPq0/rUKtQq1DrUOtRK1MrU2tTa1OrVGtVK1UrVWtVa1WrVitWK1ZrVmtXa1drV6tXq1grWGtYa1irWKtY61jrWWtZq1mrWetZ61orWqta61rrWytbK1vrXCtcK1xrXGtcq1yrXOtdq12rXetd614rXitea15rXqteq17rYWthq2GrYeth62IrYitia2JrYqtiq2LrYutjK2MrZGtka2SrZKtk62TrZStl62XrZitmK2ZrZmtmq2arZ6tn62fraCtoK2hraGtoq2iraOtpq2nraetqK2oraytra2tra6trq2vrbGts62zrbSttK21rbWttq22rbituK25rcCtwa3BrcKt0a3SrdKtLa0trT6tPq0/rUKtQq1DrUOtRK1NrU6tTq1RrVGtUq1UrVStVa1VrVatWa1ZrV6tXq1frWGtYq1irWOtY61krWetZ61orWitaa1qrWuta61srWytba1xrXGtcq1yrXOtc610rXStd614rXitea15rXqteq17rXutfK18rX2tfa2FrYWthq2GrYeth62IrYitia2JrYqtiq2LrYutj62QrZCtka2RrZKtkq2WrZatl62XrZitmK2ZrZmtmq2crZ2tna2erZ6tn62fraCtoK2kraStpa2lraatpq2nraetqK2rraytrK2tra2trq2ura+ttK20rbWtta22rbytvK2/rcCtwK3BrcGtwq3CrcOt0a3SrdKtLa4trj6uPq4/rkKuQq5DrkOuRK5Erk2uTq5OrlGuUq5VrlWuVq5ZrlmuWq5erl6uX65frmCuYq5irmOuY65krmSuZa5nrmeuaK5ormmua65rrmyubK5trm2ubq5urm+ucq5yrnOuc650rnSuda51rniuea55rnqueq57rnuufK58rn2ufa5+rn6uf65/roCugK6BroGugq6CroOug66EroSuha6Froauhq6HroeuiK6Iromuia6Kroqui66Lro6uj66PrpCukK6RrpGula6Wrpaul66XrpiunK6crp2una6erp6un66frqOupK6krqWupa6mrqaup66nrqiuq66rrqyurK6trq2urq6urq+utK60rrWuta62rrmuuq66rruuu668rryuv67ArsCuwa7BrsKuwq7DrtGu0q7Sri2uLa4+rj6uP65CrkKuQ65DrkSuRK5Nrk6uTq5RrlKuVa5VrlauWa5ZrlquXq5erl+uX65grmKuYq5jrmOuZK5krmWuZ65nrmiuaK5prmuua65srmyuba5trm6ubq5vrnKucq5zrnOudK50rnWuda54rnmuea56rnque657rnyufK59rn2ufq5+rn+uf66AroCuga6BroKugq6DroOuhK6EroWuha6Groauh66HroiuiK6Jromuiq6Krouui66Oro+uj66QrpCuka6RrpWulq6Wrpeul66YrpyunK6drp2unq6erp+un66jrqSupK6lrqWupq6mrqeup66orquuq66srqyura6trq6urq6vrrSutK61rrWutq65rrquuq67rruuvK68rr+uwK7ArsGuwa7CrsKuw67RrtKu0q4try2vPq8/r0KvQ69Dr0SvRK9Ir0mvSa9Nr06vTq9Pr0+vUa9Sr1WvVa9Wr1qvWq9br16vXq9fr1+vYK9jr2OvZK9kr2WvZa9nr2evaK9or2mvaa9qr2yvbK9tr22vbq9ur2+vb69wr3Cvcq9yr3Ovc690r3Svda91r3avdq95r3mveq96r3uve698r3yvfa99r36vfq9/r3+vgK+Ar4Gvga+Cr4Kvg6+Dr4SvhK+Fr4Wvhq+Gr4evh6+Ir4ivia+Jr4qviq+Lr4uvjK+Mr46vjq+Pr4+vkK+Qr5OvlK+Ur5Wvla+Wr5avl6+Xr5qvm6+br5yvnK+dr6Gvoq+ir6Ovo6+kr6Svpa+lr6avq6+rr6yvrK+tr62vrq+ur7Kvsq+zr7OvtK+0r7Wvta+2r7mvua+6r7qvu6+7r7yvvK+/r8CvwK/Br8Gvwq/Cr8Ov0a/Sr9KvLa8trzuvPq8/rz+vQK9Cr0OvQ69Er0SvRa9Fr0evSK9Ir0mvSa9Nr06vTq9Pr0+vUq9Vr1avVq9Xr1qvWq9br1uvXK9fr1+vYK9gr2GvZK9kr2WvZa9mr2avZ69nr2ivaK9pr2mvaq9qr2yvbK9tr22vbq9ur2+vb69wr3Cvca9xr3KvdK91r3Wvdq92r3eveq96r3uve698r3yvfa99r36vfq9/r3+vgK+Ar4Gvga+Cr4Kvg6+Dr4SvhK+Fr4mviq+Kr4uvi6+Mr4yvja+Nr46vjq+Pr4+vkK+Qr5OvlK+Ur5Wvla+Wr5avma+ar5qvm6+br5yvnK+dr6CvoK+hr6Gvoq+ir6Ovo6+kr6Svpa+lr6avq6+rr6yvrK+tr62vsa+yr7Kvs6+zr7SvtK+1r7ivuK+5r7mvuq+6r7uvu6+/r8CvwK/Br8Gvwq/Rr9Kv0q8tsC2wO7A+sD+wP7BAsEKwQ7BDsESwRLBFsEWwR7BIsEiwSbBJsE2wTrBOsE+wT7BSsFWwVrBWsFewWrBasFuwW7BcsF+wX7BgsGCwYbBksGSwZbBlsGawZrBnsGewaLBosGmwabBqsGqwbLBssG2wbbBusG6wb7BvsHCwcLBxsHGwcrB0sHWwdbB2sHawd7B6sHqwe7B7sHywfLB9sH2wfrB+sH+wf7CAsICwgbCBsIKwgrCDsIOwhLCEsIWwibCKsIqwi7CLsIywjLCNsI2wjrCOsI+wj7CQsJCwk7CUsJSwlbCVsJawlrCZsJqwmrCbsJuwnLCcsJ2woLCgsKGwobCisKKwo7CjsKSwpLClsKWwprCrsKuwrLCssK2wrbCxsLKwsrCzsLOwtLC0sLWwuLC4sLmwubC6sLqwu7C7sL+wwLDAsMGwwbDCsNGw0rDSsC2wLbA6sDuwO7A8sDywPrA/sD+wQLBCsEOwQ7BEsESwRbBFsEewSLBIsEmwSbBKsEqwTbBOsE6wT7BPsFCwULBSsFOwU7BVsFawVrBXsFewWrBbsFuwXLBcsF+wX7BgsGCwYbBhsGSwZbBlsGawZrBnsGewaLBosGmwabBqsGqwa7BrsGywbLBtsG2wbrBusG+wb7BwsHCwcbBxsHKwdLB1sHWwdrB2sHewd7B4sHywfbB9sIOwg7CJsImwirCKsIuwi7CMsIywjbCNsI6wjrCPsJOwk7CUsJSwlbCVsJiwmLCZsJmwmrCasJuwm7CcsJ+wn7CgsKCwobChsKKworCjsKOwpLCksKWwpbCmsLCwsbCxsLKwsrCzsLOwtLC0sLWwuLC4sLmwubC6sLqwu7C+sL+wv7DAsMCwwbDBsMKw0bDSsNKwLbEtsTqxO7E7sTyxPLE+sT+xP7FAsUKxQ7FDsUSxRLFFsUWxR7FIsUixSbFJsUqxSrFNsU6xTrFPsU+xULFQsVKxU7FTsVWxVrFWsVexV7FasVuxW7FcsVyxX7FfsWCxYLFhsWGxZLFlsWWxZrFmsWexZ7FosWixabFpsWqxarFrsWuxbLFssW2xbbFusW6xb7FvsXCxcLFxsXGxcrF0sXWxdbF2sXaxd7F3sXixfLF9sX2xg7GDsYmxibGKsYqxi7GLsYyxjLGNsY2xjrGOsY+xk7GTsZSxlLGVsZWxmLGYsZmxmbGasZqxm7GbsZyxn7GfsaCxoLGhsaGxorGisaOxo7GksaSxpbGlsaaxsLGxsbGxsrGysbOxs7G0sbSxtbG4sbixubG5sbqxurG7sb6xv7G/scCxwLHBscGxwrHRsdKx0rEtsS2xO7E8sTyxP7FAsUCxQ7FEsUSxSLFJsUmxSrFKsUuxS7FNsU6xTrFPsU+xULFQsVOxU7FVsVaxVrFXsVexWLFYsVuxXLFcsV2xXbFfsWCxYLFhsWGxYrFisWexZ7FosWixabFpsWqxarFrsWuxbLFssW2xb7FwsXCxcbFxsXKxcrFzsXOxdLF0sXWxdbF2sXaxd7F8sX2xfbGDsYOxhrGHsYexiLGIsYmxibGKsYqxi7GLsYyxjLGNsY2xkrGSsZOxk7GUsZexl7GYsZixmbGZsZqxmrGbsZuxnLGesZ+xn7GgsaCxobGhsaKxpLGksaWxpbGosamxqbGqsaqxrbGwsbGxsbGysbKxs7GzsbSxtLG1sbext7G4sbixubG5sbqxurG7sb6xv7G/scCxwLHBscGx0bHSsdKxLbItsjuyPLI8sj+yQLJAskWyRbJJskqySrJLskuyT7JPslCyULJRslOyU7JWsleyV7JYsliyWbJZslyyXbJdsl6yXrJgsmGyYbJismKyY7JjsmiyabJpsmqyarJrsmuybLJssm2ybbJusm+ycLJwsnGycbJysnKyc7JzsnSydLJ1snWydrJ2sneyd7J4snuyfLJ8sn2yfbJ+sn6yf7J/soKyg7KDsoSyhLKFsoWyhrKGsoeyh7KIsoiyibKJsoqyirKLsouyjLKMspGykbKSspKyk7KWspayl7KXspiymLKZspmymrKasp2ynrKesp+yn7KgsqCyobKjsqSypLKnsqiyqLKpsqmyq7KssqyyrbKtsrCysbKxsrKysrKzsrOytLK0srWyt7K3sriyuLK5srmyurK6sruyvrK+sr+yv7LAssCywbLBstGy0rLSsi2yLbI7sjyyPLI/skCyQLJFskWySbJKskqyS7JLsk+yT7JQslCyUbJTslOyVrJXsleyWLJYslmyWbJcsl2yXbJesl6yYLJhsmGyYrJismOyY7JosmmyabJqsmqya7JrsmyybLJtsm2ybrJvsnCycLJxsnGycrJysnOyc7J0snSydbJ1snaydrJ3sneyeLJ7snyyfLJ9sn2yfrJ+sn+yf7KCsoOyg7KEsoSyhbKFsoayhrKHsoeyiLKIsomyibKKsoqyi7KLsoyyjLKRspGykrKSspOylrKWspeyl7KYspiymbKZspqymrKdsp6ynrKfsp+yoLKgsqGyo7KksqSyp7KosqiyqbKpsquyrLKssq2yrbKwsrGysbKysrKys7KzsrSytLK1sreyt7K4sriyubK5srqyurK7sr6yvrK/sr+ywLLAssGywbLRstKy0rItsy2zO7M8szyzP7NAs0CzQbNBs0WzRbNGs0azSrNKs0uzS7NMs1CzULNRs1KzU7NTs1ezWLNYs1mzWbNcs12zXbNes16zYbNis2KzY7Njs2SzZLNls2WzarNrs2uzbLNss22zbbNus26zb7Nvs3CzcLNys3Kzc7Nzs3SzdLN1s3WzdrN2s3ezd7N4s3izebN5s3qzerN7s3uzfLN8s32zfbN+s36zf7N/s4CzgLOBs4GzgrOCs4Ozg7OEs4SzhbOFs4azhrOHs4eziLOIs4mzibOKs4+zkLOQs5GzkbOSs5KzlrOWs5ezl7OYs5izmbOcs52znbOes56zn7Ofs6CzoLOis6Ozo7Oks6Szp7Oos6izq7Ors6yzrLOts62zr7Ows7CzsbOxs7KzsrOzs7OztLO3s7ezuLO4s7mzubO6s76zvrO/s7+zwLPAs8GzwbPRs9Kz0rMtsy2zO7M8szyzP7NAs0CzQbNBs0WzRbNGs0azSrNKs0uzS7NMs1CzULNRs1KzU7NTs1ezWLNYs1mzWbNcs12zXbNes16zYbNis2KzY7Njs2SzZLNls2WzarNrs2uzbLNss22zbbNus26zb7Nvs3CzcLNys3Kzc7Nzs3SzdLN1s3WzdrN2s3ezd7N4s3izebN5s3qzerN7s3uzfLN8s32zfbN+s36zf7N/s4CzgLOBs4GzgrOCs4Ozg7OEs4SzhbOFs4azhrOHs4eziLOIs4mzibOKs4+zkLOQs5GzkbOSs5KzlrOWs5ezl7OYs5izmbOcs52znbOes56zn7Ofs6CzoLOis6Ozo7Oks6Szp7Oos6izq7Ors6yzrLOts62zr7Ows7CzsbOxs7KzsrOzs7OztLO3s7ezuLO4s7mzubO6s76zvrO/s7+zwLPAs8GzwbPRs9Kz0rMttC20O7Q8tDy0P7RAtEC0QbRBtEW0RbRGtEa0R7RKtEq0S7RLtEy0UbRRtFK0UrRTtFO0VLRUtFi0WLRZtFm0XbRdtF60XrRftGG0YrRitGO0Y7RktGS0ZbRltGa0ZrRntGe0a7RrtGy0bLRttG20brRutG+0b7RwtHC0dLR1tHW0drR2tHe0d7R4tHi0ebR5tHq0erR7tHu0fLR8tH20fbR+tH60f7R/tIC0gLSBtIG0grSCtIO0g7SEtIS0hbSFtIa0hrSHtIe0jbSNtI60jrSPtI+0kLSQtJG0kbSStJK0lbSWtJa0l7SXtJi0nLSctJ20nbSetJ60n7SftKG0orSitKO0o7SktKS0prSntKe0qLSrtKu0rLSstK20rbSvtLC0sLSxtLG0srSytLO0s7S2tLe0t7S4tLi0ubS5tLq0vbS9tL60vrS/tL+0wLTAtMG0wbTEtMW0xbTRtNK00rQttC20OrQ7tDu0PLQ8tEa0RrRHtEu0S7RMtEy0TbRNtE60UbRStFK0U7RTtFS0VLRVtFm0WbRatFq0W7RbtFy0XrRetF+0YrRitGO0Y7RktGS0ZbRltGa0ZrRntGe0aLRstGy0bbRttG60brRvtG+0cLRwtHG0cbR2tHa0d7R3tHi0eLR5tHm0erR6tHu0e7R8tHy0fbR9tH60frR/tH+0gLSAtIG0gbSCtIK0g7SDtIS0hLSFtIu0jLSMtI20jbSOtI60j7SPtJC0lLSVtJW0lrSWtJe0l7SatJu0m7SctJy0nbSdtJ60nrShtKK0orSjtKO0prSmtKe0p7SotKq0qrSrtKu0rLSstK20r7SvtLC0sLSxtLG0srSytLa0t7S3tLi0uLS5tL60vrS/tL+0wLTAtMW0xbTRtNK00rQttS21OrU7tTu1PLU8tUa1RrVHtUu1S7VMtUy1TbVNtU61UbVStVK1U7VTtVS1VLVVtVm1WbVatVq1W7VbtVy1XrVetV+1YrVitWO1Y7VktWS1ZbVltWa1ZrVntWe1aLVstWy1bbVttW61brVvtW+1cLVwtXG1cbV2tXa1d7V3tXi1eLV5tXm1erV6tXu1e7V8tXy1fbV9tX61frV/tX+1gLWAtYG1gbWCtYK1g7WDtYS1hLWFtYu1jLWMtY21jbWOtY61j7WPtZC1lLWVtZW1lrWWtZe1l7WatZu1m7WctZy1nbWdtZ61nrWhtaK1orWjtaO1prWmtae1p7Wotaq1qrWrtau1rLWsta21r7WvtbC1sLWxtbG1srWytba1t7W3tbi1uLW5tb61vrW/tb+1wLXAtcW1xbXRtdK10rUttS21OrU7tTu1PLU8tT21PbVCtUa1RrVHtUu1S7VMtUy1TbVNtU61TrVStVO1U7VUtVS1VbVVtVa1WrVatVu1W7VctVy1X7VjtWO1ZLVktWW1ZbVmtWa1Z7VntWi1aLVptW61b7VvtXC1cLVxtXG1crVytXO1eLWKtYu1i7WMtYy1jbWNtY61jrWPtZO1k7WUtZS1lbWVtZm1mrWatZu1m7WctZy1nbWdtZ61obWhtaK1orWjtaW1pbWmtaa1p7Wptam1qrWqtau1q7Wstay1rbWtta61rrWvta+1sLWwtbG1tbW2tba1t7W3tbi1uLW5tb61vrW/tb+1wLXRtdK10rUtti22OrY7tju2PLY8tj22PbZCtka2RrZHtku2S7ZMtky2TbZNtk62TrZStlO2U7ZUtlS2VbZVtla2WrZatlu2W7Zctly2X7ZjtmO2ZLZktmW2ZbZmtma2Z7Zntmi2aLZptm62b7ZvtnC2cLZxtnG2crZytnO2eLaKtou2i7aMtoy2jbaNto62jraPtpO2k7aUtpS2lbaVtpm2mraatpu2m7actpy2nbadtp62obahtqK2orajtqW2pbamtqa2p7aptqm2qraqtqu2q7astqy2rbattq62rravtq+2sLawtrG2tba2tra2t7a3tri2uLa5tr62vra/tr+2wLbRttK20rYtti22ObY6tjq2O7Y7tjy2PLZAtkG2QbZCtkK2Q7ZHtke2SLZMtky2TbZNtk62TrZPtk+2U7ZTtlS2VLZVtlW2VrZWtle2XLZdtl22XrZetl+2X7ZgtmC2YbZltma2ZrZntme2aLZotmm2abZqtmq2cbZxtnK2crZztnO2dLZ0tom2ibaKtoq2i7aLtoy2jLaNto22kraStpO2k7aUtpS2lbaZtpq2mrabtpu2nLagtqC2obahtqK2pLaktqW2pbamtqm2qbaqtqq2q7attq62rravtq+2sLa1tra2tra3tre2uLa4trm2vra+tr+2v7bAttG20rbSti23LbdBt0G3QrdCt0O3Q7dEt0e3SLdIt0m3TLdNt023TrdOt0+3T7dTt1O3VLdUt1W3VbdWt1a3V7dXt1y3Xbddt163Xrdft1+3YLdgt2G3Ybdit2K3Z7dnt2i3aLdpt2m3ardqt2u3a7dst2y3crdyt3O3c7d0t3S3dbd1t4W3hbeGt4a3h7eHt4i3iLeJt4m3ireKt4u3i7eTt5O3lLeYt5m3mbeat5q3m7ebt5y3n7eft6C3oLeht6G3orekt6S3pbelt6a3qLest623rbeut663r7e1t7a3tre3t7e3uLe4t7m3vbe9t763vre/t7+3wLfRt9K30rctty23QbdBt0K3QrdDt0O3RLdHt0i3SLdJt0y3TbdNt063TrdPt0+3U7dTt1S3VLdVt1W3VrdWt1e3V7dct123Xbdet163X7dft2C3YLdht2G3Yrdit2e3Z7dot2i3abdpt2q3ardrt2u3bLdst3K3crdzt3O3dLd0t3W3dbeFt4W3hreGt4e3h7eIt4i3ibeJt4q3ireLt4u3k7eTt5S3mLeZt5m3mreat5u3m7ect5+3n7egt6C3obeht6K3pLekt6W3pbemt6i3rLett623rreut6+3tbe2t7a3t7e3t7i3uLe5t723vbe+t763v7e/t8C30bfSt9K3LbgtuEK4QrhDuEO4RLhEuEe4SLhIuEm4SbhKuEq4TrhPuE+4ULhQuFG4VbhVuFa4VrhXuFe4XbhduF64XrhfuF+4YLhguGG4YbhiuGK4abhquGq4a7hruGy4bLhtuHK4c7hzuHS4dLh1uHW4drh2uHe4d7h4uHi4ebh5uHq4erh7uHu4fLh8uH24fbh+uH64f7h/uIC4gLiBuIG4griDuIO4hLiEuIW4hbiGuIa4h7iHuI64j7iPuJC4lriWuJe4l7iYuJi4mbiZuJq4mribuJu4n7ifuKC4oLihuKS4pLiluKW4primuKe4p7iouKi4q7isuKy4rbituK64rri0uLW4tbi2uLa4t7i3uLi4uLi8uLy4vbi9uL64vri/uMK4wrjDuNG40rjSuC24LbhCuEK4Q7hDuES4RLhHuEi4SLhJuEm4SrhKuE64T7hPuFC4ULhRuFW4VbhWuFa4V7hXuF24XbheuF64X7hfuGC4YLhhuGG4YrhiuGm4arhquGu4a7hsuGy4bbhyuHO4c7h0uHS4dbh1uHa4drh3uHe4eLh4uHm4ebh6uHq4e7h7uHy4fLh9uH24frh+uH+4f7iAuIC4gbiBuIK4g7iDuIS4hLiFuIW4hriGuIe4h7iOuI+4j7iQuJa4lriXuJe4mLiYuJm4mbiauJq4m7ibuJ+4n7iguKC4obikuKS4pbiluKa4prinuKe4qLiouKu4rLisuK24rbiuuK64tLi1uLW4tri2uLe4t7i4uLi4vLi8uL24vbi+uL64v7jCuMK4w7jRuNK40rgtuS25QrlEuUW5RblIuUm5SblKuUq5S7lLuU+5T7lQuVC5UblRuVK5VblWuVa5V7lXuVi5WLlZuVm5X7lfuWC5YLlhuWG5YrliuWO5Y7lkuWS5ZblruWu5bLlsuW25bbluuW65b7l1uXW5d7l3uXi5eLl5uXm5erl6uXu5fLl9uX25frl+uX+5f7mAuYC5gbmBuYK5grmDuYO5hLmEuYW5hbmGuYa5h7mHuY25jbmOuY65j7mPuZC5kLmVuZa5lrmXuZe5mLmYuZm5mbmauZ65n7mfuaC5oLmmuaa5p7mnuai5qLmruay5rLmtua25rrmuubC5sbmxubK5srm0ubW5tbm2uba5t7m3ubi5uLm7uby5vLm+ub+5wrnCucO5w7nEudG50rnSuS25LblFuUW5SblKuUq5S7lLuVC5ULlRuVG5UrlSuVO5U7lXuVi5WLlZuVm5WrlauVu5W7lcuWC5YblhuWK5YrljuWO5ZLlkuWW5ZblmuWa5bLlsuW25bbluuW65b7lvuXC5cLlxuXG5fLl9uX25frl+uX+5f7mAuYC5gbmBuYK5grmEuYS5hbmFuYa5hrmHuYy5jLmNuY25jrmOuY+5j7mQuZC5lLmVuZW5lrmWuZe5l7mcuZ25nbmeuZ65n7mfuaC5oLmluaW5prmmuae5p7mouau5q7msuay5rbmtua+5sLmwubG5sbm0ubW5tbm2uba5t7m3ubi5uLm7uby5vLm+ub65v7nCucK5w7nDucS50bnSudK5LbotukW6RbpJukq6SrpLuku6ULpQulG6UbpSulK6U7pTule6WLpYulm6Wbpaulq6W7pbuly6YLphumG6YrpiumO6Y7pkumS6Zbpluma6Zrpsumy6bbptum66brpvum+6cLpwunG6cbp8un26fbp+un66f7p/uoC6gLqBuoG6grqCuoS6hLqFuoW6hrqGuoe6jLqMuo26jbqOuo66j7qPupC6kLqUupW6lbqWupa6l7qXupy6nbqdup66nrqfup+6oLqguqW6pbqmuqa6p7qnuqi6q7qruqy6rLqtuq26r7qwurC6sbqxurS6tbq1ura6trq3ure6uLq4uru6vLq8ur66vrq/usK6wrrDusO6xLrRutK60rotui26SrpKuku6S7pMulC6ULpRulG6UrpSulO6U7pUulS6WLpYulm6Wbpaulq6W7pbuly6XLpdul26YrpiumO6Y7pkumS6Zbpluma6Zrpnume6bbpuum66b7pvunC6cLpxunG6crpyunO6c7p0unS6ibqJuoq6irqLuou6jLqMuo26jbqOuo66j7qPupC6k7qUupS6lbqVupa6lrqXupe6nLqcup26nbqeup66n7qfuqS6pLqluqW6prqmuqe6q7qruqy6rLqtuq+6r7qwurC6sbqxurS6tLq1urW6trq2ure6t7q4uri6ubq5urq6urq7uru6vLq8ur26vbq+usK6wrrDutG60rrSui27LbtKu0q7S7tLu0y7ULtQu1G7UbtSu1K7U7tTu1S7VLtYu1i7WbtZu1q7Wrtbu1u7XLtcu127Xbtiu2K7Y7tju2S7ZLtlu2W7Zrtmu2e7Z7ttu267brtvu2+7cLtwu3G7cbtyu3K7c7tzu3S7dLuJu4m7iruKu4u7i7uMu4y7jbuNu467jruPu4+7kLuTu5S7lLuVu5W7lruWu5e7l7ucu5y7nbudu567nrufu5+7pLuku6W7pbumu6a7p7uru6u7rLusu627r7uvu7C7sLuxu7G7tLu0u7W7tbu2u7a7t7u3u7i7uLu5u7m7uru6u7u7u7u8u7y7vbu9u767wrvCu8O70bvSu9K7Lbstuz67Prs/u0u7S7tMu0y7TbtNu067UbtSu1K7U7tTu1S7VLtZu1m7Wrtau1u7W7tcu1y7Xbtdu167Xrtku2W7Zbtmu2a7Z7tnu2i7aLtpu3C7cLtxu3G7crtyu3O7c7t0u3S7dbt1u3a7druJu4m7iruKu4u7i7uTu5O7lLuUu5W7lbuWu5a7l7uXu5q7m7ubu5y7nLudu527nrueu6O7pLuku6W7pbumu6a7p7uqu6q7q7uru6y7rruuu6+7r7uwu7C7sbuzu7O7tLu0u7W7tbu2u7a7t7u3u7m7ubu6u7q7u7u7u7y7vLu9u727vrvCu8K7w7vRu9K70rstvC28Prw+vD+8P7xAvEC8QbxBvEK8QrxDvEO8RLxEvEu8S7xMvEy8TbxNvE68TrxTvFO8VLxUvFW8VbxWvFq8WrxbvFu8XLxcvF28XbxevF68X7xlvGa8ZrxnvGe8aLxovGm8abxqvHK8crxzvHO8dLx0vHW8dbx2vHa8d7x3vHi8eLx5vHm8erx6vHu8e7x8vIW8hbyGvIa8h7yHvIi8iLyJvIm8iryKvIu8kbyRvJK8kryTvJO8lLyUvJW8lbyZvJq8mrybvJu8nLycvJ28nbyevKG8oryivKO8o7ykvKS8pbylvKm8qbyqvKq8q7ytvK68rryvvK+8sLywvLG8sryyvLO8s7y0vLS8tby1vLa8try5vLq8ury7vLu8vLy8vL28vbzCvMK8w7zRvNK80rwtvC28Prw+vD+8P7xAvEC8QbxBvEK8QrxDvEO8RLxEvEu8S7xMvEy8TbxNvE68TrxTvFO8VLxUvFW8VbxWvFq8WrxbvFu8XLxcvF28XbxevF68X7xlvGa8ZrxnvGe8aLxovGm8abxqvHK8crxzvHO8dLx0vHW8dbx2vHa8d7x3vHi8eLx5vHm8erx6vHu8e7x8vIW8hbyGvIa8h7yHvIi8iLyJvIm8iryKvIu8kbyRvJK8kryTvJO8lLyUvJW8lbyZvJq8mrybvJu8nLycvJ28nbyevKG8oryivKO8o7ykvKS8pbylvKm8qbyqvKq8q7ytvK68rryvvK+8sLywvLG8sryyvLO8s7y0vLS8tby1vLa8try5vLq8ury7vLu8vLy8vL28vbzCvMK8w7zRvNK80rwtvS29P71AvUC9Qb1BvUK9Qr1DvUO9RL1EvUW9Rb1GvUa9R71MvU29Tb1OvU69T71PvVC9UL1UvVS9Vb1VvVa9Vr1XvVu9XL1cvV29Xb1evV69X71fvWC9YL1hvWG9Zb1mvWa9Z71nvWi9aL1pvWm9ar1qvXO9dL10vXW9db12vXa9d713vXi9eL15vXm9er16vXu9e718vXy9fb19vX69fr1/vX+9gL2AvYG9gb2CvYK9g72DvYS9hL2FvYW9hr2GvYe9h72IvYi9ib2JvYq9kb2RvZK9kr2TvZO9lL2UvZW9mL2ZvZm9mr2avZu9m72cvZy9nb2hvaG9or2ivaO9o72kvaS9p72ovai9qb2pvaq9qr2sva29rb2uva69r72vvbC9sr2yvbO9s720vbS9tb21vba9tr25vbm9ur26vbu9u728vby9vb29vdG90r3SvS29Lb0/vUC9QL1BvUG9Qr1CvUO9Q71EvUS9Rb1FvUa9Rr1HvUy9Tb1NvU69Tr1PvU+9UL1QvVS9VL1VvVW9Vr1WvVe9W71cvVy9Xb1dvV69Xr1fvV+9YL1gvWG9Yb1lvWa9Zr1nvWe9aL1ovWm9ab1qvWq9c710vXS9db11vXa9dr13vXe9eL14vXm9eb16vXq9e717vXy9fL19vX29fr1+vX+9f72AvYC9gb2BvYK9gr2DvYO9hL2EvYW9hb2GvYa9h72HvYi9iL2JvYm9ir2RvZG9kr2SvZO9k72UvZS9lb2YvZm9mb2avZq9m72bvZy9nL2dvaG9ob2ivaK9o72jvaS9pL2nvai9qL2pvam9qr2qvay9rb2tva69rr2vva+9sL2yvbK9s72zvbS9tL21vbW9tr22vbm9ub26vbq9u727vby9vL29vb290b3SvdK9Lb4tvkG+Qb5CvkK+Q75DvkS+RL5Gvka+R75Hvki+Tr5Pvk++UL5QvlG+Vb5Wvla+V75Xvl2+Xb5evl6+X75fvmC+YL5hvmG+Yr5ivmi+ab5pvmq+ar5rvmu+bb5uvm6+b75vvnG+cb51vnW+dr52vne+d754vni+eb55vnq+er57vnu+fL58vn2+fb5+vn6+f75/voC+gL6BvoG+gr6CvoO+g76EvoS+hb6Fvoa+hr6Hvoe+jr6Ovo++kL6RvpG+kr6SvpO+lr6Wvpe+l76Yvpi+mb6Zvpq+mr6bvpu+oL6gvqG+ob6ivqK+o76jvqa+p76nvqi+qL6rvqy+rL6tvq2+rr6uvrG+sr6yvrO+s760vrS+tb61vra+tr64vri+ub65vrq+ur67vru+vL68vr2+vb6/vsC+wL7BvsG+0b7SvtK+Lb4tvkK+Q75DvkS+R75Hvki+SL5Jvkm+Sr5KvlC+UL5RvlG+Ur5Wvle+V75Yvli+Xr5evl++X75gvmC+Yb5hvmK+Yr5jvmO+ab5qvmq+a75rvmy+bL5tvm2+br5uvm++b75wvnC+cb5xvnK+eL55vnm+er56vnu+e758vny+fb59vn6+fr5/vn++gL6AvoG+gb6CvoK+hb6Fvoa+ir6Lvou+jL6Mvo2+jb6Ovo6+j76PvpC+kL6RvpG+lL6VvpW+lr6Wvpe+l76Yvpi+mb6Zvpq+nr6fvp++oL6gvqG+ob6ivqK+o76mvqa+p76nvqi+qL6rvqy+rL6tvq2+sL6xvrG+sr6yvrO+s760vrS+tb63vre+uL64vrm+ub66vrq+u767vry+vL69vr2+v77AvsC+wb7BvsK+0b7SvtK+Lb8tv0K/Q79Dv0S/R79Hv0i/SL9Jv0m/Sr9Kv1C/UL9Rv1G/Ur9Wv1e/V79Yv1i/Xr9ev1+/X79gv2C/Yb9hv2K/Yr9jv2O/ab9qv2q/a79rv2y/bL9tv22/br9uv2+/b79wv3C/cb9xv3K/eL95v3m/er96v3u/e798v3y/fb99v36/fr9/v3+/gL+Av4G/gb+Cv4K/hb+Fv4a/ir+Lv4u/jL+Mv42/jb+Ov46/j7+Pv5C/kL+Rv5G/lL+Vv5W/lr+Wv5e/l7+Yv5i/mb+Zv5q/nr+fv5+/oL+gv6G/ob+iv6K/o7+mv6a/p7+nv6i/qL+rv6y/rL+tv62/sL+xv7G/sr+yv7O/s7+0v7S/tb+3v7e/uL+4v7m/ub+6v7q/u7+7v7y/vL+9v72/v7/Av8C/wb/Bv8K/0b/Sv9K/Lb8tv0i/Sb9Jv0q/Sr9Lv0u/Ub9Sv1K/WL9Yv1m/Wb9av1q/W79gv2G/Yb9iv2K/Y79jv2S/bb9uv26/b79vv3C/cL9xv3G/cr9yv3O/c790v3q/er97v3u/fL98v32/fb+Fv4a/hr+Hv4m/ir+Kv4u/i7+Mv4y/jb+Nv46/jr+Pv4+/kL+Uv5W/lb+Wv5a/l7+Xv5i/mL+Zv52/nr+ev5+/n7+gv6C/ob+hv6K/pr+mv6e/p7+ov6u/q7+sv6y/rb+vv7C/sL+xv7G/sr+yv7O/s7+0v7e/t7+4v7i/ub+5v7q/ur+7v7u/vL+8v7+/wL/Av8G/wb/Cv9G/0r/Svy3ALcBIwEnAScBKwErAS8BLwFHAUsBSwFjAWMBZwFnAWsBawFvAYMBhwGHAYsBiwGPAY8BkwG3AbsBuwG/Ab8BwwHDAccBxwHLAcsBzwHPAdMB6wHrAe8B7wHzAfMB9wH3AhcCGwIbAh8CJwIrAisCLwIvAjMCMwI3AjcCOwI7Aj8CPwJDAlMCVwJXAlsCWwJfAl8CYwJjAmcCdwJ7AnsCfwJ/AoMCgwKHAocCiwKbApsCnwKfAqMCrwKvArMCswK3Ar8CwwLDAscCxwLLAssCzwLPAtMC3wLfAuMC4wLnAucC6wLrAu8C7wLzAvMC/wMDAwMDBwMHAwsDRwNLA0sAtwC3ASMBJwEnASsBKwEvAS8BMwFLAU8BTwFjAWMBZwFnAWsBawFvAW8BcwFzAYcBiwGLAY8BjwGTAZMBlwGXAZsBmwGfAZ8BowGjAacBuwG/Ab8BwwHDAccBxwHLAcsBzwHPAdMB0wHrAesB7wIXAhcCGwIbAh8CHwInAisCKwIvAi8CMwIzAk8CUwJTAlcCVwJbAlsCXwJfAmMCcwJzAncCdwJ7AnsCfwJ/AoMCgwKTApMClwKXApsCmwKfAp8CowKrAqsCrwKvArMCswK3Ar8CvwLDAsMCxwLHAssCywLfAt8C4wLjAucC5wLrAusC7wLvAv8DAwMDAwcDBwNHA0sDSwC3BLcFKwUrBS8FLwUzBVMFUwVnBWcFawVrBW8FbwVzBXMFdwV3BY8FjwWTBZMFlwWbBZsFnwWfBaMFowWnBacFqwWrBcMFwwXHBccFywXLBc8FzwXTBdMF3wXfBeMF6wXrBe8F7wXzBfMF9wX3BfsF+wX/Bf8GAwYHBgcGCwYLBg8GDwYTBhMGFwYXBhsGGwYfBh8GIwYjBicGJwYrBisGLwYvBkcGRwZLBksGTwZPBlMGUwZXBlcGWwZbBm8GbwZzBnMGdwZ3BnsGewZ/Bn8GjwaTBpMGmwafBqMGowanBqcGqwarBq8GrwazBr8GvwbDBsMGxwbHBssGywbbBt8G3wbjBuMG5wbnBusG6wbvBu8G+wb/Bv8HAwcDBwcHBwdHB0sHSwS3BLcFKwUrBS8FLwUzBVMFUwVnBWcFawVrBW8FbwVzBXMFdwV3BY8FjwWTBZMFlwWbBZsFnwWfBaMFowWnBacFqwWrBcMFwwXHBccFywXLBc8FzwXTBdMF3wXfBeMF6wXrBe8F7wXzBfMF9wX3BfsF+wX/Bf8GAwYHBgcGCwYLBg8GDwYTBhMGFwYXBhsGGwYfBh8GIwYjBicGJwYrBisGLwYvBkcGRwZLBksGTwZPBlMGUwZXBlcGWwZbBm8GbwZzBnMGdwZ3BnsGewZ/Bn8GjwaTBpMGmwafBqMGowanBqcGqwarBq8GrwazBr8GvwbDBsMGxwbHBssGywbbBt8G3wbjBuMG5wbnBusG6wbvBu8G+wb/Bv8HAwcDBwcHBwdHB0sHSwS3CLcI9wj3CPsI+wj/CP8JAwkDCTsJPwk/CWsJbwlvCXMJcwl/CX8JgwmbCZsJnwmfCaMJowmnCacJqwmrCa8JrwmzCbMJ3wnjCeMJ5wnnCesJ6wnvCe8J8wnzCfcJ9wn7CfsJ/wn/CgMKAwoHCgcKCwoLCg8KDwoTChMKFwoXChsKGwofCh8KIwojCicKPwpDCkMKRwpHCksKSwpPCk8KUwpTClcKawpvCm8KcwpzCncKdwp7CnsKiwqPCo8KnwqjCqMKpwqnCqsKqwq/Cr8KwwrDCscKxwrLCssK2wrfCt8K4wrjCucK5wrrCusK7wr7Cv8K/wsDCwMLBwsHC0cLSwtLCLcItwj3CPcI+wj7CP8I/wkDCQMJCwkPCQ8JEwkTCRcJFwkbCRsJHwk7CT8JPwlDCUMJRwlHCUsJbwlzCXMJfwl/CYMJgwmHCZsJmwmfCZ8JowmjCacJpwmrCasJrwmvCbMJswm3CbcJuwm7Cb8JvwnDCcMJ4wnnCecJ6wnrCe8J7wnzCfMJ9wn3CfsJ+wn/Cf8KAwoDCgcKBwoLCgsKDwoPChMKEwoXChcKGwobCh8KOwo7Cj8KPwpDCkMKRwpHCksKSwpPCmMKZwpnCmsKawpvCm8KcwpzCncKdwp7CocKiwqLCo8KjwqbCp8KnwqjCqMKpwqnCrsKuwrbCt8K3wrjCuMK5wrnCusK+wr7Cv8K/wsDCwMLBwsHC0cLSwtLCLcMtwz3DPcM+wz7DP8M/w0DDQMNCw0PDQ8NEw0TDRcNFw0bDRsNHw07DT8NPw1DDUMNRw1HDUsNbw1zDXMNfw1/DYMNgw2HDZsNmw2fDZ8Now2jDacNpw2rDasNrw2vDbMNsw23DbcNuw27Db8Nvw3DDcMN4w3nDecN6w3rDe8N7w3zDfMN9w33DfsN+w3/Df8OAw4DDgcOBw4LDgsODw4PDhMOEw4XDhcOGw4bDh8OOw47Dj8OPw5DDkMORw5HDksOSw5PDmMOZw5nDmsOaw5vDm8Ocw5zDncOdw57DocOiw6LDo8Ojw6bDp8Onw6jDqMOpw6nDrsOuw7bDt8O3w7jDuMO5w7nDusO+w77Dv8O/w8DDwMPBw8HD0cPSw9LDLcMtwz7DPsM/w0LDQ8NDw0TDRMNFw0XDRsNGw0fDR8NIw1DDUMNRw1HDUsNSw1PDU8NUw1TDX8Nfw2DDYMNhw2fDZ8Now2jDacNpw2rDasNrw2vDbMNsw23DbcNuw27Db8Nvw3DDcMNxw3HDcsNyw3PDc8N0w3TDdcN1w3bDdsN3w3fDeMN4w3vDe8N8w3zDfcN9w37DfsN/w3/DgMOAw4HDi8OMw4zDjsOPw4/DkMOQw5HDkcOXw5fDmMOYw5nDmcOaw5rDm8Obw5zDocOhw6LDosOjw6PDpsOnw6fDqMOow6nDqcOsw63DrcOuw67Dr8O2w7fDt8O4w7jDucO5w7rD0cPSw9LDLcQtxD7EPsQ/xELEQ8RDxETERMRFxEXERsRGxEfER8RIxFDEUMRRxFHEUsRSxFPEU8RUxFTEX8RfxGDEYMRhxGfEZ8RoxGjEacRpxGrEasRrxGvEbMRsxG3EbcRuxG7Eb8RvxHDEcMRxxHHEcsRyxHPEc8R0xHTEdcR1xHbEdsR3xHfEeMR4xHvEe8R8xHzEfcR9xH7EfsR/xH/EgMSAxIHEi8SMxIzEjsSPxI/EkMSQxJHEkcSXxJfEmMSYxJnEmcSaxJrEm8SbxJzEocShxKLEosSjxKPEpsSnxKfEqMSoxKnEqcSsxK3ErcSuxK7Er8S2xLfEt8S4xLjEucS5xLrE0cTSxNLELcQtxETERcRFxEbERsRHxEfESMRRxFLEUsRTxFPEVMRUxFXEVcRWxFbEV8RXxF/EYMRgxGHEaMRoxGnEacRqxGrEa8RrxGzEbMRtxG3EbsRuxG/Eb8RwxHDEccRxxHLEcsRzxHPEdMR0xHXEdcR2xHbEd8R3xHjEeMR5xHnEicSJxIrEisSLxIvEjMSMxI7Ej8SVxJbElsSXxJfEmMSYxJnEmcSaxJrEocShxKLEosSjxKbEpsSnxKfEqMSoxKvErMSsxK3ErcSuxK7Er8S0xLTEtcS1xLbEtsS3xLfEuMS4xNHE0sTSxC3FLcVGxUbFR8VHxUjFSMVJxVPFU8VUxVTFVsVXxVfFWMVYxVnFWcVgxWHFYcVtxW7FbsVvxW/FcMVwxXHFccVyxXLFc8VzxXTFdMV1xXXFdsV2xXfFd8V4xXjFecV5xYnFicWKxYrFi8WLxYzFjMWUxZXFlcWWxZbFocWhxaLFpsWmxafFq8WrxazFrMWtxa3FrsWuxbPFs8W0xbTFtcW1xbbFtsW3xbfFvMW8xb3FvcW+xdHF0sXSxS3FLcVGxUbFR8VHxUjFSMVJxVPFU8VUxVTFVsVXxVfFWMVYxVnFWcVgxWHFYcVtxW7FbsVvxW/FcMVwxXHFccVyxXLFc8VzxXTFdMV1xXXFdsV2xXfFd8V4xXjFecV5xYnFicWKxYrFi8WLxYzFjMWUxZXFlcWWxZbFocWhxaLFpsWmxafFq8WrxazFrMWtxa3FrsWuxbPFs8W0xbTFtcW1xbbFtsW3xbfFvMW8xb3FvcW+xdHF0sXSxS3GLcZJxkrGSsZLxkvGTMZMxk3GV8ZYxljGYMZhxmHGYsZixmPGY8ZkxmXGZcZvxnDGcMZxxnHGcsZyxnPGc8Z0xnTGdcZ1xnfGd8Z4xnjGgMaBxoXGhcaGxobGh8aJxonGisaKxovGk8aTxpTGlMaVxpXGlsaWxpzGncadxp7Gnsafxp/GoMagxqHGpcalxqbGpsanxqvGq8asxqzGrcazxrPGtMa0xrXGtca2xrbGvMa8xr3Gvca+xr7Gv8bRxtLG0sYtxi3GScZKxkrGS8ZLxkzGTMZNxlfGWMZYxmDGYcZhxmLGYsZjxmPGZMZlxmXGb8ZwxnDGccZxxnLGcsZzxnPGdMZ0xnXGdcZ3xnfGeMZ4xoDGgcaFxoXGhsaGxofGicaJxorGisaLxpPGk8aUxpTGlcaVxpbGlsacxp3Gncaexp7Gn8afxqDGoMahxqXGpcamxqbGp8arxqvGrMasxq3Gs8azxrTGtMa1xrXGtsa2xrzGvMa9xr3Gvsa+xr/G0cbSxtLGLcctx0rHSsdLx0vHTMdMx03HTcdOx07HT8dPx1DHUMdRx1HHUsdXx1rHWsdbx1vHXMdcx13HXcdgx2HHYcdix2LHY8djx2THZMdlx2XHf8d/x4DHgMeBx4HHgseCx4PHg8eEx4THhceFx4bHj8eQx5DHk8eTx5THlMeVx5XHm8ebx5zHnMedx53Hnseex5/Hn8egx6DHpcelx6bHpsenx6vHq8esx6zHrcezx7PHtMe0x7XHtce2x7bHt8e3x7jHuMe7x7zHvMe9x73Hvse+x7/H0cfSx9LHLcctx0vHS8dMx0zHTcdNx07HTsdPx0/HUMdQx1HHUcdSx1LHWsdax1vHW8dcx1zHXcddx2DHYcdhx2LHYsdjx2PHZMdkx2XHZcdmx2bHacdqx3nHecd6x3rHe8d7x3zHfMd9x33Hfsd+x3/Hf8eAx4DHgceBx4LHgseDx4PHhMeEx4XHhceGx47Hj8ePx5DHkMeTx5THmceax5rHm8ebx5zHnMedx53Hnsejx6THpMelx6XHpseox6nHqceqx6rHq8erx6zHr8ewx7DHscexx7PHs8e0x7THtce4x7jHuce8x7zHvce9x77H0cfSx9LHLcgtyEvIS8hMyEzITchNyE7ITshPyE/IUMhQyFHIUchSyFLIWshayFvIW8hcyFzIXchdyGDIYchhyGLIYshjyGPIZMhkyGXIZchmyGbIachqyHnIech6yHrIe8h7yHzIfMh9yH3Ifsh+yH/If8iAyIDIgciByILIgsiDyIPIhMiEyIXIhciGyI7Ij8iPyJDIkMiTyJTImciayJrIm8ibyJzInMidyJ3InsijyKTIpMilyKXIpsioyKnIqciqyKrIq8iryKzIr8iwyLDIscixyLPIs8i0yLTItci4yLjIuci8yLzIvci9yL7I0cjSyNLILcgtyE7IT8hPyFDIUMhRyFHIUshSyFPIU8hUyFTIYshiyGPIY8hkyGTIZchlyGbIZshpyGrIashryGvIbMhsyG3IbchuyG7Ib8hvyHDIcMh5yHnIesh6yHvIe8h8yHzIfch9yH7Ifsh/yH/IgMiAyIHIgciCyInIisiKyIvIi8iMyIzIjciNyI7IjsiPyI/IkMiYyJjImciZyJrImsicyJ3IosijyKPIpMikyKXIpcimyKjIqcipyKrIqsivyK/IsMiwyLHIsciyyLLIs8izyLTIuci5yLrI0cjSyNLILcktyU7JT8lPyVDJUMlRyVHJUslSyVPJU8lUyVTJYsliyWPJY8lkyWTJZcllyWbJZslpyWrJaslryWvJbMlsyW3JbcluyW7Jb8lvyXDJcMl5yXnJesl6yXvJe8l8yXzJfcl9yX7Jfsl/yX/JgMmAyYHJgcmCyYnJismKyYvJi8mMyYzJjcmNyY7JjsmPyY/JkMmYyZjJmcmZyZrJmsmcyZ3JosmjyaPJpMmkyaXJpcmmyajJqcmpyarJqsmvya/JsMmwybHJscmyybLJs8mzybTJucm5ybrJ0cnSydLJLcktyVDJUMlRyVHJUslSyVPJU8lUyVTJVclVyVbJZMllyWXJaclqyWrJa8lryW3JbsluyW/Jb8lwyXDJcclxyXLJcslzyXPJdMl0yXXJdcl2yXbJd8l3yXjJecl5yXrJesl7yX7JfsmJyYnJismKyYvJi8mMyYzJjcmNyY7JjsmPyZfJl8mYyZjJmcmZyZrJmsmhyaHJosmiyaPJo8mkyaTJpcmlya/Jr8mwybDJscmxybLJssmzybPJucm5ybrJ0cnSydLJLcotykbKRspHykfKSMpIyknKScpKykrKVcpVylbKVspXylfKasptym7Kbspvym/KcMpwynHKccpyynLKc8pzynTKdMp1ynXKdsp2ynfKd8p4ynjKecp5yobKh8qHyojKiMqJyonKisqKyovKi8qUypXKlcqWypbKl8qXypjKmMqZypnKmsqgyqDKocqhyqLKosqjyqPKrMqtyq3Krsquyq/Kr8qwyrDKscqxyrLKssq4yrjKucq5yrrK0crSytLKLcotykbKRspHykfKSMpIyknKScpKykrKVcpVylbKVspXylfKasptym7Kbspvym/KcMpwynHKccpyynLKc8pzynTKdMp1ynXKdsp2ynfKd8p4ynjKecp5yobKh8qHyojKiMqJyonKisqKyovKi8qUypXKlcqWypbKl8qXypjKmMqZypnKmsqgyqDKocqhyqLKosqjyqPKrMqtyq3Krsquyq/Kr8qwyrDKscqxyrLKssq4yrjKucq5yrrK0crSytLKLcsty0bLRstHy0fLSMtIy0nLSctKy0rLS8tLy0zLTMtNy1XLVstWy1fLV8tYy1jLWctZy2/LcMtwy3HLcctyy3LLc8tzy3TLdMt1y3XLdst2y3fLd8t4y4HLgsuFy4XLhsuGy4fLh8uIy4jLicuJy4rLisuLy4vLk8uTy5TLlMuVy5XLlsuWy5fLl8uYy5jLmcuZy5rLnsufy5/LoMugy6HLocuiy6LLo8ujy6vLrMusy63Lrcuuy67Lr8uvy7DLtsu3y7fLuMu4y7nL0cvSy9LLLcsty0bLRstHy0fLSMtIy0nLSctKy0rLS8tLy0zLTMtNy1XLVstWy1fLV8tYy1jLWctZy2/LcMtwy3HLcctyy3LLc8tzy3TLdMt1y3XLdst2y3fLd8t4y4HLgsuFy4XLhsuGy4fLh8uIy4jLicuJy4rLisuLy4vLk8uTy5TLlMuVy5XLlsuWy5fLl8uYy5jLmcuZy5rLnsufy5/LoMugy6HLocuiy6LLo8ujy6vLrMusy63Lrcuuy67Lr8uvy7DLtsu3y7fLuMu4y7nL0cvSy9LLLcwtzEfMR8xIzEjMScxJzErMSsxLzEvMTMxNzE7MTsxPzE/MVsxXzFfMWMxYzFnMWcxazFrMW8xbzFzMXMxdzF3MXsxezF/MX8xgzGDMYcxhzGTMfsx+zH/Mf8yAzIDMgcyBzILMgsyDzIPMhMyEzIXMhcyGzIbMh8yHzIjMiMyJzInMisySzJLMk8yTzJTMlMyVzJXMlsyWzJfMl8yczJzMncydzJ7MnsygzKDMocyozKnMqcyqzKrMq8yrzKzMrMytzK3MrsyuzK/MtMy1zLXMtsy2zLfMt8y4zLjM0czSzNLMLcwtzEvMS8xMzE7MT8xPzFbMV8xXzFjMWMxazFvMW8xczFzMXcxdzF7MXsxfzF/MYMxgzGHMYcxizGLMY8xjzGTMZMxlzGXMZsxmzGfMZ8xozGjMacxpzGrMa8xrzHvMfMx8zH3Mfcx+zH7Mf8x/zIDMgMyBzIHMgsyCzIPMg8yGzIfMh8yTzJPMlMyUzJXMlcyWzJbMmsybzJvMnMyczJ3MncyezKbMpsynzKfMqMyozKnMqcyqzKrMq8yrzKzMrMytzK3MrsyuzLPMs8y0zLTMtcy1zLbMtsy3zLfMuMy4zNHM0szSzC3NLc1LzUvNTM1OzU/NT81WzVfNV81YzVjNWs1bzVvNXM1czV3NXc1ezV7NX81fzWDNYM1hzWHNYs1izWPNY81kzWTNZc1lzWbNZs1nzWfNaM1ozWnNac1qzWvNa817zXzNfM19zX3Nfs1+zX/Nf82AzYDNgc2BzYLNgs2DzYPNhs2HzYfNk82TzZTNlM2VzZXNls2WzZrNm82bzZzNnM2dzZ3Nns2mzabNp82nzajNqM2pzanNqs2qzavNq82szazNrc2tza7Nrs2zzbPNtM20zbXNtc22zbbNt823zbjNuM3RzdLN0s0tzS3NTs1PzU/NUM1QzVHNUc1SzVLNU81TzVbNV81XzVjNWM1ZzVnNWs1azVvNW81czVzNX81fzWDNYM1hzWHNYs1izWPNY81kzWTNZc1lzWbNZs1nzWfNaM1ozWnNac1qzWrNa81rzWzNbM1tzW3Nbs1uzW/Ncs1zzXnNec16zXrNe817zXzNfM19zX3Nfs1+zYvNjM2MzY3Njc2OzY7Nj82PzZDNk82TzZTNlM2VzZXNmM2ZzZnNms2azZvNm82czZzNnc2dzZ7No82kzaTNpc2lzabNps2nzafNqM2ozanNqc2qzarNq82rzazNss2yzbPNs820zbTNtc21zbbNts23zbfNvc29zb7N0c3SzdLNLc4tzk7OT85PzlDOUM5RzlHOUs5SzlPOU85WzlfOV85YzljOWc5ZzlrOWs5bzlvOXM5czl/OX85gzmDOYc5hzmLOYs5jzmPOZM5kzmXOZc5mzmbOZ85nzmjOaM5pzmnOas5qzmvOa85szmzObc5tzm7Obs5vznLOc855znnOes56znvOe858znzOfc59zn7Ofs6LzozOjM6Nzo3Ojs6Ozo/Oj86QzpPOk86UzpTOlc6VzpjOmc6ZzprOms6bzpvOnM6czp3Onc6ezqPOpM6kzqXOpc6mzqbOp86nzqjOqM6pzqnOqs6qzqvOq86szrLOss6zzrPOtM60zrXOtc62zrbOt863zr3Ovc6+ztHO0s7Szi3OLc5Ozk/OT85QzlDOUc5RzlLOUs5TzlPOVM5UzlbOV85XzljOWM5ZzlnOW85czlzOYs5izmPOY85kzmTOZc5lzmbOZs5ozmnOac5qzmrOa85rzmzObM5tzm3Obs5uzm/Ob85yznLOc85zznTOdM51znXOds52znnOec56znrOe857znzOfM59zorOi86LzozOjM6Nzo3Ojs6Ozo/Oj86QzpfOl86YzpjOmc6ZzprOms6bzpvOnM6izqPOo86kzqTOpc6lzqbOps6nzqfOqM6ozqnOqc6qzqrOq86wzrHOsc6yzrLOs86zzrTOtM61zrXOts62zrzOvM69zr3O0c7SztLOLc8tz0LPUM9Qz1HPUc9Sz1LPU89Tz2rPa89rz2zPbM9tz23Pbs9uz2/Pb89yz3LPc89zz3TPdM91z3XPes96z3vPhc+Gz4jPiM+Jz4nPis+Kz4vPi8+Mz4zPjc+Nz47Pjs+Pz4/PkM+Xz5fPmM+Yz5nPmc+az5rPoc+iz6LPo8+jz6TPpM+lz6XPps+mz6fPp8+oz6jPqc+pz6/Pr8+wz7DPsc+xz7LPss+zz7PPtM+0z7XPtc+2z7jPuM+5z7nPus+6z7vPu8+8z7zPvc+9z9HP0s/Szy3PLc9Cz1DPUM9Rz1HPUs9Sz1PPU89qz2vPa89sz2zPbc9tz27Pbs9vz2/Pcs9yz3PPc890z3TPdc91z3rPes97z4XPhs+Iz4jPic+Jz4rPis+Lz4vPjM+Mz43Pjc+Oz47Pj8+Pz5DPl8+Xz5jPmM+Zz5nPms+az6HPos+iz6PPo8+kz6TPpc+lz6bPps+nz6fPqM+oz6nPqc+vz6/PsM+wz7HPsc+yz7LPs8+zz7TPtM+1z7XPts+4z7jPuc+5z7rPus+7z7vPvM+8z73Pvc/Rz9LP0s8t0C3QQtBC0EPQStBK0EvQS9Bt0G7QbtBv0HPQdNB00IPQg9CE0ITQhdCF0IbQhtCH0IfQiNCI0InQidCK0IrQi9CL0IzQjNCN0I3QjtCO0I/Ql9CX0JjQmNCZ0KDQoNCh0KHQotCi0KPQo9Ck0KTQpdCl0KbQptCn0K7QrtCv0K/QsNCw0LHQsdCy0LLQs9Cz0LTQtNC10LfQt9C40LjQudC50LrQutC70LvQvNC80NHQ0tDS0C3QLdBC0ELQQ9BK0ErQS9BL0G3QbtBu0G/Qc9B00HTQg9CD0ITQhNCF0IXQhtCG0IfQh9CI0IjQidCJ0IrQitCL0IvQjNCM0I3QjdCO0I7Qj9CX0JfQmNCY0JnQoNCg0KHQodCi0KLQo9Cj0KTQpNCl0KXQptCm0KfQrtCu0K/Qr9Cw0LDQsdCx0LLQstCz0LPQtNC00LXQt9C30LjQuNC50LnQutC60LvQu9C80LzQ0dDS0NLQLdEt0ULRRdFF0UbRRtFH0UnRStFK0UvRS9FM0XzRfdF90YPRg9GE0YTRhdGF0YbRhtGH0YfRiNGI0YnRidGK0YrRi9GL0YzRjNGN0Y3RnNGc0Z3RndGe0Z/Rn9Gg0aDRodGh0aLRotGj0aPRpNGk0a3RrtGu0a/Rr9Gw0bDRsdGx0bLRstGz0bPRtNG30bfRuNG40bnRudG60brRu9G70dHR0tHS0S3RLdFE0UXRRdFG0UbRR9FJ0UrRStFL0UvRTNFM0U3Re9F80XzRfdF90X7RftF/0X/RgNGA0YHRgdGC0YLRg9GD0YTRhNGF0YXRhtGb0ZvRnNGc0Z3RndGe0Z7Rn9Gf0aDRoNGh0aHRotGi0aPRo9Gr0azRrNGt0a3RrtGu0a/Rr9Gw0bDRsdGx0bLRstG40bjRudG50brRutG70dHR0tHS0S3SLdJE0kXSRdJG0kbSR9JJ0krSStJL0kvSTNJM0k3Se9J80nzSfdJ90n7SftJ/0n/SgNKA0oHSgdKC0oLSg9KD0oTShNKF0oXShtKb0pvSnNKc0p3SndKe0p7Sn9Kf0qDSoNKh0qHSotKi0qPSo9Kr0qzSrNKt0q3SrtKu0q/Sr9Kw0rDSsdKx0rLSstK40rjSudK50rrSutK70tHS0tLS0i3SLdJG0kbSStJK0kvSS9JM0kzSTdJW0lfSV9JZ0lnSWtJb0lvSXNJf0l/SYNJi0mLSY9Jj0nfSeNJ40nnSedJ60nrSfNJ90n3SftJ+0n/Sf9KA0oDSgdKB0oLSgtKD0oPShNKE0oXSk9KT0pTSlNKV0pXSltKW0pfSl9KY0pjSmdKZ0prSmtKb0pvSnNKc0p3SndKe0p7SqNKp0qnSqtKq0qvSq9Ks0qzSrdKt0q7SrtKv0q/SsNKw0rHS0dLS0tLSLdMt003TTtNO00/TT9NQ01DTUdNS01LTVdNW01bTV9NX01jTWNNZ01nTWtNa01vTW9Nc01zTXdNd017TXtNf01/TYNNg02HTYdNi02LTY9Nj02TTZNNl02jTadNt023TbtNu02/Tb9Nw03DTcdNx03LTctNz03PTdNN003XTddN403nTedN603rTfNN9033Tj9OQ05DTkdOR05LTktOT05PTlNOU05XTldOW05bTl9OX05jTmNOZ05nTmtOa05vTm9Oc05zTndOd057TqNOp06nTqtOq06vTq9Os06zTrdOt067TrtOv09HT0tPS0y3TLdNN007TTtNP00/TUNNQ01HTUtNS01XTVtNW01fTV9NY01jTWdNZ01rTWtNb01vTXNNc013TXdNe017TX9Nf02DTYNNh02HTYtNi02PTY9Nk02TTZdNo02nTbdNt027TbtNv02/TcNNw03HTcdNy03LTc9Nz03TTdNN103XTeNN503nTetN603zTfdN904/TkNOQ05HTkdOS05LTk9OT05TTlNOV05XTltOW05fTl9OY05jTmdOZ05rTmtOb05vTnNOc053TndOe06jTqdOp06rTqtOr06vTrNOs063TrdOu067Tr9PR09LT0tMt1C3UTdRO1E7UT9RP1FDUUNRR1FHUUtRS1FPUU9RV1FbUVtRX1FfUWNRY1FnUWdRa1FrUW9Rb1FzUXNRe1F7UX9Rf1GDUYNRh1GHUYtRi1GPUY9Rk1GTUZdRl1GbUZtRo1GjUadRp1GrUbNRs1G3UbdRu1G7Ub9Rv1HDUcNRx1HHUctRy1HPUc9R01HTUddR11HjUedR51IvUjNSM1I7Uj9SP1JDUkNSR1JHUktSS1JTUldSV1JbUltSX1JfUmNSY1JnUmdSa1JrUm9Sb1JzUpdSl1KbUqNSp1KnUqtSq1KvUq9Ss1KzUrdSt1NHU0tTS1C3ULdRN1E7UTtRP1E/UUNRQ1FHUUdRS1FLUU9RT1FXUVtRW1FfUV9RY1FjUWdRZ1FrUWtRb1FvUXNRc1F7UXtRf1F/UYNRg1GHUYdRi1GLUY9Rj1GTUZNRl1GXUZtRm1GjUaNRp1GnUatRs1GzUbdRt1G7UbtRv1G/UcNRw1HHUcdRy1HLUc9Rz1HTUdNR11HXUeNR51HnUi9SM1IzUjtSP1I/UkNSQ1JHUkdSS1JLUlNSV1JXUltSW1JfUl9SY1JjUmdSZ1JrUmtSb1JvUnNSl1KXUptSo1KnUqdSq1KrUq9Sr1KzUrNSt1K3U0dTS1NLULdUt1UzVTdVN1U7VTtVP1U/VUNVQ1VHVUdVS1VLVU9VT1VbVV9VX1VjVWNVZ1VnVWtVa1VvVW9Vc1V/VX9Vg1WDVYdVh1WLVYtVj1WPVZNVk1WXVZdVm1WbVaNVp1WnVatVq1WzVbNVt1W3VbtVu1W/Vb9Vw1XDVcdVx1XLVctVz1XPVdNV01YfViNWI1YnVidWK1YrVi9WL1YzVjNWN1Y3VjtWP1Y/VkNWQ1ZHVkdWl1aXVptWm1afVqNWp1anVqtWq1bPVs9W01bTVtdW11bbVttW31bfVuNW41bnVudW61brVu9W71dHV0tXS1S3VLdVK1UrVS9VL1UzVTNVN1U3VTtVO1U/VT9VQ1VDVUdVR1VLVUtVT1VPVV9VY1VjVWtVb1V/VX9Vg1WDVYdVh1WLVYtVj1WPVbdVt1W7VbtVv1XLVc9Vz1XTVdNV61XrVe9V71XzVfNV91X3Vh9WI1YjVidWK1YvVi9WM1YzVjtWP1Y/VkNWf1Z/VoNWg1aHVodWi1aLVo9Wj1aTVpNWl1aXVptWm1afVp9Wo1ajVsdWy1bLVs9Wz1bTVtNW11bXVttW21bfVt9W41bjVudW51brVutW71bvV0dXS1dLVLdYt1krWStZL1kvWTNZM1k3WTdZO1k7WT9ZP1lDWUNZR1lHWUtZS1lPWU9ZX1ljWWNZa1lvWX9Zf1mDWYNZh1mHWYtZi1mPWY9Zt1m3WbtZu1m/WctZz1nPWdNZ01nrWetZ71nvWfNZ81n3WfdaH1ojWiNaJ1orWi9aL1ozWjNaO1o/Wj9aQ1p/Wn9ag1qDWodah1qLWotaj1qPWpNak1qXWpdam1qbWp9an1qjWqNax1rLWstaz1rPWtNa01rXWtda21rbWt9a31rjWuNa51rnWuta61rvWu9bR1tLW0tYt1i3WStZK1kvWS9ZM1kzWTdZN1k7WTtZP1k/WUNZQ1lHWUdZS1lLWeNZ51nnWetZ61nvWe9Z81nzWfdZ91n7WftZ/1n/WgNaA1oHWgdaC1oTWhNaF1oXWhtaH1ojWiNaJ1ovWjNaM1pzWndad1p7Wntaf1p/WoNag1qHWodai1qLWo9aj1qTWpNal1qXWptam1qfWr9av1rDWsNax1rHWstay1rPWs9a01rTWtda11rbWtta31rfWuNa41rnWuda61rrWu9a71tHW0tbS1i3XLddK10rXS9dL10zXTNdN103XTtdO10/XT9dQ11DXUddR11LXUtd413nXedd613rXe9d713zXfNd9133Xftd+13/Xf9eA14DXgdeB14LXhNeE14XXhdeG14fXiNeI14nXi9eM14zXnNed153Xntee15/Xn9eg16DXodeh16LXotej16PXpNek16XXpdem16bXp9ev16/XsNew17HXsdey17LXs9ez17TXtNe117XXtte217fXt9e417jXude517rXute717vX0dfS19LXLdct10vXS9dM10zXTddN107Xd9d413jXedd513rXetd713vXfNd8133Xfdd+137Xf9d/14DXgNeB14TXhNeF14XXhteG14fXh9eI14jXnNec153Xndee157Xn9ef16DXoNeh16HXotei16PXo9ek16TXrteu16/Xr9ew17DXsdex17LXstez17PXtNe017XXtde217bXt9e317jXuNe517nXute617vX0dfS19LXLdgt2HLYcthz2HPYdNh22HbYd9h32HjYeNh52HnYmNiY2JnYmdia2JzYnNid2J3Yntir2KvYrNis2K3Yrdiu2K7Yr9iv2LDYsNix2LHYstiy2LPYs9i02LTYtdi12LbYttjR2NLY0tgt2C3Ycthy2HPYc9h02HbYdth32HfYeNh42HnYediY2JjYmdiZ2JrYnNic2J3Yndie2KvYq9is2KzYrdit2K7Yrtiv2K/YsNiw2LHYsdiy2LLYs9iz2LTYtNi12LXYtti22NHY0tjS2C3ZLdls2WzZbdlt2W7Zbtlv2W/ZcNlw2XHZcdly2XLZc9lz2XTZdtl22ZPZlNmU2ZXZldmY2ZjZmdmp2anZqtmq2avZq9ms2azZrdmt2a7Zrtmv2a/ZsNmw2bHZsdmy2bLZs9mz2bTZtNm12dHZ0tnS2S3ZLdls2WzZbdlt2W7Zbtlv2W/ZcNlw2XHZcdly2XLZc9lz2XTZdtl22ZPZlNmU2ZXZldmY2ZjZmdmp2anZqtmq2avZq9ms2azZrdmt2a7Zrtmv2a/ZsNmw2bHZsdmy2bLZs9mz2bTZtNm12dHZ0tnS2S3aLdpW2lfaV9pY2ljaWdpZ2lraXNpd2l3aXtpe2l/aX9pg2mDaYdpj2mPaZNpk2mXaZdpm2mbaZ9pn2mjaaNpp2m3abdpu2m7ab9pv2nDacNpx2nHactpy2nPac9p02o3ajdqO2o7aj9qP2pDakNqT2pPalNqU2pXaqNqp2qnaqtqq2qvaq9qs2qzardqt2q7artqv2rHastqy2rPas9q02tHa0trS2i3aLdpO2k/aT9pQ2lDaUdpR2lLaUtpT2lPaVNpU2lXaVdpW2lbaV9pX2ljaWNpZ2lnaWtpb2lzaXNpd2l3aXtpe2l/aX9pg2mDaYdpj2mPaZNpk2mXaZdpm2mbaZ9pn2mjaaNpp2m3abdpu2m7ab9pv2nDacNpx2nHactpy2nPac9p02nraetp72nvafNp82n3ajNqM2o3ajdqO2o7aj9qP2pDakNqR2pHaktqS2pPak9qU2pzanNqd2p3antqf2p/aoNqg2qHaodqi2qLao9qm2qfap9qo2qjaqdqp2qraqtqr2qvarNqs2q3ardrR2tLa0tot2y3bTttP20/bUNtQ21HbUdtS21LbU9tT21TbVNtV21XbVttW21fbV9tY21jbWdtZ21rbW9tc21zbXdtd217bXttf21/bYNtg22HbY9tj22TbZNtl22XbZttm22fbZ9to22jbadtt223bbttu22/bb9tw23Dbcdtx23Lbcttz23PbdNt623rbe9t723zbfNt924zbjNuN243bjtuO24/bj9uQ25DbkduR25LbktuT25PblNuc25zbndud257bn9uf26DboNuh26Hbotui26Pbptun26fbqNuo26nbqduq26rbq9ur26zbrNut263b0dvS29LbLdst207bT9tP21DbUNtR21HbUttS21PbU9tU21TbVdtV21bbVttX21fbWNtY21nbWdta21vbXNtc213bXdte217bX9tf22DbYNth22TbZNtl22XbZttm22fbZ9to22jbadtp22rbeNt523nbett623vbe9t823zbfdt9237bftt/23/bgNuH24jbiNuJ24nbituK24vbi9uM24zbjduN247bjtuP24/bkNuT25nbmtua25vbm9uc25zbndud257bntuf25/boNug26Hbodui26Lbo9um26fbp9uo26jbqdup26rbqtur26vbrNu427jbudvR29Lb0tst3C3cTtxP3E/cUNxQ3FHcUdxS3FLcU9xT3FTcVNxV3FXcVtxW3FfcV9xY3FjcWdxZ3FrcW9xc3FzcXdxd3F7cXtxf3F/cYNxg3GHcZNxk3GXcZdxm3GbcZ9xn3GjcaNxp3Gncatx43Hncedx63Hrce9x73HzcfNx93H3cftx+3H/cf9yA3IfciNyI3IncidyK3Irci9yL3IzcjNyN3I3cjtyO3I/cj9yQ3JPcmdya3Jrcm9yb3JzcnNyd3J3cntye3J/cn9yg3KDcodyh3KLcotyj3Kbcp9yn3KjcqNyp3Kncqtyq3Kvcq9ys3LjcuNy53NHc0tzS3C3cLdxR3FLcUtxT3FPcV9xY3FjcWdxZ3FvcXNxc3F3cXdxe3F7cX9xf3GDcYNxh3GfcZ9xo3Gjcadx23Hbcd9x33HjceNx53Hncetx63Hvce9x83Hzcfdx93H7cftx/3H/chdyG3Ibch9yH3IjciNyJ3IncityK3Ivci9yM3Izcmdya3Jrcm9yb3JzcnNyd3J3cntye3J/cn9yl3KXcptym3Kfcp9yo3Kjcqdyp3Lfct9y43LjcudzR3NLc0twt3S3dTN1R3VLdUt1a3VvdW91c3VzdXd1d3V/dX91g3XTddd113Xbddt133XfdeN143Xnded163Xrde9173XzdfN193YPdg92E3YTdhd2F3Ybdht2H3YfdiN2I3Yndid2K3Yrdi92a3aTdpN2l3aXdpt2m3afdp92o3ajdt9233dHd0t3S3S3dLd1M3VHdUt1S3VrdW91b3VzdXN1d3V3dX91f3WDddN113XXddt123Xfdd9143Xjded153Xrdet173XvdfN183X3dg92D3YTdhN2F3YXdht2G3Yfdh92I3Yjdid2J3Yrdit2L3ZrdpN2k3aXdpd2m3abdp92n3ajdqN233bfd0d3S3dLdLd4t3kveS95M3kzeTd5N3k7edN513nXedt523nfed9543oPeg96E3oTehd6F3obeoN6g3qHeod6i3qLeo96j3qTepN6l3qXept6m3qfep96o3rDesd6x3tHe0t7S3i3eLd5L3kveTN5M3k3eTd5O3nTedd513nbedt533nfeeN6D3oPehN6E3oXehd6G3qDeoN6h3qHeot6i3qPeo96k3qTepd6l3qbept6n3qfeqN6w3rHesd7R3tLe0t4t3y3fg9+D34TfhN+F357fn9+f36DfoN+h36Hfot+i36Pfrt+u36/fr9+w37Dfsd+x37Lfst+z37PftN+037Xf0d/S39LfLd8t323fbt9+337ff99/34TfhN+O34/fj9+Q35Dfkd+R35Lfkt+T35PflN+U35Xfld+W35bfl9+X35jfmN+Z35nfmt+a353fnt+e35/fn9+g36Dfod+h36Lfq9+r36zfrN+t363frt+u36/fsd+y37Lfs9+z37TftN+139Hf0t/S3y3gLeBt4G7gfuB+4H/gf+CE4ITgjuCP4I/gkOCQ4JHgkeCS4JLgk+CT4JTglOCV4JXgluCW4Jfgl+CY4JjgmeCZ4JrgmuCd4J7gnuCf4J/goOCg4KHgoeCi4Kvgq+Cs4KzgreCt4K7gruCv4LHgsuCy4LPgs+C04LTgteDR4NLg0uAt4C3gZuBm4GfgZ+Bq4Gvga+Bs4GzgbeBt4G7gbuBv4HLgcuBz4HPgdOB04HXgdeB24HbgeeB54HrgeuB74H3gfuB+4H/gf+CA4I3gjeCO4I7gj+CQ4JHgkeCS4JLgk+CT4JTglOCV4JXgluCW4Jfgl+CY4JjgmeCZ4JrgmuCb4JvgnOCe4J/gn+Cg4KDgqeCp4KrgquCr4KvgrOCs4K3greCu4K7gr+Cy4LLgs+Cz4NHg0uDS4C3hLeFm4WbhZ+Fn4Wrha+Fr4WzhbOFt4W3hbuFu4W/hcuFy4XPhc+F04XThdeF14XbhduF54XnheuF64XvhfeF+4X7hf+F/4YDhjeGN4Y7hjuGP4ZDhkeGR4ZLhkuGT4ZPhlOGU4ZXhleGW4Zbhl+GX4ZjhmOGZ4ZnhmuGa4Zvhm+Gc4Z7hn+Gf4aDhoOGp4anhquGq4avhq+Gs4azhreGt4a7hruGv4bLhsuGz4bPh0eHS4dLhLeEt4VXhVuFW4VfhV+Fg4WHhZeFm4WbhZ+Fn4Wrha+Fr4WzhbOFt4W3hbuFu4W/hcuFy4XPhc+F04XThdeF14XbhduF34XfheOF44XnheeF64Xrhe+F94X7hfuF/4X/hgOGM4YzhjeGN4Y7hjuGP4Y/hkOGQ4ZHhkeGS4ZLhk+GT4ZThluGW4Zfhl+GZ4ZrhqeGp4arhquGr4a7hruG24bfht+HR4dLh0uEt4i3iT+JP4lXiVeJW4lbiV+JX4ljiWOJZ4lniX+Jg4mDiYeJh4mLiYuJj4mPiZOJk4mXiZeJm4mbiZ+Jn4mniauJq4mvia+J24nbid+J34njieOJ54nnieuJ64n7ifuJ/4n/iiOKI4oniieKK4orii+KL4ozijOKN4o3ijuKO4o/ij+KQ4qjiqeKp4qriquKr4rbit+K34tHi0uLS4i3iLeJP4k/iVeJV4lbiVuJX4lfiWOJY4lniWeJf4mDiYOJh4mHiYuJi4mPiY+Jk4mTiZeJl4mbiZuJn4mfiaeJq4mria+Jr4nbiduJ34nfieOJ44nnieeJ64nrifuJ+4n/if+KI4ojiieKJ4oriiuKL4ovijOKM4o3ijeKO4o7ij+KP4pDiqOKp4qniquKq4qvituK34rfi0eLS4tLiLeMt41XjVeNW41bjV+NX41jjWONZ41njWuNf41/jYONg42HjYeNi42LjY+Nj42TjZONl42XjZuNm42fjZ+Np42rjauOI44jjieOJ44rjiuOL44vjjuOO44/jqeOp46rjquOz47Pj0ePS49LjLeMt41XjVeNW41bjV+NX41jjWONZ41njWuNf41/jYONg42HjYeNi42LjY+Nj42TjZONl42XjZuNm42fjZ+Np42rjauOI44jjieOJ44rjiuOL44vjjuOO44/jqeOp46rjquOz47Pj0ePS49LjLeQt5FTkVORV5FXkVuRW5FfkV+RY5FjkWeRZ5F/kYORg5GHkYeSE5ITkheSJ5J/kn+Sg5KDkoeSh5KLkouSj5KPkpOSk5KXkpeSy5LLks+Sz5NHk0uTS5C3kLeRX5FjkWOSB5ILkguSD5IPkhOSE5IXkheSG5Jvkm+Sc5JzkneSe5J/kn+Sg5KDkoeSh5KLkouSj5KPkpOSk5KXkpeTR5NLk0uQt5S3lV+VY5VjlgeWC5YLlg+WD5YTlhOWF5YXlhuWb5ZvlnOWc5Z3lnuWf5Z/loOWg5aHloeWi5aLlo+Wj5aTlpOWl5aXl0eXS5dLlLeUt5YHlguWC5YPlg+WE5YTlheWT5ZPllOWU5ZXlmOWY5Znlm+Wb5ZzlnOWd5Z/ln+Wg5aDloeWs5a3lreWu5a7l0eXS5dLlLeYt5nHmceZy5nLmc+Zz5nTmd+Z45njmeeZ55nrmeuZ85n3mfeZ+5n7mf+Z/5oLmg+aD5o7mjuaP5o/mkOaS5pLmk+aT5pTmluaW5pfml+aY5pjmmeac5pzmnear5qvmrOas5q3mreau5q7m0ebS5tLmLeYt5nHmceZy5nLmc+Zz5nTmd+Z45njmeeZ55nrmeuZ85n3mfeZ+5n7mf+Z/5oLmg+aD5o7mjuaP5o/mkOaS5pLmk+aT5pTmluaW5pfml+aY5pjmmeac5pzmnear5qvmrOas5q3mreau5q7m0ebS5tLmLect52PnY+dk52TnZedn52fnaOdo52nnaedq53Lncudz53PndOd053fnd+d453jneed553rneud753vnfOd8533nfed+537nf+d/547njueP54/nkOeQ55LnkueT55PnlOeW55bnl+eX56nnqeeq56rnq+fR59Ln0uct5y3nY+dj52TnZOdl52fnZ+do52jnaedp52rncudy53Pnc+d053Tnd+d353jneOd553nneud653vne+d853znfed9537nfud/53/njueO54/nj+eQ55DnkueS55Pnk+eU55bnlueX55fnqeep56rnquer59Hn0ufS5y3oLehj6GPoZOhk6GXoZ+hn6GjoaOhp6Gnoauhq6GzobOht6G3obuhu6G/odOh16HXoduh26Hfod+h46Hjoeeh56Hroeuh76HvofOh86H3ofeh+6H7oiOiI6I7oj+iP6JDop+io6Kjoqeip6KroqujR6NLo0ugt6C3oXuhe6F/oX+hg6GToZOhl6Gjoaehp6Grobuhv6G/odeh16Hboduh36HfoeOh46Hnoeeh66Hroh+iI6IjoieiO6I/opeil6Kbopuin6KfoqOio6KnoqejR6NLo0ugt6S3pXule6V/pX+lg6WTpZOll6Wjpaelp6Wrpbulv6W/pdel16Xbpdul36XfpeOl46Xnpeel66Xrph+mI6YjpiemO6Y/ppeml6abppumn6afpqOmo6anpqenR6dLp0ukt6S3pXule6V/pX+lg6WDpYemC6Ybph+mH6YjpiOmJ6aLpo+mj6aTppOml6aXppumm6afpp+mo6ajp0enS6dLpLeot6l7qXupf6l/qYOpg6mHqguqG6ofqh+qI6ojqieqi6qPqo+qk6qTqpeql6qbqpuqn6qfqqOqo6tHq0urS6i3qLeqC6oPqg+qG6ofqh+qI6ojqneqe6p7qoeqh6qLqouqj6qPqpOqk6qXqpeqm6tHq0urS6i3rLeuC64Prg+uc653rneue657ro+uk66Tr0evS69LrLest64Lrg+uD65zrneud657rnuuj66TrpOvR69Lr0ust7C3scuxz7JPsk+yU7Jfsl+yY7Jjsmeyc7Jzsneyd7J7snuzR7NLs0uwt7C3scuxz7JPsk+yU7Jfsl+yY7Jjsmeyc7Jzsneyd7J7snuzR7NLs0uwt7S3tcu1z7XPtdO137XjteO197ZLtku2T7ZPtlO2U7ZXtl+2X7ZjtmO2Z7Zvtm+2c7Zztne2d7Z7t0e3S7dLtLe0t7WLtYu1j7WPtZe1m7WbtZ+1n7XLtcu1z7XfteO147X3tfu1+7Y7tju2P7ZPtlO2b7Zvt0e3S7dLtLe4t7mLuYu5j7mPuZe5m7mbuZ+5n7nLucu5z7nfueO547n3ufu5+7o7uju6P7pPulO6b7pvu0e7S7tLuLe4t7mLuYu5j7mPuZe5m7mbuZ+5n7m3ufe5+7n7uf+5/7oXuhe6G7ojuiO6J7o3uje6O7o7uj+7R7tLu0u4t7y3vYu9i72PvY+9l72bvZu9n72fvbe99737vfu9/73/vhe+F74bviO+I74nvje+N747vju+P79Hv0u/S7y3vLe9r72vvbO9s723vdO9173Xvdu92733vfu9+73/vf++A74Xvhe+G74bvh++H74jviO+J743vje+O747vj+/R79Lv0u8t8C3wa/Br8GzwbPBt8HTwdfB18HrwevB88H3wffB+8H7wf/B/8IDwh/CI8Ijw0fDS8NLwLfAt8Gvwa/Bs8GzwbfB08HXwdfB68HrwfPB98H3wfvB+8H/wf/CA8IfwiPCI8NHw0vDS8C3xLfFr8WvxbPFs8XrxevF78XzxffGg8aDx0fHS8dLxLfEt8Wvxa/Fs8WzxevF68XvxfPF98aDxoPHR8dLx0vEt8i3y0fLS8tLyLfIt8tHy0vLS8i3zLfPR89Lz0vMt8y3zcfNx89Hz0vPS8y30LfRx9HH00fTS9NL0LfQt9NH00vTS9C31LfXR9dL10vUt9S310fXS9dL1LfYt9tH20vbS9i32LfbR9tL20vYt9y330ffS99L3Lfct99H30vfS9y34LfjR+NL40vgt+C340fjS+NL4Lfkt+dH50vnS+S35LfnR+dL50vkt+i360frS+tL6Lfot+tH60vrS+i37LfvR+9L70vst+y370fvS+9L7Lfwt/NH80vzS/C38LfzR/NL80vwt/S390f3S/dL9Lf0t/dH90v3S/S3+Lf7R/tL+0v4t/i3+0f7S/tL+Lf8t/y7/Lv8v/y//MP8w/zH/Mf8y/zL/M/8z/zT/NP81/zX/Nv82/zf/N/84/zj/Of85/zr/Ov87/zv/PP88/z3/Pf8+/z7/P/8//0D/QP9B/0H/Qv9C/0P/Q/9E/0T/Rf9F/0b/Rv9H/0f/SP9I/0n/Sf9K/0r/S/9L/0z/TP9N/03/Tv9O/0//T/9Q/1D/Uf9R/1L/Uv9T/1P/VP9U/1X/Vf9W/1b/V/9X/1j/WP9Z/1n/Wv9a/1v/W/9c/1z/Xf9d/17/Xv9f/1//YP9g/2H/Yf9i/2L/Y/9j/2T/ZP9l/2X/Zv9m/2f/Z/9o/2j/af9p/2r/av9r/2v/bP9s/23/bf9u/27/b/9v/3D/cP9x/3H/cv9y/3P/c/90/3T/df91/3b/dv93/3f/eP94/3n/ef96/3r/e/97/3z/fP99/33/fv9+/3//f/+A/4D/gf+B/4L/gv+D/4P/hP+E/4X/hf+G/4b/h/+H/4j/iP+J/4n/iv+K/4v/i/+M/4z/jf+N/47/jv+P/4//kP+Q/5H/kf+S/5L/k/+T/5T/lP+V/5X/lv+W/5f/l/+Y/5j/mf+Z/5r/mv+b/5v/nP+c/53/nf+e/57/n/+f/6D/oP+h/6H/ov+i/6P/o/+k/6T/pf+l/6b/pv+n/6f/qP+o/6n/qf+q/6r/q/+r/6z/rP+t/63/rv+u/6//r/+w/7D/sf+x/7L/sv+z/7P/tP+0/7X/tf+2/7b/t/+3/7j/uP+5/7n/uv+6/7v/u/+8/7z/vf+9/77/vv+//7//wP/A/8H/wf/C/8L/w//D/8T/xP/F/8X/xv/G/8f/x//I/8j/yf/J/8r/yv/L/8v/zP/M/83/zf/O/87/z//P/9D/0P/R/9H/0v/S/y3/Lf8u/y7/L/8v/zD/MP8x/zH/Mv8y/zP/M/80/zT/Nf81/zb/Nv83/zf/OP84/zn/Of86/zr/O/87/zz/PP89/z3/Pv8+/z//P/9A/0D/Qf9B/0L/Qv9D/0P/RP9E/0X/Rf9G/0b/R/9H/0j/SP9J/0n/Sv9K/0v/S/9M/0z/Tf9N/07/Tv9P/0//UP9Q/1H/Uf9S/1L/U/9T/1T/VP9V/1X/Vv9W/1f/V/9Y/1j/Wf9Z/1r/Wv9b/1v/XP9c/13/Xf9e/17/X/9f/2D/YP9h/2H/Yv9i/2P/Y/9k/2T/Zf9l/2b/Zv9n/2f/aP9o/2n/af9q/2r/a/9r/2z/bP9t/23/bv9u/2//b/9w/3D/cf9x/3L/cv9z/3P/dP90/3X/df92/3b/d/93/3j/eP95/3n/ev96/3v/e/98/3z/ff99/37/fv9//3//gP+A/4H/gf+C/4L/g/+D/4T/hP+F/4X/hv+G/4f/h/+I/4j/if+J/4r/iv+L/4v/jP+M/43/jf+O/47/j/+P/5D/kP+R/5H/kv+S/5P/k/+U/5T/lf+V/5b/lv+X/5f/mP+Y/5n/mf+a/5r/m/+b/5z/nP+d/53/nv+e/5//n/+g/6D/of+h/6L/ov+j/6P/pP+k/6X/pf+m/6b/p/+n/6j/qP+p/6n/qv+q/6v/q/+s/6z/rf+t/67/rv+v/6//sP+w/7H/sf+y/7L/s/+z/7T/tP+1/7X/tv+2/7f/t/+4/7j/uf+5/7r/uv+7/7v/vP+8/73/vf++/77/v/+//8D/wP/B/8H/wv/C/8P/w//E/8T/xf/F/8b/xv/H/8f/yP/I/8n/yf/K/8r/y//L/8z/zP/N/83/zv/O/8//z//Q/9D/0f/R/9L/0v8="

/* populated by buildFingerprintPositions the first (and only) time it runs.
   bandT is a continuous 0 (top) → 1 (bottom) value per particle, straight
   from its pixel row in the baked data — not a mask like the other shapes
   use. see ParticleSystem._applyFingerprintAction, which uses it to drive
   a horizontal scan line sweeping top to bottom. */
let fingerprintMeta = null

function buildFingerprintPositions(count) {
  const RES = FINGERPRINT_PIXELS_RES, worldSize = 350, depthJitter = 25, xOffset = 300
  const half = worldSize / 2

  /* decode the baked (x,y) byte-pair list — synchronous, no canvas, no
     image, no network: this is just parsing a string */
  const bin = atob(FINGERPRINT_PIXELS_B64)
  const filled = new Array(bin.length)
  for (let i = 0; i < bin.length; i++) filled[i] = bin.charCodeAt(i)

  const result = new Float32Array(count * 3)
  const bandT = new Float32Array(count)

  for (let i = 0; i < count; i++) {
    const idx = (Math.random() * (filled.length / 2) | 0) * 2
    const px = filled[idx], py = filled[idx + 1]
    const jx = (Math.random() - 0.5) * (worldSize / RES) * 1.6
    const jy = (Math.random() - 0.5) * (worldSize / RES) * 1.6
    result[i * 3]     = (px / RES) * worldSize - half + jx + xOffset
    result[i * 3 + 1] = -((py / RES) * worldSize - half) + jy
    result[i * 3 + 2] = (Math.random() - 0.5) * depthJitter
    bandT[i] = py / RES
  }

  fingerprintMeta = { bandT, basePositions: result.slice() }
  return result
}

// ─── PARTICLE SYSTEM ──────────────────────────────────────────────────────────

/* sections that pull the background particles into a symbolic shape as they
   cross the middle of the viewport, dissolving back to the ambient cloud
   once scrolled past — each entry is resolved lazily once the DOM exists */
const PARTICLE_SHAPES = [
  {
    selector: '.works-section',
    anchorOffset: 550,   /* a bit lower than the shared default */
    build: count => buildCompassPositions(count),
    sweep: true,      /* moving leg rotates in place for a moment before dissolving */
    plateau: 130,     /* hold fully solid through the whole sweep window (see SWEEP_END below) before starting to dissolve */
  },
  {
    selector: '.analise-section',
    build: count => buildFingerprintPositions(count),
    fingerprintAction: true,   /* a radial "read" pulse travels continuously from the core to the ridges while the shape is formed */
    plateau: 220,   /* wider than the other shapes' — the scan needs more scroll room to sweep top-to-bottom at a readable pace (see SCAN_START/SCAN_END) */
  },
  {
    selector: '.processo-section',
    anchorOffset: 450,   /* a bit higher than the shared default */
    build: count => buildHookFishPositions(count),
    hookFishAction: true,   /* hook+fish rise together; the water ripples continuously */
    plateau: 100,
  },
  {
    selector: '.feeonly-section',
    anchorOffset: 370,   /* a bit higher than the shared default */
    build: count => buildKitesPositions(count),
    kitesAction: true,   /* both climb continuously, swaying independently on X */
    plateau: 120,        /* hold fully solid so the sway/rise reads clearly instead of hiding inside the form/dissolve transition */
  },
  {
    selector: '.time-section',
    build: count => buildOwlPositions(count),
    owlAction: true,   /* forms with wings closed, opens then closes them once with scroll, before dissolving */
    plateau: 100,      /* hold the fully-landed pose for a stretch instead of it being a single instantaneous peak */
  },
  {
    selector: '.dark-section',
    mode: 'enterExit',   /* huge sticky section — hold the flee for its entire length */
    build: (count, restPositions) => fleePositions(restPositions, 500),
  },
]

class ParticleSystem {
  constructor(scene) {
    this.scene = scene
    this.pointCount = 180000
    this.u_progress = 0
    this.smoothScrollY = 0
    this.targets = null       /* resolved lazily once sections exist in the DOM */
    this.activeIndex = -1     /* -1 = resting cloud, no section in focus */
    this.hasSynced = false    /* first frame syncs immediately, ignoring the swap guard */
    this.spinX = 0
    this.spinY = 0
    this.zoomWeight = 0
    this._build()
  }

  _build() {
    const restPositions = createChaosAttractorPositions(
      900, this.pointCount, -400,
      -1.3388143922812512, -2.564831973745868,
      -2.527437970803663, 1.8141623559217095,
      3.542189950007197, 0.31078571067456906
    )
    this.restPositions = restPositions

    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(restPositions, 3))
    geo.setAttribute('position1', new THREE.BufferAttribute(restPositions.slice(), 3))
    geo.setAttribute('a_highlight', new THREE.BufferAttribute(new Float32Array(this.pointCount), 1))
    this.geo = geo
    this._highlightActive = false   /* tracks whether the highlight buffer needs clearing once the fingerprint scanner stops running (see _applyFingerprintAction) */

    this.material = new THREE.RawShaderMaterial({
      vertexShader: particleVertexShader,
      fragmentShader: particleFragmentShader,
      glslVersion: THREE.GLSL3,
      uniforms: {
        u_progress: { value: this.u_progress },
        u_color:    { value: new THREE.Vector3(...PARTICLE_COLOR) },
      }
    })
    this.mesh = new THREE.Points(geo, this.material)
    this.scene.add(this.mesh)

    /* section heights shift once web fonts swap in (Roboto/Ibarra load async
       with font-display:swap) — anchors measured against the fallback-font
       layout would otherwise stay wrong for the rest of the session, since
       they're only ever computed once, on first use */
    document.fonts.ready.then(() => {
      if (this.targets) this._recalcAnchors()
    })
  }

  updateScroll(scrollY) {
    this.smoothScrollY = scrollY
  }

  setZoom(weight) {
    this.zoomWeight = weight
  }

  _resolveTargets() {
    const raw = PARTICLE_SHAPES
      .map(s => ({ el: document.querySelector(s.selector), build: s.build, mode: s.mode, sweep: s.sweep, hookFishAction: s.hookFishAction, kitesAction: s.kitesAction, owlAction: s.owlAction, fingerprintAction: s.fingerprintAction, plateau: s.plateau ?? 0, positions: null, wantOffset: s.anchorOffset ?? 550 }))
      .filter(t => t.el)

    this.targets = raw
    this._recalcAnchors()
  }

  /* (re)computes each target's anchor + auto-capped radius in place, without
     touching this.targets' array order or any already-built t.positions —
     safe to call again later (e.g. once fonts have swapped in) without
     invalidating this.activeIndex, which points into this same array */
  _recalcAnchors() {
    const DESIRED_RADIUS = 3000   /* as slow as the layout allows — auto-capped below */
    const targets = this.targets

    /* each target's anchor as an absolute (scroll-independent) document
       position, so gaps between neighbors can be measured regardless of
       declaration order in PARTICLE_SHAPES */
    targets.forEach(t => {
      const rect = t.el.getBoundingClientRect()
      t.anchorOffset = Math.min(t.wantOffset, rect.height * 0.85)
      t.anchorAbsY = window.scrollY + rect.top + t.anchorOffset
    })

    /* cap each target's radius to half the gap to its neighbors (with a
       10% safety margin) so two shapes can never both stay above the
       swap threshold at once, no matter how large DESIRED_RADIUS is — a
       target with a plateau (a flat fully-solid hold before it starts
       fading) needs that hold width reserved on top of its own radius, or
       the neighbor-gap cap below could still let it start dissolving
       mid-plateau */
    const sorted = [...targets].sort((a, b) => a.anchorAbsY - b.anchorAbsY)
    sorted.forEach((t, i) => {
      const prevGap = i > 0 ? t.anchorAbsY - sorted[i - 1].anchorAbsY : Infinity
      const nextGap = i < sorted.length - 1 ? sorted[i + 1].anchorAbsY - t.anchorAbsY : Infinity
      const cap = Math.min(DESIRED_RADIUS, prevGap / 2 - t.plateau, nextGap / 2 - t.plateau)
      t.radius = Math.max(40, cap * 0.9)
    })
  }

  update(mouseNX = 0, mouseNY = 0) {
    this.spinX = (this.spinX + PI / 180 / 30) % (2 * PI)
    this.spinY = (this.spinY + PI / 180 / 30) % (2 * PI)
    this.mesh.position.y = -this.smoothScrollY
    this.mouseNX = mouseNX
    this.mouseNY = mouseNY

    /* zoom in lockstep with the ring — pushes edge-parked particles out of
       frame for real, instead of them sitting static while the ring (a
       completely separate scene/camera) zooms on its own */
    const zoomScale = lerp(1, 3.5, this.zoomWeight || 0)
    this.mesh.scale.setScalar(zoomScale)

    if (!this.targets) this._resolveTargets()

    const vh = window.innerHeight
    let bestW = 0, bestIdx = -1
    const weights = new Array(this.targets.length)
    this.targets.forEach((t, i) => {
      const rect = t.el.getBoundingClientRect()
      let w
      if (t.mode === 'enterExit') {
        /* huge sticky section — rise once as it's approached, hold for its
           entire (very long) length, fall once as it's finally left behind */
        const enterP = clamp((vh * 0.8 - rect.top) / (vh * 0.8), 0, 1)
        const exitP  = rect.bottom < vh * 0.3 ? clamp(rect.bottom / (vh * 0.3), 0, 1) : 1
        w = Math.min(enterP, exitP)
      } else {
        const centerY = rect.top + t.anchorOffset
        const rawDist = Math.abs(centerY - vh / 2)
        const dist = Math.max(0, rawDist - t.plateau)
        w = clamp(1 - dist / t.radius, 0, 1)
      }
      weights[i] = w
      if (w > bestW) { bestW = w; bestIdx = i }
    })

    const firstFrame = !this.hasSynced
    this.hasSynced = true

    /* eased must reflect how well the shape CURRENTLY LOADED in position1
       (this.activeIndex) matches the scroll position — not whichever
       target happens to be the best match this frame. those are usually
       the same thing, but a fast scroll/fling can jump bestIdx straight
       to a non-neighboring section while its weight is already high,
       before the swap below ever gets a low-eased window to fire in. use
       bestW there and the old shape stays loaded (never swaps) while
       u_progress reports the NEW section's high weight — the wrong shape
       renders fully formed in the new section's spot. reading the active
       target's own weight fixes it two ways at once: it reports the
       correct (usually low, since you scrolled away) opacity for
       whatever's actually in the buffer, AND that same low value is what
       lets the swap condition below fire immediately. */
    const activeW = this.activeIndex === -1 ? 0 : weights[this.activeIndex]
    const eased = ss(activeW)

    /* only swap the target buffer while the blend is essentially at rest,
       so switching from one section's shape to the next never pops — except
       on the very first frame, which must sync immediately to wherever the
       page happens to load/refresh (there's no prior shape to protect) */
    if (bestIdx !== this.activeIndex && (eased < 0.05 || firstFrame)) {
      this.activeIndex = bestIdx
      let targetPositions = this.restPositions
      if (bestIdx !== -1) {
        const t = this.targets[bestIdx]
        if (!t.positions) t.positions = t.build(this.pointCount, this.restPositions)
        targetPositions = t.positions
      }
      this.geo.attributes.position1.array.set(targetPositions)
      this.geo.attributes.position1.needsUpdate = true
    }

    /* activeIndex may have just changed above (to bestIdx) — re-read its
       weight so u_progress always matches whatever's actually in the
       buffer now, pre- or post-swap */
    this.u_progress = this.activeIndex === -1 ? 0 : ss(weights[this.activeIndex])
    this.material.uniforms.u_progress.value = this.u_progress

    /* settle upright as a shape assembles — nobody can read a tree or a
       scale that's sideways or upside down; resume free spin once it
       dissolves back into the ambient cloud */
    const settle = this.activeIndex === -1 ? 0 : this.u_progress
    this.mesh.rotation.x = lerp(this.spinX, 0, settle)
    this.mesh.rotation.y = lerp(this.spinY, 0, settle)

    /* persistent cursor parallax — mouseX/mouseY were already tracked and
       smoothed every frame in MainScene but never actually used anywhere
       until now. layered on top of the spin/settle rotation above rather
       than replacing it, so the whole cloud (formed shape or ambient
       drift alike) tilts toward the cursor — the one thing on this page
       that responds to the user continuously, not just at scroll-triggered
       set pieces.

       same rotation angle produces a much smaller screen-space swing once
       a shape is formed — particles sit close to the rotation axis
       (worldSize=350, ~175 radius) instead of spread out like the ambient
       rest cloud (chaos-attractor scale=900). compensate by boosting the
       angle as u_progress climbs — at u_progress=0 (fully dispersed) the
       boost is exactly 1, so that state is untouched; it only ramps up as
       the shape compresses. 3 is a starting estimate, not measured against
       a live render — tune after seeing it. */
    const parallaxBoost = lerp(1, 3, this.u_progress)
    this.mesh.rotation.y += this.mouseNX * 0.16 * parallaxBoost
    this.mesh.rotation.x += -this.mouseNY * 0.16 * parallaxBoost

    if (this.activeIndex !== -1 && this.targets[this.activeIndex].sweep && compassSweepMeta) {
      this._applyCompassSweep(this.targets[this.activeIndex])
    }
    if (this.activeIndex !== -1 && this.targets[this.activeIndex].hookFishAction && hookFishMeta) {
      this._applyHookFishAction(this.targets[this.activeIndex])
    }
    if (this.activeIndex !== -1 && this.targets[this.activeIndex].kitesAction && kitesMeta) {
      this._applyKitesAction(this.targets[this.activeIndex])
    }
    if (this.activeIndex !== -1 && this.targets[this.activeIndex].owlAction && owlMeta) {
      this._applyOwlAction(this.targets[this.activeIndex])
    }
    const fingerprintActive = this.activeIndex !== -1 && this.targets[this.activeIndex].fingerprintAction && fingerprintMeta
    if (fingerprintActive) {
      this._applyFingerprintAction(this.targets[this.activeIndex])
      this._highlightActive = true
    } else if (this._highlightActive) {
      /* just switched away from the fingerprint shape — clear the shared
         highlight buffer once so its leftover values don't bleed a bright
         patch into whatever shape/cloud forms next */
      this.geo.attributes.a_highlight.array.fill(0)
      this.geo.attributes.a_highlight.needsUpdate = true
      this._highlightActive = false
    }
  }

  /* rotates the compass's moving leg around the hinge by real trigonometry
     every frame — a true arc, not a jump between two static poses — driven
     off the section's own scroll distance rather than u_progress, so it
     plays out as a distinct beat after the shape has assembled and before
     it dissolves back into the cloud */
  _applyCompassSweep(t) {
    const rect = t.el.getBoundingClientRect()
    const vh = window.innerHeight
    const dist = (rect.top + t.anchorOffset) - vh / 2

    /* single one-way ramp — opens once and holds open (no return swing)
       — then dissolves from that open pose along with the rest of the shape */
    const SWEEP_START = -20, SWEEP_END = 110
    const hump = ss(clamp((dist - SWEEP_START) / (SWEEP_END - SWEEP_START), 0, 1))
    if (hump <= 0) return

    const angle = -(22 * PI / 180) * hump
    const cos = Math.cos(angle), sin = Math.sin(angle)
    const { pivot, legMask, basePositions } = compassSweepMeta
    const arr = this.geo.attributes.position1.array

    for (let i = 0; i < legMask.length; i++) {
      if (!legMask[i]) continue
      const bi = i * 3
      const lx = basePositions[bi]     - pivot.x
      const ly = basePositions[bi + 1] - pivot.y
      arr[bi]     = pivot.x + lx * cos - ly * sin
      arr[bi + 1] = pivot.y + lx * sin + ly * cos
    }
    this.geo.attributes.position1.needsUpdate = true
  }

  /* hook+fish rise together as one unit — a straight vertical translate (no
     rotation, so no direction ambiguity like the compass/mousetrap needed
     sign fixes for), single direction, post-formation only (negative dist
     window — same pattern proven correct there). the water ripples
     continuously the whole time this shape is active, independent of
     scroll — a per-frame sine offset driven off elapsed time. */
  _applyHookFishAction(t) {
    const rect = t.el.getBoundingClientRect()
    const vh = window.innerHeight
    const dist = (rect.top + t.anchorOffset) - vh / 2

    const { waveMask, basePositions } = hookFishMeta
    const arr = this.geo.attributes.position1.array

    const PULL_START = -15, PULL_END = -90
    const pullT = ss(clamp((dist - PULL_START) / (PULL_END - PULL_START), 0, 1))
    const LIFT = 90
    const rippleTime = performance.now() * 0.0018

    for (let i = 0; i < waveMask.length; i++) {
      const bi = i * 3
      if (waveMask[i]) {
        const ripple = Math.sin(basePositions[bi] * 0.05 + rippleTime) * 6
        arr[bi + 1] = basePositions[bi + 1] + ripple
      } else {
        arr[bi + 1] = basePositions[bi + 1] + LIFT * pullT
      }
    }
    this.geo.attributes.position1.needsUpdate = true
  }

  /* both kites climb WITH scroll (single direction, post-formation only —
     same negative-dist-window technique as the hook+fish pull, not an
     automatic/time-driven rise). the sway is a true ROTATION around each
     kite's string-attachment point (its top tip), not a uniform X slide —
     that's what actually reads as "swaying like a kite" instead of
     "sliding side to side": particles near the pivot barely move while the
     tail tip (farthest from the pivot) swings through a much wider arc,
     exactly like a real kite pivoting at the end of its line. each kite's
     angle sums two out-of-sync sine waves (different, non-harmonic
     frequencies) so the motion never looks like a mechanical metronome. */
  _applyKitesAction(t) {
    const { kite1Mask, kite2Mask, basePositions } = kitesMeta
    const arr = this.geo.attributes.position1.array
    const time = performance.now() * 0.001

    const rect = t.el.getBoundingClientRect()
    const vh = window.innerHeight
    const dist = (rect.top + t.anchorOffset) - vh / 2
    /* plateau is 120, so the shape is already 100% formed the instant
       rawDist drops to 120 — start the rise right there (118, just inside
       that ceiling) and run it almost to the far edge of that same
       plateau (-118) — using essentially the whole still-100%-solid
       window for one long climb */
    const RISE_START = 118, RISE_END = -118
    const riseT = ss(clamp((dist - RISE_START) / (RISE_END - RISE_START), 0, 1))

    /* rotation around the string-attachment point (as before — the tail,
       farthest from the pivot, swings the widest arc, just like a real
       kite pivoting at the end of its line) but the swing amplitude
       itself is gust-modulated (a slow secondary sine breathing the
       amplitude up and down) plus a faster small wobble layered on top —
       together that reads as wind gusting unevenly rather than a metronome */
    const sway = (mask, pivot, freq, baseAmp, phase, gustFreq, gustPhase, riseAmount) => {
      const gust = 0.55 + 0.45 * Math.sin(time * gustFreq + gustPhase)
      const angle = Math.sin(time * freq + phase) * baseAmp * gust
                  + Math.sin(time * freq * 2.7 + phase * 1.6) * baseAmp * 0.25
      const cos = Math.cos(angle), sin = Math.sin(angle)
      const rise = riseAmount * riseT
      for (let i = 0; i < mask.length; i++) {
        if (!mask[i]) continue
        const bi = i * 3
        const lx = basePositions[bi]     - pivot.x
        const ly = basePositions[bi + 1] - pivot.y
        arr[bi]     = pivot.x + lx * cos - ly * sin
        arr[bi + 1] = pivot.y + lx * sin + ly * cos + rise
      }
    }

    sway(kite1Mask, { x: 251, y: -19.25 }, 0.5,  0.11,  0,   0.13, 0.4, 320)
    sway(kite2Mask, { x: 356, y: -26.95 }, 0.44, 0.095, 2.1, 0.11, 2.6, 340)
    this.geo.attributes.position1.needsUpdate = true
  }

  /* the owl forms with wings already closed — then, as the user keeps
     scrolling, she opens them and closes them again once (before the
     shape dissolves), all in the same post-formation dist window the
     kites/hook+fish use. openT is a single 0→1→0 hump across that window
     (sin of a 0→π ramp) instead of a one-way ramp, so it's closed at both
     ends and fully open only at the midpoint. */
  _applyOwlAction(t) {
    const { wingLeftMask, wingRightMask, pivotLeft, pivotRight, basePositions } = owlMeta
    const arr = this.geo.attributes.position1.array

    const rect = t.el.getBoundingClientRect()
    const vh = window.innerHeight
    const dist = (rect.top + t.anchorOffset) - vh / 2
    /* plateau is 100, so the shape is already 100% solid the instant
       rawDist drops to 100 — start the open/close hump right at that
       ceiling (95) and finish it well before the far side of the same
       plateau (-95) so it plays out while still fully solid */
    const FOLD_START = 95, FOLD_END = -95
    const progress = clamp((dist - FOLD_START) / (FOLD_END - FOLD_START), 0, 1)
    const openT = Math.sin(PI * progress)
    const spreadAngle = openT * (35 * PI / 180)

    const flap = (mask, pivot, angle) => {
      const cos = Math.cos(angle), sin = Math.sin(angle)
      for (let i = 0; i < mask.length; i++) {
        if (!mask[i]) continue
        const bi = i * 3
        const lx = basePositions[bi]     - pivot.x
        const ly = basePositions[bi + 1] - pivot.y
        arr[bi]     = pivot.x + lx * cos - ly * sin
        arr[bi + 1] = pivot.y + lx * sin + ly * cos
      }
    }

    flap(wingLeftMask, pivotLeft, -spreadAngle)
    flap(wingRightMask, pivotRight, spreadAngle)
    this.geo.attributes.position1.needsUpdate = true
  }

  /* the fingerprint itself never moves — position1 for this shape is
     never touched here. instead a simple horizontal scan line sweeps
     once from the top to the bottom, tied to SCROLL (not elapsed time,
     same post-formation dist window the compass sweep/owl fold/kites
     rise all use), by writing into a_highlight — the vertex shader turns
     that into a slightly larger band of points (see
     particleVertexShader), same color as always (u_color untouched).
     bandT (0 at the top, 1 at the bottom) was precomputed once in
     buildFingerprintPositions. */
  _applyFingerprintAction(t) {
    const { bandT } = fingerprintMeta
    const arr = this.geo.attributes.a_highlight.array

    /* only while fully formed — during formation/dissolve, points are
       always normal size, no exceptions, regardless of scroll position */
    if (this.u_progress < 0.999) {
      arr.fill(0)
      this.geo.attributes.a_highlight.needsUpdate = true
      return
    }

    const rect = t.el.getBoundingClientRect()
    const vh = window.innerHeight
    const dist = (rect.top + t.anchorOffset) - vh / 2
    const SCAN_START = 210, SCAN_END = -210   /* wider window (was ±95) — the scan was covering top-to-bottom over too little scroll */
    const scanT = ss(clamp((dist - SCAN_START) / (SCAN_END - SCAN_START), 0, 1))

    const BAND = 0.035  // half-width of the lit scan line, in bandT units

    for (let i = 0; i < bandT.length; i++) {
      const d = Math.abs(bandT[i] - scanT)
      arr[i] = d < BAND ? 0.5 * (1 + Math.cos(PI * d / BAND)) : 0
    }
    this.geo.attributes.a_highlight.needsUpdate = true
  }
}

// ─── WORKS CUBE ───────────────────────────────────────────────────────────────

// ─── RING SCENE — exact inkwell animation ported to a section ─────────────────

/* shaders copied verbatim from inkwell-replica */
const RING_VERT = `
  varying vec2 vUv;
  varying vec3 vNormal;
  varying vec3 vN;
  void main() {
    vUv = uv;
    vN = normal;
    vNormal = normalize(normalMatrix * normal);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`
const RING_FRAG = `
  precision highp float;
  uniform sampler2D tMap;
  uniform sampler2D tFrost;
  uniform float uOpacity;
  uniform float uAspect;
  uniform float uFrost;
  uniform float uLight;
  varying vec2 vUv;
  varying vec3 vNormal;
  varying vec3 vN;
  void main() {
    vec4 color = texture2D(tMap, vec2(vUv.x, (vUv.y - 0.5) / uAspect + 0.5));
    color.a = uOpacity;
    color.rgb *= mix(mix(0.90, 1.0, 1.0 - uFrost), 1.0, length(texture2D(tFrost, vUv).rgb));
    color.a  *= 1.0 - smoothstep(0.4, 1.0, length(vUv - 0.5) * 2.0) * 0.18 * uFrost;
    float diffuse = max(dot(vNormal, normalize(vec3(-10.0, -10.0, -1.0))), 0.0);
    color.rgb -= color.rgb * diffuse * 0.6 * uLight;
    color.rgb -= (1.0 - abs(vN.z)) * 0.2;
    gl_FragColor = color;
  }
`

/* verbatim from inkwell-replica */
const MT = [2,6,10,14,18,21,4]
const BN = [1,5,2,6,1,4,7]

/* per-card content — cards without an entry keep the numbered placeholder */
const CARD_DATA = {
  0: {
    photo:    './img/team/renato-andrade.png',
    name:     'Renato Andrade, CFP®',
    role:     'Senior Partner',
    linkedin: 'https://www.linkedin.com/in/renatoandradejunior/',
  },
  1: {
    photo:    './img/team/higo-hideki.png',
    name:     'Higo Hideki, CFP®',
    role:     'Senior Partner',
    linkedin: 'https://www.linkedin.com/in/higohideki/',
  },
  2: {
    photo:    './img/team/fernando-cieninga.png',
    name:     'Fernando Cieninga, CFP®',
    role:     'Senior Partner',
    linkedin: 'https://www.linkedin.com/in/fernando-cieninga-cfp%C2%AE-98a821ab/',
  },
  3: {
    photo:    './img/team/rodrigo-albuquerque.png',
    name:     'Rodrigo Albuquerque, CFP®',
    role:     'Senior Partner',
    linkedin: 'https://www.linkedin.com/in/rodrigo-albuquerque-cfp%C2%AE-41a1ba90/',
  },
  4: {
    photo:    './img/team/ian-moro.png',
    name:     'Ian Moro, CFP®',
    role:     'Co-Founder',
    linkedin: 'https://www.linkedin.com/in/ianmoro/',
  },
  5: {
    photo:    './img/team/gabriel-almendra.png',
    name:     'Gabriel Almendra, CFP®',
    role:     'Co-Founder',
    linkedin: 'https://www.linkedin.com/in/gabriel-almendra-cfp%C2%AE-a66798132/',
  },
  6: {
    photo:    './img/team/lucas-taxweiler.png',
    name:     'Lucas Taxweiler, CFP®',
    role:     'Co-Founder',
    linkedin: 'https://www.linkedin.com/in/lucas-taxweiler-cfp%C2%AE-b648a911a/',
  },
}

const DESIGN_WIDTH   = 60
const GRID_COLS      = 24
const GRID_ROWS      = 8
const GAP_X          = 10
const MARGIN_Y       = 105.1
const CARD_ASPECT    = 51.1 / 68.14
const RING_RADIUS_PX = 250
const TT             = 7
const CAM_Z_R        = 14
const CAM_FOV_R      = 40
const SNAP_ENABLED   = false   /* toggle the "settle on nearest card" behavior on/off */
const ZOOM_MAX_SCALE = 3.7
const ZOOM_P1_PX     = 1400
const ZOOM_P2_START  = 1400
const ZOOM_P2_PX     = 2400
const ZOOM_P3_START  = ZOOM_P2_START + ZOOM_P2_PX   // 3800
const ZOOM_P3_PX     = 800                           // termina em 4600

class RingScene {
  constructor(container, sectionEl) {
    this.container    = container
    this.sectionEl    = sectionEl
    this.W            = 0
    this.H            = 0
    this.T0           = null
    this.cards        = []
    this.ringFormed   = false
    this.localScrollY = 0
    this.sectionTop   = 0
    this.scrollRange  = 1
    this.mouseScreenX = 9999
    this.mouseScreenY = 9999
    this.linkedinTargets = []
    this.zoomP1 = 0
    this.zoomP3 = 0

    this._setup()
    this._buildCards()
    this._refreshBounds()
    this._initLinkedInClicks()

    window.addEventListener('mousemove', e => {
      this.mouseScreenX = e.clientX
      this.mouseScreenY = e.clientY
    }, { passive: true })
  }

  /* exact same px() as inkwell */
  _px(n) {
    const halfH = CAM_Z_R * Math.tan((CAM_FOV_R / 2) * PI / 180)
    return n / this.H * halfH * 2
  }

  /* exact same helpers as inkwell */
  _gridPos(col, row) {
    const px   = n => this._px(n)
    const cellW = DESIGN_WIDTH + GAP_X
    const xPx   = (col - (GRID_COLS - 1) * 0.5) * cellW
    const yPx   = lerp(this.H * 0.5 - MARGIN_Y, MARGIN_Y - this.H * 0.5, row / (GRID_ROWS - 1))
    return new THREE.Vector3(px(xPx), px(yPx), 0)
  }

  _linePos(i) {
    const px      = n => this._px(n)
    const spacing = px(DESIGN_WIDTH + GAP_X)
    const offset  = (TT - 1) * 0.5 * spacing
    return new THREE.Vector3(i * spacing - offset, 0, 0)
  }

  _ringPos(i) {
    const px    = n => this._px(n)
    const theta = (-i + TT * 0.75) * PI * 2 / TT
    const r     = px(RING_RADIUS_PX)
    return new THREE.Vector3(r * Math.cos(theta), r * Math.sin(theta), 0)
  }

  _setup() {
    /* use the wrap element's actual CSS dimensions so the canvas matches
       the layout exactly — avoids dvh vs window.innerHeight mismatches */
    const wrap = this.container.parentElement
    this.W = wrap.offsetWidth  || window.innerWidth
    this.H = wrap.offsetHeight || window.innerHeight

    this.renderer = new THREE.WebGLRenderer({ antialias: false, alpha: true })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    this.renderer.setSize(this.W, this.H)
    this.renderer.setClearColor(0x000000, 0)
    this.container.appendChild(this.renderer.domElement)

    /* fill container via CSS — eliminates any px vs dvh mismatch */
    const cv = this.renderer.domElement
    cv.style.position = 'absolute'
    cv.style.top      = '0'
    cv.style.left     = '0'
    cv.style.width    = '100%'
    cv.style.height   = '100%'

    this.scene  = new THREE.Scene()
    this.camera = new THREE.PerspectiveCamera(CAM_FOV_R, this.W / this.H, 0.1, 200)
    this.camera.position.set(0, 0, CAM_Z_R)

    /* same two-group hierarchy as inkwell */
    this.ringPivot = new THREE.Group()
    this.scene.add(this.ringPivot)
    this.cardGroup = new THREE.Group()
    this.ringPivot.add(this.cardGroup)
  }

  _makeTex(i) {
    const W = 256, H = Math.round(W / CARD_ASPECT)
    const cv = document.createElement('canvas')
    cv.width = W; cv.height = H
    const ctx = cv.getContext('2d')
    /* dark navy card matching the nirnor palette */
    const g = ctx.createLinearGradient(0, 0, 0, H)
    g.addColorStop(0, '#0d1f35')
    g.addColorStop(1, '#060f1c')
    ctx.fillStyle = g
    ctx.fillRect(0, 0, W, H)
    ctx.strokeStyle = 'rgba(255,255,255,0.10)'
    ctx.lineWidth   = 1
    ctx.strokeRect(10, 10, W - 20, H - 20)
    ctx.fillStyle   = 'rgba(255,255,255,0.55)'
    ctx.font        = '300 28px Roboto, sans-serif'
    ctx.textAlign   = 'center'
    ctx.fillText(String(i + 1).padStart(2, '0'), W / 2, H / 2 + 10)
    return new THREE.CanvasTexture(cv)
  }

  /* name + role caption, drawn as its own small texture */
  _makeCaptionTex(name, role) {
    const W = 1024, H = 340
    const cv = document.createElement('canvas')
    cv.width = W; cv.height = H
    const ctx = cv.getContext('2d')
    ctx.textAlign = 'center'
    ctx.fillStyle = '#ffffff'
    ctx.font      = '700 76px Roboto, sans-serif'
    ctx.fillText(name, W / 2, role ? 132 : 190)
    if (role) {
      ctx.fillStyle = 'rgba(255,255,255,0.8)'
      ctx.font      = '500 54px Roboto, sans-serif'
      ctx.fillText(role, W / 2, 226)
    }
    return new THREE.CanvasTexture(cv)
  }

  /* simple LinkedIn badge, drawn once and reused across cards */
  _makeLinkedInIconTex() {
    if (this._linkedinIconTex) return this._linkedinIconTex
    const S = 256
    const cv = document.createElement('canvas')
    cv.width = S; cv.height = S
    const ctx = cv.getContext('2d')
    const r = 52
    ctx.fillStyle = '#0A66C2'
    ctx.beginPath()
    ctx.moveTo(r, 8)
    ctx.arcTo(S - 8, 8, S - 8, S - 8, r)
    ctx.arcTo(S - 8, S - 8, 8, S - 8, r)
    ctx.arcTo(8, S - 8, 8, 8, r)
    ctx.arcTo(8, 8, S - 8, 8, r)
    ctx.closePath()
    ctx.fill()
    ctx.fillStyle    = '#fff'
    ctx.font         = '700 128px Arial, sans-serif'
    ctx.textAlign    = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText('in', S / 2, S / 2 + 4)
    this._linkedinIconTex = new THREE.CanvasTexture(cv)
    return this._linkedinIconTex
  }

  _buildCards() {
    const fallbackFrost = (() => {
      const d = new THREE.DataTexture(new Uint8Array([200, 200, 200, 255]), 1, 1)
      d.needsUpdate = true; return d
    })()

    const cardHalfH = 0.5 / CARD_ASPECT   /* half-height of the image plane, local units */

    for (let i = 0; i < TT; i++) {
      const data = CARD_DATA[i]
      const tex  = this._makeTex(i)
      tex.colorSpace = THREE.SRGBColorSpace

      /* exact same ShaderMaterial as inkwell (frost glass + vignette) */
      const mat = new THREE.ShaderMaterial({
        vertexShader:   RING_VERT,
        fragmentShader: RING_FRAG,
        transparent: true, depthTest: false, depthWrite: false,
        side: THREE.DoubleSide,
        uniforms: {
          tMap:     { value: tex },
          tFrost:   { value: fallbackFrost },
          uOpacity: { value: 0.0 },
          uAspect:  { value: 1.0 },
          uFrost:   { value: 0.0 },
          uLight:   { value: 0.0 },
        },
      })

      /* PlaneGeometry fallback (same as inkwell when GLB fails) */
      const geo   = new THREE.PlaneGeometry(1, 1 / CARD_ASPECT, 1, 1)
      const group = new THREE.Group()
      group.add(new THREE.Mesh(geo, mat))

      /* name/role caption + LinkedIn badge, stacked below the image —
         separate meshes in the same group so they inherit every transform
         (position, rotation, hover tilt, fade) automatically */
      let captionMat = null, iconMat = null
      let cursorY = -cardHalfH

      if (data?.name) {
        captionMat = new THREE.MeshBasicMaterial({
          map: this._makeCaptionTex(data.name, data.role),
          transparent: true, depthTest: false, depthWrite: false,
          side: THREE.DoubleSide, opacity: 0,
        })
        const capH = 0.33, capGap = 0.09   /* height matches the 1024x340 texture's own aspect — no stretch */
        cursorY -= capGap + capH
        const capMesh = new THREE.Mesh(new THREE.PlaneGeometry(1, capH, 1, 1), captionMat)
        capMesh.position.y = cursorY + capH / 2
        group.add(capMesh)
      }

      if (data?.linkedin) {
        iconMat = new THREE.MeshBasicMaterial({
          map: this._makeLinkedInIconTex(),
          transparent: true, depthTest: false, depthWrite: false,
          side: THREE.DoubleSide, opacity: 0,
        })
        const iconSize = 0.2, iconGap = 0.08
        cursorY -= iconGap + iconSize
        const iconMesh = new THREE.Mesh(new THREE.PlaneGeometry(iconSize, iconSize, 1, 1), iconMat)
        iconMesh.position.y = cursorY + iconSize / 2
        group.add(iconMesh)
        this.linkedinTargets.push({ mesh: iconMesh, url: data.linkedin })
      }

      const sz = this._px(DESIGN_WIDTH)
      group.scale.set(sz, sz, sz)

      const gp = this._gridPos(MT[i], BN[i])
      group.position.copy(gp)
      this.cardGroup.add(group)

      this.cards.push({
        group, mat, captionMat, iconMat,
        gridP: gp.clone(),
        lineP: this._linePos(i),
        ringP: this._ringPos(i),
        vel:   new THREE.Vector3(),
        fadeStart: Infinity,          /* set when section enters viewport */
        zHover: 0, zHoverV: 0, ryHover: 0, ryHoverV: 0,
      })

      /* swap in the real photo once it loads, replacing the placeholder */
      if (data?.photo) {
        new THREE.TextureLoader().load(data.photo, loaded => {
          loaded.colorSpace = THREE.SRGBColorSpace
          mat.uniforms.tMap.value.dispose()
          mat.uniforms.tMap.value = loaded
          mat.needsUpdate = true
        })
      }
    }

    /* rebuild placeholder textures once Roboto has loaded (skip real photos) */
    document.fonts.ready.then(() => {
      this.cards.forEach((c, i) => {
        if (CARD_DATA[i]?.photo) return
        c.mat.uniforms.tMap.value.dispose()
        const t = this._makeTex(i)
        t.colorSpace = THREE.SRGBColorSpace
        c.mat.uniforms.tMap.value = t
        c.mat.needsUpdate = true
      })
    })
  }

  /* click / hover handling for the LinkedIn badges — plain window listeners
     since the canvas itself is pointer-events:none (matches the existing
     mousemove-based hover tracking elsewhere in this class) */
  _initLinkedInClicks() {
    const raycaster = new THREE.Raycaster()
    const ndc = new THREE.Vector2()

    const hitTest = e => {
      if (!this.linkedinTargets.length) return null
      const rect = this.container.getBoundingClientRect()
      if (e.clientX < rect.left || e.clientX > rect.right ||
          e.clientY < rect.top  || e.clientY > rect.bottom) return null
      ndc.x = ((e.clientX - rect.left) / rect.width)  * 2 - 1
      ndc.y = -((e.clientY - rect.top) / rect.height) * 2 + 1
      raycaster.setFromCamera(ndc, this.camera)
      const hits = raycaster.intersectObjects(this.linkedinTargets.map(t => t.mesh))
      if (!hits.length) return null
      return this.linkedinTargets.find(t => t.mesh === hits[0].object) || null
    }

    window.addEventListener('click', e => {
      const target = hitTest(e)
      if (target) window.open(target.url, '_blank', 'noopener')
    })

    window.addEventListener('pointermove', e => {
      document.body.style.cursor = hitTest(e) ? 'pointer' : ''
    }, { passive: true })
  }

  _refreshBounds() {
    let el = this.sectionEl, top = 0
    while (el) { top += el.offsetTop; el = el.offsetParent }
    this.sectionTop  = top
    this.scrollRange = Math.max(1, this.sectionEl.offsetHeight - window.innerHeight)
  }

  /* inverts ss(x) = x*x*(3-2x) via bisection — used to find the exact
     scroll position where a given card sits dead-center ("spot" = 1) */
  _invSmoothstep(v) {
    let lo = 0, hi = 1
    for (let k = 0; k < 20; k++) {
      const mid = (lo + hi) / 2
      if (ss(mid) < v) lo = mid; else hi = mid
    }
    return (lo + hi) / 2
  }

  /* local scrollY (relative to section top) where card i is fully centered */
  cardSnapLocalY(i) {
    const v = TT > 1 ? i / (TT - 1) : 0
    return ZOOM_P2_START + this._invSmoothstep(v) * ZOOM_P2_PX
  }

  /* nearest card snap point to a given local scrollY, or null if outside
     the card-passing window (still zooming in/out) */
  nearestSnapLocalY(localScrollY) {
    if (!this.ringFormed) return null
    if (localScrollY < ZOOM_P2_START || localScrollY > ZOOM_P3_START) return null
    let best = null, bestDist = Infinity
    for (let i = 0; i < TT; i++) {
      const y = this.cardSnapLocalY(i)
      const d = Math.abs(y - localScrollY)
      if (d < bestDist) { bestDist = d; best = y }
    }
    return best
  }

  /* sineInOut — same as inkwell proximity hover */
  _sineInOut(x) { return -(Math.cos(PI * x) - 1) / 2 }

  /* exact same proximity hover logic as inkwell (updateMouseEffect) */
  _updateMouseEffect(toRing, p2, p3) {
    /* off only while actually passing through the cards; on during the
       zoom-in, during the zoom-out, and once everything has settled */
    const passingCards = (p2 || 0) > 0 && (p3 || 0) <= 0
    const force = ss(clamp(toRing * 3 - 2, 0, 1)) * (passingCards ? 0 : 1)
    if (force < 0.001) {
      for (const c of this.cards) {
        c.zHover = 0; c.zHoverV = 0; c.ryHover = 0; c.ryHoverV = 0
        c.group.position.z = 0; c.group.rotation.y = 0
      }
      this.cardGroup.rotation.x = 0; this.cardGroup.rotation.z = 0
      return
    }

    const px = n => this._px(n)
    const N  = PI * 0.45 * RING_RADIUS_PX   /* influence radius in screen-px */

    const cx = this.W * 0.5, cy = this.H * 0.5
    const mx = this.mouseScreenX - cx
    const my = cy - this.mouseScreenY

    for (let i = 0; i < this.cards.length; i++) {
      const c     = this.cards[i]
      const theta = (-i + TT * 0.75) * PI * 2 / TT
      const cardX = RING_RADIUS_PX * Math.cos(theta)
      const cardY = RING_RADIUS_PX * Math.sin(theta)

      const dx = cardX - mx, dy = cardY - my
      const R  = Math.sqrt(dx * dx + dy * dy)
      const G  = this._sineInOut(clamp(1 - R / N, 0, 1)) * force

      const zTarget  = px(90) * G
      c.zHoverV  = c.zHoverV  * 0.74 + (zTarget  - c.zHover)  * 0.18
      c.zHover  += c.zHoverV

      const ryTarget = PI * 0.7 * G
      c.ryHoverV = c.ryHoverV * 0.74 + (ryTarget - c.ryHover) * 0.18
      c.ryHover += c.ryHoverV

      c.group.position.z = c.zHover
      c.group.rotation.y = c.ryHover
    }

    const normX = clamp(mx / (this.W * 0.5), -1, 1)
    this.cardGroup.rotation.x = lerp(this.cardGroup.rotation.x, normX * PI * 0.032 * force, 0.05)
    this.cardGroup.rotation.z = lerp(this.cardGroup.rotation.z, normX * PI * 0.035 * force, 0.05)
  }

  updateScroll(scrollY) {
    this.localScrollY = clamp(scrollY - this.sectionTop, 0, this.scrollRange)

    /* the ring only starts forming once the section has actually been
       scrolled into its pinned position — which happens to be the exact
       same moment the background particle columns finish assembling.

       but this fires on EVERY scroll update, section visible or not — on
       a refresh (or a direct link) that lands already past this section,
       the browser's own scroll restoration delivers a large localScrollY
       on the very first reading, which used to start the same multi-second
       reveal (and the scroll lock riding on it, see App._lockScroll)
       completely off-screen, trapping scroll on a page the user can't
       even see playing out. if the first-ever reading is already well
       past the start of the section, skip the reveal outright — backdate
       T0 far enough that toLine/toRing both read as already-complete on
       the very next frame, so ringFormed flips true before the lock ever
       gets a chance to engage. */
    if (this.localScrollY > 0 && this.T0 === null) {
      const startedAlreadyPast = this.localScrollY > 20
      this.T0 = startedAlreadyPast ? performance.now() - 10000 : performance.now()
      this.cards.forEach((c, i) => {
        c.fadeStart = startedAlreadyPast ? this.T0 : this.T0 + i * 200
      })
    }
  }

  resize() {
    const wrap = this.container.parentElement
    this.W = wrap.offsetWidth  || window.innerWidth
    this.H = wrap.offsetHeight || window.innerHeight
    this.camera.aspect = this.W / this.H
    this.camera.updateProjectionMatrix()
    this.renderer.setSize(this.W, this.H)
    this._refreshBounds()
    /* recompute positions for new viewport — exact same as inkwell onResize */
    for (let i = 0; i < this.cards.length; i++) {
      this.cards[i].gridP = this._gridPos(MT[i], BN[i])
      this.cards[i].lineP = this._linePos(i)
      this.cards[i].ringP = this._ringPos(i)
      const sz = this._px(DESIGN_WIDTH)
      this.cards[i].group.scale.set(sz, sz, sz)
    }
  }

  update() {
    const now = performance.now()
    const px  = n => this._px(n)

    /* ── entrance fade — exact same as inkwell (500ms, ss) ── */
    for (let i = 0; i < this.cards.length; i++) {
      const c = this.cards[i]
      const fadeT = clamp((now - c.fadeStart) / 500, 0, 1)
      const op = ss(fadeT)
      c.mat.uniforms.uOpacity.value = op
      if (c.captionMat) c.captionMat.opacity = op
      if (c.iconMat) c.iconMat.opacity = op
    }

    if (this.T0 === null) { this.renderer.render(this.scene, this.camera); return }

    const t = now - this.T0

    /* exact same timing as inkwell */
    const toLine = ss(clamp((t - 1700) / 1300, 0, 1))
    const toRing = ss(clamp((t - 3200) / 1400, 0, 1))

    this.cardGroup.rotation.y = 0

    /* scroll phases — driven by local section scroll */
    const p1raw = this.ringFormed ? clamp(this.localScrollY / ZOOM_P1_PX, 0, 1) : 0
    const p2raw = this.ringFormed ? clamp((this.localScrollY - ZOOM_P2_START) / ZOOM_P2_PX, 0, 1) : 0
    const p3raw = this.ringFormed ? clamp((this.localScrollY - ZOOM_P3_START) / ZOOM_P3_PX, 0, 1) : 0
    const p1 = ss(p1raw)
    const p2 = ss(p2raw)
    const p3 = ss(p3raw)
    /* exposed so the background particle camera can zoom in lockstep with
       the ring instead of sitting as a totally separate, static layer */
    this.zoomP1 = p1
    this.zoomP3 = p3

    /* ── per-card spring + radial rotation — exact same as inkwell ── */
    for (let i = 0; i < this.cards.length; i++) {
      const c     = this.cards[i]
      const theta = (-i + TT * 0.75) * PI * 2 / TT

      let tx, ty
      if (toRing > 0) {
        tx = lerp(c.lineP.x, c.ringP.x, toRing)
        ty = lerp(c.lineP.y, c.ringP.y, toRing)
      } else {
        tx = lerp(c.gridP.x, c.lineP.x, toLine)
        ty = lerp(c.gridP.y, c.lineP.y, toLine)
      }

      /* stiffness 0.10, damping 0.78 — verbatim from inkwell */
      c.vel.x += (tx - c.group.position.x) * 0.10
      c.vel.y += (ty - c.group.position.y) * 0.10
      c.vel.multiplyScalar(0.78)
      c.group.position.x += c.vel.x
      c.group.position.y += c.vel.y

      /* radial Z rotation */
      const radialRZ = toRing > 0 ? (theta + PI * 0.5) : 0
      c.group.rotation.z = lerp(c.group.rotation.z, radialRZ, 0.06)
    }

    this._updateMouseEffect(toRing, p2, p3)

    /* ── Phase 1: zoom aimed at ring bottom — exact same as inkwell ── */
    if (toRing > 0.5) {
      const scale = lerp(1, ZOOM_MAX_SCALE, p1)
      this.ringPivot.scale.setScalar(scale)
      this.ringPivot.position.y = scale * px(RING_RADIUS_PX) * p1
      this.camera.position.y    = 0
    }

    /* ── Phase 2: ring spins — spotlight opacity (sem z-zoom) ── */
    if (this.ringFormed && p2 > 0) {
      const maxRot = (TT - 1) / TT * PI * 2
      this.ringPivot.rotation.z = p2 * maxRot

      for (let i = 0; i < this.cards.length; i++) {
        const c       = this.cards[i]
        const alpha_i = i * PI * 2 / TT
        let   dist    = (p2 * maxRot) - alpha_i
        dist = ((dist % (2 * PI)) + 3 * PI) % (2 * PI) - PI
        const spot    = Math.max(0, 1 - Math.abs(dist) / (PI / TT))
        c.mat.uniforms.uOpacity.value = lerp(0.18, 1.0, spot)
      }
    } else if (this.ringFormed) {
      this.ringPivot.rotation.z = lerp(this.ringPivot.rotation.z, 0, 0.08)
    }

    /* ── Phase 3: zoom out — mostra a circunferência inteira ── */
    if (this.ringFormed && p3 > 0) {
      this.ringPivot.scale.setScalar(lerp(ZOOM_MAX_SCALE, 1, p3))
      this.ringPivot.position.y = lerp(ZOOM_MAX_SCALE * px(RING_RADIUS_PX), 0, p3)

      const maxRot = (TT - 1) / TT * PI * 2
      for (let i = 0; i < this.cards.length; i++) {
        const c       = this.cards[i]
        const alpha_i = i * PI * 2 / TT
        let   dist    = maxRot - alpha_i
        dist = ((dist % (2 * PI)) + 3 * PI) % (2 * PI) - PI
        const spot    = Math.max(0, 1 - Math.abs(dist) / (PI / TT))
        c.mat.uniforms.uOpacity.value = lerp(lerp(0.18, 1.0, spot), 1.0, p3)
      }
    }

    /* ── unlock section scroll once ring fully formed ── */
    if (toRing >= 0.999 && !this.ringFormed) this.ringFormed = true

    this.renderer.render(this.scene, this.camera)
  }
}

// ─── LETTER ANIMATION ─────────────────────────────────────────────────────────

function initLetterAnimation() {
  const elements = document.querySelectorAll('[data-animate]')

  elements.forEach(el => {
    const text = el.textContent
    el.textContent = ''
    el.style.display = 'inline'

    text.split(/(\s+)/).forEach(token => {
      if (token === '') return
      if (/^\s+$/.test(token)) {
        el.appendChild(document.createTextNode(token))
        return
      }
      const wordWrap = document.createElement('span')
      wordWrap.style.display = 'inline-block'
      Array.from(token).forEach(char => {
        const wrap = document.createElement('span')
        wrap.className = 'char-wrap'
        const span = document.createElement('span')
        span.className = 'char'
        span.textContent = char
        span.style.transitionDelay = `${Math.random() * 0.4}s`
        wrap.appendChild(span)
        wordWrap.appendChild(wrap)
      })
      el.appendChild(wordWrap)
    })
  })

  const observer = new IntersectionObserver(entries => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.querySelectorAll('.char').forEach(c => c.classList.add('visible'))
        observer.unobserve(entry.target)
      }
    })
  }, { threshold: 0.1 })

  elements.forEach(el => observer.observe(el))
}

// ─── SERVICE ACCORDION ────────────────────────────────────────────────────────

function initServiceAccordion() {
  const items = document.querySelectorAll('.service-item')
  items.forEach(item => {
    const btn = item.querySelector('.service-btn')
    if (!btn) return
    btn.addEventListener('click', () => {
      const isActive = item.classList.contains('active')
      items.forEach(i => i.classList.remove('active'))
      if (!isActive) item.classList.add('active')
    })
  })
}

// ─── TOPICS ACCORDION ─────────────────────────────────────────────────────────

function initTopicsAccordion() {
  const items = document.querySelectorAll('.topics-item')
  items.forEach(item => {
    const btn = item.querySelector('.topics-btn')
    if (!btn) return
    btn.addEventListener('click', () => {
      item.classList.toggle('open')
    })
  })
}

// ─── FADE-UP ANIMATION ────────────────────────────────────────────────────────

/* continuous scroll-linked focus: each element is only at full clarity while
   it's near the vertical center of the viewport, and dims/blurs as it moves
   away either direction — instead of the old "fades in once, stays forever"
   behavior, which let several paragraphs sit at full opacity simultaneously
   and compete for attention */
function initFadeUp() {
  const els = Array.from(document.querySelectorAll('[data-fade-up]'))
  if (!els.length) return () => {}

  /* FAQ section keeps the opacity/translateY reveal but not the blur —
     precomputed once so the per-frame loop below doesn't need a closest()
     lookup every tick */
  const skipBlur = els.map(el => !!el.closest('.faq-section'))

  return () => {
    const vh = window.innerHeight
    for (let i = 0; i < els.length; i++) {
      const el = els[i]
      const rect = el.getBoundingClientRect()
      if (rect.bottom < -200 || rect.top > vh + 200) continue   /* skip far-offscreen elements */
      const centerY = rect.top + rect.height / 2
      const dist = centerY - vh / 2
      const range = vh * 0.42
      const weight = clamp(1 - Math.abs(dist) / range, 0, 1)
      const eased = ss(weight)
      el.style.opacity   = eased
      if (!skipBlur[i]) el.style.filter = `blur(${(1 - eased) * 9}px)`
      el.style.transform = `translateY(${dist * 0.06}px)`
    }
  }
}

// ─── QUIZ ─────────────────────────────────────────────────────────────────────

function initQuiz() {
  const quiz = document.getElementById('analise-quiz')
  if (!quiz) return

  const TOTAL = 6
  let current = 1
  const answers = {}

  const barFill = document.getElementById('quiz-bar-fill')
  const label   = document.getElementById('quiz-label')
  const btnNext = document.getElementById('quiz-next')
  const btnBack = document.getElementById('quiz-back')
  const navEl   = document.getElementById('quiz-nav')

  function updateHeader() {
    barFill.style.width = `${(current / TOTAL) * 100}%`
    label.textContent = current <= TOTAL ? `ETAPA ${current} DE ${TOTAL}` : ''
  }

  function goTo(next) {
    const curEl  = quiz.querySelector(`.quiz-step[data-step="${current}"]`)
    const nextEl = quiz.querySelector(`.quiz-step[data-step="${next}"]`)
    if (!curEl || !nextEl) return
    curEl.classList.add('quiz-leaving')
    setTimeout(() => {
      curEl.classList.remove('active', 'quiz-leaving')
      nextEl.classList.add('active')
      current = next
      btnBack.style.display = current > 1 ? 'inline' : 'none'
      btnNext.textContent = current === TOTAL ? 'CONCLUIR →' : 'AVANÇAR →'
      btnNext.disabled = !answers[current]
      navEl.style.display = current > TOTAL ? 'none' : 'flex'
      updateHeader()
    }, 280)
  }

  quiz.addEventListener('click', e => {
    const opt = e.target.closest('.quiz-opt')
    if (!opt) return
    opt.closest('.quiz-step').querySelectorAll('.quiz-opt').forEach(o => o.classList.remove('selected'))
    opt.classList.add('selected')
    answers[current] = opt.textContent.trim()
    btnNext.disabled = false
  })

  btnNext.addEventListener('click', () => {
    if (btnNext.disabled) return
    if (current <= TOTAL) goTo(current + 1)
  })

  btnBack.addEventListener('click', () => {
    if (current > 1) goTo(current - 1)
  })

  updateHeader()
}

// ─── FAQ ACCORDION ────────────────────────────────────────────────────────────

function initFaqAccordion() {
  const items = document.querySelectorAll('.faq-item')
  items.forEach(item => {
    const btn = item.querySelector('.faq-btn')
    if (!btn) return
    btn.addEventListener('click', () => {
      const isOpen = item.classList.contains('open')
      items.forEach(i => i.classList.remove('open'))
      if (!isOpen) item.classList.add('open')
    })
  })
}

// ─── MOBILE MENU ──────────────────────────────────────────────────────────────

function initMobileMenu() {
  const btn = document.getElementById('hamburger')
  const menu = document.getElementById('mobile-menu')
  if (!btn || !menu) return

  btn.addEventListener('click', () => {
    const open = btn.classList.toggle('open')
    menu.classList.toggle('open', open)
    document.body.style.overflow = open ? 'hidden' : ''
  })

  menu.querySelectorAll('.mobile-link').forEach(link => {
    link.addEventListener('click', () => {
      btn.classList.remove('open')
      menu.classList.remove('open')
      document.body.style.overflow = ''
    })
  })
}

// ─── MAIN APP ─────────────────────────────────────────────────────────────────

class App {
  constructor() {
    this.scrollY = 0
    this.raf = null
    this.lastTime = 0
    this._scrollLocked = false

    // Init UI features first
    initLetterAnimation()
    this._updateFadeUp = initFadeUp()
    initQuiz()
    initServiceAccordion()
    initFaqAccordion()
    initMobileMenu()

    // Init Lenis (graceful fallback if CDN fails)
    if (typeof Lenis !== 'undefined') {
      this.lenis = new Lenis({ autoRaf: false, syncTouch: true, lerp: 0.06 })
      this.lenis.on('scroll', ({ scroll }) => {
        this.scrollY = scroll
        if (this.mainScene) this.mainScene.updateScroll(scroll)
        if (this.ringScene) this.ringScene.updateScroll(scroll)
        this._scheduleSnap()
        this._updateHeaderVisibility(scroll)
      })
    } else {
      this.lenis = null
      window.addEventListener('scroll', () => {
        this.scrollY = window.scrollY
        if (this.mainScene) this.mainScene.updateScroll(window.scrollY)
        if (this.ringScene) this.ringScene.updateScroll(window.scrollY)
        this._scheduleSnap()
        this._updateHeaderVisibility(window.scrollY)
      }, { passive: true })
    }

    // Init main particle background
    const webglContainer = document.getElementById('webgl-container')
    if (webglContainer) {
      this.mainScene = new MainScene(webglContainer)
    }

    // Init ring scene
    const darkContainer = document.getElementById('dark-canvas-container')
    const darkSection   = document.getElementById('dark-section')
    if (darkContainer && darkSection) {
      requestAnimationFrame(() => {
        this.ringScene = new RingScene(darkContainer, darkSection)
      })
    }

    this.darkSection = darkSection

    // Init projector widget (persistent 3D link to the cinema page)
    const projectorContainer = document.getElementById('cinema-projector')
    if (projectorContainer) {
      this.projectorWidget = new ProjectorWidget(projectorContainer)
    }

    // Header hide-on-scroll-down / show-on-scroll-up
    this.header = document.querySelector('header')
    this._lastScrollY = 0

    // Resize handler
    window.addEventListener('resize', () => this._onResize())

    // Start loop
    this._loop(0)
  }

  _onResize() {
    if (this.mainScene) this.mainScene.resize()
    if (this.ringScene) this.ringScene.resize()
  }

  _updateHeaderVisibility(scroll) {
    if (!this.header) return
    const delta = scroll - this._lastScrollY

    /* always show near the top, ignore tiny jitter, hide on scroll down */
    if (scroll < 80) {
      this.header.classList.remove('header-hidden')
    } else if (delta > 4) {
      this.header.classList.add('header-hidden')
    } else if (delta < -4) {
      this.header.classList.remove('header-hidden')
    }

    this._lastScrollY = scroll
  }

  /* freezes scroll for the ring's one-time entrance animation (cards
     appearing → forming the line → forming the circle). without this, the
     zoom phases stay mathematically gated behind ringFormed (see
     RingScene.update — p1/p2/p3 are forced to 0 until then), but
     localScrollY keeps climbing in the background the whole time the user
     keeps scrolling through that ~4.6s animation; the instant ringFormed
     flips true, the zoom snaps straight to wherever that already-advanced
     scroll position is instead of starting from 0 — exactly the "brusco"
     jump being fixed here. locking scroll for the animation's duration
     keeps localScrollY pinned near 0 until it's actually safe to move. */
  _lockScroll() {
    this._scrollLocked = true
    if (this.lenis) this.lenis.stop()
    else document.body.style.overflow = 'hidden'
    /* failsafe: the animation this locks for is ~4.6s, so anything still
       locked well past that is a bug, not the intended wait — never trap
       the user's scroll indefinitely no matter what went wrong upstream */
    clearTimeout(this._scrollLockFailsafe)
    this._scrollLockFailsafe = setTimeout(() => {
      if (this._scrollLocked) this._unlockScroll()
    }, 6000)
  }

  _unlockScroll() {
    this._scrollLocked = false
    clearTimeout(this._scrollLockFailsafe)
    if (this.lenis) this.lenis.start()
    else document.body.style.overflow = ''
  }

  /* debounce: correct the resting scroll position to the nearest card once
     scrolling actually stops — never intercepts or slows down live scrolling */
  _scheduleSnap() {
    if (!SNAP_ENABLED) return
    clearTimeout(this._snapTimer)
    this._snapTimer = setTimeout(() => this._trySnap(), 140)
  }

  _trySnap() {
    const rs = this.ringScene
    if (!rs) return
    const snapLocalY = rs.nearestSnapLocalY(rs.localScrollY)
    if (snapLocalY === null) return
    if (Math.abs(snapLocalY - rs.localScrollY) < 2) return

    const targetY = rs.sectionTop + snapLocalY
    if (this.lenis) {
      this.lenis.scrollTo(targetY, { duration: 0.6 })
    } else {
      window.scrollTo({ top: targetY, behavior: 'smooth' })
    }
  }


  _loop(time) {
    this.raf = requestAnimationFrame(t => this._loop(t))

    if (this.lenis) this.lenis.raf(time)

    // Three.js capped at 90fps
    if (time - this.lastTime < 1000 / 90) return
    this.lastTime = time

    const dt = time - this.lastTime

    // Main particle background
    if (this.mainScene) this.mainScene.update(dt)

    // Scroll-linked paragraph focus
    if (this._updateFadeUp) this._updateFadeUp()

    // Ring scene
    const darkSec = this.darkSection
    if (darkSec) {
      const rect = darkSec.getBoundingClientRect()
      const vh   = window.innerHeight

      if (this.ringScene && rect.bottom > 0 && rect.top < vh) {
        this.ringScene.update()

        const introPlaying = this.ringScene.T0 !== null && !this.ringScene.ringFormed
        if (introPlaying && !this._scrollLocked) this._lockScroll()
        else if (!introPlaying && this._scrollLocked) this._unlockScroll()
      }

      /* the background particles zoom in lockstep with the ring, so the
         ones parked at the screen edges get pushed out of frame for real
         instead of just sitting there while the ring zooms independently */
      if (this.ringScene && this.mainScene) {
        const zoomWeight = this.ringScene.zoomP1 * (1 - this.ringScene.zoomP3)
        this.mainScene.setBackgroundZoom(zoomWeight)
      }
    }
  }
}

// Boot when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => new App())
} else {
  new App()
}
