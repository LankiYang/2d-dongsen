// 第 0 天（开局）服务端流程回归测试：独立存档、独立端口，按原作开局走一遍。用法：node --disable-warning=ExperimentalWarning tools/test-day0.mjs
import { spawn } from 'node:child_process'
import { rmSync, existsSync } from 'node:fs'
import WebSocket from 'ws'
import { makeIsle, ISLE_W, IT } from '../shared/isle/gen.ts'
import { TILE } from '../shared/data.ts'

const DB = 'server/data/_d0.db', PORT = 8796
const wait = ms => new Promise(r => setTimeout(r, ms))
let fails = 0
const check = (name, ok, extra = '') => { console.log(`${ok ? '✅' : '❌'} ${name}${extra ? '  ' + extra : ''}`); if (!ok) fails++ }
for (const f of [DB, DB + '-wal', DB + '-shm']) if (existsSync(f)) rmSync(f)
const srv = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'server/main.ts', '--port', String(PORT), '--db', DB], { stdio: ['ignore', 'pipe', 'pipe'] })
let log = ''; srv.stdout.on('data', d => log += d); srv.stderr.on('data', d => log += d)
for (let i = 0; i < 60 && !log.includes('服务端'); i++) await wait(100)

const ws = new WebSocket(`ws://localhost:${PORT}/ws`)
const msgs = []
let isle = null, inv = [], me = { x: 0, y: 0 }
ws.on('message', d => { const m = JSON.parse(String(d)); msgs.push(m); if (m.t === 'isle') isle = m.isle; if (m.t === 'inv') inv = m.inv; if (m.t === 'welcome') { isle = m.isle; inv = m.inv; me = { x: m.x, y: m.y } } })
await new Promise(r => ws.on('open', r))
const send = m => ws.send(JSON.stringify(m))
send({ t: 'hello', token: '', name: '', hue: 180 })
await wait(300)
check('新玩家先去办手续', msgs.some(m => m.t === 'checkin'))
const SEED = 4242
send({ t: 'checkin', name: '测试岛民', hue: 35, birthday: [10, 7], hemi: 'N', seed: SEED, answer: 2 })
await wait(500)
const w = msgs.find(m => m.t === 'welcome')
check('办完手续进岛', w && w.scene.startsWith('isle:') && isle?.stage === 'arrive', w && `${w.scene} stage=${isle?.stage}`)
check('口袋是空的、0 铃钱', w && w.coins === 0 && w.inv.every(x => !x))
check('两位开局村民', isle?.villagers.length === 2, isle?.villagers.map(v => v.id).join(','))
const g = makeIsle(SEED)
// 一步步走过去（服务端限速）
async function walk(x, y) {
  for (let i = 0; i < 400; i++) {
    const dx = x - me.x, dy = y - me.y, d = Math.hypot(dx, dy)
    if (d < 2) break
    const st = Math.min(d, 14)
    me.x += dx / d * st; me.y += dy / d * st
    send({ t: 'move', x: me.x, y: me.y, dir: 'down', moving: true })
    await wait(60)
  }
}
const plaza = { x: (g.plaza.x + g.plaza.w / 2) * TILE, y: (g.plaza.y + g.plaza.h + 1) * TILE }
await walk(plaza.x, plaza.y)
send({ t: 'prologue', step: 'orientation' }); await wait(300)
check('说明会 → 领到帐篷', isle?.stage === 'tent' && inv.some(x => x?.id === 'kit_tent'))
// 找一块能放帐篷的空地：广场东边
const slot = inv.findIndex(x => x?.id === 'kit_tent')
const tryPlace = async (slot, kit) => {
  for (let dx = 8; dx < 30; dx += 1) for (const dy of [0, 3, -3, 6]) {
    const tx = g.plaza.x + g.plaza.w + dx, ty = g.plaza.y + g.plaza.h + dy
    const i = ty * ISLE_W + tx
    if (g.types[i] !== IT.GRASS || !g.start[i]) continue
    await walk((tx + 0.5) * TILE, (ty + 1.5) * TILE)
    const before = JSON.stringify(isle)
    send({ t: 'place', slot, tx, ty }); await wait(250)
    if (JSON.stringify(isle) !== before) return { tx, ty }
  }
  return null
}
const t1 = await tryPlace(slot, 'kit_tent')
check('放下自己的帐篷 → 帮邻居', !!t1 && isle?.tent && isle?.stage === 'neighbors', JSON.stringify(isle?.tent))
for (const v of isle.villagers) {
  send({ t: 'prologue', step: 'vkit:' + v.id }); await wait(200)
  const sl = inv.findIndex(x => x?.id === 'kit_vtent_' + v.id)
  check(`拿到 ${v.id} 的帐篷包`, sl >= 0)
  await tryPlace(sl)
}
check('两顶村民帐篷 → 捡树枝', isle?.villagers.every(v => v.tent) && isle?.stage === 'branches', isle?.stage)
// 捡 10 根树枝
const branches = g.objects.filter(o => o.kind === 'branch' && !isle.removed.includes(o.id))
for (const b of branches.slice(0, 12)) { await walk(b.x, b.y + 6); send({ t: 'pickup', obj: b.id }); await wait(120) }
const nb = inv.reduce((a, x) => a + (x?.id === 'branch' ? x.n : 0), 0)
check('捡到 10 根以上树枝', nb >= 10, `${nb} 根`)
await walk(plaza.x, plaza.y)
send({ t: 'prologue', step: 'branches' }); await wait(300)
check('交树枝 → 摘水果', isle?.stage === 'fruit')
// 摇果树、捡水果
for (const t of g.objects.filter(o => o.kind === 'fruit_tree').slice(0, 3)) {
  await walk(t.x, t.y + 14); send({ t: 'shake', obj: t.id }); await wait(250)
  for (const d of isle.drops.filter(d => d.item === g.fruit)) { await walk(d.x, d.y + 4); send({ t: 'pickup', drop: d.id }); await wait(120) }
}
const nf = inv.reduce((a, x) => a + (x?.id === g.fruit ? x.n : 0), 0)
check(`摘到 6 个以上${g.fruit}`, nf >= 6, `${nf} 个`)
await walk(plaza.x, plaza.y)
send({ t: 'prologue', step: 'fruit' }); await wait(300)
check('交水果 → 篝火会', isle?.stage === 'party')
send({ t: 'prologue', step: 'name', name: '小可岛' }); await wait(300)
check('起岛名 → 拿到折叠床', isle?.name === '小可岛' && isle?.stage === 'sleep' && inv.some(x => x?.id === 'cot'))
await walk((isle.tent.tx + 0.5) * TILE, (isle.tent.ty + 1.4) * TILE)
send({ t: 'scene', to: 'tent:' + w.you }); await wait(200)
send({ t: 'prologue', step: 'sleep' }); await wait(300)
check('进帐篷睡觉 → 第 1 天', isle?.stage === 'day1')
ws.close(); srv.kill(); await wait(500)
for (const f of [DB, DB + '-wal', DB + '-shm']) try { if (existsSync(f)) rmSync(f) } catch {}
if (/Error|错误/.test(log)) console.log(log.slice(-800))
console.log(fails ? `\n${fails} 项没过` : '\n全部通过')
process.exit(fails ? 1 : 0)
