// 第 1 天服务端流程测试：手机和里程、DIY 教室、钓鱼抓虫、交给周叔研究、帐篷小摊、砍树敲石头、换日刷新、移居费。
// 用法：node --disable-warning=ExperimentalWarning tools/test-day1.mjs
import { DatabaseSync } from 'node:sqlite'
import { startServer, stopServer, connect, playDay0, cleanDb, check, failed, wait } from './test-lib.mjs'
import { ISLE_W, IT } from '../shared/isle/gen.ts'
import { TILE, setWorldEpoch, calendarOf, dayOf, hourOf } from '../shared/data.ts'
import { FISHES, BUGS, fishAvailable, bugAvailable } from '../shared/critters.ts'

const DB = 'server/data/_d1.db', PORT = 8795, SEED = 4242
cleanDb(DB)
let srv = await startServer(DB, PORT, ['--start-hour', '12'])
let c = await connect(PORT)
const { g, plaza } = await playDay0(c, SEED)
check('走完第 0 天', c.isle?.stage === 'day1', c.isle?.stage)
const you = c.welcome.you, token = c.welcome.token, isleId = c.isle.id
setWorldEpoch(c.welcome.epoch)
const month = calendarOf(dayOf(c.welcome.clock)).month, hour = hourOf(c.welcome.clock)

// ── 出帐篷，拿手机 ──
c.send({ t: 'scene', to: `isle:${isleId}` }); await wait(300)
await c.walk(plaza.x, plaza.y)
let n0 = c.msgs.length
c.send({ t: 'prologue', step: 'phone' }); await wait(300)
check('拿到手机 → DIY 教室', c.isle?.stage === 'diy' && c.prog?.phone, `stage=${c.isle?.stage}`)
check('学会简易钓竿', c.prog?.recipes.includes('flimsy_rod'))
check('移居成就 +500 里程', c.prog?.miles === 500 && c.since(n0).some(m => m.t === 'miles' && m.miles === 500), `里程 ${c.prog?.miles}`)

// ── 凑树枝：地上剩下的 + 摇树 ──
async function getBranches(n) {
  for (const b of g.objects.filter(o => o.kind === 'branch' && !c.isle.removed.includes(o.id))) {
    if (c.count('branch') >= n) return
    await c.walk(b.x, b.y + 6); c.send({ t: 'pickup', obj: b.id }); await wait(100)
  }
  for (const d of c.isle.drops.filter(d => d.item === 'branch')) {
    if (c.count('branch') >= n) return
    await c.walk(d.x, d.y + 4); c.send({ t: 'pickup', drop: d.id }); await wait(100)
  }
  // 摇广场附近的树（每棵每天一次，三成掉树枝）
  const trees = g.objects.filter(o => o.kind === 'tree' && !c.isle.removed.includes(o.id) && g.start[Math.floor((o.y + 14) / TILE) * ISLE_W + Math.floor(o.x / TILE)])
    .sort((a, b) => Math.hypot(a.x - plaza.x, a.y - plaza.y) - Math.hypot(b.x - plaza.x, b.y - plaza.y))
  for (const t of trees.slice(0, 60)) {
    if (c.count('branch') >= n) return
    await c.walk(t.x, t.y + 14); c.send({ t: 'shake', obj: t.id }); await wait(150)
    for (const d of c.isle.drops.filter(d => d.item === 'branch')) { await c.walk(d.x, d.y + 4); c.send({ t: 'pickup', drop: d.id }); await wait(100) }
  }
}
await getBranches(5)
check('凑够 5 根树枝', c.count('branch') >= 5, `${c.count('branch')} 根`)
// 离工作台太远不能做
const farTree = g.objects.find(o => o.kind === 'tree' && Math.hypot(o.x - plaza.x, o.y - plaza.y) > 20 * TILE && g.start[Math.floor((o.y + 14) / TILE) * ISLE_W + Math.floor(o.x / TILE)])
if (farTree) {
  await c.walk(farTree.x, farTree.y + 14)
  c.send({ t: 'craft', recipe: 'flimsy_rod' }); await wait(250)
  check('离工作台太远做不了', c.slotOf('flimsy_rod') < 0)
}
await c.walk(plaza.x, plaza.y)
c.send({ t: 'craft', recipe: 'flimsy_net' }); await wait(250)
check('没学会的配方做不了', c.slotOf('flimsy_net') < 0)
n0 = c.msgs.length
c.send({ t: 'craft', recipe: 'flimsy_rod' }); await wait(300)
const rod = c.inv[c.slotOf('flimsy_rod')]
check('做出简易钓竿（耐久 10）', rod?.d === 10, JSON.stringify(rod))
check('做完 → 研究生物、学会捕虫网和篝火', c.isle?.stage === 'critters' && c.prog?.recipes.includes('flimsy_net') && c.prog?.recipes.includes('campfire'), c.isle?.stage)
check('第一次 DIY +300 里程', c.since(n0).some(m => m.t === 'miles' && m.miles === 300))

// ── 钓鱼：到海边 ──
let shore = null
for (let y = 0; y < g.types.length / ISLE_W && !shore; y++) for (let x = 0; x < ISLE_W && !shore; x++) {
  const i = y * ISLE_W + x
  if (g.types[i] !== IT.SAND || !g.start[i]) continue
  if ([[0, 2], [0, 3], [2, 0], [-2, 0]].some(([dx, dy]) => g.types[(y + dy) * ISLE_W + x + dx] === IT.SHALLOW)) shore = { x: (x + 0.5) * TILE, y: (y + 0.5) * TILE }
}
check('找到能走到的海边', !!shore)
const seaFish = FISHES.filter(f => f.loc === 'sea' && fishAvailable(f, month, hour, 'N'))
const riverFish = FISHES.find(f => f.loc === 'river' && fishAvailable(f, month, hour, 'N'))
check(`现在（${month} 月 ${hour.toFixed(1)} 点）海里有 5 种以上的鱼`, seaFish.length >= 5, seaFish.map(f => f.name).join(' '))
await c.walk(shore.x, shore.y)
c.send({ t: 'catch', kind: 'fish', id: seaFish[0].id, slot: c.slotOf('branch') }); await wait(300)
check('没拿钓竿钓不到', c.slotOf(`fsh_${seaFish[0].id}`) < 0)
if (riverFish) { c.send({ t: 'catch', kind: 'fish', id: riverFish.id, slot: c.slotOf('flimsy_rod') }); await wait(300); check('海边钓不到河鱼', c.slotOf(`fsh_${riverFish.id}`) < 0) }
await wait(2100)
n0 = c.msgs.length
for (const f of seaFish.slice(0, 5)) {
  c.send({ t: 'catch', kind: 'fish', id: f.id, slot: c.slotOf('flimsy_rod') }); await wait(2150)
}
const fishGot = seaFish.slice(0, 5).filter(f => c.slotOf(`fsh_${f.id}`) >= 0).length
check('钓到 5 种海鱼', fishGot === 5, `${fishGot} 种`)
check('钓竿用了 5 次（剩 5）', c.inv[c.slotOf('flimsy_rod')]?.d === 5, JSON.stringify(c.inv[c.slotOf('flimsy_rod')]))
check('图鉴记下 5 种鱼', c.prog?.pedia.fish.length === 5)
check('第一条鱼 +300、5 个新物种 +500', c.since(n0).filter(m => m.t === 'miles').map(m => m.miles).join(',') === '300,500', c.since(n0).filter(m => m.t === 'miles').map(m => m.name + m.miles).join(' '))
c.send({ t: 'catch', kind: 'fish', id: seaFish[0].id, slot: c.slotOf('flimsy_rod') })
c.send({ t: 'catch', kind: 'fish', id: seaFish[1].id, slot: c.slotOf('flimsy_rod') }); await wait(300)
check('一秒内只能钓一条', c.inv.filter(x => x?.id === `fsh_${seaFish[0].id}` || x?.id === `fsh_${seaFish[1].id}`).length === 3)

// ── 交给周叔研究 ──
await c.walk(plaza.x, plaza.y)
n0 = c.msgs.length
for (const f of seaFish.slice(0, 5)) { c.send({ t: 'give', slot: c.slotOf(`fsh_${f.id}`) }); await wait(250); if (c.prog.given.length === 2) check('交 2 只 → 学会简易斧头', c.prog.recipes.includes('flimsy_axe')); if (c.prog.given.length === 4) check('交 4 只 → 学会简易洒水壶', c.prog.recipes.includes('flimsy_can')) }
check('交满 5 种 → 等馆长', c.prog?.given.length === 5 && c.isle?.stage === 'curator', c.isle?.stage)
const dupSlot = c.slotOf(`fsh_${seaFish[0].id}`)
c.send({ t: 'give', slot: dupSlot }); await wait(250)
check('研究过的不再收', c.inv[dupSlot]?.id === `fsh_${seaFish[0].id}`)

// ── 抓虫 ──
const bug = BUGS.find(b => bugAvailable(b, month, hour, 'N'))
if (bug) {
  await getBranches(5)
  await c.walk(plaza.x, plaza.y)
  c.send({ t: 'craft', recipe: 'flimsy_net' }); await wait(300)
  check('做出简易捕虫网（耐久 10）', c.inv[c.slotOf('flimsy_net')]?.d === 10)
  await wait(1800)
  c.send({ t: 'catch', kind: 'bug', id: bug.id, slot: c.slotOf('flimsy_net') }); await wait(300)
  check(`抓到${bug.name}`, c.slotOf(`bug_${bug.id}`) >= 0 && c.prog.pedia.bugs.includes(bug.id))
}
const offBug = BUGS.find(b => !bugAvailable(b, month, hour, 'N'))
if (offBug) { await wait(2100); c.send({ t: 'catch', kind: 'bug', id: offBug.id, slot: c.slotOf('flimsy_net') }); await wait(300); check(`现在不出的${offBug.name}抓不到`, c.slotOf(`bug_${offBug.id}`) < 0) }

// ── 帐篷小摊：卖水果、买斧头 ──
const fruitN = c.count(g.fruit)
c.send({ t: 'isleShop', op: 'sell', slot: c.slotOf(g.fruit), all: true }); await wait(300)
check(`卖掉 ${fruitN} 个本地水果（每个 100）`, c.coins === fruitN * 100, `铃钱 ${c.coins}`)
c.send({ t: 'isleShop', op: 'sell', slot: c.slotOf('kit_tent'), all: true }); await wait(200)
const fishSlot = c.slotOf(`fsh_${seaFish[0].id}`)
const fishPrice = seaFish[0].price
const before = c.coins
c.send({ t: 'isleShop', op: 'sell', slot: fishSlot, all: false }); await wait(300)
check(`卖一条${seaFish[0].name}（${fishPrice}）`, c.coins === before + fishPrice)
let coins = c.coins
if (coins < 200) { // 钱不够就再卖几条
  for (const f of seaFish.slice(1)) { const sl = c.slotOf(`fsh_${f.id}`); if (sl >= 0) { c.send({ t: 'isleShop', op: 'sell', slot: sl, all: true }); await wait(200) } }
  coins = c.coins
}
c.send({ t: 'isleShop', op: 'buy', item: 'flimsy_axe', n: 1 }); await wait(300)
check('买简易斧头（200，耐久 40）', c.coins === coins - 200 && c.inv[c.slotOf('flimsy_axe')]?.d === 40, `铃钱 ${c.coins}`)

// ── 砍树：每棵每天 3 块木材 ──
const tree = g.objects.filter(o => o.kind === 'tree' && !c.isle.removed.includes(o.id) && g.start[Math.floor((o.y + 14) / TILE) * ISLE_W + Math.floor(o.x / TILE)])
  .sort((a, b) => Math.hypot(a.x - plaza.x, a.y - plaza.y) - Math.hypot(b.x - plaza.x, b.y - plaza.y))[0]
await c.walk(tree.x, tree.y + 14)
const woodDrops = () => c.isle.drops.filter(d => ['wood', 'softwood', 'hardwood'].includes(d.item)).length
for (let i = 0; i < 4; i++) { c.send({ t: 'tool', kind: 'chop', obj: tree.id, slot: c.slotOf('flimsy_axe') }); await wait(200) }
check('砍 4 下只出 3 块木材', woodDrops() === 3, `${woodDrops()} 块`)
check('斧头用了 4 次', c.inv[c.slotOf('flimsy_axe')]?.d === 36)
for (const d of c.isle.drops.filter(d => ['wood', 'softwood', 'hardwood'].includes(d.item))) { await c.walk(d.x, d.y + 4); c.send({ t: 'pickup', drop: d.id }); await wait(100) }
check('捡起木材', c.count('wood') + c.count('softwood') + c.count('hardwood') === 3)

// ── 敲石头：每块每天 8 下 ──
const rocks = g.objects.filter(o => o.kind === 'rock' && g.start[Math.floor((o.y + 14) / TILE) * ISLE_W + Math.floor(o.x / TILE)])
check('有能走到的石头', rocks.length >= 1, `${rocks.length} 块；今天的钱石 ${c.isle.moneyRock}`)
const rock = rocks.find(r => r.id !== c.isle.moneyRock) ?? rocks[0]
await c.walk(rock.x, rock.y + 14)
const mats = () => c.isle.drops.filter(d => ['stone', 'iron_nugget', 'clay', 'gold_nugget'].includes(d.item)).length
const m0 = mats(), coins0 = c.coins
for (let i = 0; i < 10; i++) { c.send({ t: 'tool', kind: 'rock', obj: rock.id, slot: c.slotOf('flimsy_axe') }); await wait(150) }
if (rock.id === c.isle.moneyRock) check('钱石 8 下出铃钱', c.coins - coins0 >= 16100, `+${c.coins - coins0}`)
else check('普通石头 10 下只出 8 个矿', mats() - m0 === 8, `${mats() - m0} 个：${c.isle.drops.filter(d => ['stone', 'iron_nugget', 'clay', 'gold_nugget'].includes(d.item)).map(d => d.item).join(',')}`)
check('斧头一共用了 12 次', c.inv[c.slotOf('flimsy_axe')]?.d === 28)

// ── 移居费：里程不够付不了 ──
await c.walk(plaza.x, plaza.y)
c.send({ t: 'payBill', with: 'miles' }); await wait(300)
check(`里程不够（${c.prog.miles}）付不了`, !c.prog.bill.paid)
const milesBefore = c.prog.miles, invBefore = JSON.stringify(c.inv.map(x => x && x.id))
c.ws.close(); await wait(300)
await stopServer(srv)

// ── 第二天：换日刷新、存档还在 ──
const db = new DatabaseSync(DB)
const row = db.prepare('SELECT prog FROM players WHERE id=?').get(you)
const p = JSON.parse(row.prog); p.miles += 5000
db.prepare('UPDATE players SET prog=? WHERE id=?').run(JSON.stringify(p), you)
const st0 = JSON.parse(db.prepare('SELECT data FROM isles WHERE id=?').get(isleId).data)
db.close()
srv = await startServer(DB, PORT, ['--start-hour', '12', '--day-offset', '1'])
c = await connect(PORT)
c.send({ t: 'hello', token, name: '', hue: 180 }); await wait(500)
check('第二天登录回到岛上', c.welcome?.scene === `isle:${isleId}` && c.welcome.day === st0.day + 1, `第 ${c.welcome?.day} 天`)
check('进度存住了（配方、图鉴、里程）', c.prog?.recipes.includes('flimsy_axe') && c.prog.pedia.fish.length === 5 && c.prog.miles === milesBefore + 5000)
check('背包存住了', JSON.stringify(c.inv.map(x => x && x.id)) === invBefore)
const branchesNow = c.isle.drops.filter(d => d.item === 'branch').length + g.objects.filter(o => o.kind === 'branch' && !c.isle.removed.includes(o.id)).length
check('树枝长回来了', branchesNow > st0.drops.filter(d => d.item === 'branch').length + g.objects.filter(o => o.kind === 'branch' && !st0.removed.includes(o.id)).length, `${branchesNow} 根`)
check('长了新杂草', c.isle.drops.filter(d => d.item === 'weeds').length > st0.drops.filter(d => d.item === 'weeds').length)
check('沙滩上有贝壳', c.isle.drops.filter(d => d.item.startsWith('shell_')).length >= 8, `${c.isle.drops.filter(d => d.item.startsWith('shell_')).length} 个`)
c.me = { x: c.welcome.x, y: c.welcome.y }
await c.walk(tree.x, tree.y + 14)
const w0 = woodDrops()
c.send({ t: 'tool', kind: 'chop', obj: tree.id, slot: c.slotOf('flimsy_axe') }); await wait(250)
check('隔天同一棵树又能砍出木材', woodDrops() === w0 + 1)
await c.walk(plaza.x, plaza.y)
c.send({ t: 'payBill', with: 'miles' }); await wait(300)
check('用 5,000 里程付清移居费', c.prog.bill.paid && c.prog.miles === milesBefore)
c.ws.close(); await stopServer(srv)
cleanDb(DB)
if (/Error|错误|at .*\.ts:\d+/.test(srv.log)) console.log(srv.log.slice(-1500))
console.log(failed() ? `\n${failed()} 项没过` : '\n全部通过')
process.exit(failed() ? 1 : 0)
