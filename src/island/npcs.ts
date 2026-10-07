// 岛上的 NPC：在自己的摊位/岗位附近闲逛，玩家靠近时停下来转身；E 键对话。
// 对话行开头带 ^ 的用开心表情立绘。
import { snap } from '../acstyle.ts'
import { Container, Graphics, Sprite } from 'pixi.js'
import type { Atlas, GameAssets } from '../core/assets.ts'
import type { Dir } from '../../shared/protocol.ts'
import { NPC_SPOTS } from '../../shared/island.ts'
import { NPC_INFO } from '../../shared/npcs.ts'
import { stopAt } from '../../shared/schedules.ts'
import type { Emote } from '../../shared/events.ts'
import type { NpcId } from '../../shared/npcs.ts'
import { TILE, DIVE_ENERGY } from '../../shared/data.ts'

export type NpcAction = 'shop:fish' | 'shop:seeds' | 'shop:gear' | 'dive' | 'travel' | 'chat' | 'bye'
export interface NpcOption { label: string, action: NpcAction }
export interface NpcCtx { hour: number, rain: boolean }

// 名字、称呼、生日、喜好、按好感分档的台词都在 shared/npcs.ts（前后端共用）；
// 这里只放客户端的东西：情境台词（下雨、夜里）、「随便聊聊」的小贴士、对话选项、闲逛半径
export interface NpcDef {
  id: NpcId
  name: string
  title: string
  greet?: (c: NpcCtx) => string[]
  tips: string[]
  options: NpcOption[]
  wander: number     // 闲逛半径（像素）
}

const night = (c: NpcCtx) => c.hour >= 19.5 || c.hour < 5.5
const CHAT: NpcOption = { label: '随便聊聊', action: 'chat' }
const BYE: NpcOption = { label: '再见', action: 'bye' }
const def = (id: NpcId, o: Omit<NpcDef, 'id' | 'name' | 'title'>): NpcDef => ({ id, name: NPC_INFO[id].name, title: NPC_INFO[id].title, ...o })

export const NPCS: NpcDef[] = [
  def('ahai', {
    wander: 16,
    greet: c => c.rain ? ['下雨天鱼爱往浅处靠，是好日子。'] : night(c) ? ['都这个点了……算了，拿来吧，我还没收摊。'] : [],
    tips: ['鱼直接卖给我不值几个钱，拿去阿澜那儿做成寿司，能翻好几倍。', '蓝洞那边最近总有大家伙出没，下去的时候机灵点。', '鲭鱼群跑起来比风还快。别追，等它们自己转回来。', '石斑鱼肉厚，做成刺身最香，可惜它们爱躲在石头缝里。', '^金枪鱼？那可是海里的王。谁抓到了，我请他喝酒！'],
    options: [{ label: '卖东西给阿海', action: 'shop:fish' }, CHAT, BYE],
  }),
  def('huashen', {
    wander: 20,
    greet: c => c.rain ? ['^下雨好呀，今天不用浇水，歇歇手！'] : [],
    tips: ['干活累了就吃点自己种的。稻米顶饿，南瓜一个能顶一趟海。', '南瓜长得慢，可一个能卖好多钱呢。', '草莓娇气，但熟了以后红彤彤的，看着就开心。', '地要是空着不种，过几天就会荒回去，记得常来照看。'],
    options: [{ label: '买种子 / 卖作物', action: 'shop:seeds' }, CHAT, BYE],
  }),
  def('laopan', {
    wander: 10,
    greet: c => night(c) ? ['晚上的海更黑，手电别离手。'] : c.rain ? ['下雨不碍事，水底下又淋不着。'] : [],
    tips: ['出一趟海累得很，一天两趟顶天了。体力不够就先吃点东西。', '鱼篓满了就回船上，别贪。满了再打，鱼也是白白跑掉。', '越往下越黑，过了三十米就只能靠手电了。', '^听说蓝洞最深处，有人见过整群的金枪鱼。', '氧气要是用光了，我会把你拽上来——不过你抓的鱼可就全喂海了。'],
    options: [{ label: `出海下潜（体力 -${DIVE_ENERGY}）`, action: 'dive' }, { label: '出航去别的地方', action: 'travel' }, CHAT, BYE],
  }),
  def('xiaoshan', {
    wander: 26,
    tips: ['^河豚游得慢，新手先拿它练手！', '大鱼要连着命中好几下才会服软，别一枪就松手。', '鱼挨了一枪就会跑，赶紧追上去补一枪！', '^鱼篓升级了一趟能多带好几条回来，最划算的就是它！', '氧气不够的时候往上游，贴近海面能慢慢回满。', '三十米往下水压猛得很，普通气瓶扛不住。先攒钱换个高压气瓶吧。', '^鱼枪升级了能射得更远，打大鱼也不用那么多下！', '鲭鱼和竹荚鱼会成群游，一受惊就一哄而散，要悄悄靠近。'],
    options: [{ label: '升级潜水装备', action: 'shop:gear' }, { label: '请教潜水技巧', action: 'chat' }, BYE],
  }),
  def('zhoushu', {
    wander: 18,
    greet: c => c.rain ? ['下雨了，码头上的木头又要泡软了……'] : night(c) ? ['这么晚了还在忙？早点歇着。'] : [],
    tips: ['广场的告示板每天都有大家的委托，帮上忙，街坊们都记着。', '村里的信都送到各家门口的信箱，插着红旗就是有新信。', '送礼要投其所好。每个人喜欢的东西都不一样。', '别忘了街坊们的生日，那天送礼，人家记一辈子。'],
    options: [CHAT, BYE],
  }),
  def('alan', {
    wander: 14,
    greet: c => c.hour >= 17 && c.hour < 25 ? ['^店里开着呢，进来帮忙吧。'] : [],
    tips: ['同样一条鱼，直接卖不值钱，做成菜就不一样了。便宜的鱼做刺身正合适。', '握寿司的米要温的，鱼要凉的。', '真鲷做刺身，颜色是最漂亮的。', '寿司店每天上午十点开门，晚上十点打烊。一天就来那么些客人，早点来。', '客人等太久会走的，先做点单多的那道菜。'],
    options: [CHAT, BYE],
  }),
  def('doudou', {
    wander: 30,
    greet: c => night(c) ? ['嘘——我偷溜出来的，别告诉奶奶！'] : c.rain ? ['^下雨啦！我在踩水坑！'] : [],
    tips: ['^海葵里住着小丑鱼，它们不怕海葵蜇！', '我知道岛上哪里有最多的贝壳，但是不告诉你！', '^奶奶种的草莓最甜了！', '阿海爷爷说，蓝洞里住着一条比船还大的鱼。真的假的？'],
    options: [CHAT, BYE],
  }),
]

// 表情气泡：白底小框 + 符号（！红、？蓝、♥ 红心、… 三个点），锚点在气泡尖角
export function drawEmote(g: Graphics, e: Emote) {
  g.clear()
  g.rect(-7, -10, 14, 11).fill(0x3a2314).rect(-6, -9, 12, 9).fill(0xfff8e4).rect(-1, 1, 3, 1).fill(0x3a2314).rect(0, 2, 1, 1).fill(0x3a2314).rect(-1, 0, 2, 1).fill(0xfff8e4)
  if (e === '!') g.rect(-1, -8, 2, 5).fill(0xe0503a).rect(-1, -2, 2, 1).fill(0xe0503a)
  else if (e === '?') g.rect(-2, -8, 4, 1).fill(0x2d5582).rect(2, -7, 1, 2).fill(0x2d5582).rect(0, -5, 2, 1).fill(0x2d5582).rect(0, -4, 1, 1).fill(0x2d5582).rect(0, -2, 1, 1).fill(0x2d5582)
  else if (e === '♥') g.rect(-4, -7, 3, 2).fill(0xe0503a).rect(1, -7, 3, 2).fill(0xe0503a).rect(-4, -5, 8, 2).fill(0xe0503a).rect(-3, -3, 6, 1).fill(0xe0503a).rect(-2, -2, 4, 1).fill(0xe0503a).rect(-1, -1, 2, 1).fill(0xe0503a).rect(-3, -7, 1, 1).fill(0xff9aaa)
  else for (const dx of [-4, -1, 2]) g.rect(dx, -5, 2, 2).fill(0x6b4428)
  g.visible = true
}

// 侧面行走帧画的是朝右
export class NpcActor {
  root = new Container()
  body = new Sprite()
  bubble = new Graphics()
  alert = new Graphics()      // 头顶的「！」：有委托能交付
  emote = new Graphics()      // 剧情里冒的表情（！？♥…）
  private emoteT = 0
  scripted = false            // 剧情播放中：不跟日程、不闲逛，只听剧本
  hold = false                // 正在和玩家对话：原地站住
  path: { x: number, y: number }[] = []
  private goal = ''
  walkDone = true
  x: number; y: number
  hx: number; hy: number
  tx: number; ty: number
  dir: Dir = 'down'
  moving = false
  animT = 0
  waitT = Math.random() * 3
  frames: Atlas

  constructor(public def: NpcDef, assets: GameAssets, private free: (x: number, y: number) => boolean,
    private route: (fx: number, fy: number, tx: number, ty: number) => { x: number, y: number }[] | null, hour: number, rain: boolean) {
    const spot = stopAt(def.id, hour, rain).at ?? NPC_SPOTS[def.id]
    this.goal = `${spot.x},${spot.y}`
    this.hx = this.x = this.tx = spot.x * TILE
    this.hy = this.y = this.ty = spot.y * TILE
    this.frames = assets.npcs
    const shadow = new Sprite(assets.shadow(18)); shadow.anchor.set(0.5); shadow.y = -1
    this.body.anchor.set(0.5, 1)
    // 对话提示气泡：像素风的小圆角框 + 省略号
    const b = this.bubble
    b.rect(-6, -4, 12, 8).fill(0xfff8e4).rect(-7, -3, 1, 6).fill(0xfff8e4).rect(6, -3, 1, 6).fill(0xfff8e4)
    b.rect(-1, 4, 3, 1).fill(0xfff8e4).rect(0, 5, 1, 1).fill(0xfff8e4)
    for (const dx of [-4, -1, 2]) b.rect(dx, 0, 2, 2).fill(0x6b4428)
    b.visible = false
    const a = this.alert
    a.rect(-3, -9, 6, 11).fill(0x3a2314).rect(-2, -8, 4, 6).fill(0xffd35a).rect(-2, -1, 4, 2).fill(0xffd35a)
    a.rect(-2, -8, 1, 6).fill(0xfff2a8)
    a.visible = false
    this.emote.visible = false
    this.root.addChild(shadow, this.body, this.bubble, this.alert, this.emote)
  }

  // 冒表情：白底小气泡 + 符号，1.5 秒后消失
  showEmote(e: Emote) { drawEmote(this.emote, e); this.emoteT = 1.5 }
  // 剧本让它走到某处（像素）
  walkTo(x: number, y: number) { this.tx = x; this.ty = y; this.moving = true; this.walkDone = false }
  // 剧情结束：交还给日程（重新寻路回该在的地方）
  release() { this.scripted = false; this.goal = ''; this.moving = false; this.walkDone = true }

  update(dt: number, time: number, px: number, py: number, hour = 12, rain = false) {
    this.emoteT -= dt
    if (this.emoteT <= 0) this.emote.visible = false
    // 日程换站：寻路过去
    if (!this.scripted) {
      const at = stopAt(this.def.id, hour, rain).at
      const key = `${at.x},${at.y}`
      if (key !== this.goal) {
        this.goal = key
        this.hx = at.x * TILE; this.hy = at.y * TILE
        this.path = this.route(this.x, this.y, this.hx, this.hy) ?? [{ x: this.hx, y: this.hy }]
      }
    }
    const near = !this.scripted && Math.hypot(px - this.x, py - this.y) < 44
    if (this.scripted) {
      if (this.moving) {
        const dx = this.tx - this.x, dy = this.ty - this.y, d = Math.hypot(dx, dy)
        if (d < 1) { this.moving = false; this.walkDone = true }
        else {
          const step = Math.min(d, 40 * dt)
          this.x += (dx / d) * step; this.y += (dy / d) * step
          this.dir = Math.abs(dx) > Math.abs(dy) ? (dx < 0 ? 'left' : 'right') : (dy < 0 ? 'up' : 'down')
        }
      }
    } else if (this.path.length && !this.hold) {
      // 沿路径走（路径已经绕开了障碍物，不用再检测碰撞）
      const p = this.path[0], dx = p.x - this.x, dy = p.y - this.y, d = Math.hypot(dx, dy)
      if (d < 1.5) this.path.shift()
      else {
        const step = Math.min(d, 36 * dt)
        this.x += (dx / d) * step; this.y += (dy / d) * step
        this.dir = Math.abs(dx) > Math.abs(dy) ? (dx < 0 ? 'left' : 'right') : (dy < 0 ? 'up' : 'down')
      }
      this.moving = this.path.length > 0
      if (!this.path.length) this.waitT = 2 + Math.random() * 4
    } else if (near || this.hold) {
      // 玩家靠近：停下，转向玩家
      this.moving = false
      const dx = px - this.x, dy = py - this.y
      this.dir = Math.abs(dx) > Math.abs(dy) ? (dx < 0 ? 'left' : 'right') : (dy < 0 ? 'up' : 'down')
    } else if (this.moving) {
      const dx = this.tx - this.x, dy = this.ty - this.y, d = Math.hypot(dx, dy)
      if (d < 1) { this.moving = false; this.waitT = 2 + Math.random() * 5 }
      else {
        const step = Math.min(d, 24 * dt)
        const nx = this.x + (dx / d) * step, ny = this.y + (dy / d) * step
        if (this.free(nx, ny)) { this.x = nx; this.y = ny } else { this.moving = false; this.waitT = 1 }
        this.dir = Math.abs(dx) > Math.abs(dy) ? (dx < 0 ? 'left' : 'right') : (dy < 0 ? 'up' : 'down')
      }
    } else {
      this.waitT -= dt
      if (this.waitT <= 0) {
        const a = Math.random() * Math.PI * 2, r = Math.random() * this.def.wander
        this.tx = this.hx + Math.cos(a) * r; this.ty = this.hy + Math.sin(a) * r * 0.6
        this.moving = true
      }
    }
    this.animT = this.moving ? this.animT + dt : 0
    const row = this.dir === 'left' || this.dir === 'right' ? 'side' : this.dir
    const f = this.moving ? Math.floor(this.animT * 7) % 4 : 0
    const tex = this.frames[`${this.def.id}_${row}_${f}`]
    if (tex) this.body.texture = tex
    this.body.scale.x = row === 'side' && this.dir === 'left' ? -1 : 1
    this.body.y = this.moving && (f === 1 || f === 3) ? -1 : 0
    this.bubble.visible = near && !this.alert.visible && !this.emote.visible
    this.emote.position.set(0, Math.round(-this.body.height - 4))
    this.alert.position.set(0, Math.round(-this.body.height - 6 + Math.sin(time * 5) * 1.5))
    this.bubble.position.set(0, Math.round(-this.body.height - 8 + Math.sin(time * 4) * 1.5))
    this.root.position.set(snap(this.x), snap(this.y))
    this.root.zIndex = this.y
  }
}
