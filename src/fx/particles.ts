// 极简粒子：每个粒子就是一个 1×1 白纹理精灵（在像素视图里正好是 1 个美术像素）
import { Container, Sprite, Texture } from 'pixi.js'

export interface P {
  s: Sprite
  vx: number; vy: number
  ax: number; ay: number
  drag: number
  life: number; max: number
  fade: boolean
  wobble?: number
  light?: Sprite
}

export class Particles {
  layer = new Container()
  list: P[] = []
  private pool: Sprite[] = []

  spawn(o: { x: number, y: number, vx?: number, vy?: number, ax?: number, ay?: number, life: number, color: number, w?: number, h?: number, drag?: number, fade?: boolean, alpha?: number, wobble?: number, texture?: Texture }) {
    const s = this.pool.pop() ?? new Sprite(Texture.WHITE)
    s.texture = o.texture ?? Texture.WHITE
    if (!o.texture) { s.width = o.w ?? 1; s.height = o.h ?? 1 } else s.scale.set(1)
    s.anchor.set(0.5)
    s.tint = o.color
    s.alpha = o.alpha ?? 1
    s.position.set(o.x, o.y)
    this.layer.addChild(s)
    const p: P = { s, vx: o.vx ?? 0, vy: o.vy ?? 0, ax: o.ax ?? 0, ay: o.ay ?? 0, drag: o.drag ?? 0, life: o.life, max: o.life, fade: o.fade ?? true, wobble: o.wobble }
    this.list.push(p)
    return p
  }

  update(dt: number, time: number) {
    for (let i = this.list.length - 1; i >= 0; i--) {
      const p = this.list[i]
      p.life -= dt
      if (p.life <= 0) {
        p.s.removeFromParent()
        this.pool.push(p.s)
        p.light?.destroy()
        this.list.splice(i, 1)
        continue
      }
      p.vx += p.ax * dt; p.vy += p.ay * dt
      if (p.drag) { const k = Math.max(0, 1 - p.drag * dt); p.vx *= k; p.vy *= k }
      p.s.x += p.vx * dt + (p.wobble ? Math.sin(time * 3 + p.max * 17) * p.wobble * dt : 0)
      p.s.y += p.vy * dt
      if (p.fade) p.s.alpha = Math.min(1, (p.life / p.max) * 2)
      if (p.light) { p.light.position.set(p.s.x, p.s.y); p.light.alpha = p.s.alpha * 0.6 }
    }
  }

  clear() {
    for (const p of this.list) { p.s.destroy(); p.light?.destroy() }
    this.list = []
  }
}
