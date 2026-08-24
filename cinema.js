import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js'

const PI = Math.PI
function lerp(a, b, t) { return a + (b - a) * t }
function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)) }
function easeOutCubic(t) { return 1 - Math.pow(1 - t, 3) }

/* videoId/poster stay null until real assets exist — swapping them in later
   is a one-line change per topic, nothing else here needs to change. */
const TOPICS = [
  { title: 'Modelo Fee-Only', videoId: null, poster: null },
  { title: 'O cliente Telos', videoId: null, poster: null },
  { title: 'O que fazemos diferente', videoId: null, poster: null },
  { title: 'Nossa origem', videoId: null, poster: null },
]

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

/* the room itself — a real enclosed cylinder (floor + wall + ceiling, no
   gaps/doors) built from geometry instead of a photo backdrop, per the
   user's ask to hand-build the space and direct lights/objects from here.
   floor sits exactly at the model's true resting height (-KIOSK_SINK_Y),
   so the kiosk's feet meet the floor instead of floating or clipping
   through it. radius/height sized with margin around the camera<->kiosk
   span so both stay comfortably inside with room to look around. */
const ROOM_RADIUS = 10
const ROOM_HEIGHT = 10
const ROOM_FLOOR_Y = -KIOSK_SINK_Y
const ROOM_CENTER_X = 0
const ROOM_CENTER_Z = (CAMERA_Z + KIOSK_DEPTH_Z) / 2
const ROOM_COLOR = 0x040404
const LOOK_SENSITIVITY = 0.003  // pixels -> radians, how fast dragging spins the kiosk
/* stale coordinates from the old primitive kiosk (before the real 3D
   model swap) — recalibrated to a fresh guess near the current kiosk's
   position/floor height. reference photos of similar kiosks put the
   ticket/nota-fiscal slot low on the machine (waist-to-knee height), not
   near the top, so this starts near the floor and slightly toward the
   camera from the kiosk's center — same guess-then-correct-in-browser
   loop as everything else on this model. */
const PRINTER_SLOT_GUESS = { x: KIOSK_X_OFFSET - 0.16, y: -KIOSK_SINK_Y + 2.8, z: KIOSK_DEPTH_Z - 0.5 } // was -1.3 — floated too far in front of the kiosk's body, reading as disconnected from the machine
const TICKET_WIDTH = 0.24
const TICKET_CURL_RADIUS = 0.35 // meters — how tight the roll-curl arc is
const TICKET_DROOP_SCALE = 0.8  // dampens only the downward (Y) part of the curl, independent of the radius — keeps the paper's overall length/reveal untouched, just falls less at the end
const TICKET_FORWARD_SCALE = 2.2 // amplifies only the forward (Z) part of the curl, independent of the radius/length — full strength at the anchor
const TICKET_FORWARD_TAPER = 0.6 // fraction of that forward push lost by the free tip — keeps the curve at the top exactly as strong, easing off toward the end instead of pushing forward at a constant rate the whole way
const TICKET_TOP_CURL_BIAS = 0.15 // radians — a small head start on the forward curve right at the anchor, so it doesn't begin from a dead-flat zero; only affects Z (forward), not Y (droop stays flush at the top)
const TICKET_START_SCALE = 0.008 // was 0.04 — only Y is what scale.y actually shrinks, so width/forward-curl stayed full-size even at the smallest reveal, reading as a stubby chunk popping in rather than growing from nothing

/* ─── LOBBY (box office) ─────────────────────────────────────────────────
   a self-service kiosk: one real 3D model (bancada+computador+mouse+
   impressora, fused, AI-generated) as the visual backdrop. the session
   menu itself is a plain DOM overlay (#cinema-kiosk-menu in cinema.html)
   rather than a floating 3D plane — a 3D overlay positioned against a
   screen we can't actually locate inside the fused mesh either sat
   floating in empty space or got swallowed by the model once it loaded,
   so this sidesteps that entirely. fixed camera, no drag-look. does not
   own a renderer or a render loop — CinemaApp drives both scenes through
   one shared renderer. */
class LobbyScene {
  constructor(container, onBuyTicket) {
    this.container = container
    this.onBuyTicket = onBuyTicket
    this.width = window.innerWidth
    this.height = window.innerHeight
    this.printing = false
    this.roomMeshes = []

    this._initCamera()
    this._initScene()
    this._initRoom()
    this._initLights()
    this._initKioskModel()
    this._initTicket()
    this._bindEvents()
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
  }

  /* a real enclosed room — one cylinder, viewed from the inside (BackSide),
     with built-in flat caps acting as floor and ceiling, so there's no
     gap/doorway anywhere in it ("sem saída"). dark, near-black material —
     the point lights in _initLights are what make the kiosk (and a
     visible ring of nearby floor/wall) readable at all. */
  _initRoom() {
    const geo = new THREE.CylinderGeometry(ROOM_RADIUS, ROOM_RADIUS, ROOM_HEIGHT, 48, 1, false)
    const mat = new THREE.MeshStandardMaterial({ color: ROOM_COLOR, roughness: 0.95, metalness: 0, side: THREE.BackSide })
    const room = new THREE.Mesh(geo, mat)
    room.position.set(ROOM_CENTER_X, ROOM_FLOOR_Y + ROOM_HEIGHT / 2, ROOM_CENTER_Z)
    this.scene.add(room)
    this.roomMeshes.push(room)
  }

  /* shared by every real 3D asset dropped into the kiosk (counter, printer,
     ...) — loads a .glb and hands back its root scene node. positioning,
     mesh lookups by name, and roomMeshes bookkeeping are the caller's job,
     since those depend on each specific file's own structure. */
  _loadGLTF(url) {
    return new Promise((resolve, reject) => {
      const loader = new GLTFLoader()
      loader.setMeshoptDecoder(MeshoptDecoder)
      loader.load(url, gltf => resolve(gltf.scene), undefined, reject)
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

      /* the ticket is built before the kiosk finishes loading (async), so
         it starts out as a direct child of the scene — reparent it under
         the kiosk now that both exist, via attach() (preserves its
         current world position/rotation across the reparent), so it
         spins along with the kiosk instead of staying fixed in place. */
      if (this.ticketMesh) this.kioskRoot.attach(this.ticketMesh)

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
     buys the default (topic 0) ticket instead and cuts to the theater,
     where the marquee (unchanged) already lets you switch among all 4
     topics */
  _bindEvents() {
    let dragging = false
    let lastX = 0, lastY = 0
    let moved = 0

    this._onDown = e => {
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
    this._onUp = () => {
      dragging = false
      if (moved < 6) this._startPrinting(0)
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
    if (this.printing) {
      const t = clamp((performance.now() - this.printStart) / this.printDuration, 0, 1)
      this.ticketMesh.scale.y = lerp(TICKET_START_SCALE, 1, easeOutCubic(t))
      if (t >= 1) {
        this.printing = false
        // DISABLED while calibrating the lobby — re-enable this call when
        // the lobby is done and clicking should cut to the theater again.
        // this.onBuyTicket(this.printTopic)
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
   curtain opens on entry, house lights dim as the screening starts,
   drifting dust, seat silhouettes, canvas-texture "screen" swapped by the
   marquee. does not own a renderer or loop — see LobbyScene's header note,
   same reasoning applies here. */
class CinemaScene {
  constructor(initialTopic = 0) {
    this.width = window.innerWidth
    this.height = window.innerHeight
    this.activeTopic = initialTopic

    this.introStart = performance.now()
    this.introDuration = 2200
    this.introDone = false

    this._initCamera()
    this._initScene()
    this._initLights()
    this._initScreen()
    this._initCurtains()
    this._initSeats()
    this._initDust()
    this._bindMarquee()

    /* a ticket was already bought in the lobby — the screening starts the
       moment you walk in, so this both draws the right title on screen
       and kicks off the house-lights-down transition immediately */
    this.setTopic(initialTopic)
  }

  _initCamera() {
    this.camera = new THREE.PerspectiveCamera(45, this.width / this.height, 0.1, 100)
    this.camera.position.set(0, 1.2, 9)
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
    const cv = document.createElement('canvas')
    cv.width = 1024
    cv.height = 576
    this.screenCanvas = cv
    this.screenCtx = cv.getContext('2d')
    this._drawScreenTexture(TOPICS[0].title)

    this.screenTexture = new THREE.CanvasTexture(cv)
    const geo = new THREE.PlaneGeometry(16, 9)
    const mat = new THREE.MeshBasicMaterial({ map: this.screenTexture })
    this.screenMesh = new THREE.Mesh(geo, mat)
    this.screenMesh.position.set(0, 1.5, -6)
    this.scene.add(this.screenMesh)
  }

  _drawScreenTexture(title) {
    const ctx = this.screenCtx
    const W = this.screenCanvas.width, H = this.screenCanvas.height
    ctx.fillStyle = '#050303'
    ctx.fillRect(0, 0, W, H)
    ctx.strokeStyle = 'rgba(201,161,90,0.4)'
    ctx.lineWidth = 4
    ctx.strokeRect(20, 20, W - 40, H - 40)

    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillStyle = '#c9a15a'
    ctx.font = '300 30px Roboto, sans-serif'
    ctx.fillText('EM BREVE', W / 2, H / 2 - 30)

    ctx.fillStyle = '#ece4d8'
    ctx.font = '400 44px Roboto, sans-serif'
    ctx.fillText(title, W / 2, H / 2 + 30)
  }

  setTopic(i) {
    this.activeTopic = i
    this._drawScreenTexture(TOPICS[i].title)
    this.screenTexture.needsUpdate = true

    if (!this.dimming && this.ambient.intensity > this.DIM_INTENSITY) {
      this.dimming = true
      this.dimStart = performance.now()
    }
  }

  _curtainGeometry(width, height) {
    const segs = 20
    const geo = new THREE.PlaneGeometry(width, height, segs, 1)
    const pos = geo.attributes.position
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i)
      const foldT = x / width + 0.5
      const z = Math.sin(foldT * PI * 7) * 0.18
      pos.setZ(i, pos.getZ(i) + z)
    }
    geo.computeVertexNormals()
    return geo
  }

  _initCurtains() {
    const mat = new THREE.MeshStandardMaterial({ color: 0x6e0f1a, roughness: 0.75, metalness: 0.05 })
    const width = 9, height = 11
    this.curtainL = new THREE.Mesh(this._curtainGeometry(width, height), mat)
    this.curtainR = new THREE.Mesh(this._curtainGeometry(width, height), mat)
    this.curtainClosedX = width / 2
    this.curtainOpenX = width / 2 + 11
    this.curtainL.position.set(-this.curtainClosedX, 2, -5.5)
    this.curtainR.position.set(this.curtainClosedX, 2, -5.5)
    this.scene.add(this.curtainL, this.curtainR)
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

  _initDust() {
    const count = 400
    const positions = new Float32Array(count * 3)
    for (let i = 0; i < count; i++) {
      const t = Math.random()
      const spread = lerp(0.3, 4.5, t)
      positions[i * 3]     = (Math.random() - 0.5) * spread
      positions[i * 3 + 1] = lerp(3.2, 1.5, t) + (Math.random() - 0.5) * spread * 0.4
      positions[i * 3 + 2] = lerp(8, -5.5, t)
    }
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    const mat = new THREE.PointsMaterial({
      color: 0xffdca8, size: 0.03, transparent: true, opacity: 0.5, sizeAttenuation: true,
    })
    this.dust = new THREE.Points(geo, mat)
    this.scene.add(this.dust)
  }

  _bindMarquee() {
    const marqueeItems = document.querySelectorAll('.cinema-marquee-item')
    marqueeItems.forEach(btn => {
      if (Number(btn.dataset.topic) === this.activeTopic) btn.classList.add('active')
      btn.addEventListener('click', () => {
        marqueeItems.forEach(b => b.classList.remove('active'))
        btn.classList.add('active')
        this.setTopic(Number(btn.dataset.topic))
      })
    })
  }

  onResize(width, height) {
    this.width = width
    this.height = height
    this.camera.aspect = width / height
    this.camera.updateProjectionMatrix()
  }

  update(time) {
    if (!this.introDone) {
      const t = clamp((performance.now() - this.introStart) / this.introDuration, 0, 1)
      const eased = easeOutCubic(t)
      const x = lerp(this.curtainClosedX, this.curtainOpenX, eased)
      this.curtainL.position.x = -x
      this.curtainR.position.x = x
      if (t >= 1) this.introDone = true
    }

    if (this.dimming) {
      const t = clamp((performance.now() - this.dimStart) / this.dimDuration, 0, 1)
      const eased = easeOutCubic(t)
      this.ambient.intensity = lerp(this.HOUSE_INTENSITY, this.DIM_INTENSITY, eased)
      this.fill.intensity = lerp(1.4, 0, eased)
      if (t >= 1) this.dimming = false
    }

    this.dust.rotation.y = time * 0.00005
  }
}

/* ─── APP — one renderer, two scenes ────────────────────────────────────
   box office first; buying a ticket disposes the lobby and switches the
   shared loop over to the theater */
class CinemaApp {
  constructor(container) {
    this.container = container
    this.width = window.innerWidth
    this.height = window.innerHeight

    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    this.renderer.setSize(this.width, this.height)
    this.renderer.setClearColor(0x080606, 1)
    this.renderer.shadowMap.enabled = true
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap
    this.container.appendChild(this.renderer.domElement)

    this.lobby = new LobbyScene(container, topic => this._buyTicket(topic))
    this.active = this.lobby

    window.addEventListener('resize', () => this._onResize())
    this._loop(0)
  }

  _buyTicket(topic) {
    document.getElementById('cinema-marquee')?.classList.remove('cinema-hidden')
    this.lobby.dispose()
    this.lobby = null
    this.theater = new CinemaScene(topic)
    this.theater.onResize(this.width, this.height)
    this.active = this.theater
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
