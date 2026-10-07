// 动森式的岛（2D动森）：每人一座，存在 isles 表里。
// 地形、树、石头这些不变的东西由种子生成（shared/isle/gen.ts，前后端一样）；
// 存档里只记会变的：序章阶段、帐篷、村民、被压掉 / 捡走的物件、摘过的果树、地上的东西。
// 序章第 0 天的每一步都由服务端校验（够不够近、东西够不够、是不是这一步）。
import type { DatabaseSync } from 'node:sqlite'
import { makeIsle, ISLE_W, ISLE_H } from '../shared/isle/gen.ts'
import { canPlaceTent, tentTiles } from '../shared/isle/rules.ts'
import type { Isle } from '../shared/isle/gen.ts'
import { starters, VILLAGERS } from '../shared/villagers.ts'
import { TILE } from '../shared/data.ts'
import type { IslePublic, IsleStage, TentSpot, IsleDrop, ServerMsg, SceneId, Slot } from '../shared/protocol.ts'

export interface IsleSession {
  id: number
  name: string
  scene: SceneId
  x: number; y: number
  inv: (Slot | null)[]
  dirty: boolean
  isle?: number               // 自己的岛
}
export interface IsleCtx<S extends IsleSession> {
  db: DatabaseSync
  today(): number
  sessions: Set<S>
  send(s: S, m: ServerMsg): void
  addItem(s: S, id: string, n?: number): boolean
  takeItem(s: S, id: string, n?: number): boolean
  sendInv(s: S): void
}

interface IsleState {
  stage: IsleStage
  tent: TentSpot | null
  villagers: { id: string, tent: TentSpot | null }[]
  removed: number[]
  fruitTaken: Record<number, number>
  drops: IsleDrop[]
  dropSeq: number
  shook: Record<number, number>      // 普通树哪天摇过（每天每棵最多掉一次树枝）
  answer: number                     // 机场柜台「带什么去荒岛」的回答
}
interface IsleRec { id: number, owner: number, ownerName: string, seed: number, name: string, hemi: 'N' | 'S', st: IsleState }


export function initIsles<S extends IsleSession>(ctx: IsleCtx<S>) {
  const { db } = ctx
  db.exec(`CREATE TABLE IF NOT EXISTS isles (id INTEGER PRIMARY KEY AUTOINCREMENT, owner INTEGER, seed INTEGER, name TEXT, hemi TEXT, data TEXT)`)
  const cols = (db.prepare('PRAGMA table_info(players)').all() as { name: string }[]).map(c => c.name)
  if (!cols.includes('isle')) db.exec('ALTER TABLE players ADD COLUMN isle INTEGER')
  if (!cols.includes('birthday')) db.exec('ALTER TABLE players ADD COLUMN birthday TEXT')

  const geos = new Map<number, Isle>()
  const geo = (seed: number) => { let g = geos.get(seed); if (!g) { g = makeIsle(seed); geos.set(seed, g) } return g }
  const recs = new Map<number, IsleRec>()

  function load(id: number): IsleRec | null {
    const hit = recs.get(id)
    if (hit) return hit
    const row = db.prepare('SELECT i.*, p.name AS ownerName FROM isles i LEFT JOIN players p ON p.id = i.owner WHERE i.id=?').get(id) as any
    if (!row) return null
    const rec: IsleRec = { id: row.id, owner: row.owner, ownerName: row.ownerName ?? '', seed: row.seed, name: row.name ?? '', hemi: row.hemi === 'S' ? 'S' : 'N', st: JSON.parse(row.data) }
    recs.set(id, rec)
    return rec
  }
  const save = (r: IsleRec) => db.prepare('UPDATE isles SET name=?, data=? WHERE id=?').run(r.name, JSON.stringify(r.st), r.id)
  const pub = (r: IsleRec): IslePublic => ({
    id: r.id, owner: r.owner, ownerName: r.ownerName, seed: r.seed, name: r.name, stage: r.st.stage, tent: r.st.tent,
    villagers: r.st.villagers, removed: r.st.removed, fruitTaken: r.st.fruitTaken, drops: r.st.drops, hemi: r.hemi,
  })
  const sceneOf = (r: IsleRec): SceneId => `isle:${r.id}`
  function push(r: IsleRec) {
    save(r)
    const m: ServerMsg = { t: 'isle', isle: pub(r) }
    for (const s of ctx.sessions) if (s.scene === sceneOf(r) || s.scene === `tent:${r.owner}`) ctx.send(s, m)
  }

  // 新岛：开局的两位村民按种子挑（运动 + 大姐姐）
  function create(owner: number, seed: number, hemi: 'N' | 'S', answer: number): number {
    const st: IsleState = {
      stage: 'arrive', tent: null, villagers: starters(seed).map(id => ({ id, tent: null })),
      removed: [], fruitTaken: {}, drops: [], dropSeq: 1, shook: {}, answer,
    }
    const res = db.prepare('INSERT INTO isles(owner, seed, name, hemi, data) VALUES(?,?,?,?,?)').run(owner, seed, '', hemi, JSON.stringify(st))
    return Number(res.lastInsertRowid)
  }

  const isleOfScene = (scene: SceneId) => scene.startsWith('isle:') ? load(Number(scene.slice(5))) : null
  // 站在自己的岛上、离某点不超过 r 格
  const nearPx = (s: S, x: number, y: number, r: number) => Math.hypot(s.x - x, s.y - y) <= r * TILE
  const toast = (s: S, text: string) => ctx.send(s, { t: 'toast', text })

  // ── 帐篷能不能放（规则在 shared/isle/rules.ts，客户端预览也用它）──
  const canPlace = (r: IsleRec, spot: TentSpot) => canPlaceTent(geo(r.seed), r.st, spot)
  function place(r: IsleRec, spot: TentSpot) {
    const g = geo(r.seed)
    const tiles = new Set(tentTiles(spot).map(([x, y]) => `${x},${y}`))
    // 压到的树、花、草、树枝清掉（石头前面已经挡了）
    for (const o of g.objects) {
      if (r.st.removed.includes(o.id)) continue
      if (tiles.has(`${Math.floor(o.x / TILE)},${Math.floor((o.y - 2) / TILE)}`)) r.st.removed.push(o.id)
    }
    r.st.drops = r.st.drops.filter(d => !tiles.has(`${Math.floor(d.x / TILE)},${Math.floor(d.y / TILE)}`))
  }

  // 地上掉东西：围着 (x, y) 撒开
  function drop(r: IsleRec, item: string, x: number, y: number) {
    r.st.drops.push({ id: r.st.dropSeq++, item, x: Math.round(x), y: Math.round(y) })
  }

  return {
    geo, load, pub, create, sceneOf,

    // 登录：自己的岛（没有的返回 null，要先去机场办手续）
    welcomeIsle(s: S): IslePublic | null {
      const r = isleOfScene(s.scene) ?? (s.isle ? load(s.isle) : null)
      return r ? pub(r) : null
    },
    arrive(isleId: number) { const r = load(isleId); return r ? geo(r.seed).arrive : { x: 0, y: 0 } },

    // 在岛上能走的范围
    clamp(s: S) {
      if (s.scene.startsWith('isle:')) { s.x = Math.max(0, Math.min(ISLE_W * TILE, s.x)); s.y = Math.max(0, Math.min(ISLE_H * TILE, s.y)); return true }
      if (s.scene.startsWith('tent:')) { s.x = Math.max(0, Math.min(6 * TILE, s.x)); s.y = Math.max(0, Math.min(6 * TILE, s.y)); return true }
      return false
    },

    // 进出帐篷
    sceneChange(s: S, to: SceneId): boolean {
      if (to.startsWith('tent:')) {
        const owner = Number(to.slice(5))
        const r = isleOfScene(s.scene)
        // 不让进（不是自己的帐篷、离门口太远）：把客户端拉回原地，免得两边场景对不上
        const back = () => { ctx.send(s, { t: 'goto', scene: s.scene, x: s.x, y: s.y }); return true }
        if (!r || r.owner !== owner || !r.st.tent) return back()
        const doorX = (r.st.tent.tx + 0.5) * TILE, doorY = (r.st.tent.ty + 1) * TILE
        if (!nearPx(s, doorX, doorY, 3)) return back()
        s.scene = to; s.x = 3 * TILE; s.y = 5 * TILE - 6; s.dirty = true
        return true
      }
      if (to.startsWith('isle:') && s.scene.startsWith('tent:')) {
        const r = load(Number(to.slice(5)))
        if (!r || `tent:${r.owner}` !== s.scene || !r.st.tent) return true
        s.scene = to; s.x = (r.st.tent.tx + 0.5) * TILE; s.y = (r.st.tent.ty + 1.6) * TILE; s.dirty = true
        return true
      }
      return false
    },

    pickup(s: S, m: { obj?: number, drop?: number }) {
      const r = isleOfScene(s.scene)
      if (!r) return
      if (m.drop !== undefined) {
        const d = r.st.drops.find(x => x.id === m.drop)
        if (!d || !nearPx(s, d.x, d.y, 2.2)) return
        if (!ctx.addItem(s, d.item)) { toast(s, '口袋满了'); return }
        r.st.drops = r.st.drops.filter(x => x !== d)
      } else if (m.obj !== undefined) {
        const o = geo(r.seed).objects.find(x => x.id === m.obj)
        if (!o || o.kind !== 'branch' || r.st.removed.includes(o.id) || !nearPx(s, o.x, o.y, 2.2)) return
        if (!ctx.addItem(s, 'branch')) { toast(s, '口袋满了'); return }
        r.st.removed.push(o.id)
      } else return
      ctx.sendInv(s)
      push(r)
    },

    shake(s: S, objId: number) {
      const r = isleOfScene(s.scene)
      if (!r) return
      const o = geo(r.seed).objects.find(x => x.id === objId)
      if (!o || r.st.removed.includes(o.id) || !nearPx(s, o.x, o.y, 2.4)) return
      const day = ctx.today()
      if (o.kind === 'fruit_tree') {
        const taken = r.st.fruitTaken[o.id]
        if (taken !== undefined && day - taken < 3) return    // 摘了以后 3 天再结果
        r.st.fruitTaken[o.id] = day
        const fruit = geo(r.seed).fruit
        for (const [dx, dy] of [[-14, 10], [0, 16], [14, 10]]) drop(r, fruit, o.x + dx, o.y + dy)
        push(r)
      } else if (o.kind === 'tree') {
        if (r.st.shook[o.id] === day) return
        r.st.shook[o.id] = day
        if (Math.random() < 0.3) { drop(r, 'branch', o.x + (Math.random() < 0.5 ? -14 : 14), o.y + 12); push(r) }
      }
    },

    place(s: S, m: { slot: number, tx: number, ty: number }) {
      const r = isleOfScene(s.scene)
      if (!r || r.owner !== s.id) return
      const it = s.inv[m.slot]
      if (!it) return
      const spot = { tx: Math.round(m.tx), ty: Math.round(m.ty) }
      if (!nearPx(s, (spot.tx + 0.5) * TILE, (spot.ty + 0.5) * TILE, 4)) return
      const why = canPlace(r, spot)
      if (why) { toast(s, why); return }
      if (it.id === 'kit_tent' && r.st.stage === 'tent' && !r.st.tent) {
        ctx.takeItem(s, 'kit_tent'); place(r, spot); r.st.tent = spot
        r.st.stage = 'neighbors'
      } else if (it.id.startsWith('kit_vtent_') && r.st.stage === 'neighbors') {
        const v = r.st.villagers.find(x => `kit_vtent_${x.id}` === it.id)
        if (!v || v.tent) return
        ctx.takeItem(s, it.id); place(r, spot); v.tent = spot
        if (r.st.villagers.every(x => x.tent)) r.st.stage = 'branches'
      } else return
      ctx.sendInv(s)
      push(r)
    },

    // 序章推进
    prologue(s: S, m: { step: string, name?: string }) {
      const r = isleOfScene(s.scene) ?? (s.scene.startsWith('tent:') && s.isle ? load(s.isle) : null)
      if (!r || r.owner !== s.id) return
      const g = geo(r.seed)
      const plazaC = { x: (g.plaza.x + g.plaza.w / 2) * TILE, y: (g.plaza.y + g.plaza.h / 2) * TILE }
      const st = r.st
      if (m.step === 'orientation' && st.stage === 'arrive') {
        if (!nearPx(s, plazaC.x, plazaC.y, 12)) return
        if (!ctx.addItem(s, 'kit_tent')) { toast(s, '口袋满了'); return }
        st.stage = 'tent'
      } else if (m.step.startsWith('vkit:') && st.stage === 'neighbors') {
        const v = st.villagers.find(x => x.id === m.step.slice(5))
        if (!v || v.tent || s.inv.some(x => x?.id === `kit_vtent_${v.id}`)) return
        if (!ctx.addItem(s, `kit_vtent_${v.id}`)) { toast(s, '口袋满了'); return }
      } else if (m.step === 'branches' && st.stage === 'branches') {
        if (!nearPx(s, plazaC.x, plazaC.y, 12) || !ctx.takeItem(s, 'branch', 10)) return
        st.stage = 'fruit'
      } else if (m.step === 'fruit' && st.stage === 'fruit') {
        if (!nearPx(s, plazaC.x, plazaC.y, 12) || !ctx.takeItem(s, g.fruit, 6)) return
        st.stage = 'party'
      } else if (m.step === 'name' && st.stage === 'party') {
        const name = String(m.name ?? '').replace(/[\s<>]/g, '').slice(0, 8)
        if (!name) return
        r.name = name
        ctx.addItem(s, 'cot')
        st.stage = 'sleep'
      } else if (m.step === 'sleep' && st.stage === 'sleep') {
        if (s.scene !== `tent:${r.owner}`) return
        ctx.takeItem(s, 'cot')
        st.stage = 'day1'
      } else return
      ctx.sendInv(s)
      push(r)
    },
  }
}
export type Isles = ReturnType<typeof initIsles>
