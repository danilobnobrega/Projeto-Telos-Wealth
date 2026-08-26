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

const particleVertexShader = `
in vec3 position;
in vec3 position1;
uniform mat4 modelViewMatrix;
uniform mat4 projectionMatrix;
uniform float u_progress;
void main() {
  vec3 finalPosition = mix(position, position1, u_progress);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(finalPosition, 1.0);
  gl_PointSize = 1.0;
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

class ProjectorWidget {
  constructor(container) {
    this.container = container
    this.width = PROJECTOR_CANVAS_PX
    this.height = PROJECTOR_CANVAS_PX
    this.mouseX = window.innerWidth / 2
    this.mouseY = window.innerHeight / 2
    this.raycaster = new THREE.Raycaster()
    this.ndc = new THREE.Vector2()

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
      this.camDist = dist
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
    build: count => createChaosAttractorPositions(
      900, count, 400,
      -0.9177339853982867, 1.5409458316723406,
      2.279682707438794, 1.3641950476985585,
      1.9459875364821286, -0.20186017310569326
    ),
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
    this.geo = geo

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
      .map(s => ({ el: document.querySelector(s.selector), build: s.build, mode: s.mode, sweep: s.sweep, hookFishAction: s.hookFishAction, kitesAction: s.kitesAction, owlAction: s.owlAction, plateau: s.plateau ?? 0, positions: null, wantOffset: s.anchorOffset ?? 550 }))
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
