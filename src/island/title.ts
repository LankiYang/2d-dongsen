// 标题画面：用真的岛屿场景当背景（展示模式：不显示玩家、不接输入），镜头按分镜慢慢推移，
// 一天从早到晚走一遍：田地 → 村子 → 集市 → 码头 → 寿司店 → 灯塔。每个镜头之间淡出淡入，底部字幕讲这里能做什么。
// 复兴工程按全部完工的样子摆（给新玩家看潮汐港将来的样子）；田里种一片演示用的庄稼（登录后服务端的真实数据会覆盖）。
import { Graphics } from 'pixi.js'
import type { Game, Scene } from '../game.ts'
import { IslandScene } from './scene.ts'
import { state } from '../state.ts'
import { DAY_MS, DAY_START_HOUR, TILE } from '../../shared/data.ts'
import type { CropId } from '../../shared/data.ts'
import { plotKey } from '../../shared/protocol.ts'

export interface Shot { from: [number, number], to: [number, number], hours: [number, number], title: string, text: string }
// 镜头中心（地块坐标）从 from 推到 to，钟点从 hours[0] 走到 hours[1]
export const SHOTS: Shot[] = [
  { from: [18.5, 19.5], to: [26.5, 21], hours: [7, 9.5], title: '种田', text: '锄地、播种、浇水，庄稼一天天长大；下雨天老天爷替你浇' },
  { from: [28, 46.5], to: [37, 49.5], hours: [10, 12.5], title: '潮汐村', text: '七位村民各有各的日子和心事，关系越好，说的越多' },
  { from: [26.5, 36.5], to: [32.5, 38.5], hours: [13, 15.5], title: '潮汐集市', text: '每周六开市，摆摊卖东西多赚两成半' },
  { from: [58, 24.8], to: [64, 25.4], hours: [17, 18.9], title: '出海潜水', text: '在栈桥坐老潘的船出海，潜进蓝洞抓鱼，小心鲨鱼' },
  { from: [46.5, 21], to: [53, 22.6], hours: [18.3, 19.8], title: '潮汐寿司', text: '从早开到晚，切鱼捏寿司，招待岛上的客人' },
  { from: [60, 12.6], to: [64, 10.8], hours: [21, 22.8], title: '复兴计划', text: '和大家一起修栈桥、点灯塔、请回客船，让港口重新热闹起来' },
]
const DUR = 8.5      // 每个镜头多少秒
const FADE = 0.9     // 镜头首尾淡入淡出
const ease = (t: number) => 0.5 - 0.5 * Math.cos(Math.PI * t)
const lerp = (a: number, b: number, t: number) => a + (b - a) * t

export class TitleScene implements Scene {
  private island: IslandScene
  private black = new Graphics()
  private t = 0
  private shot = -1

  constructor(private g: Game, private onShot: (i: number, shot: Shot) => void) {
    if (!state.plots.size) state.plots = demoPlots()
    this.island = new IslandScene(g, { attract: true })
    g.app.stage.addChild(this.black)
  }

  update(dt: number, time: number) {
    this.t += dt
    const i = Math.floor(this.t / DUR) % SHOTS.length, s = SHOTS[i]
    if (i !== this.shot) { this.shot = i; this.onShot(i, s) }
    const local = this.t % DUR, k = local / DUR, p = ease(k)
    // 左边一列是标题和登岛卡片，右边三分之二是空的：镜头往左偏，让主体落在画面偏右的地方
    // （地图东边到头了镜头会被夹住，东边的码头、灯塔自然落在右边）
    const v = this.island.view
    this.island.camDirect = { x: lerp(s.from[0], s.to[0], p) * TILE - v.viewW * 0.12, y: lerp(s.from[1], s.to[1], p) * TILE - v.viewH * 0.03 }
    // 登录以后服务端时钟说了算（等切场景的这一小会儿别再改钟）
    if (!state.me.id) state.syncClock(((lerp(s.hours[0], s.hours[1], k) - DAY_START_HOUR) / 24) * DAY_MS)
    const edge = Math.min(local, DUR - local)
    this.black.alpha = edge < FADE ? ease(1 - edge / FADE) : 0
    // 字幕比画面晚半拍出来、早半拍收走
    this.g.hud.titleCaptionFade(Math.max(0, Math.min(1, (local - FADE) / 0.8, (DUR - FADE - 0.3 - local) / 0.6)))
    this.island.update(dt, time)
  }

  resize(w: number, h: number) {
    this.island.resize(w, h)
    this.black.clear().rect(0, 0, w, h).fill(0x04070d)
  }

  destroy() {
    this.black.destroy()
    this.island.destroy()
  }
}

// 演示用的一片田：稻子、草莓、南瓜熟了，番茄正在长，最下面一垄刚浇过水
function demoPlots() {
  const plots = new Map<string, { tilled: boolean, watered: boolean, crop?: CropId, grown?: number }>()
  const bed = (x0: number, x1: number, y0: number, y1: number, crop?: CropId, grown = 0, watered = true) => {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) plots.set(plotKey(x, y), { tilled: true, watered, crop, grown: crop ? grown : undefined })
  }
  bed(16, 21, 18, 19, 'rice', 2)
  bed(23, 28, 18, 19, 'strawberry', 4)
  bed(16, 20, 21, 22, 'pumpkin', 5, false)
  bed(23, 28, 21, 22, 'tomato', 2)
  bed(16, 21, 24, 25, 'cucumber', 3, false)
  bed(23, 27, 24, 25)
  return plots
}
