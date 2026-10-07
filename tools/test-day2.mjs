// 第 2～3 天服务端流程测试：馆长的帐篷（按博物馆大小预留）→ 第二天馆长到、化石点出现 → 铲子和撑竿配方 → 挖化石、鉴定 → 再捐 15 件 → 第二天博物馆开馆、进馆捐东西。
// 用法：node --disable-warning=ExperimentalWarning tools/test-day2.mjs
import { DatabaseSync } from 'node:sqlite'
import { startServer, stopServer, connect, playDay0, playDay1, getBranches, catchFish, findShore, cleanDb, check, failed, wait } from './test-lib.mjs'
import { ISLE_W, IT } from '../shared/isle/gen.ts'
import { canPlaceFoot, MUSEUM_W, MUSEUM_H, MUSEUM_DESK } from '../shared/isle/rules.ts'
import { TILE, setWorldEpoch, calendarOf, dayOf, hourOf } from '../shared/data.ts'
import { FISHES, BUGS, fishAvailable, bugAvailable } from '../shared/critters.ts'

const DB = 'server/data/_d2.db', PORT = 8794, SEED = 4242
cleanDb(DB)
let srv = await startServer(DB, PORT, ['--start-hour', '12'])
let c = await connect(PORT)
const { g, plaza } = await playDay0(c, SEED)
setWorldEpoch(c.welcome.epoch)
const month = calendarOf(dayOf(c.welcome.clock)).month, hour = hourOf(c.welcome.clock)
const seaFish = FISHES.filter(f => f.loc === 'sea' && fishAvailable(f, month, hour, 'N'))
const bugs = BUGS.filter(b => bugAvailable(b, month, hour, 'N'))
const token = c.welcome.token, isleId = c.isle.id
await playDay1(c, g, plaza, seaFish)
check('交满 5 只 → 拿到馆长的帐篷包', c.isle?.stage === 'curator' && c.slotOf('kit_curator') >= 0, c.isle?.stage)

// ── 放馆长的帐篷：占地按博物馆 7×4 ──
let spot = null
for (let r = 6; r < 40 && !spot; r++) for (let a = 0; a < 24 && !spot; a++) {
  const tx = Math.round(g.plaza.x + g.plaza.w / 2 + Math.cos(a / 24 * Math.PI * 2) * r), ty = Math.round(g.plaza.y + g.plaza.h / 2 + Math.sin(a / 24 * Math.PI * 2) * r)
  if (!g.start[(ty + 1) * ISLE_W + tx]) continue
  if (!canPlaceFoot(g, c.isle, { tx, ty }, MUSEUM_W, MUSEUM_H)) spot = { tx, ty }
}
check('找到放得下博物馆的地方', !!spot, JSON.stringify(spot))
await c.walk((spot.tx + 0.5) * TILE, (spot.ty + 1.5) * TILE)
c.send({ t: 'place', slot: c.slotOf('kit_curator'), tx: spot.tx, ty: spot.ty }); await wait(300)
check('放下馆长的帐篷 → 等他明天来', c.isle?.stage === 'curatorWait' && c.isle.curatorTent?.tx === spot.tx, c.isle?.stage)
check('馆长来之前没有化石点', c.isle.digs.length === 0)
c.ws.close(); await wait(300); await stopServer(srv)

// ── 第 2 天 ──
srv = await startServer(DB, PORT, ['--start-hour', '12', '--day-offset', '1'])
c = await connect(PORT)
c.send({ t: 'hello', token, name: '', hue: 180 }); await wait(500)
check('第 2 天馆长到了', c.isle?.stage === 'curatorHere', c.isle?.stage)
check('地上冒出 4 个化石点', c.isle.digs.length === 4, `${c.isle.digs.length} 个`)
const door = { x: (spot.tx + 0.5) * TILE, y: (spot.ty + 1.5) * TILE }
await c.walk(door.x, door.y)
c.send({ t: 'scene', to: `museum:${isleId}` }); await wait(300)
check('博物馆还没盖好进不去', c.last('goto')?.scene === `isle:${isleId}`)
c.me = { x: door.x, y: door.y }
const cur = { x: (spot.tx + 0.5) * TILE + 34, y: (spot.ty + 1.5) * TILE }
await c.walk(cur.x, cur.y + 10)
c.send({ t: 'assess' }); await wait(200)
c.send({ t: 'prologue', step: 'curatorHello' }); await wait(300)
check('见过馆长 → 学会简易铲子和撑竿', c.isle?.stage === 'museum15' && c.prog.recipes.includes('flimsy_shovel') && c.prog.recipes.includes('vaulting_pole'), c.isle?.stage)
check('周叔那 5 只算捐过的', c.isle.museum.donated.length === 5 && c.isle.museum.base === 5)

// 卖水果买斧头，砍树凑硬木（铲子）和软木（撑竿）
await c.walk(plaza.x, plaza.y)
c.send({ t: 'isleShop', op: 'sell', slot: c.slotOf(g.fruit), all: true }); await wait(250)
c.send({ t: 'isleShop', op: 'buy', item: 'flimsy_axe', n: 1 }); await wait(250)
check('买到简易斧头', c.slotOf('flimsy_axe') >= 0, `铃钱 ${c.coins}`)
const trees = g.objects.filter(o => o.kind === 'tree' && !c.isle.removed.includes(o.id) && g.start[Math.floor((o.y + 14) / TILE) * ISLE_W + Math.floor(o.x / TILE)])
  .sort((a, b) => Math.hypot(a.x - plaza.x, a.y - plaza.y) - Math.hypot(b.x - plaza.x, b.y - plaza.y))
for (const t of trees) {
  if (c.count('hardwood') >= 5 && c.count('softwood') >= 5) break
  await c.walk(t.x, t.y + 14)
  for (let i = 0; i < 3; i++) { c.send({ t: 'tool', kind: 'chop', obj: t.id, slot: c.slotOf('flimsy_axe') }); await wait(150) }
  for (const d of c.isle.drops.filter(d => ['wood', 'softwood', 'hardwood'].includes(d.item))) { await c.walk(d.x, d.y + 4); c.send({ t: 'pickup', drop: d.id }); await wait(80) }
}
check('凑够 5 块硬木和 5 块软木', c.count('hardwood') >= 5 && c.count('softwood') >= 5, `硬木 ${c.count('hardwood')} 软木 ${c.count('softwood')}`)
await c.walk(plaza.x, plaza.y)
c.send({ t: 'craft', recipe: 'flimsy_shovel' }); await wait(250)
c.send({ t: 'craft', recipe: 'vaulting_pole' }); await wait(250)
check('做出简易铲子和撑竿', c.inv[c.slotOf('flimsy_shovel')]?.d === 40 && c.slotOf('vaulting_pole') >= 0)

// ── 挖化石 ──
const d0 = c.isle.digs[0]
await c.walk((d0.tx + 0.5) * TILE, (d0.ty + 1.4) * TILE)
c.send({ t: 'dig', tx: d0.tx, ty: d0.ty, slot: c.slotOf('flimsy_axe') }); await wait(250)
check('拿斧头挖不了', c.isle.digs.length === 4)
for (const d of [...c.isle.digs]) {
  await c.walk((d.tx + 0.5) * TILE, (d.ty + 1.4) * TILE)
  c.send({ t: 'dig', tx: d.tx, ty: d.ty, slot: c.slotOf('flimsy_shovel') }); await wait(250)
}
check('挖出 4 块未鉴定的化石', c.count('fossil') === 4 && c.isle.digs.length === 0, `${c.count('fossil')} 块`)
check('铲子用了 4 次', c.inv[c.slotOf('flimsy_shovel')]?.d === 36)
await c.walk(plaza.x, plaza.y)
c.send({ t: 'isleShop', op: 'sell', slot: c.slotOf('fossil'), all: true }); await wait(200)
check('未鉴定的化石卖不掉', c.count('fossil') === 4)

// ── 鉴定、捐赠 ──
await c.walk(cur.x, cur.y + 10)
c.send({ t: 'assess' }); await wait(300)
const assessed = c.last('assessed')?.items ?? []
check('龟教授鉴定了 4 块化石', assessed.length === 4 && c.count('fossil') === 0 && assessed.every(id => c.slotOf(id) >= 0), assessed.join(','))
const donateAll = async ids => { for (const id of ids) { const sl = c.slotOf(id); if (sl >= 0 && c.isle.stage === 'museum15') { c.send({ t: 'museumDonate', slot: sl }); await wait(150) } } }
await donateAll([...new Set(assessed)])
const dupe = assessed.find((id, i) => assessed.indexOf(id) !== i)
if (dupe) { const before = c.isle.museum.donated.length; c.send({ t: 'museumDonate', slot: c.slotOf(dupe) }); await wait(200); check('同一种只收一件', c.isle.museum.donated.length === before && c.slotOf(dupe) >= 0) }
check('化石捐进博物馆', c.isle.museum.donated.length === 5 + new Set(assessed).size)
// 抓虫凑数
await getBranches(c, g, plaza, 5)
await c.walk(plaza.x, plaza.y)
c.send({ t: 'craft', recipe: 'flimsy_net' }); await wait(250)
let need = 15 - (c.isle.museum.donated.length - 5) + 1   // 多抓一只留到开馆后在馆里捐
for (const b of bugs) {
  if (need <= 0 || c.slotOf('flimsy_net') < 0) break
  c.send({ t: 'catch', kind: 'bug', id: b.id, slot: c.slotOf('flimsy_net') }); await wait(1100)
  if (c.slotOf(`bug_${b.id}`) >= 0) need--
}
// 还差的用海鱼补（钓竿还剩 5 次）
if (need > 0) await catchFish(c, findShore(g), seaFish.slice(5, 5 + need))
await c.walk(cur.x, cur.y + 10)
await donateAll([...bugs.map(b => `bug_${b.id}`), ...seaFish.slice(5).map(f => `fsh_${f.id}`)])
check('再捐满 15 件 → 盖博物馆', c.isle.stage === 'museumBuild' && c.isle.museum.donated.length - c.isle.museum.base >= 15, `${c.isle.stage} ${c.isle.museum.donated.length - c.isle.museum.base} 件`)
const leftover = c.inv.find(x => x && (x.id.startsWith('bug_') || x.id.startsWith('fsh_')) && !c.isle.museum.donated.includes(x.id))
c.ws.close(); await wait(300); await stopServer(srv)

// ── 第 3 天：开馆 ──
srv = await startServer(DB, PORT, ['--start-hour', '12', '--day-offset', '2'])
c = await connect(PORT)
c.send({ t: 'hello', token, name: '', hue: 180 }); await wait(500)
check('第 3 天博物馆开馆', c.isle?.stage === 'museumOpen', c.isle?.stage)
await c.walk(door.x, door.y)
c.send({ t: 'scene', to: `museum:${isleId}` }); await wait(300)
check('走进博物馆', !c.last('goto'))
c.me = { x: 13 * TILE, y: 16 * TILE - 20 }
await c.walk(MUSEUM_DESK.x, MUSEUM_DESK.y + 30)
if (leftover) {
  const n = c.isle.museum.donated.length
  c.send({ t: 'museumDonate', slot: c.slotOf(leftover.id) }); await wait(250)
  check('在馆里的前台也能捐', c.isle.museum.donated.length === n + 1, leftover.id)
}
c.send({ t: 'scene', to: `isle:${isleId}` }); await wait(300)
c.ws.close(); await wait(200); await stopServer(srv)
const db = new DatabaseSync(DB)
const row = db.prepare('SELECT scene, y FROM players WHERE token=?').get(token)
db.close()
check('出馆回到岛上（门口下面）', row.scene === `isle:${isleId}` && Math.abs(row.y - (spot.ty + 1.7) * TILE) < 2, `${row.scene} y=${row.y}`)
cleanDb(DB)
if (/Error|错误|at .*\.ts:\d+/.test(srv.log)) console.log(srv.log.slice(-1500))
console.log(failed() ? `\n${failed()} 项没过` : '\n全部通过')
process.exit(failed() ? 1 : 0)
