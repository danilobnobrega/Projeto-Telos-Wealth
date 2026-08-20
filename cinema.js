import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'

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

/* ─── LOBBY (box office) ─────────────────────────────────────────────────
   deliberately minimal now — just a self-service kiosk: a desk, a
   computer showing the 4 sessions as a clickable list on its own screen, a
   mouse prop, and the ticket printer. no room to walk around, no wall
   posters, no drag-look — fixed camera aimed at the desk. does not own a
   renderer or a render loop — CinemaApp drives both scenes through one
   shared renderer. */
class LobbyScene {
  constructor(container, onBuyTicket) {
    this.container = container
    this.onBuyTicket = onBuyTicket
    this.width = window.innerWidth
    this.height = window.innerHeight
    this.printing = false

    this._initCamera()
    this._initScene()
    this._initLights()
    this._initDesk()
    this._initMonitor()
    this._initMouseProp()
    this._initPrinter()
    this._bindEvents()
  }

  _initCamera() {
    this.camera = new THREE.PerspectiveCamera(45, this.width / this.height, 0.1, 100)
    this.camera.position.set(0, 1.5, 3.2)
    this.camera.lookAt(0, 1.15, -1.6)
  }

  _initScene() {
    this.scene = new THREE.Scene()
  }

  /* shared by every real 3D asset dropped into the kiosk (counter, printer,
     ...) — loads a .glb and hands back its root scene node. positioning,
     mesh lookups by name, and roomMeshes bookkeeping are the caller's job,
     since those depend on each specific file's own structure. */
  _loadGLTF(url) {
    return new Promise((resolve, reject) => {
      new GLTFLoader().load(url, gltf => resolve(gltf.scene), undefined, reject)
    })
  }

  _initLights() {
    const ambient = new THREE.AmbientLight(0x2a1c18, 1.1)
    this.scene.add(ambient)
    const key = new THREE.PointLight(0xffd9a0, 1.6, 10, 1.6)
    key.position.set(0.6, 2.6, 1.6)
    this.scene.add(key)
  }

  /* placeholder counter — the Poly Haven "metal office desk" model that
     briefly lived here was a sit-down work desk, not a cinema box-office
     bancada, and got pulled. back to a plain box until a real
     counter/kiosk-shaped asset is sourced. */
  _initDesk() {
    const bodyMat = new THREE.MeshStandardMaterial({ color: 0x2a1f14, roughness: 0.5, metalness: 0.3 })
    const body = new THREE.Mesh(new THREE.BoxGeometry(2.6, 1.1, 0.9), bodyMat)
    body.position.set(0, 0.55, -1.6)
    this.scene.add(body)

    const topMat = new THREE.MeshStandardMaterial({ color: 0xc9a15a, roughness: 0.3, metalness: 0.7 })
    const top = new THREE.Mesh(new THREE.BoxGeometry(2.8, 0.08, 1.1), topMat)
    top.position.set(0, 1.14, -1.6)
    this.scene.add(top)

    this.deskTopY = 1.18
    this.roomMeshes = [body, top]
  }

  /* the computer — a stand, a bezel, and the screen itself (a canvas
     texture redrawn by _drawMenu). 4 invisible "hotspot" planes sit a
     hair in front of the screen surface, one per session row, and are
     what the raycaster actually tests against (see _initMenuHotspots) —
     reusing the exact click-detection pattern already proven for the
     wall posters in the previous version, just repositioned onto the
     monitor, rather than trying to derive click position from raw UV
     coordinates on a single screen mesh (harder to get right without
     being able to see it render) */
  _initMonitor() {
    const standMat = new THREE.MeshStandardMaterial({ color: 0x151010, roughness: 0.5, metalness: 0.4 })
    const stand = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.22, 0.16), standMat)
    stand.position.set(0, this.deskTopY + 0.11, -1.75)
    this.scene.add(stand)
    this.roomMeshes.push(stand)

    const bezelMat = new THREE.MeshStandardMaterial({ color: 0x0e0b0a, roughness: 0.5 })
    const bezel = new THREE.Mesh(new THREE.BoxGeometry(1.1, 1.4, 0.06), bezelMat)
    bezel.position.set(0, this.deskTopY + 0.11 + 0.75, -1.78)
    this.scene.add(bezel)
    this.roomMeshes.push(bezel)

    const cv = document.createElement('canvas')
    cv.width = 512
    cv.height = 640
    this.screenCanvas = cv
    this.screenCtx = cv.getContext('2d')
    this._drawMenu()
    this.screenTexture = new THREE.CanvasTexture(cv)

    this.screenW = 0.98
    this.screenH = 1.28
    this.screenPos = new THREE.Vector3(0, bezel.position.y, bezel.position.z + 0.031)

    const screenMat = new THREE.MeshBasicMaterial({ map: this.screenTexture })
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(this.screenW, this.screenH), screenMat)
    screen.position.copy(this.screenPos)
    this.scene.add(screen)
    this.roomMeshes.push(screen)

    this._initMenuHotspots()
  }

  _drawMenu() {
    const ctx = this.screenCtx
    const W = this.screenCanvas.width, H = this.screenCanvas.height
    ctx.fillStyle = '#0a0e14'
    ctx.fillRect(0, 0, W, H)

    ctx.textAlign = 'center'
    ctx.fillStyle = '#c9a15a'
    ctx.font = 'italic 300 28px "Ibarra Real Nova", serif'
    ctx.fillText('TELOSCINE', W / 2, 56)
    ctx.font = '300 15px Roboto, sans-serif'
    ctx.fillStyle = 'rgba(236,228,216,0.6)'
    ctx.fillText('escolha sua sessão', W / 2, 86)

    const rowH = this._rowHeight()
    TOPICS.forEach((topic, i) => {
      const rowY = this._rowTop(i)
      ctx.strokeStyle = 'rgba(201,161,90,0.35)'
      ctx.lineWidth = 2
      ctx.strokeRect(24, rowY, W - 48, rowH - 14)
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillStyle = '#ece4d8'
      ctx.font = '400 22px Roboto, sans-serif'
      ctx.fillText(topic.title, W / 2, rowY + (rowH - 14) / 2)
    })
  }

  _rowHeight() {
    return (this.screenCanvas.height - 130) / TOPICS.length
  }

  _rowTop(i) {
    return 118 + i * this._rowHeight()
  }

  /* maps each drawn row's canvas rect to a world-space position on the
     screen plane, using a fixed, known camera framing rather than raw UV
     math — canvas y=0 is the top of the image, and CanvasTexture's
     default flipY keeps that visually at the top of the plane too, so
     "top of canvas" -> "top of screen in world space" */
  _initMenuHotspots() {
    this.menuItems = []
    const H = this.screenCanvas.height
    const rowH = this._rowHeight()
    const hotspotMat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false })

    TOPICS.forEach((topic, i) => {
      const rowY = this._rowTop(i)
      const rowCenterCanvasY = rowY + (rowH - 14) / 2
      const worldY = this.screenPos.y + this.screenH / 2 - (rowCenterCanvasY / H) * this.screenH
      const hotHeight = ((rowH - 14) / H) * this.screenH

      const hotspot = new THREE.Mesh(new THREE.PlaneGeometry(this.screenW * 0.92, hotHeight), hotspotMat)
      hotspot.position.set(this.screenPos.x, worldY, this.screenPos.z + 0.003)
      hotspot.userData.topicIndex = i
      this.scene.add(hotspot)
      this.menuItems.push(hotspot)
      this.roomMeshes.push(hotspot)
    })
  }

  _initMouseProp() {
    const mouseMat = new THREE.MeshStandardMaterial({ color: 0x1c1410, roughness: 0.4, metalness: 0.3 })
    const mouseProp = new THREE.Mesh(new THREE.SphereGeometry(0.09, 12, 8), mouseMat)
    mouseProp.scale.set(1, 0.5, 1.5)
    mouseProp.position.set(0.55, this.deskTopY + 0.045, -1.35)
    this.scene.add(mouseProp)
    this.roomMeshes.push(mouseProp)
  }

  /* ticket printer sitting on the desk — the payoff for picking a session
     on the computer. a paper "ticket" slides out of the slot (scale
     animation, see _startPrinting/update) with the film title on it and a
     synthesized print sound, giving the click an actual visible/audible
     consequence before cutting to the theater instead of just being an
     invisible scene-change trigger */
  _initPrinter() {
    const printerMat = new THREE.MeshStandardMaterial({ color: 0x151010, roughness: 0.4, metalness: 0.5 })
    const printer = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.35, 0.4), printerMat)
    printer.position.set(-0.95, this.deskTopY + 0.175, -1.5)
    this.scene.add(printer)
    this.roomMeshes.push(printer)

    this.printerSlot = printer.position.clone()
    this.printerSlot.y += 0.16

    /* the ticket itself — hidden/collapsed until _startPrinting runs */
    const ticketMat = new THREE.MeshBasicMaterial({ color: 0xece4d8, side: THREE.DoubleSide })
    const ticket = new THREE.Mesh(new THREE.PlaneGeometry(0.32, 0.85), ticketMat)
    ticket.position.copy(this.printerSlot)
    ticket.scale.y = 0.04
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

  /* short burst of rapid clicks at slightly randomized pitch — a
     synthesized approximation of a receipt/ticket printer chattering,
     since there's no real audio asset in the project to use instead */
  _playPrinterSound() {
    const Ctx = window.AudioContext || window.webkitAudioContext
    if (!Ctx) return
    const ctx = new Ctx()
    const clicks = 16
    for (let i = 0; i < clicks; i++) {
      const t = ctx.currentTime + i * 0.045
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = 'square'
      osc.frequency.value = 1700 + Math.random() * 500
      gain.gain.setValueAtTime(0.05, t)
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.03)
      osc.connect(gain)
      gain.connect(ctx.destination)
      osc.start(t)
      osc.stop(t + 0.035)
    }
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
    this.ticketMesh.scale.y = 0.04
    this.ticketMesh.visible = true

    this._playPrinterSound()
  }

  /* click-only — no drag-look anymore, the camera is fixed on the desk,
     so a plain 'click' (fires for mouse and touch alike) is all that's
     needed, no mousedown/move/up bookkeeping required */
  _bindEvents() {
    this._onClick = e => {
      const rect = this.container.getBoundingClientRect()
      this._tryBuy(e.clientX - rect.left, e.clientY - rect.top)
    }
    this.container.addEventListener('click', this._onClick)
  }

  _tryBuy(x, y) {
    const mouse = new THREE.Vector2((x / this.width) * 2 - 1, -(y / this.height) * 2 + 1)
    const raycaster = new THREE.Raycaster()
    raycaster.setFromCamera(mouse, this.camera)
    const hits = raycaster.intersectObjects(this.menuItems)
    if (hits.length > 0) this._startPrinting(hits[0].object.userData.topicIndex)
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
      this.ticketMesh.scale.y = lerp(0.04, 1, easeOutCubic(t))
      if (t >= 1) {
        this.printing = false
        this.onBuyTicket(this.printTopic)
      }
    }
  }

  dispose() {
    this.container.removeEventListener('click', this._onClick)
    this.screenTexture?.dispose()
    this.roomMeshes.forEach(m => { m.geometry?.dispose(); m.material?.map?.dispose(); m.material?.dispose() })
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
    document.getElementById('cinema-lobby-hud')?.classList.add('cinema-hidden')
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
