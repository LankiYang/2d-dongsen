// 复兴工程在岛上的样子：栈桥（断桩 / 新桥）、灯塔（废墟 / 修好，夜里光束转圈扫过海面）、集市摊位、客船。
// 工程进度变了就整个重建。集市开张后清掉那块地上的野生植物、改碰撞，由场景负责。
import { Container, Sprite, Texture } from 'pixi.js'
import { PLACES, MARKET } from '../../shared/island.ts'
import { TILE } from '../../shared/data.ts'
import type { GameAssets } from '../core/assets.ts'
import { canvas, texFrom } from '../core/assets.ts'
import type { Particles } from '../fx/particles.ts'
import type { Audio } from '../core/audio.ts'

export const FERRY = { x: 67.5, y: 23.7 }      // 客船停靠的位置（底边中心，地块坐标）
const LAMP_DY = -82                             // 灯室离灯塔底边的高度（像素）

export class RestoreLayer {
  done = -1
  beamHold = false                // 剧情里先关着灯，等老潘点灯
  private objs: Container[] = []
  private lightSprites: Sprite[] = []
  private beam: Container | null = null
  private beamSprite: Sprite | null = null
  private haze: Container | null = null        // 空气里看得见的那道光（叠加在画面上，比光照图里那道淡）
  private hazeSprite: Sprite | null = null
  private lampGlow: Sprite | null = null
  private ferry: Sprite | null = null
  private ferryLights: Sprite[] = []

  constructor(private assets: GameAssets, private ground: Container, private entities: Container, private shadows: Container, private lights: Container, private sky: Container) {}

  apply(done: number) {
    if (done === this.done) return
    this.done = done
    for (const o of this.objs) o.destroy()
    for (const l of this.lightSprites) l.destroy()
    this.beam?.destroy({ children: true })
    this.haze?.destroy({ children: true })
    this.objs = []; this.lightSprites = []; this.beam = null; this.beamSprite = null; this.haze = null; this.hazeSprite = null; this.lampGlow = null; this.ferry = null; this.ferryLights = []
    const isl = this.assets.island

    // 栈桥：地块坐标 x0~x1 那几格浅水，两头各压上岸 8 像素
    const B = PLACES.bridge
    const br = new Sprite(bridgeTexture(done < 1, B.x1 - B.x0 + 1))
    br.position.set(B.x0 * TILE - 8, B.y0 * TILE - 1)
    this.ground.addChild(br); this.objs.push(br)

    // 灯塔
    const L = PLACES.lighthouse
    this.put(isl[done >= 2 ? 'lighthouse' : 'lighthouse_ruin'], L.x, L.y, 40)
    if (done >= 2) {
      // 光束：外层容器把 y 压扁（俯视看水平转圈的光是个椭圆），里层精灵转圈
      const c = new Container()
      c.position.set(L.x * TILE, L.y * TILE + LAMP_DY)
      c.scale.set(1, 0.55)
      const s = new Sprite(beamTexture()); s.anchor.set(0, 0.5); s.blendMode = 'add'; s.tint = 0xfff0b8; s.scale.set(3.2, 2)
      c.addChild(s)
      this.lights.addChild(c)
      this.beam = c; this.beamSprite = s
      const h = new Container()
      h.position.copyFrom(c.position); h.scale.set(1, 0.55)
      const hs = new Sprite(beamTexture()); hs.anchor.set(0, 0.5); hs.blendMode = 'add'; hs.tint = 0xffe9a8; hs.scale.set(3.2, 2)
      h.addChild(hs)
      this.sky.addChild(h)
      this.haze = h; this.hazeSprite = hs
      this.lampGlow = this.light(L.x * TILE, L.y * TILE + LAMP_DY, 34, 0xffe29a)
    }

    // 集市：四个摊位
    if (done >= 3) for (const st of MARKET.stalls) this.put(isl[st.kind], st.x, st.y, 76)

    // 客船
    if (done >= 4) {
      const f = new Sprite(isl.ferry)
      f.position.set(FERRY.x * TILE, FERRY.y * TILE); f.zIndex = f.y
      this.entities.addChild(f); this.objs.push(f); this.ferry = f
      for (const dx of [-38, -12, 14, 40]) this.ferryLights.push(this.light(FERRY.x * TILE + dx, FERRY.y * TILE - 40, 26, 0xffc978))
    }
  }

  private put(tex: Texture | undefined, x: number, y: number, shadowW: number) {
    if (!tex) return
    const s = new Sprite(tex)
    s.position.set(Math.round(x * TILE), Math.round(y * TILE)); s.zIndex = s.y
    this.entities.addChild(s); this.objs.push(s)
    const sh = new Sprite(this.assets.shadow(shadowW))
    sh.position.set(s.x, s.y - 1)
    this.shadows.addChild(sh); this.objs.push(sh)
  }
  private light(x: number, y: number, r: number, color: number) {
    const l = new Sprite(this.assets.light)
    l.anchor.set(0.5); l.tint = color; l.blendMode = 'add'; l.scale.set(r / 64); l.position.set(x, y)
    this.lights.addChild(l); this.lightSprites.push(l)
    return l
  }

  // night：0 = 白天，1 = 深夜（场景的光源强度）
  update(time: number, night: number) {
    const on = !this.beamHold && night > 0.05
    if (this.beam && this.beamSprite) {
      this.beamSprite.rotation = time * 0.7
      this.beamSprite.alpha = on ? Math.min(1, night * 1.2) : 0
      // 朝向镜头（往下）时光束更亮更长一点
      const k = 0.85 + 0.15 * Math.sin(this.beamSprite.rotation)
      this.beamSprite.scale.x = 3.2 * k
      if (this.hazeSprite) { this.hazeSprite.rotation = this.beamSprite.rotation; this.hazeSprite.scale.x = this.beamSprite.scale.x; this.hazeSprite.alpha = this.beamSprite.alpha * 0.22 }
    }
    if (this.lampGlow) this.lampGlow.alpha = on ? Math.min(1, night * 1.5) : 0
    if (this.ferry) this.ferry.y = FERRY.y * TILE + Math.round(Math.sin(time * 1.1) * 0.8)
    for (const l of this.ferryLights) l.alpha = Math.min(1, night * 1.2) * 0.8
  }

  destroy() {
    for (const o of this.objs) o.destroy()
    for (const l of this.lightSprites) l.destroy()
    this.beam?.destroy({ children: true })
    this.haze?.destroy({ children: true })
  }
}

// ── 特效 ──
// 烟花：一枚火箭拖着火星升空，到顶炸成一圈彩色光点（每个光点在光照图里也亮一下）
export function fireworks(fx: Particles, lights: Container, light: Texture, audio: Audio, x: number, y: number) {
  const px = x * TILE, py = y * TILE, rise = 0.75
  const rocket = fx.spawn({ x: px, y: py + 150, vy: -150 / rise, life: rise, color: 0xfff4d0, w: 1, h: 3, fade: false })
  const trail = setInterval(() => fx.spawn({ x: rocket.s.x + (Math.random() - 0.5) * 2, y: rocket.s.y + 2, vy: 10, life: 0.35, color: 0xffc36b }), 40)
  audio.play('whoosh', 0.2, 1.4)
  setTimeout(() => {
    clearInterval(trail)
    audio.play('boom', 0.45, 0.8 + Math.random() * 0.4)
    const pal = [[0xff6a8a, 0xffc0cc], [0x7fe0ff, 0xe0fbff], [0xffd35a, 0xfff2a8], [0x9be36a, 0xe8ffc8], [0xc59bff, 0xf0e0ff]][Math.floor(Math.random() * 5)]
    const n = 40
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + Math.random() * 0.1, v = 55 + Math.random() * 25
      const p = fx.spawn({ x: px, y: py, vx: Math.cos(a) * v, vy: Math.sin(a) * v, ay: 28, drag: 1.2, life: 1.3 + Math.random() * 0.5, color: pal[i % 2], w: 2, h: 2 })
      if (i % 3 === 0) {
        const l = new Sprite(light); l.anchor.set(0.5); l.tint = pal[0]; l.blendMode = 'add'; l.scale.set(30 / 64)
        lights.addChild(l); p.light = l
      }
    }
    // 中心闪一下
    const flash = fx.spawn({ x: px, y: py, life: 0.35, color: 0xffffff, w: 3, h: 3 })
    const fl = new Sprite(light); fl.anchor.set(0.5); fl.tint = 0xfff4d0; fl.blendMode = 'add'; fl.scale.set(90 / 64)
    lights.addChild(fl); flash.light = fl
  }, rise * 1000)
}

// 海里的荧光：夜光藻和发光水母，在一片海面上慢慢亮起、漂动、熄灭
// 光点只落在水上（onWater 由场景按地形判断）；只有一部分光点带光晕，免得连成一大片
export function seaGlow(fx: Particles, lights: Container, light: Texture, x: number, y: number, onWater: (px: number, py: number) => boolean) {
  let n = 0
  const t = setInterval(() => {
    for (let i = 0; i < 4; i++) {
      const px = (x + (Math.random() - 0.5) * 8) * TILE, py = (y + (Math.random() - 0.5) * 3) * TILE
      if (!onWater(px, py)) continue
      const big = Math.random() < 0.15
      const p = fx.spawn({ x: px, y: py, vx: (Math.random() - 0.5) * 4, vy: (Math.random() - 0.5) * 2, life: 6 + Math.random() * 6, color: big ? 0xc8f8ff : 0x6fe4ff, w: big ? 2 : 1, h: big ? 2 : 1, wobble: 3 })
      if (big || Math.random() < 0.25) {
        const l = new Sprite(light); l.anchor.set(0.5); l.tint = 0x2a9fe0; l.blendMode = 'add'; l.scale.set((big ? 16 : 9) / 64)
        lights.addChild(l); p.light = l
      }
    }
    if (++n >= 40) clearInterval(t)
  }, 220)
}

// ── 贴图 ──
const WOOD = ['#4a2e1b', '#6b4428', '#8a5a34', '#a36d40', '#bd8552']
const texCache = new Map<string, Texture>()
// 栈桥：和码头一样的南北向木板 + 上下两根纵梁 + 侧面厚度 + 桩子；断桥只剩几根断桩和两头残板
function bridgeTexture(broken: boolean, tiles: number): Texture {
  const key = `bridge${broken}${tiles}`
  const hit = texCache.get(key)
  if (hit) return hit
  const W = tiles * TILE + 16, D = TILE, H = D + 4 + 8
  const { c, g } = canvas(W, H)
  const px = (x: number, y: number, col: string) => { g.fillStyle = col; g.fillRect(x, y, 1, 1) }
  const hash = (a: number, b: number) => { const v = Math.sin(a * 127.1 + b * 311.7) * 43758.5453; return v - Math.floor(v) }
  const post = (x: number, top: number, h: number) => { for (let y = top; y < top + h; y++) for (let i = 0; i < 5; i++) px(x + i, y, WOOD[i === 0 ? 2 : i === 4 ? 0 : 1]) }
  if (broken) {
    // 两头各剩几块板（西头三块，东头两块），中间只剩断桩，水里漂着一块歪板
    const deck = (x0: number, x1: number) => {
      for (let x = x0; x < x1; x++) for (let y = 0; y < D; y++) {
        const bx = (x - x0) % 6
        let col = WOOD[bx === 5 ? 0 : bx === 0 ? 4 : hash(Math.floor(x / 6), 0) < 0.4 ? 2 : 3]
        if (y < 3) col = y === 0 ? WOOD[4] : WOOD[2]
        if (y >= D - 3) col = y === D - 3 ? WOOD[4] : WOOD[1]
        // 断口参差不齐
        const edge = x1 - x < 3 || x - x0 < 0
        if (edge && hash(x, y) < 0.5) continue
        px(x, y, col)
      }
      for (let x = x0; x < x1; x++) for (let y = D; y < D + 4; y++) px(x, y, WOOD[y === D ? 1 : 0])
    }
    deck(0, 26); deck(W - 20, W)
    for (const x of [30, 44, 58]) { post(x, 2, 4); post(x, D - 6, 10) }   // 断桩：北边一截露头，南边一截连到水里
    // 漂着的歪板
    for (let i = 0; i < 16; i++) for (let j = 0; j < 4; j++) px(34 + i, 10 + j + Math.floor(i / 5), WOOD[j === 0 ? 4 : j === 3 ? 0 : 2])
  } else {
    for (let x = 0; x < W; x++) for (let y = 0; y < D; y++) {
      const board = Math.floor(x / 6), bx = x % 6
      const bh = hash(board, 1)
      let col = WOOD[bh < 0.35 ? 2 : 3]
      if (bx === 5) col = WOOD[0]
      else if (bx === 0) col = WOOD[4]
      else if (hash(x, y) < 0.05) col = WOOD[bh < 0.35 ? 1 : 2]
      if (y < 3) col = y === 0 ? WOOD[4] : y === 2 ? WOOD[0] : WOOD[2]
      if (y >= D - 3) col = y === D - 3 ? WOOD[4] : y === D - 1 ? WOOD[1] : WOOD[2]
      if ((y === 1 || y === D - 2) && x % 12 === 3) col = WOOD[0]
      px(x, y, col)
    }
    for (let x = 0; x < W; x++) for (let y = D; y < D + 4; y++) px(x, y, WOOD[y === D ? 1 : 0])
    for (let x = 10; x < W - 6; x += TILE) post(x, D + 4, 7)
  }
  const t = texFrom(c)
  texCache.set(key, t)
  return t
}

// 灯塔光束：从原点往右张开的扇形，越远越淡（线性过滤，放大后平滑）
function beamTexture(): Texture {
  const hit = texCache.get('beam')
  if (hit) return hit
  const W = 128, H = 48
  const { c, g } = canvas(W, H)
  const img = g.createImageData(W, H)
  for (let x = 0; x < W; x++) for (let y = 0; y < H; y++) {
    const half = 1.5 + (x / W) * (H / 2 - 2)
    const dy = Math.abs(y + 0.5 - H / 2)
    if (dy > half) continue
    const a = (1 - x / W) ** 0.55 * (1 - (dy / half) ** 2) * Math.min(1, x / 6)
    const i = (y * W + x) * 4
    img.data[i] = img.data[i + 1] = img.data[i + 2] = 255; img.data[i + 3] = Math.round(a * 255)
  }
  g.putImageData(img, 0, 0)
  const t = texFrom(c, 'linear')
  texCache.set('beam', t)
  return t
}
