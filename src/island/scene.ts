// 岛屿场景：3/4 俯视农场。地面/水面烘焙 + 物件景深排序 + 昼夜光照 + 天气与小生物
import { Container, Graphics, Sprite, Text, Texture } from 'pixi.js'
import type { Game, Scene } from '../game.ts'
import { PixelView } from '../core/pixelview.ts'
import { dirOf } from '../core/input.ts'
import { acKind, HD } from '../acstyle.ts'
import { bakeIsland } from './terrain.ts'
import type { IslandBake } from './terrain.ts'
import { WaterFilter } from './water.ts'
import { GroundFilter } from './ground.ts'
import { Farmer } from './farmer.ts'
import { Particles } from '../fx/particles.ts'
import { Swayer, swaySplit } from '../fx/sway.ts'
import { buildIsland, isTillable, ISLAND_W, ISLAND_H, PLACES, T, LOTS, lotDoor, lotSign, fenceTiles, FENCE_GATES, picketTiles } from '../../shared/island.ts'
import { fenceTexture, FENCE_ANCHOR_Y } from './fence.ts'
import { NPCS, NpcActor } from './npcs.ts'
import type { NpcDef } from './npcs.ts'
import { canvas, texFrom } from '../core/assets.ts'
import type { Island, IslandObject } from '../../shared/island.ts'
import { TILE, ITEMS, cropStage, restaurantOpen, RESTAURANT_OPEN } from '../../shared/data.ts'
import { plotKey } from '../../shared/protocol.ts'
import type { PlayerPublic, Dir } from '../../shared/protocol.ts'
import { state, selectedItem } from '../state.ts'
import { MAPS } from '../../shared/world/maps.ts'
import { NPC_INFO, hearts, tierOf, giftable } from '../../shared/npcs.ts'
import type { NpcId } from '../../shared/npcs.ts'
import { countItem, ENERGY_MAX, DIVE_ENERGY } from '../../shared/data.ts'
import { NOTICE_BOARD, MARKET } from '../../shared/island.ts'
import { RestoreLayer, fireworks, seaGlow } from './restore.ts'
import { STAGES } from '../../shared/restore.ts'
import { town } from '../../shared/schedules.ts'
import { MARKET_DAY } from '../../shared/restore.ts'
import { calendarOf } from '../../shared/data.ts'
import { EVENTS, inHours } from '../../shared/events.ts'
import { Cutscene } from './cutscene.ts'
import type { ServerMsg } from '../../shared/protocol.ts'

const MAP_W = ISLAND_W * TILE, MAP_H = ISLAND_H * TILE
const SPEED = 88
const REACH = 1.9 * TILE

// 烘焙很慢（几百毫秒），只做一次，场景来回切换时复用
let baked: { island: Island, bake: IslandBake } | null = null

// 一天里的环境光关键帧：[小时, r, g, b, 光源强度, 饱和度]
const SKY: [number, number, number, number, number, number][] = [
  [5.5, 0.42, 0.42, 0.62, 0.9, 0.8],
  [6.5, 0.86, 0.74, 0.76, 0.3, 0.95],
  [8, 1.0, 0.97, 0.93, 0.0, 1.05],
  [12, 1.02, 1.02, 1.0, 0.0, 1.08],
  [16.5, 1.02, 0.97, 0.9, 0.0, 1.08],
  [18.3, 1.0, 0.8, 0.62, 0.15, 1.1],
  [19.4, 0.66, 0.54, 0.72, 0.6, 0.95],
  [20.6, 0.32, 0.34, 0.56, 1.0, 0.82],
  [27.5, 0.27, 0.3, 0.52, 1.0, 0.8],
  [29.5, 0.42, 0.42, 0.62, 0.9, 0.8],
]
export function sky(hour: number) {
  let h = hour < 5.5 ? hour + 24 : hour
  for (let i = 0; i < SKY.length - 1; i++) {
    const a = SKY[i], b = SKY[i + 1]
    if (h >= a[0] && h <= b[0]) {
      const k = (h - a[0]) / (b[0] - a[0])
      return a.slice(1).map((v, j) => v + (b[j + 1] - v) * k)
    }
  }
  return SKY[0].slice(1)
}

interface Placed { s: Container, o: IslandObject, phase: number, sw?: Swayer, sh?: Sprite }
interface CropView { sw: Swayer, tex: Texture, baseY: number }
interface Lamp { s: Sprite, x: number, y: number, r: number, flicker: number, day: number }

export class IslandScene implements Scene {
  view: PixelView
  overlay = new Container()
  island: Island
  water: Sprite
  waterFilter = new WaterFilter()
  groundFilter: GroundFilter | null = null   // 高清模式的地面着色器
  restoreGround = new Container()   // 栈桥（贴地）
  restoreSky = new Container()      // 灯塔光束在空气里的那一道（盖在所有东西上面）
  soilLayer = new Container()
  shadowLayer = new Container()
  entities = new Container()
  fx = new Particles()
  cursor = new Graphics()
  placed: Placed[] = []
  lamps: Lamp[] = []
  me: Farmer
  myLight: Sprite
  others = new Map<number, Farmer & { lastAct?: number }>()
  soils = new Map<string, Sprite>()
  crops = new Map<string, CropView>()
  private unsub: (() => void)[] = []
  private sendT = 0
  private lastSent = ''
  private stepT = 0
  private target: { tx: number, ty: number } | null = null
  private useCooldown = 0
  private rainAcc = 0
  private critterT = 0
  blocked: Uint8Array
  private solidGrid = new Map<number, [number, number, number, number][]>()
  private solids: [number, number, number, number][] = []   // 小物件碰撞底座（集市开张后会变）
  restoreLayer!: RestoreLayer
  private zoomCd = 0
  npcs: NpcActor[] = []
  camTarget: { x: number, y: number } | null = null   // 剧情镜头
  meWalk: { x: number, y: number } | null = null      // 剧情让玩家走过去
  cutscene: Cutscene | null = null
  private evCheckT = 0
  private walkGrid!: Uint8Array                        // 寻路用：哪些地块能走
  mailFlag = new Graphics()     // 自家信箱有新信时，上方飘着一个小信封（门牌上的小红旗是「这是你家」，别混了）
  lotObjs: Container[] = []    // 宅基地的门牌（随 houses 消息重建，直接放进 entities 参与景深排序）
  lotLamps: Lamp[] = []
  // 展示模式（标题画面）：不显示玩家、不接输入、不连服务端，镜头由 camDirect 直接指定（像素，画面中心）
  attract = false
  camDirect: { x: number, y: number } | null = null
  // 任务指路：目标不在画面里时屏幕边上一个金色箭头（写着是谁、多远），在画面里时目标头顶跳一个小箭头
  private guideArrow = new Graphics()
  private guideText = new Text({ text: '', style: { fontFamily: 'FusionPixel', fontSize: 24, fill: 0xffe39a, stroke: { color: 0x3a2314, width: 4 } }, resolution: 1 })
  private guideMark = new Graphics()

  constructor(private g: Game, opts: { attract?: boolean } = {}) {
    const { assets } = g
    this.attract = !!opts.attract
    this.view = new PixelView(g.app.renderer as any, this.attract ? 330 : 300, this.attract ? '' : 'island', HD)
    this.view.mapW = MAP_W; this.view.mapH = MAP_H
    if (!baked) baked = { island: buildIsland(), bake: bakeIsland(HD) }
    this.island = baked.island
    this.blocked = Uint8Array.from(this.island.blocked)
    this.solids = [...this.island.solids]
    this.rebuildSolids()
    const W = this.view.world

    this.water = new Sprite(baked.bake.water)
    this.water.filters = [this.waterFilter]
    const bk = baked.bake
    const ground = new Sprite(bk.ground ?? bk.field!.tex)
    if (bk.field) {
      // 高清地面：场纹理的第 i 个采样点在世界坐标 i×S 处（纹素中心对齐），由地面着色器上色
      ground.scale.set(bk.field.S)
      ground.position.set(-bk.field.S / 2, -bk.field.S / 2)
      this.groundFilter = new GroundFilter(PLACES.farm)
      ground.filters = [this.groundFilter]
    }
    const dock = new Sprite(bk.dock?.tex ?? Texture.EMPTY)
    if (bk.dock) dock.position.set(bk.dock.x, bk.dock.y)
    this.entities.sortableChildren = true
    W.addChild(this.water, ground, dock, this.restoreGround, this.soilLayer, this.shadowLayer, this.entities, this.restoreSky, this.fx.layer, this.cursor)

    // 物件
    for (const o of this.island.objects) {
      const tex = assets.island[acKind(o.kind, o.x, o.y)] ?? assets.decor[o.kind]
      if (!tex) continue
      // 会随风摆动的植物拆成上下两段（上段整块按整数像素平移），其余直接用整张精灵
      const sw = o.sway ? new Swayer(tex, swaySplit(o.kind)) : undefined
      const s: Container = sw ? sw.root : new Sprite(tex)
      s.position.set(o.x, o.y)
      if (o.flip) s.scale.x = -1
      s.zIndex = o.y
      this.entities.addChild(s)
      const pl: Placed = { s, o, phase: Math.random() * 10, sw }
      this.placed.push(pl)
      if (o.kind !== 'boat' && o.kind !== 'pebbles') {
        const wide = o.kind.startsWith('house') || o.kind === 'stall' || o.kind === 'seedshop'
        const sh = new Sprite(assets.shadow(wide ? tex.width * 0.8 : Math.min(60, tex.width * (o.kind.startsWith('palm') ? 0.45 : 0.7))))
        sh.position.set(o.x + (o.kind.startsWith('palm') ? (o.flip ? 6 : -6) : 0), o.y - 1)
        this.shadowLayer.addChild(sh)
        pl.sh = sh
      }
      if (o.light) {
        const spots = o.kind === 'house' ? [[-48, -34], [48, -34], [0, -20]] : o.kind === 'restaurant' ? [[-46, -34], [46, -34], [0, -22], [-26, -40], [26, -40]] : o.kind === 'stall' ? [[50, -56], [0, -30]] : o.kind === 'seedshop' ? [[0, -42]] : o.kind === 'lantern' ? [[4, -26]] : [[0, -6]]
        for (const [dx, dy] of spots) this.addLamp(o.x + (o.flip ? -dx : dx), o.y + dy, o.light.r, o.light.color, o.kind === 'campfire' ? 1 : 0.15, o.kind === 'campfire' ? 0.55 : 0)
      }
    }

    // 寿司店招牌：空白木牌上写店名
    const shop = this.island.objects.find(o => o.kind === 'restaurant')
    if (shop) {
      const sign = new Sprite(signText('寿司'))
      sign.anchor.set(0.5)
      sign.position.set(Math.round(shop.x), Math.round(shop.y) - 64)
      sign.zIndex = shop.y + 1
      this.entities.addChild(sign)
    }

    // 篱笆：按四邻接选纹理，挨着门的那根画成门柱
    const fset = new Set(fenceTiles().map(([x, y]) => `${x},${y}`))
    for (const [fx, fy] of fenceTiles()) {
      const has = (x: number, y: number) => fset.has(`${x},${y}`)
      const gate = [[0, -1], [1, 0], [0, 1], [-1, 0]].some(([dx, dy]) => FENCE_GATES.has(`${fx + dx},${fy + dy}`))
      const mask = (has(fx, fy - 1) ? 1 : 0) | (has(fx + 1, fy) ? 2 : 0) | (has(fx, fy + 1) ? 4 : 0) | (has(fx - 1, fy) ? 8 : 0)
      const sp = new Sprite(fenceTexture(mask, gate))
      sp.anchor.set(0, FENCE_ANCHOR_Y)
      sp.position.set(fx * TILE, fy * TILE + 20)
      sp.zIndex = sp.y
      this.entities.addChild(sp)
    }
    const pset = new Set(picketTiles().map(([x, y]) => `${x},${y}`))
    for (const [fx, fy] of picketTiles()) {
      const has = (x: number, y: number) => pset.has(`${x},${y}`)
      const mask = (has(fx, fy - 1) ? 1 : 0) | (has(fx + 1, fy) ? 2 : 0) | (has(fx, fy + 1) ? 4 : 0) | (has(fx - 1, fy) ? 8 : 0)
      // 门口两侧：横向缺口旁边那根当门柱
      const gate = (!has(fx - 1, fy) && has(fx + 1, fy) && !has(fx, fy - 1)) || (!has(fx + 1, fy) && has(fx - 1, fy) && !has(fx, fy - 1))
      const sp = new Sprite(fenceTexture(mask, gate, 'picket'))
      sp.anchor.set(0, FENCE_ANCHOR_Y)
      sp.position.set(fx * TILE, fy * TILE + 20)
      sp.zIndex = sp.y
      this.entities.addChild(sp)
    }
    this.rebuildLots()

    // 复兴工程：栈桥、灯塔、集市、客船（会随全服进度变）
    this.restoreLayer = new RestoreLayer(assets, this.restoreGround, this.entities, this.shadowLayer, this.view.lights, this.restoreSky)
    this.applyRestore()
    // 新信提示：白信封 + 深色描边 + 信封口的 V 形折痕 + 红色火漆
    const fl = this.mailFlag
    fl.rect(-7, -6, 14, 11).fill(0x3a2314).rect(-6, -5, 12, 9).fill(0xfff8e4).rect(-6, 3, 12, 1).fill(0xd9c9a8)
    for (let i = 0; i < 5; i++) { fl.rect(-6 + i, -5 + i, 1, 1).fill(0xb89a70); fl.rect(5 - i, -5 + i, 1, 1).fill(0xb89a70) }
    fl.rect(-1, -1, 2, 2).fill(0xe0503a)
    fl.visible = false
    this.entities.addChild(fl)

    // NPC
    for (const def of NPCS) {
      const a = new NpcActor(def, assets, (x, y) => this.free(x, y), (fx, fy, tx, ty) => this.route(fx, fy, tx, ty), state.hour, state.rain)
      this.npcs.push(a)
      this.entities.addChild(a.root)
    }

    // 玩家
    this.me = new Farmer(assets, state.me.hue, state.me.name, true)
    this.me.x = this.me.tx = g.meStart.x
    this.me.y = this.me.ty = g.meStart.y
    this.entities.addChild(this.me.root)
    this.overlay.addChild(this.me.tag)
    this.myLight = this.addLight(0xffd79a)
    if (this.attract) { this.me.root.visible = false; this.me.tag.visible = false; this.myLight.visible = false }
    this.guideArrow.poly([22, 0, -8, -14, -2, 0, -8, 14]).fill(0xffc444).stroke({ color: 0x3a2314, width: 4 })
    this.guideMark.poly([-7, -9, 7, -9, 0, 0]).fill(0xffc444).stroke({ color: 0x3a2314, width: 2 })
    this.guideText.anchor.set(0.5)
    this.overlay.addChild(this.guideArrow, this.guideText, this.guideMark)

    g.app.stage.addChild(this.view.display, this.overlay)
    this.rebuildPlots()

    this.unsub.push(
      g.net.on('players', m => this.syncPlayers(m.list)),
      g.net.on('left', m => this.removeOther(m.id)),
      g.net.on('plot', m => this.refreshPlot(m.key)),
      g.net.on('plots', () => this.rebuildPlots()),
      g.net.on('houses', () => this.rebuildLots()),
      g.net.on('giftResult', m => this.onGift(m)),
      g.net.on('questDone', m => this.onQuestDone(m)),
      g.net.on('restore', () => this.applyRestore()),
    )
    this.view.post.set('uMode', 0)
    g.hud.setSeaMode(false)
    this.snapCamera()
  }

  private addLight(color: number) {
    const s = new Sprite(this.g.assets.light)
    s.anchor.set(0.5)
    s.tint = color
    s.blendMode = 'add'
    this.view.lights.addChild(s)
    return s
  }
  private addLamp(x: number, y: number, r: number, color: number, flicker: number, day: number) {
    const s = this.addLight(color)
    s.position.set(x, y)
    s.scale.set(r / 64)
    this.lamps.push({ s, x, y, r, flicker, day })
  }

  // ── 潮汐村宅基地 ──
  private rebuildLots() {
    for (const o of this.lotObjs) o.destroy({ children: true })
    this.lotObjs = []
    for (const l of this.lotLamps) l.s.destroy()
    this.lamps = this.lamps.filter(l => !this.lotLamps.includes(l))
    this.lotLamps = []
    for (const lot of LOTS) {
      const h = state.houses.find(x => x.lot === lot.id)
      // 门牌：有人住写主人名字（自己的插小红旗），没人住写「空房」
      // 名牌挂在信箱正上方（没有信箱就立在门边）
      const mb = lot.decor.find(d => d.k === 'mailbox')
      const sp = mb ? { x: lot.x + mb.dx, y: lot.y + mb.dy } : lotSign(lot)
      const sign = new Sprite(nameSign(h ? h.name : '空房', !!h && h.owner === state.me.id, !mb))
      sign.anchor.set(0.5, 1)
      const sc = new Container(); sc.addChild(sign); sc.position.set(Math.round(sp.x * TILE), Math.round(sp.y * TILE) - (mb ? 25 : 0))
      sc.zIndex = sp.y * TILE + 1
      this.entities.addChild(sc); this.lotObjs.push(sc)
      // 有人住的房子夜里窗户亮灯
      if (h) for (const [dx, dy] of [[-46, -36], [46, -36], [0, -18]]) {
        this.addLamp(lot.x * TILE + dx, lot.y * TILE + dy, 52, 0xffc36b, 0.12, 0)
        this.lotLamps.push(this.lamps[this.lamps.length - 1])
      }
    }
  }

  // ── 农田渲染 ──
  private rebuildPlots() {
    for (const s of this.soils.values()) s.destroy()
    for (const c of this.crops.values()) c.sw.root.destroy({ children: true })
    this.soils.clear(); this.crops.clear()
    for (const key of state.plots.keys()) this.refreshPlot(key, false)
  }

  private refreshPlot(key: string, neighbors = true) {
    const [tx, ty] = key.split(',').map(Number)
    const plot = state.plots.get(key)
    let soil = this.soils.get(key)
    if (!plot) {
      soil?.destroy(); this.soils.delete(key)
      this.crops.get(key)?.sw.root.destroy({ children: true }); this.crops.delete(key)
    } else {
      if (!soil) { soil = new Sprite(); soil.position.set(tx * TILE, ty * TILE); this.soilLayer.addChild(soil); this.soils.set(key, soil) }
      const has = (x: number, y: number) => state.plots.has(plotKey(x, y))
      const mask = (has(tx, ty - 1) ? 1 : 0) | (has(tx + 1, ty) ? 2 : 0) | (has(tx, ty + 1) ? 4 : 0) | (has(tx - 1, ty) ? 8 : 0)
      soil.texture = (plot.watered ? this.g.assets.soil.wet : this.g.assets.soil.dry)[mask]
      let crop = this.crops.get(key)
      if (plot.crop) {
        const tex = this.g.assets.crops[`${plot.crop}_${cropStage(plot.crop, plot.grown ?? 0)}`]
        // 长到下一阶段换了图：整个重建（上下两段都要换）
        if (crop && crop.tex !== tex) { crop.sw.root.destroy({ children: true }); this.crops.delete(key); crop = undefined }
        if (!crop) {
          const sw = new Swayer(tex, 0.5)
          const baseY = ty * TILE + TILE - 4
          sw.root.position.set(tx * TILE + TILE / 2, baseY)
          sw.root.zIndex = baseY
          this.entities.addChild(sw.root)
          this.crops.set(key, { sw, tex, baseY })
        }
      } else if (crop) { crop.sw.root.destroy({ children: true }); this.crops.delete(key) }
    }
    if (neighbors) for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]]) {
      const k = plotKey(tx + dx, ty + dy)
      if (state.plots.has(k)) this.refreshPlot(k, false)
    }
  }

  // ── 其他玩家 ──
  private syncPlayers(list: PlayerPublic[]) {
    const seen = new Set<number>()
    for (const p of list) {
      if (p.scene !== 'island') continue
      seen.add(p.id)
      let f = this.others.get(p.id)
      if (!f) {
        f = new Farmer(this.g.assets, p.hue, p.name, false) as Farmer & { lastAct?: number }
        f.x = f.tx = p.x; f.y = f.ty = p.y
        this.entities.addChild(f.root)
        this.overlay.addChild(f.tag)
        this.others.set(p.id, f)
      }
      f.tx = p.x; f.ty = p.y; f.dir = p.dir; f.moving = p.moving
      if (p.actAt && p.actAt !== f.lastAct) {
        f.lastAct = p.actAt
        const icon = p.act === 'till' ? 'hoe' : p.act === 'water' ? 'watering_can' : p.act === 'plant' ? 'seed_bag' : ''
        if (icon && f.lastAct > 0) f.act(icon)
      }
    }
    for (const id of [...this.others.keys()]) if (!seen.has(id)) this.removeOther(id)
  }
  private removeOther(id: number) {
    this.others.get(id)?.destroy()
    this.others.delete(id)
  }

  // 小物件碰撞底座按 48 像素分桶，查询时只看附近几个桶
  private rebuildSolids() {
    this.solidGrid.clear()
    for (const r of this.solids) {
      for (let cy = Math.floor(r[1] / 48); cy <= Math.floor(r[3] / 48); cy++) for (let cx = Math.floor(r[0] / 48); cx <= Math.floor(r[2] / 48); cx++) {
        const k = cy * 1000 + cx
        const list = this.solidGrid.get(k)
        if (list) list.push(r); else this.solidGrid.set(k, [r])
      }
    }
  }

  // ── 复兴工程：进度变了，重建工程物件、改碰撞 ──
  private applyRestore() {
    // 标题画面按全部完工的样子摆：给玩家看潮汐港将来的样子
    const done = this.attract ? STAGES.length : state.restore?.done ?? 0
    this.restoreLayer.apply(done)
    // 栈桥修好以后那几格浅水能走
    const B = PLACES.bridge
    for (let y = B.y0; y <= B.y1; y++) for (let x = B.x0; x <= B.x1; x++) this.blocked[y * ISLAND_W + x] = done >= 1 ? 0 : this.island.blocked[y * ISLAND_W + x]
    // 集市开张：清掉那块地上的野生植物，摊位有碰撞底座
    const [x0, y0, x1, y1] = MARKET.clear.map(v => v * TILE)
    const cleared = (x: number, y: number) => done >= 3 && x >= x0 && x <= x1 && y >= y0 && y <= y1
    for (const p of this.placed) { const hide = cleared(p.o.x, p.o.y); p.s.visible = !hide; if (p.sh) p.sh.visible = !hide }
    this.solids = this.island.solids.filter(r => !cleared((r[0] + r[2]) / 2, (r[1] + r[3]) / 2))
    if (done >= 3) for (const st of MARKET.stalls) this.solids.push([st.x * TILE - 44, st.y * TILE - 12, st.x * TILE + 44, st.y * TILE])
    this.rebuildSolids()
    this.buildWalkGrid()
  }
  // 过场特效
  private effect(kind: string, x: number, y: number) {
    const { assets, audio } = this.g
    if (kind === 'fireworks') fireworks(this.fx, this.view.lights, assets.light, audio, x, y)
    else if (kind === 'glow') seaGlow(this.fx, this.view.lights, assets.light, x, y, (px, py) => {
      const t = this.island.types[Math.floor(py / TILE) * ISLAND_W + Math.floor(px / TILE)]
      return t === T.SHALLOW || t === T.DEEP
    })
    else if (kind === 'beamoff') this.restoreLayer.beamHold = true
    else if (kind === 'beamon') this.restoreLayer.beamHold = false
  }

  // ── 碰撞 ──
  private blockedAt(px: number, py: number) {
    const tx = Math.floor(px / TILE), ty = Math.floor(py / TILE)
    if (tx < 0 || ty < 0 || tx >= ISLAND_W || ty >= ISLAND_H) return true
    return this.blocked[ty * ISLAND_W + tx] === 1
  }
  // 角色脚底碰撞盒 10×4 像素
  private free(x: number, y: number) {
    if (this.blockedAt(x - 5, y - 4) || this.blockedAt(x + 5, y - 4) || this.blockedAt(x - 5, y) || this.blockedAt(x + 5, y)) return false
    const x0 = x - 5, x1 = x + 5, y0 = y - 4, y1 = y
    for (let cy = Math.floor(y0 / 48); cy <= Math.floor(y1 / 48); cy++) for (let cx = Math.floor(x0 / 48); cx <= Math.floor(x1 / 48); cx++) {
      for (const r of this.solidGrid.get(cy * 1000 + cx) ?? []) if (x1 > r[0] && x0 < r[2] && y1 > r[1] && y0 < r[3]) return false
    }
    return true
  }

  // 沿一个轴移动；被挡住时尝试沿垂直方向错开几个像素（绕过拐角），避免蹭到边就走不动
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

  // 万一站进了障碍物里（地图改版后的旧存档位置等），就近挪到空地上
  private unstick() {
    const me = this.me
    if (this.free(me.x, me.y)) return
    for (let r = 4; r <= 240; r += 4) for (let a = 0; a < 16; a++) {
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
    const v = this.view
    v.camX = Math.max(0, Math.min(MAP_W - v.viewW, v.camX))
    v.camY = Math.max(0, Math.min(MAP_H - v.viewH, v.camY))
  }

  // ── 使用手上的东西 ──
  private use() {
    const t = this.target
    if (!t || this.useCooldown > 0) return
    const { net, audio } = this.g
    const key = plotKey(t.tx, t.ty)
    const plot = state.plots.get(key)
    const item = selectedItem()
    const cx = t.tx * TILE + TILE / 2, cy = t.ty * TILE + TILE / 2
    this.faceTo(cx, cy)
    this.useCooldown = 0.35
    if (plot?.crop && cropStage(plot.crop, plot.grown ?? 0) >= 4) {
      net.send({ t: 'act', kind: 'harvest', tx: t.tx, ty: t.ty })
      this.me.act('')
      audio.play('harvest', 0.5)
      for (let i = 0; i < 10; i++) this.fx.spawn({ x: cx, y: cy - 6, vx: (Math.random() - 0.5) * 60, vy: -40 - Math.random() * 50, ay: 160, life: 0.6, color: [0xfff0a0, 0xffffff, 0x9be36a][i % 3] })
      return
    }
    if (!item) return
    if (item.id === 'hoe') {
      this.me.act('hoe')
      audio.play('till', 0.55)
      if (isTillable(this.island, t.tx, t.ty) && !plot) net.send({ t: 'act', kind: 'till', tx: t.tx, ty: t.ty })
      for (let i = 0; i < 7; i++) this.fx.spawn({ x: cx + (Math.random() - 0.5) * 10, y: cy + 4, vx: (Math.random() - 0.5) * 50, vy: -30 - Math.random() * 40, ay: 200, life: 0.45, color: [0x7a4e2e, 0x9b6a40, 0x5e3b24][i % 3] })
    } else if (item.id === 'can') {
      this.me.act('watering_can')
      audio.play('water', 0.5)
      if (plot && !plot.watered) net.send({ t: 'act', kind: 'water', tx: t.tx, ty: t.ty })
      for (let i = 0; i < 14; i++) this.fx.spawn({ x: cx + (Math.random() - 0.5) * 14, y: cy - 10 - Math.random() * 6, vx: (Math.random() - 0.5) * 20, vy: 20 + Math.random() * 30, ay: 220, life: 0.4, color: i % 2 ? 0x9fe3ff : 0xe8fbff })
    } else if (ITEMS[item.id]?.seedOf) {
      if (plot && !plot.crop) {
        this.me.act(ITEMS[item.id].icon)
        audio.play('plant', 0.5)
        net.send({ t: 'act', kind: 'plant', tx: t.tx, ty: t.ty, slot: state.me.selected })
      }
    } else if (ITEMS[item.id]?.food) {
      // 吃东西：体力满了就不吃
      if (state.energy >= ENERGY_MAX) { this.g.hud.toast('现在不饿'); return }
      audio.play('harvest', 0.4, 1.3)
      net.send({ t: 'eat', slot: state.me.selected })
    }
  }

  private faceTo(x: number, y: number) {
    const dx = x - this.me.x, dy = y - (this.me.y - 8)
    this.me.dir = Math.abs(dx) > Math.abs(dy) ? (dx < 0 ? 'left' : 'right') : (dy < 0 ? 'up' : 'down')
  }

  // ── 寻路：地块不挡、格子中心没有小物件底座，就算能走 ──
  private buildWalkGrid() {
    const g = new Uint8Array(ISLAND_W * ISLAND_H)
    for (let y = 0; y < ISLAND_H; y++) for (let x = 0; x < ISLAND_W; x++) {
      if (this.blocked[y * ISLAND_W + x]) continue
      const cx = (x + 0.5) * TILE, cy = (y + 0.5) * TILE
      if (this.solids.some(r => cx + 6 > r[0] && cx - 6 < r[2] && cy + 4 > r[1] && cy - 4 < r[3])) continue
      g[y * ISLAND_W + x] = 1
    }
    this.walkGrid = g
  }
  // A*（4 邻接），返回像素坐标的拐点；走不通返回 null
  route(fx: number, fy: number, tx: number, ty: number): { x: number, y: number }[] | null {
    const W = ISLAND_W, H = ISLAND_H, g = this.walkGrid
    const snap = (px: number, py: number) => {
      let bx = Math.floor(px / TILE), by = Math.floor(py / TILE)
      if (g[by * W + bx]) return by * W + bx
      for (let r = 1; r < 5; r++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
        const x = bx + dx, y = by + dy
        if (x >= 0 && y >= 0 && x < W && y < H && g[y * W + x]) return y * W + x
      }
      return -1
    }
    const a = snap(fx, fy), b = snap(tx, ty)
    if (a < 0 || b < 0) return null
    const cost = new Float32Array(W * H).fill(Infinity), from = new Int32Array(W * H).fill(-1)
    const open: number[] = [a]; cost[a] = 0
    const bx = b % W, by = Math.floor(b / W)
    while (open.length) {
      let bi = 0, bf = Infinity
      for (let i = 0; i < open.length; i++) { const c = open[i], f = cost[c] + Math.abs(c % W - bx) + Math.abs(Math.floor(c / W) - by); if (f < bf) { bf = f; bi = i } }
      const cur = open.splice(bi, 1)[0]
      if (cur === b) break
      const cx = cur % W, cy = Math.floor(cur / W)
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = cx + dx, ny = cy + dy
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue
        const n = ny * W + nx
        if (!g[n] || cost[cur] + 1 >= cost[n]) continue
        if (cost[n] === Infinity) open.push(n)
        cost[n] = cost[cur] + 1; from[n] = cur
      }
    }
    if (a !== b && from[b] < 0) return null
    const tiles: number[] = []
    for (let c = b; c !== a && c >= 0; c = from[c]) tiles.push(c)
    tiles.reverse()
    // 只保留拐点，最后一站用精确目标
    const pts: { x: number, y: number }[] = []
    for (let i = 0; i < tiles.length; i++) {
      const p = tiles[i], q = tiles[i - 1] ?? a, n = tiles[i + 1]
      if (n === undefined || (p - q) !== (n - p)) pts.push({ x: (p % W + 0.5) * TILE, y: (Math.floor(p / W) + 0.5) * TILE })
    }
    pts.push({ x: tx, y: ty })
    return pts
  }

  // ── 心事件：好感够、时段天气对、走进区域就开演 ──
  private checkEvents() {
    const st = state.story
    if (!st || this.cutscene || this.g.switching || this.g.hud.modalOpen()) return
    const me = this.me
    const done = state.restore?.done ?? 0
    // 小镇事件只演最新完工的那一期（晚来的玩家不用把前面几期补看一遍）
    const townEv = EVENTS.filter(e => e.town && (e.stage ?? 0) <= done && !st.seen.includes(e.id)).sort((a, b) => (b.stage ?? 0) - (a.stage ?? 0))[0]
    for (const ev of [...(townEv ? [townEv] : []), ...EVENTS.filter(e => !e.town)]) {
      if (st.seen.includes(ev.id)) continue
      if (!ev.town && state.lastEventDay === state.day) continue
      if (ev.stage !== undefined && done < ev.stage) continue
      if (ev.quest && !st.done.includes(ev.quest)) continue
      if (hearts(st.rel[ev.npc]?.pts ?? 0) < ev.hearts) continue
      if (!inHours(state.hour, ev.hours) || (ev.noRain && state.rain)) continue
      if (ev.after?.some(p => !st.seen.includes(p))) continue
      if (Math.hypot(me.x / TILE - ev.area.x, me.y / TILE - ev.area.y) > ev.area.r) continue
      this.playEvent(ev.id)
      return
    }
  }
  playEvent(id: string) {
    const ev = EVENTS.find(e => e.id === id)
    if (!ev || this.cutscene) return
    // 播放器只拿到它需要的东西（镜头目标、玩家走位用 getter/setter 连回场景）
    const self = this
    const stage = {
      g: this.g, me: this.me, npcs: this.npcs, effect: (k: string, x: number, y: number) => this.effect(k, x, y),
      get camTarget() { return self.camTarget }, set camTarget(v) { self.camTarget = v },
      get meWalk() { return self.meWalk }, set meWalk(v) { self.meWalk = v },
    }
    const cs = new Cutscene(stage, ev)
    this.cutscene = cs
    cs.run().finally(() => {
      this.cutscene = null
      this.restoreLayer.beamHold = false
      const seen = state.story?.seen
      seen?.push(ev.id)
      if (ev.town) { for (const o of EVENTS) if (o.town && (o.stage ?? 0) < (ev.stage ?? 0) && !seen?.includes(o.id)) seen?.push(o.id) }
      else state.lastEventDay = state.day
    })
  }

  // ── 任务指路 ──
  // 先指东西已经凑齐、马上能交的委托；再指新手引导这一步；再指「认识大家」里离得最近、还没打过招呼的人
  private guideTarget(): { x: number, y: number, label: string, npc: boolean } | null {
    const qs = state.story?.quests ?? []
    const npcAt = (id: NpcId) => {
      const a = this.npcs.find(n => n.def.id === id)
      return a ? { x: a.x, y: a.y - 44, label: NPC_INFO[id].name, npc: true } : null
    }
    for (const q of qs) if (q.obj.kind === 'deliver' && countItem(state.me.inv, q.obj.item) >= q.obj.n) return npcAt(q.obj.to)
    const g = qs.find(q => q.to)
    if (g?.to) return 'npc' in g.to ? npcAt(g.to.npc) : { x: g.to.x * TILE, y: g.to.y * TILE, label: g.to.label, npc: false }
    const intro = qs.find(q => q.obj.kind === 'meet')
    if (intro?.obj.kind === 'meet') {
      let best: ReturnType<typeof npcAt> = null, bd = Infinity
      for (const id of intro.obj.npcs) {
        if (intro.met?.includes(id)) continue
        const p = npcAt(id)
        const d = p ? Math.hypot(p.x - this.me.x, p.y - this.me.y) : Infinity
        if (d < bd) { bd = d; best = p }
      }
      if (best) return best
    }
    return null
  }
  private updateGuide(time: number) {
    this.guideArrow.visible = this.guideText.visible = this.guideMark.visible = false
    const t = this.attract || this.cutscene || this.g.switching || this.g.hud.modalOpen() ? null : this.guideTarget()
    if (!t) return
    const v = this.view, me = this.me
    const dist = Math.hypot(t.x - me.x, t.y + (t.npc ? 44 : 0) - me.y) / TILE
    if (dist < (t.npc ? 1.6 : 3.5)) return   // 已经到了
    const p = v.worldToScreen(t.x, t.y)
    const z = Math.max(1, v.scale / 3)
    const W = v.sw, H = v.sh, m = 70 * z
    if (p.x > m && p.y > m && p.x < W - m && p.y < H - m) {
      this.guideMark.visible = true
      this.guideMark.scale.set(z * 1.6)
      this.guideMark.position.set(Math.round(p.x), Math.round(p.y - Math.abs(Math.sin(time * 4)) * 8 * z))
      return
    }
    const cx = W / 2, cy = H / 2, dx = p.x - cx, dy = p.y - cy
    const k = Math.min((W / 2 - m) / Math.max(1, Math.abs(dx)), (H / 2 - m) / Math.max(1, Math.abs(dy)))
    const ax = cx + dx * k, ay = cy + dy * k, ang = Math.atan2(dy, dx)
    const pulse = 1 + Math.sin(time * 5) * 0.08
    this.guideArrow.visible = this.guideText.visible = true
    this.guideArrow.scale.set(z * 1.6 * pulse)
    this.guideArrow.position.set(Math.round(ax), Math.round(ay))
    this.guideArrow.rotation = ang
    this.guideText.scale.set(z)
    this.guideText.text = `${t.label} · ${Math.round(dist)} 格`
    // 文字放在箭头内侧，不出屏幕
    const tw = this.guideText.width / 2 + 10 * z, th = 20 * z
    this.guideText.position.set(
      Math.round(Math.max(tw, Math.min(W - tw, ax - Math.cos(ang) * 60 * z))),
      Math.round(Math.max(th, Math.min(H - th, ay - Math.sin(ang) * 44 * z))),
    )
  }

  // 自家信箱的位置（地块坐标）
  private myMailbox(): { x: number, y: number } | null {
    const lot = state.myLot !== null ? LOTS[state.myLot] : undefined
    const mb = lot?.decor.find(d => d.k === 'mailbox')
    return lot && mb ? { x: lot.x + mb.dx, y: lot.y + mb.dy } : null
  }
  private unread() { return (state.story?.mail ?? []).filter(m => !m.read || (m.attach && !m.taken)).length }

  private nearest(): { kind: 'npc' | 'bin' | 'door' | 'restaurant' | 'board' | 'mail' | 'project' | 'market', text: string, npc?: NpcActor, lot?: number } | null {
    const me = this.me
    // NPC 优先
    let npc: NpcActor | undefined, bd = 40
    for (const n of this.npcs) { const d = Math.hypot(me.x - n.x, me.y - n.y); if (d < bd) { bd = d; npc = n } }
    if (npc) return { kind: 'npc', text: `<b>E</b> 和${npc.def.name}说话`, npc }
    const d = (x: number, y: number) => Math.hypot(me.x - x * TILE, me.y - y * TILE)
    if (d(PLACES.bin.x, PLACES.bin.y + 0.8) < 34) return { kind: 'bin', text: '<b>E</b> 出货箱（卖出）' }
    if (d(NOTICE_BOARD.x, NOTICE_BOARD.y + 1) < 32) {
      const b = state.story?.board
      return { kind: 'board', text: `<b>E</b> 看告示板${b && !b.taken && b.offer ? '（有新委托）' : ''}` }
    }
    const PB = PLACES.projectBoard
    if (d(PB.x, PB.y + 0.8) < 34) {
      const r = state.restore
      return { kind: 'project', text: `<b>E</b> 复兴工程告示板${r && r.done < STAGES.length ? `（${STAGES[r.done].name}）` : ''}` }
    }
    if ((state.restore?.done ?? 0) >= 3) for (const st of MARKET.stalls) {
      if (d(st.x, st.y + 0.7) < 38) return town.market ? { kind: 'market', text: '<b>E</b> 在集市摆摊（集市日卖价 +25%）' } : { kind: 'market', text: '集市每周六开张' }
    }
    const mb = this.myMailbox()
    if (mb && d(mb.x, mb.y + 0.6) < 30) { const n = this.unread(); return { kind: 'mail', text: `<b>E</b> 查看信箱${n ? `（${n} 封新信）` : ''}` } }
    if (d(PLACES.restaurant.x, PLACES.restaurant.y + 0.6) < 30) {
      return { kind: 'restaurant', text: restaurantOpen(state.hour) ? '<b>E</b> 进入潮汐寿司（营业中）' : `<b>E</b> 进入潮汐寿司（${RESTAURANT_OPEN}:00 开门）` }
    }
    for (const lot of LOTS) {
      const door = lotDoor(lot)
      if (d(door.x, door.y) > 26) continue
      const h = state.houses.find(x => x.lot === lot.id)
      if (!h) return { kind: 'door', text: '这块空地还没有人住' }
      return { kind: 'door', lot: lot.id, text: h.owner === state.me.id ? '<b>E</b> 回家' : `<b>E</b> 拜访 ${h.name} 的小屋` }
    }
    return null
  }

  private lastLine = ''
  private talkingTo: NpcDef | null = null
  private pickLine(pool: string[]) {
    const rest = pool.length > 1 ? pool.filter(l => l !== this.lastLine) : pool
    return rest[Math.floor(Math.random() * rest.length)]
  }
  // 打开对话：每天第一次会给服务端报一声（加好感、推进「认识大家」）
  private talk(def: NpcDef, text?: string) {
    const { hud, net } = this.g
    const info = NPC_INFO[def.id]
    const rel = state.story?.rel[def.id]
    if (!text) net.send({ t: 'talk', npc: def.id })
    let line = text
    if (!line) {
      const firstEver = !rel || (rel.pts === 0 && !rel.talked)
      if (firstEver) line = info.intro
      else {
        const tier = tierOf(hearts(rel.pts))
        const situ = def.greet?.({ hour: state.hour, rain: state.rain }) ?? []
        // 偶尔说一句应景的（下雨、夜里），平时按好感说；有时也会翻出低一档的话
        if (situ.length && Math.random() < 0.35) line = this.pickLine(situ)
        else line = this.pickLine(info.lines[(tier > 0 && Math.random() < 0.3 ? tier - 2 : tier) as 0 | 2 | 4 | 6 | 8])
      }
    }
    this.lastLine = line
    this.talkingTo = def
    const opts: { label: string, run: () => void }[] = []
    for (const q of state.story?.quests ?? []) {
      if (q.obj.kind !== 'deliver' || q.obj.to !== def.id) continue
      const o = q.obj
      opts.push({ label: `交付：${ITEMS[o.item]?.name ?? o.item}×${o.n}`, run: () => net.send({ t: 'deliver', quest: q.id }) })
    }
    const sel = state.me.inv[state.me.selected]
    if (sel && giftable(sel.id)) opts.push({ label: `送出${ITEMS[sel.id].name}`, run: () => net.send({ t: 'gift', npc: def.id, slot: state.me.selected }) })
    for (const o of def.options) opts.push({ label: o.label, run: () => this.npcAction(def, o.action) })
    hud.dialog({
      name: info.name, title: info.title, face: def.id, voice: info.voice, text: line,
      options: opts.map(o => ({ label: o.label })), onOption: i => opts[i].run(),
    })
  }
  private npcAction(def: NpcDef, a: string) {
    const { hud, net } = this.g
    if (a === 'travel') { this.travel(def); return }
    if (a === 'chat') {
      const rel = state.story?.rel[def.id]
      const tier = tierOf(hearts(rel?.pts ?? 0))
      this.talk(def, this.pickLine([...def.tips, ...NPC_INFO[def.id].lines[tier]]))
      return
    }
    hud.closeDialog()
    this.talkingTo = null
    if (a === 'shop:fish') hud.openShop('fish')
    else if (a === 'shop:seeds') hud.openShop('seeds')
    else if (a === 'shop:gear') hud.openUpgrade()
    else if (a === 'dive') {
      if (state.energy < DIVE_ENERGY) { hud.toast(`体力不够了（出海要 ${DIVE_ENERGY}，每分钟回 1 点），吃点东西或者歇一会儿`); this.g.audio.play('error', 0.4); return }
      net.send({ t: 'scene', to: 'sea' }); this.g.switchTo('sea')
    }
  }
  // 收礼反应 / 交付后的道谢：接着在对话框里说
  private react(npc: NpcDef['id'], line: string, note: string) {
    const def = this.npcs.find(n => n.def.id === npc)?.def
    if (!def) return
    const info = NPC_INFO[npc]
    this.g.hud.dialog({
      name: info.name, title: info.title, face: npc, voice: info.voice, text: line,
      options: [{ label: '再见' }], onOption: () => { this.g.hud.closeDialog(); this.talkingTo = null },
    })
    this.g.hud.toast(note)
  }
  private onGift(m: Extract<ServerMsg, { t: 'giftResult' }>) {
    const info = NPC_INFO[m.npc]
    const pool = m.birthday && m.delta > 0 ? info.react.birthday : info.react[m.taste]
    this.react(m.npc, this.pickLine(pool), `${info.name} 好感 ${m.delta > 0 ? '+' : ''}${m.delta}${m.birthday ? '（生日 ×8）' : ''}`)
    this.g.audio.play(m.delta > 0 ? 'coin' : 'error', 0.45, m.taste === 'love' ? 1.3 : 1)
    const n = this.npcs.find(x => x.def.id === m.npc)
    if (n && m.delta > 0) for (let i = 0; i < (m.taste === 'love' ? 14 : 6); i++) this.fx.spawn({ x: n.x + (Math.random() - 0.5) * 16, y: n.y - 30, vx: (Math.random() - 0.5) * 30, vy: -30 - Math.random() * 30, ay: 40, life: 0.9, color: [0xff6a8a, 0xffc0cc, 0xffffff][i % 3], w: 2, h: 2 })
  }
  private onQuestDone(m: Extract<ServerMsg, { t: 'questDone' }>) {
    // 说话的是收件人（阿海托你送鱼给花婶，道谢的是花婶）；任务自带台词就用它
    if (!this.talkingTo || this.talkingTo.id !== m.to) return
    this.react(m.to, m.thanks ?? this.pickLine(NPC_INFO[m.to].thanks), `${NPC_INFO[m.npc].name} 好感 +${m.npc === m.to ? 150 : 100}`)
  }

  // 老潘的航线：列出所有生成地图
  private travel(def: NpcDef) {
    const { hud, net } = this.g
    const kinds: Record<string, string> = { island: '海岛', archipelago: '群岛', continent: '大陆', cave: '洞穴' }
    const list = Object.values(MAPS)
    const voice = NPC_INFO[def.id].voice
    hud.dialog({
      name: def.name, title: def.title, face: def.id, voice,
      text: '^想去哪儿？船加满油了，远的近的都能送。到了那边在下船的地方找我，随时接你回来。',
      options: [...list.map(m => ({ label: `${m.name}（${kinds[m.kind]}）` })), { label: '算了' }],
      onOption: i => {
        hud.closeDialog()
        if (i >= list.length) return
        net.send({ t: 'travel', to: `map:${list[i].id}` })
      },
    })
  }

  update(dt: number, time: number) {
    const { input, hud, net, audio } = this.g
    const me = this.me
    this.useCooldown -= dt

    // ── 输入 ──
    if (!this.attract && !input.typing() && !this.cutscene) {
      for (let i = 1; i <= 8; i++) if (input.hit(String(i))) { state.me.selected = i - 1; hud.renderHotbar(); audio.play('select', 0.25) }
      this.zoomCd -= dt
      const zin = input.hit('+', '=') || (input.wheel < 0 && this.zoomCd <= 0)
      const zout = input.hit('-', '_') || (input.wheel > 0 && this.zoomCd <= 0)
      if ((zin || zout) && this.view.zoomBy(zin ? 1 : -1)) { this.snapCamera(); this.zoomCd = 0.12 }
      if (input.hit('i', 'tab')) hud.toggleInventory()
    }
    const ax = this.cutscene || this.attract ? { x: 0, y: 0 } : input.axis()
    let moving = false
    if (!this.g.switching && (ax.x || ax.y)) {
      const len = Math.hypot(ax.x, ax.y)
      const vx = (ax.x / len) * SPEED * dt, vy = (ax.y / len) * SPEED * dt
      if (vx) this.slide(vx, 0)
      if (vy) this.slide(0, vy)
      me.dir = dirOf(ax)
      moving = true
    }
    // 剧情让玩家走过去
    if (this.meWalk) {
      const dx = this.meWalk.x - me.x, dy = this.meWalk.y - me.y, d = Math.hypot(dx, dy)
      if (d < 1) this.meWalk = null
      else {
        const step = Math.min(d, 60 * dt)
        me.x += (dx / d) * step; me.y += (dy / d) * step
        me.dir = Math.abs(dx) > Math.abs(dy) ? (dx < 0 ? 'left' : 'right') : (dy < 0 ? 'up' : 'down')
        moving = true
      }
    }
    me.moving = moving
    if (!this.attract) this.unstick()

    // 目标地块：鼠标在够得着的地方就用鼠标，否则用面前那一格
    const mw = this.view.screenToWorld(input.mouseX, input.mouseY)
    const mtx = Math.floor(mw.x / TILE), mty = Math.floor(mw.y / TILE)
    const reachable = input.aimValid && Math.hypot(mtx * TILE + TILE / 2 - me.x, mty * TILE + TILE / 2 - (me.y - 6)) <= REACH
    if (reachable) this.target = { tx: mtx, ty: mty }
    else {
      const f: Record<Dir, [number, number]> = { down: [0, 1], up: [0, -1], left: [-1, 0], right: [1, 0] }
      const [fx, fy] = f[me.dir]
      this.target = { tx: Math.floor(me.x / TILE) + fx, ty: Math.floor((me.y - 4) / TILE) + fy }
    }
    if (!this.attract && !input.typing() && !this.cutscene && (input.clicked || input.hit(' '))) this.use()

    const near = this.cutscene || this.attract ? null : this.nearest()
    if (!this.attract) hud.hint(this.cutscene || hud.modalOpen() ? null : near?.text ?? null)
    this.evCheckT -= dt
    if (this.evCheckT <= 0 && !this.attract) { this.evCheckT = 0.5; this.checkEvents() }
    if (near && input.hit('e')) {
      if (near.kind === 'npc' && near.npc) this.talk(near.npc.def)
      else if (near.kind === 'board') hud.openBoard(() => net.send({ t: 'accept' }))
      else if (near.kind === 'mail') hud.openMail(id => net.send({ t: 'mailRead', id }), id => net.send({ t: 'mailTake', id }))
      else if (near.kind === 'bin') hud.openShop('bin')
      else if (near.kind === 'project') hud.openRestore((req, n) => net.send({ t: 'donate', req, n }))
      else if (near.kind === 'market' && town.market) hud.openShop('market')
      else if (near.kind === 'door' && near.lot !== undefined) net.send({ t: 'enterHome', lot: near.lot })
      else if (near.kind === 'restaurant') { net.send({ t: 'scene', to: 'restaurant' }); this.g.switchTo('restaurant') }
    }

    // 脚步声
    if (moving) {
      this.stepT -= dt
      if (this.stepT <= 0) {
        this.stepT = 0.32
        const onDock = this.island.types[Math.floor(me.y / TILE) * ISLAND_W + Math.floor(me.x / TILE)] === T.DOCK
        audio.play(onDock ? 'step_wood' : 'step_grass', 0.16)
        if (!onDock && Math.random() < 0.6) this.fx.spawn({ x: me.x + (Math.random() - 0.5) * 6, y: me.y, vx: (Math.random() - 0.5) * 16, vy: -8, life: 0.35, color: 0xc9b38a, alpha: 0.7 })
      }
    }

    // ── 实体 ──
    town.market = (state.restore?.done ?? 0) >= 3 && calendarOf(state.day).weekday === MARKET_DAY
    me.update(dt)
    const quests = state.story?.quests ?? []
    for (const n of this.npcs) {
      n.alert.visible = quests.some(q => q.obj.kind === 'deliver' && q.obj.to === n.def.id && state.me.inv.reduce((a, x) => a + (x?.id === (q.obj as { item: string }).item ? x.n : 0), 0) >= q.obj.n)
      n.hold = !!this.talkingTo && this.talkingTo.id === n.def.id && hud.dialogOpen()
      n.update(dt, time, me.x, me.y, state.hour, state.rain)
    }
    const mb = this.myMailbox()
    this.mailFlag.visible = !!mb && this.unread() > 0
    if (mb) { this.mailFlag.position.set(Math.round(mb.x * TILE), Math.round(mb.y * TILE) - 50 - (Math.floor(time * 2.5) % 2)); this.mailFlag.zIndex = mb.y * TILE + 2 }
    for (const f of this.others.values()) {
      const k = 1 - Math.exp(-dt * 12)
      f.x += (f.tx - f.x) * k; f.y += (f.ty - f.y) * k
      f.update(dt)
    }
    const wind = Math.sin(time * 0.4) * 0.5 + Math.sin(time * 1.7) * 0.2
    for (const p of this.placed) {
      if (p.sw) p.sw.update(time, wind)
      if (p.o.kind.startsWith('chicken')) {
        const t = time * 1.3 + p.phase * 7
        p.s.y = p.o.y + (Math.sin(t * 5) > 0.7 && Math.floor(t) % 3 === 0 ? 1 : 0)
        if (Math.floor(t / 4) % 2) p.s.scale.x = p.o.flip ? 1 : -1; else p.s.scale.x = p.o.flip ? -1 : 1
      }
      if (p.o.kind === 'boat') p.s.y = p.o.y + Math.round(Math.sin(time * 1.4))
    }
    for (const [key, c] of this.crops) {
      c.sw.update(time, wind)
      const plot = state.plots.get(key)
      // 成熟的作物每隔几秒整株向上蹦 1 像素，提示可以收获（整数位移，不做缩放）
      const ripe = plot?.crop && cropStage(plot.crop, plot.grown ?? 0) >= 4
      c.sw.root.y = c.baseY - (ripe && Math.sin(time * 3 + c.sw.root.x * 0.37) > 0.93 ? 1 : 0)
    }

    // ── 摄像机 ──
    const v = this.view
    const k = 1 - Math.exp(-dt * 6)
    if (this.camDirect) { v.camX = this.camDirect.x - v.viewW / 2; v.camY = this.camDirect.y - v.viewH / 2 }
    else {
      const cam = this.camTarget ?? { x: me.x, y: me.y - 20 }
      v.camX += (cam.x - v.viewW / 2 - v.camX) * k
      v.camY += (cam.y - v.viewH / 2 - v.camY) * k
    }
    this.clampCamera()

    // ── 目标框 ──
    this.cursor.clear()
    if (this.target && !this.g.switching && !this.attract) {
      const { tx, ty } = this.target
      const x = tx * TILE, y = ty * TILE, L = 5
      const ok = isTillable(this.island, tx, ty) || state.plots.has(plotKey(tx, ty))
      const c = ok ? 0xfff6d0 : 0xffffff
      this.cursor.alpha = ok ? 0.95 : 0.35
      for (const [cx, cy, sx, sy] of [[x, y, 1, 1], [x + TILE - 1, y, -1, 1], [x, y + TILE - 1, 1, -1], [x + TILE - 1, y + TILE - 1, -1, -1]]) {
        this.cursor.rect(cx + (sx < 0 ? -L + 1 : 0), cy + (sy < 0 ? 0 : 0), L, 1).fill(c)
        this.cursor.rect(cx + (sx < 0 ? 0 : 0), cy + (sy < 0 ? -L + 1 : 0), 1, L).fill(c)
      }
    }

    // ── 昼夜与天气 ──
    const hour = state.hour
    const [r, g, b, gain, sat] = sky(hour)
    const rain = state.rain ? 1 : 0
    const dim = rain ? 0.78 : 1
    v.post.set('uAmbient', [r * dim, g * dim, b * (rain ? 0.86 : 1)])
    v.post.set('uLightGain', gain + rain * 0.25)
    v.post.set('uSat', sat * (rain ? 0.8 : 1))
    v.post.set('uClouds', rain ? 0.4 : 1)
    for (const l of this.lamps) {
      const fl = 1 - l.flicker * (0.5 + 0.5 * Math.sin(time * 13 + l.x) * Math.sin(time * 7.3 + l.y))
      l.s.alpha = Math.max(l.day, Math.min(1, gain + rain * 0.3)) * fl
    }
    this.restoreLayer.update(time, gain)
    this.updateGuide(time)
    this.myLight.position.set(me.x, me.y - 14)
    this.myLight.scale.set(46 / 64)
    this.myLight.alpha = Math.max(0, gain - 0.3) * 0.8
    this.waterFilter.update(v, time, rain)
    this.groundFilter?.update(v.camX, v.camY, v.scale)
    this.updateCritters(dt, time, gain, rain)
    this.fx.update(dt, time)

    // ── 音乐与环境声 ──
    audio.playMusic(hour < 10 ? 'morning' : hour < 18 ? 'day' : hour < 22 ? 'evening' : 'none')
    audio.setAmbient('shore', 1)

    // ── 名牌 ──
    for (const f of [me, ...this.others.values()]) {
      const p = v.worldToScreen(f.x, f.y - 38)
      f.tag.position.set(Math.round(p.x), Math.round(p.y))
    }

    // ── 同步位置（10Hz，状态不变不发） ──
    this.sendT -= dt
    const sig = `${Math.round(me.x)},${Math.round(me.y)},${me.dir},${me.moving}`
    if (this.sendT <= 0 && sig !== this.lastSent && !this.attract) {
      this.sendT = 0.1
      this.lastSent = sig
      net.send({ t: 'move', x: me.x, y: me.y, dir: me.dir, moving: me.moving })
    }
    v.render(time)
  }

  // 雨丝、萤火虫、蝴蝶、落叶
  private updateCritters(dt: number, time: number, night: number, rain: number) {
    const v = this.view
    const x0 = v.camX, y0 = v.camY, w = v.viewW, h = v.viewH
    if (rain) {
      this.rainAcc += dt * 160
      while (this.rainAcc >= 1) {
        this.rainAcc--
        const x = x0 + Math.random() * (w + 60), y = y0 - 10 + Math.random() * h * 0.9
        const life = 0.25 + Math.random() * 0.3
        const p = this.fx.spawn({ x, y, vx: -40, vy: 300, life, color: 0xcfe6ff, w: 1, h: 4, alpha: 0.55, fade: false })
        p.s.rotation = 0.13
        setTimeout(() => this.fx.spawn({ x: x - 40 * life, y: y + 300 * life, vx: 0, vy: -10, life: 0.2, color: 0xdff0ff, w: 2, h: 1, alpha: 0.6 }), life * 1000)
      }
    }
    this.critterT -= dt
    if (this.critterT > 0) return
    this.critterT = 0.25
    if (night > 0.6 && !rain && Math.random() < 0.8) {
      // 萤火虫：自带一小团光
      const p = this.fx.spawn({ x: x0 + Math.random() * w, y: y0 + Math.random() * h, vx: (Math.random() - 0.5) * 10, vy: (Math.random() - 0.5) * 8, life: 4 + Math.random() * 3, color: 0xe8ff9a, wobble: 14 })
      const l = new Sprite(this.g.assets.light)
      l.anchor.set(0.5); l.tint = 0xc8ff6a; l.blendMode = 'add'; l.scale.set(14 / 64)
      this.view.lights.addChild(l)
      p.light = l
    } else if (night < 0.2 && !rain && Math.random() < 0.18) {
      const c = [0xffe066, 0xffffff, 0xff9ecb, 0x9fd6ff][Math.floor(Math.random() * 4)]
      const p = this.fx.spawn({ x: x0 + Math.random() * w, y: y0 + Math.random() * h, vx: 12 * (Math.random() < 0.5 ? -1 : 1), vy: -3, life: 6, color: c, w: 2, h: 1, wobble: 30 })
      p.s.scale.y = 1
    }
    // 树上偶尔飘下一片叶子
    if (Math.random() < 0.35) {
      const trees = this.placed.filter(p => p.s.visible && (p.o.kind.startsWith('tree') || p.o.kind.startsWith('palm')))
      const t = trees[Math.floor(Math.random() * trees.length)]
      if (t && t.o.x > x0 && t.o.x < x0 + w && t.o.y > y0 && t.o.y < y0 + h + 60) {
        this.fx.spawn({ x: t.o.x + (Math.random() - 0.5) * 30, y: t.o.y - 50 - Math.random() * 20, vx: 10, vy: 14, life: 3, color: Math.random() < 0.5 ? 0x5f9e3e : 0x86c451, w: 2, h: 1, wobble: 26 })
      }
    }
    void time
  }

  resize(w: number, h: number) {
    this.view.resize(w, h)
    this.snapCamera()
  }

  destroy() {
    for (const u of this.unsub) u()
    this.restoreLayer.destroy()
    this.fx.clear()
    this.g.app.stage.removeChild(this.view.display, this.overlay)
    this.overlay.destroy({ children: true })
    // 共享的烘焙纹理不能跟着销毁：先摘下来
    this.water.texture = Texture.EMPTY
    this.view.world.children.forEach(c => { if (c instanceof Sprite && (c.texture === baked?.bake.ground)) c.texture = Texture.EMPTY })
    this.view.destroy()
    this.g.hud.hint(null)
  }
}

// 门牌：木板 + 两根桩 + 像素字体写的名字；自己的门牌插一面小红旗
const signCache = new Map<string, Texture>()
function nameSign(text: string, mine: boolean, posts = true): Texture {
  const key = text + '|' + mine + '|' + posts
  const hit = signCache.get(key)
  if (hit) return hit
  const probe = canvas(1, 1).g
  probe.font = '12px FusionPixel'
  const tw = Math.ceil(probe.measureText(text).width)
  const bw = Math.max(22, tw + 8), bh = 15, W = bw + (mine ? 6 : 0), H = bh + (posts ? 9 : 0)
  const { c, g } = canvas(W, H)
  const r = (x: number, y: number, w: number, h: number, col: string) => { g.fillStyle = col; g.fillRect(x, y, w, h) }
  if (posts) {
    r(3, bh - 1, 3, H - bh + 1, '#4a2e1b'); r(4, bh, 1, H - bh - 1, '#8a5a34')
    r(bw - 6, bh - 1, 3, H - bh + 1, '#4a2e1b'); r(bw - 5, bh, 1, H - bh - 1, '#8a5a34')
  }
  r(0, 0, bw, bh, '#4a2e1b'); r(1, 1, bw - 2, bh - 2, '#a36d40'); r(1, 1, bw - 2, 1, '#d49c63'); r(1, bh - 2, bw - 2, 1, '#6b4428')
  // 文字：先画到临时画布，再按阈值二值化，保证是硬边像素字
  const t = canvas(bw, bh)
  t.g.font = '12px FusionPixel'; t.g.textBaseline = 'top'; t.g.fillStyle = '#2e1a0e'
  t.g.fillText(text, Math.floor((bw - tw) / 2), 2)
  const id = t.g.getImageData(0, 0, bw, bh)
  for (let i = 3; i < id.data.length; i += 4) id.data[i] = id.data[i] > 110 ? 255 : 0
  t.g.putImageData(id, 0, 0)
  g.drawImage(t.c, 0, 0)
  if (mine) {
    r(bw, 0, 1, Math.max(H, 12), '#4a2e1b')
    r(bw + 1, 1, 4, 3, '#e04a3a'); r(bw + 1, 4, 2, 1, '#e04a3a'); r(bw + 1, 1, 4, 1, '#ff7a5e')
  }
  const tex = texFrom(c)
  signCache.set(key, tex)
  return tex
}


// 招牌上的字：像素字体二值化成硬边，米白字 + 深色描边投影，贴在木牌上
function signText(text: string): Texture {
  const probe = canvas(1, 1).g
  probe.font = '12px FusionPixel'
  const tw = Math.ceil(probe.measureText(text).width)
  const W = tw + 2, H = 14
  const t = canvas(W, H)
  t.g.font = '12px FusionPixel'; t.g.textBaseline = 'top'; t.g.fillStyle = '#000'
  t.g.fillText(text, 1, 1)
  const mask = t.g.getImageData(0, 0, W, H).data
  const { c, g } = canvas(W, H)
  const on = (x: number, y: number) => x >= 0 && y >= 0 && x < W && y < H && mask[(y * W + x) * 4 + 3] > 110
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (on(x, y)) { g.fillStyle = '#f6e7c1'; g.fillRect(x, y, 1, 1) }
    else if (on(x, y - 1) || on(x - 1, y - 1)) { g.fillStyle = '#2a170c'; g.fillRect(x, y, 1, 1) }
  }
  return texFrom(c)
}
