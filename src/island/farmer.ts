// 岛上的农夫（本地玩家和其他玩家共用）：行走帧 + 步伐弹跳 + 挥工具动画 + 名牌
import { snap } from '../acstyle.ts'
import { Container, Sprite, Text, Graphics } from 'pixi.js'
import type { Texture } from 'pixi.js'
import type { Atlas, GameAssets } from '../core/assets.ts'
import type { Dir } from '../../shared/protocol.ts'

// 素材表里侧面那一行实际画的是朝右（prompt 要的是朝左，模型没照做；用放大图核对过）
const SIDE_FACES_LEFT = false

export class Farmer {
  root = new Container()
  body = new Sprite()
  shadow: Sprite
  tool = new Sprite()
  held = new Sprite()      // 端着的菜，显示在头顶
  emote = new Graphics()   // 剧情里头顶冒的表情
  emoteT = 0
  tag: Text
  frames: Atlas
  dir: Dir = 'down'
  moving = false
  animT = 0
  actT = 0            // >0 表示正在挥工具
  actIcon = ''
  x = 0
  y = 0
  // 远端玩家插值目标
  tx = 0
  ty = 0

  constructor(private assets: GameAssets, hue: number, name: string, isMe: boolean) {
    this.frames = assets.farmers.get(hue) ?? assets.chars
    this.shadow = new Sprite(assets.shadow(18))
    this.shadow.anchor.set(0.5)
    this.shadow.y = -1
    this.body.anchor.set(0.5, 1)
    this.tool.anchor.set(0.5, 0.9)
    this.tool.visible = false
    this.held.anchor.set(0.5, 1)
    this.held.visible = false
    this.emote.visible = false
    this.emote.y = -40
    this.root.addChild(this.shadow, this.body, this.tool, this.held, this.emote)
    this.tag = new Text({
      text: name,
      style: { fontFamily: 'FusionPixel', fontSize: 24, fill: isMe ? 0xfff2c4 : 0xffffff, stroke: { color: 0x2a1a10, width: 4 }, align: 'center' },
      resolution: 1,
    })
    this.tag.anchor.set(0.5, 1)
    this.tag.roundPixels = true
    this.setFrame()
  }

  setHold(tex: Texture | null) {
    this.held.visible = !!tex
    if (tex) { this.held.texture = tex; this.held.scale.set(Math.min(1, 20 / Math.max(tex.width, tex.height))) }
  }

  setHue(hue: number) { this.frames = this.assets.farmers.get(hue) ?? this.assets.chars }

  // tex：用别的图集里的工具图（2D动森的高清简易工具）
  act(icon: string, tex?: Texture) {
    this.actT = 0.32
    this.actIcon = icon
    this.tool.texture = tex ?? this.assets.icons[icon] ?? this.assets.icons.hoe
    this.tool.scale.y = tex ? Math.min(1, 22 / Math.max(tex.width, tex.height)) : 1
    this.tool.visible = true
  }

  private setFrame() {
    const row = this.dir === 'left' || this.dir === 'right' ? 'side' : this.dir
    const f = this.moving ? Math.floor(this.animT * 8) % 4 : 0
    const tex: Texture | undefined = this.frames[`walk_${row}_${f}`]
    if (tex) this.body.texture = tex
    const faceLeft = this.dir === 'left'
    this.body.scale.x = row === 'side' ? ((faceLeft === SIDE_FACES_LEFT) ? 1 : -1) : 1
  }

  update(dt: number) {
    this.emoteT -= dt
    if (this.emoteT <= 0) this.emote.visible = false
    if (this.moving) this.animT += dt
    else this.animT = 0
    this.setFrame()
    // 步伐弹跳：第 1、3 帧抬高 1 像素
    const f = Math.floor(this.animT * 8) % 4
    this.body.y = this.moving && (f === 1 || f === 3) ? -1 : 0
    if (this.actT > 0) {
      this.actT -= dt
      const k = 1 - Math.max(0, this.actT) / 0.32
      const side = this.dir === 'left' ? -1 : 1
      // 工具从头顶后方挥到身前
      this.tool.rotation = side * (-1.4 + k * 2.4)
      const reach = this.dir === 'up' ? -4 : this.dir === 'down' ? 4 : 8
      this.tool.position.set(this.dir === 'left' || this.dir === 'right' ? side * (4 + k * reach) : 6, -18 + k * 6 + (this.dir === 'down' ? 4 : 0))
      this.tool.scale.x = side * Math.abs(this.tool.scale.y)
      // 挥锄时身体往下一沉 1 像素（整数位移，缩放在像素网格里会逐行闪）
      this.body.y = k > 0.3 && k < 0.8 ? 1 : 0
      if (this.actT <= 0) this.tool.visible = false
    }
    if (this.held.visible) this.held.y = -36 - (Math.floor(this.animT * 4) % 2)
    this.root.position.set(snap(this.x), snap(this.y))
    this.root.zIndex = this.y
  }

  destroy() {
    this.root.destroy({ children: true })
    this.tag.destroy()
  }
}
