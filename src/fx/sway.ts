// 像素画的随风摆动：把精灵拆成上下两段，上段（树冠/叶片）整块按整数像素左右平移，下段（树干/根部）不动。
// 以前用斜切（skew）连续变形，在美术像素分辨率下每一行会在不同时刻各跳一格，
// 看起来像一条跳变线从上往下刷过去；整块平移就没有这个问题。
// 高清模式（动森方向）：上段改成以分界线为轴连续斜切——没有像素网格，斜切是平滑的，分界线处也不会错开
import { Container, Rectangle, Sprite, Texture } from 'pixi.js'
import { HD } from '../acstyle.ts'

// 各类植物「会动的上段」占整张图的比例
const SPLIT: Record<string, number> = {
  // 树按动森画风的新图量过：切在树冠下沿，树干整段不动（改图后要重量，tools 里按行统计不透明宽度就能看出来）
  palm_a: 0.55, palm_b: 0.58, tree_round: 0.77, tree_mango: 0.69, banana: 0.55,
  bush_hibiscus: 0.5, bush_bougain: 0.5, shrub: 0.5, fern: 0.55, grass_tall: 0.55,
  seagrass: 0.55, anemone_green: 0.45, anemone_purple: 0.45, seafan: 0.5, glow_plant: 0.5, kelp: 0.7,
}
export const swaySplit = (kind: string) => SPLIT[kind] ?? 0.5

const sub = (t: Texture, y: number, h: number) =>
  new Texture({ source: t.source, frame: new Rectangle(t.frame.x, t.frame.y + y, t.frame.width, h) })

export class Swayer {
  root = new Container()
  top: Sprite
  private offset = 0
  private phase = Math.random() * 10
  private speed = 0.7 + Math.random() * 0.5
  private topH: number

  // 纹理锚点在底边中心；amp 是上段最多平移几个像素
  constructor(tex: Texture, split: number, private amp = 1) {
    const h = tex.frame.height
    const topH = this.topH = Math.max(1, Math.round(h * split))
    this.top = new Sprite(sub(tex, 0, topH))
    this.top.anchor.set(0.5, 1)
    this.top.y = -(h - topH)
    const bottom = new Sprite(sub(tex, topH, h - topH))
    bottom.anchor.set(0.5, 1)
    this.root.addChild(bottom, this.top)
  }

  // wind：全场共享的风力（约 -1~1）；带回差，避免在 ±0.5 附近来回闪
  update(time: number, wind: number) {
    const w = (Math.sin(time * this.speed + this.phase) * 0.55 + wind * 0.7) * this.amp
    if (HD) {
      // 顶端横移 w 像素：x' = x + sin(skew.x)·y，顶端 y = -topH
      this.top.skew.x = -Math.asin(Math.max(-0.5, Math.min(0.5, w / this.topH)))
      return
    }
    if (Math.abs(w - this.offset) > 0.7) {
      this.offset = Math.max(-this.amp, Math.min(this.amp, Math.round(w)))
      this.top.x = this.offset
    }
  }
}
