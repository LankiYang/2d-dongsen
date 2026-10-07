// 场景调度 + 网络消息到本地状态的映射
import type { Application } from 'pixi.js'
import type { GameAssets } from './core/assets.ts'
import type { Net } from './core/net.ts'
import type { Input } from './core/input.ts'
import type { Audio } from './core/audio.ts'
import type { Hud } from './ui/hud.ts'
import type { SceneId } from '../shared/protocol.ts'
import { state } from './state.ts'
import { ITEMS, gearDef } from '../shared/data.ts'

export interface Scene {
  update(dt: number, time: number): void
  resize(w: number, h: number): void
  destroy(): void
}

export class Game {
  scene: Scene | null = null
  sceneId: SceneId | 'title' = 'island'
  time = 0
  switching = false
  meStart = { x: 0, y: 0 }
  private factories: Record<SceneId | 'title', () => Scene> = {} as any

  constructor(public app: Application, public assets: GameAssets, public net: Net, public input: Input, public audio: Audio, public hud: Hud) {
    net.on('inv', m => {
      const before = state.me.coins
      state.me.coins = m.coins
      state.me.inv = m.inv
      hud.renderHotbar()
      hud.refreshPanels()
      if (m.coins > before) hud.toast(`+${m.coins - before} 金币`)
    })
    net.on('plot', m => { if (m.plot) state.plots.set(m.key, m.plot); else state.plots.delete(m.key) })
    net.on('plots', m => { state.plots = new Map(Object.entries(m.plots)) })
    net.on('clock', m => state.syncClock(m.clock))
    net.on('houses', m => { state.houses = m.list })
    net.on('holding', m => { state.holding = m.hold; hud.setHolding(m.hold) })
    // 小屋数据会先于 goto 到达（场景还没建好），先存起来
    net.on('home', m => { state.home = m })
    net.on('story', m => { state.story = m; hud.refreshStory() })
    net.on('restore', m => { state.restore = m.state; hud.refreshRestore() })
    net.on('energy', m => { state.energy = m.v; hud.setEnergy(m.v) })
    net.on('questDone', m => { hud.toast(`完成「${m.title}」${m.coins ? ` +${m.coins} 金币` : ''}`); audio.play('coin', 0.6) })
    // 出航/传送由服务端批准后再切：同一张图里就地瞬移，否则换场景
    net.on('goto', m => {
      this.meStart = { x: m.x, y: m.y }
      const sc = this.scene as (Scene & { teleport?: (x: number, y: number) => void }) | null
      if (m.scene === this.sceneId && sc?.teleport) sc.teleport(m.x, m.y)
      else this.switchTo(m.scene)
    })
    net.on('gear', m => {
      state.gear = m.gear
      hud.renderUpgrade()
      if (m.upgraded) { hud.toast(`换上了${gearDef(m.upgraded, m.gear[m.upgraded]).name}！`, 'catch'); audio.play('catch', 0.5) }
    })
    net.on('chat', m => { hud.chat(m.from, m.text, m.sys); if (!m.sys) audio.play('chat', 0.3) })
    net.on('toast', m => { hud.toast(m.text); audio.play('error', 0.4) })
    hud.onChat = text => net.send({ t: 'chat', text })
    hud.onBuy = (item, n) => net.send({ t: 'buy', item, n })
    hud.onSell = (slot, all) => net.send({ t: 'sell', slot, all })
    hud.onSwap = (a, b) => net.send({ t: 'swap', a, b })
    hud.onUpgrade = kind => net.send({ t: 'upgrade', kind })
    input.typing = () => hud.typing() || hud.modalOpen()
  }

  register(id: SceneId | 'title', make: () => Scene) { this.factories[id] = make }

  start(id: SceneId | 'title') {
    this.sceneId = id
    this.scene = this.factories[id]()
    this.scene.resize(this.app.canvas.width, this.app.canvas.height)
  }

  // 淡出 → 换场景 → 淡入
  async switchTo(id: SceneId) {
    if (this.switching) return
    this.switching = true
    try {
      this.hud.fade(true)
      this.audio.play('splash', 0.6)
      await new Promise(r => setTimeout(r, 650))
      try { this.scene?.destroy() } catch (e) { console.error('销毁场景出错', e) }
      this.start(id)
      await new Promise(r => setTimeout(r, 150))
    } finally {
      this.hud.fade(false)
      this.switching = false
    }
  }

  tick(dt: number) {
    this.time += dt
    this.scene?.update(dt, this.time)
    this.hud.setClock(state.hour, state.day, state.rain)
    this.input.endFrame()
  }

  itemName(id: string) { return ITEMS[id]?.name ?? id }
}
