import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import type { Beacon, BeaconKind, Trip } from './activity.ts'
import { SPACING, hubPoint, parkPoint, type Lot, type Point } from './layout.ts'
import { pointAt, routeBetween, routeLength } from './routes.ts'

const HALF = SPACING / 2
const WALK_SPEED = 3.2
const TRAIL = 28

const palette = {
  ground: 0xf4efe4,
  road: 0xd8d2c4,
  lane: 0xfffbf0,
  walls: [0xfaf3e3, 0xf6e3d3, 0xe3efe9, 0xe6ecf5, 0xf3e6ef, 0xefeacb],
  roofs: [0x147a4c, 0x2d9cdb, 0xe8742c, 0x7a5cc7, 0xd64545],
  beacon: { request: 0x2d9cdb, ready: 0xf5a623, out: 0x147a4c, 'due-soon': 0xf5a623, overdue: 0xd64545 } as Record<BeaconKind, number>,
  walker: { pickup: 0x2d9cdb, return: 0xf5a623, delivery: 0x147a4c },
}

const hash = (text: string) => {
  let h = 2166136261
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619)
  return (h >>> 0) / 4294967295
}
const pick = <T,>(items: readonly T[], seed: string) => items[Math.floor(hash(seed) * items.length) % items.length]

export type Pick = { id: string }
export type Callbacks = {
  onPick: (pick: Pick | null) => void
  /** Called every frame with where to draw the label for the selection, in host pixels, or null. */
  onLabel: (at: { x: number; y: number } | null) => void
}

type Walker = {
  trip: Trip
  group: THREE.Group
  route: Point[]
  length: number
  born: number
  trail: THREE.Line
  samples: THREE.Vector3[]
  done: boolean
}

type BeaconMesh = { beacon: Beacon; group: THREE.Group; baseY: number; phase: number }

/** The Three.js town. Everything here is imperative; the React component only feeds it data. */
export class RelayScene {
  private readonly host: HTMLElement
  private readonly callbacks: Callbacks
  private readonly renderer: THREE.WebGLRenderer
  private readonly scene = new THREE.Scene()
  private readonly camera: THREE.OrthographicCamera
  private readonly controls: OrbitControls
  private readonly raycaster = new THREE.Raycaster()
  private readonly clock = new THREE.Clock()
  private readonly townGroup = new THREE.Group()
  private readonly dynamicGroup = new THREE.Group()
  private readonly effects: { points: THREE.Points; born: number }[] = []
  private readonly windowMaterial = new THREE.MeshStandardMaterial({ color: 0xcfe8ff, emissive: 0xffd98a, emissiveIntensity: 0 })
  private readonly lampMaterial = new THREE.MeshStandardMaterial({ color: 0xfff3c4, emissive: 0xffd98a, emissiveIntensity: 0 })
  private readonly hemi = new THREE.HemisphereLight(0xffffff, 0xd9d2c0, 1.1)
  private readonly sun = new THREE.DirectionalLight(0xffffff, 1.6)
  private readonly ring: THREE.Mesh
  private readonly houses = new Map<string, THREE.Group>()
  private walkers = new Map<string, Walker>()
  private beacons = new Map<string, BeaconMesh>()
  private positions = new Map<string, Point>()
  /** The object to aim at for each entity, so screen lookups follow bobbing beacons and moving walkers. */
  private anchors = new Map<string, { object: THREE.Object3D; lift: number }>()
  private selected: string | null = null
  private glide: { from: THREE.Vector3; to: THREE.Vector3; fromZoom: number; toZoom: number; start: number } | null = null
  private frame = 0
  private disposed = false
  private viewSize = 40
  private downAt: { x: number; y: number } | null = null
  private readonly resizeObserver: ResizeObserver
  private readonly disposables: { dispose: () => void }[] = []
  private night = false
  private readonly cleanups: (() => void)[] = []

  constructor(host: HTMLElement, callbacks: Callbacks) {
    this.host = host
    this.callbacks = callbacks
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
    this.renderer.shadowMap.enabled = true
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap
    this.renderer.domElement.style.display = 'block'
    this.renderer.domElement.style.touchAction = 'none'
    host.appendChild(this.renderer.domElement)

    this.camera = new THREE.OrthographicCamera(-20, 20, 20, -20, -200, 400)
    this.camera.position.set(46, 46, 46)
    this.camera.lookAt(0, 0, 0)

    this.controls = new OrbitControls(this.camera, this.renderer.domElement)
    this.controls.enableDamping = true
    this.controls.dampingFactor = 0.12
    this.controls.screenSpacePanning = false
    this.controls.mouseButtons = { LEFT: THREE.MOUSE.PAN, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.ROTATE }
    this.controls.touches = { ONE: THREE.TOUCH.PAN, TWO: THREE.TOUCH.DOLLY_ROTATE }
    this.controls.minZoom = 0.55
    this.controls.maxZoom = 4.5
    this.controls.minPolarAngle = 0.55
    this.controls.maxPolarAngle = 1.25
    this.controls.zoomSpeed = 1.1

    this.sun.position.set(30, 50, 20)
    this.sun.castShadow = true
    this.sun.shadow.mapSize.set(2048, 2048)
    Object.assign(this.sun.shadow.camera, { left: -60, right: 60, top: 60, bottom: -60, near: 1, far: 200 })
    this.scene.add(this.hemi, this.sun, this.townGroup, this.dynamicGroup)
    this.scene.background = new THREE.Color(0xdff0fb)

    this.ring = new THREE.Mesh(
      new THREE.RingGeometry(2.6, 3.1, 40),
      new THREE.MeshBasicMaterial({ color: 0x147a4c, side: THREE.DoubleSide, transparent: true, opacity: 0.9 }),
    )
    this.ring.rotation.x = -Math.PI / 2
    this.ring.position.y = 0.12
    this.ring.visible = false
    this.scene.add(this.ring)

    const el = this.renderer.domElement
    const down = (event: PointerEvent) => (this.downAt = { x: event.clientX, y: event.clientY })
    const up = (event: PointerEvent) => {
      const start = this.downAt
      this.downAt = null
      if (!start || Math.hypot(event.clientX - start.x, event.clientY - start.y) > 5) return
      this.pickAt(event.clientX, event.clientY)
    }
    el.addEventListener('pointerdown', down)
    el.addEventListener('pointerup', up)
    this.cleanups.push(() => el.removeEventListener('pointerdown', down), () => el.removeEventListener('pointerup', up))

    this.resizeObserver = new ResizeObserver(() => this.resize())
    this.resizeObserver.observe(host)
    this.resize()
    this.loop()
  }

  // ----- town -----------------------------------------------------------------------------

  setTown(lots: readonly Lot[], viewerId: string, garden: number) {
    this.clearGroup(this.townGroup)
    this.houses.clear()
    // Houses may have moved, so beacons and walkers built for the old layout are dropped. The caller re-adds them.
    for (const id of [...this.walkers.keys()]) this.removeWalker(id)
    for (const mesh of this.beacons.values()) this.dynamicGroup.remove(mesh.group)
    this.beacons.clear()
    this.positions.clear()
    this.anchors.clear()
    const cols = [...lots.map((lot) => lot.col), 1, -1]
    const rows = [...lots.map((lot) => lot.row), 1, -1]
    const [minCol, maxCol, minRow, maxRow] = [Math.min(...cols) - 1, Math.max(...cols) + 1, Math.min(...rows) - 1, Math.max(...rows) + 1]
    const width = (maxCol - minCol + 1) * SPACING
    const depth = (maxRow - minRow + 1) * SPACING
    const centerX = ((minCol + maxCol) / 2) * SPACING
    const centerZ = ((minRow + maxRow) / 2) * SPACING

    const ground = new THREE.Mesh(new THREE.BoxGeometry(width + 12, 0.4, depth + 12), this.mat(palette.ground))
    ground.position.set(centerX, -0.2, centerZ)
    ground.receiveShadow = true
    this.townGroup.add(ground)

    this.buildStreets(minCol, maxCol, minRow, maxRow)
    for (const lot of lots) this.addHouse(lot, lot.id === viewerId)
    this.addHub()
    this.addPark(garden)
    this.addLamps(minCol, maxCol, minRow, maxRow)
    this.positions.set('hub', hubPoint)
    this.positions.set('park', parkPoint)
    this.viewSize = Math.max(34, Math.max(width, depth) * 0.82)
    this.resize()
    this.controls.target.set(0, 0, 0)
    this.setNight(this.night)
  }

  private buildStreets(minCol: number, maxCol: number, minRow: number, maxRow: number) {
    const road = this.mat(palette.road)
    const lane = this.mat(palette.lane)
    const z0 = (minRow - 1) * SPACING + HALF
    const z1 = maxRow * SPACING + HALF
    const x0 = (minCol - 1) * SPACING + HALF
    const x1 = maxCol * SPACING + HALF
    for (let row = minRow - 1; row <= maxRow; row++) {
      const z = row * SPACING + HALF
      this.box(this.townGroup, road, x1 - x0 + 3.4, 0.06, 3.4, (x0 + x1) / 2, 0.03, z, false)
    }
    for (let col = minCol - 1; col <= maxCol; col++) {
      const x = col * SPACING + HALF
      this.box(this.townGroup, road, 3.4, 0.06, z1 - z0 + 3.4, x, 0.03, (z0 + z1) / 2, false)
    }
    // Zebra crossings on all four sides of every junction.
    const stripe = new THREE.BoxGeometry(0.5, 0.02, 2.4)
    this.disposables.push(stripe)
    const spots: THREE.Matrix4[] = []
    const m = new THREE.Matrix4()
    for (let row = minRow - 1; row <= maxRow; row++) {
      for (let col = minCol - 1; col <= maxCol; col++) {
        const cx = col * SPACING + HALF
        const cz = row * SPACING + HALF
        for (let i = -2; i <= 2; i++) {
          for (const [dx, dz, turn] of [[0, -2.7, 0], [0, 2.7, 0], [-2.7, 0, 1], [2.7, 0, 1]] as const) {
            m.makeRotationY(turn ? Math.PI / 2 : 0).setPosition(cx + dx + (turn ? 0 : i * 0.7), 0.075, cz + dz + (turn ? i * 0.7 : 0))
            spots.push(m.clone())
          }
        }
      }
    }
    const stripes = new THREE.InstancedMesh(stripe, lane, spots.length)
    spots.forEach((matrix, index) => stripes.setMatrixAt(index, matrix))
    this.townGroup.add(stripes)
  }

  private addHouse(lot: Lot, isViewer: boolean) {
    const group = new THREE.Group()
    const wall = pick(palette.walls, lot.id)
    const roof = pick(palette.roofs, `${lot.id}-roof`)
    this.box(group, this.mat(wall), 4.6, 3, 4.2, 0, 1.5, 0, true)
    const cone = new THREE.Mesh(new THREE.ConeGeometry(3.7, 2.3, 4), this.mat(roof))
    cone.position.y = 4.15
    cone.rotation.y = Math.PI / 4
    cone.castShadow = true
    this.disposables.push(cone.geometry)
    group.add(cone)
    this.box(group, this.mat(0x7a5a3a), 0.9, 1.7, 0.2, 0, 0.85, 2.15, false)
    for (const side of [-1.4, 1.4]) this.box(group, this.windowMaterial, 0.9, 0.9, 0.2, side, 1.9, 2.15, false)
    if (isViewer) {
      const flag = this.mat(0x147a4c)
      this.box(group, flag, 0.15, 2, 0.15, 2.6, 1, 2.2, false)
      this.box(group, flag, 1.1, 0.7, 0.1, 3.1, 1.8, 2.2, false)
    }
    group.position.set(lot.x, 0, lot.z)
    this.tag(group, `h:${lot.id}`)
    this.townGroup.add(group)
    this.houses.set(lot.id, group)
    this.positions.set(`h:${lot.id}`, { x: lot.x, z: lot.z })
    this.anchors.set(`h:${lot.id}`, { object: group, lift: 2.2 })
  }

  private addHub() {
    const group = new THREE.Group()
    this.box(group, this.mat(0xffffff), 6.4, 3.6, 6.4, 0, 1.8, 0, true)
    this.box(group, this.mat(0x147a4c), 7, 0.6, 7, 0, 3.9, 0, true)
    const sign = document.createElement('canvas')
    sign.width = 256
    sign.height = 64
    const ctx = sign.getContext('2d')
    if (ctx) {
      ctx.fillStyle = '#147a4c'
      ctx.fillRect(0, 0, 256, 64)
      ctx.fillStyle = '#fff'
      ctx.font = '700 36px system-ui, sans-serif'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText('Relay Hub', 128, 34)
    }
    const texture = new THREE.CanvasTexture(sign)
    this.disposables.push(texture)
    const board = new THREE.Mesh(new THREE.PlaneGeometry(4.4, 1.1), new THREE.MeshBasicMaterial({ map: texture }))
    board.position.set(0, 2.6, 3.25)
    this.disposables.push(board.geometry)
    group.add(board)
    group.position.set(hubPoint.x, 0, hubPoint.z)
    this.anchors.set('hub', { object: group, lift: 2.4 })
    this.tag(group, 'hub')
    this.townGroup.add(group)
  }

  private addPark(garden: number) {
    const lawn = this.box(this.townGroup, this.mat(0xcfe8b8), SPACING - 3.6, 0.12, SPACING - 3.6, parkPoint.x, 0.06, parkPoint.z, false)
    this.tag(lawn, 'park')
    for (let i = 0; i < 6; i++) {
      const x = parkPoint.x + (hash(`tree${i}`) - 0.5) * (SPACING - 5)
      const z = parkPoint.z + (hash(`tree-z${i}`) - 0.5) * (SPACING - 5)
      this.box(this.townGroup, this.mat(0x8b6a43), 0.4, 1.4, 0.4, x, 0.7, z, true)
      const crown = new THREE.Mesh(new THREE.ConeGeometry(1.3, 2.6, 6), this.mat(0x2e8b57))
      crown.position.set(x, 2.5, z)
      crown.castShadow = true
      this.disposables.push(crown.geometry)
      this.townGroup.add(crown)
    }
    // One flower for each exchange finished between neighbors (the garden tally).
    const flower = new THREE.SphereGeometry(0.28, 8, 6)
    this.disposables.push(flower)
    const colors = [0xff7aa2, 0xffd166, 0xc77dff, 0xff9f1c, 0xf94144]
    for (let i = 0; i < Math.min(60, Math.max(0, garden)); i++) {
      const x = parkPoint.x + (hash(`f${i}`) - 0.5) * (SPACING - 4.4)
      const z = parkPoint.z + (hash(`fz${i}`) - 0.5) * (SPACING - 4.4)
      const bloom = new THREE.Mesh(flower, this.mat(colors[i % colors.length]))
      bloom.position.set(x, 0.42, z)
      this.townGroup.add(bloom)
    }
  }

  private addLamps(minCol: number, maxCol: number, minRow: number, maxRow: number) {
    const post = this.mat(0x4a5a6a)
    const bulb = new THREE.SphereGeometry(0.35, 8, 6)
    this.disposables.push(bulb)
    for (let row = minRow; row <= maxRow; row += 2) {
      for (let col = minCol; col <= maxCol; col += 2) {
        const x = col * SPACING + HALF + 2.2
        const z = row * SPACING + HALF + 2.2
        this.box(this.townGroup, post, 0.18, 2.6, 0.18, x, 1.3, z, false)
        const lamp = new THREE.Mesh(bulb, this.lampMaterial)
        lamp.position.set(x, 2.7, z)
        this.townGroup.add(lamp)
      }
    }
  }

  // ----- activity -------------------------------------------------------------------------

  setGroupBuys(items: readonly { id: string; members: number }[]) {
    for (const child of [...this.dynamicGroup.children]) {
      if (child.userData.kind === 'crates') this.dynamicGroup.remove(child)
    }
    const group = new THREE.Group()
    group.userData.kind = 'crates'
    items.slice(0, 6).forEach((item, index) => {
      for (let n = 0; n < Math.min(4, Math.max(1, item.members)); n++) {
        this.box(group, this.mat(pick([0xc89b5a, 0xb88a4a, 0xd8ad6a], `${item.id}${n}`)), 1, 1, 1, hubPoint.x - 4.2 + index * 1.2, 0.5 + n * 1.02, hubPoint.z + 4.6, true)
      }
    })
    this.tag(group, 'hub')
    this.dynamicGroup.add(group)
  }

  setBeacons(beacons: readonly Beacon[]) {
    const next = new Set(beacons.map((beacon) => beacon.id))
    for (const [id, mesh] of this.beacons) {
      if (!next.has(id)) {
        this.dynamicGroup.remove(mesh.group)
        this.beacons.delete(id)
      }
    }
    const perHouse = new Map<string, number>()
    for (const beacon of beacons) {
      const house = this.positions.get(`h:${beacon.residentId}`)
      if (!house) continue
      const slot = perHouse.get(beacon.residentId) ?? 0
      perHouse.set(beacon.residentId, slot + 1)
      const existing = this.beacons.get(beacon.id)
      if (existing) {
        existing.beacon = beacon
        continue
      }
      const group = new THREE.Group()
      const color = palette.beacon[beacon.kind]
      const material = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: beacon.kind === 'overdue' ? 0.9 : 0.35 })
      const shape =
        beacon.kind === 'request'
          ? new THREE.SphereGeometry(0.7, 12, 10)
          : beacon.kind === 'overdue'
            ? new THREE.ConeGeometry(0.8, 1.6, 4)
            : new THREE.BoxGeometry(1.1, 1.1, 1.1)
      const mesh = new THREE.Mesh(shape, material)
      mesh.castShadow = true
      group.add(mesh)
      group.position.set(house.x + (slot % 3) * 1.4 - 1.4, 7.4 + Math.floor(slot / 3) * 1.4, house.z)
      this.tag(group, `s:${beacon.subjectId}`)
      this.dynamicGroup.add(group)
      this.positions.set(`s:${beacon.subjectId}`, house)
      this.anchors.set(`s:${beacon.subjectId}`, { object: group, lift: 0 })
      this.beacons.set(beacon.id, { beacon, group, baseY: group.position.y, phase: hash(beacon.id) * 6.28 })
    }
  }

  /** Replace the set of walkers that repeat their trip until the state changes. */
  setRepeatingTrips(trips: readonly Trip[]) {
    const wanted = new Set(trips.map((trip) => trip.id))
    for (const [id, walker] of this.walkers) {
      if (walker.trip.repeat && !wanted.has(id)) this.removeWalker(id)
    }
    for (const trip of trips) if (!this.walkers.has(trip.id)) this.addWalker(trip)
  }

  playTrips(trips: readonly Trip[]) {
    for (const trip of trips) if (!this.walkers.has(trip.id)) this.addWalker(trip)
  }

  private addWalker(trip: Trip) {
    const from = this.positions.get(`h:${trip.fromId}`)
    const to = this.positions.get(`h:${trip.toId}`)
    if (!from || !to) return
    const route = routeBetween(from, to)
    const group = new THREE.Group()
    const color = palette.walker[trip.purpose]
    this.box(group, this.mat(color), 0.8, 1.2, 0.6, 0, 0.9, 0, true)
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.38, 10, 8), this.mat(0xf1c9a5))
    head.position.y = 1.85
    head.castShadow = true
    this.disposables.push(head.geometry)
    group.add(head)
    this.box(group, this.mat(0xc89b5a), 0.7, 0.7, 0.5, 0, 1.05, -0.5, true)
    this.tag(group, `t:${trip.id}`)

    const samples: THREE.Vector3[] = []
    const lineGeometry = new THREE.BufferGeometry().setFromPoints(Array.from({ length: TRAIL }, () => new THREE.Vector3(from.x, 0.2, from.z)))
    const trail = new THREE.Line(lineGeometry, new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.55 }))
    trail.frustumCulled = false
    this.dynamicGroup.add(group, trail)
    this.positions.set(`t:${trip.id}`, from)
    this.anchors.set(`t:${trip.id}`, { object: group, lift: 1.6 })
    this.walkers.set(trip.id, { trip, group, route, length: routeLength(route), born: this.clock.elapsedTime + (trip.repeat ? hash(trip.id) * 4 : 0), trail, samples, done: false })
  }

  private removeWalker(id: string) {
    const walker = this.walkers.get(id)
    if (!walker) return
    this.dynamicGroup.remove(walker.group, walker.trail)
    walker.trail.geometry.dispose()
    this.walkers.delete(id)
    this.positions.delete(`t:${id}`)
    this.anchors.delete(`t:${id}`)
    if (this.selected === `t:${id}`) this.select(null)
  }

  private burst(at: Point, color: number) {
    const count = 26
    const positions = new Float32Array(count * 3)
    const velocities: THREE.Vector3[] = []
    for (let i = 0; i < count; i++) {
      positions.set([at.x, 1.6, at.z], i * 3)
      velocities.push(new THREE.Vector3((Math.random() - 0.5) * 6, 3 + Math.random() * 4, (Math.random() - 0.5) * 6))
    }
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    const points = new THREE.Points(geometry, new THREE.PointsMaterial({ color, size: 0.5, transparent: true }))
    points.userData.velocities = velocities
    points.frustumCulled = false
    this.dynamicGroup.add(points)
    this.effects.push({ points, born: this.clock.elapsedTime })
  }

  // ----- selection and camera ---------------------------------------------------------------

  select(id: string | null) {
    this.selected = id
    this.ring.visible = false
    if (!id) {
      this.callbacks.onLabel(null)
      return
    }
    const at = this.positions.get(id)
    if (!at) return
    this.ring.visible = true
    this.ring.position.set(at.x, 0.12, at.z)
    this.flyTo(at.x, at.z, 1.6)
  }

  flyTo(x: number, z: number, zoom = this.camera.zoom) {
    const to = new THREE.Vector3(x, 0, z)
    this.glide = { from: this.controls.target.clone(), to, fromZoom: this.camera.zoom, toZoom: Math.min(this.controls.maxZoom, Math.max(this.controls.minZoom, zoom)), start: this.clock.elapsedTime }
  }

  setNight(night: boolean) {
    this.night = night
    this.scene.background = new THREE.Color(night ? 0x0f1b2d : 0xdff0fb)
    this.hemi.intensity = night ? 0.35 : 1.1
    this.sun.intensity = night ? 0.25 : 1.6
    this.windowMaterial.emissiveIntensity = night ? 1.1 : 0
    this.lampMaterial.emissiveIntensity = night ? 1.4 : 0
  }

  /** Where an entity is on screen, in host pixels. Used by tests and by the selection label. */
  screenOf(id: string): { x: number; y: number } | null {
    const anchor = this.anchors.get(id)
    const at = anchor?.object.position ?? this.positions.get(id)
    if (!at) return null
    const y = anchor ? anchor.object.position.y + anchor.lift : 1
    const vector = new THREE.Vector3(at.x, y, at.z).project(this.camera)
    const rect = this.renderer.domElement.getBoundingClientRect()
    return { x: ((vector.x + 1) / 2) * rect.width, y: ((1 - vector.y) / 2) * rect.height }
  }

  entities() {
    return [...this.positions.keys()]
  }

  private pickAt(clientX: number, clientY: number) {
    const rect = this.renderer.domElement.getBoundingClientRect()
    const pointer = new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1)
    this.raycaster.setFromCamera(pointer, this.camera)
    const hits = this.raycaster.intersectObjects([this.townGroup, this.dynamicGroup], true)
    for (const hit of hits) {
      let node: THREE.Object3D | null = hit.object
      while (node && !node.userData.entityId) node = node.parent
      if (node?.userData.entityId) {
        this.callbacks.onPick({ id: node.userData.entityId as string })
        return
      }
    }
    this.callbacks.onPick(null)
  }

  // ----- loop -------------------------------------------------------------------------------

  private loop = () => {
    if (this.disposed) return
    this.frame = requestAnimationFrame(this.loop)
    const time = this.clock.getElapsedTime()

    if (this.glide) {
      const k = Math.min(1, (time - this.glide.start) / 0.9)
      const eased = 1 - Math.pow(1 - k, 3)
      this.controls.target.lerpVectors(this.glide.from, this.glide.to, eased)
      this.camera.zoom = this.glide.fromZoom + (this.glide.toZoom - this.glide.fromZoom) * eased
      this.camera.updateProjectionMatrix()
      if (k >= 1) this.glide = null
    }

    for (const [id, walker] of this.walkers) {
      const duration = Math.max(4, walker.length / WALK_SPEED)
      const age = time - walker.born
      if (age < 0) {
        walker.group.visible = false
        continue
      }
      let t = age / duration
      if (walker.trip.repeat) {
        t = (age % (duration + 2)) / duration
        walker.group.visible = t <= 1
      } else if (age > duration) {
        this.burst(pointAt(walker.route, 1), palette.walker[walker.trip.purpose])
        this.removeWalker(id)
        continue
      }
      const spot = pointAt(walker.route, Math.min(1, t))
      walker.group.position.set(spot.x, 0, spot.z)
      walker.group.rotation.y = spot.heading
      this.positions.set(`t:${id}`, { x: spot.x, z: spot.z })
      walker.samples.unshift(new THREE.Vector3(spot.x, 0.2, spot.z))
      walker.samples.length = Math.min(walker.samples.length, TRAIL)
      const attribute = walker.trail.geometry.getAttribute('position') as THREE.BufferAttribute
      for (let i = 0; i < TRAIL; i++) {
        const sample = walker.samples[Math.min(i, walker.samples.length - 1)]
        attribute.setXYZ(i, sample.x, sample.y, sample.z)
      }
      attribute.needsUpdate = true
      walker.trail.visible = walker.group.visible
      if (this.selected === `t:${id}`) {
        this.ring.position.set(spot.x, 0.12, spot.z)
        if (!this.glide) this.controls.target.lerp(new THREE.Vector3(spot.x, 0, spot.z), 0.12)
      }
    }

    for (const mesh of this.beacons.values()) {
      const urgent = mesh.beacon.kind === 'overdue'
      mesh.group.position.y = mesh.baseY + Math.sin(time * (urgent ? 4 : 2) + mesh.phase) * (urgent ? 0.35 : 0.22)
      mesh.group.rotation.y = time * 0.9
      const scale = urgent ? 1 + Math.sin(time * 5 + mesh.phase) * 0.12 : 1
      mesh.group.scale.setScalar(scale)
    }

    for (let i = this.effects.length - 1; i >= 0; i--) {
      const effect = this.effects[i]
      const age = time - effect.born
      const attribute = effect.points.geometry.getAttribute('position') as THREE.BufferAttribute
      const velocities = effect.points.userData.velocities as THREE.Vector3[]
      velocities.forEach((velocity, index) => {
        attribute.setXYZ(index, attribute.getX(index) + velocity.x * 0.016, Math.max(0.1, attribute.getY(index) + (velocity.y - age * 7) * 0.016), attribute.getZ(index) + velocity.z * 0.016)
      })
      attribute.needsUpdate = true
      ;(effect.points.material as THREE.PointsMaterial).opacity = Math.max(0, 1 - age / 0.9)
      if (age > 0.9) {
        this.dynamicGroup.remove(effect.points)
        effect.points.geometry.dispose()
        this.effects.splice(i, 1)
      }
    }

    this.controls.update()
    this.callbacks.onLabel(this.selected ? this.screenOf(this.selected) : null)
    this.renderer.render(this.scene, this.camera)
  }

  private resize() {
    const width = Math.max(1, this.host.clientWidth)
    const height = Math.max(1, this.host.clientHeight)
    this.renderer.setSize(width, height, false)
    this.renderer.domElement.style.width = '100%'
    this.renderer.domElement.style.height = '100%'
    const aspect = width / height
    this.camera.left = (-this.viewSize * aspect) / 2
    this.camera.right = (this.viewSize * aspect) / 2
    this.camera.top = this.viewSize / 2
    this.camera.bottom = -this.viewSize / 2
    this.camera.updateProjectionMatrix()
  }

  // ----- helpers ----------------------------------------------------------------------------

  private mat(color: number) {
    const material = new THREE.MeshStandardMaterial({ color, roughness: 0.85, flatShading: true })
    this.disposables.push(material)
    return material
  }

  private box(parent: THREE.Object3D, material: THREE.Material, w: number, h: number, d: number, x: number, y: number, z: number, shadow: boolean) {
    const geometry = new THREE.BoxGeometry(w, h, d)
    this.disposables.push(geometry)
    const mesh = new THREE.Mesh(geometry, material)
    mesh.position.set(x, y, z)
    mesh.castShadow = shadow
    mesh.receiveShadow = true
    parent.add(mesh)
    return mesh
  }

  private tag(node: THREE.Object3D, id: string) {
    node.userData.entityId = id
  }

  private clearGroup(group: THREE.Group) {
    for (const child of [...group.children]) group.remove(child)
  }

  dispose() {
    this.disposed = true
    cancelAnimationFrame(this.frame)
    this.resizeObserver.disconnect()
    this.cleanups.forEach((cleanup) => cleanup())
    this.controls.dispose()
    for (const item of this.disposables) item.dispose()
    this.windowMaterial.dispose()
    this.lampMaterial.dispose()
    this.renderer.dispose()
    this.renderer.forceContextLoss()
    this.renderer.domElement.remove()
  }
}
