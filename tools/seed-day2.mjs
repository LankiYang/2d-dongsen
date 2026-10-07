// 测试用：新建一个存档，自动走完第 0 天和第 1 天、放下馆长的帐篷，再把存档的「每日刷新」往回拨一天 → 下次启动就是龟教授到岛的第 2 天。
// 加 --museum：直接改成博物馆已开馆、随便捐了一半展品（看馆里的样子用）。
// 用法：node --disable-warning=ExperimentalWarning tools/seed-day2.mjs [存档=server/data/test.db] [--museum]
// 跑之前先停掉用这个存档的服务端；跑完再启动（比如 launch.json 的 dongsen2d-test-server）
import { DatabaseSync } from 'node:sqlite'
import { startServer, stopServer, connect, playDay0, playDay1, cleanDb, wait } from './test-lib.mjs'
import { ISLE_W } from '../shared/isle/gen.ts'
import { canPlaceFoot, MUSEUM_W, MUSEUM_H } from '../shared/isle/rules.ts'
import { TILE, setWorldEpoch, calendarOf, dayOf, hourOf } from '../shared/data.ts'
import { FISHES, BUGS, fishAvailable } from '../shared/critters.ts'
import { FOSSILS } from '../shared/fossils.ts'

const DB = process.argv.find(a => a.endsWith('.db')) ?? 'server/data/test.db'
const museum = process.argv.includes('--museum')
cleanDb(DB)
const srv = await startServer(DB, 8792, ['--start-hour', '12'])
const c = await connect(8792)
const { g, plaza } = await playDay0(c, 4242)
setWorldEpoch(c.welcome.epoch)
const month = calendarOf(dayOf(c.welcome.clock)).month, hour = hourOf(c.welcome.clock)
await playDay1(c, g, plaza, FISHES.filter(f => f.loc === 'sea' && fishAvailable(f, month, hour, 'N')))
// 馆长的帐篷放在广场附近能放下博物馆的地方
let spot = null
for (let r = 6; r < 40 && !spot; r++) for (let a = 0; a < 24 && !spot; a++) {
  const tx = Math.round(g.plaza.x + g.plaza.w / 2 + Math.cos(a / 24 * Math.PI * 2) * r), ty = Math.round(g.plaza.y + g.plaza.h / 2 + Math.sin(a / 24 * Math.PI * 2) * r)
  if (g.start[(ty + 1) * ISLE_W + tx] && !canPlaceFoot(g, c.isle, { tx, ty }, MUSEUM_W, MUSEUM_H)) spot = { tx, ty }
}
await c.walk((spot.tx + 0.5) * TILE, (spot.ty + 1.5) * TILE)
c.send({ t: 'place', slot: c.slotOf('kit_curator'), tx: spot.tx, ty: spot.ty }); await wait(300)
const token = c.welcome.token, isleId = c.isle.id, stage = c.isle.stage
c.ws.close(); await wait(200); await stopServer(srv)

const db = new DatabaseSync(DB)
const row = db.prepare('SELECT data FROM isles WHERE id=?').get(isleId)
const st = JSON.parse(row.data)
st.day -= 1; st.curatorDay -= 1      // 下次读档就是第二天：龟教授到了、地上冒出化石点
if (museum) {
  const all = [...FISHES.map(f => `fsh_${f.id}`), ...BUGS.map(b => `bug_${b.id}`), ...FOSSILS.map(f => `fos_${f.id}`)]
  st.stage = 'museumOpen'
  st.museum = { donated: all.filter((_, i) => i % 2 === 0), base: 5 }
}
db.prepare('UPDATE isles SET data=? WHERE id=?').run(JSON.stringify(st), isleId)
db.close()
console.log(JSON.stringify({ stage: museum ? 'museumOpen' : stage, token, name: '测试岛民', hue: 35, curatorTent: spot }))
process.exit(0)
