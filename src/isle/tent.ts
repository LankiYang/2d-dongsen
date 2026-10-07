// 玩家帐篷里面（tent:<玩家号>）：一间小屋，地上一盏提灯；第 0 天晚上在这里铺开折叠床睡觉，睡醒就是第 1 天
import { Sprite } from 'pixi.js'
import type { Game } from '../game.ts'
import { RoomScene } from '../interior/room.ts'
import type { Hint } from '../interior/room.ts'
import type { Room } from '../../shared/rooms.ts'
import type { SceneId } from '../../shared/protocol.ts'
import { TILE } from '../../shared/data.ts'
import { state } from '../state.ts'

const tentRoom = (owner: number): Room => ({
  id: `tent:${owner}`, name: '帐篷', w: 6, h: 6, wallRows: 2, floor: 'light', wall: 'plaster',
  door: { x: 3 * TILE, y: 6 * TILE }, spawn: { x: 3 * TILE, y: 5 * TILE - 6 },
  objects: [],
})

export class TentScene extends RoomScene {
  private cot: Sprite
  private sleeping = false
  constructor(g: Game, private owner: number) {
    super(g, tentRoom(owner))
    // 提灯（暖光）
    this.addLamp(1.4 * TILE, 2.6 * TILE, 70, 0xffc36b, 0.08)
    this.cot = new Sprite(g.assets.island.cot)
    this.cot.position.set(4.2 * TILE, 3.4 * TILE)
    this.cot.zIndex = this.cot.y
    this.cot.visible = state.isle?.stage === 'day1'
    this.entities.addChild(this.cot)
    g.hud.showZone('我的帐篷')
  }
  protected exitScene(): SceneId { return `isle:${state.isle?.id ?? 0}` as SceneId }
  protected exitPos() {
    const t = state.isle?.tent
    return t ? { x: (t.tx + 0.5) * TILE, y: (t.ty + 1.6) * TILE } : { x: 0, y: 0 }
  }
  protected lighting() {
    // 第 0 天晚上（欢迎会以后）屋里暗一点
    return state.isle?.stage === 'sleep' ? { ambient: [0.42, 0.4, 0.55], gain: 1.2, sat: 0.95 } : { ambient: [0.86, 0.82, 0.76], gain: 0.7, sat: 1.05 }
  }
  protected music() { return state.isle?.stage === 'sleep' ? 'none' as const : 'morning' as const }
  protected interact(): Hint | null {
    if (state.isle?.stage === 'sleep' && !this.sleeping) return { text: '<b>E</b> 铺开折叠床睡觉', act: () => this.sleep() }
    return this.doorHint()
  }
  private async sleep() {
    const { hud, net } = this.g
    this.sleeping = true
    this.cot.visible = true
    this.me.x = this.cot.x; this.me.y = this.cot.y + 6
    hud.fade(true)
    await new Promise(r => setTimeout(r, 900))
    net.send({ t: 'prologue', step: 'sleep' })
    await new Promise(r => setTimeout(r, 1200))
    hud.fade(false)
    hud.toast('第二天早上')
  }
}
