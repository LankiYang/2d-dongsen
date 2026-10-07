// 动森式的岛（2D动森）：每人一座，场景按岛实例化（isle:<岛号>）。
// 画：高清地面（悬崖、河、沙滩）+ 水面 + 地图物件（树、果树、椰子树、石头、花、杂草、树枝）+ 机场、岛务所帐篷、码头 + 帐篷 + 地上的东西。
// 人：玩家、同岛的其他玩家、工作人员（周叔、阿海、豆豆、老潘）、动物村民。
// 序章第 0 天（原作的开局）在这里一步步推：说明会 → 搭帐篷 → 帮邻居 → 树枝 → 水果 → 篝火会起岛名 → 回帐篷睡觉。
// 第 1 天：周叔给手机、说移居费 → DIY 教室（工作台做简易钓竿）→ 钓鱼抓虫交给周叔研究 5 种 → 给馆长（龟教授）选帐篷位置。
// 第 2 天起：龟教授到岛（铲子、撑竿配方，化石点，鉴定）→ 再捐 15 件 → 第二天博物馆开馆（museum.ts 是馆里面）。
// 工具（选中按空格 / 左键）：斧头砍树敲石头、铲子敲石头、钓竿抛竿收竿、捕虫网挥网。鱼和虫在 wildlife.ts，手机、工作台、小摊在 ui.ts。
// 第 0 天的钟点是游戏定的（下午，欢迎会是晚上），睡醒以后才跟现实时间走。
import { Container, Graphics, Sprite, Texture } from 'pixi.js'
import type { Game, Scene } from '../game.ts'
import { PixelView } from '../core/pixelview.ts'
import { dirOf } from '../core/input.ts'
import { Farmer } from '../island/farmer.ts'
import { Particles } from '../fx/particles.ts'
import { Swayer, swaySplit } from '../fx/sway.ts'
import { WaterFilter } from '../island/water.ts'
import { sky } from '../island/scene.ts'
import { fireworks } from '../island/restore.ts'
import { IsleGroundFilter, FACE } from './ground.ts'
import { bakeIsle } from './bake.ts'
import type { IsleBake } from './bake.ts'
import { Actor } from './actor.ts'
import { Wildlife } from './wildlife.ts'
import { IsleUI } from './ui.ts'
import { talkCurator } from './curator.ts'
import { makeIsle, ISLE_W, ISLE_H, FRUIT_NAME, IT } from '../../shared/isle/gen.ts'
import type { Isle, IsleObj } from '../../shared/isle/gen.ts'
import { canPlaceTent, canPlaceFoot, footTiles, tentTiles, isleBlocked, MUSEUM_W, MUSEUM_H, MUSEUM_ROOM } from '../../shared/isle/rules.ts'
import { VILLAGERS, DAY0_LINES, DAILY_LINES, CURATOR, withPhrase } from '../../shared/villagers.ts'
import { NPC_INFO } from '../../shared/npcs.ts'
import type { NpcId } from '../../shared/npcs.ts'
import { TILE, ITEMS, calendarOf } from '../../shared/data.ts'
import { FISH_BY, BUG_BY } from '../../shared/critters.ts'
import { MOVE_BILL, CRITTERS_FOR_CURATOR, RECIPES, CRITTER_REWARDS, MUSEUM_GOAL } from '../../shared/diy.ts'
import { hash2 } from '../../shared/noise.ts'
import type { IslePublic, PlayerPublic, TentSpot, Dir, IsleDrop, ServerMsg } from '../../shared/protocol.ts'
import { state, selectedItem } from '../state.ts'

const SPEED = 92
const REACH = 26
// 第 0 天白天 / 晚上（钟点是游戏定的）；之后的阶段跟现实时间走
const DAY0 = ['arrive', 'tent', 'neighbors', 'branches', 'fruit']
const NIGHT0 = ['party', 'sleep']
const HELP = '<b>WASD</b> 移动 · <b>Shift</b> 蹑手蹑脚 · <b>空格/左键</b> 用工具 · <b>E</b> 互动 · <b>P</b> 手机 · <b>I</b> 背包 · <b>1-8</b> 切换 · <b>滚轮</b> 缩放'

type Near = { text: string, act: () => void, prio: number, d: number }

export class IsleScene implements Scene {
  view: PixelView
  overlay = new Container()
  entities = new Container()
  shadowLayer = new Container()
  fx = new Particles()
  ghost = new Graphics()
  me: Farmer
  others = new Map<number, Farmer>()
  actors: Actor[] = []
  isle: Isle
  private waterFilter = new WaterFilter()
  private groundFilter = new IsleGroundFilter()
  private objs = new Map<number, { root: Container, sw?: Swayer, sh?: Sprite, o: IsleObj, tex: string }>()
  private drops = new Map<number, Sprite>()
  private tents = new Map<string, Container>()
  private campfire: Sprite
  private fireLight: Sprite
  private blocked: Uint8Array
  private unsub: (() => void)[] = []
  private sendT = 0
  private lastSent = ''
  private stepT = 0
  private zoomCd = 0
  private busy = false          // 对话 / 剧情中，玩家不能动
  private party = false         // 欢迎会（晚上的灯光、篝火）
  private camTarget: { x: number, y: number } | null = null
  private lastStage = ''
  wild: Wildlife
  ui: IsleUI
  private bench: Sprite
  private toolCd = 0
  private sneak = false
  private curator: Actor
  private building: { key: string, c: Container } | null = null   // 馆长的帐篷 / 博物馆
  private digs = new Map<number, Sprite>()
  private vault: { fx: number, fy: number, tx: number, ty: number, t: number } | null = null   // 撑竿跳到一半
  private bk: IsleBake

  constructor(private g: Game, public isleId: number) {
    const { assets } = g
    const pub = state.isle!
    this.isle = makeIsle(pub.seed)
    this.blocked = isleBlocked(this.isle, pub)
    this.view = new PixelView(g.app.renderer as any, 300, 'isle', true)
    this.view.mapW = ISLE_W * TILE; this.view.mapH = ISLE_H * TILE
    const W = this.view.world

    // ── 地面、水面 ──
    const bk = this.bk = bakeIsle(this.isle)
    const water = new Sprite(bk.water)
    water.scale.set(bk.WS)
    water.filters = [this.waterFilter]
    const ground = new Sprite(bk.field)
    ground.scale.set(bk.S)
    ground.position.set(-bk.S / 2, -bk.S / 2)
    ground.filters = [this.groundFilter]
    this.entities.sortableChildren = true
    this.wild = new Wildlife(assets, g.audio, this.fx, this.isle, this.entities, pub.hemi)
    W.addChild(water, ground, this.wild.water, this.dockGraphics(), this.shadowLayer, this.entities, this.fx.layer, this.ghost)

    // ── 建筑 ──
    const { airport, plaza } = this.isle
    this.addSprite('airport', (airport.x + airport.w / 2) * TILE, (airport.y + airport.h) * TILE, true)
    this.addSprite('rs_tent', (plaza.x + plaza.w / 2) * TILE, (plaza.y + 4) * TILE, true)
    // DIY 工作台：岛务所帐篷右手边（第 1 天的 DIY 教室起能用）
    this.bench = this.addSprite('workbench', (plaza.x + plaza.w / 2) * TILE + 74, (plaza.y + 4.7) * TILE, true)
    // 水上飞机停在机场南边的海面上
    let py = airport.y + airport.h
    const px = airport.x + airport.w + 3
    while (py < ISLE_H - 2 && this.isle.types[py * ISLE_W + px] > 1) py++
    const plane = this.addSprite('seaplane', px * TILE, (py + 3) * TILE, false)
    plane.scale.x = -1
    // 篝火：欢迎会才点
    this.campfire = this.addSprite('campfire', (plaza.x + plaza.w / 2) * TILE, (plaza.y + 6.4) * TILE, false)
    this.campfire.visible = false
    this.fireLight = new Sprite(assets.light)
    this.fireLight.anchor.set(0.5); this.fireLight.tint = 0xffa04a; this.fireLight.blendMode = 'add'
    this.fireLight.position.set(this.campfire.x, this.campfire.y - 10); this.fireLight.scale.set(140 / 64); this.fireLight.visible = false
    this.view.lights.addChild(this.fireLight)

    // ── 地图物件 ──
    for (const o of this.isle.objects) this.addObj(o)

    // ── 人 ──
    for (const id of ['zhoushu', 'ahai', 'doudou', 'laopan']) {
      const a = new Actor(assets, { staff: id })
      a.name = NPC_INFO[id as NpcId].name
      this.actors.push(a)
      this.entities.addChild(a.root)
    }
    for (const v of pub.villagers) {
      const a = new Actor(assets, { villager: v.id })
      a.name = VILLAGERS[v.id].name
      this.actors.push(a)
      this.entities.addChild(a.root)
    }
    // 龟教授（馆长）：第 2 天起站在他的帐篷门口，开馆以后在馆里
    this.curator = new Actor(assets, { villager: CURATOR.id })
    this.curator.name = CURATOR.name
    this.curator.root.visible = false
    this.actors.push(this.curator)
    this.entities.addChild(this.curator.root)
    this.me = new Farmer(assets, state.me.hue, state.me.name, true)
    this.me.x = this.me.tx = g.meStart.x
    this.me.y = this.me.ty = g.meStart.y
    this.entities.addChild(this.me.root)
    this.overlay.addChild(this.me.tag)
    this.ghost.zIndex = 1e6

    g.app.stage.addChild(this.view.display, this.overlay)
    this.ui = new IsleUI(g)
    this.unsub.push(
      g.net.on('isle', m => { state.isle = m.isle; this.applyIsle() }),
      // 钓到 / 抓到：图鉴里还没有的算新登录（进度消息在这之后才到）
      g.net.on('got', m => {
        const fresh = !(m.kind === 'fish' ? state.prog?.pedia.fish : state.prog?.pedia.bugs)?.includes(m.id)
        this.ui.showCatch(m.kind, m.id, m.kept, fresh)
        g.audio.play('catch', 0.6)
      }),
      g.net.on('miles', m => this.ui.milesToast(m.name, m.miles)),
      g.net.on('prog', () => { this.ui.refresh(); this.renderTracker() }),
      g.net.on('inv', () => { this.ui.refresh(); this.renderTracker() }),
      g.net.on('players', m => this.syncPlayers(m.list)),
      g.net.on('left', m => this.removeOther(m.id)),
    )
    this.view.post.set('uMode', 0)
    g.hud.setSeaMode(false)
    document.body.classList.add('isle')
    document.getElementById('help')!.innerHTML = HELP
    this.applyIsle(true)
    this.snapCamera()
  }

  // ── 画东西 ──
  private addSprite(kind: string, x: number, y: number, shadow: boolean) {
    const tex = this.g.assets.island[kind] ?? Texture.EMPTY
    const s = new Sprite(tex)
    s.position.set(x, y); s.zIndex = y
    this.entities.addChild(s)
    if (shadow) { const sh = new Sprite(this.g.assets.shadow(tex.width * 0.8)); sh.position.set(x, y - 1); this.shadowLayer.addChild(sh) }
    return s
  }
  private objTex(o: IsleObj): string {
    const pub = state.isle!
    switch (o.kind) {
      case 'tree': return 'tree_round'
      case 'fruit_tree': { const t = pub.fruitTaken[o.id]; return t !== undefined && state.day - t < 3 ? 'tree_fruitless' : `tree_${this.isle.fruit}` }
      case 'rock': return 'boulder'
      case 'weed': return 'grass_tall'
      case 'branch': return 'drop_branch'
      default: return o.kind
    }
  }
  private addObj(o: IsleObj) {
    const texName = this.objTex(o)
    const tex = this.g.assets.island[texName]
    if (!tex) return
    const sway = o.kind === 'tree' || o.kind === 'fruit_tree' ? 0.5 : o.kind.startsWith('palm') ? 1 : o.kind === 'weed' || o.kind.startsWith('flower') ? 0.6 : 0
    const sw = sway ? new Swayer(tex, swaySplit(o.kind === 'fruit_tree' ? 'tree_mango' : o.kind === 'tree' ? 'tree_round' : o.kind === 'weed' ? 'grass_tall' : o.kind), sway) : undefined
    const root: Container = sw ? sw.root : new Sprite(tex)
    root.position.set(o.x, o.y)
    if (o.flip) root.scale.x = -1
    if (o.kind === 'weed') root.scale.set(o.flip ? -0.6 : 0.6, 0.6)
    root.zIndex = o.y
    this.entities.addChild(root)
    let sh: Sprite | undefined
    if (o.kind === 'tree' || o.kind === 'fruit_tree' || o.kind.startsWith('palm') || o.kind === 'rock') {
      sh = new Sprite(this.g.assets.shadow(Math.min(40, tex.width * (o.kind.startsWith('palm') ? 0.45 : 0.7))))
      sh.position.set(o.x + (o.kind.startsWith('palm') ? (o.flip ? 6 : -6) : 0), o.y - 1)
      this.shadowLayer.addChild(sh)
    }
    this.objs.set(o.id, { root, sw, sh, o, tex: texName })
  }
  private dropSprite(d: IsleDrop) {
    const { island, icons_hd } = this.g.assets
    if (d.item === 'weeds' || d.look === 'weed') {
      const s = new Sprite(island.grass_tall ?? Texture.EMPTY)
      s.scale.set(d.id % 2 ? -0.55 : 0.55, 0.55)
      return s
    }
    const own = island[`drop_${d.item}`]
    if (own) return new Sprite(own)
    const tex = icons_hd[ITEMS[d.item]?.icon ?? ''] ?? Texture.EMPTY
    const s = new Sprite(tex)
    s.scale.set(Math.min(1, 13 / Math.max(1, tex.width, tex.height)))
    return s
  }
  // 码头：木板栈桥，往海里伸
  private dockGraphics() {
    const d = this.isle.dock, gfx = new Graphics()
    const x0 = d.x * TILE, y0 = (d.y + 0.2) * TILE, w = d.w * TILE, h = 1.6 * TILE
    gfx.rect(x0, y0 + h, w, 8).fill({ color: 0x0a2840, alpha: 0.28 })
    for (let px = x0 + 4; px < x0 + w; px += TILE * 2) gfx.roundRect(px, y0 + h - 2, 5, 10, 1.5).fill(0x7a5236)
    gfx.roundRect(x0, y0, w, h, 2).fill(0xcf9b66)
    for (let px = x0; px < x0 + w; px += 6) gfx.rect(px, y0, 0.7, h).fill({ color: 0x9a6b45, alpha: 0.7 })
    gfx.rect(x0, y0 + h - 3, w, 3).fill(0x9a6b45)
    return gfx
  }

  // ── 岛的状态变了：帐篷、被清掉的物件、地上的东西、果树、阶段 ──
  private applyIsle(first = false) {
    const pub = state.isle!
    this.blocked = isleBlocked(this.isle, pub)
    { const by = Math.floor((this.bench.y - 4) / TILE); for (const bx of [this.bench.x - 14, this.bench.x + 14]) this.blocked[by * ISLE_W + Math.floor(bx / TILE)] = 1 }
    // 果树摘光 / 重新结果要换图：先记下来，遍历完再重建（边遍历边往 Map 里加会被再遍历到）
    const redo: IsleObj[] = []
    for (const [id, e] of this.objs) {
      const gone = pub.removed.includes(id)
      e.root.visible = !gone
      if (e.sh) e.sh.visible = !gone
      if (e.o.kind === 'fruit_tree' && !gone && this.objTex(e.o) !== e.tex) redo.push(e.o)
    }
    for (const o of redo) {
      const e = this.objs.get(o.id)!
      e.root.destroy({ children: true }); e.sh?.destroy()
      this.objs.delete(o.id)
      this.addObj(o)
    }
    // 地上的东西
    const seen = new Set<number>()
    for (const d of pub.drops) {
      seen.add(d.id)
      if (this.drops.has(d.id)) continue
      const s = this.dropSprite(d)
      s.position.set(d.x, d.y); s.zIndex = d.y
      this.entities.addChild(s)
      this.drops.set(d.id, s)
      if (!first) { s.y -= 18; const ty = d.y; const t0 = performance.now(); const fall = () => { const k = Math.min(1, (performance.now() - t0) / 260); s.y = ty - 18 * (1 - k * k); if (k < 1) requestAnimationFrame(fall) }; fall() }
    }
    for (const [id, s] of this.drops) if (!seen.has(id)) { s.destroy(); this.drops.delete(id) }
    // 帐篷
    const want = new Map<string, { spot: TentSpot, tex: string }>()
    if (pub.tent) want.set('me', { spot: pub.tent, tex: 'tent_orange' })
    for (const v of pub.villagers) if (v.tent) want.set(v.id, { spot: v.tent, tex: VILLAGERS[v.id].tent })
    for (const [k, c] of this.tents) if (!want.has(k)) { c.destroy({ children: true }); this.tents.delete(k) }
    for (const [k, w] of want) {
      if (this.tents.has(k)) continue
      const c = new Container()
      const s = new Sprite(this.g.assets.island[w.tex])
      const sh = new Sprite(this.g.assets.shadow(56))
      sh.y = -1
      c.addChild(sh, s)
      c.position.set((w.spot.tx + 0.5) * TILE, (w.spot.ty + 1) * TILE - 2)
      c.zIndex = c.y
      this.entities.addChild(c)
      this.tents.set(k, c)
    }
    // 馆长的帐篷 → 博物馆（原地盖）
    const bkey = pub.curatorTent ? `${pub.stage === 'museumOpen' ? 'museum' : 'curator_tent'}@${pub.curatorTent.tx},${pub.curatorTent.ty}` : ''
    if (this.building?.key !== bkey) {
      this.building?.c.destroy({ children: true })
      this.building = null
      if (pub.curatorTent) {
        const museum = pub.stage === 'museumOpen'
        const c = new Container()
        const sh = new Sprite(this.g.assets.shadow(museum ? 150 : 76))
        sh.y = -1
        c.addChild(sh, new Sprite(this.g.assets.island[museum ? 'museum' : 'curator_tent'] ?? Texture.EMPTY))
        c.position.set((pub.curatorTent.tx + 0.5) * TILE, (pub.curatorTent.ty + 1) * TILE - 2)
        c.zIndex = c.y
        this.entities.addChild(c)
        this.building = { key: bkey, c }
      }
    }
    // 化石点（地上的星形裂缝）
    const dseen = new Set<number>()
    for (const d of pub.digs) {
      dseen.add(d.id)
      if (this.digs.has(d.id)) continue
      const s = new Sprite(this.g.assets.island.dig_spot ?? Texture.EMPTY)
      s.position.set((d.tx + 0.5) * TILE, (d.ty + 0.8) * TILE)
      this.shadowLayer.addChild(s)
      this.digs.set(d.id, s)
    }
    for (const [id, s] of this.digs) if (!dseen.has(id)) {
      // 挖开了：留一个坑，过一会儿消失
      const hole = new Sprite(this.g.assets.island.dig_hole ?? Texture.EMPTY)
      hole.position.set(s.x, s.y + 1); this.shadowLayer.addChild(hole)
      setTimeout(() => { if (!hole.destroyed) hole.destroy() }, 4000)
      s.destroy(); this.digs.delete(id)
    }
    this.placeActors(first)
    this.lastStage = pub.stage
    this.renderTracker()
  }

  // 人站在哪：按序章阶段摆（第 0 天大家都围着广场转）
  private placeActors(first: boolean) {
    const pub = state.isle!
    const { airport, plaza } = this.isle
    const pc = { x: (plaza.x + plaza.w / 2) * TILE, y: (plaza.y + 5.6) * TILE }
    const spots: Record<string, { x: number, y: number }> = {
      zhoushu: { x: pc.x, y: pc.y },
      ahai: pub.stage === 'arrive' ? { x: (airport.x + 2) * TILE, y: (airport.y + airport.h + 1.6) * TILE } : { x: pc.x - 46, y: pc.y - 8 },
      doudou: pub.stage === 'arrive' ? { x: (airport.x + airport.w - 2) * TILE, y: (airport.y + airport.h + 1.6) * TILE } : { x: pc.x + 46, y: pc.y - 8 },
      laopan: { x: (airport.x + airport.w + 1.2) * TILE, y: (airport.y + airport.h + 0.6) * TILE },
    }
    // 龟教授：到了以后站在帐篷门口右手边（开馆后在馆里）
    const here = ['curatorHere', 'museum15', 'museumBuild'].includes(pub.stage) && pub.curatorTent
    this.curator.root.visible = !!here
    if (here) spots[CURATOR.id] = { x: (pub.curatorTent!.tx + 0.5) * TILE + 34, y: (pub.curatorTent!.ty + 1.5) * TILE }
    pub.villagers.forEach((v, i) => {
      spots[v.id] = v.tent ? { x: (v.tent.tx + 2.2) * TILE, y: (v.tent.ty + 1.4) * TILE } : { x: pc.x + (i ? 70 : -70), y: pc.y + 34 }
    })
    for (const a of this.actors) {
      const s = spots[a.id]
      if (!s) continue
      if (first) a.place(s.x, s.y)
      else if (Math.hypot(a.x - s.x, a.y - s.y) > 2 && !this.party) a.walkTo(s.x, s.y)
    }
  }

  // ── 任务追踪条 ──
  private renderTracker() {
    const pub = state.isle!
    const el = document.getElementById('tracker')!
    const fruit = FRUIT_NAME[this.isle.fruit]
    const have = (id: string) => state.me.inv.reduce((a, x) => a + (x?.id === id ? x.n : 0), 0)
    const vs = pub.villagers.map(v => VILLAGERS[v.id].name).join('、')
    const t: Record<string, [string, string]> = {
      arrive: ['欢迎来到无人岛', '去广场找周叔（岛中间的帐篷）'],
      tent: ['搭帐篷', '在口袋里选中帐篷，走到想住的地方按空格放下'],
      neighbors: ['帮邻居选地方', `${vs}还没地方住，去找他们聊聊（${pub.villagers.filter(v => v.tent).length}/2）`],
      branches: ['准备欢迎会', `捡 10 根树枝交给周叔（${Math.min(10, have('branch'))}/10）`],
      fruit: ['准备欢迎会', `摘 6 个${fruit}交给周叔：走到树下按 E 摇一摇（${Math.min(6, have(this.isle.fruit))}/6）`],
      party: ['欢迎会', '到广场找周叔'],
      sleep: ['好好睡一觉', '回自己的帐篷，用折叠床睡觉'],
      day1: ['新的一天', '去广场找周叔'],
      diy: ['DIY 教室', `凑 5 根树枝，到岛务所帐篷旁的工作台做简易钓竿（${Math.min(5, have('branch'))}/5）`],
      critters: ['研究岛上的生物', `钓鱼、抓虫，拿 ${CRITTERS_FOR_CURATOR} 种不同的给周叔看（${state.prog?.given.length ?? 0}/${CRITTERS_FOR_CURATOR}）`],
      curator: ['馆长的帐篷', '选中「龟教授的帐篷」，找块宽敞的地方放下（博物馆以后就盖在这里）'],
      curatorWait: ['等客人', '周叔的老朋友龟教授明天到'],
      curatorHere: ['龟教授来了', '去他的帐篷打个招呼'],
      museum15: ['筹建博物馆', `再捐 ${MUSEUM_GOAL} 件新展品给龟教授（${Math.min(MUSEUM_GOAL, pub.museum.donated.length - pub.museum.base)}/${MUSEUM_GOAL}）：鱼、虫、鉴定过的化石`],
      museumBuild: ['筹建博物馆', '博物馆明天开馆'],
      museumOpen: ['博物馆开馆了', '进去逛逛吧；新抓到的鱼虫、挖到的化石可以接着捐'],
    }
    const [title, text] = t[pub.stage] ?? ['', '']
    const p = state.prog
    const bill = p?.phone && !p.bill.paid ? `<div class="tsub">移居费：${MOVE_BILL.miles.toLocaleString()} 里程（现在 ${p.miles.toLocaleString()}）或 ${MOVE_BILL.bells.toLocaleString()} 铃钱</div>` : ''
    el.innerHTML = `<div class="tq">${title}</div><div>${text}</div>${bill}`
    el.classList.remove('hidden')
  }

  // ── 碰撞 ──
  // 悬崖层（双线性取样烘焙好的网格）
  private cliffAt(px: number, py: number) {
    const { cliff, gw, gh, S } = this.bk
    const fx = Math.max(0, Math.min(gw - 1.001, px / S)), fy = Math.max(0, Math.min(gh - 1.001, py / S))
    const x0 = Math.floor(fx), y0 = Math.floor(fy), tx = fx - x0, ty = fy - y0, i = y0 * gw + x0
    return (cliff[i] * (1 - tx) + cliff[i + 1] * tx) * (1 - ty) + (cliff[i + gw] * (1 - tx) + cliff[i + gw + 1] * tx) * ty
  }
  private blockedAt(px: number, py: number) {
    const tx = Math.floor(px / TILE), ty = Math.floor(py / TILE)
    if (tx < 0 || ty < 0 || tx >= ISLE_W || ty >= ISLE_H) return true
    const i = ty * ISLE_W + tx
    // 悬崖按画出来的边算：脚踩在崖面上（往上 FACE 像素是高处）或者在高处都不能走（还没有梯子）
    const onCliff = this.cliffAt(px, py - FACE + 3) >= 0.5
    if (this.isle.level[i] > 0 && this.isle.types[i] === IT.GRASS) return onCliff
    return this.blocked[i] === 1 || onCliff
  }
  private free(x: number, y: number) {
    return !(this.blockedAt(x - 5, y - 4) || this.blockedAt(x + 5, y - 4) || this.blockedAt(x - 5, y) || this.blockedAt(x + 5, y))
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
    v.camX = Math.max(0, Math.min(ISLE_W * TILE - v.viewW, v.camX))
    v.camY = Math.max(0, Math.min(ISLE_H * TILE - v.viewH, v.camY))
  }

  // ── 其他玩家 ──
  private syncPlayers(list: PlayerPublic[]) {
    const seen = new Set<number>()
    for (const p of list) {
      if (p.scene !== `isle:${this.isleId}` || p.id === state.me.id) continue
      seen.add(p.id)
      let f = this.others.get(p.id)
      if (!f) {
        f = new Farmer(this.g.assets, p.hue, p.name, false)
        f.x = f.tx = p.x; f.y = f.ty = p.y
        this.entities.addChild(f.root); this.overlay.addChild(f.tag)
        this.others.set(p.id, f)
      }
      f.tx = p.x; f.ty = p.y; f.dir = p.dir; f.moving = p.moving
    }
    for (const id of [...this.others.keys()]) if (!seen.has(id)) this.removeOther(id)
  }
  private removeOther(id: number) {
    const f = this.others.get(id)
    if (!f) return
    f.destroy(); this.others.delete(id)
  }

  // ── 说话 ──
  private staffSay(id: NpcId, text: string) {
    const i = NPC_INFO[id]
    return this.g.hud.say({ name: i.name, title: i.title, face: id, voice: i.voice, text })
  }
  private villagerSay(vid: string, text: string) {
    const v = VILLAGERS[vid]
    return this.g.hud.say({ name: v.name, title: `${v.species} · ${({ lazy: '悠闲', jock: '运动', cranky: '暴躁', smug: '自恋', normal: '普通', peppy: '元气', snooty: '成熟', sisterly: '大姐姐' } as const)[v.personality]}`, face: `v:${vid}`, voice: v.voice, text: withPhrase(v, text) })
  }
  private async run(f: () => Promise<void>) {
    if (this.busy) return
    this.busy = true
    this.g.hud.hint(null)
    try { await f() } finally { this.busy = false; this.g.hud.closeDialog() }
  }
  private have(id: string) { return state.me.inv.reduce((a, x) => a + (x?.id === id ? x.n : 0), 0) }

  private talkStaff(a: Actor) {
    const pub = state.isle!
    const fruit = FRUIT_NAME[this.isle.fruit]
    const vs = pub.villagers.map(v => VILLAGERS[v.id].name)
    const id = a.id as NpcId
    this.run(async () => {
      a.faceTo(this.me.x, this.me.y)
      if (id === 'zhoushu') {
        if (pub.stage === 'arrive') await this.orientation()
        else if (pub.stage === 'tent') await this.staffSay('zhoushu', '帐篷在你口袋里。选中它，走到喜欢的地方按空格就能放下。离河边、悬崖远一点会比较方便哦。')
        else if (pub.stage === 'neighbors') await this.staffSay('zhoushu', `${vs.join('和')}也还没找到落脚的地方，去帮帮他们吧！`)
        else if (pub.stage === 'branches') {
          if (this.have('branch') >= 10) {
            await this.staffSay('zhoushu', '^哦！树枝都捡来啦，有这些就够生火了！')
            this.g.net.send({ t: 'prologue', step: 'branches' })
            await this.staffSay('zhoushu', `还缺点吃的……岛上的${fruit}树结果了，能帮我摘 6 个${fruit}来吗？站在树下按 E 摇一摇，果子就掉下来了。`)
          } else await this.staffSay('zhoushu', '大家都辛苦了！今晚给大家开个欢迎会。不过篝火得有柴火……能帮我捡 10 根树枝来吗？树底下常常能捡到。')
        } else if (pub.stage === 'fruit') {
          if (this.have(this.isle.fruit) >= 6) {
            await this.staffSay('zhoushu', `^${fruit}也够了！谢谢你，欢迎会这就开始！`)
            this.g.net.send({ t: 'prologue', step: 'fruit' })
            await this.welcomeParty()
          } else await this.staffSay('zhoushu', `再摘 6 个${fruit}来就够了。${fruit}树就在广场附近。`)
        } else if (pub.stage === 'party') await this.welcomeParty()
        else if (pub.stage === 'sleep') await this.staffSay('zhoushu', '今天辛苦啦，早点回帐篷睡吧。折叠床在你口袋里，进帐篷铺开就能睡。')
        else await this.zhoushuDay()
      } else if (id === 'ahai') {
        if (DAY0.includes(pub.stage) || NIGHT0.includes(pub.stage)) await this.staffSay('ahai', pub.stage === 'arrive' ? '欢迎来到无人岛！大家在广场集合，周叔要给大家讲讲岛上的事。' : '^明天起岛务所帐篷里有小摊，缺什么、要卖什么都来找我。')
        else {
          const i = await this.staffAsk('ahai', '^欢迎光临！要买点什么，还是卖点什么？岛上捡的、钓的、抓的，我都收。', ['看看', '算了'], 1)
          if (i === 0) { this.g.hud.closeDialog(); this.ui.openShop() }
        }
      } else if (id === 'doudou') {
        if (pub.stage === 'arrive') await this.staffSay('doudou', '^我们到啦！快去广场，周叔在等大家！')
        else if (DAY0.includes(pub.stage) || NIGHT0.includes(pub.stage)) await this.staffSay('doudou', '^我在帮阿海叔叔看摊！')
        else await this.staffSay('doudou', ['^钓鱼的时候，要等浮漂「噗通」一下整个沉下去再收竿哦！只是轻轻点一下的话，那是鱼在试探。', '^手机里的「岛务里程」，做什么都能攒！拔草、捡贝壳、钓鱼……我已经攒了好多啦。', '^抓虫的时候按住 Shift 慢慢走过去，虫子就不会被吓跑啦。'][Math.floor(hash2(state.day, 3, 1) * 3)])
      }
      else if (id === 'laopan') await this.staffSay('laopan', '我开飞机。等岛上的机场开起来，带你去别的岛转转。')
    })
  }
  private staffAsk(id: NpcId, text: string, options: string[], cancel: number) {
    const i = NPC_INFO[id]
    return this.g.hud.ask({ name: i.name, title: i.title, face: id, voice: i.voice, text }, options, cancel)
  }
  // 等服务端回一条消息（最多等 ms 毫秒）
  private waitMsg<T extends ServerMsg['t']>(t: T, ms = 1500) {
    return new Promise<void>(res => { const off = this.g.net.on(t, () => { off(); clearTimeout(timer); res() }); const timer = setTimeout(() => { off(); res() }, ms) })
  }

  // ── 周叔：第 1 天起 ──
  private async zhoushuDay() {
    const pub = state.isle!
    if (pub.stage === 'day1') { await this.phoneTalk(); return }
    const opts: string[] = [], acts: (() => Promise<void>)[] = []
    if (pub.stage === 'diy') { opts.push('东西怎么做？'); acts.push(() => this.diyTalk()) }
    if (pub.stage === 'critters') { opts.push('给你看看生物'); acts.push(() => this.giveTalk()) }
    if (pub.stage === 'curator') {
      if (!this.have('kit_curator')) { opts.push('帐篷呢？'); acts.push(async () => { this.g.net.send({ t: 'prologue', step: 'curatorKit' }); await this.waitMsg('inv'); if (this.have('kit_curator')) await this.staffSay('zhoushu', '^喏，龟教授的帐篷。找块宽敞的地方放下吧。') }) }
      else { opts.push('帐篷放哪儿好？'); acts.push(() => this.staffSay('zhoushu', '龟教授打算以后在帐篷那儿盖博物馆，所以要挑一块宽敞的地方，周围别有树和石头挡着。')) }
    }
    if (pub.stage === 'curatorWait') { opts.push('你的朋友什么时候来？'); acts.push(() => this.staffSay('zhoushu', '^明天就到！他对鱼、虫子、化石都特别有研究。')) }
    if (state.prog?.phone && !state.prog.bill.paid) { opts.push('付移居费'); acts.push(() => this.billTalk()) }
    opts.push('没事')
    const i = await this.staffAsk('zhoushu', pub.stage === 'critters' && !state.prog?.given.length
      ? '^做得真好！这么快就上手了。……对了，我一直想研究岛上都有些什么生物。钓到的鱼、抓到的虫，能拿来给我看看吗？'
      : '^嗯？有什么事吗？', opts, opts.length - 1)
    if (acts[i]) await acts[i]()
  }
  // 第 1 天早上：手机、里程、移居费、DIY 教室
  private async phoneTalk() {
    const pub = state.isle!
    await this.staffSay('zhoushu', `^早上好！昨晚睡得还好吗？${pub.name ? pub.name + '岛' : '岛上'}的第一个早晨，空气真新鲜！`)
    await this.staffSay('zhoushu', '对了，这个给你。这是岛务手机，地图、图鉴、DIY 配方都在里面，在岛上生活少不了它。')
    this.g.net.send({ t: 'prologue', step: 'phone' })
    await this.waitMsg('prog')
    this.g.hud.toast('拿到了「岛务手机」！按 P 打开')
    await this.staffSay('zhoushu', '^在岛上做了什么事，手机都会记下来，攒成「岛务里程」。你看，搬到岛上来这件事本身就算一件！')
    await this.staffSay('zhoushu', `……还有件事得说清楚。这次移居的机票、帐篷这些，一共是 ${MOVE_BILL.bells.toLocaleString()} 铃钱。`)
    await this.staffSay('zhoushu', `^不用急！也可以用 ${MOVE_BILL.miles.toLocaleString()} 岛务里程来付，什么时候付都行。`)
    this.camTarget = { x: this.bench.x, y: this.bench.y - 10 }
    await this.staffSay('zhoushu', '岛上现在什么工具都没有……我来教你做东西吧！这是工作台，用 5 根树枝就能做一根简易钓竿。')
    await this.staffSay('zhoushu', '^树枝去树底下捡，或者摇摇树，凑够了就到工作台按 E。')
    this.camTarget = null
  }
  private async diyTalk() {
    if (this.have('branch') >= 5) await this.staffSay('zhoushu', '^树枝够了！到工作台按 E，选「简易钓竿」就能做。')
    else await this.staffSay('zhoushu', `去树底下捡树枝，或者摇摇树，凑够 5 根就能做简易钓竿了。（现在 ${this.have('branch')} 根）`)
  }
  // 拿生物给周叔看：一次一只，看完接着问
  private async giveTalk() {
    for (;;) {
      const given = state.prog?.given ?? []
      const seen = new Set<string>()
      const list: { slot: number, id: string, name: string }[] = []
      state.me.inv.forEach((x, i) => {
        if (!x || !ITEMS[x.id]?.critter || given.includes(x.id) || seen.has(x.id)) return
        seen.add(x.id); list.push({ slot: i, id: x.id, name: ITEMS[x.id].name })
      })
      if (!list.length) {
        await this.staffSay('zhoushu', given.length
          ? `还差 ${CRITTERS_FOR_CURATOR - given.length} 种。钓过的、我看过的就不用再拿来啦。`
          : '河里、海里能看到鱼影，草丛和花上有虫子。拿着钓竿或捕虫网按空格就行！')
        return
      }
      const opts = [...list.slice(0, 5).map(x => x.name), '算了']
      const i = await this.staffAsk('zhoushu', '哪一只给我看看？', opts, opts.length - 1)
      const pick = list[i]
      if (!pick) return
      this.g.net.send({ t: 'give', slot: pick.slot })
      await this.waitMsg('prog')
      const n = state.prog?.given.length ?? 0
      const reward = CRITTER_REWARDS.find(([k]) => k === n)
      if (n >= CRITTERS_FOR_CURATOR) {
        await this.staffSay('zhoushu', `^${pick.name}！……好了，这下岛上的生物我心里大概有数了！`)
        await this.staffSay('zhoushu', '我有个老朋友，叫龟教授，对这些东西特别着迷。我这就写信请他来岛上看看，明天应该就到了！')
        await this.staffSay('zhoushu', '这是给他准备的帐篷。他以后想在那儿盖博物馆，你帮他挑块宽敞的地方放下吧。')
        if (this.have('kit_curator')) this.g.hud.toast('拿到了「龟教授的帐篷」')
        return
      }
      const react = [`^哦，是${pick.name}！真是稀奇……`, `^${pick.name}啊！原来岛上也有这个……`, `^这就是${pick.name}吗！我记下了……`][n % 3]
      await this.staffSay('zhoushu', `${react}还差 ${CRITTERS_FOR_CURATOR - n} 种。`)
      if (reward) {
        await this.staffSay('zhoushu', `作为谢礼，教你「${RECIPES[reward[1]].name}」的做法吧！`)
        this.g.hud.toast(`学会了「${RECIPES[reward[1]].name}」的做法`)
      }
    }
  }
  private async billTalk() {
    const p = state.prog!
    const opts = [`用里程付（${MOVE_BILL.miles.toLocaleString()}）`, `用铃钱付（${MOVE_BILL.bells.toLocaleString()}）`, '再等等']
    const i = await this.staffAsk('zhoushu', `移居费是 ${MOVE_BILL.bells.toLocaleString()} 铃钱，或者 ${MOVE_BILL.miles.toLocaleString()} 里程。现在付吗？`, opts, 2)
    if (i === 0 && p.miles < MOVE_BILL.miles) { await this.staffSay('zhoushu', `里程还差 ${(MOVE_BILL.miles - p.miles).toLocaleString()}……拔拔草、捡捡贝壳、钓钓鱼，很快就攒够了。`); return }
    if (i === 1 && state.me.coins < MOVE_BILL.bells) { await this.staffSay('zhoushu', '铃钱好像还不够……不急不急，用里程付也行的。'); return }
    if (i > 1) return
    this.g.net.send({ t: 'payBill', with: i === 0 ? 'miles' : 'bells' })
    await this.waitMsg('prog')
    if (state.prog?.bill.paid) await this.staffSay('zhoushu', '^付清啦！辛苦了。以后想换个更好的住处，也可以来找我商量。')
  }

  private talkVillager(a: Actor) {
    const pub = state.isle!
    const v = pub.villagers.find(x => x.id === a.id)
    if (!v) return
    const lines = DAY0_LINES[VILLAGERS[v.id].personality]
    this.run(async () => {
      a.faceTo(this.me.x, this.me.y)
      if (pub.stage === 'arrive') await this.villagerSay(v.id, lines.hello)
      else if (pub.stage === 'tent') await this.villagerSay(v.id, '你先把自己的帐篷搭好吧')
      else if (pub.stage === 'neighbors' && !v.tent) {
        if (this.have(`kit_vtent_${v.id}`)) { await this.villagerSay(v.id, '帐篷就交给你了'); return }
        await this.villagerSay(v.id, lines.ask)
        this.g.net.send({ t: 'prologue', step: `vkit:${v.id}` })
        this.g.hud.toast(`拿到了「${VILLAGERS[v.id].name}的帐篷」`)
      } else if (v.tent && (pub.stage === 'neighbors' || pub.stage === 'branches' || pub.stage === 'fruit')) await this.villagerSay(v.id, lines.done)
      else if (pub.stage === 'party' || pub.stage === 'sleep') await this.villagerSay(v.id, lines.party)
      else if (DAY0.includes(pub.stage)) await this.villagerSay(v.id, lines.hello)
      else { const d = DAILY_LINES[VILLAGERS[v.id].personality]; await this.villagerSay(v.id, d[Math.floor(hash2(state.day, v.id.length, 5) * d.length)]) }
    })
  }

  // 广场说明会
  private async orientation() {
    const { plaza } = this.isle
    this.camTarget = { x: (plaza.x + plaza.w / 2) * TILE, y: (plaza.y + 5) * TILE }
    await this.staffSay('zhoushu', '大家好！欢迎来到这座无人岛！我是这次移居计划的负责人，叫我周叔就好。')
    await this.staffSay('zhoushu', '岛上现在什么都没有，不过只要大家一起动手，一定会热闹起来的。从今天起，这里就是大家的家了！')
    await this.staffSay('zhoushu', '^我和阿海、豆豆就在这顶岛务所帐篷里，有什么事尽管来找我们。')
    await this.staffSay('doudou', '^这是你的帐篷！先挑个喜欢的地方搭起来吧！')
    this.g.net.send({ t: 'prologue', step: 'orientation' })
    this.g.hud.toast('拿到了「帐篷」')
    this.camTarget = null
  }

  // 欢迎会：晚上，篝火，大家围成一圈，给岛起名
  private async welcomeParty() {
    const { hud } = this.g
    const pub = state.isle!
    const { plaza } = this.isle
    const fx = this.campfire.x, fy = this.campfire.y
    hud.fade(true)
    await new Promise(r => setTimeout(r, 650))
    this.party = true
    this.campfire.visible = true; this.fireLight.visible = true
    const ring: Record<string, [number, number]> = { zhoushu: [0, -30], ahai: [-44, -14], doudou: [44, -14], laopan: [-56, 14] }
    pub.villagers.forEach((v, i) => { ring[v.id] = [i ? 52 : -30, i ? 18 : 30] })
    for (const a of this.actors) { const r = ring[a.id]; if (r) { a.place(fx + r[0], fy + r[1]); a.faceTo(fx, fy) } }
    this.me.x = this.me.tx = fx + 24; this.me.y = this.me.ty = fy + 32; this.me.dir = 'up'
    this.camTarget = { x: fx, y: fy - 10 }
    this.snapCamera()
    hud.fade(false)
    await new Promise(r => setTimeout(r, 500))
    await this.staffSay('zhoushu', '^大家都到齐了！今天辛苦啦，欢迎来到我们的新家！')
    for (const v of pub.villagers) await this.villagerSay(v.id, DAY0_LINES[VILLAGERS[v.id].personality].party)
    await this.staffSay('zhoushu', `对了，这座岛还没有名字呢。${state.me.name}，你来给它起个名字吧！`)
    let name = ''
    while (!name) name = (await hud.prompt('给这座岛起个名字（以后改不了）', '', 8)).replace(/[\s<>]/g, '').replace(/岛$/, '')
    this.g.net.send({ t: 'prologue', step: 'name', name })
    fireworks(this.fx, this.view.lights, this.g.assets.light, this.g.audio, fx, fy - 70)
    await this.staffSay('zhoushu', `^「${name}岛」！好名字！从今天起，这里就是${name}岛了！`)
    await this.staffSay('zhoushu', '今天就到这儿，大家早点休息吧。这张折叠床送你，铺在帐篷里就能睡了。')
    hud.toast('拿到了「折叠床」')
    this.camTarget = null
    void plaza
  }

  // ── 互动：找最近的能做的事 ──
  private nearest(): Near | null {
    const me = this.me, pub = state.isle!
    const f: Record<Dir, [number, number]> = { down: [0, 1], up: [0, -1], left: [-1, 0], right: [1, 0] }
    const [fdx, fdy] = f[me.dir]
    const hx = me.x + fdx * 10, hy = me.y - 4 + fdy * 10     // 手边
    const out: Near[] = []
    const consider = (x: number, y: number, r: number, prio: number, text: string, act: () => void) => {
      const d = Math.hypot(x - hx, y - hy)
      if (d <= r) out.push({ text, act, prio, d })
    }
    for (const d of pub.drops) consider(d.x, d.y - 4, 18, 3, d.item === 'weeds' ? '<b>E</b> 拔草' : `<b>E</b> 捡起${ITEMS[d.item]?.name ?? d.item}`, () => this.g.net.send({ t: 'pickup', drop: d.id }))
    for (const [id, e] of this.objs) {
      if (pub.removed.includes(id) || !e.root.visible) continue
      const o = e.o
      if (o.kind === 'branch') consider(o.x, o.y - 4, 18, 3, '<b>E</b> 捡起树枝', () => this.g.net.send({ t: 'pickup', obj: o.id }))
      else if (o.kind === 'weed') consider(o.x, o.y - 4, 18, 3, '<b>E</b> 拔草', () => this.g.net.send({ t: 'pickup', obj: o.id }))
      else if (o.kind === 'tree' || o.kind === 'fruit_tree') consider(o.x, o.y - 6, REACH, 1, '<b>E</b> 摇树', () => this.shake(o))
    }
    if (state.prog?.recipes.length) consider(this.bench.x, this.bench.y - 6, REACH + 8, 2, '<b>E</b> 用工作台', () => this.ui.openCraft())
    for (const a of this.actors) if (a.root.visible) consider(a.x, a.y - 8, REACH + 4, 2, `<b>E</b> 和${a.name}说话`, () => a === this.curator ? this.run(() => talkCurator(this.g)) : 'staff' in a.kind ? this.talkStaff(a) : this.talkVillager(a))
    if (pub.stage === 'museumOpen' && pub.curatorTent) consider((pub.curatorTent.tx + 0.5) * TILE, (pub.curatorTent.ty + 1) * TILE, 24, 2, '<b>E</b> 进博物馆', () => this.enterMuseum())
    if (ITEMS[selectedItem()?.id ?? '']?.tool === 'shovel') { const d = this.digInFront(); if (d) consider(hx, hy, 99, 4, '<b>空格</b> 挖化石', () => this.useTool()) }
    if (pub.tent) {
      const dx = (pub.tent.tx + 0.5) * TILE, dy = (pub.tent.ty + 1) * TILE
      consider(dx, dy, 22, 2, '<b>E</b> 进帐篷', () => this.enterTent())
    }
    if (!out.length) return null
    out.sort((a, b) => b.prio - a.prio || a.d - b.d)
    return out[0]
  }
  private shake(o: IsleObj) {
    const e = this.objs.get(o.id)
    this.g.audio.play('till', 0.35, 1.4)
    // 整棵树晃几下
    if (e) { const t0 = performance.now(); const x0 = o.x; const w = () => { const k = (performance.now() - t0) / 380; e.root.x = x0 + Math.sin(k * 30) * 2 * (1 - k); if (k < 1) requestAnimationFrame(w); else e.root.x = x0 }; w() }
    for (let i = 0; i < 8; i++) this.fx.spawn({ x: o.x + (Math.random() - 0.5) * 30, y: o.y - 40 - Math.random() * 14, vx: (Math.random() - 0.5) * 30, vy: 10 + Math.random() * 20, ay: 60, life: 0.8, color: [0x7cc45c, 0x9bd86e, 0x5aa84a][i % 3] })
    this.g.net.send({ t: 'shake', obj: o.id })
  }
  // 面前够得着的东西（树、石头）
  private inFront(kinds: (k: string) => boolean): IsleObj | null {
    const me = this.me, pub = state.isle!
    const f: Record<Dir, [number, number]> = { down: [0, 1], up: [0, -1], left: [-1, 0], right: [1, 0] }
    const [fdx, fdy] = f[me.dir]
    const hx = me.x + fdx * 12, hy = me.y - 4 + fdy * 12
    let best: IsleObj | null = null, bd = REACH
    for (const [id, e] of this.objs) {
      if (pub.removed.includes(id) || !kinds(e.o.kind)) continue
      const d = Math.hypot(e.o.x - hx, e.o.y - 6 - hy)
      if (d < bd) { bd = d; best = e.o }
    }
    return best
  }
  private wobble(o: IsleObj, amp = 2) {
    const e = this.objs.get(o.id)
    if (!e) return
    const t0 = performance.now(), x0 = o.x
    const w = () => { const k = (performance.now() - t0) / 300; e.root.x = x0 + Math.sin(k * 30) * amp * (1 - k); if (k < 1) requestAnimationFrame(w); else e.root.x = x0 }
    w()
  }
  // 选中工具按空格 / 左键：返回 true 表示这一下被工具用掉了
  private useTool(): boolean {
    const it = selectedItem()
    const kind = it ? ITEMS[it.id]?.tool : undefined
    if (!it || !kind || !['rod', 'net', 'axe', 'shovel', 'can', 'pole'].includes(kind)) return false
    const { net, audio, assets, hud } = this.g
    const me = this.me
    const slot = state.me.selected
    if (kind === 'rod') {
      if (this.wild.fishing()) {
        const got = this.wild.reel()
        if (got) net.send({ t: 'catch', kind: 'fish', id: got.id, slot })
      } else if (!this.wild.cast(me, me.dir)) hud.toast('要面朝水面抛竿')
      return true
    }
    if (kind === 'pole') { if (!this.vault) this.tryVault(); return true }
    if (this.toolCd > 0) return true
    this.toolCd = 0.42
    me.act(it.id, assets.icons_hd[ITEMS[it.id].icon])
    // 铲子：面前有化石点就挖
    const dig = kind === 'shovel' ? this.digInFront() : null
    if (dig) {
      setTimeout(() => {
        audio.play('till', 0.6, 0.9)
        const x = (dig.tx + 0.5) * TILE, y = (dig.ty + 0.8) * TILE
        for (let i = 0; i < 10; i++) this.fx.spawn({ x: x + (Math.random() - 0.5) * 10, y: y - 2, vx: (Math.random() - 0.5) * 70, vy: -40 - Math.random() * 40, ay: 200, life: 0.5, color: [0x9a6a44, 0xb98458, 0x7a5236][i % 3], w: 2, h: 2 })
        net.send({ t: 'dig', tx: dig.tx, ty: dig.ty, slot })
      }, 140)
      return true
    }
    if (kind === 'net') {
      const b = this.wild.swingNet(me, me.dir)
      if (b) net.send({ t: 'catch', kind: 'bug', id: b.id, slot })
    } else if (kind === 'axe' || kind === 'shovel') {
      const tree = kind === 'axe' ? this.inFront(k => k === 'tree' || k === 'fruit_tree' || k.startsWith('palm')) : null
      const rock = tree ? null : this.inFront(k => k === 'rock')
      const o = tree ?? rock
      setTimeout(() => {
        if (!o) { audio.play('whoosh', 0.25, 1.4); return }
        if (tree) {
          audio.play('chop', 0.6, 0.9 + Math.random() * 0.2)
          this.wobble(o, 1.5)
          for (let i = 0; i < 6; i++) this.fx.spawn({ x: o.x + (me.x < o.x ? -6 : 6), y: o.y - 10, vx: (Math.random() - 0.5) * 60, vy: -30 - Math.random() * 30, ay: 160, life: 0.5, color: [0xc89a62, 0xa8794a][i % 2], w: 2, h: 2 })
          net.send({ t: 'tool', kind: 'chop', obj: o.id, slot })
        } else {
          audio.play('shoot', 0.55, 0.8 + Math.random() * 0.2)
          this.wobble(o, 1)
          for (let i = 0; i < 5; i++) this.fx.spawn({ x: o.x + (Math.random() - 0.5) * 14, y: o.y - 12, vx: (Math.random() - 0.5) * 70, vy: -40 - Math.random() * 30, ay: 180, life: 0.4, color: 0xfff2c0, w: 1.5, h: 1.5 })
          net.send({ t: 'tool', kind: 'rock', obj: o.id, slot })
        }
      }, 140)
    } else if (kind === 'can') {
      audio.play('water', 0.4)
      const f: Record<Dir, [number, number]> = { down: [0, 1], up: [0, -1], left: [-1, 0], right: [1, 0] }
      const [dx, dy] = f[me.dir]
      for (let i = 0; i < 10; i++) this.fx.spawn({ x: me.x + dx * 14, y: me.y - 14 + dy * 10, vx: dx * 30 + (Math.random() - 0.5) * 16, vy: 10 + Math.random() * 20, ay: 120, life: 0.5, color: 0x9fdcff, w: 1.5, h: 1.5 })
    }
    return true
  }
  private enterMuseum() {
    if (this.g.switching) return
    const to = `museum:${this.isleId}` as const
    this.g.net.send({ t: 'scene', to })
    this.g.meStart = { x: MUSEUM_ROOM.w * TILE / 2, y: MUSEUM_ROOM.h * TILE - 20 }
    this.g.switchTo(to)
  }
  // 面前的化石点
  private digInFront() {
    const me = this.me
    const f: Record<Dir, [number, number]> = { down: [0, 1], up: [0, -1], left: [-1, 0], right: [1, 0] }
    const [fdx, fdy] = f[me.dir]
    const hx = me.x + fdx * 14, hy = me.y - 2 + fdy * 14
    return state.isle!.digs.find(d => Math.hypot((d.tx + 0.5) * TILE - hx, (d.ty + 0.6) * TILE - hy) < 16) ?? null
  }
  // 撑竿：面前是小河（或者池塘窄的地方），对岸 4 格以内有落脚的地方就跳过去
  private tryVault() {
    const me = this.me
    const f: Record<Dir, [number, number]> = { down: [0, 1], up: [0, -1], left: [-1, 0], right: [1, 0] }
    const [dx, dy] = f[me.dir]
    const typeAt = (x: number, y: number) => this.isle.types[Math.floor(y / TILE) * ISLE_W + Math.floor(x / TILE)]
    let start = -1, end = -1
    for (let k = 4; k <= 140; k += 3) {
      const t = typeAt(me.x + dx * k, me.y - 2 + dy * k)
      const water = t === IT.RIVER || t === IT.POND
      if (start < 0) { if (water) start = k; else if (k > 22) break }
      else if (!water) { end = k; break }
    }
    if (start < 0) { this.g.hud.toast('对着小河用撑竿，就能跳过去'); return }
    if (end < 0 || end - start > 4 * TILE) { this.g.hud.toast('河太宽了，跳不过去'); return }
    const tx = me.x + dx * (end + 12), ty = me.y + dy * (end + 12)
    if (!this.free(tx, ty)) { this.g.hud.toast('对岸没地方落脚'); return }
    this.vault = { fx: me.x, fy: me.y, tx, ty, t: 0 }
    this.g.audio.play('whoosh', 0.45, 0.9)
  }
  private enterTent() {
    if (this.g.switching) return
    this.g.net.send({ t: 'scene', to: `tent:${state.me.id}` })
    this.g.meStart = { x: 3 * TILE, y: 5 * TILE - 6 }
    this.g.switchTo(`tent:${state.me.id}`)
  }

  // ── 放帐篷：选中帐篷包时在面前显示一个预览，绿色能放、红色不能 ──
  private kitSpot(w = 3, h = 2): TentSpot {
    const me = this.me
    const half = Math.floor(w / 2)
    const f: Record<Dir, [number, number]> = { down: [0, h + 1], up: [0, -2], left: [-(half + 2), 0], right: [half + 2, 0] }
    const [dx, dy] = f[me.dir]
    return { tx: Math.floor(me.x / TILE) + dx, ty: Math.floor((me.y - 4) / TILE) + dy }
  }
  private drawGhost() {
    const it = selectedItem()
    this.ghost.clear()
    if (!it || !(it.id === 'kit_tent' || it.id.startsWith('kit_vtent_') || it.id === 'kit_curator') || this.busy) return null
    const big = it.id === 'kit_curator'
    const spot = big ? this.kitSpot(MUSEUM_W, MUSEUM_H) : this.kitSpot()
    const why = big ? canPlaceFoot(this.isle, state.isle!, spot, MUSEUM_W, MUSEUM_H) : canPlaceTent(this.isle, state.isle!, spot)
    const c = why ? 0xff6b5a : 0x8cf07a
    for (const [x, y] of big ? footTiles(spot, MUSEUM_W, MUSEUM_H) : tentTiles(spot)) this.ghost.roundRect(x * TILE + 1, y * TILE + 1, TILE - 2, TILE - 2, 4).fill({ color: c, alpha: 0.32 }).stroke({ color: c, alpha: 0.8, width: 1 })
    this.ghost.roundRect(spot.tx * TILE + 4, (spot.ty + 1) * TILE + 4, TILE - 8, TILE - 8, 3).stroke({ color: 0xffffff, alpha: 0.6, width: 1 })
    return { spot, why, big }
  }

  update(dt: number, time: number) {
    const { input, hud, net, audio } = this.g
    const me = this.me
    const pub = state.isle!
    if (!input.typing() && !this.busy) {
      for (let i = 1; i <= 8; i++) if (input.hit(String(i))) { state.me.selected = i - 1; hud.renderHotbar(); audio.play('select', 0.25) }
      this.zoomCd -= dt
      const zin = input.hit('+', '=') || (input.wheel < 0 && this.zoomCd <= 0)
      const zout = input.hit('-', '_') || (input.wheel > 0 && this.zoomCd <= 0)
      if ((zin || zout) && this.view.zoomBy(zin ? 1 : -1)) { this.snapCamera(); this.zoomCd = 0.12 }
      if (input.hit('i', 'tab')) hud.toggleInventory()
    }
    let moving = false
    const ax = this.busy || this.vault || hud.dialogOpen() || hud.modalOpen() ? { x: 0, y: 0 } : input.axis()
    this.sneak = input.down('shift')
    if (!this.g.switching && (ax.x || ax.y)) {
      const len = Math.hypot(ax.x, ax.y)
      const sp = SPEED * (this.sneak ? 0.42 : 1)
      const vx = (ax.x / len) * sp * dt, vy = (ax.y / len) * sp * dt
      if (vx) this.slide(vx, 0)
      if (vy) this.slide(0, vy)
      me.dir = dirOf(ax)
      moving = true
    }
    me.moving = moving
    if (this.vault) {
      const v = this.vault
      v.t = Math.min(1, v.t + dt / 0.75)
      me.x = v.fx + (v.tx - v.fx) * v.t; me.y = v.fy + (v.ty - v.fy) * v.t
    } else this.unstick()

    // 钓到 / 抓到的弹窗：按一下关掉
    const press = !input.typing() && (input.hit(' ') || input.clicked)
    let used = false
    if (this.ui.catchOpen() && (press || input.hit('e'))) { this.ui.hideCatch(); used = true }
    // 放帐篷
    const ghost = this.drawGhost()
    if (!used && ghost && !this.busy && press) {
      used = true
      if (ghost.why) hud.toast(ghost.why)
      else { net.send({ t: 'place', slot: state.me.selected, tx: ghost.spot.tx, ty: ghost.spot.ty }); audio.play('plant', 0.5) }
    }
    // 用工具（换了别的东西拿在手上就收线）
    this.toolCd -= dt
    if (this.wild.fishing() && ITEMS[selectedItem()?.id ?? '']?.tool !== 'rod') this.wild.reel()
    if (!used && !ghost && !this.busy && !this.vault && press) used = this.useTool()
    // E：最近的互动
    const near = this.busy || this.g.switching ? null : this.nearest()
    hud.hint(this.busy || hud.modalOpen() ? null : ghost ? (ghost.why ? `放不了：${ghost.why}` : ghost.big ? '<b>空格</b> 把龟教授的帐篷放在这里（以后博物馆就盖在这一片）' : '<b>空格</b> 在这里搭帐篷') : near?.text ?? null)
    if (near && !this.busy && input.hit('e')) near.act()

    if (moving) {
      this.stepT -= dt
      if (this.stepT <= 0) { this.stepT = this.sneak ? 0.5 : 0.32; audio.play('step_grass', this.sneak ? 0.06 : 0.16) }
    }

    // ── 实体 ──
    me.update(dt)
    // 钓鱼时竿一直拿在手上，竿梢指着浮漂
    if (this.wild.fishing() && me.actT <= 0) {
      const tex = this.g.assets.icons_hd.icon_flimsy_rod
      if (tex) { me.tool.texture = tex; me.tool.visible = true }
      const side = this.wild.bobber.x < me.x - 4 ? -1 : 1
      me.tool.scale.set(side, 1)
      me.tool.rotation = side * (me.dir === 'up' ? 0.1 : 0.6)
      me.tool.position.set(side * 6, -12)
    } else if (this.vault) {
      // 撑竿跳：人跟着弧线起落，竿子斜插在身前
      const k = this.vault.t
      me.root.y -= Math.sin(k * Math.PI) * 22
      const tex = this.g.assets.icons_hd.icon_vaulting_pole
      if (tex) { me.tool.texture = tex; me.tool.visible = true; me.tool.scale.set(1.4); me.tool.rotation = (k - 0.5) * 1.6; me.tool.position.set(0, -8 + Math.sin(k * Math.PI) * 16) }
      if (k >= 1) { this.vault = null; me.tool.visible = false; audio.play('step_grass', 0.4, 0.8) }
    } else if (!this.wild.fishing() && me.actT <= 0) me.tool.visible = false
    for (const a of this.actors) a.update(dt)
    for (const f of this.others.values()) {
      const k = 1 - Math.exp(-dt * 12)
      f.x += (f.tx - f.x) * k; f.y += (f.ty - f.y) * k
      f.update(dt)
    }
    const wind = Math.sin(time * 0.4) * 0.5 + Math.sin(time * 1.7) * 0.2
    for (const e of this.objs.values()) e.sw?.update(time, wind)
    if (this.campfire.visible) { this.fireLight.alpha = 0.85 + Math.sin(time * 13) * 0.08 + Math.sin(time * 7.7) * 0.06; if (Math.random() < 0.5) this.fx.spawn({ x: this.campfire.x + (Math.random() - 0.5) * 10, y: this.campfire.y - 16, vx: (Math.random() - 0.5) * 10, vy: -30 - Math.random() * 20, life: 0.7, color: [0xffd27a, 0xff9a4a][Math.floor(Math.random() * 2)] }) }
    this.fx.update(dt, time)

    // ── 镜头 ──
    const v = this.view
    const k = 1 - Math.exp(-dt * 6)
    const cam = this.camTarget ?? { x: me.x, y: me.y - 20 }
    v.camX += (cam.x - v.viewW / 2 - v.camX) * k
    v.camY += (cam.y - v.viewH / 2 - v.camY) * k
    this.clampCamera()

    // ── 光照：第 0 天的钟点是游戏定的（白天下午，欢迎会以后是晚上），之后跟现实走 ──
    const realTime = !DAY0.includes(pub.stage) && !NIGHT0.includes(pub.stage) && !this.party
    const hour = realTime ? state.hour : this.party || NIGHT0.includes(pub.stage) ? 20.6 : 14.5
    const rain = realTime && state.rain ? 1 : 0
    this.wild.update(dt, time, { x: me.x, y: me.y, moving, sneak: this.sneak }, calendarOf(state.day).month, hour, !!rain)
    const [r, gg, b, gain, sat] = sky(hour)
    v.post.set('uAmbient', [r * (rain ? 0.78 : 1), gg * (rain ? 0.78 : 1), b * (rain ? 0.86 : 1)])
    v.post.set('uLightGain', gain + rain * 0.25)
    v.post.set('uSat', sat * (rain ? 0.8 : 1))
    v.post.set('uClouds', rain ? 0.4 : 1)
    hud.setClock(hour, state.day, !!rain)
    this.waterFilter.update(v, time, rain)
    this.groundFilter.update(v.camX, v.camY, v.scale, time)
    audio.playMusic(hour < 10 ? 'morning' : hour < 18 ? 'day' : hour < 22 ? 'evening' : 'none')
    audio.setAmbient('shore', 1)

    // 名牌
    for (const f of [me, ...this.others.values()]) {
      const p = v.worldToScreen(f.x, f.y - (f.held.visible ? 58 : 38))
      f.tag.position.set(Math.round(p.x), Math.round(p.y))
    }

    // 位置同步
    this.sendT -= dt
    const sig = `${Math.round(me.x)},${Math.round(me.y)},${me.dir},${me.moving}`
    if (this.sendT <= 0 && sig !== this.lastSent) {
      this.sendT = 0.1
      this.lastSent = sig
      net.send({ t: 'move', x: me.x, y: me.y, dir: me.dir, moving: me.moving })
    }
    v.render(time)
  }

  resize(w: number, h: number) { this.view.resize(w, h); this.snapCamera() }

  destroy() {
    for (const u of this.unsub) u()
    this.wild.destroy()
    this.ui.destroy()
    this.fx.clear()
    this.g.app.stage.removeChild(this.view.display, this.overlay)
    this.overlay.destroy({ children: true })
    this.view.destroy()
    this.g.hud.hint(null)
    this.g.hud.closeModals()
    document.body.classList.remove('isle')
  }
}
