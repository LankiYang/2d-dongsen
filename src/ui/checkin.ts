// 机场柜台办「无人岛移居套餐」（还原原作的开局）：阿海和豆豆接待，
// 登记名字、外观、生日 → 选半球 → 4 张岛图挑 1 张 → 「去无人岛最想带什么」→ 坐水上飞机出发。
// 只在客户端走流程，最后把结果一次发给服务端（服务端校验后建档、建岛）。
import type { Hud } from './hud.ts'
import type { GameAssets } from '../core/assets.ts'
import type { Audio } from '../core/audio.ts'
import { SHIRT_HUES } from '../../shared/data.ts'
import { makeIsle, isleMinimap, ISLE_W, ISLE_H, FRUIT_NAME } from '../../shared/isle/gen.ts'
import { NPC_INFO } from '../../shared/npcs.ts'
import type { NpcId } from '../../shared/npcs.ts'

export interface CheckinResult { name: string, hue: number, birthday: [number, number], hemi: 'N' | 'S', seed: number, answer: number }

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', html = '') => { const e = document.createElement(tag); if (cls) e.className = cls; if (html) e.innerHTML = html; return e }
const wait = (ms: number) => new Promise(r => setTimeout(r, ms))

export async function runCheckin(hud: Hud, assets: GameAssets, audio: Audio, saved: { name: string, hue: number }): Promise<CheckinResult> {
  const root = el('div', 'checkin')
  const panel = el('div', 'ck-panel panel hidden')
  root.appendChild(panel)
  document.getElementById('ui')!.insertBefore(root, document.getElementById('dialog'))
  const say = (who: NpcId, text: string) => { const i = NPC_INFO[who]; return hud.say({ name: i.name, title: i.title, face: who, voice: i.voice, text }) }
  const ask = (who: NpcId, text: string, opts: string[]) => { const i = NPC_INFO[who]; return hud.ask({ name: i.name, title: i.title, face: who, voice: i.voice, text }, opts) }
  // 中间的表单面板：填完点确定
  const form = (build: (p: HTMLElement, done: (ok: boolean) => void) => void) => new Promise<void>(res => {
    hud.closeDialog()
    panel.innerHTML = ''
    panel.classList.remove('hidden')
    build(panel, ok => { if (!ok) return; audio.play('click', 0.4); panel.classList.add('hidden'); res() })
  })

  await wait(400)
  await say('ahai', '欢迎光临！这里是「无人岛移居套餐」的服务柜台。')
  const yes = await ask('doudou', '^要搬到无人岛上去住吗？', ['要！', '先听听是怎么回事'])
  if (yes === 1) {
    await say('ahai', '我们会把你和两位同样想去岛上生活的伙伴送到一座无人岛上。岛上什么都没有，一切从搭帐篷开始。')
    await say('doudou', '^不过有周叔在岛上帮忙，不用担心！钓鱼、抓虫、种花、盖房子……想怎么过都行！')
  }
  await say('ahai', '那先登记一下资料。')

  // ── 名字和外观 ──
  let name = saved.name, hue = saved.hue
  await form((p, done) => {
    p.append(el('div', 'ck-title', '登记资料'))
    const row = el('div', 'ck-row')
    const cv = el('canvas', 'ck-preview') as HTMLCanvasElement
    cv.width = 144; cv.height = 160
    const side = el('div', 'ck-side')
    const lab = el('label', '', '名字')
    const input = el('input') as HTMLInputElement
    input.maxLength = 10; input.value = name; input.placeholder = '例如：阿潮'
    lab.append(input)
    const hues = el('div', 'hues')
    for (const h of SHIRT_HUES) {
      const b = el('button') as HTMLButtonElement
      b.style.background = `hsl(${h}deg 55% 45%)`
      if (h === hue) b.classList.add('on')
      b.onclick = () => { hue = h; for (const x of hues.children) x.classList.remove('on'); b.classList.add('on') }
      hues.append(b)
    }
    side.append(lab, el('div', 'label', '衣服颜色'), hues)
    row.append(cv, side)
    const ok = el('button', 'btn big', '确定') as HTMLButtonElement
    p.append(row, ok)
    let frame = 0
    const timer = setInterval(() => { frame++; drawFarmer(cv, assets, hue, frame) }, 140)
    drawFarmer(cv, assets, hue, 0)
    setTimeout(() => input.focus(), 30)
    const go = () => { name = input.value.replace(/[\s<>]/g, '').slice(0, 10); if (!name) { input.focus(); return } clearInterval(timer); done(true) }
    ok.onclick = go
    input.onkeydown = e => { e.stopPropagation(); if (e.key === 'Enter') go() }
  })
  await say('doudou', `^${name}！好名字！`)

  // ── 生日 ──
  let bm = 1, bd = 1
  await say('ahai', '生日是哪一天？登记以后就改不了了哦。')
  await form((p, done) => {
    p.append(el('div', 'ck-title', '生日'))
    const row = el('div', 'ck-row ck-bday')
    const m = el('select') as HTMLSelectElement, d = el('select') as HTMLSelectElement
    for (let i = 1; i <= 12; i++) m.append(new Option(`${i} 月`, String(i)))
    const fill = () => { const n = new Date(2024, Number(m.value), 0).getDate(); const cur = Number(d.value) || 1; d.innerHTML = ''; for (let i = 1; i <= n; i++) d.append(new Option(`${i} 日`, String(i))); d.value = String(Math.min(cur, n)) }
    m.onchange = fill; fill()
    row.append(m, d)
    const ok = el('button', 'btn big', '确定') as HTMLButtonElement
    p.append(row, ok)
    ok.onclick = () => { bm = Number(m.value); bd = Number(d.value); done(true) }
  })

  // ── 半球 ──
  const hemi = (await ask('doudou', '你住在北半球还是南半球？岛上的季节会跟着它走。', ['北半球', '南半球'])) === 1 ? 'S' : 'N'

  // ── 选岛：4 张地图挑 1 张 ──
  await say('ahai', '我们这次有四座岛可以选，看看喜欢哪一座？')
  let seed = 0
  await form((p, done) => {
    p.classList.add('wide')
    const draw = () => {
      p.innerHTML = ''
      p.append(el('div', 'ck-title', '选一座岛'), el('div', 'ck-sub', '南边白色的是机场，中间黄色的是广场；蓝色的是河和池塘，深绿的是悬崖'))
      const grid = el('div', 'ck-maps')
      for (let k = 0; k < 4; k++) {
        const s = 1 + Math.floor(Math.random() * 2_000_000_000)
        const isle = makeIsle(s)
        const card = el('button', 'ck-map') as HTMLButtonElement
        const cv = el('canvas') as HTMLCanvasElement
        cv.width = ISLE_W; cv.height = ISLE_H
        cv.getContext('2d')!.putImageData(new ImageData(isleMinimap(isle) as Uint8ClampedArray<ArrayBuffer>, ISLE_W, ISLE_H), 0, 0)
        card.append(cv, el('div', 'ck-fruit', `特产水果：${FRUIT_NAME[isle.fruit]}`))
        card.onclick = () => { seed = s; p.classList.remove('wide'); done(true) }
        grid.append(card)
      }
      const again = el('button', 'btn', '都不太喜欢，再看看别的') as HTMLButtonElement
      again.onclick = () => { audio.play('click', 0.3); draw() }
      p.append(grid, again)
    }
    draw()
  })
  await say('doudou', '^这座岛不错！')

  // ── 带什么 ──
  const answer = await ask('ahai', '最后一个问题：去无人岛的话，你最想带什么？', ['睡袋', '灯', '吃的', '打发时间的东西'])
  await say('ahai', ['^睡得好最重要！', '^晚上的岛上确实很黑呢。', '^吃饱了才有力气干活！', '^岛上的时间可长着呢。'][answer])
  await say('doudou', '^手续都办好了！老潘的水上飞机马上起飞，祝你在岛上住得开心！')

  // ── 飞过去 ──
  await flight(root, assets)
  root.remove()
  return { name, hue, birthday: [bm, bd], hemi, seed, answer }
}

// 预览：衣服颜色换过的农夫行走帧，原地转圈
function drawFarmer(cv: HTMLCanvasElement, assets: GameAssets, hue: number, frame: number) {
  const g = cv.getContext('2d')!
  g.imageSmoothingEnabled = false
  g.clearRect(0, 0, cv.width, cv.height)
  const dirs = ['down', 'side', 'up', 'side'] as const
  const di = Math.floor(frame / 12) % 4
  const t = assets.farmers.get(hue)?.[`walk_${dirs[di]}_${frame % 4}`]
  if (!t) return
  const S = 4, src = t.source.resource as HTMLCanvasElement, fr = t.frame
  const dx = Math.round((cv.width - fr.width * S) / 2), dy = cv.height - 12 - fr.height * S
  g.fillStyle = 'rgba(40,60,40,0.18)'; g.beginPath(); g.ellipse(cv.width / 2, cv.height - 12, 36, 8, 0, 0, Math.PI * 2); g.fill()
  g.save()
  if (di === 3) { g.translate(dx * 2 + fr.width * S, 0); g.scale(-1, 1) }
  g.drawImage(src, fr.x, fr.y, fr.width, fr.height, dx, dy, fr.width * S, fr.height * S)
  g.restore()
}

// 水上飞机飞过海面（约 3 秒），然后整个屏幕淡出
async function flight(root: HTMLElement, assets: GameAssets) {
  const sky = el('div', 'ck-flight')
  const plane = el('div', 'ck-plane')
  const t = assets.island.seaplane
  if (t) {
    const src = (t.source.resource as HTMLImageElement | ImageBitmap)
    const cv = el('canvas') as HTMLCanvasElement
    const fr = t.frame, res = t.source.resolution
    cv.width = fr.width * res; cv.height = fr.height * res
    cv.getContext('2d')!.drawImage(src as CanvasImageSource, fr.x * res, fr.y * res, fr.width * res, fr.height * res, 0, 0, cv.width, cv.height)
    plane.append(cv)
  }
  for (let i = 0; i < 6; i++) { const c = el('div', 'ck-cloud'); c.style.top = `${10 + Math.random() * 50}%`; c.style.animationDelay = `${-Math.random() * 4}s`; c.style.transform = `scale(${0.6 + Math.random()})`; sky.append(c) }
  sky.append(plane)
  root.append(sky)
  await wait(50)
  sky.classList.add('on')
  await wait(3200)
  root.classList.add('out')
  await wait(700)
}
