// 像素视图：世界先渲染进一张「美术像素分辨率」的 RenderTexture（最近邻），
// 再整数倍放大到屏幕。这样旋转/缩放/斜切的精灵也都落在同一套像素网格上，像手绘像素画。
// 摄像机的小数部分用放大后精灵的屏幕偏移来补，滚动依然平滑。
// 光照另渲染到一张半分辨率、线性过滤的光照图里，由 PostFilter 在屏幕分辨率上合成——
// 像素画本体锐利，光影过渡平滑（潜水员戴夫那种观感）。
//
// 高清模式（hd，动森方向的高清平滑画风）：世界直接按屏幕分辨率渲染（世界容器整体放大 scale 倍、线性过滤），
// 倍率不再取整，摄像机和精灵都可以落在小数像素上。世界坐标仍然是「美术像素」，游戏逻辑不用改。
import { Container, RenderTexture, Sprite } from 'pixi.js'
import type { Renderer } from 'pixi.js'
import { PostFilter } from '../fx/post.ts'

// 高清模式下缩放一档的倍数
const HD_ZOOM_STEP = 1.2

export class PixelView {
  world = new Container()
  lights = new Container()
  display = new Sprite()
  post = new PostFilter()
  rt!: RenderTexture
  lightRT!: RenderTexture
  scale = 3
  vw = 0
  vh = 0
  camX = 0
  camY = 0
  sw = 0
  sh = 0
  zoom = 0              // 相对默认倍率的整数偏移（滚轮 / +- 键调整）
  mapW = Infinity       // 地图尺寸：缩小时视野不能比地图还大
  mapH = Infinity

  constructor(private renderer: Renderer, public targetRows: number, private zoomKey = '', public hd = false) {
    this.display.filters = [this.post]
    this.lights.scale.set(0.5)
    if (zoomKey) this.zoom = Number(localStorage.getItem(`dongsen2d.zoom.${zoomKey}${hd ? '.hd' : ''}`)) || 0
  }

  // 倍率范围：最小不能让视野超出地图，最大到默认的 3 倍左右（像素模式取整数）
  private limits(sw: number, sh: number) {
    if (this.hd) {
      const base = Math.max(1, sh / this.targetRows)
      const min = Math.max(1, sw / this.mapW, sh / this.mapH)
      return { base, min, max: Math.max(min, base * 3) }
    }
    const base = Math.max(2, Math.round(sh / this.targetRows))
    const min = Math.max(2, Math.ceil(sw / this.mapW), Math.ceil(sh / this.mapH))
    return { base, min, max: Math.max(min, base * 3) }
  }
  private scaleFor(zoom: number, sw: number, sh: number) {
    const { base, min, max } = this.limits(sw, sh)
    return Math.max(min, Math.min(max, this.hd ? base * Math.pow(HD_ZOOM_STEP, zoom) : base + zoom))
  }

  // 缩放一档；到头了返回 false
  zoomBy(d: number): boolean {
    const next = this.scaleFor(this.zoom + d, this.sw, this.sh)
    if (Math.abs(next - this.scale) < 1e-3) return false
    this.zoom += d
    if (this.zoomKey) localStorage.setItem(`dongsen2d.zoom.${this.zoomKey}${this.hd ? '.hd' : ''}`, String(this.zoom))
    this.resize(this.sw, this.sh)
    return true
  }

  // targetRows：希望屏幕纵向大约显示多少美术像素，据此选放大倍率
  resize(sw: number, sh: number) {
    this.sw = sw; this.sh = sh
    this.scale = this.scaleFor(this.zoom, sw, sh)
    this.vw = Math.ceil(sw / this.scale) + 2
    this.vh = Math.ceil(sh / this.scale) + 2
    this.rt?.destroy(true)
    this.lightRT?.destroy(true)
    this.rt = this.hd
      ? RenderTexture.create({ width: sw, height: sh, scaleMode: 'linear', antialias: false })
      : RenderTexture.create({ width: this.vw, height: this.vh, scaleMode: 'nearest', antialias: false })
    this.lightRT = RenderTexture.create({ width: Math.ceil(this.vw / 2), height: Math.ceil(this.vh / 2), scaleMode: 'linear', antialias: false })
    this.display.texture = this.rt
    this.display.scale.set(this.hd ? 1 : this.scale)
    this.post.lightTexture = this.lightRT
  }

  // 屏幕上可见的世界宽高（美术像素）
  get viewW() { return this.sw / this.scale }
  get viewH() { return this.sh / this.scale }

  screenToWorld(sx: number, sy: number) {
    return { x: this.camX + sx / this.scale, y: this.camY + sy / this.scale }
  }
  worldToScreen(wx: number, wy: number) {
    return { x: (wx - this.camX) * this.scale, y: (wy - this.camY) * this.scale }
  }

  // 世界坐标取整：像素模式下精灵要落在美术像素上；高清模式不取整，移动才顺滑
  snap(v: number) { return this.hd ? v : Math.round(v) }

  render(time: number) {
    const p = this.post
    if (this.hd) {
      // 光照图覆盖世界矩形 [camX-1, camY-1] 起、vw×vh 大小（半分辨率）
      this.world.scale.set(this.scale)
      this.world.position.set(-this.camX * this.scale, -this.camY * this.scale)
      this.lights.position.set(-(this.camX - 1) * 0.5, -(this.camY - 1) * 0.5)
      this.renderer.render({ container: this.world, target: this.rt, clear: true, clearColor: [0, 0, 0, 1] })
      this.renderer.render({ container: this.lights, target: this.lightRT, clear: true, clearColor: [0, 0, 0, 1] })
      this.display.position.set(0, 0)
      p.set('uLightRect', [-this.scale, -this.scale, this.vw * this.scale, this.vh * this.scale])
    } else {
      const ix = Math.floor(this.camX), iy = Math.floor(this.camY)
      // rt 覆盖世界矩形 [ix-1, iy-1] 起、vw×vh 大小
      this.world.position.set(-(ix - 1), -(iy - 1))
      this.lights.position.set(-(ix - 1) * 0.5, -(iy - 1) * 0.5)
      this.renderer.render({ container: this.world, target: this.rt, clear: true, clearColor: [0, 0, 0, 1] })
      this.renderer.render({ container: this.lights, target: this.lightRT, clear: true, clearColor: [0, 0, 0, 1] })
      const fx = this.camX - ix, fy = this.camY - iy
      this.display.position.set(-(1 + fx) * this.scale, -(1 + fy) * this.scale)
      p.set('uLightRect', [this.display.x, this.display.y, this.vw * this.scale, this.vh * this.scale])
    }
    p.set('uCam', [this.camX, this.camY])
    p.set('uScale', this.scale)
    p.set('uTime', time)
    p.set('uScreen', [this.sw, this.sh])
  }

  destroy() {
    this.world.destroy({ children: true })
    this.lights.destroy({ children: true })
    this.display.destroy()
    this.rt?.destroy(true)
    this.lightRT?.destroy(true)
  }
}
