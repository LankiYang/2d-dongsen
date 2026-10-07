// 岛上的非玩家角色：工作人员（潮汐港那几位，用 npcs 图集的四方向行走帧）和动物村民（高清单帧立像，走路时上下颠）。
// 只管画和走位；说什么、去哪由岛屿场景决定。
import { Container, Sprite } from 'pixi.js'
import type { Texture } from 'pixi.js'
import type { GameAssets } from '../core/assets.ts'
import type { Dir } from '../../shared/protocol.ts'
import { snap } from '../acstyle.ts'

export type ActorKind = { staff: string } | { villager: string }

export class Actor {
  root = new Container()
  body: Sprite
  shadow: Sprite
  x = 0; y = 0
  dir: Dir = 'down'
  moving = false
  private target: { x: number, y: number } | null = null
  private animT = Math.random() * 10
  speed = 48
  id: string
  name = ''

  constructor(private assets: GameAssets, public kind: ActorKind) {
    this.id = 'staff' in kind ? kind.staff : kind.villager
    this.shadow = new Sprite(assets.shadow(18))
    this.shadow.anchor.set(0.5)
    this.shadow.y = -1
    this.body = new Sprite(this.frame('down', 0))
    this.body.anchor.set(0.5, 1)
    this.root.addChild(this.shadow, this.body)
  }

  private frame(dir: Dir, f: number): Texture {
    if ('villager' in this.kind) return (this.moving && (dir === 'left' || dir === 'right') && this.assets.island[`${this.kind.villager}_side`]) || this.assets.island[this.kind.villager]
    const row = dir === 'left' || dir === 'right' ? 'side' : dir
    return this.assets.npcs[`${this.kind.staff}_${row}_${f}`] ?? this.assets.npcs[`${this.kind.staff}_down_0`]
  }

  place(x: number, y: number) { this.x = x; this.y = y; this.target = null }
  walkTo(x: number, y: number) { this.target = { x, y } }
  get busy() { return !!this.target }
  faceTo(x: number, y: number) {
    const dx = x - this.x, dy = y - this.y
    this.dir = Math.abs(dx) > Math.abs(dy) ? (dx < 0 ? 'left' : 'right') : (dy < 0 ? 'up' : 'down')
  }

  update(dt: number) {
    this.moving = false
    if (this.target) {
      const dx = this.target.x - this.x, dy = this.target.y - this.y, d = Math.hypot(dx, dy)
      if (d < 1) { this.x = this.target.x; this.y = this.target.y; this.target = null }
      else {
        const st = Math.min(d, this.speed * dt)
        this.x += (dx / d) * st; this.y += (dy / d) * st
        this.faceTo(this.target.x, this.target.y)
        this.moving = true
      }
    }
    this.animT += dt
    const f = this.moving ? Math.floor(this.animT * 7) % 4 : 0
    this.body.texture = this.frame(this.dir, f)
    if ('villager' in this.kind) {
      // 立像单帧：走路时一颠一颠，朝左走就翻过来
      this.body.y = this.moving ? -Math.abs(Math.sin(this.animT * 11)) * 2 : 0
      this.body.scale.x = this.dir === 'left' ? -1 : 1
    } else {
      this.body.scale.x = this.dir === 'left' ? -1 : 1
      this.body.y = this.moving && (f === 1 || f === 3) ? -1 : 0
    }
    this.root.position.set(snap(this.x), snap(this.y))
    this.root.zIndex = this.y
  }
}
