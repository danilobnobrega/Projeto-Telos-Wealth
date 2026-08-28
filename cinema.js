import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js'

const PI = Math.PI
function lerp(a, b, t) { return a + (b - a) * t }
function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)) }
function easeOutCubic(t) { return 1 - Math.pow(1 - t, 3) }

/* ─── PARTICLE CLAPPERBOARD (lobby preloader) ───────────────────────────
   same technique as the main Telos site's particle system (main.js): a
   GPU point cloud morphs between two position buffers via a simple
   mix() vertex shader, and shapes are built by drawing a silhouette on
   an offscreen canvas and sampling its filled pixels. adapted here by
   hand rather than imported — main.js and cinema.js are separate
   pages/bundles with their own build — but the underlying technique
   (including the compass needle's CPU-side hinge rotation, reused below
   for the clapperboard's "clap") is identical, already proven in
   production on the main site. */

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

/* test alternative to createChaosAttractorPositions above — plain random
   scatter inside a cube, no per-point trig/attractor iteration and no
   temporary `raw` buffer, to check whether the attractor's own setup cost
   is contributing to the brief early hitch reported in the clapperboard
   preloader. */
function createRandomScatterPositions(scale, count) {
  const result = new Float32Array(count * 3)
  for (let i = 0; i < count; i++) {
    result[i * 3]     = (Math.random() * 2 - 1) * scale
    result[i * 3 + 1] = (Math.random() * 2 - 1) * scale
    result[i * 3 + 2] = (Math.random() * 2 - 1) * scale
  }
  return result
}

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
uniform float u_opacity;
out vec4 fragColor;
void main() {
  fragColor = vec4(u_color, u_opacity);
}
`
const CLAPPER_POINT_COUNT = 180000
// TEST: gold, just to look at it — was [0.30, 0.48, 0.45] (exact PARTICLE_COLOR_DARK from main.js)
const CLAPPER_COLOR = [0.79, 0.63, 0.35]
const CLAPPER_RISE_ANGLE_RAD = 12 * Math.PI / 180 // the transition's wind-up lift, beyond the baked-open pose

/* sessionStorage keys CinemaApp uses so a refresh always lands back on
   whichever screen (lobby or theater) was actually showing — see
   CinemaApp's constructor. CINEMA_SESSION_KEY alone isn't enough: it only
   says "a ticket was bought at some point this session", which stays set
   even after navigating back to the lobby, so a lobby refresh would
   wrongly jump to the theater. CINEMA_SCREEN_KEY tracks which screen is
   CURRENT, updated on every transition. */
const CINEMA_SESSION_KEY = 'telosCinemaTopic'
const CINEMA_SCREEN_KEY = 'telosCinemaScreen'

/* videoId/poster stay null until real assets exist — swapping them in later
   is a one-line change per topic, nothing else here needs to change. */
const TOPICS = [
  { title: 'Modelo Fee-Only', videoId: 'EjR4urjE4t8', poster: null },
  { title: 'O cliente Telos', videoId: 'lUC4wsG6ESg', poster: null },
  { title: 'O que fazemos diferente', videoId: 'vT1dsdy4oy8', poster: null },
  { title: 'Nossa origem', videoId: 'cTj7wGdqYMc', poster: null },
]

/* the kiosk screen image (KIOSK_SCREEN_IMAGE_URL) is 4 stacked panel
   covers, one per topic, in this top-to-bottom order — a click on the
   kiosk screen (see LobbyScene._bindEvents) buys whichever panel was hit.
   confirmed with Danilo panel-by-panel, doesn't follow TOPICS' own order
   or read directly off the panel titles — e.g. "Por que Telos?" (panel 1)
   maps to the "Nossa origem" topic (index 3), not to "O cliente Telos".
   each panel is an even 1/4 of the image's height. */
const KIOSK_SCREEN_PANEL_TOPICS = [0, 3, 2, 1]

/* the AI-generated kiosk (bancada+computador+mouse+impressora, one fused
   mesh, no named sub-parts) — position/scale/screen/printer-slot are all
   guesses based on the old primitive kiosk's proportions, since there's no
   way to read this model's real layout without rendering it. check in
   browser and adjust these numbers if the screen menu or the ticket don't
   line up with the model. */
const KIOSK_MODEL_URL = 'models/kiosk.glb'
const PRINTER_SOUND_URL = 'audio/print1.2.mp3'
const KIOSK_TARGET_SIZE = 5.1   // meters, largest dimension — the knob for "how giant"
const KIOSK_ROTATION_Y = PI / 2         // dead-on (flipped 180° in place), no left/right nudge
const KIOSK_ROTATION_X = -0.35          // forward tilt, top leaning toward the camera — sign flipped because the model's own 180° yaw (KIOSK_ROTATION_Y) reverses which way local X-tilt reads on screen
const KIOSK_ROTATION_Z = 0.03           // tiny sideways roll toward the right
const CAMERA_Y = 1.5            // camera height stays put — framing comes from tilt (aim angle), not from moving the camera
const CAMERA_TILT = 0.1         // aim this much below eye level — negative tilts the view down (less negative = looks more upward)
const CAMERA_FOV = 30           // narrower than the default 45 = zoomed in (affects model + background together)
const CAMERA_Z = -1.6           // camera now sits where the model used to be
const KIOSK_DEPTH_Z = 6.5       // model now sits where the camera used to be — swapped, so the camera faces the opposite side of the 360 room. increased to push it farther from the camera
const KIOSK_X_OFFSET = 0.08     // positive = screen-left here (the camera swap flipped which world axis reads as "left"); the camera tracks the model's x automatically, so this shifts both together

/* how much extra yaw the model needs to keep facing the camera exactly,
   now that it's off to one side instead of dead-center — computed as a
   relative delta (angle-at-offset minus angle-at-center) rather than a
   guessed constant, so it's correct regardless of which absolute
   direction the model's calibrated "front" happens to point in. */
const KIOSK_YAW_CORRECTION =
  Math.atan2(-KIOSK_X_OFFSET, CAMERA_Z - KIOSK_DEPTH_Z) -
  Math.atan2(0, CAMERA_Z - KIOSK_DEPTH_Z)
const KIOSK_SINK_Y = 2.2        // pushes the model straight down in world space — direct and unambiguous, unlike tilting the camera

/* a second AI-generated model (tall/thin — likely a sign or light fixture
   shape), placed above the kiosk once it loads. "painted" by tinting its
   existing material (color multiplies its baseColorTexture) rather than a
   new texture, and made to look lit from within via emissive + a real
   PointLight at its position, casting actual glow onto the kiosk and
   nearby wall below. */
const SIGN_MODEL_URL = 'models/sign.glb'
const SIGN_ROTATION_X = 0
const SIGN_ROTATION_Y = PI / 2  // a flat panel edge-on to the camera only shows its thin edge — 180° just shows the other edge, 90° is what actually swings the wide face into view
const SIGN_TARGET_SIZE = 2.2    // meters, largest dimension
const SIGN_GAP_ABOVE = 0.3      // clearance between the kiosk's top and the sign's bottom
const SIGN_EMISSIVE_INTENSITY = 1.4 // safe to run stronger now — white and red are two separate materials, not one washing out a vertex-color split
const SIGN_LIGHT_INTENSITY = 6
const SIGN_LIGHT_RANGE = 12
const SIGN_LIGHT_DECAY = 1.8

/* "TELOSCINE" text is apparently baked into the model's geometry (as a
   font/relief) but not into its diffuse texture (confirmed blank when
   extracted), so there's no color region to sample — this splits by raw
   vertex position instead, sliced at SIGN_SPLIT_FRACTION (5/9 ≈ where
   "TELOS" ends and "CINE" starts, by letter count), one side tinted
   white, the other red. which axis the letters spread across is no
   longer a guess — _initSign measures the mesh's own local bounding box
   at runtime and picks whichever of x/y/z has the largest extent (a
   sign's letters spread along its longest dimension, by far the most
   defensible assumption without being able to see it). only the
   fraction/flip below stay as guesses to correct from the browser. */
const SIGN_SPLIT_FRACTION = 0.63 // was 5/9≈0.556 — red was eating into the "S" at the end of TELOS, nudged so the red region (right side, size 1-FRACTION) shrinks a bit
const SIGN_SPLIT_FLIP = true    // the local axis runs opposite to the visual left-right reading direction — red was landing on the visual left (TELOS side) instead of the right (CINE side)
const SIGN_RED = 0xff2d55

const LOOK_SENSITIVITY = 0.003  // pixels -> radians, how fast dragging spins the kiosk
/* stale coordinates from the old primitive kiosk (before the real 3D
   model swap) — recalibrated to a fresh guess near the current kiosk's
   position/floor height. reference photos of similar kiosks put the
   ticket/nota-fiscal slot low on the machine (waist-to-knee height), not
   near the top, so this starts near the floor and slightly toward the
   camera from the kiosk's center — same guess-then-correct-in-browser
   loop as everything else on this model. */
const PRINTER_SLOT_GUESS = { x: KIOSK_X_OFFSET - 0.167, y: -KIOSK_SINK_Y + 2.8, z: KIOSK_DEPTH_Z - 0.5 }
/* first guess at the kiosk's actual monitor position — same
   guess-then-correct-in-browser loop as PRINTER_SLOT_GUESS above, since
   the fused single-mesh GLB has no named screen sub-part to measure
   against directly. higher than the printer slot (screens sit at
   standing eye level, not waist height) and right at the kiosk's front
   face. width/height keep the source image's own 978x1608
   aspect ratio — SCREEN_HEIGHT independent so it can be tuned without
   distorting the image. */
const KIOSK_SCREEN_IMAGE_URL = 'images/kiosk-menu.png'
const KIOSK_SCREEN_GUESS = { x: KIOSK_X_OFFSET, y: -KIOSK_SINK_Y + 3.96, z: KIOSK_DEPTH_Z - 0.6825 }
const KIOSK_SCREEN_HEIGHT = 1.80
const KIOSK_SCREEN_WIDTH = KIOSK_SCREEN_HEIGHT * (978 / 1608)
const KIOSK_SCREEN_TILT = 0.077 // radians — positive tilts the TOP of the plane away from the camera (backward); confirmed via vector math, not guessed
const KIOSK_SCREEN_ROLL = 0 // radians — negative tilts the plane clockwise (as the camera sees it), i.e. right side down; confirmed via vector math against the camera's actual up/right basis, not guessed
const KIOSK_SCREEN_TWIST = 0.01 // radians — a diagonal twist (not roll): positive pushes the bottom-right corner backward in depth and the top-left forward, around the bottom-left<->top-right diagonal axis; confirmed via vector math, not guessed
const TICKET_WIDTH = 0.24
const TICKET_CURL_RADIUS = 0.35 // meters — how tight the roll-curl arc is
const TICKET_DROOP_SCALE = 0.8  // dampens only the downward (Y) part of the curl, independent of the radius — keeps the paper's overall length/reveal untouched, just falls less at the end
const TICKET_FORWARD_SCALE = 2.2 // amplifies only the forward (Z) part of the curl, independent of the radius/length — full strength at the anchor
const TICKET_FORWARD_TAPER = 0.6 // fraction of that forward push lost by the free tip — keeps the curve at the top exactly as strong, easing off toward the end instead of pushing forward at a constant rate the whole way
const TICKET_TOP_CURL_BIAS = 0.15 // radians — a small head start on the forward curve right at the anchor, so it doesn't begin from a dead-flat zero; only affects Z (forward), not Y (droop stays flush at the top)
const TICKET_START_SCALE = 0.008 // was 0.04 — only Y is what scale.y actually shrinks, so width/forward-curl stayed full-size even at the smallest reveal, reading as a stubby chunk popping in rather than growing from nothing

/* ─── LOBBY (box office) ─────────────────────────────────────────────────
   a self-service kiosk: one real 3D model (bancada+computador+mouse+
   impressora, fused, AI-generated) as the visual backdrop, plus a real
   3D plane (not a DOM overlay) for the on-screen menu image, reparented
   under the kiosk so it spins along with it on drag — a DOM overlay was
   tried first but can't rotate along with the 3D model, so it drifted
   off the screen the moment the kiosk was spun. fixed camera, no
   drag-look (dragging spins the kiosk instead, see _bindEvents). does
   not own a renderer or a render loop — CinemaApp drives both scenes
   through one shared renderer. */
class LobbyScene {
  constructor(container, onBuyTicket) {
    this.container = container
    this.onBuyTicket = onBuyTicket
    this.width = window.innerWidth
    this.height = window.innerHeight
    this.printing = false
    this.roomMeshes = []
    this.ready = false // gates drag/click until the clapperboard reveal has finished — see _initClapperboardPreloader
    this.deferredRevealMeshes = [] // kiosk/sign meshes: built as soon as they load, but kept invisible (zero render cost) until the clapperboard starts dissolving — see _updateClapperboard

    this._initCamera()
    this._initScene()
    this._initLoadingManager()
    this._initClapperboardPreloader()
    this._initLights()
    this._initKioskModel()
    this._initTicket()
    this._initKioskScreen()
    this._bindEvents()
  }

  /* shared by every loader in this scene (kiosk .glb, HDRI .hdr, kiosk
     screen image) so the clapperboard's assembly can track real bytes
     loaded instead of a guessed timer — see update()'s 'loading' phase. */
  _initLoadingManager() {
    this.loadingManager = new THREE.LoadingManager()
    this.loadingManager.onLoad = () => { this.clapperAllLoaded = true }
    this.clapperByteProgress = new Map() // url -> {loaded, total}, see _trackClapperBytes
  }

  /* real byte-level progress across all 3 downloads combined, instead of
     LoadingManager's own onProgress (item COUNT — with only 3 files
     tracked, that jumps in 3 big steps: 0%, 33%, 66%, 100%, stalling on
     whichever step the slow 24MB HDRI happens to be in). each loader
     below passes its own onProgress here so the clapperboard's assembly
     tracks the actual, much smoother, network transfer. */
  _trackClapperBytes(url, loaded, total) {
    if (!total) return // some responses don't report Content-Length — skip rather than divide by zero
    this.clapperByteProgress.set(url, { loaded, total })
    let sumLoaded = 0, sumTotal = 0
    for (const p of this.clapperByteProgress.values()) {
      sumLoaded += p.loaded
      sumTotal += p.total
    }
    this.clapperTargetProgress = sumTotal > 0 ? sumLoaded / sumTotal : 0
  }

  /* 180k GPU particles assemble into an open clapperboard as the kiosk
     model + HDRI + screen image load (u_progress tracks real load
     progress, not a timer), hold once fully loaded, "clap" shut (the
     arm hinges closed via real per-frame rotation — same CPU technique
     as the main site's compass needle sweep), then fade out to reveal
     the kiosk. parented to the camera, sized to its visible frustum at
     `distance`, same reasoning as the photo curtain this replaces. */
  _initClapperboardPreloader() {
    this.scene.add(this.camera) // children of the camera only render if the camera itself is in the scene graph
    const distance = 1.4
    const vFovRad = THREE.MathUtils.degToRad(CAMERA_FOV)
    const visibleHeight = 2 * Math.tan(vFovRad / 2) * distance
    const worldSize = visibleHeight * 0.85

    /* a sparse point cloud has gaps everywhere between individual points
       — unlike the old solid curtain planes, it never actually hides
       what's behind it, so the kiosk was visible through the particles
       the whole time instead of only after the reveal. this opaque
       backing plane (same sizing approach as the old curtain, just
       slightly farther from the camera so it renders behind the
       particles) is what actually blocks the lobby from view until the
       clap+dissolve sequence finishes. */
    const backingDistance = distance + 0.2
    const backingHeight = 2 * Math.tan(vFovRad / 2) * backingDistance * 1.3
    const backingWidth = backingHeight * (this.width / this.height)
    this.clapperBackingMat = new THREE.MeshBasicMaterial({ color: 0x080606, transparent: true })
    this.clapperBacking = new THREE.Mesh(new THREE.PlaneGeometry(backingWidth, backingHeight), this.clapperBackingMat)
    this.clapperBacking.position.set(0, 0, -backingDistance)
    this.camera.add(this.clapperBacking)
    this.roomMeshes.push(this.clapperBacking)

    // TEST: swapped from createChaosAttractorPositions(...) to check whether
    // the attractor's setup cost (180k serial trig iterations + a temporary
    // buffer) contributes to the early hitch — revert this one line to go
    // back to the original starting shape.
    const restPositions = createRandomScatterPositions(worldSize * 1.2, CLAPPER_POINT_COUNT)
    const built = this._buildClapperboardPositions(CLAPPER_POINT_COUNT, worldSize)
    this.clapperMeta = built

    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(restPositions, 3))
    geo.setAttribute('position1', new THREE.BufferAttribute(built.positions.slice(), 3))
    this.clapperGeo = geo

    this.clapperMat = new THREE.RawShaderMaterial({
      vertexShader: particleVertexShader,
      fragmentShader: particleFragmentShader,
      glslVersion: THREE.GLSL3,
      transparent: true,
      uniforms: {
        u_progress: { value: 0 },
        u_opacity: { value: 1 },
        u_color: { value: new THREE.Vector3(...CLAPPER_COLOR) },
      },
    })
    this.clapperMesh = new THREE.Points(geo, this.clapperMat)
    this.clapperMesh.position.set(0, 0, -distance)
    this.camera.add(this.clapperMesh)
    this.roomMeshes.push(this.clapperMesh)

    this.clapperTargetProgress = 0
    this.clapperAllLoaded = false
    this.clapperPhase = 'loading' // loading -> settling -> holding -> dissolving -> done (see _updateClapperboard)
    this.clapperMode = 'reveal'
    this.clapperRevealStart = performance.now() // so 'loading' has a minimum visible duration too (see _updateClapperboard) — on a fast/local connection, loading can finish before the assembly animation has had time to actually play
  }

  /* draws the clapperboard on an offscreen canvas in two separate passes
     (board+hinge, then the open striped arm) so filled pixels from each
     pass can be tagged with which part they belong to — armIndices below —
     the same way the main site's compass distinguishes its swinging
     needle from its fixed leg. stripes are drawn as alternating filled/
     empty diagonal bands (not two colors — this whole point cloud is
     one uniform u_color), so the gaps between stripes read as the dark
     bands once sampled. pivot is returned in the same local space as
     the sampled positions, so the arm angle setter (_setClapperArmAngle)
     can rotate the arm's points around it directly, no conversion needed. */
  _buildClapperboardPositions(count, worldSize) {
    const RES = 512
    const cv = document.createElement('canvas')
    cv.width = RES
    cv.height = RES
    const ctx = cv.getContext('2d')

    const boardX0 = 50, boardX1 = 462, boardY0 = 260, boardY1 = 470
    const hinge = { x: boardX0 + 10, y: boardY0 }
    // ends almost exactly at the board's far edge when closed (was
    // boardX1-boardX0-20, leaving it ~10px short; +10 overshot past the
    // edge; -hinge.x alone still overshot by a hair) — tiny -4 nudge back
    const armLength = boardX1 - hinge.x - 2
    const armThickness = 60
    const openAngleRad = 20 * PI / 180
    const stripeWidth = 30

    const sampleFilled = () => {
      const img = ctx.getImageData(0, 0, RES, RES).data
      const pts = []
      for (let y = 0; y < RES; y++) {
        for (let x = 0; x < RES; x++) {
          if (img[(y * RES + x) * 4 + 3] > 40) pts.push(x, y)
        }
      }
      return pts
    }

    ctx.clearRect(0, 0, RES, RES)
    ctx.fillStyle = '#fff'
    ctx.fillRect(boardX0, boardY0, boardX1 - boardX0, boardY1 - boardY0)
    ctx.beginPath()
    ctx.arc(hinge.x, hinge.y, 13, 0, PI * 2)
    ctx.fill()
    const staticPts = sampleFilled()

    ctx.clearRect(0, 0, RES, RES)
    ctx.save()
    ctx.translate(hinge.x, hinge.y)
    ctx.rotate(-openAngleRad) // canvas Y is down; negative lifts the far end up — the "open" pose
    ctx.beginPath()
    ctx.rect(0, -armThickness, armLength, armThickness)
    ctx.clip()
    ctx.fillStyle = '#fff'
    ctx.save()
    ctx.rotate(PI / 4) // 45° diagonal stripes, within the arm's own already-tilted frame
    const diag = (armLength + armThickness) * 1.6
    // phase-shifted (computed, not eyeballed) so a filled band lands at the
    // tip instead of an empty one — recomputed whenever armLength changes,
    // since the tip's position (and which stripe band it falls in) moves
    // with it; without changing the stripe width/spacing or adding any
    // extra solid patch elsewhere in the pattern
    const stripePhase = 37.37
    for (let s = -diag + stripePhase; s < diag; s += stripeWidth * 2) ctx.fillRect(s, -diag, stripeWidth, diag * 2)
    ctx.restore()
    ctx.restore()
    const armPts = sampleFilled()

    const half = worldSize / 2
    const positions = new Float32Array(count * 3)
    const armIndices = [] // precomputed once — the per-frame clap sweep walks only these, not all `count` points
    const totalStatic = staticPts.length / 2
    const totalArm = armPts.length / 2
    const armFraction = totalArm / (totalStatic + totalArm)

    for (let i = 0; i < count; i++) {
      const useArm = Math.random() < armFraction
      const pool = useArm ? armPts : staticPts
      const idx = (Math.random() * (pool.length / 2) | 0) * 2
      const px = pool[idx], py = pool[idx + 1]
      const jx = (Math.random() - 0.5) * (worldSize / RES) * 1.6
      const jy = (Math.random() - 0.5) * (worldSize / RES) * 1.6
      positions[i * 3]     = (px / RES) * worldSize - half + jx
      positions[i * 3 + 1] = -((py / RES) * worldSize - half) + jy
      positions[i * 3 + 2] = (Math.random() - 0.5) * (worldSize * 0.05)
      if (useArm) armIndices.push(i)
    }

    const pivot = {
      x: (hinge.x / RES) * worldSize - half,
      y: -((hinge.y / RES) * worldSize - half),
    }
    return { positions, armIndices, pivot, openAngleRad, basePositions: positions.slice() }
  }

  /* rotates only the arm-masked particles (position1 buffer) around the
     hinge, computed fresh from basePositions every call — never
     compounded — exactly like the compass needle's sweep. angle=0 is the
     baked-in open pose (same height as the entrance preloader); NEGATIVE
     angle closes it (double-checked numerically, not just by eye, after
     the first version had this backwards: -openAngleRad brings it exactly
     flush/closed against the board — see the Node trig check that caught
     it); positive angle lifts the arm further open than baseline — used
     by the transition's wind-up rise. */
  _setClapperArmAngle(angle) {
    const { armIndices, pivot, basePositions } = this.clapperMeta
    const cos = Math.cos(angle), sin = Math.sin(angle)
    const arr = this.clapperGeo.attributes.position1.array
    // walks only the arm's own indices (precomputed once, see
    // _buildClapperboardPositions) instead of all 180k points and
    // skipping most of them
    for (let k = 0; k < armIndices.length; k++) {
      const bi = armIndices[k] * 3
      const lx = basePositions[bi]     - pivot.x
      const ly = basePositions[bi + 1] - pivot.y
      arr[bi]     = lx * cos - ly * sin + pivot.x
      arr[bi + 1] = lx * sin + ly * cos + pivot.y
    }
    this.clapperGeo.attributes.position1.needsUpdate = true
  }

  /* the clapperboard's own state machine — loading (u_progress tracks
     real bytes loaded, see _initLoadingManager) -> settling (eases the
     last bit of progress to exactly 1, no snap) -> then the two modes
     diverge: mode 'reveal' (the lobby's own entrance preloader) assembles
     straight into the baked-OPEN board, holds briefly (so a fast/local
     connection doesn't flash by too fast to read), then dissolves into
     view of the kiosk — no clap here on purpose, the board just sits open
     the whole time it's visible. mode 'transition' (the lobby -> theater
     cut, see _playClapTransition) starts at that exact same open height,
     then rising (an extra lift beyond baseline — the wind-up) -> falling
     (one continuous sweep down through baseline all the way to flush/
     closed — the slam) -> onBuyTicket. */
  _updateClapperboard() {
    if (!this.clapperPhase) return
    if (this.clapperPhase === 'loading') {
      // once truly loaded, target snaps to 1 — but u_progress still only
      // LERPS toward it (never jump-set), and the phase can't advance
      // until MIN_ASSEMBLY_MS has passed since the reveal started, so a
      // fast/local connection can't skip past actually seeing the
      // clapperboard assemble
      const MIN_ASSEMBLY_MS = 1400
      const target = this.clapperAllLoaded ? 1 : (this.clapperTargetProgress || 0)
      this.clapperMat.uniforms.u_progress.value = lerp(this.clapperMat.uniforms.u_progress.value, target, 0.06)
      const elapsed = performance.now() - this.clapperRevealStart
      if (this.clapperAllLoaded && elapsed >= MIN_ASSEMBLY_MS) {
        // lerp above never exactly reaches 1 — hand off whatever it got to,
        // instead of snapping the remainder in one frame (that snap was the
        // "abrupt" finish reported: whatever fraction hadn't caught up yet
        // used to pop into place instantly)
        this.clapperSettleFrom = this.clapperMat.uniforms.u_progress.value
        this.clapperPhase = 'settling'
        this.clapperSettleStart = performance.now()
      }
    } else if (this.clapperPhase === 'settling') {
      const SETTLE_DURATION = 220
      const t = clamp((performance.now() - this.clapperSettleStart) / SETTLE_DURATION, 0, 1)
      this.clapperMat.uniforms.u_progress.value = lerp(this.clapperSettleFrom, 1, easeOutCubic(t))
      if (t >= 1) {
        this.clapperPhase = 'holding'
        this.clapperHoldStart = performance.now()
        this.clapperHoldDuration = 700
      }
    } else if (this.clapperPhase === 'holding') {
      // reveal mode only now — assembled straight into the open board and
      // never touched it (see _initClapperboardPreloader), so once this
      // brief hold is done there's nothing left to animate, straight to
      // the dissolve. by now clapperAllLoaded is guaranteed true (it gates
      // this whole phase chain), so every deferred mesh has already
      // finished loading — flip them visible now, right as the still-
      // opaque backing plane starts to fade, so the kiosk is already
      // there to reveal underneath instead of popping in after the fact
      if (performance.now() - this.clapperHoldStart >= this.clapperHoldDuration) {
        for (const m of this.deferredRevealMeshes) m.visible = true
        this.clapperPhase = 'dissolving'
        this.clapperDissolveStart = performance.now()
      }
    } else if (this.clapperPhase === 'rising') {
      // transition mode only (see _playClapTransition) — the wind-up: a
      // quick extra lift past the baseline open height, angle goes
      // positive (see _setClapperArmAngle)
      const RISE_DURATION = 350
      const t = clamp((performance.now() - this.clapperRiseStart) / RISE_DURATION, 0, 1)
      this._setClapperArmAngle(lerp(0, CLAPPER_RISE_ANGLE_RAD, easeOutCubic(t)))
      if (t >= 1) {
        this.clapperPhase = 'falling'
        this.clapperFallStart = performance.now()
      }
    } else if (this.clapperPhase === 'falling') {
      // the slam: one continuous sweep from the top of the wind-up, down
      // through the baseline open height, all the way to flush/closed
      const FALL_DURATION = 480
      const t = clamp((performance.now() - this.clapperFallStart) / FALL_DURATION, 0, 1)
      this._setClapperArmAngle(lerp(CLAPPER_RISE_ANGLE_RAD, -this.clapperMeta.openAngleRad, easeOutCubic(t)))
      if (t >= 1) {
        this.clapperPhase = 'done'
        this.onBuyTicket(this.printTopic)
      }
    } else if (this.clapperPhase === 'dissolving') {
      const DISSOLVE_DURATION = 500
      const t = clamp((performance.now() - this.clapperDissolveStart) / DISSOLVE_DURATION, 0, 1)
      const alpha = 1 - easeOutCubic(t)
      this.clapperMat.uniforms.u_opacity.value = alpha
      this.clapperBackingMat.opacity = alpha
      if (t >= 1) {
        this.clapperPhase = 'done'
        this.clapperMesh.visible = false
        this.clapperBacking.visible = false
        this.ready = true
      }
    }
  }

  /* triggers the lobby -> theater cut: the wind-up-and-slam beat that the
     entrance preloader deliberately skips — starts at the exact same
     baked-open height the entrance preloader ends at (see
     _setClapperArmAngle(0), reset here in case a previous transition
     already left the arm elsewhere), then rises a bit further before
     sweeping all the way down through that baseline to flush/closed; no
     dissolve here, since the fall ends fully opaque and covering the
     frame, which is exactly what should be showing at the moment the
     scene swaps underneath it. */
  _playClapTransition() {
    this._setClapperArmAngle(0)
    this.clapperMat.uniforms.u_progress.value = 1
    this.clapperMat.uniforms.u_opacity.value = 1
    this.clapperMesh.visible = true
    this.clapperBackingMat.opacity = 1
    this.clapperBacking.visible = true
    this.clapperPhase = 'rising'
    this.clapperRiseStart = performance.now()
    this.clapperMode = 'transition'
  }

  /* fixed camera — no drag-look. dragging spins the kiosk itself instead
     (see _bindEvents), so the camera just aims once at baseLookAt and
     that's it; baseLookAt still gets updated once the kiosk model
     finishes loading and its real center is known. */
  _initCamera() {
    this.camera = new THREE.PerspectiveCamera(CAMERA_FOV, this.width / this.height, 0.1, 100)
    this.camera.position.set(0, CAMERA_Y, CAMERA_Z)
    this.baseLookAt = new THREE.Vector3(0, CAMERA_Y + CAMERA_TILT, KIOSK_DEPTH_Z)
    this.camera.lookAt(this.baseLookAt)
  }

  _initScene() {
    this.scene = new THREE.Scene()
    this.scene.background = new THREE.Color(0x000000)
  }

  /* shared by every real 3D asset dropped into the kiosk (counter, printer,
     ...) — loads a .glb and hands back its root scene node. positioning,
     mesh lookups by name, and roomMeshes bookkeeping are the caller's job,
     since those depend on each specific file's own structure. routed
     through loadingManager so the clapperboard preloader knows when
     this finishes too (see _initLoadingManager). */
  _loadGLTF(url) {
    return new Promise((resolve, reject) => {
      const loader = new GLTFLoader(this.loadingManager)
      loader.setMeshoptDecoder(MeshoptDecoder)
      loader.load(url, gltf => resolve(gltf.scene), e => this._trackClapperBytes(url, e.loaded, e.total), reject)
    })
  }

  /* dialed way down from the old "fully lit" version — the room itself is
     meant to read as dark, so ambient/hemi now only keep the walls from
     going pure black, while the point lights below do the real work of
     making the kiosk readable (a spotlit look, not an evenly-flooded
     one). starting point only — the user is directing lights/objects
     from here. */
  _initLights() {
    const ambient = new THREE.AmbientLight(0x1a1512, 0.5)
    this.scene.add(ambient)

    const hemi = new THREE.HemisphereLight(0x2a1c14, 0x000000, 0.4)
    this.scene.add(hemi)

    const key = new THREE.PointLight(0xffe0b0, 4, 25, 1.4)
    key.position.set(2, 4, 3)
    this.scene.add(key)

    const fill = new THREE.PointLight(0xffe6c2, 2.6, 25, 1.6)
    fill.position.set(-2.5, 2.5, 2)
    this.scene.add(fill)

    const front = new THREE.PointLight(0xfff4e0, 2.2, 25, 1.6)
    front.position.set(0, 2, 5)
    this.scene.add(front)
  }

  /* the real kiosk — AI-generated, fused into one mesh (no named
     sub-parts), loaded async. rather than guess a scale/offset by hand
     (which is what broke before — every AI export has its own arbitrary
     unit scale and pivot), this measures the model's actual bounding box
     at runtime and fits it: rotate first, size it so its largest
     dimension equals KIOSK_TARGET_SIZE, then re-center it on X/Z and drop
     it onto the floor (Y=0). the camera is re-aimed at the model's real
     center afterward, so "centered on screen" holds regardless of the
     model's original proportions. */
  _initKioskModel() {
    this._loadGLTF(KIOSK_MODEL_URL).then(root => {
      root.rotation.set(KIOSK_ROTATION_X, KIOSK_ROTATION_Y + KIOSK_YAW_CORRECTION, KIOSK_ROTATION_Z)

      const rawSize = new THREE.Box3().setFromObject(root).getSize(new THREE.Vector3())
      const scale = KIOSK_TARGET_SIZE / Math.max(rawSize.x, rawSize.y, rawSize.z)
      root.scale.setScalar(scale)

      const scaledBox = new THREE.Box3().setFromObject(root)
      const center = scaledBox.getCenter(new THREE.Vector3())
      root.position.x += -center.x + KIOSK_X_OFFSET
      root.position.y -= scaledBox.min.y + KIOSK_SINK_Y
      root.position.z += KIOSK_DEPTH_Z - center.z

      root.traverse(node => { if (node.isMesh) this.roomMeshes.push(node) })
      this.scene.add(root)
      this.kioskRoot = root // kept so the drag handler can spin the kiosk itself (see _bindEvents)
      /* stays invisible (fully built, but skipped by the renderer entirely
         — three.js doesn't draw or shade invisible objects at all) until
         the clapperboard starts its dissolve, so the GPU never pays for
         this model's geometry/PBR-reflection cost while it's still hidden
         behind the opaque preloader anyway. see deferredRevealMeshes. */
      root.visible = false
      this.deferredRevealMeshes.push(root)

      /* the ticket is built before the kiosk finishes loading (async), so
         it starts out as a direct child of the scene — reparent it under
         the kiosk now that both exist, via attach() (preserves its
         current world position/rotation across the reparent), so it
         spins along with the kiosk instead of staying fixed in place. */
      if (this.ticketMesh) this.kioskRoot.attach(this.ticketMesh)
      if (this.kioskScreenMesh) this.kioskRoot.attach(this.kioskScreenMesh)

      /* camera stays level — no up or down tilt at all. the model's own
         position (feet at floor level, see _initKioskModel above) is what
         determines the framing now, not the camera's aim. */
      const finalBox = new THREE.Box3().setFromObject(root)
      const finalCenter = finalBox.getCenter(new THREE.Vector3())
      this.baseLookAt.set(finalCenter.x, CAMERA_Y + CAMERA_TILT, finalCenter.z)
      this.camera.lookAt(this.baseLookAt)

      this._initSign(finalBox.max.y, finalCenter.x, finalCenter.z)
    })
  }

  /* the tall/thin second model, auto-fit the same way as the kiosk, placed
     just above its top — center X/Z matched to the kiosk so it reads as
     "belonging" to it rather than floating off to one side. a material's
     emissive is a single uniform color, so getting genuinely different
     glow colors per letter-group ("TELOS" white, "CINE" red) means the
     mesh has to become two real meshes — its faces get bucketed by which
     side of SIGN_SPLIT_FRACTION their vertices mostly fall on (see
     SIGN_SPLIT_* above), each half gets its own material + its own
     PointLight positioned at that half's center, so both the self-glow
     and the light actually cast into the room match per side. */
  _initSign(kioskTopY, kioskCenterX, kioskCenterZ) {
    this._loadGLTF(SIGN_MODEL_URL).then(root => {
      root.rotation.set(SIGN_ROTATION_X, SIGN_ROTATION_Y, 0)

      const rawSize = new THREE.Box3().setFromObject(root).getSize(new THREE.Vector3())
      const scale = SIGN_TARGET_SIZE / Math.max(rawSize.x, rawSize.y, rawSize.z)
      root.scale.setScalar(scale)

      const box = new THREE.Box3().setFromObject(root)
      const center = box.getCenter(new THREE.Vector3())
      root.position.x += -center.x + kioskCenterX
      root.position.y += -box.min.y + kioskTopY + SIGN_GAP_ABOVE
      root.position.z += -center.z + kioskCenterZ

      let signMesh = null
      root.traverse(node => { if (node.isMesh && !signMesh) signMesh = node })

      if (signMesh) {
        const geo = signMesh.geometry
        geo.computeBoundingBox()
        const bboxSize = geo.boundingBox.getSize(new THREE.Vector3())
        const splitAxis = bboxSize.x >= bboxSize.y && bboxSize.x >= bboxSize.z ? 'x'
          : bboxSize.y >= bboxSize.z ? 'y' : 'z'
        const min = geo.boundingBox.min[splitAxis]
        const max = geo.boundingBox.max[splitAxis]
        const span = (max - min) || 1
        const posAttr = geo.attributes.position
        const getAxis = { x: 'getX', y: 'getY', z: 'getZ' }[splitAxis]
        const isRedVertex = i => {
          let t = (posAttr[getAxis](i) - min) / span
          if (SIGN_SPLIT_FLIP) t = 1 - t
          return t >= SIGN_SPLIT_FRACTION
        }

        const srcIndex = geo.index ? geo.index.array : null
        const faceCount = srcIndex ? srcIndex.length / 3 : posAttr.count / 3
        const whiteIndices = []
        const redIndices = []
        for (let f = 0; f < faceCount; f++) {
          const a = srcIndex ? srcIndex[f * 3] : f * 3
          const b = srcIndex ? srcIndex[f * 3 + 1] : f * 3 + 1
          const c = srcIndex ? srcIndex[f * 3 + 2] : f * 3 + 2
          const redVotes = (isRedVertex(a) ? 1 : 0) + (isRedVertex(b) ? 1 : 0) + (isRedVertex(c) ? 1 : 0)
          ;(redVotes >= 2 ? redIndices : whiteIndices).push(a, b, c)
        }

        const whiteGeo = geo.clone()
        whiteGeo.setIndex(whiteIndices)
        const redGeo = geo.clone()
        redGeo.setIndex(redIndices)

        const whiteMat = new THREE.MeshStandardMaterial({
          color: 0xffffff, emissive: 0xffffff, emissiveIntensity: SIGN_EMISSIVE_INTENSITY, roughness: 0.4,
        })
        const redMat = new THREE.MeshStandardMaterial({
          color: SIGN_RED, emissive: SIGN_RED, emissiveIntensity: SIGN_EMISSIVE_INTENSITY, roughness: 0.4,
        })

        const whiteMesh = new THREE.Mesh(whiteGeo, whiteMat)
        const redMesh = new THREE.Mesh(redGeo, redMat)
        whiteMesh.position.copy(signMesh.position); whiteMesh.rotation.copy(signMesh.rotation); whiteMesh.scale.copy(signMesh.scale)
        redMesh.position.copy(signMesh.position); redMesh.rotation.copy(signMesh.rotation); redMesh.scale.copy(signMesh.scale)

        signMesh.parent.add(whiteMesh, redMesh)
        signMesh.parent.remove(signMesh)
        signMesh.geometry.dispose()
        signMesh.material.dispose()
        this.roomMeshes.push(whiteMesh, redMesh)

        this.scene.add(root)
        root.updateMatrixWorld(true)
        whiteMesh.visible = false
        redMesh.visible = false
        this.deferredRevealMeshes.push(whiteMesh, redMesh)

        const whiteCenter = new THREE.Box3().setFromObject(whiteMesh).getCenter(new THREE.Vector3())
        const whiteGlow = new THREE.PointLight(0xffffff, SIGN_LIGHT_INTENSITY, SIGN_LIGHT_RANGE, SIGN_LIGHT_DECAY)
        whiteGlow.position.copy(whiteCenter)
        this.scene.add(whiteGlow)

        const redCenter = new THREE.Box3().setFromObject(redMesh).getCenter(new THREE.Vector3())
        const redGlow = new THREE.PointLight(SIGN_RED, SIGN_LIGHT_INTENSITY, SIGN_LIGHT_RANGE, SIGN_LIGHT_DECAY)
        redGlow.position.copy(redCenter)
        this.scene.add(redGlow)
      } else {
        root.traverse(node => { if (node.isMesh) this.roomMeshes.push(node) })
        this.scene.add(root)
        root.visible = false
        this.deferredRevealMeshes.push(root)
      }
    })
  }

  /* the payoff for picking a session on the computer — a paper "ticket"
     slides out of where the printer slot should be (PRINTER_SLOT_GUESS,
     scale animation, see _startPrinting/update) with the film title on it
     and a synthesized print sound, giving the click an actual
     visible/audible consequence before cutting to the theater. the
     printer body itself is part of the fused kiosk model now — this is
     just the ticket floating at its estimated slot position. */
  _initTicket() {
    this.printerSlot = new THREE.Vector3(PRINTER_SLOT_GUESS.x, PRINTER_SLOT_GUESS.y, PRINTER_SLOT_GUESS.z)

    const ticketMat = new THREE.MeshBasicMaterial({ color: 0xece4d8, side: THREE.DoubleSide })
    const ticketHeight = 0.425 // was 0.85 — only the length is halved, width and curl radius stay at their original size
    const ticketGeo = new THREE.PlaneGeometry(TICKET_WIDTH, ticketHeight, 1, 24)
    /* anchor at the TOP edge instead of the plane's default center — a
       real receipt printer feeds paper out downward from a slot above,
       not upward from below. this way the top edge stays pinned at the
       slot and the paper grows downward as scale.y increases. */
    ticketGeo.translate(0, -ticketHeight / 2, 0)

    /* real thermal receipt paper curls from being wound on a roll. right
       at the slot the paper is still rigid/supported, so it shoots
       forward (Z) first with barely any droop; only once it's clear of
       the opening does gravity take over and it starts curling downward
       (Y). same circular arc as before, just with sin/cos swapped
       between the two axes — that swap alone is what makes Z lead near
       angle≈0 (sin(angle)≈angle, grows immediately) while Y lags
       (1-cos(angle)≈angle²/2, stays ~flat at first), instead of the
       other way around. */
    const posAttr = ticketGeo.attributes.position
    for (let i = 0; i < posAttr.count; i++) {
      const v = -posAttr.getY(i) / ticketHeight // 0 at the top anchor, 1 at the bottom tip
      const arcLength = v * ticketHeight
      const angle = arcLength / TICKET_CURL_RADIUS
      posAttr.setY(i, -TICKET_CURL_RADIUS * (1 - Math.cos(angle)) * TICKET_DROOP_SCALE)
      const forwardScale = TICKET_FORWARD_SCALE * (1 - TICKET_FORWARD_TAPER * v)
      posAttr.setZ(i, posAttr.getZ(i) - TICKET_CURL_RADIUS * Math.sin(angle + TICKET_TOP_CURL_BIAS) * forwardScale)
    }
    posAttr.needsUpdate = true
    ticketGeo.computeVertexNormals()

    /* growth via scale.y from a pivot at the anchor (local Y=0, which is
       always exactly at position.y regardless of scale) — this is what
       actually GUARANTEES paper stays visible right at the slot the
       whole time, unconditionally. a clip-plane "slide through a fixed
       threshold" approach was tried instead (paper translating downward,
       revealed as it crosses a fixed world-Y line) for a more realistic
       "old parts sink, new parts enter at the top" motion, but the curl
       arc sweeps past 90° and doubles back on itself (Y isn't monotonic
       along the strip's length), which broke the clip approach's
       guarantee that something is always sitting exactly at the slot —
       vertices near the tip's curl-back could lift back above the
       threshold and disappear. scale-based growth doesn't have that
       failure mode, at the cost of the anchor not visually drifting. */
    const ticket = new THREE.Mesh(ticketGeo, ticketMat)
    ticket.position.copy(this.printerSlot)
    ticket.scale.y = TICKET_START_SCALE
    ticket.visible = false
    this.scene.add(ticket)
    this.roomMeshes.push(ticket)
    this.ticketMesh = ticket
  }

  /* the kiosk's on-screen menu image, as a real 3D plane instead of a DOM
     overlay — a DOM overlay was tried first, but it's stuck in fixed
     screen-space and can't rotate along with the 3D model, so it drifted
     right off the physical screen the moment the kiosk was spun via
     drag. reparented under the kiosk once it loads (see
     _initKioskModel), same attach() pattern as the ticket, so it's
     "glued" to the screen and spins along with the machine. routed
     through the shared loadingManager so it's already loaded by the
     time the clapperboard clap finishes — no separate pop-in after the
     kiosk itself appears. rotated 180° because the camera sits at a smaller world Z
     than the kiosk (looks toward +Z), so a default-facing plane (normal
     pointing +Z) would show its backface to the camera. */
  _initKioskScreen() {
    const geo = new THREE.PlaneGeometry(KIOSK_SCREEN_WIDTH, KIOSK_SCREEN_HEIGHT)
    const mat = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }) // visible from either face — removes any risk of a rotation/orientation mistake making it invisible
    const mesh = new THREE.Mesh(geo, mat)
    mesh.position.set(KIOSK_SCREEN_GUESS.x, KIOSK_SCREEN_GUESS.y, KIOSK_SCREEN_GUESS.z)
    mesh.rotation.set(KIOSK_SCREEN_TILT, Math.PI, KIOSK_SCREEN_ROLL)
    // a diagonal "twist" around the real bottom-left<->top-right axis
    // (KIOSK_SCREEN_WIDTH, KIOSK_SCREEN_HEIGHT, 0) — NOT (1,1,0), which
    // is only the true diagonal for a square plane; this one isn't
    // square, and using (1,1,0) moved the bottom-left corner too
    // (caught after the fact, not predicted). this axis keeps
    // bottom-left/top-right exactly fixed and pushes bottom-right back
    // in depth (top-left forward), on top of the tilt/roll above.
    // confirmed via vector math which twist sign does that.
    mesh.rotateOnAxis(new THREE.Vector3(KIOSK_SCREEN_WIDTH, KIOSK_SCREEN_HEIGHT, 0).normalize(), KIOSK_SCREEN_TWIST)
    mesh.visible = false // stays hidden until its texture loads — an untextured plane defaults to plain white, which would show through as a flash before the clapperboard (itself only revealed once loadingManager confirms everything, including this, is done) has anything to hide it behind
    this.scene.add(mesh)
    this.roomMeshes.push(mesh)
    this.kioskScreenMesh = mesh

    new THREE.TextureLoader(this.loadingManager).load(KIOSK_SCREEN_IMAGE_URL, texture => {
      texture.colorSpace = THREE.SRGBColorSpace
      /* anisotropic filtering NEEDS mipmaps to actually do anything — it
         interpolates across mip levels to compensate for the oblique
         viewing angle. generateMipmaps=false previously left anisotropy
         with nothing to work with, so fine detail (the panel titles) came
         out aliased/rough instead of clean — same texture pipeline, so
         the same problem carried over from the previous image untouched. */
      texture.anisotropy = 16 // the plane is tilted (KIOSK_SCREEN_TILT), so the camera sees it at an oblique angle — without this, WebGL's default filtering blurs textures viewed at a shallow angle, regardless of source file quality
      texture.generateMipmaps = true
      texture.minFilter = THREE.LinearMipmapLinearFilter
      mat.map = texture
      mat.needsUpdate = true
      mesh.visible = true
    }, e => this._trackClapperBytes(KIOSK_SCREEN_IMAGE_URL, e.loaded, e.total))
  }

  _ticketTexture(title) {
    const cv = document.createElement('canvas')
    cv.width = 256
    cv.height = 680
    const ctx = cv.getContext('2d')
    ctx.fillStyle = '#ece4d8'
    ctx.fillRect(0, 0, cv.width, cv.height)
    ctx.strokeStyle = 'rgba(42,13,16,0.4)'
    ctx.lineWidth = 4
    ctx.setLineDash([10, 8])
    ctx.strokeRect(14, 14, cv.width - 28, cv.height - 28)

    ctx.save()
    ctx.translate(cv.width / 2, 130)
    ctx.rotate(-PI / 2)
    ctx.textAlign = 'center'
    ctx.fillStyle = '#2a0d10'
    ctx.font = 'italic 300 30px "Ibarra Real Nova", serif'
    ctx.fillText('TELOSCINE', 0, 0)
    ctx.restore()

    ctx.textAlign = 'center'
    ctx.fillStyle = '#2a0d10'
    let fontSize = 26
    do {
      ctx.font = `400 ${fontSize}px Roboto, sans-serif`
      fontSize -= 2
    } while (ctx.measureText(title).width > cv.width - 60 && fontSize > 14)
    ctx.fillText(title, cv.width / 2, cv.height / 2)

    ctx.font = '300 16px Roboto, sans-serif'
    ctx.fillStyle = 'rgba(42,13,16,0.6)'
    ctx.fillText('INGRESSO CONFIRMADO', cv.width / 2, cv.height - 60)

    return new THREE.CanvasTexture(cv)
  }

  /* real recorded receipt-printer sound effect, not synthesized. new
     Audio() each time (rather than reusing one element) so rapid repeat
     clicks don't cut a still-playing sound short. */
  _playPrinterSound() {
    new Audio(PRINTER_SOUND_URL).play().catch(() => {})
  }

  _startPrinting(topicIndex) {
    if (this.printing) return
    this.printing = true
    this.printStart = performance.now()
    this.printDuration = 1400
    this.printTopic = topicIndex

    this.ticketMesh.material.map?.dispose()
    this.ticketMesh.material.map = this._ticketTexture(TOPICS[topicIndex].title)
    this.ticketMesh.material.needsUpdate = true
    this.ticketMesh.scale.y = TICKET_START_SCALE
    this.ticketMesh.visible = true

    this._playPrinterSound()
  }

  /* a drag spins the kiosk itself in place (free, unclamped — camera
     stays fixed); a plain click (movement stays under the threshold)
     raycasts against the kiosk screen specifically — hitting one of its 4
     panel covers buys THAT panel's topic (see KIOSK_SCREEN_PANEL_TOPICS),
     any other click (missed the screen entirely, e.g. the kiosk's frame)
     does nothing. switching to a different topic later means going back
     to the lobby (the "← Lobby" back link) and picking another panel */
  _bindEvents() {
    let dragging = false
    let lastX = 0, lastY = 0
    let moved = 0
    const raycaster = new THREE.Raycaster()
    const ndc = new THREE.Vector2()

    this._onDown = e => {
      if (!this.ready || this.clapperMode === 'transition') return // clapperboard still assembling, or already clapping shut for the handoff to the theater — nothing to spin or click
      dragging = true
      moved = 0
      lastX = e.clientX
      lastY = e.clientY
    }
    this._onMove = e => {
      if (!dragging) return
      const dx = e.clientX - lastX
      const dy = e.clientY - lastY
      lastX = e.clientX
      lastY = e.clientY
      moved += Math.abs(dx) + Math.abs(dy)
      if (this.kioskRoot) this.kioskRoot.rotation.y += dx * LOOK_SENSITIVITY
    }
    this._onUp = e => {
      dragging = false
      if (moved >= 6 || !this.kioskScreenMesh) return
      const rect = this.container.getBoundingClientRect()
      ndc.x = ((e.clientX - rect.left) / rect.width) * 2 - 1
      ndc.y = -((e.clientY - rect.top) / rect.height) * 2 + 1
      raycaster.setFromCamera(ndc, this.camera)
      const hit = raycaster.intersectObject(this.kioskScreenMesh)[0]
      if (!hit || !hit.uv) return
      // uv.y=1 is the TOP of the source image (texture.flipY default), so
      // panel 0 (top, "Nosso Manifesto") needs 1-uv.y, not uv.y directly
      const panelIndex = Math.min(3, Math.floor((1 - hit.uv.y) * 4))
      this._startPrinting(KIOSK_SCREEN_PANEL_TOPICS[panelIndex])
    }
    this._onLeave = () => { dragging = false }

    this.container.addEventListener('pointerdown', this._onDown)
    this.container.addEventListener('pointermove', this._onMove)
    this.container.addEventListener('pointerup', this._onUp)
    this.container.addEventListener('pointerleave', this._onLeave)
  }

  onResize(width, height) {
    this.width = width
    this.height = height
    this.camera.aspect = width / height
    this.camera.updateProjectionMatrix()
  }

  update() {
    this._updateClapperboard()
    if (this.printing) {
      const t = clamp((performance.now() - this.printStart) / this.printDuration, 0, 1)
      this.ticketMesh.scale.y = lerp(TICKET_START_SCALE, 1, easeOutCubic(t))
      if (t >= 1) {
        this.printing = false
        this._playClapTransition()
      }
    }
  }

  dispose() {
    this.container.removeEventListener('pointerdown', this._onDown)
    this.container.removeEventListener('pointermove', this._onMove)
    this.container.removeEventListener('pointerup', this._onUp)
    this.container.removeEventListener('pointerleave', this._onLeave)
    const mapKeys = ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap']
    this.roomMeshes.forEach(m => {
      m.geometry?.dispose()
      if (m.material) {
        mapKeys.forEach(key => m.material[key]?.dispose())
        m.material.dispose()
      }
    })
  }
}

/* ─── THEATER ────────────────────────────────────────────────────────────
   static room (no curtain, no drag-look — Danilo locked this in as-is),
   house lights dim as the screening starts, seat silhouettes,
   canvas-texture "screen". switching topics happens by going back to the
   lobby and picking another poster (see CinemaApp._returnToLobby), not
   from inside the theater. does not own a renderer or loop — see
   LobbyScene's header note, same reasoning applies here. */
class CinemaScene {
  constructor(initialTopic = 0, container = null) {
    this.width = window.innerWidth
    this.height = window.innerHeight
    this.activeTopic = initialTopic
    this.container = container

    this._initCamera()
    this._initScene()
    this._initLights()
    this._initScreen()
    this._initVideoOverlay()
    this._initSeats()

    /* a ticket was already bought in the lobby — the screening starts the
       moment you walk in, so this both draws the right title on screen
       and kicks off the house-lights-down transition immediately */
    this.setTopic(initialTopic)
  }

  /* static — camera never moves, never re-aims. */
  _initCamera() {
    this.camera = new THREE.PerspectiveCamera(45, this.width / this.height, 0.1, 100)
    this.camera.position.set(0, 1.9, 9) // raised above the seat silhouettes (topping out around y=0.75) so they don't clip the screen, and looks down on the audience slightly
    this.camera.lookAt(0, 1.5, -6)
  }

  _initScene() {
    this.scene = new THREE.Scene()
    this.scene.fog = new THREE.Fog(0x080606, 8, 22)
  }

  _initLights() {
    this.HOUSE_INTENSITY = 2.6
    this.DIM_INTENSITY = 0.9
    this.ambient = new THREE.AmbientLight(0x3a2a22, this.HOUSE_INTENSITY)
    this.scene.add(this.ambient)

    this.fill = new THREE.PointLight(0xffd9a0, 1.4, 26, 1.6)
    this.fill.position.set(0, 5, 2)
    this.scene.add(this.fill)

    this.projector = new THREE.SpotLight(0xffdca8, 6, 24, PI * 0.18, 0.6, 1.2)
    this.projector.position.set(0, 3.2, 8)
    this.projector.target.position.set(0, 1.5, -6)
    this.scene.add(this.projector)
    this.scene.add(this.projector.target)

    this.dimming = false
    this.dimStart = 0
    this.dimDuration = 1800
  }

  _initScreen() {
    /* single source of truth for the screen's 3D transform — both the
       actual 3D backing mesh (below) and the video <iframe> overlay (see
       _updateVideoOverlayRect) are positioned/sized from these exact same
       numbers, so they can never drift apart again. screenCenterY raised
       from the original 1.5 per Danilo's approved on-screen nudge
       (verified against the projection math, not eyeballed). */
    this.screenHalfW = 8
    this.screenHalfH = 4.5
    this.screenCenterY = 3.25
    this.screenZ = -6

    const cv = document.createElement('canvas')
    cv.width = 1024
    cv.height = 576
    this.screenCanvas = cv
    this.screenCtx = cv.getContext('2d')
    this._drawScreenTexture(TOPICS[0].title, !!TOPICS[0].videoId)

    this.screenTexture = new THREE.CanvasTexture(cv)
    /* the mesh's own shape/position — deliberately separate from
       screenHalfW/screenHalfH/screenCenterY above, which still drive the
       video overlay unchanged (see _updateVideoOverlayRect). Danilo's
       read of the two side by side: the top edge already lines up, the
       bottom sits a bit lower than the video, and both sides are a touch
       wider than the video — so only the bottom and the sides come in a
       little, top untouched, still a plain rectangle (no trapezoid). */
    const MESH_Y_TEMP_ADJUST = -0.5   // overall vertical nudge (top edge reference), already approved
    const MESH_BOTTOM_SHRINK = 0.3    // raises the bottom edge up a bit
    const MESH_WIDTH_SHRINK = 0.3     // trims a bit off both sides equally
    const MESH_EXPAND = 0.15          // nudges all 4 edges back out a touch, on top of the shrink above
    const MESH_Y_SHIFT = -0.1         // pure translation, mesh only — height stays exactly the same, just moves down a touch (video overlay untouched)
    const MESH_WIDTH_EXPAND2 = 0.1    // a bit more width only, mesh only
    const meshTopY = this.screenCenterY + MESH_Y_TEMP_ADJUST + this.screenHalfH + MESH_EXPAND + MESH_Y_SHIFT
    const meshBottomY = this.screenCenterY + MESH_Y_TEMP_ADJUST - this.screenHalfH + MESH_BOTTOM_SHRINK - MESH_EXPAND + MESH_Y_SHIFT
    const meshHalfW = this.screenHalfW - MESH_WIDTH_SHRINK + MESH_EXPAND + MESH_WIDTH_EXPAND2

    const geo = new THREE.PlaneGeometry(meshHalfW * 2, meshTopY - meshBottomY)
    const mat = new THREE.MeshBasicMaterial({ map: this.screenTexture })
    this.screenMesh = new THREE.Mesh(geo, mat)
    this.screenMesh.position.set(0, (meshTopY + meshBottomY) / 2, this.screenZ)
    this.scene.add(this.screenMesh)
  }

  _drawScreenTexture(title, hasVideo = false) {
    const ctx = this.screenCtx
    const W = this.screenCanvas.width, H = this.screenCanvas.height
    ctx.fillStyle = '#000000'
    ctx.fillRect(0, 0, W, H)

    /* topics with a real video play the YouTube overlay on top of this
       canvas — the backing screen itself should just stay plain black,
       not show the "coming soon" placeholder behind/around it. */
    if (hasVideo) return

    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillStyle = '#c9a15a'
    ctx.font = '300 30px Roboto, sans-serif'
    ctx.fillText('EM BREVE', W / 2, H / 2 - 30)

    ctx.fillStyle = '#ece4d8'
    ctx.font = '400 44px Roboto, sans-serif'
    ctx.fillText(title, W / 2, H / 2 + 30)
  }

  /* a real video can't be painted onto the 3D screen mesh as a WebGL
     texture — YouTube only exposes its player inside a sandboxed iframe,
     never raw frames. instead, an actual <iframe> DOM element sits on top
     of the canvas, sized/positioned to exactly cover the screen mesh's
     on-screen rectangle. this only works cleanly because both the camera
     and the screen are static (see _initCamera's own comment) — the
     rectangle is computed once, not re-derived every frame. */
  _initVideoOverlay() {
    if (!this.container) return
    const iframe = document.createElement('iframe')
    iframe.style.position = 'absolute'
    iframe.style.border = '0'
    iframe.style.display = 'none'
    iframe.allow = 'autoplay; encrypted-media; picture-in-picture'
    iframe.allowFullscreen = true
    this.videoOverlay = iframe
    this.container.appendChild(iframe)
    this._updateVideoOverlayRect()
  }

  /* projects the screen plane's 4 corners — using this.screenHalfW/
     screenHalfH/screenCenterY/screenZ, the exact same numbers the real 3D
     mesh is built/positioned from (see _initScreen) — instead of just
     center+size, so any slight trapezoidal skew from the camera's own
     off-axis position (it's raised above and looks slightly down, per
     _initCamera) still yields a sane bounding rectangle. because both the
     mesh and this overlay read from the same source values, there's no
     separate pixel-nudge to keep in sync by hand anymore — move the
     screen, and both move together, at any viewport size. */
  _updateVideoOverlayRect() {
    if (!this.videoOverlay) return
    const hw = this.screenHalfW, hh = this.screenHalfH, cy = this.screenCenterY, cz = this.screenZ
    const corners = [
      new THREE.Vector3(-hw, cy - hh, cz),
      new THREE.Vector3(hw, cy - hh, cz),
      new THREE.Vector3(-hw, cy + hh, cz),
      new THREE.Vector3(hw, cy + hh, cz),
    ]
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
    for (const c of corners) {
      c.project(this.camera)
      const px = (c.x * 0.5 + 0.5) * this.width
      const py = (1 - (c.y * 0.5 + 0.5)) * this.height
      if (px < minX) minX = px
      if (px > maxX) maxX = px
      if (py < minY) minY = py
      if (py > maxY) maxY = py
    }
    this.videoOverlay.style.left = `${minX}px`
    this.videoOverlay.style.top = `${minY}px`
    this.videoOverlay.style.width = `${maxX - minX}px`
    this.videoOverlay.style.height = `${maxY - minY}px`
  }

  setTopic(i) {
    this.activeTopic = i
    /* keeps the saved session topic current — a refresh while in the
       theater restores whichever topic was actually bought/showing. */
    sessionStorage.setItem(CINEMA_SESSION_KEY, String(i))
    this._drawScreenTexture(TOPICS[i].title, !!TOPICS[i].videoId)
    this.screenTexture.needsUpdate = true

    const videoId = TOPICS[i].videoId
    if (this.videoOverlay) {
      if (videoId) {
        this.videoOverlay.src = `https://www.youtube.com/embed/${videoId}?autoplay=1&rel=0`
        this.videoOverlay.style.display = 'block'
      } else {
        this.videoOverlay.style.display = 'none'
        this.videoOverlay.src = ''   // stops playback when switching to a topic with no video yet
      }
    }

    if (!this.dimming && this.ambient.intensity > this.DIM_INTENSITY) {
      this.dimming = true
      this.dimStart = performance.now()
    }
  }

  _seatSilhouetteTexture() {
    const cv = document.createElement('canvas')
    cv.width = 128
    cv.height = 128
    const ctx = cv.getContext('2d')
    ctx.clearRect(0, 0, 128, 128)
    ctx.fillStyle = '#000'
    ctx.beginPath()
    ctx.moveTo(20, 128)
    ctx.lineTo(20, 50)
    ctx.quadraticCurveTo(20, 10, 64, 10)
    ctx.quadraticCurveTo(108, 10, 108, 50)
    ctx.lineTo(108, 128)
    ctx.closePath()
    ctx.fill()
    return new THREE.CanvasTexture(cv)
  }

  _initSeats() {
    const tex = this._seatSilhouetteTexture()
    const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, color: 0x0a0505 })
    const rows = [
      { z: 4.5, y: 0.1, count: 7, spacing: 1.7, scale: 1.3 },
      { z: 6.2, y: -0.3, count: 9, spacing: 1.9, scale: 1.55 },
    ]
    rows.forEach(row => {
      for (let i = 0; i < row.count; i++) {
        const mesh = new THREE.Mesh(new THREE.PlaneGeometry(row.scale, row.scale), mat)
        mesh.position.set((i - (row.count - 1) / 2) * row.spacing, row.y, row.z)
        this.scene.add(mesh)
      }
    })
  }

  onResize(width, height) {
    this.width = width
    this.height = height
    this.camera.aspect = width / height
    this.camera.updateProjectionMatrix()
    this._updateVideoOverlayRect()
  }

  update(time) {
    if (this.dimming) {
      const t = clamp((performance.now() - this.dimStart) / this.dimDuration, 0, 1)
      const eased = easeOutCubic(t)
      this.ambient.intensity = lerp(this.HOUSE_INTENSITY, this.DIM_INTENSITY, eased)
      this.fill.intensity = lerp(1.4, 0, eased)
      if (t >= 1) this.dimming = false
    }
  }

  dispose() {
    if (this.videoOverlay) {
      this.videoOverlay.src = ''
      this.videoOverlay.remove()
    }
    const mapKeys = ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap']
    this.scene.traverse(obj => {
      obj.geometry?.dispose()
      if (obj.material) {
        mapKeys.forEach(key => obj.material[key]?.dispose())
        obj.material.dispose()
      }
    })
  }
}

/* ─── APP — two scenes, one renderer at a time ──────────────────────────
   box office first; buying a ticket disposes the lobby and swaps in a
   fresh renderer for the theater. two separate renderers (not one shared
   instance) because antialias is a context-creation flag that can't be
   toggled per-frame: the lobby's particle preloader is full-screen
   180k-point rendering that needs every frame to count and gets no
   visible benefit from MSAA on ~1px points, while the theater's hard
   geometric edges (seats, screen frame) do benefit from it. only one
   renderer/context is ever live at a time — the old one is disposed
   before the new one is created. */
class CinemaApp {
  constructor(container) {
    this.container = container
    this.width = window.innerWidth
    this.height = window.innerHeight

    /* a refresh should always land back on whichever screen was actually
       showing — lobby stays lobby, theater stays theater. sessionStorage
       (not localStorage) so this only lasts the current tab/session, not
       forever. two keys are needed: CINEMA_SESSION_KEY alone only says "a
       ticket was bought at some point this session", which stays set even
       after coming back to the lobby — CINEMA_SCREEN_KEY tracks which
       screen is CURRENT, so a lobby refresh doesn't wrongly reuse a stale
       topic from an earlier visit. and a fresh navigation here (e.g.
       clicking the projector from the main site) must always show the
       lobby regardless of either key — only an actual browser reload
       (checked via the Navigation Timing API) may resume the theater. */
    const navEntry = performance.getEntriesByType('navigation')[0]
    const isReload = navEntry ? navEntry.type === 'reload' : false
    const savedTopic = sessionStorage.getItem(CINEMA_SESSION_KEY)
    const savedScreen = sessionStorage.getItem(CINEMA_SCREEN_KEY)
    if (isReload && savedScreen === 'theater' && savedTopic !== null) {
      this.renderer = this._createRenderer({ antialias: true, clearColor: 0x080606, shadows: true })
      this.theater = new CinemaScene(Number(savedTopic), this.container)
      this.theater.onResize(this.width, this.height)
      this.active = this.theater
    } else {
      sessionStorage.setItem(CINEMA_SCREEN_KEY, 'lobby')
      this.renderer = this._createRenderer({ antialias: true, clearColor: 0x080606, shadows: false })
      this.lobby = new LobbyScene(container, topic => this._buyTicket(topic))
      this.active = this.lobby
    }

    /* one back link, two behaviors: in the lobby it's a normal link out
       to the main site; in the theater it instead returns to the lobby
       (no full page reload) — text and click behavior both follow
       whichever scene is currently active. */
    this.backLink = document.getElementById('cinema-back')
    this.backLink?.addEventListener('click', e => {
      if (this.active === this.theater) {
        e.preventDefault()
        this._returnToLobby()
      }
    })
    this._updateBackLink()

    window.addEventListener('resize', () => this._onResize())
    this._loop(0)
  }

  _updateBackLink() {
    if (!this.backLink) return
    this.backLink.textContent = this.active === this.theater ? '← Lobby' : '← Telos Wealth'
  }

  _createRenderer({ antialias, clearColor, shadows }) {
    const renderer = new THREE.WebGLRenderer({ antialias, alpha: false })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.setSize(this.width, this.height)
    renderer.setClearColor(clearColor, 1)
    if (shadows) {
      renderer.shadowMap.enabled = true
      renderer.shadowMap.type = THREE.PCFSoftShadowMap
    }
    this.container.appendChild(renderer.domElement)
    return renderer
  }

  _buyTicket(topic) {
    sessionStorage.setItem(CINEMA_SCREEN_KEY, 'theater')
    this.lobby.dispose()
    this.lobby = null

    this.renderer.dispose()
    this.container.removeChild(this.renderer.domElement)
    this.renderer = this._createRenderer({ antialias: true, clearColor: 0x080606, shadows: true })

    this.theater = new CinemaScene(topic, this.container)
    this.theater.onResize(this.width, this.height)
    this.active = this.theater
    this._updateBackLink()
  }

  _returnToLobby() {
    sessionStorage.setItem(CINEMA_SCREEN_KEY, 'lobby')
    sessionStorage.removeItem(CINEMA_SESSION_KEY)
    this.theater.dispose()
    this.theater = null

    this.renderer.dispose()
    this.container.removeChild(this.renderer.domElement)
    this.renderer = this._createRenderer({ antialias: true, clearColor: 0x080606, shadows: false })

    this.lobby = new LobbyScene(this.container, topic => this._buyTicket(topic))
    this.active = this.lobby
    this._updateBackLink()
  }

  _onResize() {
    this.width = window.innerWidth
    this.height = window.innerHeight
    this.renderer.setSize(this.width, this.height)
    this.active.onResize(this.width, this.height)
  }

  _loop(time) {
    requestAnimationFrame(t => this._loop(t))
    this.active.update(time)
    this.renderer.render(this.active.scene, this.active.camera)
  }
}

const container = document.getElementById('cinema-canvas')
if (container) new CinemaApp(container)
