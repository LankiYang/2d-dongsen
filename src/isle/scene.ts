// 动森式的岛（2D动森）：每人一座，场景按岛实例化（isle:<岛号>）。
// 画：高清地面（悬崖、河、沙滩）+ 水面 + 地图物件（树、果树、椰子树、石头、花、杂草、树枝）+ 机场、岛务所帐篷、码头 + 帐篷 + 地上的东西。
// 人：玩家、同岛的其他玩家、工作人员（周叔、阿海、豆豆、老潘）、动物村民。
// 序章第 0 天（原作的开局）在这里一步步推：说明会 → 搭帐篷 → 帮邻居 → 树枝 → 水果 → 篝火会起岛名 → 回帐篷睡觉。
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
import { IsleGroundFilter } from './ground.ts'
import { bakeIsle } from './bake.ts'
import { Actor } from './actor.ts'
import { makeIsle, ISLE_W, ISLE_H, FRUIT_NAME } from '../../shared/isle/gen.ts'
import type { Isle, IsleObj } from '../../shared/isle/gen.ts'
import { canPlaceTent, tentTiles, isleBlocked } from '../../shared/isle/rules.ts'
import { VILLAGERS, DAY0_LINES, withPhrase } from '../../shared/villagers.ts'
import { NPC_INFO } from '../../shared/npcs.ts'
import type { NpcId } from '../../shared/npcs.ts'
import { TILE, ITEMS } from '../../shared/data.ts'
import type { IslePublic, PlayerPublic, TentSpot, Dir } from '../../shared/protocol.ts'
import { state, selectedItem } from '../state.ts'

const SPEED = 92
const REACH = 26

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

  constructor(private g: Game, public isleId: number) {
    const { assets } = g
    const pub = state.isle!
    this.isle = makeIsle(pub.seed)
    this.blocked = isleBlocked(this.isle, pub)
    this.view = new PixelView(g.app.renderer as any, 300, 'isle', true)
    this.view.mapW = ISLE_W * TILE; this.view.mapH = ISLE_H * TILE
    const W = this.view.world

    // ── 地面、水面 ──
    const bk = bakeIsle(this.isle)
    const water = new Sprite(bk.water)
    water.scale.set(bk.WS)
    water.filters = [this.waterFilter]
    const ground = new Sprite(bk.field)
    ground.scale.set(bk.S)
    ground.position.set(-bk.S / 2, -bk.S / 2)
    ground.filters = [this.groundFilter]
    this.entities.sortableChildren = true
    W.addChild(water, ground, this.dockGraphics(), this.shadowLayer, this.entities, this.fx.layer, this.ghost)

    // ── 建筑 ──
    const { airport, plaza } = this.isle
    this.addSprite('airport', (airport.x + airport.w / 2) * TILE, (airport.y + airport.h) * TILE, true)
    this.addSprite('rs_tent', (plaza.x + plaza.w / 2) * TILE, (plaza.y + 4) * TILE, true)
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
    this.me = new Farmer(assets, state.me.hue, state.me.name, true)
    this.me.x = this.me.tx = g.meStart.x
    this.me.y = this.me.ty = g.meStart.y
    this.entities.addChild(this.me.root)
    this.overlay.addChild(this.me.tag)
    this.ghost.zIndex = 1e6

    g.app.stage.addChild(this.view.display, this.overlay)
    this.unsub.push(
      g.net.on('isle', m => { state.isle = m.isle; this.applyIsle() }),
      g.net.on('players', m => this.syncPlayers(m.list)),
      g.net.on('left', m => this.removeOther(m.id)),
    )
    this.view.post.set('uMode', 0)
    g.hud.setSeaMode(false)
    document.body.classList.add('isle')
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
      const s = new Sprite(this.g.assets.island[`drop_${d.item}`] ?? Texture.EMPTY)
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
    this.placeActors(first)
    if (pub.stage !== this.lastStage) { this.lastStage = pub.stage; this.renderTracker() }
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
      day1: ['新的一天', '去广场找周叔（第 1 天的内容还在做）'],
    }
    const [title, text] = t[pub.stage] ?? ['', '']
    el.innerHTML = `<div class="tq">${title}</div><div>${text}</div>`
    el.classList.remove('hidden')
  }

  // ── 碰撞 ──
  private blockedAt(px: number, py: number) {
    const tx = Math.floor(px / TILE), ty = Math.floor(py / TILE)
    if (tx < 0 || ty < 0 || tx >= ISLE_W || ty >= ISLE_H) return true
    return this.blocked[ty * ISLE_W + tx] === 1
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
        else await this.staffSay('zhoushu', `^早上好！${pub.name ? pub.name + '岛' : '岛上'}的第一个早晨！……接下来的事（手机、DIY 教室）还在准备，过阵子再来找我。`)
      } else if (id === 'ahai') await this.staffSay('ahai', pub.stage === 'arrive' ? '欢迎来到无人岛！大家在广场集合，周叔要给大家讲讲岛上的事。' : '^以后岛务所帐篷里有小摊，缺什么、要卖什么都来找我。')
      else if (id === 'doudou') await this.staffSay('doudou', pub.stage === 'arrive' ? '^我们到啦！快去广场，周叔在等大家！' : '^我在帮阿海叔叔看摊！')
      else if (id === 'laopan') await this.staffSay('laopan', '我开飞机。等岛上的机场开起来，带你去别的岛转转。')
    })
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
      else await this.villagerSay(v.id, lines.hello)
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
    for (const d of pub.drops) consider(d.x, d.y - 4, 18, 3, `<b>E</b> 捡起${ITEMS[d.item]?.name ?? d.item}`, () => this.g.net.send({ t: 'pickup', drop: d.id }))
    for (const [id, e] of this.objs) {
      if (pub.removed.includes(id) || !e.root.visible) continue
      const o = e.o
      if (o.kind === 'branch') consider(o.x, o.y - 4, 18, 3, '<b>E</b> 捡起树枝', () => this.g.net.send({ t: 'pickup', obj: o.id }))
      else if (o.kind === 'tree' || o.kind === 'fruit_tree') consider(o.x, o.y - 6, REACH, 1, '<b>E</b> 摇树', () => this.shake(o))
    }
    for (const a of this.actors) consider(a.x, a.y - 8, REACH + 4, 2, `<b>E</b> 和${a.name}说话`, () => 'staff' in a.kind ? this.talkStaff(a) : this.talkVillager(a))
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
  private enterTent() {
    if (this.g.switching) return
    this.g.net.send({ t: 'scene', to: `tent:${state.me.id}` })
    this.g.meStart = { x: 3 * TILE, y: 5 * TILE - 6 }
    this.g.switchTo(`tent:${state.me.id}`)
  }

  // ── 放帐篷：选中帐篷包时在面前显示一个预览，绿色能放、红色不能 ──
  private kitSpot(): TentSpot {
    const me = this.me
    const f: Record<Dir, [number, number]> = { down: [0, 3], up: [0, -2], left: [-3, 0], right: [3, 0] }
    const [dx, dy] = f[me.dir]
    return { tx: Math.floor(me.x / TILE) + dx, ty: Math.floor((me.y - 4) / TILE) + dy }
  }
  private drawGhost() {
    const it = selectedItem()
    this.ghost.clear()
    if (!it || !(it.id === 'kit_tent' || it.id.startsWith('kit_vtent_')) || this.busy) return null
    const spot = this.kitSpot()
    const why = canPlaceTent(this.isle, state.isle!, spot)
    const c = why ? 0xff6b5a : 0x8cf07a
    for (const [x, y] of tentTiles(spot)) this.ghost.roundRect(x * TILE + 1, y * TILE + 1, TILE - 2, TILE - 2, 4).fill({ color: c, alpha: 0.32 }).stroke({ color: c, alpha: 0.8, width: 1 })
    this.ghost.roundRect(spot.tx * TILE + 4, (spot.ty + 1) * TILE + 4, TILE - 8, TILE - 8, 3).stroke({ color: 0xffffff, alpha: 0.6, width: 1 })
    return { spot, why }
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
    const ax = this.busy || hud.dialogOpen() ? { x: 0, y: 0 } : input.axis()
    if (!this.g.switching && (ax.x || ax.y)) {
      const len = Math.hypot(ax.x, ax.y)
      const vx = (ax.x / len) * SPEED * dt, vy = (ax.y / len) * SPEED * dt
      if (vx) this.slide(vx, 0)
      if (vy) this.slide(0, vy)
      me.dir = dirOf(ax)
      moving = true
    }
    me.moving = moving
    this.unstick()

    // 放帐篷
    const ghost = this.drawGhost()
    if (ghost && !this.busy && !input.typing() && (input.hit(' ') || input.clicked)) {
      if (ghost.why) hud.toast(ghost.why)
      else { net.send({ t: 'place', slot: state.me.selected, tx: ghost.spot.tx, ty: ghost.spot.ty }); audio.play('plant', 0.5) }
    }
    // E：最近的互动
    const near = this.busy || this.g.switching ? null : this.nearest()
    hud.hint(this.busy || hud.modalOpen() ? null : ghost ? (ghost.why ? `放不了：${ghost.why}` : '<b>空格</b> 在这里搭帐篷') : near?.text ?? null)
    if (near && !this.busy && input.hit('e')) near.act()

    if (moving) {
      this.stepT -= dt
      if (this.stepT <= 0) { this.stepT = 0.32; audio.play('step_grass', 0.16) }
    }

    // ── 实体 ──
    me.update(dt)
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
    const hour = pub.stage === 'day1' ? state.hour : this.party || pub.stage === 'party' || pub.stage === 'sleep' ? 20.6 : 14.5
    const rain = pub.stage === 'day1' && state.rain ? 1 : 0
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
    if (this.lastStage === 'branches' || this.lastStage === 'fruit' || this.lastStage === 'neighbors') this.renderTracker()

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
    this.fx.clear()
    this.g.app.stage.removeChild(this.view.display, this.overlay)
    this.overlay.destroy({ children: true })
    this.view.destroy()
    this.g.hud.hint(null)
    this.g.hud.closeModals()
    document.body.classList.remove('isle')
  }
}
