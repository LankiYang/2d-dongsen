// 服务端流程测试的公共部分：起一个独立存档、独立端口的服务端，连上去，一步步走路（服务端限速），按原作开局走完第 0 天。
import { spawn } from 'node:child_process'
import { rmSync, existsSync } from 'node:fs'
import WebSocket from 'ws'
import { makeIsle, ISLE_W, IT } from '../shared/isle/gen.ts'
import { TILE } from '../shared/data.ts'

export const wait = ms => new Promise(r => setTimeout(r, ms))
let fails = 0
export const check = (name, ok, extra = '') => { console.log(`${ok ? '✅' : '❌'} ${name}${extra ? '  ' + extra : ''}`); if (!ok) fails++ }
export const failed = () => fails

export function cleanDb(db) { for (const f of [db, db + '-wal', db + '-shm']) try { if (existsSync(f)) rmSync(f) } catch {} }

// 起服务端（extra：额外的命令行参数）
export async function startServer(db, port, extra = []) {
  const srv = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'server/main.ts', '--port', String(port), '--db', db, ...extra], { stdio: ['ignore', 'pipe', 'pipe'] })
  srv.log = ''
  srv.stdout.on('data', d => srv.log += d); srv.stderr.on('data', d => srv.log += d)
  for (let i = 0; i < 80 && !srv.log.includes('服务端'); i++) await wait(100)
  return srv
}
export async function stopServer(srv) { srv.kill(); await new Promise(r => srv.once('exit', r)); await wait(200) }

// 一个客户端：记下最新的岛、背包、铃钱、进度和收到的所有消息
export async function connect(port) {
  const ws = new WebSocket(`ws://localhost:${port}/ws`)
  const c = { ws, msgs: [], isle: null, inv: [], coins: 0, prog: null, me: { x: 0, y: 0 }, welcome: null }
  ws.on('message', d => {
    const m = JSON.parse(String(d)); c.msgs.push(m)
    if (m.t === 'isle') c.isle = m.isle
    if (m.t === 'inv') { c.inv = m.inv; if (m.coins !== undefined) c.coins = m.coins }
    if (m.t === 'prog') c.prog = m.prog
    if (m.t === 'goto') c.me = { x: m.x, y: m.y }
    if (m.t === 'welcome') { c.welcome = m; c.isle = m.isle; c.inv = m.inv; c.coins = m.coins; c.prog = m.prog ?? null; c.me = { x: m.x, y: m.y } }
  })
  await new Promise(r => ws.on('open', r))
  c.send = m => ws.send(JSON.stringify(m))
  // 走过去：每 60ms 走 16px（服务端每次上报最多认 150px/s × 间隔 + 24px）
  c.walk = async (x, y) => {
    for (let i = 0; i < 600; i++) {
      const dx = x - c.me.x, dy = y - c.me.y, d = Math.hypot(dx, dy)
      if (d < 2) break
      const st = Math.min(d, 16)
      c.me.x += dx / d * st; c.me.y += dy / d * st
      c.send({ t: 'move', x: c.me.x, y: c.me.y, dir: 'down', moving: true })
      await wait(60)
    }
  }
  c.count = id => c.inv.reduce((a, x) => a + (x?.id === id ? x.n : 0), 0)
  c.slotOf = id => c.inv.findIndex(x => x?.id === id)
  c.last = t => [...c.msgs].reverse().find(m => m.t === t)
  c.since = n => c.msgs.slice(n)
  return c
}

// 走完第 0 天：办手续 → 登岛 → 搭帐篷 → 帮邻居 → 树枝 → 水果 → 篝火会 → 睡觉
export async function playDay0(c, seed, { verbose = false } = {}) {
  const ok = verbose ? check : () => {}
  const g = makeIsle(seed)
  c.send({ t: 'hello', token: '', name: '', hue: 180 }); await wait(300)
  ok('新玩家先去办手续', c.msgs.some(m => m.t === 'checkin'))
  c.send({ t: 'checkin', name: '测试岛民', hue: 35, birthday: [10, 7], hemi: 'N', seed, answer: 2 }); await wait(500)
  const w = c.welcome
  ok('办完手续进岛', w && w.scene.startsWith('isle:') && c.isle?.stage === 'arrive', w && `${w.scene} stage=${c.isle?.stage}`)
  ok('口袋是空的、0 铃钱', w && w.coins === 0 && w.inv.every(x => !x))
  ok('两位开局村民', c.isle?.villagers.length === 2, c.isle?.villagers.map(v => v.id).join(','))
  const plaza = { x: (g.plaza.x + g.plaza.w / 2) * TILE, y: (g.plaza.y + g.plaza.h + 1) * TILE }
  await c.walk(plaza.x, plaza.y)
  c.send({ t: 'prologue', step: 'orientation' }); await wait(300)
  ok('说明会 → 领到帐篷', c.isle?.stage === 'tent' && c.inv.some(x => x?.id === 'kit_tent'))
  const tryPlace = async slot => {
    for (let dx = 8; dx < 30; dx += 1) for (const dy of [0, 3, -3, 6]) {
      const tx = g.plaza.x + g.plaza.w + dx, ty = g.plaza.y + g.plaza.h + dy
      const i = ty * ISLE_W + tx
      if (g.types[i] !== IT.GRASS || !g.start[i]) continue
      await c.walk((tx + 0.5) * TILE, (ty + 1.5) * TILE)
      const before = JSON.stringify(c.isle)
      c.send({ t: 'place', slot, tx, ty }); await wait(250)
      if (JSON.stringify(c.isle) !== before) return { tx, ty }
    }
    return null
  }
  const t1 = await tryPlace(c.slotOf('kit_tent'))
  ok('放下自己的帐篷 → 帮邻居', !!t1 && c.isle?.tent && c.isle?.stage === 'neighbors', JSON.stringify(c.isle?.tent))
  for (const v of c.isle.villagers) {
    c.send({ t: 'prologue', step: 'vkit:' + v.id }); await wait(200)
    const sl = c.slotOf('kit_vtent_' + v.id)
    ok(`拿到 ${v.id} 的帐篷包`, sl >= 0)
    await tryPlace(sl)
  }
  ok('两顶村民帐篷 → 捡树枝', c.isle?.villagers.every(v => v.tent) && c.isle?.stage === 'branches', c.isle?.stage)
  const branches = g.objects.filter(o => o.kind === 'branch' && !c.isle.removed.includes(o.id))
  for (const b of branches.slice(0, 12)) { await c.walk(b.x, b.y + 6); c.send({ t: 'pickup', obj: b.id }); await wait(120) }
  ok('捡到 10 根以上树枝', c.count('branch') >= 10, `${c.count('branch')} 根`)
  await c.walk(plaza.x, plaza.y)
  c.send({ t: 'prologue', step: 'branches' }); await wait(300)
  ok('交树枝 → 摘水果', c.isle?.stage === 'fruit')
  for (const t of g.objects.filter(o => o.kind === 'fruit_tree').slice(0, 3)) {
    await c.walk(t.x, t.y + 14); c.send({ t: 'shake', obj: t.id }); await wait(250)
    for (const d of c.isle.drops.filter(d => d.item === g.fruit)) { await c.walk(d.x, d.y + 4); c.send({ t: 'pickup', drop: d.id }); await wait(120) }
  }
  ok(`摘到 6 个以上${g.fruit}`, c.count(g.fruit) >= 6, `${c.count(g.fruit)} 个`)
  await c.walk(plaza.x, plaza.y)
  c.send({ t: 'prologue', step: 'fruit' }); await wait(300)
  ok('交水果 → 篝火会', c.isle?.stage === 'party')
  c.send({ t: 'prologue', step: 'name', name: '小可岛' }); await wait(300)
  ok('起岛名（去掉末尾的「岛」）→ 拿到折叠床', c.isle?.name === '小可' && c.isle?.stage === 'sleep' && c.inv.some(x => x?.id === 'cot'))
  await c.walk((c.isle.tent.tx + 0.5) * TILE, (c.isle.tent.ty + 1.4) * TILE)
  c.send({ t: 'scene', to: 'tent:' + w.you }); await wait(200)
  c.send({ t: 'prologue', step: 'sleep' }); await wait(300)
  ok('进帐篷睡觉 → 第 1 天', c.isle?.stage === 'day1')
  return { g, plaza }
}
