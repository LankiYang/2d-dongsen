// 通用地图场景：渲染 shared/world 生成的任意地图（单岛、群岛、大陆、洞穴）。
// 按镜头位置流式加载 32×32 地块的区块：地面/水面在 Web Worker 里后台烘焙，物件和碰撞在主线程按需生成，
// 走远了就释放。所以地图多大都行，内存和耗时只跟屏幕附近有关。
import { HD } from '../acstyle.ts'
import { BufferImageSource, Container, Graphics, Sprite, Text, Texture } from 'pixi.js'
import type { Game, Scene } from '../game.ts'
import { PixelView } from '../core/pixelview.ts'
import { WaterFilter } from '../island/water.ts'
import { Farmer } from '../island/farmer.ts'
import { Particles } from '../fx/particles.ts'
import { Swayer, swaySplit } from '../fx/sway.ts'
import { sky } from '../island/scene.ts'
import { World } from '../../shared/world/gen.ts'
import type { MapDef, Portal, Rect, WObj } from '../../shared/world/gen.ts'
import { MAPS } from '../../shared/world/maps.ts'
import { CHUNK } from '../../shared/world/defs.ts'
import { TILE } from '../../shared/data.ts'
import type { PlayerPublic, SceneId } from '../../shared/protocol.ts'
import { state } from '../state.ts'
import { dirOf } from '../core/input.ts'

const P = CHUNK * TILE
const SPEED = 88

// 生成器的骨架在主线程也要一份（碰撞、物件）；同一张图反复进出只建一次
const worlds = new Map<string, World>()
export function worldOf(def: MapDef) {
  let w = worlds.get(def.id)
  if (!w) { w = new World(def); worlds.set(def.id, w) }
  return w
}

interface Lamp { s: Sprite, x: number, y: number, flicker: number, day: number }
interface Loaded {
  cx: number; cy: number
  ground?: Sprite; water?: Sprite
  nodes: Container[]            // 物件和阴影
  sways: Swayer[]
  lamps: Lamp[]
  solids: Rect[]
}

// 几个 Worker 并行烘焙，队列按离玩家远近排
class BakePool {
  private workers: { w: Worker, busy: boolean }[] = []
  private queue: [number, number][] = []
  onBaked: (cx: number, cy: number, size: number, ground: ArrayBuffer, water: ArrayBuffer) => void = () => {}
  constructor(def: MapDef) {
    const n = Math.max(1, Math.min(4, (navigator.hardwareConcurrency || 2) - 1))
    for (let i = 0; i < n; i++) {
      const w = new Worker(new URL('./bake.worker.ts', import.meta.url), { type: 'module' })
      const slot = { w, busy: false }
      w.onmessage = e => {
        slot.busy = false
        const m = e.data
        this.onBaked(m.cx, m.cy, m.size, m.ground, m.water)
        this.pump()
      }
      w.postMessage({ t: 'init', def })
      this.workers.push(slot)
    }
  }
  request(cx: number, cy: number) { if (!this.queue.some(q => q[0] === cx && q[1] === cy)) this.queue.push([cx, cy]) }
  cancel(cx: number, cy: number) { this.queue = this.queue.filter(q => q[0] !== cx || q[1] !== cy) }
  sort(px: number, py: number) { this.queue.sort((a, b) => Math.hypot(a[0] + 0.5 - px, a[1] + 0.5 - py) - Math.hypot(b[0] + 0.5 - px, b[1] + 0.5 - py)) }
  pump() {
    for (const s of this.workers) {
      if (s.busy || !this.queue.length) continue
      const [cx, cy] = this.queue.shift()!
      s.busy = true
      s.w.postMessage({ t: 'bake', cx, cy })
    }
  }
  destroy() { for (const s of this.workers) s.w.terminate() }
}

function bufferTexture(buf: ArrayBuffer, size: number) {
  const source = new BufferImageSource({ resource: new Uint8Array(buf), width: size, height: size, format: 'rgba8unorm', alphaMode: 'premultiply-alpha-on-upload', scaleMode: 'nearest' })
  return new Texture({ source })
}

export class WorldScene implements Scene {
  view: PixelView
  overlay = new Container()
  world: World
  waterLayer = new Container()
  waterFilter = new WaterFilter()
  groundLayer = new Container()
  shadowLayer = new Container()
  entities = new Container()
  fx = new Particles()
  me: Farmer
  myLight: Sprite
  others = new Map<number, Farmer>()
  chunks = new Map<number, Loaded>()
  pool: BakePool
  sceneId: SceneId
  compass = new Container()          // 屏幕边缘指向最近传送石的箭头
  private compassArrow = new Graphics()
  private compassText: Text
  private cave: boolean
  private unsub: (() => void)[] = []
  private sendT = 0
  private lastSent = ''
  private stepT = 0
  private zoomCd = 0

  constructor(private g: Game, private def: MapDef) {
    this.sceneId = `map:${def.id}`
    this.world = worldOf(def)
    this.cave = def.kind === 'cave'
    this.view = new PixelView(g.app.renderer as any, 300, 'world', HD)
    this.view.mapW = def.w * TILE; this.view.mapH = def.h * TILE
    const W = this.view.world
    // 区块还没烘焙好时露出来的底色：海或岩石
    const bg = new Graphics().rect(-2000, -2000, def.w * TILE + 4000, def.h * TILE + 4000).fill(this.cave ? 0x0e0b10 : 0x17477f)
    this.waterLayer.filters = [this.waterFilter]
    this.entities.sortableChildren = true
    W.addChild(bg, this.waterLayer, this.groundLayer, this.shadowLayer, this.entities, this.fx.layer)

    // 方向指引：青色箭头 + 「传送石 · 村名 N 格」
    this.compassArrow.poly([22, 0, -8, -14, -2, 0, -8, 14]).fill(0x6fe3ff).stroke({ color: 0x0d3a48, width: 4 })
    this.compassText = new Text({ text: '', style: { fontFamily: 'FusionPixel', fontSize: 24, fill: 0xd8fbff, stroke: { color: 0x0d2a36, width: 4 } }, resolution: 1 })
    this.compassText.anchor.set(0.5)
    this.compass.addChild(this.compassArrow, this.compassText)
    this.overlay.addChild(this.compass)

    this.me = new Farmer(g.assets, state.me.hue, state.me.name, true)
    // 起点由服务端的 goto 给出（就是某块传送石的站位）；万一没有就站到第一块传送石前
    const sp = this.world.spawn()
    const start = g.meStart.x > 0 ? g.meStart : { x: sp.x * TILE, y: sp.y * TILE }
    this.me.x = this.me.tx = start.x
    this.me.y = this.me.ty = start.y
    this.entities.addChild(this.me.root)
    this.overlay.addChild(this.me.tag)
    this.myLight = this.addLight(0xffd79a)

    this.pool = new BakePool(def)
    this.pool.onBaked = (cx, cy, size, ground, water) => this.onBaked(cx, cy, size, ground, water)

    g.app.stage.addChild(this.view.display, this.overlay)
    this.unsub.push(
      g.net.on('players', m => this.syncPlayers(m.list)),
      g.net.on('left', m => this.removeOther(m.id)),
    )
    this.view.post.set('uMode', 0)
    g.hud.setSeaMode(false)
    g.hud.showZone(def.name)
    this.unstick()
    this.snapCamera()
    this.stream(true)
  }

  private addLight(color: number) {
    const s = new Sprite(this.g.assets.light)
    s.anchor.set(0.5)
    s.tint = color
    s.blendMode = 'add'
    this.view.lights.addChild(s)
    return s
  }

  // ── 区块流式加载 ──
  private key = (cx: number, cy: number) => cy * 65536 + cx
  private stream(force = false) {
    const v = this.view
    const pad = P * 0.5
    const cx0 = Math.max(0, Math.floor((v.camX - pad) / P)), cy0 = Math.max(0, Math.floor((v.camY - pad) / P))
    const cx1 = Math.min(Math.ceil(this.def.w / CHUNK) - 1, Math.floor((v.camX + v.viewW + pad) / P))
    const cy1 = Math.min(Math.ceil(this.def.h / CHUNK) - 1, Math.floor((v.camY + v.viewH + pad) / P))
    // 每帧最多新建一个区块（生成物件要几毫秒），离玩家最近的先建；首次进场景时一次建完
    let added = false
    let best: [number, number] | null = null, bd = Infinity
    const mx = this.me.x / P - 0.5, my = this.me.y / P - 0.5
    for (let cy = cy0; cy <= cy1; cy++) for (let cx = cx0; cx <= cx1; cx++) {
      if (this.chunks.has(this.key(cx, cy))) continue
      if (force) { this.loadChunk(cx, cy); added = true; continue }
      const d = Math.hypot(cx - mx, cy - my)
      if (d < bd) { bd = d; best = [cx, cy] }
    }
    if (best) { this.loadChunk(best[0], best[1]); added = true }
    // 离开视野 1.5 个区块以外的释放掉
    for (const [k, c] of this.chunks) {
      if (c.cx < cx0 - 1 || c.cx > cx1 + 1 || c.cy < cy0 - 1 || c.cy > cy1 + 1) { this.unloadChunk(c); this.chunks.delete(k) }
    }
    if (added || force) { this.pool.sort(this.me.x / P, this.me.y / P); this.pool.pump() }
  }

  private loadChunk(cx: number, cy: number) {
    const { assets } = this.g
    const data = this.world.chunk(cx, cy)
    const c: Loaded = { cx, cy, nodes: [], sways: [], lamps: [], solids: data.solids }
    for (const o of data.objects) this.addObject(c, o)
    for (const n of c.nodes) n.visible = false
    for (const l of c.lamps) l.s.visible = false
    this.chunks.set(this.key(cx, cy), c)
    this.pool.request(cx, cy)
    void assets
  }

  private addObject(c: Loaded, o: WObj) {
    const { assets } = this.g
    const tex = assets.island[o.kind] ?? assets.decor[o.kind]
    if (!tex) return // 新地貌的素材还没画
    const sw = o.sway ? new Swayer(tex, swaySplit(o.kind)) : undefined
    const s: Container = sw ? sw.root : new Sprite(tex)
    s.position.set(o.x, o.y)
    if (o.flip) s.scale.x = -1
    s.zIndex = o.y
    this.entities.addChild(s)
    c.nodes.push(s)
    if (sw) c.sways.push(sw)
    if (o.kind !== 'pebbles' && o.kind !== 'lantern') {
      const wide = o.kind.startsWith('house')
      const sh = new Sprite(assets.shadow(wide ? tex.width * 0.8 : Math.min(60, tex.width * (o.kind.startsWith('palm') ? 0.45 : 0.7))))
      sh.position.set(o.x + (o.kind.startsWith('palm') ? (o.flip ? 6 : -6) : 0), o.y - 1)
      this.shadowLayer.addChild(sh)
      c.nodes.push(sh)
    }
    if (o.light) {
      const spots = o.kind.startsWith('house') ? [[-46, -36], [46, -36], [0, -18]] : o.kind === 'lantern' ? [[4, -26]] : o.kind.startsWith('waystone') ? [[0, -46], [0, -20]] : [[0, -6]]
      for (const [dx, dy] of spots) {
        const l = this.addLight(o.light.color)
        l.position.set(o.x + dx, o.y + dy)
        l.scale.set(o.light.r / 64)
        // 传送石白天也微微发光
        const stone = o.kind.startsWith('waystone')
        c.lamps.push({ s: l, x: o.x + dx, y: o.y + dy, flicker: stone ? 0.25 : 0.12, day: stone ? 0.35 : 0 })
      }
    }
  }

  private onBaked(cx: number, cy: number, size: number, ground: ArrayBuffer, water: ArrayBuffer) {
    const c = this.chunks.get(this.key(cx, cy))
    if (!c) return // 烘焙期间已经走远了
    c.ground = new Sprite(bufferTexture(ground, size))
    c.ground.position.set(cx * P, cy * P)
    this.groundLayer.addChild(c.ground)
    c.water = new Sprite(bufferTexture(water, size))
    c.water.position.set(cx * P, cy * P)
    this.waterLayer.addChild(c.water)
    for (const n of c.nodes) n.visible = true
    for (const l of c.lamps) l.s.visible = true
  }

  private unloadChunk(c: Loaded) {
    this.pool.cancel(c.cx, c.cy)
    c.ground?.destroy({ texture: true, textureSource: true })
    c.water?.destroy({ texture: true, textureSource: true })
    for (const n of c.nodes) n.destroy({ children: true })
    for (const l of c.lamps) l.s.destroy()
  }

  // ── 碰撞 ──
  private free(x: number, y: number) {
    const w = this.world
    const b = (px: number, py: number) => w.blockedAt(Math.floor(px / TILE), Math.floor(py / TILE))
    if (b(x - 5, y - 4) || b(x + 5, y - 4) || b(x - 5, y) || b(x + 5, y)) return false
    const x0 = x - 5, x1 = x + 5, y0 = y - 4, y1 = y
    const cx = Math.floor(x / P), cy = Math.floor(y / P)
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const c = this.chunks.get(this.key(cx + dx, cy + dy))
      if (!c) continue
      for (const r of c.solids) if (x1 > r[0] && x0 < r[2] && y1 > r[1] && y0 < r[3]) return false
    }
    return true
  }
  private slide(vx: number, vy: number) {
    const me = this.me
    if (this.free(me.x + vx, me.y + vy)) { me.x += vx; me.y += vy; return }
    const [px, py] = vx ? [0, 1] : [1, 0]
    for (let n = 1; n <= 8; n++) for (const sgn of [1, -1]) {
      if (this.free(me.x + vx + px * n * sgn, me.y + vy + py * n * sgn) && this.free(me.x + px * Math.min(n, 1.5) * sgn, me.y + py * Math.min(n, 1.5) * sgn)) {
        me.x += px * Math.min(n, 1.5) * sgn; me.y += py * Math.min(n, 1.5) * sgn
        return
      }
    }
  }
  private unstick() {
    const me = this.me
    if (this.free(me.x, me.y)) return
    for (let r = 4; r <= 400; r += 4) for (let a = 0; a < 16; a++) {
      const x = me.x + Math.cos((a / 16) * Math.PI * 2) * r, y = me.y + Math.sin((a / 16) * Math.PI * 2) * r
      if (this.free(x, y)) { me.x = x; me.y = y; return }
    }
  }

  private snapCamera() {
    this.view.camX = this.me.x - this.view.viewW / 2
    this.view.camY = this.me.y - 20 - this.view.viewH / 2
    this.clampCamera()
  }
  private clampCamera() {
    const v = this.view, W = this.def.w * TILE, H = this.def.h * TILE
    v.camX = v.viewW >= W ? (W - v.viewW) / 2 : Math.max(0, Math.min(W - v.viewW, v.camX))
    v.camY = v.viewH >= H ? (H - v.viewH) / 2 : Math.max(0, Math.min(H - v.viewH, v.camY))
  }

  // ── 其他玩家 ──
  private syncPlayers(list: PlayerPublic[]) {
    const seen = new Set<number>()
    for (const p of list) {
      if (p.scene !== this.sceneId || p.id === state.me.id) continue
      seen.add(p.id)
      let f = this.others.get(p.id)
      if (!f) {
        f = new Farmer(this.g.assets, p.hue, p.name, false)
        f.x = f.tx = p.x; f.y = f.ty = p.y
        this.entities.addChild(f.root)
        this.overlay.addChild(f.tag)
        this.others.set(p.id, f)
      }
      f.tx = p.x; f.ty = p.y; f.dir = p.dir; f.moving = p.moving
    }
    for (const id of [...this.others.keys()]) if (!seen.has(id)) this.removeOther(id)
  }
  private removeOther(id: number) { this.others.get(id)?.destroy(); this.others.delete(id) }

  // 传送石菜单：回潮汐港 / 去别的地图 / 本图其他村子（最近的 4 个）
  private portalMenu(here: Portal) {
    const { hud, net } = this.g
    type Opt = { label: string, go: () => void }
    const opts: Opt[] = [{ label: '回潮汐港', go: () => net.send({ t: 'travel', to: 'island' }) }]
    const others = this.world.portals.filter(p => p !== here)
      .map(p => ({ p, d: Math.hypot(p.x - here.x, p.y - here.y) })).sort((a, b) => a.d - b.d).slice(0, 4)
    for (const { p, d } of others) opts.push({ label: `${p.name}（${Math.round(d)} 格）`, go: () => net.send({ t: 'travel', to: this.sceneId, portal: p.id }) })
    for (const m of Object.values(MAPS)) if (m.id !== this.def.id) opts.push({ label: m.name, go: () => net.send({ t: 'travel', to: `map:${m.id}` }) })
    opts.push({ label: '算了', go: () => {} })
    hud.dialog({
      name: '传送石', title: `${this.def.name} · ${here.name}`, face: '', voice: 1.6,
      text: '石碑上的符文亮了起来。要去哪儿？',
      options: opts.map(o => ({ label: o.label })),
      onOption: i => { hud.closeDialog(); opts[i].go() },
    })
  }

  // 同一张图里的传送：服务端批准后就地瞬移
  teleport(x: number, y: number) {
    this.g.hud.fade(true)
    setTimeout(() => {
      this.me.x = this.me.tx = x; this.me.y = this.me.ty = y
      this.snapCamera()
      this.stream(true)
      this.g.audio.play('splash', 0.5, 1.4)
      setTimeout(() => this.g.hud.fade(false), 250)
    }, 350)
  }

  private updateCompass() {
    const v = this.view, me = this.me
    const { portal, dist } = this.world.nearestPortal(me.x / TILE, me.y / TILE)
    const p = v.worldToScreen(portal.x * TILE, (portal.y - 1.5) * TILE)
    const z = Math.max(1, v.scale / 3)
    this.compassArrow.scale.set(z * 1.6); this.compassText.scale.set(z)
    const W = v.sw, H = v.sh, m = 70 * z
    const onScreen = p.x > m && p.y > m && p.x < W - m && p.y < H - m
    this.compass.visible = !onScreen && !this.g.switching
    if (!this.compass.visible) return
    const cx = W / 2, cy = H / 2, dx = p.x - cx, dy = p.y - cy
    const k = Math.min((W / 2 - m) / Math.max(1, Math.abs(dx)), (H / 2 - m) / Math.max(1, Math.abs(dy)))
    const ax = cx + dx * k, ay = cy + dy * k
    const ang = Math.atan2(dy, dx)
    this.compassArrow.position.set(Math.round(ax), Math.round(ay))
    this.compassArrow.rotation = ang
    this.compassText.text = `传送石 · ${portal.name}  ${Math.round(dist)} 格`
    // 文字放在箭头内侧，并且不出屏幕
    const tw = this.compassText.width / 2 + 10 * z, th = 20 * z
    this.compassText.position.set(
      Math.round(Math.max(tw, Math.min(W - tw, ax - Math.cos(ang) * 60 * z))),
      Math.round(Math.max(th, Math.min(H - th, ay - Math.sin(ang) * 44 * z))),
    )
  }

  update(dt: number, time: number) {
    const { input, hud, net, audio } = this.g
    const me = this.me
    if (!input.typing()) {
      for (let i = 1; i <= 8; i++) if (input.hit(String(i))) { state.me.selected = i - 1; hud.renderHotbar(); audio.play('select', 0.25) }
      this.zoomCd -= dt
      const zin = input.hit('+', '=') || (input.wheel < 0 && this.zoomCd <= 0)
      const zout = input.hit('-', '_') || (input.wheel > 0 && this.zoomCd <= 0)
      if ((zin || zout) && this.view.zoomBy(zin ? 1 : -1)) { this.snapCamera(); this.zoomCd = 0.12 }
      if (input.hit('i', 'tab')) hud.toggleInventory()
    }
    const ax = input.axis()
    let moving = false
    if (!this.g.switching && (ax.x || ax.y)) {
      const len = Math.hypot(ax.x, ax.y)
      const vx = (ax.x / len) * SPEED * dt, vy = (ax.y / len) * SPEED * dt
      if (vx) this.slide(vx, 0)
      if (vy) this.slide(0, vy)
      me.dir = dirOf(ax)
      moving = true
    }
    me.moving = moving

    const np = this.world.nearestPortal(me.x / TILE, me.y / TILE)
    const atPortal = np.dist < 1.6
    hud.hint(hud.modalOpen() || this.g.switching ? null : atPortal ? `<b>E</b> 传送石（${np.portal.name}）` : null)
    if (atPortal && input.hit('e') && !this.g.switching) this.portalMenu(np.portal)

    if (moving) {
      this.stepT -= dt
      if (this.stepT <= 0) { this.stepT = 0.32; audio.play(this.cave ? 'step_wood' : 'step_grass', 0.16) }
    }

    me.update(dt)
    for (const f of this.others.values()) {
      const k = 1 - Math.exp(-dt * 12)
      f.x += (f.tx - f.x) * k; f.y += (f.ty - f.y) * k
      f.update(dt)
    }
    const wind = Math.sin(time * 0.4) * 0.5 + Math.sin(time * 1.7) * 0.2
    for (const c of this.chunks.values()) for (const s of c.sways) s.update(time, wind)

    // 摄像机 + 区块
    const v = this.view
    const k = 1 - Math.exp(-dt * 6)
    v.camX += (me.x - v.viewW / 2 - v.camX) * k
    v.camY += (me.y - 20 - v.viewH / 2 - v.camY) * k
    this.clampCamera()
    this.stream()

    // 光照：地面按昼夜；洞穴里常年昏暗，只靠自己的灯
    const rain = !this.cave && state.rain ? 1 : 0
    let gain: number
    if (this.cave) {
      v.post.set('uAmbient', [0.3, 0.27, 0.36]); v.post.set('uLightGain', 1.1); v.post.set('uSat', 0.95); v.post.set('uClouds', 0)
      gain = 1
    } else {
      const [r, gg, b, gn, sat] = sky(state.hour)
      const dim = rain ? 0.78 : 1
      v.post.set('uAmbient', [r * dim, gg * dim, b * (rain ? 0.86 : 1)])
      v.post.set('uLightGain', gn + rain * 0.25)
      v.post.set('uSat', sat * (rain ? 0.8 : 1))
      v.post.set('uClouds', rain ? 0.4 : 1)
      gain = gn
    }
    for (const c of this.chunks.values()) for (const l of c.lamps) {
      const fl = 1 - l.flicker * (0.5 + 0.5 * Math.sin(time * 13 + l.x) * Math.sin(time * 7.3 + l.y))
      l.s.alpha = Math.max(l.day, Math.min(1, gain + rain * 0.3)) * fl
    }
    this.myLight.position.set(me.x, me.y - 14)
    this.myLight.scale.set((this.cave ? 110 : 46) / 64)
    this.myLight.alpha = this.cave ? 0.95 : Math.max(0, gain - 0.3) * 0.8
    this.waterFilter.update(v, time, rain)
    this.fx.update(dt, time)

    const hour = state.hour
    audio.playMusic(this.cave ? 'sea' : hour < 10 ? 'morning' : hour < 18 ? 'day' : hour < 22 ? 'evening' : 'none')
    audio.setAmbient(this.cave ? 'underwater' : 'shore', this.cave ? 0.4 : 1)

    this.updateCompass()
    for (const f of [me, ...this.others.values()]) {
      const p = v.worldToScreen(f.x, f.y - 38)
      f.tag.position.set(Math.round(p.x), Math.round(p.y))
    }

    this.sendT -= dt
    const sig = `${Math.round(me.x)},${Math.round(me.y)},${me.dir},${me.moving}`
    if (this.sendT <= 0 && sig !== this.lastSent) {
      this.sendT = 0.1
      this.lastSent = sig
      net.send({ t: 'move', x: me.x, y: me.y, dir: me.dir, moving: me.moving })
    }
    v.render(time)
  }

  resize(w: number, h: number) {
    this.view.resize(w, h)
    this.snapCamera()
    this.stream(true)
  }

  destroy() {
    for (const u of this.unsub) u()
    this.pool.destroy()
    this.fx.clear()
    for (const c of this.chunks.values()) this.unloadChunk(c)
    this.chunks.clear()
    this.g.app.stage.removeChild(this.view.display, this.overlay)
    this.overlay.destroy({ children: true })
    this.view.destroy()
    this.g.hud.hint(null)
  }
}
