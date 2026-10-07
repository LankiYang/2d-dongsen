// 室内场景基类：烘焙的地板和墙 + 固定摆设 + 暖色灯光 + 走动碰撞 + 其他玩家 + 出门。
// 寿司店（restaurant.ts）和玩家小屋（home.ts）继承它，只写各自的互动。
import { HD } from '../acstyle.ts'
import { Container, Graphics, Sprite, Texture } from 'pixi.js'
import type { Game, Scene } from '../game.ts'
import { PixelView } from '../core/pixelview.ts'
import { Farmer } from '../island/farmer.ts'
import { Particles } from '../fx/particles.ts'
import { bakeRoom } from './bake.ts'
import { roomSolids, roomFree } from '../../shared/rooms.ts'
import type { Room, Rect } from '../../shared/rooms.ts'
import { TILE } from '../../shared/data.ts'
import type { PlayerPublic, SceneId } from '../../shared/protocol.ts'
import { state } from '../state.ts'
import { dirOf } from '../core/input.ts'

const SPEED = 80
const MARGIN = 40            // 房间外留一圈深色边，缩小视野时不至于露出大片空白

// 地板墙面烘焙一次，来回进出复用
const bakes = new Map<string, Texture>()

export interface Lamp { s: Sprite, x: number, y: number, flicker: number, base?: number }   // base：基础亮度（默认 1）
export interface Hint { text: string, act?: () => void }

export abstract class RoomScene implements Scene {
  view: PixelView
  overlay = new Container()
  wallLayer = new Container()
  rugLayer = new Container()
  shadowLayer = new Container()
  entities = new Container()
  bubbles = new Container()
  fx = new Particles()
  me: Farmer
  others = new Map<number, Farmer>()
  lamps: Lamp[] = []
  solids: Rect[]
  floor: Sprite
  sceneId: SceneId
  protected W: number
  protected H: number
  protected unsub: (() => void)[] = []
  private sendT = 0
  private lastSent = ''
  private stepT = 0
  private zoomCd = 0
  protected leaving = false
  protected clickActs = false       // 寿司店里点鼠标也算互动（上菜）；小屋里鼠标用来摆家具

  constructor(protected g: Game, protected room: Room) {
    const { assets } = g
    this.sceneId = room.id as SceneId
    this.W = room.w * TILE; this.H = room.h * TILE
    this.view = new PixelView(g.app.renderer as any, 280, room.id.startsWith('home:') ? 'home' : room.id, HD)
    // 缩放下限只按房间高度算：宽屏上两边露出暗边没关系，但整间屋子要能竖着装下
    this.view.mapW = Math.max(this.W, this.H * 3) + MARGIN * 2; this.view.mapH = this.H + MARGIN * 2
    this.solids = roomSolids(room)
    const W = this.view.world

    const bg = new Graphics().rect(-600, -600, this.W + 1200, this.H + 1200).fill(0x140b06)
    const bakeKey = `${room.id}|${room.wall}|${room.floor}|${room.w}x${room.h}`
    if (!bakes.has(bakeKey)) bakes.set(bakeKey, bakeRoom(room))
    this.floor = new Sprite(bakes.get(bakeKey)!)
    this.entities.sortableChildren = true
    this.wallLayer.sortableChildren = true
    W.addChild(bg, this.floor, this.wallLayer, this.rugLayer, this.shadowLayer, this.entities, this.fx.layer, this.bubbles)

    for (const o of room.objects) {
      const tex = assets.interior[o.kind] ?? assets.decor[o.kind]
      if (!tex) continue
      const s = new Sprite(tex)
      s.position.set(o.x, o.y)
      if (o.wall) { s.zIndex = o.y; this.wallLayer.addChild(s) }
      else {
        s.zIndex = o.z ?? o.y
        this.entities.addChild(s)
        if (o.solid) this.addShadow(o.x, o.y, tex.width)
      }
      if (o.light) this.addLamp(o.x, o.y + o.light.dy, o.light.r, o.light.color, o.kind === 'fish_tank' ? 0.08 : 0.12)
    }

    this.me = new Farmer(assets, state.me.hue, state.me.name, true)
    this.me.x = this.me.tx = room.spawn.x
    this.me.y = this.me.ty = room.spawn.y
    this.me.dir = 'up'
    this.entities.addChild(this.me.root)
    this.overlay.addChild(this.me.tag)

    g.app.stage.addChild(this.view.display, this.overlay)
    this.unsub.push(
      g.net.on('players', m => this.syncPlayers(m.list)),
      g.net.on('left', m => this.removeOther(m.id)),
    )
    this.view.post.set('uMode', 0)
    this.view.post.set('uClouds', 0)
    g.hud.setSeaMode(false)
    this.snapCamera()
  }

  protected addLamp(x: number, y: number, r: number, color: number, flicker: number) {
    const s = new Sprite(this.g.assets.light)
    s.anchor.set(0.5)
    s.tint = color
    s.blendMode = 'add'
    s.position.set(x, y)
    s.scale.set(r / 64)
    this.view.lights.addChild(s)
    const l = { s, x, y, flicker }
    this.lamps.push(l)
    return l
  }
  protected addShadow(x: number, y: number, w: number) {
    const sh = new Sprite(this.g.assets.shadow(Math.min(70, w * 0.85)))
    sh.position.set(x, y - 1)
    this.shadowLayer.addChild(sh)
    return sh
  }

  // ── 其他玩家 ──
  protected decorate(_f: Farmer, _p: PlayerPublic) {}
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
      this.decorate(f, p)
    }
    for (const id of [...this.others.keys()]) if (!seen.has(id)) this.removeOther(id)
  }
  private removeOther(id: number) {
    this.others.get(id)?.destroy()
    this.others.delete(id)
  }

  // ── 移动 ──
  protected free(x: number, y: number) { return roomFree(this.solids, x, y) }
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
  // 摆了家具把人压住时，就近挪到空地
  protected unstick() {
    const me = this.me
    if (this.free(me.x, me.y)) return
    for (let r = 2; r <= 120; r += 2) for (let a = 0; a < 16; a++) {
      const x = me.x + Math.cos((a / 16) * Math.PI * 2) * r, y = me.y + Math.sin((a / 16) * Math.PI * 2) * r
      if (this.free(x, y)) { me.x = x; me.y = y; return }
    }
  }

  protected snapCamera() {
    this.view.camX = this.me.x - this.view.viewW / 2
    this.view.camY = this.me.y - 20 - this.view.viewH / 2
    this.clampCamera()
  }
  // 视野装得下整个房间就居中，否则跟着人走、不露出房间外面
  private clampCamera() {
    const v = this.view
    const fit = (cam: number, view: number, size: number) =>
      view >= size ? (size - view) / 2 : Math.max(0, Math.min(size - view, cam))
    v.camX = fit(v.camX, v.viewW, this.W)
    v.camY = fit(v.camY, v.viewH, this.H)
  }

  // ── 子类实现 ──
  protected abstract exitPos(): { x: number, y: number }       // 出门后在岛上的位置（像素）
  protected abstract interact(): Hint | null                    // 当前能做的互动（null = 只看门口）
  protected tick(_dt: number, _time: number) {}                 // 每帧的额外逻辑
  protected lighting(): { ambient: number[], gain: number, sat: number } { return { ambient: [0.8, 0.72, 0.66], gain: 0.85, sat: 1.06 } }
  protected music(): 'evening' | 'morning' | 'day' | 'none' { return 'evening' }
  protected tagOffset(f: Farmer) { return f.held.visible ? 58 : 38 }
  protected cleanup() {}

  protected exit() {
    if (this.leaving) return
    this.leaving = true
    this.g.net.send({ t: 'scene', to: 'island' })
    this.g.meStart = this.exitPos()
    this.g.switchTo('island')
  }
  protected doorHint(): Hint | null {
    const me = this.me
    if (me.y > this.H - 40 && Math.abs(me.x - this.room.door.x) < 30) return { text: '<b>E</b> 出门（或者继续往下走）', act: () => this.exit() }
    return null
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
    if (!this.g.switching && !this.leaving && (ax.x || ax.y)) {
      const len = Math.hypot(ax.x, ax.y)
      const vx = (ax.x / len) * SPEED * dt, vy = (ax.y / len) * SPEED * dt
      if (vx) this.slide(vx, 0)
      if (vy) this.slide(0, vy)
      me.dir = dirOf(ax)
      moving = true
    }
    me.moving = moving
    if (me.y > this.H - 3) this.exit()

    this.tick(dt, time)

    const near = this.leaving ? null : this.interact()
    hud.hint(hud.modalOpen() ? null : near?.text ?? null)
    if (near?.act && (input.hit('e') || (this.clickActs && input.clicked))) near.act()

    if (moving) {
      this.stepT -= dt
      if (this.stepT <= 0) { this.stepT = 0.32; audio.play('step_wood', 0.14) }
    }

    me.update(dt)
    for (const f of this.others.values()) {
      const k = 1 - Math.exp(-dt * 12)
      f.x += (f.tx - f.x) * k; f.y += (f.ty - f.y) * k
      f.update(dt)
    }
    this.fx.update(dt, time)

    const v = this.view
    const k = 1 - Math.exp(-dt * 6)
    v.camX += (me.x - v.viewW / 2 - v.camX) * k
    v.camY += (me.y - 20 - v.viewH / 2 - v.camY) * k
    this.clampCamera()

    const L = this.lighting()
    v.post.set('uAmbient', L.ambient)
    v.post.set('uLightGain', L.gain)
    v.post.set('uSat', L.sat)
    for (const l of this.lamps) l.s.alpha = (l.base ?? 1) * (1 - l.flicker * (0.5 + 0.5 * Math.sin(time * 11 + l.x) * Math.sin(time * 6.1 + l.y)))
    audio.playMusic(this.music())
    audio.setAmbient('shore', 0.25)

    for (const f of [me, ...this.others.values()]) {
      const p = v.worldToScreen(f.x, f.y - this.tagOffset(f))
      f.tag.position.set(Math.round(p.x), Math.round(p.y))
    }

    this.sendT -= dt
    const sig = `${Math.round(me.x)},${Math.round(me.y)},${me.dir},${me.moving}`
    if (!this.leaving && this.sendT <= 0 && sig !== this.lastSent) {
      this.sendT = 0.1
      this.lastSent = sig
      net.send({ t: 'move', x: me.x, y: me.y, dir: me.dir, moving: me.moving })
    }
    v.render(time)
  }

  resize(w: number, h: number) {
    this.view.resize(w, h)
    this.snapCamera()
  }

  destroy() {
    for (const u of this.unsub) u()
    this.cleanup()
    this.fx.clear()
    this.g.app.stage.removeChild(this.view.display, this.overlay)
    this.overlay.destroy({ children: true })
    this.floor.texture = Texture.EMPTY
    this.view.destroy()
    this.g.hud.hint(null)
    this.g.hud.closeModals()
  }
}
