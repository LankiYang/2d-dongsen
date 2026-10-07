// 入口：加载字体与资源 → 标题画面（真的岛屿当背景，镜头巡游）+ 登录 → 连服务器 → 进岛
import { Application, Rectangle, TextureSource } from 'pixi.js'
import { loadAssets } from './core/assets.ts'
import { Input } from './core/input.ts'
import { Net } from './core/net.ts'
import { Audio } from './core/audio.ts'
import { Hud } from './ui/hud.ts'
import { Game } from './game.ts'
import { IslandScene } from './island/scene.ts'
import { SeaScene } from './sea/scene.ts'
import { RestaurantScene } from './interior/restaurant.ts'
import { HomeScene } from './interior/home.ts'
import { LOTS } from '../shared/island.ts'
import { WorldScene } from './world/scene.ts'
import { MAPS } from '../shared/world/maps.ts'
import { state } from './state.ts'
import { SHIRT_HUES, setWorldEpoch } from '../shared/data.ts'
import { AC_STYLE } from './acstyle.ts'
import { TitleScene, SHOTS } from './island/title.ts'
import { TouchControls, isTouchDevice } from './ui/touch.ts'

// 全局最近邻采样：像素画绝不能被插值糊掉（光照图单独指定线性）
TextureSource.defaultOptions.scaleMode = 'nearest'

const SAVE_KEY = 'dongsen2d'
// 从潮汐港独立出来以前，5192 端口上的存档键叫 tidehaven（同一个存档世界），搬过来一次，玩家不用重新建角色
if (!localStorage.getItem(SAVE_KEY) && localStorage.getItem('tidehaven')) localStorage.setItem(SAVE_KEY, localStorage.getItem('tidehaven')!)
const setLoading = (p: number) => { (document.querySelector('#loading .bar i') as HTMLElement).style.width = `${Math.round(p * 100)}%` }

async function boot() {
  if (AC_STYLE) document.body.classList.add('acstyle')
  const font = new FontFace('FusionPixel', 'url(/fonts/fusion-pixel-12px.woff2)')
  document.fonts.add(await font.load())
  setLoading(0.1)

  // 画布按设备像素分配，渲染器分辨率固定为 1：每个画布像素就是一个物理像素，整数放大才能保持锐利
  const dpr = window.devicePixelRatio || 1
  const app = new Application()
  await app.init({
    preference: 'webgl', antialias: false, resolution: 1, autoDensity: false,
    width: Math.round(innerWidth * dpr), height: Math.round(innerHeight * dpr), background: 0x0b1a2a, powerPreference: 'high-performance',
  })
  const fit = () => {
    const d = window.devicePixelRatio || 1
    app.renderer.resize(Math.round(innerWidth * d), Math.round(innerHeight * d))
    app.canvas.style.width = `${innerWidth}px`
    app.canvas.style.height = `${innerHeight}px`
  }
  fit()
  document.getElementById('game')!.appendChild(app.canvas)

  const assets = await loadAssets(p => setLoading(0.1 + p * 0.9))
  const audio = new Audio()
  const hud = new Hud(assets, audio)
  const input = new Input(app.canvas)
  const net = new Net()

  const saved = JSON.parse(localStorage.getItem(SAVE_KEY) ?? '{}') as { name?: string, hue?: number, token?: string }
  const game = new Game(app, assets, net, input, audio, hud)
  game.register('title', () => new TitleScene(game, (i, shot) => hud.titleCaption(i, SHOTS.length, shot.title, shot.text)))
  game.register('island', () => new IslandScene(game))
  game.register('sea', () => new SeaScene(game))
  game.register('restaurant', () => new RestaurantScene(game))
  for (const l of LOTS) game.register(`home:${l.id}`, () => new HomeScene(game, l.id))
  for (const def of Object.values(MAPS)) game.register(`map:${def.id}`, () => new WorldScene(game, def))
  ;(window as any).__tide = {
    game, state,
    // 开发调试：把当前画面存到 art/preview/shots/<name>.png
    shot: async (name = 'shot') => {
      // 预览面板在后台时 rAF 会暂停，先手动推进一帧
      game.tick(1 / 60)
      const c = app.renderer.extract.canvas({ target: app.stage, frame: new Rectangle(0, 0, app.canvas.width, app.canvas.height) }) as HTMLCanvasElement
      await fetch(`/__shot?name=${name}`, { method: 'POST', body: c.toDataURL('image/png') })
      return `${c.width}x${c.height}`
    },
  }
  game.start('title')
  if (isTouchDevice()) new TouchControls(input, hud, game)
  // 浏览器要等用户点一下才让出声：标题画面上第一次点击/按键就把音乐和海浪声放出来
  const wake = () => { audio.unlock(); removeEventListener('pointerdown', wake); removeEventListener('keydown', wake) }
  addEventListener('pointerdown', wake); addEventListener('keydown', wake)
  app.ticker.add(t => game.tick(Math.min(0.05, t.deltaMS / 1000)))
  window.addEventListener('resize', () => { fit(); game.scene?.resize(app.canvas.width, app.canvas.height) })

  const { name, hue } = await hud.login({ name: saved.name ?? '', hue: SHIRT_HUES.includes(saved.hue ?? -1) ? saved.hue! : SHIRT_HUES[0] })
  audio.unlock()
  state.me.name = name
  state.me.hue = hue
  localStorage.setItem(SAVE_KEY, JSON.stringify({ ...saved, name, hue }))

  net.on('welcome', m => {
    state.me.id = m.you
    state.me.coins = m.coins
    state.me.inv = m.inv
    state.plots = new Map(Object.entries(m.plots))
    state.houses = m.houses
    state.myLot = m.lot
    state.gear = m.gear ?? state.gear
    setWorldEpoch(m.epoch)
    state.syncClock(m.clock)
    localStorage.setItem(SAVE_KEY, JSON.stringify({ name, hue, token: m.token }))
    hud.renderHotbar()
    hud.setOffline(false)
    game.meStart = { x: m.x, y: m.y }
    // 断线重连时服务端会把人放回岛上
    if (!game.scene) game.start('island')
    else if (game.sceneId !== 'island') game.switchTo('island')
  })
  net.onOpen = () => {
    const s = JSON.parse(localStorage.getItem(SAVE_KEY) ?? '{}')
    net.send({ t: 'hello', token: s.token ?? '', name, hue })
  }
  net.onClose = () => hud.setOffline(true)
  net.connect()
}

boot().catch(e => {
  console.error(e)
  document.querySelector('#loading .tip')!.textContent = '启动失败：' + (e?.message ?? e)
})
