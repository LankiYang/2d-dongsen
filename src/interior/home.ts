// 玩家小屋：摆着房主的家具，谁都能进来串门，只有房主能摆、能收、能开箱子。
// 手上拿着家具时，半透明的预览跟着鼠标走（摆不下变红），左键摆放、R 翻转；对着家具按 E 收回背包。
import { Sprite } from 'pixi.js'
import type { Game } from '../game.ts'
import { RoomScene } from './room.ts'
import type { Hint, Lamp } from './room.ts'
import { roomSolids, homeRoom } from '../../shared/rooms.ts'
import type { Rect } from '../../shared/rooms.ts'
import { FURNITURE, canPlace, solidRect, furnKind } from '../../shared/furniture.ts'
import type { HomeItem } from '../../shared/furniture.ts'
import { LOTS, lotDoor } from '../../shared/island.ts'
import { TILE } from '../../shared/data.ts'
import { sky } from '../island/scene.ts'
import { state } from '../state.ts'

interface Placed { it: HomeItem, node: Sprite, shadow?: Sprite, lamp?: Lamp }

export class HomeScene extends RoomScene {
  lot: number
  owner = -1
  ownerName = ''
  placed = new Map<number, Placed>()
  private ghost = new Sprite()
  private ghostKind: string | null = null
  private ghostOk = false
  private flip = false
  private baseSolids: Rect[]
  private cozy: Lamp

  constructor(g: Game, lot: number) {
    super(g, homeRoom(lot, LOTS[lot]?.style ?? 0))
    this.lot = lot
    this.baseSolids = roomSolids(this.room)
    this.ghost.visible = false
    this.ghost.alpha = 0.7
    // 屋子正中一团很淡的暖光，夜里不至于全黑
    this.cozy = this.addLamp(this.W / 2, this.H * 0.55, Math.max(this.W, this.H) * 0.7, 0xffc88a, 0.02)
    this.unsub.push(
      g.net.on('home', m => { if (m.lot === this.lot) this.sync(m.owner, m.ownerName, m.items) }),
      g.net.on('chest', m => g.hud.updateChest(m.slots)),
    )
    const m = state.home
    if (m && m.lot === lot) this.sync(m.owner, m.ownerName, m.items)
  }

  get mine() { return this.owner === state.me.id }

  private sync(owner: number, ownerName: string, items: HomeItem[]) {
    const first = this.owner < 0
    this.owner = owner; this.ownerName = ownerName
    if (first) this.g.hud.showZone(this.mine ? '我的小屋' : `${ownerName} 的小屋`)
    const keep = new Set(items.map(i => i.id))
    for (const [id, p] of this.placed) if (!keep.has(id)) this.remove(id, p)
    for (const it of items) if (!this.placed.has(it.id)) this.add(it)
    this.solids = [...this.baseSolids, ...items.map(i => solidRect(i.k, i.x, i.y)).filter((r): r is Rect => !!r)]
    this.unstick()
  }

  private add(it: HomeItem) {
    const d = FURNITURE[it.k], tex = this.g.assets.furniture[it.k]
    if (!d || !tex) return
    const node = new Sprite(tex)
    node.position.set(it.x, it.y)
    if (it.flip) node.scale.x = -1
    const p: Placed = { it, node }
    if (d.layer === 'wall') { node.zIndex = it.y; this.wallLayer.addChild(node) }
    else if (d.layer === 'rug') this.rugLayer.addChild(node)
    else {
      node.zIndex = it.y
      this.entities.addChild(node)
      p.shadow = this.addShadow(it.x, it.y, d.solid ? d.solid[0] + 8 : tex.width)
    }
    if (d.light) p.lamp = this.addLamp(it.x, it.y + d.light.dy, d.light.r, d.light.color, 0.1)
    this.placed.set(it.id, p)
  }
  private remove(id: number, p: Placed) {
    p.node.destroy(); p.shadow?.destroy()
    if (p.lamp) { p.lamp.s.destroy(); this.lamps = this.lamps.filter(l => l !== p.lamp) }
    this.placed.delete(id)
  }

  protected exitPos() {
    const d = lotDoor(LOTS[this.lot])
    return { x: d.x * TILE, y: (d.y + 0.9) * TILE }
  }

  // 人附近的家具：落地的看底座、挂墙的看左右、地毯看是不是踩在上面
  private nearItem(): HomeItem | null {
    const me = this.me, WALL = this.room.wallRows * TILE
    let best: HomeItem | null = null, bd = Infinity
    for (const { it } of this.placed.values()) {
      const d = FURNITURE[it.k], [w, h] = d.size
      const dx = Math.abs(me.x - it.x)
      let ok = false, score = dx
      if (d.layer === 'wall') ok = dx < w / 2 + 6 && me.y < WALL + 46
      else if (d.layer === 'rug') { ok = dx < w / 2 && me.y > it.y - h && me.y < it.y + 4; score += 40 }
      else {
        const dy = me.y - it.y
        ok = dx < w / 2 + 10 && dy > -8 && dy < 26
        score += Math.abs(dy)
        // 几件家具挨得近时，优先面朝的那件
        const facing = me.dir === 'up' ? it.y <= me.y : me.dir === 'down' ? it.y > me.y : me.dir === 'left' ? it.x < me.x : it.x > me.x
        if (facing) score -= 12
      }
      if (ok && score < bd) { bd = score; best = it }
    }
    return best
  }

  // 触屏按钮
  touchButtons() {
    const b: { label: string, key: string }[] = []
    if (this.mine) b.push({ label: '目录', key: 'c' })
    if (this.ghostKind) b.push({ label: '翻转', key: 'r' })
    return b
  }

  protected interact(): Hint | null {
    const { net, hud, input } = this.g
    if (this.ghostKind) return { text: this.ghostOk ? `<b>左键</b> 摆放${FURNITURE[this.ghostKind].name} · <b>R</b> 翻转` : '这里放不下' }
    const it = this.nearItem()
    if (it) {
      const d = FURNITURE[it.k]
      if (!this.mine) return d.chest ? { text: `${this.ownerName} 的储物箱` } : this.doorHint()
      if (d.chest) return {
        text: `<b>E</b> 打开储物箱 · <b>Shift+E</b> 收起`,
        act: () => {
          if (input.down('shift')) { net.send({ t: 'furnish', op: 'pickup', id: it.id }); return }
          net.send({ t: 'chest', op: 'open' })
          hud.openChest(Array(24).fill(null), i => net.send({ t: 'chest', op: 'take', slot: i }), i => net.send({ t: 'chest', op: 'put', slot: i }))
        },
      }
      return { text: `<b>E</b> 收起${d.name}`, act: () => { net.send({ t: 'furnish', op: 'pickup', id: it.id }); this.g.audio.play('harvest', 0.4) } }
    }
    const door = this.doorHint()
    if (door) return door
    return this.mine ? { text: '<b>C</b> 家具目录' } : null
  }

  protected tick() {
    const { input, net, hud, audio, assets } = this.g
    if (this.mine && !input.typing() && input.hit('c')) hud.openCatalog(kind => net.send({ t: 'buyFurn', kind, n: 1 }))

    // 手上拿着家具：预览跟着鼠标
    const slot = state.me.inv[state.me.selected]
    const kind = this.mine && slot ? furnKind(slot.id) : null
    if (kind !== this.ghostKind) {
      this.ghost.removeFromParent()
      this.ghostKind = kind
      this.ghost.visible = !!kind
      if (kind) {
        this.ghost.texture = assets.furniture[kind]
        const layer = FURNITURE[kind].layer
        ;(layer === 'wall' ? this.wallLayer : layer === 'rug' ? this.rugLayer : this.entities).addChild(this.ghost)
      }
    }
    if (!kind) return
    if (!input.typing() && input.hit('r')) { this.flip = !this.flip; audio.play('click', 0.3) }
    const w = this.view.screenToWorld(input.mouseX, input.mouseY)
    const x = Math.round(w.x / 2) * 2, y = Math.round(w.y / 2) * 2
    const items = [...this.placed.values()].map(p => p.it)
    this.ghostOk = canPlace(this.room, items, kind, x, y)
    this.ghost.position.set(x, y)
    this.ghost.zIndex = y + 0.5
    this.ghost.scale.x = this.flip ? -1 : 1
    this.ghost.tint = this.ghostOk ? 0xffffff : 0xff6a6a
    this.ghost.alpha = this.ghostOk ? 0.75 : 0.55
    if (input.clicked && !hud.modalOpen()) {
      if (this.ghostOk) { net.send({ t: 'furnish', op: 'place', slot: state.me.selected, x, y, flip: this.flip }); audio.play('plant', 0.5) }
      else audio.play('error', 0.3)
    }
  }

  // 白天屋里亮堂，夜里暗下来、靠灯
  protected lighting() {
    const night = sky(state.hour)[3]
    const k = Math.min(1, night)
    this.cozy.base = 0.25 + k * 0.35
    return {
      ambient: [0.96 - 0.46 * k, 0.92 - 0.46 * k, 0.86 - 0.34 * k],
      gain: 0.6 + 0.5 * k,
      sat: 1.04,
    }
  }
  protected music() {
    const h = state.hour
    return h < 10 ? 'morning' : h < 18 ? 'day' : h < 22 ? 'evening' : 'none'
  }
}
