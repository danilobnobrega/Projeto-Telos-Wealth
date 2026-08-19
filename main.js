import * as THREE from 'three'

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

/* solid crystal dome magnifier — a low, round glass disc (the classic
   "reading stone"), not a rectangular block or a handled lens: a flattened
   ellipse with a concentric rim groove punched through it, the same way
   the notepad's spiral rings read as gaps rather than a solid blob */
function drawCrystalMagnifierIcon(ctx, W, H) {
  ctx.fillStyle = '#fff'
  const cx = W / 2, cy = H * 0.52
  const rx = W * 0.34, ry = rx * 0.82   /* low dome profile, not a full sphere */

  ctx.beginPath()
  ctx.ellipse(cx, cy, rx, ry, 0, 0, PI * 2)
  ctx.fill()

  ctx.globalCompositeOperation = 'destination-out'
  ctx.lineWidth = 9
  ctx.beginPath()
  ctx.ellipse(cx, cy, rx * 0.74, ry * 0.74, 0, 0, PI * 2)
  ctx.stroke()
}

/* volume cue for the magnifier: particles near the center of the dome are
   both pushed toward the camera (real z bulge, hemisphere profile) AND
   rendered as bigger points — size is what the eye actually reads as depth
   in a 1px point cloud, brightness alone (tried before) is imperceptible
   at that scale. scaleMap is read every frame by the swap-guard in
   update() to populate the pointScale1 attribute. */
let magnifierScaleMap = null

function buildMagnifierPositions(count) {
  const RES = 512, worldSize = 350, xOffset = 180
  const cv = document.createElement('canvas')
  cv.width = RES; cv.height = RES
  const ctx = cv.getContext('2d')
  ctx.clearRect(0, 0, RES, RES)
  drawCrystalMagnifierIcon(ctx, RES, RES)

  const img = ctx.getImageData(0, 0, RES, RES).data
  const filled = []
  for (let y = 0; y < RES; y++) {
    for (let x = 0; x < RES; x++) {
      if (img[(y * RES + x) * 4 + 3] > 40) filled.push(x, y)
    }
  }

  const half = worldSize / 2
  const result = new Float32Array(count * 3)
  const scaleMap = new Float32Array(count).fill(1.0)
  const domeCx = RES / 2, domeCy = RES * 0.52
  const domeRx = RES * 0.34, domeRy = domeRx * 0.82
  const maxBulge = 55

  if (filled.length > 0) {
    for (let i = 0; i < count; i++) {
      const idx = (Math.random() * (filled.length / 2) | 0) * 2
      const px = filled[idx], py = filled[idx + 1]
      const jx = (Math.random() - 0.5) * (worldSize / RES) * 1.6
      const jy = (Math.random() - 0.5) * (worldSize / RES) * 1.6
      result[i * 3]     = (px / RES) * worldSize - half + jx + xOffset
      result[i * 3 + 1] = -((py / RES) * worldSize - half) + jy

      const nx = (px - domeCx) / domeRx
      const ny = (py - domeCy) / domeRy
      const distNorm = Math.min(1, Math.sqrt(nx * nx + ny * ny))
      const bulge = Math.sqrt(Math.max(0, 1 - distNorm * distNorm)) * maxBulge
      result[i * 3 + 2] = bulge + (Math.random() - 0.5) * 10
      scaleMap[i] = lerp(3.0, 0.9, distNorm)
    }
  } else {
    for (let i = 0; i < count; i++) {
      result[i * 3]     = (Math.random() - 0.5) * worldSize + xOffset
      result[i * 3 + 1] = (Math.random() - 0.5) * worldSize
      result[i * 3 + 2] = (Math.random() - 0.5) * 25
    }
  }

  magnifierScaleMap = scaleMap
  return result
}

function drawShieldIcon(ctx, W, H) {
  ctx.fillStyle = '#fff'
  const cx = W / 2
  const top = H * 0.14, bottom = H * 0.88
  const hw = W * 0.30
  const midY = (top + bottom) / 2
  ctx.beginPath()
  ctx.moveTo(cx, top)
  ctx.bezierCurveTo(cx + hw, top, cx + hw, top + (bottom - top) * 0.15, cx + hw, midY)
  ctx.bezierCurveTo(cx + hw, bottom - (bottom - top) * 0.12, cx + hw * 0.5, bottom - 24, cx, bottom)
  ctx.bezierCurveTo(cx - hw * 0.5, bottom - 24, cx - hw, bottom - (bottom - top) * 0.12, cx - hw, midY)
  ctx.bezierCurveTo(cx - hw, top + (bottom - top) * 0.15, cx - hw, top, cx, top)
  ctx.closePath()
  ctx.fill()
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
  const RES = 512, worldSize = 350, depthJitter = 25, xOffset = 180
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

/* pointScale0/pointScale1 default to 1.0 (today's fixed point size) for every
   shape — only the magnifier's build writes real values into pointScale1
   (see magnifierScaleMap), so this is invisible everywhere else */
const particleVertexShader = `
in vec3 position;
in vec3 position1;
in float pointScale0;
in float pointScale1;
uniform mat4 modelViewMatrix;
uniform mat4 projectionMatrix;
uniform float u_progress;
void main() {
  vec3 finalPosition = mix(position, position1, u_progress);
  float pScale = mix(pointScale0, pointScale1, u_progress);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(finalPosition, 1.0);
  gl_PointSize = pScale;
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

const PARTICLE_COLOR_LIGHT = [0.8, 0.8, 0.8]         /* soft gray, subtle on white */
const PARTICLE_COLOR_DARK  = [0.30, 0.48, 0.45]      /* muted petrol/teal green, on black */

// ─── MAIN WEBGL SCENE ─────────────────────────────────────────────────────────

class MainScene {
  constructor(container) {
    this.container = container
    this.width = window.innerWidth
    this.height = window.innerHeight
    this.scrollY = 0
    this.mouseX = 0
    this.mouseY = 0
    this.targetMouseX = 0
    this.targetMouseY = 0

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
    const isDark = document.documentElement.dataset.theme === 'dark'
    this.renderer.setClearColor(isDark ? 0x000000 : 0xffffff, 1)
    this.container.appendChild(this.renderer.domElement)

    window.addEventListener('themechange', e => {
      this.renderer.setClearColor(e.detail.theme === 'dark' ? 0x000000 : 0xffffff, 1)
    })
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
    this.particles.update()
    this.worksCubes.forEach(c => c.update(this.scrollY))
    this.renderer.render(this.scene, this.camera)
  }
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
    build: count => buildMagnifierPositions(count),
    hasVolume: true,   /* bigger + closer at the center, smaller + flatter at the rim */
  },
  {
    selector: '.feeonly-section',
    anchorOffset: 370,   /* a bit higher than the shared default */
    build: count => silhouettePositions(drawShieldIcon, count, 350, 25, 180),
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
    const neutralScale = new Float32Array(this.pointCount).fill(1.0)
    geo.setAttribute('pointScale0', new THREE.BufferAttribute(neutralScale, 1))
    geo.setAttribute('pointScale1', new THREE.BufferAttribute(neutralScale.slice(), 1))
    this.geo = geo

    const isDark = document.documentElement.dataset.theme === 'dark'
    const startColor = isDark ? PARTICLE_COLOR_DARK : PARTICLE_COLOR_LIGHT

    this.material = new THREE.RawShaderMaterial({
      vertexShader: particleVertexShader,
      fragmentShader: particleFragmentShader,
      glslVersion: THREE.GLSL3,
      uniforms: {
        u_progress: { value: this.u_progress },
        u_color:    { value: new THREE.Vector3(...startColor) },
      }
    })
    this.mesh = new THREE.Points(geo, this.material)
    this.scene.add(this.mesh)

    window.addEventListener('themechange', e => {
      const c = e.detail.theme === 'dark' ? PARTICLE_COLOR_DARK : PARTICLE_COLOR_LIGHT
      this.material.uniforms.u_color.value.set(...c)
    })

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
      .map(s => ({ el: document.querySelector(s.selector), build: s.build, mode: s.mode, sweep: s.sweep, hasVolume: s.hasVolume, plateau: s.plateau ?? 0, positions: null, wantOffset: s.anchorOffset ?? 550 }))
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

  update() {
    this.spinX = (this.spinX + PI / 180 / 30) % (2 * PI)
    this.spinY = (this.spinY + PI / 180 / 30) % (2 * PI)
    this.mesh.position.y = -this.smoothScrollY

    /* zoom in lockstep with the ring — pushes edge-parked particles out of
       frame for real, instead of them sitting static while the ring (a
       completely separate scene/camera) zooms on its own */
    const zoomScale = lerp(1, 3.5, this.zoomWeight || 0)
    this.mesh.scale.setScalar(zoomScale)

    if (!this.targets) this._resolveTargets()

    const vh = window.innerHeight
    let bestW = 0, bestIdx = -1
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
      if (w > bestW) { bestW = w; bestIdx = i }
    })

    const eased = ss(bestW)
    const firstFrame = !this.hasSynced
    this.hasSynced = true

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

      /* point-size volume cue — only the shapes that build a real map (see
         magnifierScaleMap) get anything other than the flat default size */
      if (bestIdx !== -1 && this.targets[bestIdx].hasVolume && magnifierScaleMap) {
        this.geo.attributes.pointScale1.array.set(magnifierScaleMap)
      } else {
        this.geo.attributes.pointScale1.array.fill(1.0)
      }
      this.geo.attributes.pointScale1.needsUpdate = true
    }

    this.u_progress = this.activeIndex === -1 ? 0 : eased
    this.material.uniforms.u_progress.value = this.u_progress

    /* settle upright as a shape assembles — nobody can read a tree or a
       scale that's sideways or upside down; resume free spin once it
       dissolves back into the ambient cloud */
    const settle = this.activeIndex === -1 ? 0 : this.u_progress
    this.mesh.rotation.x = lerp(this.spinX, 0, settle)
    this.mesh.rotation.y = lerp(this.spinY, 0, settle)

    if (this.activeIndex !== -1 && this.targets[this.activeIndex].sweep && compassSweepMeta) {
      this._applyCompassSweep(this.targets[this.activeIndex])
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
       same moment the background particle columns finish assembling */
    if (this.localScrollY > 0 && this.T0 === null) {
      this.T0 = performance.now()
      this.cards.forEach((c, i) => { c.fadeStart = this.T0 + i * 200 })
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

  return () => {
    const vh = window.innerHeight
    for (const el of els) {
      const rect = el.getBoundingClientRect()
      if (rect.bottom < -200 || rect.top > vh + 200) continue   /* skip far-offscreen elements */
      const centerY = rect.top + rect.height / 2
      const dist = centerY - vh / 2
      const range = vh * 0.42
      const weight = clamp(1 - Math.abs(dist) / range, 0, 1)
      const eased = ss(weight)
      el.style.opacity   = eased
      el.style.filter    = `blur(${(1 - eased) * 9}px)`
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

function initThemeToggle() {
  const apply = theme => {
    if (theme === 'dark') document.documentElement.dataset.theme = 'dark'
    else delete document.documentElement.dataset.theme
  }

  const toggle = () => {
    const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'
    apply(next)
    localStorage.setItem('theme', next)
    window.dispatchEvent(new CustomEvent('themechange', { detail: { theme: next } }))
  }

  document.getElementById('theme-toggle')?.addEventListener('click', toggle)
  document.getElementById('theme-toggle-mobile')?.addEventListener('click', toggle)
}

// ─── MAIN APP ─────────────────────────────────────────────────────────────────

class App {
  constructor() {
    this.scrollY = 0
    this.raf = null
    this.lastTime = 0

    // Init UI features first
    initLetterAnimation()
    this._updateFadeUp = initFadeUp()
    initQuiz()
    initServiceAccordion()
    initFaqAccordion()
    initMobileMenu()
    initThemeToggle()

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
