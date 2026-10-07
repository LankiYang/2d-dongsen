// 博物馆里面（museum:<岛号>）：左边鱼厅（水族箱）、中间化石厅（展台）、右边虫厅（标本柜），前厅是龟教授的前台。
// 捐过的东西按图鉴顺序摆进展柜：水族箱里的鱼会游，标本柜里的虫停在枝叶上，化石摆在展台上。没捐的位置空着。
import { Container, Graphics, Sprite, Texture } from 'pixi.js'
import type { Game } from '../game.ts'
import { RoomScene } from '../interior/room.ts'
import type { Hint, Lamp } from '../interior/room.ts'
import type { Room, Rect } from '../../shared/rooms.ts'
import type { SceneId } from '../../shared/protocol.ts'
import { TILE, ITEMS } from '../../shared/data.ts'
import { MUSEUM_ROOM, MUSEUM_DESK } from '../../shared/isle/rules.ts'
import { FISHES, BUGS } from '../../shared/critters.ts'
import { FOSSILS } from '../../shared/fossils.ts'
import { CURATOR } from '../../shared/villagers.ts'
import { Actor } from './actor.ts'
import { talkCurator } from './curator.ts'
import { state } from '../state.ts'

const W = MUSEUM_ROOM.w * TILE, H = MUSEUM_ROOM.h * TILE
const museumRoom = (id: number): Room => ({
  id: `museum:${id}`, name: '博物馆', w: MUSEUM_ROOM.w, h: MUSEUM_ROOM.h, wallRows: 3, floor: 'light', wall: 'plaster',
  door: { x: W / 2, y: H }, spawn: { x: W / 2, y: H - 20 }, objects: [],
})

// 展柜：类型、位置（底边中间，像素）、装哪几件
type Case = { kind: 'tank' | 'bugs' | 'fossils', x: number, y: number, items: string[], spr: Sprite[] }
const TANK_SLOTS: [number, number][] = [[-11, -27], [9, -31], [-6, -18], [11, -19]]
const BUG_SLOTS: [number, number][] = [[-8, -25], [8, -20], [0, -33]]
const FOSSIL_SLOTS: [number, number][] = [[-6, -21], [6, -22]]

export class MuseumScene extends RoomScene {
  private cases: Case[] = []
  private curator: Actor
  private exhibits = new Container()

  constructor(g: Game, private isleId: number) {
    super(g, museumRoom(isleId))
    const { island } = g.assets
    this.floor.visible = false
    this.view.world.addChildAt(this.hall(), 2)

    // 展柜：鱼 22 种 → 6 个水族箱，虫 18 种 → 6 个标本柜，化石 16 件 → 8 个展台
    const chunk = (ids: string[], n: number) => Array.from({ length: Math.ceil(ids.length / n) }, (_, i) => ids.slice(i * n, i * n + n))
    const fish = chunk(FISHES.map(f => `fsh_${f.id}`), 4), bugs = chunk(BUGS.map(b => `bug_${b.id}`), 3), fos = chunk(FOSSILS.map(f => `fos_${f.id}`), 2)
    fish.forEach((items, i) => this.cases.push({ kind: 'tank', x: 66 + (i % 3) * 66, y: i < 3 ? 132 : 214, items, spr: [] }))
    bugs.forEach((items, i) => this.cases.push({ kind: 'bugs', x: W - 66 - (2 - (i % 3)) * 66, y: i < 3 ? 132 : 214, items, spr: [] }))
    fos.forEach((items, i) => this.cases.push({ kind: 'fossils', x: 270 + (i % 4) * 28, y: i < 4 ? 128 : 196, items, spr: [] }))
    for (const c of this.cases) {
      const s = new Sprite(island[c.kind === 'tank' ? 'm_aquarium' : c.kind === 'bugs' ? 'm_terrarium' : 'm_pedestal'] ?? Texture.EMPTY)
      s.position.set(c.x, c.y); s.zIndex = c.y
      this.entities.addChild(s)
      this.addShadow(c.x, c.y, s.width)
      const half = s.width / 2 - 2
      this.solids.push([c.x - half, c.y - 14, c.x + half, c.y] as Rect)
    }
    this.exhibits.sortableChildren = true
    this.exhibits.zIndex = 1e5
    // 展品画在展柜上面（不参与前后排序：人走到展柜后面时也看得见展品，这样更清楚）
    this.entities.addChild(this.exhibits)

    // 前厅：前台、龟教授、盆栽、长椅、展厅门口的牌子
    const put = (kind: string, x: number, y: number, solid = true) => {
      const s = new Sprite(island[kind] ?? Texture.EMPTY)
      s.position.set(x, y); s.zIndex = y
      this.entities.addChild(s)
      if (solid) { this.addShadow(x, y, s.width); this.solids.push([x - s.width / 2 + 2, y - 10, x + s.width / 2 - 2, y] as Rect) }
      return s
    }
    put('m_desk', MUSEUM_DESK.x, MUSEUM_DESK.y)
    this.curator = new Actor(g.assets, { villager: CURATOR.id })
    this.curator.name = CURATOR.name
    this.curator.place(MUSEUM_DESK.x, MUSEUM_DESK.y - 14)
    this.entities.addChild(this.curator.root)
    for (const [x, y] of [[40, 110], [W - 40, 110], [40, H - 40], [W - 40, H - 40]]) put('m_fern', x, y)
    put('m_bench', W - 150, H - 70); put('m_bench', W - 210, H - 70)
    // 展厅门口的牌子：上面钉一个图标
    for (const [x, icon] of [[132, 'fsh_sea_bass'], [W / 2, 'fos_ammonite'], [W - 132, 'bug_common_butterfly']] as const) {
      put('m_placard', x, 262, false)
      const ic = new Sprite(g.assets.icons_hd[icon] ?? Texture.EMPTY)
      ic.anchor.set(0.5); ic.scale.set(12 / Math.max(ic.texture.width, ic.texture.height, 1))
      ic.position.set(x, 262 - 19); ic.zIndex = 263
      this.entities.addChild(ic)
    }
    // 展厅里几盏柔和的顶灯
    for (const [x, y] of [[128, 170], [W / 2, 160], [W - 128, 170]]) (this.addLamp(x, y, 120, 0xfff4e0, 0) as Lamp).base = 0.5
    this.refresh()
    this.unsub.push(g.net.on('isle', m => { state.isle = m.isle; this.refresh() }))
    g.hud.showZone(`${state.isle?.name ? state.isle.name + '岛' : ''}博物馆`)
  }

  // 地面和墙：前厅米色石砖，三个展厅各铺一块地毯，后墙上挂三条横幅
  private hall() {
    const gfx = new Graphics()
    gfx.rect(0, 0, W, H).fill(0xefe5cf)
    for (let y = 72; y < H; y += TILE) for (let x = 0; x < W; x += TILE) if (((x + y) / TILE) % 2) gfx.rect(x, y, TILE, TILE).fill({ color: 0xe4d8bd, alpha: 0.8 })
    gfx.roundRect(28, 92, 200, 150, 10).fill({ color: 0xa9d3e6, alpha: 0.55 })          // 鱼厅：浅蓝
    gfx.roundRect(W / 2 - 66, 92, 132, 140, 10).fill({ color: 0xe6cfa0, alpha: 0.6 })   // 化石厅：沙色
    gfx.roundRect(W - 228, 92, 200, 150, 10).fill({ color: 0xbfe0a8, alpha: 0.55 })     // 虫厅：浅绿
    // 后墙
    gfx.rect(0, 0, W, 72).fill(0xf7eedc)
    gfx.rect(0, 58, W, 14).fill(0xc9a77c)
    gfx.rect(0, 56, W, 3).fill(0xe2c79c)
    for (const [x, c] of [[128, 0x6fb6d6], [W / 2, 0xd7a865], [W - 128, 0x86c46a]] as const) {
      gfx.roundRect(x - 56, 10, 112, 34, 6).fill(c)
      gfx.roundRect(x - 52, 14, 104, 26, 4).stroke({ color: 0xffffff, alpha: 0.6, width: 1.5 })
    }
    // 左右墙、门口的地垫
    gfx.rect(0, 0, TILE * 0.6, H).fill(0xd9c3a0); gfx.rect(W - TILE * 0.6, 0, TILE * 0.6, H).fill(0xd9c3a0)
    gfx.roundRect(W / 2 - 30, H - 26, 60, 22, 4).fill(0xb85c4a)
    // 横幅上的图标
    const c = new Container()
    c.addChild(gfx)
    for (const [x, icon] of [[128, 'fsh_red_snapper'], [W / 2, 'fos_trex_skull'], [W - 128, 'bug_monarch_butterfly']] as const) {
      const ic = new Sprite(this.g.assets.icons_hd[icon] ?? Texture.EMPTY)
      ic.anchor.set(0.5); ic.scale.set(22 / Math.max(ic.texture.width, ic.texture.height, 1))
      ic.position.set(x, 28)
      c.addChild(ic)
    }
    return c
  }

  // 按岛上的捐赠记录摆展品
  private refresh() {
    const donated = new Set(state.isle?.museum.donated ?? [])
    for (const c of this.cases) {
      for (const s of c.spr) s.destroy()
      c.spr = []
      const slots = c.kind === 'tank' ? TANK_SLOTS : c.kind === 'bugs' ? BUG_SLOTS : FOSSIL_SLOTS
      const size = c.kind === 'tank' ? 14 : c.kind === 'bugs' ? 12 : 14
      c.items.forEach((id, i) => {
        if (!donated.has(id)) return
        const tex = this.g.assets.icons_hd[ITEMS[id]?.icon ?? ''] ?? Texture.EMPTY
        const s = new Sprite(tex)
        s.anchor.set(0.5)
        s.scale.set(size / Math.max(tex.width, tex.height, 1))
        s.position.set(c.x + slots[i][0], c.y + slots[i][1])
        s.zIndex = c.y
        this.exhibits.addChild(s)
        c.spr.push(s)
      })
    }
  }

  protected tick(dt: number, time: number) {
    // 水族箱里的鱼慢慢游，标本柜里的蝴蝶偶尔扇扇翅膀
    for (const c of this.cases) c.spr.forEach((s, i) => {
      const slots = c.kind === 'tank' ? TANK_SLOTS : BUG_SLOTS
      if (c.kind === 'tank') {
        const ph = time * 0.6 + i * 1.7 + c.x
        s.x = c.x + slots[i][0] + Math.sin(ph) * 3
        s.y = c.y + slots[i][1] + Math.sin(ph * 1.3) * 1
        s.scale.x = Math.abs(s.scale.x) * (Math.cos(ph) >= 0 ? 1 : -1)
      } else if (c.kind === 'bugs' && Math.sin(time * 0.9 + i * 2.1 + c.x) > 0.96) s.scale.x = Math.abs(s.scale.y) * 0.6
      else if (c.kind === 'bugs') s.scale.x = Math.abs(s.scale.y)
    })
    this.curator.update(dt)
  }

  protected exitScene(): SceneId { return `isle:${this.isleId}` as SceneId }
  protected exitPos() {
    const t = state.isle?.curatorTent
    return t ? { x: (t.tx + 0.5) * TILE, y: (t.ty + 1.7) * TILE } : { x: 0, y: 0 }
  }
  protected lighting() { return { ambient: [0.9, 0.88, 0.85], gain: 0.3, sat: 1.06 } }
  protected music() { return 'day' as const }

  private busy = false
  protected interact(): Hint | null {
    if (this.busy) return null
    const me = this.me
    // 前台：龟教授
    if (Math.abs(me.x - MUSEUM_DESK.x) < 34 && me.y > MUSEUM_DESK.y && me.y - MUSEUM_DESK.y < 44) return { text: `<b>E</b> 和${CURATOR.name}说话`, act: () => this.talk() }
    // 展柜：看看里面有什么
    for (const c of this.cases) {
      if (Math.abs(me.x - c.x) > 26 || me.y < c.y - 4 || me.y - c.y > 26) continue
      return { text: '<b>E</b> 看看', act: () => this.look(c) }
    }
    return this.doorHint()
  }
  private async talk() {
    this.busy = true
    this.curator.faceTo(this.me.x, this.me.y)
    try { await talkCurator(this.g) } finally { this.busy = false; this.g.hud.closeDialog() }
  }
  private look(c: Case) {
    const donated = new Set(state.isle?.museum.donated ?? [])
    const have = c.items.filter(id => donated.has(id)).map(id => ITEMS[id]?.name ?? id)
    const what = c.kind === 'tank' ? '水族箱' : c.kind === 'bugs' ? '标本柜' : '展台'
    this.g.hud.toast(have.length ? `${what}：${have.join('、')}${have.length < c.items.length ? `（还空着 ${c.items.length - have.length} 个位置）` : ''}` : `这个${what}还空着`)
  }
}
