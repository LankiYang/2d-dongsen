// 岛上的鱼和虫（2D动森）：水里游的鱼影、飞的停的虫子，还有钓鱼的整套手感。
// 鱼、虫只在客户端生成（按月份、钟点、半球、地点挑物种），钓到 / 抓到才发给服务端，服务端再核对一遍。
// 钓鱼照原作：对着水抛竿 → 鱼影游过来 → 啄几下（浮漂轻轻一点）→ 真咬钩（浮漂一沉、「噗通」）→ 马上收竿；早了晚了都会跑。
// 抓虫：按住 Shift 慢慢走过去（跑过去会吓跑），挥网。
import { Container, Graphics, Sprite, Texture } from 'pixi.js'
import type { GameAssets } from '../core/assets.ts'
import type { Audio } from '../core/audio.ts'
import type { Particles } from '../fx/particles.ts'
import { TILE } from '../../shared/data.ts'
import { ISLE_W, ISLE_H, IT } from '../../shared/isle/gen.ts'
import type { Isle } from '../../shared/isle/gen.ts'
import { FISHES, BUGS, fishAvailable, bugAvailable, pickWeighted } from '../../shared/critters.ts'
import type { FishDef, BugDef, FishLoc } from '../../shared/critters.ts'
import type { Dir } from '../../shared/protocol.ts'

const SHADOW_RX = [0, 4.5, 6, 7.5, 9.5, 12, 15]   // 鱼影大小 1～6
const MAX_FISH = 9, MAX_BUGS = 7
const DIRV: Record<Dir, [number, number]> = { down: [0, 1], up: [0, -1], left: [-1, 0], right: [1, 0] }

interface Shadow { def: FishDef, loc: FishLoc, g: Graphics, x: number, y: number, tx: number, ty: number, ang: number, wait: number, flee: number, life: number }
interface Bug { def: BugDef, s: Sprite, sh: Sprite, x: number, y: number, z: number, hx: number, hy: number, t: number, flee: number, hop: number, w: number }
type FishState = 'idle' | 'cast' | 'wait' | 'approach' | 'nibble' | 'bite'

export class Wildlife {
  water = new Container()          // 鱼影：在地面之上、人和树之下
  line = new Graphics()            // 钓线
  bobber: Sprite
  private shadows: Shadow[] = []
  private bugs: Bug[] = []
  private spawnT = 0
  // 钓鱼
  fish: FishState = 'idle'
  private bx = 0; private by = 0; private bt = 0
  private castFrom = { x: 0, y: 0 }
  private target: Shadow | null = null
  private nibbles = 0
  private timer = 0
  private dip = 0

  constructor(private assets: GameAssets, private audio: Audio, private fx: Particles, private isle: Isle, private entities: Container, private hemi: 'N' | 'S') {
    this.bobber = new Sprite(assets.island.bobber ?? Texture.WHITE)
    this.bobber.anchor.set(0.5, 0.7)
    this.bobber.scale.set(Math.min(1, 9 / Math.max(1, this.bobber.texture.width)))
    this.bobber.visible = false
    this.line.zIndex = 1e6 - 1
    this.bobber.zIndex = 1e6 - 2
    entities.addChild(this.line, this.bobber)
  }

  private typeAt(x: number, y: number) {
    const tx = Math.floor(x / TILE), ty = Math.floor(y / TILE)
    if (tx < 0 || ty < 0 || tx >= ISLE_W || ty >= ISLE_H) return IT.DEEP
    return this.isle.types[ty * ISLE_W + tx]
  }
  private locAt(x: number, y: number): FishLoc | null {
    const t = this.typeAt(x, y)
    return t === IT.SHALLOW || t === IT.DEEP ? 'sea' : t === IT.RIVER ? 'river' : t === IT.POND ? 'pond' : null
  }
  waterAt(x: number, y: number) { return this.locAt(x, y) !== null }

  // ── 每帧 ──
  update(dt: number, time: number, me: { x: number, y: number, moving: boolean, sneak: boolean }, month: number, hour: number, rain: boolean) {
    this.spawnT -= dt
    if (this.spawnT <= 0) {
      this.spawnT = 0.7
      if (this.shadows.length < MAX_FISH) this.spawnFish(me, month, hour)
      if (this.bugs.length < MAX_BUGS) this.spawnBug(me, month, hour, rain)
    }
    this.updateFish(dt, time, me)
    this.updateBugs(dt, time, me)
    this.updateLine(dt, time, me)
  }

  // ═══ 鱼影 ═══
  private spawnFish(me: { x: number, y: number }, month: number, hour: number) {
    for (let tries = 0; tries < 12; tries++) {
      const a = Math.random() * Math.PI * 2, d = (4 + Math.random() * 12) * TILE
      const x = me.x + Math.cos(a) * d, y = me.y + Math.sin(a) * d
      const loc = this.locAt(x, y)
      if (!loc) continue
      // 离岸太远的深海不放（够不着）：周围 4 格内要有陆地
      if (loc === 'sea' && ![[4, 0], [-4, 0], [0, 4], [0, -4]].some(([dx, dy]) => !this.waterAt(x + dx * TILE, y + dy * TILE))) continue
      if (this.shadows.some(s => Math.hypot(s.x - x, s.y - y) < 40)) continue
      const def = pickWeighted(FISHES.filter(f => f.loc === loc && fishAvailable(f, month, hour, this.hemi)), Math.random())
      if (!def) return
      const g = new Graphics()
      const rx = SHADOW_RX[def.size], ry = rx * 0.42
      g.ellipse(0, 0, rx, ry).fill({ color: 0x0b2a3c, alpha: 0.42 })
      g.poly([-rx + 1, 0, -rx - rx * 0.45, -ry * 0.8, -rx - rx * 0.45, ry * 0.8]).fill({ color: 0x0b2a3c, alpha: 0.36 })
      g.position.set(x, y); g.alpha = 0
      this.water.addChild(g)
      this.shadows.push({ def, loc, g, x, y, tx: x, ty: y, ang: Math.random() * Math.PI * 2, wait: Math.random() * 2, flee: 0, life: 0 })
      return
    }
  }
  private fleeFish(s: Shadow) { if (!s.flee) { s.flee = 0.9; s.ang = Math.atan2(s.y - this.by, s.x - this.bx) } }

  private updateFish(dt: number, time: number, me: { x: number, y: number }) {
    for (let i = this.shadows.length - 1; i >= 0; i--) {
      const s = this.shadows[i]
      s.life += dt
      if (s.flee) {
        s.flee -= dt
        s.x += Math.cos(s.ang) * 90 * dt; s.y += Math.sin(s.ang) * 90 * dt
        s.g.alpha = Math.max(0, s.flee / 0.9)
        if (s.flee <= 0 || !this.locAt(s.x, s.y)) { s.g.destroy(); this.shadows.splice(i, 1); if (this.target === s) this.target = null; continue }
      } else if (s === this.target && this.fish !== 'wait') {
        // 被浮漂吸引：游到浮漂跟前，嘴对着浮漂
        const ang = Math.atan2(this.by - s.y, this.bx - s.x)
        s.ang += Math.atan2(Math.sin(ang - s.ang), Math.cos(ang - s.ang)) * Math.min(1, dt * 4)
        const mouth = SHADOW_RX[s.def.size] + 1
        const d = Math.hypot(this.bx - s.x, this.by - s.y)
        if (this.fish === 'approach' && d > mouth) { const v = Math.min(d - mouth, 18 * dt); s.x += Math.cos(ang) * v; s.y += Math.sin(ang) * v }
        // 啄的时候往前一冲又退回来
        if (this.fish === 'nibble' || this.fish === 'bite') { const k = Math.max(0, this.dip) * 3; s.g.position.set(s.x + Math.cos(s.ang) * k, s.y + Math.sin(s.ang) * k) }
        s.g.alpha = Math.min(1, s.g.alpha + dt * 2)
      } else {
        // 闲逛：在同一片水里慢慢游、停一停
        s.wait -= dt
        if (s.wait <= 0) {
          const a = Math.random() * Math.PI * 2, r = 12 + Math.random() * 30
          const tx = s.x + Math.cos(a) * r, ty = s.y + Math.sin(a) * r
          if (this.locAt(tx, ty) === s.loc && this.locAt(tx + Math.cos(a) * 12, ty + Math.sin(a) * 12) === s.loc) { s.tx = tx; s.ty = ty }
          s.wait = 2 + Math.random() * 3
        }
        const d = Math.hypot(s.tx - s.x, s.ty - s.y)
        if (d > 1) {
          const ang = Math.atan2(s.ty - s.y, s.tx - s.x)
          s.ang += Math.atan2(Math.sin(ang - s.ang), Math.cos(ang - s.ang)) * Math.min(1, dt * 3)
          const v = Math.min(d, 10 * dt)
          s.x += Math.cos(s.ang) * v; s.y += Math.sin(s.ang) * v
        }
        s.g.alpha = Math.min(1, s.g.alpha + dt)
        // 离人太远就散了
        if (Math.hypot(s.x - me.x, s.y - me.y) > 22 * TILE) { s.g.destroy(); this.shadows.splice(i, 1); continue }
      }
      if (!(s === this.target && (this.fish === 'nibble' || this.fish === 'bite'))) s.g.position.set(s.x, s.y)
      s.g.rotation = s.ang
      // 尾巴摆一摆
      s.g.scale.set(1, 1 + Math.sin(time * 6 + i) * 0.06)
    }
  }

  // ═══ 钓鱼 ═══
  // 抛竿：对着面前 2.5 格左右的水；不是水返回 false
  cast(me: { x: number, y: number }, dir: Dir): boolean {
    const [dx, dy] = DIRV[dir]
    let tx = me.x + dx * TILE * 2.6, ty = me.y - 6 + dy * TILE * 2.6
    if (!this.waterAt(tx, ty)) { tx = me.x + dx * TILE * 1.7; ty = me.y - 6 + dy * TILE * 1.7 }
    if (!this.waterAt(tx, ty)) return false
    this.castFrom = { x: me.x, y: me.y }
    this.bx = tx; this.by = ty; this.bt = 0
    this.fish = 'cast'
    this.target = null
    this.bobber.visible = true
    this.audio.play('whoosh', 0.35, 1.3)
    return true
  }
  // 收竿：返回钓到的鱼（只有咬钩那一下收才算）
  reel(): FishDef | null {
    let got: FishDef | null = null
    if (this.fish === 'bite' && this.target) {
      got = this.target.def
      this.target.g.destroy()
      this.shadows = this.shadows.filter(s => s !== this.target)
      this.splash(this.bx, this.by, 10)
    } else if (this.target) this.fleeFish(this.target)
    this.target = null
    this.fish = 'idle'
    this.bobber.visible = false
    this.line.clear()
    this.audio.play('whoosh', 0.3, 1.6)
    return got
  }
  fishing() { return this.fish !== 'idle' }

  private splash(x: number, y: number, n: number) {
    for (let i = 0; i < n; i++) this.fx.spawn({ x: x + (Math.random() - 0.5) * 6, y, vx: (Math.random() - 0.5) * 40, vy: -20 - Math.random() * 30, ay: 120, life: 0.45, color: 0xe8fbff, w: 1.5, h: 1.5 })
  }
  private ripple(x: number, y: number, r: number) {
    const g = new Graphics()
    g.ellipse(0, 0, r, r * 0.45).stroke({ color: 0xffffff, alpha: 0.7, width: 1 })
    g.position.set(x, y)
    this.water.addChild(g)
    const t0 = performance.now()
    const step = () => { const k = (performance.now() - t0) / 600; g.scale.set(1 + k * 1.6); g.alpha = 1 - k; if (k < 1 && !g.destroyed) requestAnimationFrame(step); else if (!g.destroyed) g.destroy() }
    step()
  }

  private updateLine(dt: number, time: number, me: { x: number, y: number, moving: boolean }) {
    if (this.fish === 'idle') return
    // 走开了就收线（鱼会跑）
    if (Math.hypot(me.x - this.castFrom.x, me.y - this.castFrom.y) > 3) { this.reel(); return }
    if (this.fish === 'cast') {
      this.bt += dt / 0.38
      const k = Math.min(1, this.bt)
      const sx = me.x, sy = me.y - 24
      this.bobber.position.set(sx + (this.bx - sx) * k, sy + (this.by - sy) * k - Math.sin(k * Math.PI) * 26)
      if (k >= 1) {
        this.fish = 'wait'; this.timer = 0
        this.audio.play('water', 0.5, 1.2)
        this.ripple(this.bx, this.by, 4); this.splash(this.bx, this.by, 5)
        // 砸在鱼头上会把鱼吓跑
        for (const s of this.shadows) if (!s.flee && Math.hypot(s.x - this.bx, s.y - this.by) < SHADOW_RX[s.def.size] + 3) this.fleeFish(s)
      }
    } else {
      this.timer -= dt
      this.dip = Math.max(0, this.dip - dt * 6)
      if (this.fish === 'wait') {
        // 附近的鱼（嘴前方大致看得见浮漂）会游过来
        if (this.timer <= 0) {
          this.timer = 0.4
          const c = this.shadows.filter(s => !s.flee && Math.hypot(s.x - this.bx, s.y - this.by) < 70)
            .sort((a, b) => Math.hypot(a.x - this.bx, a.y - this.by) - Math.hypot(b.x - this.bx, b.y - this.by))[0]
          if (c && Math.random() < 0.6) { this.target = c; this.fish = 'approach' }
        }
      } else if (this.fish === 'approach' && this.target) {
        if (Math.hypot(this.target.x - this.bx, this.target.y - this.by) <= SHADOW_RX[this.target.def.size] + 1.5) {
          this.fish = 'nibble'; this.nibbles = Math.floor(Math.random() * 5); this.timer = 0.8 + Math.random() * 0.8
        }
      } else if (this.fish === 'nibble') {
        if (this.timer <= 0) {
          if (this.nibbles > 0) {
            this.nibbles--; this.dip = 0.35; this.timer = 0.9 + Math.random() * 1.1
            this.audio.play('plant', 0.35, 1.5); this.ripple(this.bx, this.by, 3)
          } else {
            // 真咬钩：浮漂整个沉下去，留给玩家一小会儿
            this.fish = 'bite'; this.timer = 0.65; this.dip = 1
            this.audio.play('splash', 0.6, 1.1); this.ripple(this.bx, this.by, 6); this.splash(this.bx, this.by, 8)
          }
        }
      } else if (this.fish === 'bite') {
        this.dip = 1
        if (this.timer <= 0) { if (this.target) this.fleeFish(this.target); this.target = null; this.fish = 'wait'; this.timer = 1.5 }
      }
      const bob = this.fish === 'bite' ? 4 : Math.sin(time * 3) * 0.6 + this.dip * 3
      this.bobber.position.set(this.bx, this.by + bob)
      this.bobber.alpha = this.fish === 'bite' ? 0.35 : 1
    }
    // 钓线：竿梢 → 浮漂，垂一点弧
    const sx = me.x + (this.bx > me.x + 4 ? 9 : this.bx < me.x - 4 ? -9 : 4), sy = me.y - 30
    const ex = this.bobber.x, ey = this.bobber.y - 2
    this.line.clear()
    this.line.moveTo(sx, sy).quadraticCurveTo((sx + ex) / 2, Math.max(sy, ey) + 6, ex, ey).stroke({ color: 0xf4f4f0, alpha: 0.75, width: 0.6 })
  }

  // ═══ 虫 ═══
  private spawnBug(me: { x: number, y: number }, month: number, hour: number, rain: boolean) {
    const def = pickWeighted(BUGS.filter(b => bugAvailable(b, month, hour, this.hemi) && !(rain && b.loc === 'fly')), Math.random())
    if (!def) return
    let x = 0, y = 0, found = false
    for (let tries = 0; tries < 16 && !found; tries++) {
      const a = Math.random() * Math.PI * 2, d = (5 + Math.random() * 10) * TILE
      x = me.x + Math.cos(a) * d; y = me.y + Math.sin(a) * d
      const t = this.typeAt(x, y)
      if (def.loc === 'flower') {
        const f = this.isle.objects.find(o => o.kind.startsWith('flower') && Math.hypot(o.x - x, o.y - y) < 5 * TILE && Math.hypot(o.x - me.x, o.y - me.y) > 4 * TILE)
        if (f) { x = f.x; y = f.y - 1; found = true }
      } else if (def.loc === 'beach') found = t === IT.SAND
      else found = t === IT.GRASS
      if (found && this.bugs.some(b => Math.hypot(b.x - x, b.y - y) < 48)) found = false
    }
    if (!found) return
    const tex = this.assets.icons_hd[def.icon] ?? Texture.WHITE
    const s = new Sprite(tex)
    s.anchor.set(0.5, 0.8)
    const w = def.loc === 'fly' ? 12 : def.loc === 'beach' ? 10 : 9
    s.scale.set(w / Math.max(1, tex.width))
    s.alpha = 0
    const sh = new Sprite(this.assets.shadow(8))
    sh.anchor.set(0.5); sh.alpha = 0.5
    this.entities.addChild(sh, s)
    this.bugs.push({ def, s, sh, x, y, z: def.loc === 'fly' ? 12 + Math.random() * 10 : def.loc === 'flower' ? 6 : 0, hx: x, hy: y, t: Math.random() * 10, flee: 0, hop: 1 + Math.random() * 3, w: s.scale.x })
  }

  private fleeBug(b: Bug) { if (!b.flee) b.flee = 1 }

  private updateBugs(dt: number, time: number, me: { x: number, y: number, moving: boolean, sneak: boolean }) {
    for (let i = this.bugs.length - 1; i >= 0; i--) {
      const b = this.bugs[i]
      b.t += dt
      const dMe = Math.hypot(b.x - me.x, b.y - me.y)
      // 跑过去会吓跑（蹑手蹑脚靠近就没事）
      if (!b.flee && me.moving && !me.sneak && dMe < 46) this.fleeBug(b)
      if (b.flee) {
        b.flee -= dt
        const a = Math.atan2(b.y - me.y, b.x - me.x)
        if (b.def.loc === 'beach') { b.s.alpha = Math.max(0, b.flee) }   // 寄居蟹缩回壳里、钻进沙子
        else { b.x += Math.cos(a) * 70 * dt; b.y += Math.sin(a) * 70 * dt; b.z += 40 * dt; b.s.alpha = Math.max(0, b.flee) }
        if (b.flee <= 0) { b.s.destroy(); b.sh.destroy(); this.bugs.splice(i, 1); continue }
      } else {
        b.s.alpha = Math.min(1, b.s.alpha + dt * 2)
        if (b.def.loc === 'fly') {
          // 绕着出生点忽高忽低地飞
          b.x = b.hx + Math.sin(b.t * 0.7) * 26 + Math.sin(b.t * 1.9) * 8
          b.y = b.hy + Math.cos(b.t * 0.5) * 16
          b.z = 14 + Math.sin(b.t * 2.3) * 5
        } else if (b.def.loc === 'ground') {
          b.hop -= dt
          if (b.hop <= 0) { b.hop = 1.5 + Math.random() * 3; const a = Math.random() * Math.PI * 2; const nx = b.x + Math.cos(a) * 14, ny = b.y + Math.sin(a) * 10; if (this.typeAt(nx, ny) === IT.GRASS) { b.x = nx; b.y = ny } }
          b.z = Math.max(0, b.hop > 1.3 ? Math.sin((b.hop - 1.3) / 0.2 * Math.PI) * 6 : 0)
        } else if (b.def.loc === 'beach') {
          b.hop -= dt
          if (b.hop <= 0) { b.hop = 2 + Math.random() * 3; const nx = b.x + (Math.random() - 0.5) * 16; if (this.typeAt(nx, b.y) === IT.SAND) b.x = nx }
        }
        if (dMe > 24 * TILE) { b.s.destroy(); b.sh.destroy(); this.bugs.splice(i, 1); continue }
      }
      b.s.position.set(b.x, b.y - b.z)
      b.s.zIndex = b.y + (b.z > 4 ? 40 : 1)
      // 翅膀扇动
      if (b.def.loc === 'fly') b.s.scale.x = b.w * (0.45 + 0.55 * Math.abs(Math.sin(time * 18 + i)))
      b.sh.position.set(b.x, b.y); b.sh.zIndex = b.y - 1
      b.sh.visible = b.z > 2
      b.sh.alpha = 0.4 * b.s.alpha
    }
  }

  // 挥网：网头在面前 16 像素；抓到返回那只虫，没抓到把附近的虫吓跑
  swingNet(me: { x: number, y: number }, dir: Dir): BugDef | null {
    const [dx, dy] = DIRV[dir]
    const nx = me.x + dx * 16, ny = me.y - 4 + dy * 14
    const hit = this.bugs.filter(b => !b.flee && Math.hypot(b.x - nx, b.y - ny) < 20 && b.z < 30)
      .sort((a, b) => Math.hypot(a.x - nx, a.y - ny) - Math.hypot(b.x - nx, b.y - ny))[0]
    this.audio.play('whoosh', 0.35, 1.8)
    if (hit) {
      hit.s.destroy(); hit.sh.destroy()
      this.bugs = this.bugs.filter(b => b !== hit)
      return hit.def
    }
    for (const b of this.bugs) if (Math.hypot(b.x - nx, b.y - ny) < 70) this.fleeBug(b)
    return null
  }

  destroy() {
    for (const s of this.shadows) s.g.destroy()
    for (const b of this.bugs) { b.s.destroy(); b.sh.destroy() }
    this.shadows = []; this.bugs = []
    this.water.destroy({ children: true })
  }
}
