// 龟教授（博物馆馆长）的对话：第一次见面给铲子和撑竿的配方；之后鉴定化石、收展品。岛上帐篷门口和博物馆前台共用。
import type { Game } from '../game.ts'
import type { ServerMsg } from '../../shared/protocol.ts'
import { state } from '../state.ts'
import { ITEMS } from '../../shared/data.ts'
import { CURATOR } from '../../shared/villagers.ts'
import { MUSEUM_GOAL } from '../../shared/diy.ts'

const say = (g: Game, text: string) => g.hud.say({ name: CURATOR.name, title: CURATOR.title, face: `v:${CURATOR.id}`, voice: CURATOR.voice, text })
const ask = (g: Game, text: string, options: string[], cancel: number) => g.hud.ask({ name: CURATOR.name, title: CURATOR.title, face: `v:${CURATOR.id}`, voice: CURATOR.voice, text }, options, cancel)
// 等服务端回一条消息（最多等 ms 毫秒）
export function waitMsg<T extends ServerMsg['t']>(g: Game, t: T, ms = 1500) {
  return new Promise<Extract<ServerMsg, { t: T }> | null>(res => {
    const timer = setTimeout(() => { off(); res(null) }, ms)
    const off = g.net.on(t, m => { off(); clearTimeout(timer); res(m) })
  })
}

const donatable = (id: string) => !!ITEMS[id]?.critter || id.startsWith('fos_')
// 口袋里还没捐过的展品（同一种只列一次）
function newExhibits() {
  const done = state.isle?.museum.donated ?? []
  const seen = new Set<string>()
  const out: { slot: number, id: string, name: string }[] = []
  state.me.inv.forEach((x, i) => {
    if (!x || !donatable(x.id) || done.includes(x.id) || seen.has(x.id)) return
    seen.add(x.id); out.push({ slot: i, id: x.id, name: ITEMS[x.id].name })
  })
  return out
}
const haveFossil = () => state.me.inv.some(x => x?.id === 'fossil')
const left = () => { const m = state.isle!.museum; return Math.max(0, MUSEUM_GOAL - (m.donated.length - m.base)) }

export async function talkCurator(g: Game) {
  const pub = state.isle!
  if (pub.stage === 'curatorHere') { await firstMeeting(g); return }
  const opts: string[] = [], acts: (() => Promise<void>)[] = []
  if (haveFossil()) { opts.push('鉴定化石'); acts.push(() => assess(g)) }
  if (newExhibits().length) { opts.push('捐东西'); acts.push(() => donate(g)) }
  if (pub.stage === 'museum15') { opts.push('还差几件？'); acts.push(() => say(g, `还差 ${left()} 件……鱼、虫、鉴定过的化石都行，每种一件就好。`)) }
  if (pub.stage === 'museumBuild') { opts.push('博物馆什么时候盖好？'); acts.push(() => say(g, '^明天！明天一早就能开馆了……到时候一定要来看看。')) }
  if (pub.stage === 'museumOpen') { opts.push('聊聊天'); acts.push(() => say(g, ['化石啊，是大地写给我们的信……一个字一个字，慢慢读。', '我年轻的时候，游过半个大洋……那时候的海，比现在还要蓝。', '^展品越来越多了……这座岛真是个宝库。'][Math.floor(Math.random() * 3)])) }
  opts.push('没事')
  const text = pub.stage === 'museumOpen' ? '^欢迎光临博物馆……今天想做点什么？' : '^哦……是你呀。今天有什么新发现吗？'
  const i = await ask(g, text, opts, opts.length - 1)
  if (acts[i]) await acts[i]()
}

async function firstMeeting(g: Game) {
  await say(g, '^哦……你好你好。我是龟教授，一个……研究岛上的生物和化石的老头子。')
  await say(g, '周叔把你抓到的鱼和虫都给我看了……真是了不起的开始啊。')
  await say(g, '我想在这座岛上办一座博物馆……把岛上的生灵、还有地底下远古的秘密，都好好地留下来。')
  g.net.send({ t: 'prologue', step: 'curatorHello' })
  await waitMsg(g, 'prog')
  g.hud.toast('学会了「简易铲子」和「撑竿」的做法')
  await say(g, '这两样东西的做法送给你。地上要是看到星星一样的裂缝，用铲子挖挖看……底下往往埋着化石。')
  await say(g, '挖到的化石拿来给我鉴定。撑竿嘛……能跳过小河，河对岸说不定有新的发现。')
  await say(g, `^再给我带 ${MUSEUM_GOAL} 件新的展品——鱼、虫、化石都行——我就能把这顶帐篷换成真正的博物馆了。`)
}

async function assess(g: Game) {
  await say(g, '嗯……让我看看……（扶了扶眼镜）')
  g.net.send({ t: 'assess' })
  const m = await waitMsg(g, 'assessed')
  if (!m) return
  for (const id of m.items.slice(0, 4)) await say(g, `^这是……「${ITEMS[id]?.name ?? id}」！`)
  if (m.items.length > 4) await say(g, `……还有 ${m.items.length - 4} 件，我都写在标签上了。`)
  await say(g, '鉴定好了。捐给博物馆也好，留着也好……都随你。')
}

// 一件一件地捐，捐完接着问
async function donate(g: Game) {
  for (;;) {
    const list = newExhibits()
    if (!list.length) { await say(g, '……暂时就这些了吗？有了新发现，随时拿来。'); return }
    const opts = [...list.slice(0, 5).map(x => x.name), '算了']
    const i = await ask(g, '要捐哪一件呢？', opts, opts.length - 1)
    const pick = list[i]
    if (!pick) return
    const stage = state.isle!.stage
    g.net.send({ t: 'museumDonate', slot: pick.slot })
    await waitMsg(g, 'isle')
    if (stage === 'museum15' && state.isle!.stage === 'museumBuild') {
      await say(g, `^「${pick.name}」……！这下……这下够了！`)
      await say(g, '明天，博物馆就会在这里盖起来。……谢谢你，真的谢谢你。')
      return
    }
    const lines = [`^「${pick.name}」！真漂亮……我会好好照顾它的。`, `^哦哦，「${pick.name}」……这可是好东西。`, `^「${pick.name}」……嗯，嗯，展柜里正缺这个。`]
    await say(g, lines[state.isle!.museum.donated.length % 3] + (state.isle!.stage === 'museum15' ? `还差 ${left()} 件。` : ''))
  }
}
