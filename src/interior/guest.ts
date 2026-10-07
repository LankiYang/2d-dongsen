// 餐厅顾客：服务端只给状态和时长，这里按「门口 → 过道 → 座位」的折线插值出走位，
// 坐下时站位抬高、藏到凳子后面；头顶气泡显示点的菜和耐心条
import { snap } from '../acstyle.ts'
import { Container, Graphics, Sprite } from 'pixi.js'
import type { Texture } from 'pixi.js'
import type { GameAssets } from '../core/assets.ts'
import type { Customer } from '../../shared/protocol.ts'
import type { Room } from '../../shared/rooms.ts'
import { DISHES } from '../../shared/data.ts'

interface Frames { down: Texture[], up: Texture[], side: Texture[], sideFacesRight: boolean }

export function lookFrames(look: string, a: GameAssets): Frames {
  const pick = (atlas: Record<string, Texture>, names: string[]) => names.map(n => atlas[n]).filter(Boolean)
  if (look.startsWith('npc:')) {
    const id = look.slice(4)
    const seq = (dir: string) => pick(a.npcs, [0, 1, 2, 3].map(i => `${id}_${dir}_${i}`))
    return { down: seq('down'), up: seq('up'), side: seq('side'), sideFacesRight: true }
  }
  if (look.startsWith('farmer:')) {
    const f = a.farmers.get(Number(look.slice(7))) ?? a.chars
    const seq = (dir: string) => pick(f, [0, 1, 2, 3].map(i => `walk_${dir}_${i}`))
    return { down: seq('down'), up: seq('up'), side: seq('side'), sideFacesRight: true }
  }
  // 普通客人（小孩、老奶奶、水手）的侧面帧是面朝左画的，村民和农夫的是面朝右
  const g = (s: string) => pick(a.npcs, [`${look}_${s}`, `${look}_${s}2`])
  return { down: g('down'), up: g('up'), side: g('side'), sideFacesRight: false }
}

const ARRIVE_MS = 5200, LEAVE_MS = 5200

export class Guest {
  root = new Container()
  body = new Sprite()
  bubble = new Container()
  plate = new Sprite()     // 上菜后摆在吧台上的那盘菜（由场景放进景深排序层）
  private bar = new Graphics()
  private icon = new Sprite()
  private frames: Frames
  private age: number
  x = 0; y = 0
  eatBob = 0

  constructor(public c: Customer, assets: GameAssets, private room: Room) {
    this.frames = lookFrames(c.look, assets)
    this.age = c.age
    this.body.anchor.set(0.5, 1)
    const shadow = new Sprite(assets.shadow(16)); shadow.anchor.set(0.5); shadow.y = -1
    this.root.addChild(shadow, this.body)
    // 气泡：白底圆角框 + 菜的图标 + 耐心条
    const bg = new Graphics()
    bg.rect(-15, -26, 30, 24).fill(0xfff8e4).rect(-16, -25, 32, 22).fill(0xfff8e4)
    bg.rect(-15, -27, 30, 1).fill(0x6b4428).rect(-15, -2, 30, 1).fill(0x6b4428).rect(-17, -25, 1, 22).fill(0x6b4428).rect(16, -25, 1, 22).fill(0x6b4428)
    bg.rect(-2, -2, 4, 2).fill(0xfff8e4).rect(-1, 0, 2, 2).fill(0xfff8e4)
    this.icon.texture = assets.icons[DISHES[c.dish].icon] ?? assets.icons.sushi
    this.icon.anchor.set(0.5)
    this.icon.position.set(0, -15)
    const s = Math.min(1, 22 / Math.max(this.icon.texture.width, this.icon.texture.height * 1.1))
    this.icon.scale.set(s)
    this.bubble.addChild(bg, this.icon, this.bar)
    const seat = room.seats![c.seat]
    this.plate.texture = this.icon.texture
    this.plate.anchor.set(0.5, 1)
    this.plate.scale.set(Math.min(1, 18 / this.icon.texture.width))
    this.plate.position.set(seat.x, seat.y - 47)
    this.plate.zIndex = seat.y - 25
    this.plate.visible = false
  }

  sync(c: Customer) { this.c = c; this.age = c.age }

  private seatPos() {
    const s = this.room.seats![this.c.seat]
    return { x: s.x, y: s.y - 12 }
  }
  // 门口 → 过道 → 座位的折线
  private path() {
    const s = this.room.seats![this.c.seat], aisle = 214
    return [
      { x: this.room.door.x, y: this.room.h * 24 + 12 },
      { x: this.room.door.x, y: aisle },
      { x: s.x, y: aisle },
      { x: s.x, y: s.y - 12 },
    ]
  }
  private along(pts: { x: number, y: number }[], t: number) {
    const segs = pts.slice(1).map((p, i) => Math.hypot(p.x - pts[i].x, p.y - pts[i].y))
    let d = Math.max(0, Math.min(1, t)) * segs.reduce((a, b) => a + b, 0)
    for (let i = 0; i < segs.length; i++) {
      if (d <= segs[i] || i === segs.length - 1) {
        const k = segs[i] ? Math.min(1, d / segs[i]) : 1
        const a = pts[i], b = pts[i + 1]
        return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k, dx: b.x - a.x, dy: b.y - a.y }
      }
      d -= segs[i]
    }
    return { ...pts[pts.length - 1], dx: 0, dy: 0 }
  }

  update(dt: number, time: number) {
    this.age += dt * 1000
    const { state } = this.c
    let dir: 'down' | 'up' | 'side' = 'up', moving = false, flip = false
    if (state === 'arrive' || state === 'leave') {
      const pts = state === 'arrive' ? this.path() : this.path().reverse()
      const p = this.along(pts, this.age / (state === 'arrive' ? ARRIVE_MS : LEAVE_MS))
      this.x = p.x; this.y = p.y; moving = true
      if (Math.abs(p.dx) > Math.abs(p.dy)) { dir = 'side'; flip = p.dx < 0 === this.frames.sideFacesRight }
      else dir = p.dy < 0 ? 'up' : 'down'
    } else {
      const p = this.seatPos(); this.x = p.x; this.y = p.y
    }
    const list = this.frames[dir].length ? this.frames[dir] : this.frames.down
    const f = moving ? Math.floor(time * 7) % list.length : 0
    this.body.texture = list[f]
    this.body.scale.x = flip ? -1 : 1
    // 单帧的角色走路时用 1 像素上下颠来假装迈步；吃饭时每半秒低一下头
    const bob = moving && list.length === 1 ? (Math.floor(time * 7) % 2) : state === 'eat' ? (Math.floor(time * 2.2) % 2) : 0
    this.body.y = -bob
    this.root.position.set(snap(this.x), snap(this.y))
    // 坐着的时候画在凳子后面，凳子挡住腿
    this.root.zIndex = state === 'wait' || state === 'eat' ? this.room.seats![this.c.seat].y - 1 : this.y

    this.plate.visible = state === 'eat'
    // 气泡：只在等菜时显示；耐心条从绿变红
    this.bubble.visible = state === 'wait'
    if (this.bubble.visible) {
      const left = Math.max(0, 1 - this.age / this.c.patience)
      const col = left > 0.5 ? 0x6ccf5a : left > 0.25 ? 0xf2c14e : 0xe0503a
      this.bar.clear().rect(-12, -6, 24, 2).fill(0x5a4030).rect(-12, -6, Math.max(1, Math.round(24 * left)), 2).fill(col)
      this.bubble.position.set(snap(this.x), snap(this.y - this.body.height - 2 + (left < 0.25 ? Math.round(Math.sin(time * 12)) : 0)))
    }
  }

  get waiting() { return this.c.state === 'wait' }
  destroy() { this.root.destroy({ children: true }); this.bubble.destroy({ children: true }); this.plate.destroy() }
}
