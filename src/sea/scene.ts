// 海底场景（侧视）：水体着色器背景 + 视差远景 + 烘焙岩石（焦散）+ 珊瑚装饰 +
// 网格变形游动的鱼 + 潜水员 + 鱼枪 + 气泡/海雪粒子 + 手电筒光锥
import { Container, Graphics, MeshPlane, Sprite, Text, Texture, TilingSprite } from 'pixi.js'
import type { Game, Scene } from '../game.ts'
import { PixelView } from '../core/pixelview.ts'
import { canvas, texFrom } from '../core/assets.ts'
import { Particles } from '../fx/particles.ts'
import { Swayer, swaySplit } from '../fx/sway.ts'
import { bakeSea } from './terrain.ts'
import { makeBackgroundFilter, makeCausticFilter } from './filters.ts'
import type { WorldFilter } from './filters.ts'
import { buildSea, buildSeaDecor, seaSolid, SEA_W, SEA_H, BOAT_X, PX_PER_METER, ZONES, zoneAt, SEA_FINDS } from '../../shared/sea.ts'
import type { SeaMap, SeaDecor } from '../../shared/sea.ts'
import { FISH, TANKS, HARPOONS, BASKETS, PRESSURE_LIMIT_Y, TILE, SHARKS, BITE_INVULN_MS, ITEMS } from '../../shared/data.ts'
import { PLACES } from '../../shared/island.ts'
import type { FishPublic, PlayerPublic } from '../../shared/protocol.ts'
import { state } from '../state.ts'

let baked: { map: SeaMap, rock: Texture, mask: Texture, decor: SeaDecor[] } | null = null
const extracted = new Map<string, Texture>()

// 网格变形要求纹理是独立的一整张图，从图集里把鱼单独拷出来
function standalone(t: Texture, key: string): Texture {
  const hit = extracted.get(key)
  if (hit) return hit
  const f = t.frame
  const { c, g } = canvas(f.width, f.height)
  g.drawImage(t.source.resource as CanvasImageSource, f.x, f.y, f.width, f.height, 0, 0, f.width, f.height)
  const out = texFrom(c)
  extracted.set(key, out)
  return out
}

function bubbleTexture(): Texture {
  const { c, g } = canvas(3, 3)
  g.fillStyle = '#e9fbff'
  for (const [x, y] of [[1, 0], [0, 1], [2, 1], [1, 2]]) g.fillRect(x, y, 1, 1)
  return texFrom(c)
}

class FishView {
  mesh: MeshPlane
  base: Float32Array
  x: number; y: number; tx: number; ty: number; vx = 0; vy = 0
  face = 1
  phase = Math.random() * 10
  flash = 0
  dying = 0
  light?: Sprite
  mad = false      // 鲨鱼正在追人
  w: number; h: number

  constructor(public id: number, public kind: string, tex: Texture, x: number, y: number) {
    this.w = tex.width; this.h = tex.height
    this.mesh = new MeshPlane({ texture: tex, verticesX: 10, verticesY: 2 })
    this.mesh.pivot.set(this.w / 2, this.h / 2)
    this.base = new Float32Array(this.mesh.geometry.getBuffer('aPosition').data as Float32Array)
    this.x = this.tx = x; this.y = this.ty = y
  }

  update(dt: number, time: number) {
    const k = 1 - Math.exp(-dt * 6)
    this.tx += this.vx * dt; this.ty += this.vy * dt
    this.x += (this.tx - this.x) * k; this.y += (this.ty - this.y) * k
    if (Math.abs(this.vx) > 4) this.face = this.vx > 0 ? 1 : -1
    const def = FISH[this.kind]
    const speed = Math.hypot(this.vx, this.vy)
    const jelly = this.kind.startsWith('jelly')
    // 尾部摆动：离头越远幅度越大；游得越快频率越高
    const buf = this.mesh.geometry.getBuffer('aPosition')
    const pos = buf.data as Float32Array
    const freq = jelly ? 2.2 : 5 + speed * 0.12
    const amp = jelly ? this.h * 0.06 : Math.min(3.5, this.h * 0.09) * (0.6 + Math.min(1, speed / 40))
    for (let i = 0; i < pos.length; i += 2) {
      const bx = this.base[i], by = this.base[i + 1]
      if (jelly) {
        // 水母：伞盖一张一缩，触手随波
        const v = by / this.h
        const pulse = Math.sin(time * freq + this.phase)
        pos[i] = this.w / 2 + (bx - this.w / 2) * (1 + pulse * 0.08 * (1 - v))
        pos[i + 1] = by + Math.sin(time * freq + this.phase - v * 2) * amp * v
      } else {
        const u = bx / this.w // 0 = 尾（素材都朝右）
        pos[i] = bx
        pos[i + 1] = by + Math.sin(time * freq + this.phase - u * 3.6) * amp * Math.pow(1 - u, 1.5)
      }
    }
    buf.update()
    this.mesh.position.set(Math.round(this.x), Math.round(this.y))
    this.mesh.scale.x = jelly ? 1 : this.face
    this.mesh.rotation = jelly ? Math.sin(time + this.phase) * 0.08 : Math.max(-0.35, Math.min(0.35, Math.atan2(this.vy, Math.abs(this.vx) + 1))) * this.face
    if (this.flash > 0) { this.flash -= dt; this.mesh.tint = Math.floor(this.flash * 20) % 2 ? 0xffffff : 0xff9a9a } else this.mesh.tint = 0xffffff
    if (this.light) { this.light.position.set(this.x, this.y); this.light.alpha = 0.7 + Math.sin(time * 2 + this.phase) * 0.2 }
    void def
  }

  destroy() { this.mesh.destroy(); this.light?.destroy() }
}

class Diver {
  root = new Container()
  body = new Sprite()
  x: number; y: number; tx: number; ty: number
  vx = 0; vy = 0
  face = 1
  aim = 0
  animT = 0
  bubbleT = Math.random() * 2
  tag: Text
  cone: Sprite
  glow: Sprite

  constructor(private frames: Record<string, Texture>, name: string, isMe: boolean, lights: Container, light: Texture, coneTex: Texture, x: number, y: number) {
    this.x = this.tx = x; this.y = this.ty = y
    this.body.anchor.set(0.5)
    this.root.addChild(this.body)
    this.tag = new Text({ text: name, style: { fontFamily: 'FusionPixel', fontSize: 24, fill: isMe ? 0xfff2c4 : 0xffffff, stroke: { color: 0x06243e, width: 4 } }, resolution: 1 })
    this.tag.anchor.set(0.5, 1)
    this.cone = new Sprite(coneTex); this.cone.anchor.set(0, 0.5); this.cone.blendMode = 'add'; this.cone.tint = 0xfff1c8
    this.glow = new Sprite(light); this.glow.anchor.set(0.5); this.glow.blendMode = 'add'; this.glow.tint = 0xbfe8ff
    lights.addChild(this.cone, this.glow)
  }

  update(dt: number, depthLight: number) {
    const speed = Math.hypot(this.vx, this.vy)
    this.animT += dt * (0.8 + speed / 40)
    this.body.texture = this.frames[`swim_${Math.floor(this.animT * 5) % 4}`] ?? this.body.texture
    const tilt = Math.max(-0.6, Math.min(0.6, Math.atan2(this.vy, Math.abs(this.vx) + 20)))
    this.body.scale.x = this.face
    this.body.rotation += (tilt * this.face - this.body.rotation) * Math.min(1, dt * 6)
    // 静止时轻微上下漂浮
    this.root.position.set(Math.round(this.x), Math.round(this.y + (speed < 10 ? Math.sin(this.animT * 2) * 1.5 : 0)))
    this.cone.position.set(this.x + this.face * 22, this.y - 6)
    this.cone.rotation = this.aim
    this.cone.scale.set(1.35)
    this.cone.alpha = depthLight * 0.9
    this.glow.position.set(this.x, this.y)
    this.glow.scale.set(60 / 64)
    this.glow.alpha = depthLight * 0.45
  }

  destroy() { this.root.destroy({ children: true }); this.tag.destroy(); this.cone.destroy(); this.glow.destroy() }
}

interface Spear { x: number, y: number, dx: number, dy: number, dist: number, back: boolean, mine: boolean, owner: Diver, hit: boolean, range: number, tip: number }

export class SeaScene implements Scene {
  view: PixelView
  overlay = new Container()
  map: SeaMap
  bgSprite = new Sprite(Texture.WHITE)
  bgFilter: WorldFilter = makeBackgroundFilter()
  causticFilter!: WorldFilter
  rock: Sprite
  parallax: { s: TilingSprite, baseY: number, f: number }[] = []
  farLife = new Container()
  decorLayer = new Container()
  fishLayer = new Container()
  diverLayer = new Container()
  fx = new Particles()
  spearG = new Graphics()
  // 海草海葵：上下两段整块平移；海带：底节用 Swayer，往上叠的每一节整体偏移 k 像素（stack = k）
  decor: { s: Container, d: SeaDecor, phase: number, sw?: Swayer, stack?: number, baseX?: number }[] = []
  fish = new Map<number, FishView>()
  me: Diver
  others = new Map<number, Diver>()
  spears: Spear[] = []
  tank = TANKS[state.gear.tank]
  gun = HARPOONS[state.gear.harpoon]
  oxygen = this.tank.oxygen
  cooldown = 0
  bubbleTex = bubbleTexture()
  boat!: Sprite
  private unsub: (() => void)[] = []
  private sendT = 0
  private snowT = 0
  private lifeT = 3
  private ending = false
  private catchCount = 0
  private hurtUntil = 0   // 被咬后的无敌闪烁截止（performance.now）
  alertG = new Graphics()
  private zoomCd = 0
  private pressed = false
  private touchAim = 0      // 触屏：手指没按着时的瞄准方向（弧度）
  // 剧情物品：接了任务才在水底一闪一闪
  private finds: { id: string, item: string, quest: string, s: Sprite, l: Sprite }[] = []

  constructor(private g: Game) {
    const { assets } = g
    this.view = new PixelView(g.app.renderer as any, 360, 'sea')
    this.view.mapW = SEA_W; this.view.mapH = SEA_H + 150
    if (!baked) { const map = buildSea(); const b = bakeSea(map); baked = { map, rock: b.rock, mask: b.mask, decor: buildSeaDecor(map) } }
    this.map = baked.map
    const W = this.view.world

    this.bgSprite.filters = [this.bgFilter]
    for (const [tex, baseY, f, alpha] of [[assets.bgReef, 380, 0.45, 0.55], [assets.bgDeep, 1250, 0.4, 0.5]] as const) {
      const s = new TilingSprite({ texture: tex, width: 800, height: tex.height })
      s.alpha = alpha
      this.parallax.push({ s, baseY, f })
    }
    this.farLife.alpha = 0.45
    this.causticFilter = makeCausticFilter(baked.mask)
    this.rock = new Sprite(baked.rock)
    this.rock.filters = [this.causticFilter]
    // 侧视潜水船：约三成船身在水下（水下部分由后处理自动染上水色）
    const boat = new Sprite(assets.sea.boat_side)
    boat.position.set(BOAT_X, Math.round(boat.height * 0.3))
    this.boat = boat
    W.addChild(this.bgSprite, ...this.parallax.map(p => p.s), this.farLife, boat, this.decorLayer, this.rock, this.fishLayer, this.diverLayer, this.fx.layer, this.spearG)

    // 珊瑚海草：底座压在岩石表面，按种类决定摆动幅度
    for (const d of baked.decor) {
      const tex = assets.sea[d.kind]
      if (!tex) continue
      const sways = d.kind === 'kelp' || ['seagrass', 'anemone_green', 'anemone_purple', 'seafan', 'glow_plant'].includes(d.kind)
      const sw = sways ? new Swayer(tex, swaySplit(d.kind)) : undefined
      const s: Container = sw ? sw.root : new Sprite(tex)
      if (!sw) (s as Sprite).anchor.set(0.5, 1)
      s.position.set(Math.round(d.x), Math.round(d.y))
      if (d.flip) s.scale.x = -1
      this.decorLayer.addChild(s)
      const phase = Math.random() * 6
      // 海带长成一整片：在上面再叠一到两节，越往上的节摆得越开
      if (d.kind === 'kelp') for (let k = 1; k <= 1 + Math.floor(Math.random() * 2); k++) {
        const s2 = new Sprite(tex); s2.anchor.set(0.5, 1)
        const bx = Math.round(s.x + (Math.random() - 0.5) * 3)
        s2.position.set(bx, s.y - k * (tex.height - 6))
        if (Math.random() < 0.5) s2.scale.x = -1
        this.decorLayer.addChild(s2)
        this.decor.push({ s: s2, d, phase, stack: k, baseX: bx })
      }
      this.decor.push({ s, d, phase, sw })
      if (d.glow) {
        const l = new Sprite(assets.light); l.anchor.set(0.5); l.tint = d.glow; l.blendMode = 'add'
        l.position.set(d.x, d.y - 10); l.scale.set(40 / 64); l.alpha = 0.8
        this.view.lights.addChild(l)
      }
    }

    for (const [id, fd] of Object.entries(SEA_FINDS)) {
      const tex = assets.icons[ITEMS[fd.item]?.icon ?? fd.item]
      if (!tex) continue
      const s = new Sprite(tex); s.anchor.set(0.5, 1); s.position.set(fd.x, fd.y + 8)
      this.decorLayer.addChild(s)
      const l = new Sprite(assets.light); l.anchor.set(0.5); l.tint = 0xfff2a8; l.blendMode = 'add'; l.position.set(fd.x, fd.y); l.scale.set(30 / 64)
      this.view.lights.addChild(l)
      this.finds.push({ id, item: fd.item, quest: fd.quest, s, l })
    }

    this.me = new Diver(assets.chars, state.me.name, true, this.view.lights, assets.light, assets.cone, BOAT_X, 40)
    this.diverLayer.addChild(this.me.root)
    this.overlay.addChild(this.me.tag, this.alertG)
    g.app.stage.addChild(this.view.display, this.overlay)

    this.unsub.push(
      g.net.on('fish', m => this.syncFish(m.list)),
      g.net.on('players', m => this.syncPlayers(m.list)),
      g.net.on('left', m => { this.others.get(m.id)?.destroy(); this.others.delete(m.id) }),
      g.net.on('fishHit', m => { const f = this.fish.get(m.fish); if (f) { f.flash = 0.4; this.burst(f.x, f.y, 5) } }),
      g.net.on('caught', m => this.onCaught(m.fish, m.by, m.kind)),
      g.net.on('bitten', m => this.onBitten(m.shark, m.bite, m.dx, m.dy)),
      g.net.on('shot', m => { const o = this.others.get(m.by); if (o) this.spears.push({ x: m.x, y: m.y, dx: m.dx, dy: m.dy, dist: 0, back: false, mine: false, owner: o, hit: false, range: HARPOONS[m.gun ?? 0].range, tip: HARPOONS[m.gun ?? 0].tip }) }),
    )
    this.view.post.set('uMode', 1)
    this.view.post.set('uClouds', 0)
    this.view.post.set('uSat', 1.05)
    this.view.post.set('uLightGain', 1.25)
    g.hud.setSeaMode(true)
    g.hud.showZone('潜入海中')
    g.audio.playMusic('sea')
    g.audio.setAmbient('underwater', 1)
    // 入水水花
    for (let i = 0; i < 30; i++) this.fx.spawn({ texture: this.bubbleTex, x: BOAT_X + (Math.random() - 0.5) * 30, y: 30 + Math.random() * 20, vx: (Math.random() - 0.5) * 40, vy: -20 - Math.random() * 40, life: 1.5, color: 0xffffff, wobble: 20 })
  }

  private syncFish(list: FishPublic[]) {
    const seen = new Set<number>()
    for (const p of list) {
      seen.add(p.id)
      let f = this.fish.get(p.id)
      if (!f) {
        const tex = this.g.assets.sea[FISH[p.kind]?.sprite ?? p.kind]
        if (!tex) continue
        f = new FishView(p.id, p.kind, standalone(tex, p.kind), p.x, p.y)
        const glow = FISH[p.kind]?.glow
        if (glow) {
          f.light = new Sprite(this.g.assets.light); f.light.anchor.set(0.5); f.light.blendMode = 'add'
          f.light.tint = parseInt(glow.slice(1), 16); f.light.scale.set(46 / 64)
          this.view.lights.addChild(f.light)
        }
        this.fishLayer.addChild(f.mesh)
        this.fish.set(p.id, f)
      }
      if (f.dying) continue
      f.tx = p.x; f.ty = p.y; f.vx = p.vx; f.vy = p.vy; f.mad = !!p.mad
    }
    for (const [id, f] of this.fish) if (!seen.has(id) && !f.dying) { f.destroy(); this.fish.delete(id) }
  }

  private syncPlayers(list: PlayerPublic[]) {
    const seen = new Set<number>()
    for (const p of list) {
      if (p.scene !== 'sea') continue
      seen.add(p.id)
      let d = this.others.get(p.id)
      if (!d) {
        d = new Diver(this.g.assets.chars, p.name, false, this.view.lights, this.g.assets.light, this.g.assets.cone, p.x, p.y)
        this.diverLayer.addChild(d.root)
        this.overlay.addChild(d.tag)
        this.others.set(p.id, d)
      }
      d.vx = (p.x - d.tx) * 10; d.vy = (p.y - d.ty) * 10
      d.tx = p.x; d.ty = p.y
      d.face = p.dir === 'left' ? -1 : 1
    }
    for (const [id, d] of this.others) if (!seen.has(id)) { d.destroy(); this.others.delete(id) }
  }

  private onCaught(id: number, by: number, kind: string) {
    const f = this.fish.get(id)
    if (by === state.me.id) {
      this.catchCount++
      this.g.hud.toast(`抓到了 ${FISH[kind]?.name ?? kind}！`, 'catch')
      this.g.audio.play('catch', 0.6)
      this.view.post.set('uFlash', 0.25)
    }
    if (f) { f.dying = 1; this.burst(f.x, f.y, 10) }
  }

  // 被鲨鱼咬：扣氧气、被撞开、屏幕闪红，之后一小段时间无敌（角色闪烁）
  private onBitten(id: number, bite: number, dx: number, dy: number) {
    if (this.ending) return
    const me = this.me
    this.oxygen -= bite
    me.vx += dx * 260; me.vy += dy * 200
    this.hurtUntil = performance.now() + BITE_INVULN_MS
    const kind = this.fish.get(id)?.kind
    this.g.hud.toast(`被${SHARKS[kind ?? '']?.name ?? '鲨鱼'}咬了一口！氧气 -${bite} 秒`)
    this.g.hud.hurt()
    this.g.audio.play('hit', 0.7, 0.6)
    this.burst(me.x, me.y, 14)
    for (let i = 0; i < 10; i++) this.fx.spawn({ x: me.x + (Math.random() - 0.5) * 16, y: me.y + (Math.random() - 0.5) * 10, vx: (Math.random() - 0.5) * 40, vy: (Math.random() - 0.5) * 30, drag: 2, life: 1.2, color: 0xb83a3a, alpha: 0.7, w: 2, h: 2 })
  }

  private burst(x: number, y: number, n: number) {
    for (let i = 0; i < n; i++) this.fx.spawn({ texture: this.bubbleTex, x: x + (Math.random() - 0.5) * 12, y: y + (Math.random() - 0.5) * 8, vx: (Math.random() - 0.5) * 50, vy: -20 - Math.random() * 40, drag: 1.5, life: 1 + Math.random(), color: 0xffffff, wobble: 16 })
  }

  private solidCircle(x: number, y: number, r: number) {
    for (let a = 0; a < 8; a++) {
      const ang = (a / 8) * Math.PI * 2
      if (seaSolid(this.map, x + Math.cos(ang) * r, y + Math.sin(ang) * r * 0.6)) return true
    }
    return false
  }

  private shoot() {
    const { input } = this.g
    const me = this.me
    const w = this.view.screenToWorld(input.mouseX, input.mouseY)
    let dx = w.x - me.x, dy = w.y - me.y
    if (!input.aimValid) { dx = Math.cos(this.touchAim); dy = Math.sin(this.touchAim) }
    const len = Math.hypot(dx, dy) || 1
    dx /= len; dy /= len
    me.face = dx < 0 ? -1 : 1
    this.cooldown = this.gun.cooldown
    const sx = me.x + dx * 16, sy = me.y + dy * 10
    this.spears.push({ x: sx, y: sy, dx, dy, dist: 0, back: false, mine: true, owner: me, hit: false, range: this.gun.range, tip: this.gun.tip })
    this.g.net.send({ t: 'shoot', x: sx, y: sy, dx, dy })
    this.g.audio.play('shoot', 0.45)
  }

  private updateSpears(dt: number) {
    const gfx = this.spearG
    gfx.clear()
    for (let i = this.spears.length - 1; i >= 0; i--) {
      const s = this.spears[i]
      const o = s.owner
      if (!s.back) {
        const step = 560 * dt
        s.x += s.dx * step; s.y += s.dy * step; s.dist += step
        if (s.dist >= s.range || seaSolid(this.map, s.x, s.y)) {
          s.back = true
          if (seaSolid(this.map, s.x, s.y)) { this.burst(s.x, s.y, 3); if (s.mine) this.g.audio.play('hit', 0.25, 0.7) }
        }
        if (s.mine && !s.hit) {
          for (const f of this.fish.values()) {
            if (f.dying) continue
            const r = Math.max(8, Math.min(f.w, f.h * 1.6) * 0.45)
            if (Math.hypot(f.x - s.x, f.y - s.y) < r) {
              s.hit = true; s.back = true
              f.flash = 0.4
              this.g.net.send({ t: 'hit', fish: f.id })
              this.g.audio.play('hit', 0.55)
              this.burst(s.x, s.y, 4)
              break
            }
          }
        }
      } else {
        // 收回
        const dx = o.x - s.x, dy = o.y - s.y, d = Math.hypot(dx, dy)
        if (d < 14) { this.spears.splice(i, 1); continue }
        s.x += (dx / d) * 720 * dt; s.y += (dy / d) * 720 * dt
      }
      // 绳子 + 枪头
      gfx.moveTo(o.x + o.face * 12, o.y).lineTo(s.x, s.y).stroke({ color: 0xd8e6ea, width: 1, alpha: 0.6 })
      gfx.moveTo(s.x - s.dx * 10, s.y - s.dy * 10).lineTo(s.x, s.y).stroke({ color: 0x3a4250, width: 2 })
      gfx.rect(Math.round(s.x) - 1, Math.round(s.y) - 1, 2, 2).fill(s.tip)
    }
  }

  private end(lost: boolean) {
    if (this.ending) return
    this.ending = true
    this.g.net.send({ t: 'surface', lost })
    this.g.meStart = { x: (PLACES.diveSpot.x0 + 2) * TILE, y: (PLACES.diveSpot.y0 + 0.6) * TILE }
    this.g.switchTo('island')
  }

  update(dt: number, time: number) {
    const { input, hud, audio, net } = this.g
    const me = this.me
    const v = this.view
    this.cooldown -= dt

    // ── 游动：加速度 + 水阻，轻微浮力 ──
    const ax = this.ending ? { x: 0, y: 0 } : input.axis()
    const acc = 360, maxV = 120
    me.vx += ax.x * acc * dt; me.vy += ax.y * acc * dt
    const drag = Math.exp(-dt * 2.2)
    me.vx *= drag; me.vy *= drag
    me.vy -= 6 * dt
    // 水压：没有高压气瓶下不去蓝洞深处。越界后像弹簧一样往上托，并吃掉往下的速度，
    // 一直按着下潜会稳稳停在界线下几个像素，不会来回抖
    const over = this.tank.deep ? 0 : me.y - PRESSURE_LIMIT_Y
    if (over > 0) {
      me.vy -= (200 + over * 18) * dt
      if (me.vy > 0) me.vy *= Math.exp(-dt * 8)
    }
    const sp = Math.hypot(me.vx, me.vy)
    if (sp > maxV) { me.vx *= maxV / sp; me.vy *= maxV / sp }
    const nx = me.x + me.vx * dt, ny = me.y + me.vy * dt
    if (!this.solidCircle(nx, me.y, 10)) me.x = nx; else me.vx *= -0.2
    if (!this.solidCircle(me.x, ny, 10)) me.y = ny; else me.vy *= -0.2
    if (me.y < 8) { me.y = 8; me.vy = Math.max(0, me.vy) }
    if (!this.tank.deep && me.y > PRESSURE_LIMIT_Y + 16) { me.y = PRESSURE_LIMIT_Y + 16; me.vy = Math.min(me.vy, 0) }
    me.x = Math.max(20, Math.min(SEA_W - 20, me.x))
    const mw = v.screenToWorld(input.mouseX, input.mouseY)
    if (!input.aimValid && (input.stick.x || input.stick.y)) this.touchAim = Math.atan2(input.stick.y, input.stick.x)
    else if (!input.aimValid && Math.abs(me.vx) > 12) this.touchAim = me.vx < 0 ? Math.PI : 0
    const aimAng = input.aimValid ? Math.atan2(mw.y - me.y, mw.x - me.x) : this.touchAim
    if (Math.abs(me.vx) > 12) me.face = me.vx < 0 ? -1 : 1
    me.aim = aimAng
    if (!input.typing() && (input.clicked || input.hit(' ')) && this.cooldown <= 0 && !this.ending) this.shoot()

    // ── 缩放 ──
    this.zoomCd -= dt
    if (!input.typing()) {
      const zin = input.hit('+', '=') || (input.wheel < 0 && this.zoomCd <= 0)
      const zout = input.hit('-', '_') || (input.wheel > 0 && this.zoomCd <= 0)
      if ((zin || zout) && v.zoomBy(zin ? 1 : -1)) { v.camX = me.x - v.viewW / 2; v.camY = me.y - v.viewH / 2; this.zoomCd = 0.12 }
    }

    // ── 氧气 ──
    const depth = me.y
    const tank = this.tank
    this.oxygen -= dt * (zoneAt(depth) === 'deep' ? tank.deepDrain : 1)
    if (depth < 20) this.oxygen = Math.min(tank.oxygen, this.oxygen + dt * 8)
    hud.setOxygen(this.oxygen / tank.oxygen)
    const cap = BASKETS[state.gear.basket].cap
    hud.setBasket(this.catchCount, cap)
    hud.setDepth(depth / PX_PER_METER)
    const pressed = !tank.deep && depth > PRESSURE_LIMIT_Y - 6
    hud.setPressure(pressed)
    if (pressed && !this.pressed) audio.play('error', 0.35)
    this.pressed = pressed
    hud.showZone(ZONES[zoneAt(depth)].name)
    if (this.oxygen <= 0) { this.oxygen = 0; hud.toast('氧气耗尽……被船员拉了上来'); this.end(true) }
    const atBoat = depth < 40 && Math.abs(me.x - BOAT_X) < 90
    // 剧情物品：任务在身、还没捡到就闪光；游到跟前按 E 捡
    let find: (typeof this.finds)[number] | undefined
    for (const fd of this.finds) {
      const on = !!state.story?.quests.some(q => q.id === fd.quest) && !state.me.inv.some(x => x?.id === fd.item)
      fd.s.visible = on; fd.l.visible = on
      if (!on) continue
      const tw = 0.5 + 0.5 * Math.sin(time * 5 + fd.s.x)
      fd.l.alpha = 0.35 + tw * 0.65
      if (Math.random() < dt * 3) this.fx.spawn({ x: fd.s.x + (Math.random() - 0.5) * 10, y: fd.s.y - 6 - Math.random() * 6, vy: -6, life: 0.6, color: 0xfff6c8 })
      if (Math.hypot(me.x - fd.s.x, me.y - (fd.s.y - 8)) < 34) find = fd
    }
    if (find && !this.ending) {
      hud.hint(`<b>E</b> 捡起${ITEMS[find.item].name}`)
      if (input.hit('e')) { net.send({ t: 'seaFind', id: find.id }); audio.play('catch', 0.5) }
    } else hud.hint(atBoat ? `<b>E</b> 回到船上${this.catchCount ? `（这次抓了 ${this.catchCount} 条）` : ''}`
      : this.catchCount >= cap ? `鱼篓满了（${cap} 条），回船上卸货吧`
      : pressed ? '水压太大，耳朵嗡嗡响……要下蓝洞深处得换<b>高压气瓶</b>（找小珊升级）'
      : this.oxygen < tank.oxygen * 0.25 ? '氧气不足，快上浮！' : null)
    if (atBoat && input.hit('e')) this.end(false)

    // ── 气泡 ──
    me.bubbleT -= dt
    if (me.bubbleT <= 0) {
      me.bubbleT = 2 + Math.random() * 1.5
      for (let i = 0; i < 4; i++) setTimeout(() => this.fx.spawn({ texture: Math.random() < 0.5 ? this.bubbleTex : undefined, x: me.x + me.face * 14, y: me.y - 8, vx: 0, vy: -26 - Math.random() * 20, life: Math.min(4, me.y / 40), color: 0xe9fbff, wobble: 18, w: 1, h: 1 }), i * 90)
    }

    // ── 实体 ──
    const depthLight = Math.min(1, Math.max(0, (depth - 280) / 600))
    me.update(dt, depthLight)
    for (const d of this.others.values()) {
      const k = 1 - Math.exp(-dt * 10)
      d.x += (d.tx - d.x) * k; d.y += (d.ty - d.y) * k
      d.aim = d.face > 0 ? 0.15 : Math.PI - 0.15
      d.update(dt, Math.min(1, Math.max(0, (d.y - 280) / 600)))
    }
    for (const [id, f] of this.fish) {
      if (f.dying) {
        // 被抓住：往抓鱼的人身上缩过去
        f.dying -= dt * 2.5
        f.x += (me.x - f.x) * dt * 4; f.y += (me.y - f.y) * dt * 4
        f.mesh.scale.set(f.face * Math.max(0.1, f.dying), Math.max(0.1, f.dying))
        f.mesh.position.set(Math.round(f.x), Math.round(f.y))
        if (f.dying <= 0) { f.destroy(); this.fish.delete(id) }
        continue
      }
      f.update(dt, time)
    }
    this.updateSpears(dt)
    me.body.alpha = performance.now() < this.hurtUntil && Math.floor(time * 12) % 2 ? 0.35 : 1
    this.boat.y = Math.round(this.boat.height * 0.3 + Math.sin(time * 1.2) * 1.5)
    const current = Math.sin(time * 0.35) * 0.6 + Math.sin(time * 1.3) * 0.25   // 洋流
    for (const d of this.decor) {
      if (d.sw) d.sw.update(time, current)
      else if (d.stack) d.s.x = d.baseX! + Math.round((Math.sin(time * 0.8 + d.phase) * 0.6 + current * 0.6) * (d.stack + 0.5))
    }

    // ── 摄像机 ──
    const k = 1 - Math.exp(-dt * 5)
    v.camX += (me.x - v.viewW / 2 - v.camX) * k
    v.camY += (me.y - v.viewH / 2 - v.camY) * k
    v.camX = Math.max(0, Math.min(SEA_W - v.viewW, v.camX))
    v.camY = Math.max(-150, Math.min(SEA_H - v.viewH, v.camY))
    const ox = Math.floor(v.camX) - 1, oy = Math.floor(v.camY) - 1
    this.bgSprite.position.set(ox, oy)
    this.bgSprite.width = v.vw; this.bgSprite.height = v.vh
    this.bgFilter.update(ox, oy, time)
    this.causticFilter.update(ox, oy, time)
    for (const p of this.parallax) {
      p.s.x = ox; p.s.width = v.vw
      p.s.tilePosition.x = -v.camX * p.f
      // 远景图顶部画着海面波纹，不能被推到真正的海面以上
      p.s.y = Math.max(24, Math.round(p.baseY - p.s.height / 2 + (v.camY + v.viewH / 2 - p.baseY) * (1 - p.f)))
    }

    // ── 海雪、远处的大家伙 ──
    this.snowT -= dt
    if (this.snowT <= 0) {
      this.snowT = 0.05
      this.fx.spawn({ x: v.camX + Math.random() * v.viewW, y: v.camY + Math.random() * v.viewH, vx: 4, vy: 5, life: 4, color: 0xcfe9ef, alpha: 0.5, wobble: 5 })
    }
    this.lifeT -= dt
    if (this.lifeT <= 0) {
      this.lifeT = 8 + Math.random() * 10
      // 真鲨鱼现在是会咬人的敌人，远景里只留海龟和小鲨鱼，免得分不清
      const kind = ['turtle', 'shark_pup', 'turtle'][Math.floor(Math.random() * 3)]
      const tex = this.g.assets.sea[kind]
      // 只在海面以下游：镜头贴着海面时视野上半截是天空，不能刷在那里
      const y0 = Math.max(v.camY + 40, 90), y1 = v.camY + v.viewH - 40
      if (tex && y1 > y0) {
        const fromLeft = Math.random() < 0.5
        const y = y0 + Math.random() * (y1 - y0)
        const f = new FishView(-1, kind, standalone(tex, kind), fromLeft ? v.camX - 120 : v.camX + v.viewW + 120, y)
        f.vx = (fromLeft ? 1 : -1) * (kind === 'turtle' ? 22 : 38); f.vy = 0
        f.mesh.tint = 0x88a8c8
        this.farLife.addChild(f.mesh)
        const tick = (tdt: number) => { f.update(tdt, this.g.time); if (Math.abs(f.x - (v.camX + v.viewW / 2)) > v.viewW + 300) { this.g.app.ticker.remove(tick2); f.destroy() } }
        const tick2 = () => tick(this.g.app.ticker.deltaMS / 1000)
        this.g.app.ticker.add(tick2)
        this.unsub.push(() => { this.g.app.ticker.remove(tick2); if (!f.mesh.destroyed) f.destroy() })
      }
    }
    this.fx.update(dt, time)
    v.post.set('uFlash', Math.max(0, (v.post.resources.post.uniforms.uFlash as number) - dt))

    // ── 名牌；追人的鲨鱼头顶一闪一闪的红色感叹号（画在屏幕层，深水里也不会被压暗）──
    const ag = this.alertG
    ag.clear()
    for (const f of this.fish.values()) {
      if (!f.mad || f.dying || Math.floor(time * 4) % 2) continue
      const u = v.scale, p = v.worldToScreen(f.x, f.y - f.h / 2 - 6)
      const ax = Math.round(p.x - u), ay = Math.round(p.y - 9 * u)
      ag.rect(ax - u, ay - u, 4 * u, 10 * u).fill(0x3a0d0d).rect(ax, ay, 2 * u, 5 * u).fill(0xff4a3a).rect(ax, ay + 6 * u, 2 * u, 2 * u).fill(0xff4a3a)
    }
    for (const d of [me, ...this.others.values()]) {
      const p = v.worldToScreen(d.x, d.y - 22)
      d.tag.position.set(Math.round(p.x), Math.round(p.y))
    }

    audio.setAmbient('underwater', 1)
    this.sendT -= dt
    if (this.sendT <= 0) {
      this.sendT = 0.1
      net.send({ t: 'move', x: me.x, y: me.y, dir: me.face < 0 ? 'left' : 'right', moving: sp > 10 })
    }
    v.render(time)
  }

  resize(w: number, h: number) {
    this.view.resize(w, h)
    this.view.camX = this.me.x - this.view.viewW / 2
    this.view.camY = this.me.y - this.view.viewH / 2
  }

  destroy() {
    for (const u of this.unsub) u()
    for (const f of this.fish.values()) f.destroy()
    for (const d of this.others.values()) d.destroy()
    this.me.destroy()
    this.fx.clear()
    this.g.app.stage.removeChild(this.view.display, this.overlay)
    this.overlay.destroy({ children: true })
    this.view.destroy()
    this.g.hud.setSeaMode(false)
    this.g.hud.setPressure(false)
    this.g.hud.hint(null)
    this.g.audio.setAmbient('shore', 1)
  }
}
