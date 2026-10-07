// 潮汐寿司：顾客由服务端下发状态，走位在客户端插值；做菜、上菜、倒掉都交给服务端校验。
import { Text } from 'pixi.js'
import type { Game } from '../game.ts'
import type { Farmer } from '../island/farmer.ts'
import { RoomScene } from './room.ts'
import type { Hint } from './room.ts'
import { Guest } from './guest.ts'
import { stationAt, canServe, RESTAURANT } from '../../shared/rooms.ts'
import { TILE, DISHES, RESTAURANT_OPEN, RESTAURANT_CLOSE } from '../../shared/data.ts'
import type { DishId } from '../../shared/data.ts'
import { PLACES } from '../../shared/island.ts'
import type { Customer, PlayerPublic } from '../../shared/protocol.ts'
import { state } from '../state.ts'

interface Floater { t: Text, x: number, y: number, age: number }

export class RestaurantScene extends RoomScene {
  guests = new Map<number, Guest>()
  floaters: Floater[] = []
  open = false
  left = 1   // 今天还会来几位客人（每天有上限，见 RESTAURANT_GUESTS_PER_DAY）
  private fxT = 0
  private heldDish: DishId | null = null

  constructor(g: Game) {
    super(g, RESTAURANT)
    this.clickActs = true
    // 吧台上方一排吊灯投下的暖光（灯本身不画，只留光斑）
    for (const x of [96, 216, 336]) this.addLamp(x, 128, 96, 0xffc987, 0.04)
    this.addLamp(216, 250, 110, 0xffb36b, 0.05)
    this.unsub.push(
      g.net.on('restaurant', m => { this.left = m.left; this.syncGuests(m.open, m.customers) }),
      g.net.on('served', m => this.onServed(m.customer, m.coins, m.tip)),
    )
    g.hud.showZone(RESTAURANT.name)
  }

  protected exitPos() { return { x: PLACES.restaurant.x * TILE, y: (PLACES.restaurant.y + 0.9) * TILE } }

  protected decorate(f: Farmer, p: PlayerPublic) {
    f.setHold(p.hold ? this.g.assets.icons[DISHES[p.hold].icon] ?? null : null)
  }

  // ── 顾客 ──
  private syncGuests(open: boolean, list: Customer[]) {
    const wasOpen = this.open
    this.open = open
    if (open !== wasOpen && this.guests.size + list.length > 0 && !open) this.g.hud.toast('打烊了，客人们陆续离开')
    const seen = new Set<number>()
    for (const c of list) {
      seen.add(c.id)
      const had = this.guests.get(c.id)
      if (had) {
        if (had.c.state === 'wait' && c.state === 'leave' && c.angry) this.angry(had)
        had.sync(c)
        continue
      }
      const gst = new Guest(c, this.g.assets, this.room)
      this.guests.set(c.id, gst)
      this.entities.addChild(gst.root, gst.plate)
      this.bubbles.addChild(gst.bubble)
      if (c.state === 'arrive' && c.age < 1500) this.g.audio.play('open', 0.25, 1.3)
    }
    for (const [id, gst] of this.guests) if (!seen.has(id)) { gst.destroy(); this.guests.delete(id) }
  }

  // 等太久的客人气呼呼地走了：头顶冒几缕红色的气
  private angry(gst: Guest) {
    this.g.hud.toast(`客人等不及走了（${DISHES[gst.c.dish].name}）`)
    this.g.audio.play('error', 0.35)
    for (let i = 0; i < 8; i++) this.fx.spawn({ x: gst.x + (Math.random() - 0.5) * 12, y: gst.y - 36, vx: (Math.random() - 0.5) * 30, vy: -30 - Math.random() * 20, life: 0.7, color: i % 2 ? 0xe0503a : 0xff8a6a, w: 2, h: 2 })
  }

  private onServed(id: number, coins: number, tip: number) {
    const gst = this.guests.get(id)
    if (!gst) return
    this.g.audio.play('coin', 0.5, 1.1)
    const t = new Text({
      text: tip ? `+${coins}（小费 ${tip}）` : `+${coins}`,
      style: { fontFamily: 'FusionPixel', fontSize: 24, fill: 0xffd35a, stroke: { color: 0x3a2314, width: 4 } },
      resolution: 1,
    })
    t.anchor.set(0.5, 1)
    this.overlay.addChild(t)
    this.floaters.push({ t, x: gst.x, y: gst.y - 40, age: 0 })
    for (let i = 0; i < 12; i++) this.fx.spawn({ x: gst.x + (Math.random() - 0.5) * 16, y: gst.y - 30, vx: (Math.random() - 0.5) * 50, vy: -40 - Math.random() * 40, ay: 120, life: 0.7, color: [0xffd35a, 0xffffff, 0xffb13a][i % 3] })
  }

  private orders() {
    const m = new Map<DishId, number>()
    for (const gst of this.guests.values()) if (gst.c.state === 'wait' || gst.c.state === 'arrive') m.set(gst.c.dish, (m.get(gst.c.dish) ?? 0) + 1)
    return m
  }

  protected interact(): Hint | null {
    const me = this.me, { hud, net, audio } = this.g
    // 端着菜：找能够得着的等菜客人
    if (state.holding) {
      let best: Guest | null = null, bd = Infinity
      for (const gst of this.guests.values()) {
        if (!gst.waiting) continue
        const seat = this.room.seats![gst.c.seat]
        if (!canServe(me.x, me.y, seat)) continue
        const d = Math.abs(me.x - seat.x) + (gst.c.dish === state.holding.dish ? 0 : 100)
        if (d < bd) { bd = d; best = gst }
      }
      if (best) {
        const want = DISHES[best.c.dish].name
        if (best.c.dish !== state.holding.dish) return { text: `这位客人点的是 <b>${want}</b>` }
        const id = best.c.id
        return { text: `<b>E</b> 上菜：${want}`, act: () => { net.send({ t: 'serve', customer: id }); this.me.act('') } }
      }
    }
    const st = stationAt(this.room, me.x, me.y)
    if (st) {
      const label = st.station === 'fryer' ? '油锅' : '砧板'
      if (state.holding) return { text: `${label}：手上已经端着菜了，先上菜或按 <b>Q</b> 倒掉` }
      return {
        text: `<b>E</b> 用${label}做菜`,
        act: () => hud.openCooking(st.station!, this.orders(), (dish, quality) => {
          net.send({ t: 'cook', dish, quality })
          audio.play('harvest', 0.45)
        }),
      }
    }
    const door = this.doorHint()
    if (door) return door
    if (!this.open && !this.guests.size) return { text: `现在不营业，每天 ${RESTAURANT_OPEN}:00–${RESTAURANT_CLOSE}:00 营业` }
    if (this.open && !this.left && !this.guests.size) return { text: `今天的客人都来过了，明天 ${RESTAURANT_OPEN}:00 再开张` }
    return null
  }

  // 触屏按钮：手上端着菜时可以丢掉
  touchButtons() { return state.holding ? [{ label: '丢掉', key: 'q' }] : [] }

  protected tick(dt: number, time: number) {
    const { input, net, audio, assets } = this.g
    const me = this.me
    if (!input.typing() && input.hit('q') && state.holding) { net.send({ t: 'discard' }); audio.play('splash', 0.3, 1.4) }

    // 手上的菜
    const hold = state.holding?.dish ?? null
    if (hold !== this.heldDish) {
      if (hold && !this.heldDish) for (let i = 0; i < 10; i++) this.fx.spawn({ x: me.x + (Math.random() - 0.5) * 14, y: me.y - 44, vx: (Math.random() - 0.5) * 40, vy: -30 - Math.random() * 30, ay: 80, life: 0.6, color: [0xfff0a0, 0xffffff][i % 2] })
      this.heldDish = hold
      me.setHold(hold ? assets.icons[DISHES[hold].icon] ?? null : null)
    }
    for (const gst of this.guests.values()) gst.update(dt, time)

    // 电饭锅冒热气、油锅冒泡、鱼缸里的气泡
    this.fxT -= dt
    if (this.fxT <= 0) {
      this.fxT = 0.12
      if (Math.random() < 0.6) this.fx.spawn({ x: 198 + (Math.random() - 0.5) * 6, y: 56, vx: (Math.random() - 0.5) * 6, vy: -14, life: 1.4, color: 0xffffff, alpha: 0.5, w: 2, h: 2, wobble: 8 })
      if (Math.random() < 0.5) this.fx.spawn({ x: 306 + (Math.random() - 0.5) * 14, y: 64, vx: 0, vy: -10, life: 0.9, color: 0xfff2d0, alpha: 0.45, w: 2, h: 1, wobble: 6 })
      if (Math.random() < 0.35) this.fx.spawn({ x: 364 + Math.random() * 18, y: 80, vx: 0, vy: -12, life: 1.2, color: 0xcff4ff, alpha: 0.8, w: 1, h: 1, wobble: 4 })
    }

    // 飘字
    const v = this.view
    for (let i = this.floaters.length - 1; i >= 0; i--) {
      const fl = this.floaters[i]
      fl.age += dt
      const p = v.worldToScreen(fl.x, fl.y - fl.age * 16)
      fl.t.position.set(Math.round(p.x), Math.round(p.y))
      fl.t.alpha = Math.min(1, (1.6 - fl.age) * 2)
      if (fl.age > 1.6) { fl.t.destroy(); this.floaters.splice(i, 1) }
    }
  }

  protected cleanup() { for (const gst of this.guests.values()) gst.destroy() }
}
