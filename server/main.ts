// ═══ 潮汐港 · 持久世界服务端 ═══
// 权威数据：世界时钟、农田、背包金币、鱼群。玩家位置由客户端上报、服务端做速度校验。
// 存档：SQLite（server/data/world.db）。开发时 Vite 把 /ws 代理到这里；生产环境这里同时托管 dist/。
import { createServer } from 'node:http'
import { readFileSync, existsSync, mkdirSync, statSync } from 'node:fs'
import { join, extname, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomBytes } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import { WebSocketServer, WebSocket } from 'ws'
import {
  TILE, DAY_MS, DAY_START_HOUR, dayOf, calendarOf, isRainy, rainingAt, rainWindow, sixAm, setWorldEpoch, WEEKDAY_NAMES, ENERGY_REGEN_MS, RESTAURANT_GUESTS_PER_DAY, CROPS, cropStage, ITEMS, FISH, INV_SIZE, START_COINS, START_INV,
  SHIRT_HUES, DISHES, QUALITY_MULT, hourOf, restaurantOpen, pickIngredients,
  START_GEAR, TANKS, HARPOONS, BASKETS, ENERGY_MAX, DIVE_ENERGY, PRESSURE_LIMIT_Y, gearDef, gearMax, affordable, SHARKS, SHARK_BITE_RANGE, BITE_INVULN_MS,
} from '../shared/data.ts'
import type { ItemId, CropId, Zone, DishId, Gear } from '../shared/data.ts'
import { RESTAURANT, stationAt, canServe, homeRoom } from '../shared/rooms.ts'
import type { Room } from '../shared/rooms.ts'
import { FURNITURE, canPlace, starterHome, furnKind, furnItem, CHEST_SIZE } from '../shared/furniture.ts'
import type { HomeData } from '../shared/furniture.ts'
import { buildIsland, isTillable, PLACES, ISLAND_W, ISLAND_H, LOTS, lotDoor, NPC_SPOTS, NOTICE_BOARD, nearMarket } from '../shared/island.ts'
import { NPC_INFO, NPC_IDS, TASTE_PTS, TALK_PTS, QUEST_PTS, GIFTS_PER_WEEK, BIRTHDAY_MULT, HEART, MAX_HEARTS, hearts, tasteOf, giftable, isBirthday } from '../shared/npcs.ts'
import type { NpcId } from '../shared/npcs.ts'
import { dailyQuest, INTRO_QUEST, WELCOME_MAIL, HEART_MAIL, RESTORE_MAIL, GUIDE, GUIDE_DONE_MAIL } from '../shared/quests.ts'
import type { GuideAction } from '../shared/quests.ts'
import { SEA_FINDS } from '../shared/sea.ts'
import { EVENT_BY_ID, EVENTS } from '../shared/events.ts'
import { STAGES, ALL_REQS, stageFunded, MARKET_DAY } from '../shared/restore.ts'
import type { RestoreState } from '../shared/restore.ts'
import { nearScheduled, town } from '../shared/schedules.ts'
import type { Quest, Mail } from '../shared/quests.ts'
import { buildSea, randomOpenPoint, seaSolid, openness, zoneAt, BOAT_X, SEA_W, ZONES } from '../shared/sea.ts'
import { rng } from '../shared/noise.ts'
import { World } from '../shared/world/gen.ts'
import { MAPS } from '../shared/world/maps.ts'
import { plotKey } from '../shared/protocol.ts'
import type { RelPublic } from '../shared/protocol.ts'
import type { ClientMsg, ServerMsg, PlayerPublic, PlotState, Slot, SceneId, Dir, FishPublic, HouseInfo, Customer, Holding } from '../shared/protocol.ts'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
// 命令行参数（优先）或环境变量：--port 8798 --db server/data/test.db --start-hour 16.8（测试用：把「现在」挪到今天几点，不存档）
const arg = (k: string) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : undefined }
const PORT = Number(arg('port') ?? process.env.PORT ?? 8799)
const DB_FILE = arg('db') ?? process.env.TIDE_DB

// ── 存档 ──
mkdirSync(join(ROOT, 'server/data'), { recursive: true })
// TIDE_DB 可以指定别的存档文件（测试时用独立存档，不碰正式世界）
const db = new DatabaseSync(DB_FILE ? join(ROOT, DB_FILE) : join(ROOT, 'server/data/world.db'))
db.exec(`
  CREATE TABLE IF NOT EXISTS players (id INTEGER PRIMARY KEY AUTOINCREMENT, token TEXT UNIQUE, name TEXT, hue INTEGER,
    coins INTEGER, inv TEXT, scene TEXT, x REAL, y REAL);
  CREATE TABLE IF NOT EXISTS plots (key TEXT PRIMARY KEY, data TEXT);
  CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT);
`)
// 老存档没有宅基地字段：补列
const cols = (db.prepare('PRAGMA table_info(players)').all() as { name: string }[]).map(c => c.name)
if (!cols.includes('lot')) db.exec('ALTER TABLE players ADD COLUMN lot INTEGER')
if (!cols.includes('style')) db.exec('ALTER TABLE players ADD COLUMN style INTEGER')
if (!cols.includes('gear')) db.exec('ALTER TABLE players ADD COLUMN gear TEXT')
if (!cols.includes('home')) db.exec('ALTER TABLE players ADD COLUMN home TEXT')
if (!cols.includes('story')) db.exec('ALTER TABLE players ADD COLUMN story TEXT')  // 关系、任务、信件（JSON）   // 小屋里的家具和储物箱（JSON）

function houses(): HouseInfo[] {
  return (db.prepare('SELECT id, name, lot, style FROM players WHERE lot IS NOT NULL').all() as any[])
    .map(r => ({ lot: r.lot, owner: r.id, name: r.name, style: LOTS[r.lot]?.style ?? 0 }))
}
// 分配最小的空宅基地；村子住满了返回 null
function assignLot(id: number): number | null {
  const taken = new Set(houses().map(h => h.lot))
  const free = LOTS.find(l => !taken.has(l.id))
  if (!free) return null
  db.prepare('UPDATE players SET lot=?, style=? WHERE id=?').run(free.id, id % 4, id)
  return free.id
}

const getMeta = (k: string) => (db.prepare('SELECT v FROM meta WHERE k=?').get(k) as { v: string } | undefined)?.v
const setMeta = (k: string, v: string) => db.prepare('INSERT INTO meta(k,v) VALUES(?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v').run(k, v)

// 世界时钟（动森方向：跟现实同步，北京时间）：epochReal = 第 1 天早上 6 点的时间戳，第几天 = 从那天起数。
// 新世界从今天算第 1 天；星露谷方向的老世界（10 分钟一天，存的是 epoch）第一次按新规则启动时，
// 把 epochReal 定在「今天 6 点往前推 (老天数 - 1) 天」，天数接着往下数，作物、委托期限、聊天送礼记录都不会突然跳一大截
let epoch = Number(getMeta('epochReal'))
if (!epoch) {
  const oldDay = Number(getMeta('lastDay')) || 1
  epoch = sixAm(Date.now()) - (oldDay - 1) * DAY_MS
  setMeta('epochReal', String(epoch))
}
setWorldEpoch(epoch)
// 测试用：--start-hour 把「现在」挪到今天的这个钟点（只影响这次运行；挪动量在 ±12 小时内）
let timeShift = 0
if (arg('start-hour') !== undefined) {
  const want = Number(arg('start-hour')), cur = DAY_START_HOUR + ((Date.now() - epoch) % DAY_MS) / 3600000
  timeShift = ((((want - cur) % 24) + 36) % 24 - 12) * 3600000
}
const clockNow = () => Date.now() + timeShift - epoch

const plots = new Map<string, PlotState>()
for (const row of db.prepare('SELECT key, data FROM plots').all() as { key: string, data: string }[]) plots.set(row.key, JSON.parse(row.data))
const savePlot = (key: string) => {
  const p = plots.get(key)
  if (p) db.prepare('INSERT INTO plots(key,data) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET data=excluded.data').run(key, JSON.stringify(p))
  else db.prepare('DELETE FROM plots WHERE key=?').run(key)
}

const island = buildIsland()
const sea = buildSea()

// ── 玩家会话 ──
interface Session {
  ws: WebSocket
  id: number
  token: string
  name: string
  hue: number
  coins: number
  inv: (Slot | null)[]
  scene: SceneId
  x: number; y: number
  dir: Dir
  moving: boolean
  act?: string; actAt?: number
  fullToastAt?: number
  lastMoveAt: number
  lastHitAt: number
  diveCatch: ItemId[]
  holding: Holding | null
  gear: Gear
  invulnUntil: number   // 被鲨鱼咬过之后的无敌截止时间
  story: Story
  dirty: boolean
  sentEnergy?: number   // 上次推给客户端的体力（体力随时间回，变了才推）
}
const sessions = new Set<Session>()

function send(s: Session, m: ServerMsg) { if (s.ws.readyState === WebSocket.OPEN) s.ws.send(JSON.stringify(m)) }
// ── 小屋 ──
interface Home { lot: number, owner: number, ownerName: string, room: Room, data: HomeData }
const homes = new Map<number, Home>()
function homeOf(lot: number): Home | null {
  const cached = homes.get(lot)
  const row = db.prepare('SELECT id, name, home FROM players WHERE lot=?').get(lot) as { id: number, name: string, home: string | null } | undefined
  if (!row) { homes.delete(lot); return null }
  if (cached && cached.owner === row.id) { cached.ownerName = row.name; return cached }
  const room = homeRoom(lot, LOTS[lot]?.style ?? 0)
  let data: HomeData
  try { data = row.home ? JSON.parse(row.home) : starterHome(room) } catch { data = starterHome(room) }
  if (!Array.isArray(data.chest) || data.chest.length !== CHEST_SIZE) data.chest = Array(CHEST_SIZE).fill(null)
  const h: Home = { lot, owner: row.id, ownerName: row.name, room, data }
  homes.set(lot, h)
  if (!row.home) saveHome(h)
  return h
}
const saveHome = (h: Home) => db.prepare('UPDATE players SET home=? WHERE id=?').run(JSON.stringify(h.data), h.owner)
const homeLot = (scene: string) => scene.startsWith('home:') ? Number(scene.slice(5)) : -1
const homeMsg = (h: Home): ServerMsg => ({ t: 'home', lot: h.lot, owner: h.owner, ownerName: h.ownerName, items: h.data.items })
const pushHome = (h: Home) => broadcast(homeMsg(h), o => o.scene === `home:${h.lot}`)
// 在自己家里（家具、箱子只有房主能动）
function myHome(s: Session): Home | null {
  const lot = homeLot(s.scene)
  if (lot < 0) return null
  const h = homeOf(lot)
  return h && h.owner === s.id ? h : null
}

function broadcast(m: ServerMsg, filter?: (s: Session) => boolean) {
  const data = JSON.stringify(m)
  for (const s of sessions) if ((!filter || filter(s)) && s.ws.readyState === WebSocket.OPEN) s.ws.send(data)
}
const pub = (s: Session): PlayerPublic => ({ id: s.id, name: s.name, hue: s.hue, scene: s.scene, x: Math.round(s.x), y: Math.round(s.y), dir: s.dir, moving: s.moving, act: s.act, actAt: s.actAt, hold: s.holding?.dish })

function savePlayer(s: Session) {
  db.prepare('UPDATE players SET name=?, hue=?, coins=?, inv=?, scene=?, x=?, y=?, gear=?, story=? WHERE id=?')
    .run(s.name, s.hue, s.coins, JSON.stringify(s.inv), s.scene, s.x, s.y, JSON.stringify(s.gear), JSON.stringify(s.story), s.id)
  s.dirty = false
}

// ── 复兴工程（全服共享） ──
interface Restore extends RestoreState { credits: Record<number, { name: string, pts: number }> }
function loadRestore(): Restore {
  try { const r = JSON.parse(getMeta('restore') ?? ''); r.credits ??= {}; return r } catch { return { done: 0, progress: {}, funded: null, top: [], credits: {} } }
}
const restore = loadRestore()
function restorePublic(): RestoreState {
  const top = Object.values(restore.credits).sort((a, b) => b.pts - a.pts).slice(0, 8)
  return { done: restore.done, progress: restore.progress, funded: restore.funded, top }
}
const saveRestore = () => setMeta('restore', JSON.stringify(restore))
const pushRestore = () => broadcast({ t: 'restore', state: restorePublic() })
const marketDay = () => restore.done >= 3 && calendarOf(dayOf(clockNow())).weekday === MARKET_DAY
town.market = marketDay()

// ── 村民关系、任务、信件 ──
interface Rel { pts: number, talk: number, gift: number, week: number, gw: number }
interface Story { rel: Partial<Record<NpcId, Rel>>, quests: Quest[], done: string[], boardDay: number, mail: Mail[], mailNext: number, heartMail: Partial<Record<NpcId, number>>, seen: string[], energy?: { v: number, t?: number } }
const today = () => dayOf(clockNow())
const weekOf = (day: number) => calendarOf(day).week   // 现实的周（周一起算）
function loadStory(raw: string | null, fresh: boolean): Story {
  let st: Story | null = null
  try { st = raw ? JSON.parse(raw) : null } catch { st = null }
  if (!st) {
    st = { rel: {}, quests: [], done: [], boardDay: 0, mail: [], mailNext: 1, heartMail: {}, seen: [] }
    // 新玩家（以及更新前就在玩的老玩家）：周叔的欢迎信 + 「认识大家」
    st.mail.push({ ...WELCOME_MAIL, id: st.mailNext++, day: today() })
    st.quests.push({ ...INTRO_QUEST, met: [] })
    void fresh
  }
  st.seen ??= []
  return st
}
function relOf(s: Session, npc: NpcId): Rel {
  return (s.story.rel[npc] ??= { pts: 0, talk: 0, gift: 0, week: -1, gw: 0 })
}
function storyMsg(s: Session): ServerMsg {
  const d = today(), w = weekOf(d)
  const rel: Partial<Record<NpcId, RelPublic>> = {}
  for (const npc of NPC_IDS) {
    const r = s.story.rel[npc]
    rel[npc] = r ? { pts: r.pts, talked: r.talk === d, gifted: r.gift === d, gw: r.week === w ? r.gw : 0 } : { pts: 0, talked: false, gifted: false, gw: 0 }
  }
  const taken = s.story.boardDay === d
  return { t: 'story', rel, quests: s.story.quests, board: { offer: taken ? null : dailyQuest(s.id, d), taken }, mail: s.story.mail, seen: s.story.seen, done: s.story.done.filter(id => id.startsWith('story:')) }
}
const sendStory = (s: Session) => { s.dirty = true; send(s, storyMsg(s)) }
// 体力：每分钟回 1 点。t = 上次结算到的时刻（满的时候跟着现在走，花掉以后从那一刻开始回）。
// 星露谷方向的老存档存的是 { v, day }，没有 t 的当作满的
function energyOf(s: Session) {
  const now = Date.now()
  let e = s.story.energy
  if (!e || e.t === undefined) { e = s.story.energy = { v: ENERGY_MAX, t: now }; s.dirty = true }
  if (e.v >= ENERGY_MAX) { e.t = now; return e }
  const n = Math.floor((now - e.t!) / ENERGY_REGEN_MS)
  if (n > 0) {
    e.v = Math.min(ENERGY_MAX, e.v + n)
    e.t = e.v >= ENERGY_MAX ? now : e.t! + n * ENERGY_REGEN_MS
    s.dirty = true
  }
  return e
}
const sendEnergy = (s: Session) => { const v = energyOf(s).v; s.sentEnergy = v; send(s, { t: 'energy', v }) }
function sendMail(s: Session, m: Omit<Mail, 'id' | 'day'>) {
  s.story.mail.unshift({ ...m, id: s.story.mailNext++, day: today() })
  if (s.story.mail.length > 60) s.story.mail.length = 60
  send(s, { t: 'toast', text: `你有一封新信（${NPC_INFO[m.from].name}）` })
}
// 加好感；跨过 2/4… 心时寄感谢信
function addFriend(s: Session, npc: NpcId, delta: number) {
  const r = relOf(s, npc)
  const before = hearts(r.pts)
  r.pts = Math.max(0, Math.min(MAX_HEARTS * HEART + HEART - 1, r.pts + delta))
  const after = hearts(r.pts)
  for (let h = before + 1; h <= after; h++) {
    const letter = HEART_MAIL[npc]?.[h]
    if (letter && (s.story.heartMail[npc] ?? 0) < h) { s.story.heartMail[npc] = h; sendMail(s, { ...letter, from: npc }) }
  }
}
const nearNpc = (s: Session, npc: NpcId) => s.scene === 'island' && !!NPC_SPOTS[npc] && nearScheduled(npc, hourOf(clockNow()), rainingAt(clockNow()), s.x / TILE, s.y / TILE)
// 过期的每日委托
function expireQuests(s: Session) {
  const d = today()
  const gone = s.story.quests.filter(q => q.deadline !== undefined && q.deadline < d)
  if (!gone.length) return false
  s.story.quests = s.story.quests.filter(q => !gone.includes(q))
  for (const q of gone) send(s, { t: 'toast', text: `委托「${q.title}」过期了` })
  return true
}
function completeQuest(s: Session, q: Quest) {
  s.story.quests = s.story.quests.filter(o => o !== q)
  s.story.done.push(q.id)
  if (s.story.done.length > 200) {
    const daily = s.story.done.filter(id => id.startsWith('daily:'))
    s.story.done = [...s.story.done.filter(id => !id.startsWith('daily:')), ...daily.slice(-150)]
  }
  s.coins += q.reward.coins
  if (q.reward.friend) addFriend(s, q.giver, q.reward.friend)
  const it = q.reward.item
  if (it && !addItem(s, it.id, it.n)) sendMail(s, { from: q.giver, title: `「${q.title}」的谢礼`, body: '你背包满了，我先放信箱里了。', attach: { item: it.id, n: it.n } })
  send(s, { t: 'questDone', id: q.id, npc: q.giver, to: q.obj.kind === 'deliver' ? q.obj.to : q.giver, coins: q.reward.coins, title: q.title, thanks: q.thanks })
  sendInv(s)
  if (q.kind === 'daily') progress(s, 'daily')
  if (q.id.startsWith('story:g_')) ensureGuide(s)
}

// 新手引导：身上没有引导任务、链子还没走完，就接上第一个没做过的那一步；全部做完寄一封信
function ensureGuide(s: Session) {
  s.story.quests = s.story.quests.filter(q => !(q.id.startsWith('story:g_') && s.story.done.includes(q.id)))
  // 身上正在做的那一步：说明、目标、奖励换成最新版本（接任务时存进存档的是当时的文字），进度保留
  for (const q of s.story.quests) {
    const def = GUIDE.find(g => g.id === q.id)
    if (def) Object.assign(q, { title: def.title, desc: def.desc, obj: structuredClone(def.obj), reward: structuredClone(def.reward), to: def.to, have: Math.min(q.have ?? 0, def.obj.kind === 'count' ? def.obj.n : 0) })
  }
  if (s.story.quests.some(q => q.id.startsWith('story:g_'))) return
  // 做不了的步骤直接跳过：复兴工程已经全部完工就没法捐了；装备都满级了也没得升
  const impossible = (id: string) => (id === 'story:g_donate' && restore.done >= STAGES.length) ||
    (id === 'story:g_gear' && s.gear.tank >= gearMax('tank') && s.gear.harpoon >= gearMax('harpoon'))
  for (const g of GUIDE) if (!s.story.done.includes(g.id) && impossible(g.id)) s.story.done.push(g.id)
  const next = GUIDE.find(g => !s.story.done.includes(g.id))
  if (!next) {
    if (!s.story.seen.includes('mail:guide')) { s.story.seen.push('mail:guide'); sendMail(s, GUIDE_DONE_MAIL) }
    return
  }
  s.story.quests.push(structuredClone(next))
  s.dirty = true
  send(s, { t: 'toast', text: `新任务「${next.title}」（${NPC_INFO[next.giver].name}）` })
}
// 记一笔动作：凡是在数这个动作的任务都往前走，数够了就完成
function progress(s: Session, action: GuideAction, n = 1) {
  let changed = false
  for (const q of [...s.story.quests]) {
    if (q.obj.kind !== 'count' || q.obj.action !== action) continue
    q.have = Math.min(q.obj.n, (q.have ?? 0) + n)
    changed = true
    if (q.have >= q.obj.n) completeQuest(s, q)
  }
  if (changed) sendStory(s)
}

// ── 背包 ──
function addItem(s: Session, id: ItemId, n = 1): boolean {
  const def = ITEMS[id]
  if (def?.stack) {
    const slot = s.inv.find(x => x?.id === id)
    if (slot) { slot.n += n; return true }
  }
  const empty = s.inv.findIndex(x => !x)
  if (empty < 0) return false
  s.inv[empty] = { id, n }
  return true
}
function takeItem(s: Session, id: ItemId, n = 1): boolean {
  const i = s.inv.findIndex(x => x?.id === id && x.n >= n)
  if (i < 0) return false
  s.inv[i]!.n -= n
  if (s.inv[i]!.n <= 0) s.inv[i] = null
  return true
}
const sendInv = (s: Session) => { s.dirty = true; send(s, { t: 'inv', coins: s.coins, inv: s.inv }) }

// ── 农田 ──
const near = (s: Session, tx: number, ty: number, r = 2.2) =>
  s.scene === 'island' && Math.hypot(s.x / TILE - (tx + 0.5), s.y / TILE - (ty + 0.5)) <= r

function setPlot(key: string, p: PlotState | null) {
  if (p) plots.set(key, p); else plots.delete(key)
  savePlot(key)
  broadcast({ t: 'plot', key, plot: p })
}

function handleAct(s: Session, m: Extract<ClientMsg, { t: 'act' }>) {
  const { tx, ty } = m
  if (!Number.isInteger(tx) || !Number.isInteger(ty) || !near(s, tx, ty)) return
  const key = plotKey(tx, ty)
  const plot = plots.get(key)
  s.act = m.kind; s.actAt = Date.now()
  if (m.kind === 'till') {
    if (!isTillable(island, tx, ty) || plot) return
    setPlot(key, { tilled: true, watered: rainingAt(clockNow()) })
  } else if (m.kind === 'water') {
    if (!plot) return
    // 已经湿了（下雨天）：地不用再改，但新手引导的「浇水」照样算，不然雨天会卡一整天
    if (plot.watered) { if (plot.crop) progress(s, 'water'); return }
    setPlot(key, { ...plot, watered: true })
    progress(s, 'water')
  } else if (m.kind === 'plant') {
    const slot = m.slot !== undefined ? s.inv[m.slot] : null
    const crop = slot ? ITEMS[slot.id]?.seedOf : undefined
    if (!plot || plot.crop || !crop || !slot) return
    if (!takeItem(s, slot.id)) return
    setPlot(key, { ...plot, crop, grown: 0, owner: s.id })
    sendInv(s)
    progress(s, 'plant')
  } else if (m.kind === 'harvest') {
    if (!plot?.crop || cropStage(plot.crop, plot.grown ?? 0) < 4) return
    const def = CROPS[plot.crop]
    const n = 1 + (Math.random() < 0.3 ? 1 : 0)
    if (!addItem(s, def.harvest, n)) { send(s, { t: 'toast', text: '背包满了' }); return }
    setPlot(key, { tilled: true, watered: plot.watered })
    sendInv(s)
    progress(s, 'harvest')
  }
}

// 每天 6:00 结算：浇过水的作物长一天，所有地变干；下雨时自动浇水（雨开始的那一刻浇，见 rainWater）。
// 服务器停机期间错过的天数逐天补算：那天下过雨就算浇过（今天的雨还没下的话先不算）
let lastDay = Number(getMeta('lastDay')) || dayOf(clockNow())
const calText = (day: number) => { const c = calendarOf(day); return `${c.month} 月 ${c.date} 日 周${WEEKDAY_NAMES[c.weekday]}` }
function processDays() {
  const today = dayOf(clockNow())
  if (today <= lastDay) return
  for (let d = lastDay + 1; d <= today; d++) {
    const rain = d < today ? isRainy(d) : rainingAt(clockNow())
    for (const [key, p] of plots) {
      if (p.crop && p.watered) p.grown = (p.grown ?? 0) + 1
      p.watered = rain
      // 没种东西的地，隔一段时间会自己荒掉（10% 概率/天）
      if (!p.crop && Math.random() < 0.1) plots.delete(key)
    }
  }
  lastDay = today
  setMeta('lastDay', String(today))
  db.exec('DELETE FROM plots')
  for (const k of plots.keys()) savePlot(k)
  broadcast({ t: 'plots', plots: Object.fromEntries(plots) })
  const w = rainWindow(today)
  broadcast({ t: 'chat', from: '', text: `新的一天：${calText(today)}${w ? `，今天 ${Math.floor(w[0])} 点前后会下一阵雨` : ''}`, sys: true })
  rainedDay = 0
  for (const s of sessions) { expireQuests(s); sendStory(s); sendEnergy(s) }
  if (restore.funded !== null && today > restore.funded && restore.done < STAGES.length) {
    const st = STAGES[restore.done]
    restore.done++; restore.progress = {}; restore.funded = null
    saveRestore(); pushRestore()
    broadcast({ t: 'chat', from: '', text: `「${st.name}」完工了！${st.unlock}`, sys: true })
  }
  town.market = marketDay()
  if (town.market) broadcast({ t: 'chat', from: '', text: '今天是集市日！在广场北边的集市摆摊，卖价多两成半', sys: true })
}

// 下雨：雨一开始就把所有地浇透（每天只浇一次，之后再开垦的地看开垦时是不是正在下雨）
let rainedDay = 0
function rainWater() {
  const d = dayOf(clockNow())
  if (rainedDay === d || !rainingAt(clockNow())) return
  rainedDay = d
  let changed = false
  for (const p of plots.values()) if (!p.watered) { p.watered = true; changed = true }
  if (!changed) return
  for (const k of plots.keys()) savePlot(k)
  broadcast({ t: 'plots', plots: Object.fromEntries(plots) })
  broadcast({ t: 'chat', from: '', text: '下雨了，田地都浇透了', sys: true })
}

// ── 鱼群模拟 ──
interface Fish {
  id: number; kind: string; zone: Zone
  x: number; y: number; vx: number; vy: number
  tx: number; ty: number
  hp: number
  leader?: Fish
  ox: number; oy: number   // 在鱼群里的相对位置
  fleeUntil: number
}
const fish = new Map<number, Fish>()
let fishSeq = 1
const frand = rng(Date.now() & 0xffffffff)
const QUOTA: Record<Zone, number> = { reef: 34, mid: 26, deep: 20 }

function pickKind(zone: Zone) {
  const pool = Object.entries(FISH).filter(([, f]) => f.zone === zone)
  let r = frand() * pool.reduce((a, [, f]) => a + f.weight, 0)
  for (const [k, f] of pool) { r -= f.weight; if (r <= 0) return k }
  return pool[0][0]
}

function newTarget(f: Fish) {
  const range = 260
  for (let i = 0; i < 30; i++) {
    const x = f.x + (frand() - 0.5) * range * 2, y = f.y + (frand() - 0.5) * range * 0.8
    if (zoneAt(y) !== f.zone && frand() < 0.8) continue
    if (openness(sea, x, y) >= 24) { f.tx = x; f.ty = y; return }
  }
  const p = randomOpenPoint(sea, f.zone, frand)
  f.tx = p.x; f.ty = p.y
}

function spawnFish(zone: Zone) {
  const kind = pickKind(zone)
  const def = FISH[kind]
  const p = randomOpenPoint(sea, zone, frand, 48)
  const count = def.school ?? 1
  let leader: Fish | undefined
  for (let i = 0; i < count; i++) {
    const f: Fish = {
      id: fishSeq++, kind, zone, x: p.x + (frand() - 0.5) * 40, y: p.y + (frand() - 0.5) * 30, vx: 0, vy: 0,
      tx: p.x, ty: p.y, hp: def.hp, ox: (frand() - 0.5) * 70, oy: (frand() - 0.5) * 40, fleeUntil: 0,
    }
    if (leader) f.leader = leader; else { leader = f; newTarget(f) }
    fish.set(f.id, f)
  }
  return count
}

// 开服时补满；之后每 5 秒每片海域最多补一群（被捞空的地方要过一阵才会热闹起来）
function fillFish(all = false) {
  for (const zone of ['reef', 'mid', 'deep'] as Zone[]) {
    let n = [...fish.values()].filter(f => f.zone === zone).length
    if (all) { while (n < QUOTA[zone]) n += spawnFish(zone) }
    else if (n < QUOTA[zone] && (zone === 'reef' || Math.random() < REGEN[zone])) spawnFish(zone)
  }
}
const REGEN: Record<Zone, number> = { reef: 1, mid: 0.6, deep: 0.4 }   // 每 5 秒补一群的概率
fillFish(true)

function stepFish(dt: number) {
  const now = Date.now()
  const divers = [...sessions].filter(s => s.scene === 'sea')
  for (const f of fish.values()) {
    const def = FISH[f.kind]
    let speed = def.speed
    // 领头鱼阵亡后，群里剩下的鱼各自为政
    if (f.leader && !fish.has(f.leader.id)) f.leader = undefined
    if (f.leader) { f.tx = f.leader.x + f.ox; f.ty = f.leader.y + f.oy }
    else if (Math.hypot(f.tx - f.x, f.ty - f.y) < 20) newTarget(f)
    // 受惊逃跑
    if (def.flee || now < f.fleeUntil) {
      for (const d of divers) {
        const dx = f.x - d.x, dy = f.y - d.y, dist = Math.hypot(dx, dy)
        if (dist < 110) {
          f.tx = f.x + (dx / (dist || 1)) * 160; f.ty = f.y + (dy / (dist || 1)) * 90
          f.fleeUntil = Math.max(f.fleeUntil, now + 1500)
        }
      }
    }
    if (now < f.fleeUntil) speed *= 2.6
    const dx = f.tx - f.x, dy = f.ty - f.y, dist = Math.hypot(dx, dy) || 1
    const ax = (dx / dist) * speed - f.vx, ay = (dy / dist) * speed * 0.6 - f.vy
    f.vx += ax * Math.min(1, dt * 1.8); f.vy += ay * Math.min(1, dt * 1.8)
    const nx = f.x + f.vx * dt, ny = f.y + f.vy * dt
    if (seaSolid(sea, nx, ny) || ny < 30 || nx < 0 || nx > SEA_W) {
      f.vx *= -0.5; f.vy *= -0.5
      if (!f.leader) newTarget(f)
    } else { f.x = nx; f.y = ny }
  }
}

// ── 鲨鱼：巡游 → 发现潜水员追过去 → 咬一口扣氧气后游开；被鱼枪打中会吓跑 ──
// 只在自己的海域（断层/蓝洞）活动，浅滩是安全区。和鱼共用 id 序列，一起下发给客户端画
interface Shark {
  id: number; kind: string
  x: number; y: number; vx: number; vy: number
  tx: number; ty: number
  target: Session | null
  chaseSince: number
  calmUntil: number    // 这之前不追人（刚咬完、被吓跑、追太久放弃）
  fleeing: boolean
}
const sharks = new Map<number, Shark>()

function fillSharks() {
  for (const [kind, def] of Object.entries(SHARKS)) {
    let n = [...sharks.values()].filter(s => s.kind === kind).length
    for (; n < def.count; n++) {
      const p = randomOpenPoint(sea, def.zone, frand, 60)
      const sh: Shark = { id: fishSeq++, kind, x: p.x, y: p.y, vx: 0, vy: 0, tx: p.x, ty: p.y, target: null, chaseSince: 0, calmUntil: 0, fleeing: false }
      sharkWander(sh)
      sharks.set(sh.id, sh)
    }
  }
}

function sharkWander(sh: Shark) {
  const p = randomOpenPoint(sea, SHARKS[sh.kind].zone, frand, 48)
  sh.tx = p.x; sh.ty = p.y; sh.fleeing = false
}

// 背对某个位置游开一段（咬完人、被打中）
function sharkFlee(sh: Shark, fromX: number, fromY: number, ms: number) {
  const dx = sh.x - fromX, dy = sh.y - fromY, d = Math.hypot(dx, dy) || 1
  const band = ZONES[SHARKS[sh.kind].zone]
  sh.tx = sh.x + (dx / d) * 260; sh.ty = Math.max(band.y0, Math.min(band.y1, sh.y + (dy / d) * 120))
  sh.target = null; sh.fleeing = true
  sh.calmUntil = Date.now() + ms
}

function stepSharks(dt: number) {
  const now = Date.now()
  for (const sh of sharks.values()) {
    const def = SHARKS[sh.kind]
    const band = ZONES[def.zone]
    const t = sh.target
    // 放弃追赶：人走了 / 上岸了 / 甩开了 / 追太久 / 游进了浅滩
    if (t && (!sessions.has(t) || t.scene !== 'sea' || Math.hypot(t.x - sh.x, t.y - sh.y) > def.sense * 1.8 || t.y < band.y0 - 60 || now - sh.chaseSince > 9000)) {
      sh.target = null; sh.calmUntil = now + 4000; sharkWander(sh)
    }
    // 发现附近的潜水员（刚被咬过、在无敌时间里的不追）
    if (!sh.target && now >= sh.calmUntil) {
      let best: Session | null = null, bd = def.sense
      for (const d of sessions) {
        if (d.scene !== 'sea' || d.y < band.y0 - 20 || now < d.invulnUntil) continue
        const dist = Math.hypot(d.x - sh.x, d.y - sh.y)
        if (dist < bd) { bd = dist; best = d }
      }
      if (best) { sh.target = best; sh.chaseSince = now; sh.fleeing = false }
    }
    let speed = def.patrol
    if (sh.target) { sh.tx = sh.target.x; sh.ty = Math.max(band.y0, Math.min(band.y1, sh.target.y)); speed = def.chase }
    else if (sh.fleeing) { speed = def.chase * 1.1; if (now >= sh.calmUntil || Math.hypot(sh.tx - sh.x, sh.ty - sh.y) < 24) sharkWander(sh) }
    else if (Math.hypot(sh.tx - sh.x, sh.ty - sh.y) < 24) sharkWander(sh)
    const dx = sh.tx - sh.x, dy = sh.ty - sh.y, dist = Math.hypot(dx, dy) || 1
    const k = Math.min(1, dt * (sh.target ? 2.4 : 1.2))
    sh.vx += ((dx / dist) * speed - sh.vx) * k
    sh.vy += ((dy / dist) * speed * (sh.target ? 1 : 0.5) - sh.vy) * k
    const nx = sh.x + sh.vx * dt, ny = sh.y + sh.vy * dt
    if (seaSolid(sea, nx, ny) || ny < band.y0 - 40 || ny > band.y1 || nx < 60 || nx > SEA_W - 60) {
      sh.vx *= -0.4; sh.vy *= -0.4
      if (!sh.target) sharkWander(sh)
    } else { sh.x = nx; sh.y = ny }
    // 咬：嘴在身体朝向的前端
    const v = sh.target
    if (v && now >= v.invulnUntil) {
      const mx = sh.x + (sh.vx >= 0 ? 1 : -1) * 40
      if (Math.hypot(mx - v.x, sh.y - v.y) < SHARK_BITE_RANGE) {
        const ux = v.x - sh.x, uy = v.y - sh.y, ud = Math.hypot(ux, uy) || 1
        v.invulnUntil = now + BITE_INVULN_MS
        send(v, { t: 'bitten', shark: sh.id, bite: def.bite, dx: ux / ud, dy: uy / ud })
        sharkFlee(sh, v.x, v.y, 5000)
      }
    }
  }
}
fillSharks()

// ── 潮汐寿司：全服共享的一家店 ──
// 营业时间里只要有人在店里，就会陆续来客人；客人的走位由客户端按状态和时长插值，服务端只管状态机和结算
interface ServerCustomer { id: number, look: string, seat: number, dish: DishId, state: Customer['state'], since: number, patience: number, angry?: boolean }
const customers = new Map<number, ServerCustomer>()
let customerSeq = 1
let nextArrival = 0
const LOOK_POOLS = [
  { w: 0.5, list: ['guest_kid', 'guest_granny', 'guest_sailor'] },
  { w: 0.25, list: ['npc:ahai', 'npc:laopan', 'npc:xiaoshan', 'npc:huashen', 'npc:zhoushu', 'npc:doudou'] },
  { w: 0.25, list: SHIRT_HUES.map(h => 'farmer:' + h) },
]
function pickLook() {
  let r = crand()
  let look = LOOK_POOLS[0].list[0]
  for (const p of LOOK_POOLS) { r -= p.w; if (r <= 0) { look = p.list[Math.floor(crand() * p.list.length)]; break } }
  // 村民只有一个：已经坐在店里的就换成普通客人
  if (look.startsWith('npc:') && [...customers.values()].some(c => c.look === look)) look = LOOK_POOLS[0].list[Math.floor(crand() * LOOK_POOLS[0].list.length)]
  return look
}
const STATE_MS = { arrive: 5200, eat: 8000, leave: 5200 }
// 今天来过几位客人（全服共享，存档里记着，重启也不会重新算）
const guests: { day: number, n: number, told?: boolean } = (() => { try { return JSON.parse(getMeta('guests') ?? '') } catch { return { day: 0, n: 0 } } })()
const guestCap = () => Math.round(RESTAURANT_GUESTS_PER_DAY * (restore.done >= 4 ? 1.5 : 1))
const crand = rng(Date.now() ^ 0x5eed)

function setCustomer(c: ServerCustomer, state: Customer['state']) { c.state = state; c.since = Date.now() }
function restaurantState() {
  const now = Date.now()
  return {
    open: restaurantOpen(hourOf(clockNow())),
    left: guests.day === dayOf(clockNow()) ? Math.max(0, guestCap() - guests.n) : guestCap(),
    customers: [...customers.values()].map(c => ({ id: c.id, look: c.look, seat: c.seat, dish: c.dish, state: c.state, age: now - c.since, patience: c.patience, angry: c.angry })),
  }
}
function pickDish(): DishId {
  const list = Object.entries(DISHES) as [DishId, typeof DISHES[DishId]][]
  let r = crand() * list.reduce((a, [, d]) => a + d.weight, 0)
  for (const [id, d] of list) { r -= d.weight; if (r <= 0) return id }
  return 'nigiri'
}
function stepRestaurant() {
  const now = Date.now()
  const open = restaurantOpen(hourOf(clockNow()))
  const inside = [...sessions].some(s => s.scene === 'restaurant')
  let changed = false
  for (const c of customers.values()) {
    const age = now - c.since
    if (c.state === 'arrive' && age > STATE_MS.arrive) { setCustomer(c, 'wait'); changed = true }
    else if (c.state === 'wait' && (age > c.patience || !open)) { c.angry = age > c.patience; setCustomer(c, 'leave'); changed = true }
    else if (c.state === 'eat' && age > STATE_MS.eat) { setCustomer(c, 'leave'); changed = true }
    else if (c.state === 'leave' && age > STATE_MS.leave) { customers.delete(c.id); changed = true }
  }
  // 来客：店开着、有人在店里、还有空位、今天的客人还没来完
  const d = dayOf(clockNow())
  if (guests.day !== d) { guests.day = d; guests.n = 0; guests.told = false; setMeta('guests', JSON.stringify(guests)) }
  const cap = guestCap()
  if (open && inside && now > nextArrival && guests.n >= cap && !guests.told) {
    guests.told = true
    for (const o of sessions) if (o.scene === 'restaurant') send(o, { t: 'toast', text: '今天的客人都来过了，明天 10 点再开张' })
  }
  if (open && inside && now > nextArrival && guests.n < cap) {
    const taken = new Set([...customers.values()].map(c => c.seat))
    const free = RESTAURANT.seats!.map((_, i) => i).filter(i => !taken.has(i))
    if (free.length) {
      const seat = free[Math.floor(crand() * free.length)]
      const c: ServerCustomer = { id: customerSeq++, look: pickLook(), seat, dish: pickDish(), state: 'arrive', since: now, patience: 70000 + crand() * 20000 }
      customers.set(c.id, c)
      guests.n++; guests.told = false; setMeta('guests', JSON.stringify(guests))
      changed = true
    }
    nextArrival = now + (9000 + crand() * 9000) * (restore.done >= 4 ? 0.65 : 1)
  }
  if (!inside) nextArrival = Math.max(nextArrival, now + 3000) // 有人进门后 3 秒左右来第一位客人
  if (changed) broadcast({ t: 'restaurant', ...restaurantState() }, o => o.scene === 'restaurant')
}

// ── 连接处理 ──
function hello(ws: WebSocket, m: Extract<ClientMsg, { t: 'hello' }>): Session {
  const name = String(m.name || '潜水员').slice(0, 12)
  const hue = SHIRT_HUES.includes(m.hue) ? m.hue : SHIRT_HUES[0]
  let row = m.token ? db.prepare('SELECT * FROM players WHERE token=?').get(m.token) as any : undefined
  if (!row) {
    const token = randomBytes(16).toString('hex')
    const inv: (Slot | null)[] = Array(INV_SIZE).fill(null)
    START_INV.forEach(([id, n], i) => { inv[i] = { id, n } })
    const sp = PLACES.spawn
    db.prepare('INSERT INTO players(token,name,hue,coins,inv,scene,x,y) VALUES(?,?,?,?,?,?,?,?)')
      .run(token, name, hue, START_COINS, JSON.stringify(inv), 'island', sp.x * TILE, sp.y * TILE)
    row = db.prepare('SELECT * FROM players WHERE token=?').get(token)
  }
  let lot: number | null = row.lot ?? null
  let housesChanged = row.name !== name
  if (lot === null) {
    lot = assignLot(row.id)
    if (lot !== null) {
      housesChanged = true
      // 第一次拿到房子的人从自家门口出发
      if (!m.token || row.x === PLACES.spawn.x * TILE) { const d = lotDoor(LOTS[lot]); row.x = d.x * TILE; row.y = d.y * TILE + 6 }
    }
  }
  // 同一个存档重复登录：踢掉旧连接
  for (const other of sessions) if (other.id === row.id) { other.ws.close(4000, 'replaced'); sessions.delete(other) }
  const inv = JSON.parse(row.inv) as (Slot | null)[]
  while (inv.length < INV_SIZE) inv.push(null)
  const s: Session = {
    ws, id: row.id, token: row.token, name, hue, coins: row.coins, inv,
    scene: 'island', x: row.x, y: row.y, dir: 'down', moving: false, lastMoveAt: Date.now(), lastHitAt: 0, diveCatch: [], holding: null,
    gear: loadGear(row.gear), invulnUntil: 0, dirty: true, story: loadStory(row.story ?? null, !row.story),
  }
  expireQuests(s)
  // 下线时在海里的，上线回到栈桥（潜水不能跨会话）
  if (row.scene === 'sea') { s.x = (PLACES.diveSpot.x0 + 1) * TILE; s.y = (PLACES.diveSpot.y0 + 0.6) * TILE }
  // 上次在别的地图或海底下线的：回到栈桥
  if (String(row.scene).startsWith('map:') || row.scene === 'sea') { s.x = (PLACES.diveSpot.x0 + 2) * TILE; s.y = (PLACES.diveSpot.y0 + 0.6) * TILE }
  if (row.scene === 'restaurant') { s.x = PLACES.restaurant.x * TILE; s.y = (PLACES.restaurant.y + 0.9) * TILE }
  if (String(row.scene).startsWith('home:') && LOTS[homeLot(row.scene)]) { const d = lotDoor(LOTS[homeLot(row.scene)]); s.x = d.x * TILE; s.y = (d.y + 0.9) * TILE }
  sessions.add(s)
  if (housesChanged) db.prepare('UPDATE players SET name=? WHERE id=?').run(name, s.id)
  const houseList = houses()
  send(s, {
    t: 'welcome', you: s.id, token: s.token, coins: s.coins, inv: s.inv, plots: Object.fromEntries(plots),
    clock: clockNow(), day: dayOf(clockNow()), epoch, players: [...sessions].map(pub), scene: s.scene, x: s.x, y: s.y,
    houses: houseList, lot, gear: s.gear,
  })
  if (!s.story.seen.includes('mail:restore')) { s.story.seen.push('mail:restore'); sendMail(s, RESTORE_MAIL); s.dirty = true }
  ensureGuide(s)
  send(s, storyMsg(s))
  sendEnergy(s)
  send(s, { t: 'restore', state: restorePublic() })
  if (housesChanged) broadcast({ t: 'houses', list: houseList }, o => o !== s)
  broadcast({ t: 'chat', from: '', text: `${s.name} 来到了潮汐港`, sys: true }, o => o !== s)
  return s
}

function loadGear(raw: string | null): Gear {
  const g = { ...START_GEAR, ...(raw ? JSON.parse(raw) : {}) }
  g.tank = Math.max(0, Math.min(TANKS.length - 1, g.tank | 0))
  g.harpoon = Math.max(0, Math.min(HARPOONS.length - 1, g.harpoon | 0))
  g.basket = Math.max(0, Math.min(BASKETS.length - 1, g.basket | 0))
  return g
}
// 没有高压气瓶就下不到蓝洞深处（留一点余量给客户端的回推）
const depthLimit = (s: Session) => TANKS[s.gear.tank].deep ? Infinity : PRESSURE_LIMIT_Y + 30
const nearXiaoshan = (s: Session) => s.scene === 'island' && Math.hypot(s.x / TILE - NPC_SPOTS.xiaoshan.x, s.y / TILE - NPC_SPOTS.xiaoshan.y) < 4

const nearSeedshop = (s: Session) => Math.hypot(s.x / TILE - (PLACES.seedshop.x + 2.5), s.y / TILE - (PLACES.seedshop.y + 0.8)) < 3.5

// 生成的地图：骨架第一次用到时才建，之后复用（落脚点要和客户端算得一样）
const worlds = new Map<string, World>()
const worldOf = (id: string) => { let w = worlds.get(id); if (!w) { w = new World(MAPS[id]); worlds.set(id, w) } return w }
const mapOf = (scene: string) => scene.startsWith('map:') ? MAPS[scene.slice(4)] : undefined
// 在栈桥上（老潘那一带）才能出航
const nearLaopan = (s: Session) => s.scene === 'island' && Math.hypot(s.x / TILE - NPC_SPOTS.laopan.x, s.y / TILE - NPC_SPOTS.laopan.y) < 14
const onDock = (s: Session) => s.scene === 'island' && s.x / TILE >= PLACES.dock.x0 - 2 && s.x / TILE <= PLACES.dock.x1 + 1 && s.y / TILE >= PLACES.dock.y0 - 2.5 && s.y / TILE <= PLACES.dock.y1 + 2.5

function handle(s: Session, m: ClientMsg) {
  switch (m.t) {
    case 'move': {
      if (!Number.isFinite(m.x) || !Number.isFinite(m.y)) return
      const now = Date.now()
      const dt = Math.max(0.05, (now - s.lastMoveAt) / 1000)
      const maxStep = (s.scene === 'sea' ? 260 : 150) * dt + 24
      const d = Math.hypot(m.x - s.x, m.y - s.y)
      if (d > maxStep) { // 超速：按最大步长截断
        s.x += ((m.x - s.x) / d) * maxStep; s.y += ((m.y - s.y) / d) * maxStep
      } else { s.x = m.x; s.y = m.y }
      if (s.scene === 'island') {
        s.x = Math.max(0, Math.min(ISLAND_W * TILE, s.x)); s.y = Math.max(0, Math.min(ISLAND_H * TILE, s.y))
      } else if (s.scene === 'sea') {
        s.y = Math.min(s.y, depthLimit(s))
      } else if (s.scene === 'restaurant') {
        s.x = Math.max(0, Math.min(RESTAURANT.w * TILE, s.x)); s.y = Math.max(0, Math.min(RESTAURANT.h * TILE, s.y))
      } else if (homeLot(s.scene) >= 0) {
        const h = homes.get(homeLot(s.scene))
        if (h) { s.x = Math.max(0, Math.min(h.room.w * TILE, s.x)); s.y = Math.max(0, Math.min(h.room.h * TILE, s.y)) }
      } else {
        const md = mapOf(s.scene)
        if (md) { s.x = Math.max(0, Math.min(md.w * TILE, s.x)); s.y = Math.max(0, Math.min(md.h * TILE, s.y)) }
      }
      s.dir = m.dir; s.moving = !!m.moving; s.lastMoveAt = now; s.dirty = true
      break
    }
    case 'act': handleAct(s, m); break
    case 'scene': {
      if (m.to === s.scene) return
      if (m.to === 'sea') {
        const ds = PLACES.diveSpot
        if (s.scene !== 'island' || !(s.x / TILE >= ds.x0 - 1 && s.x / TILE <= ds.x1 + 1 && s.y / TILE >= ds.y0 - 1.5 && s.y / TILE <= ds.y1 + 1.5)) return
        const en = energyOf(s)
        if (en.v < DIVE_ENERGY) {
          send(s, { t: 'toast', text: `体力不够了（出海要 ${DIVE_ENERGY}，每分钟回 1 点），吃点东西或者歇一会儿` })
          send(s, { t: 'goto', scene: 'island', x: s.x, y: s.y })
          return
        }
        en.v -= DIVE_ENERGY
        sendEnergy(s)
        s.scene = 'sea'; s.x = BOAT_X; s.y = 40; s.diveCatch = []
      } else if (m.to === 'restaurant') {
        const r = PLACES.restaurant
        if (s.scene !== 'island' || Math.hypot(s.x / TILE - r.x, s.y / TILE - (r.y + 0.6)) > 2) return
        s.scene = 'restaurant'; s.x = RESTAURANT.spawn.x; s.y = RESTAURANT.spawn.y
        send(s, { t: 'restaurant', ...restaurantState() })
      } else if (homeLot(s.scene) >= 0) {
        const l = LOTS[homeLot(s.scene)]
        s.scene = 'island'
        if (l) { const d = lotDoor(l); s.x = d.x * TILE; s.y = (d.y + 0.9) * TILE }
      } else if (s.scene === 'restaurant') {
        // 出门：端着的菜不能带走
        if (s.holding) { s.holding = null; send(s, { t: 'holding', hold: null }) }
        s.scene = 'island'; s.x = PLACES.restaurant.x * TILE; s.y = (PLACES.restaurant.y + 0.9) * TILE
      } else {
        s.scene = 'island'; s.x = (PLACES.diveSpot.x0 + 2) * TILE; s.y = (PLACES.diveSpot.y0 + 0.6) * TILE
      }
      s.dirty = true
      break
    }
    case 'talk': {
      if (!NPC_INFO[m.npc] || !nearNpc(s, m.npc)) return
      const r = relOf(s, m.npc), d = today()
      if (r.talk !== d) { r.talk = d; addFriend(s, m.npc, TALK_PTS) }
      // 认识大家
      for (const q of [...s.story.quests]) {
        if (q.obj.kind !== 'meet' || !q.obj.npcs.includes(m.npc)) continue
        q.met ??= []
        if (!q.met.includes(m.npc)) q.met.push(m.npc)
        if (q.obj.npcs.every(n => q.met!.includes(n))) completeQuest(s, q)
      }
      sendStory(s)
      break
    }
    case 'gift': {
      if (!NPC_INFO[m.npc] || !nearNpc(s, m.npc)) return
      const slot = s.inv[m.slot]
      if (!slot || !giftable(slot.id)) return
      const r = relOf(s, m.npc), d = today(), w = weekOf(d)
      if (r.week !== w) { r.week = w; r.gw = 0 }
      const cal = calendarOf(d), bday = isBirthday(m.npc, cal.month, cal.date)
      if (r.gift === d) { send(s, { t: 'toast', text: `今天已经送过${NPC_INFO[m.npc].name}礼物了` }); return }
      if (r.gw >= GIFTS_PER_WEEK && !bday) { send(s, { t: 'toast', text: `这周已经送了${NPC_INFO[m.npc].name}两次礼物了` }); return }
      const taste = tasteOf(m.npc, slot.id)
      const delta = TASTE_PTS[taste] * (bday ? BIRTHDAY_MULT : 1)
      slot.n--
      if (slot.n <= 0) s.inv[m.slot] = null
      r.gift = d; r.gw++
      addFriend(s, m.npc, delta)
      send(s, { t: 'giftResult', npc: m.npc, taste, delta, birthday: bday })
      sendInv(s)
      sendStory(s)
      progress(s, 'gift')
      break
    }
    case 'accept': {
      const d = today()
      if (s.story.boardDay === d || s.scene !== 'island') return
      if (Math.hypot(s.x / TILE - NOTICE_BOARD.x, s.y / TILE - (NOTICE_BOARD.y + 1)) > 3) return
      const q = dailyQuest(s.id, d)
      q.deadline = d + 1   // 接下当天 + 第二天，一共 2 天
      s.story.boardDay = d
      s.story.quests.push(q)
      sendStory(s)
      break
    }
    case 'deliver': {
      const q = s.story.quests.find(o => o.id === m.quest)
      if (!q || q.obj.kind !== 'deliver') return
      const { item, n, to } = q.obj
      if (!nearNpc(s, to)) return
      const have = s.inv.reduce((a, x) => a + (x?.id === item ? x.n : 0), 0)
      if (have < n) { send(s, { t: 'toast', text: '东西还没凑齐' }); return }
      let need = n
      for (let i = 0; i < s.inv.length && need > 0; i++) {
        const x = s.inv[i]
        if (x?.id !== item) continue
        const k = Math.min(need, x.n)
        x.n -= k; need -= k
        if (x.n <= 0) s.inv[i] = null
      }
      completeQuest(s, q)
      sendStory(s)
      break
    }
    case 'event': {
      const ev = EVENT_BY_ID[m.id]
      if (!ev || s.story.seen.includes(ev.id) || s.scene !== 'island') return
      if (hearts(relOf(s, ev.npc).pts) < ev.hearts) return
      if (ev.after?.some(p => !s.story.seen.includes(p))) return
      if (ev.stage !== undefined && restore.done < ev.stage) return
      if (ev.quest && !s.story.done.includes(ev.quest)) return
      s.story.seen.push(ev.id)
      if (ev.town) for (const o of EVENTS) if (o.town && (o.stage ?? 0) < (ev.stage ?? 0) && !s.story.seen.includes(o.id)) s.story.seen.push(o.id)
      for (const eff of [m.choice ? ev.choices?.[m.choice] : undefined, ev.end]) {
        if (!eff) continue
        if (eff.friend) addFriend(s, ev.npc, eff.friend)
        if (eff.also) addFriend(s, eff.also.npc, eff.also.pts)
        if (eff.give && !addItem(s, eff.give.item, eff.give.n)) sendMail(s, { from: ev.npc, title: '给你的东西', body: '你背包满了，我先放信箱里了。', attach: eff.give })
        if (eff.quest && !s.story.quests.some(q => q.id === eff.quest!.id) && !s.story.done.includes(eff.quest.id)) s.story.quests.push(structuredClone(eff.quest))
      }
      sendInv(s)
      sendStory(s)
      break
    }
    case 'seaFind': {
      const fd = SEA_FINDS[m.id]
      if (!fd || s.scene !== 'sea' || Math.hypot(s.x - fd.x, s.y - fd.y) > 80) return
      if (!s.story.quests.some(q => q.id === fd.quest) || s.inv.some(x => x?.id === fd.item)) return
      if (!addItem(s, fd.item, 1)) { send(s, { t: 'toast', text: '背包满了，腾个位置再来捡' }); return }
      send(s, { t: 'toast', text: `捡到了「${ITEMS[fd.item].name}」` })
      sendInv(s)
      break
    }
    case 'donate': {
      const B = PLACES.projectBoard
      if (s.scene !== 'island' || Math.hypot(s.x / TILE - B.x, s.y / TILE - (B.y + 0.8)) > 3) return
      const r = ALL_REQS[m.req]
      if (!r || r.stage !== restore.done || restore.funded !== null) return
      const left = r.req.n - (restore.progress[r.req.id] ?? 0)
      let k = Math.max(0, Math.min(left, Math.floor(Number(m.n) || 0)))
      if (k <= 0) return
      let pts = 0
      if (r.req.item === 'coins') {
        k = Math.min(k, s.coins)
        if (k <= 0) { send(s, { t: 'toast', text: '金币不够' }); return }
        s.coins -= k; pts = Math.ceil(k / 10)
      } else {
        const have = s.inv.reduce((a, x) => a + (x?.id === r.req.item ? x.n : 0), 0)
        k = Math.min(k, have)
        if (k <= 0) { send(s, { t: 'toast', text: `背包里没有${ITEMS[r.req.item]?.name ?? r.req.item}` }); return }
        let need = k
        for (let i = 0; i < s.inv.length && need > 0; i++) {
          const x = s.inv[i]
          if (x?.id !== r.req.item) continue
          const t = Math.min(need, x.n); x.n -= t; need -= t
          if (x.n <= 0) s.inv[i] = null
        }
        pts = k * (ITEMS[r.req.item]?.price ?? 10)
      }
      restore.progress[r.req.id] = (restore.progress[r.req.id] ?? 0) + k
      const c = (restore.credits[s.id] ??= { name: s.name, pts: 0 })
      c.name = s.name; c.pts += pts
      if (stageFunded(restore)) {
        restore.funded = dayOf(clockNow())
        broadcast({ t: 'chat', from: '', text: `「${STAGES[restore.done].name}」的材料凑齐了！明天一早完工。`, sys: true })
      }
      saveRestore(); pushRestore(); sendInv(s)
      progress(s, 'donate')
      break
    }
    case 'mailRead': {
      const mm = s.story.mail.find(o => o.id === m.id)
      if (!mm || mm.read) return
      mm.read = true
      sendStory(s)
      break
    }
    case 'mailTake': {
      const mm = s.story.mail.find(o => o.id === m.id)
      if (!mm?.attach || mm.taken) return
      if ('coins' in mm.attach) s.coins += mm.attach.coins
      else if (!addItem(s, mm.attach.item, mm.attach.n)) { send(s, { t: 'toast', text: '背包满了' }); return }
      mm.taken = true; mm.read = true
      sendInv(s)
      sendStory(s)
      break
    }
    case 'enterHome': {
      const l = LOTS[m.lot]
      if (!l || s.scene !== 'island') return
      const d = lotDoor(l)
      if (Math.hypot(s.x / TILE - d.x, s.y / TILE - d.y) > 2.2) return
      const h = homeOf(l.id)
      if (!h) { send(s, { t: 'toast', text: '这块空地还没有人住' }); return }
      s.scene = `home:${l.id}`; s.x = h.room.spawn.x; s.y = h.room.spawn.y; s.dirty = true
      send(s, homeMsg(h))
      send(s, { t: 'goto', scene: s.scene, x: s.x, y: s.y })
      if (h.owner !== s.id) broadcast({ t: 'toast', text: `${s.name} 来你家串门了` }, o => o.id === h.owner)
      break
    }
    case 'furnish': {
      const h = myHome(s)
      if (!h) return
      const items = h.data.items
      if (m.op === 'place') {
        const slot = s.inv[m.slot]
        const kind = slot && furnKind(slot.id)
        if (!slot || !kind) return
        const x = Math.round(m.x), y = Math.round(m.y)
        if (!canPlace(h.room, items, kind, x, y)) { send(s, { t: 'toast', text: '这里放不下' }); return }
        slot.n--
        if (slot.n <= 0) s.inv[m.slot] = null
        items.push({ id: h.data.next++, k: kind, x, y, flip: !!m.flip })
      } else {
        const i = items.findIndex(it => it.id === m.id)
        if (i < 0) return
        const it = items[i]
        if (FURNITURE[it.k]?.chest && h.data.chest.some(Boolean) && items.filter(o => FURNITURE[o.k]?.chest).length === 1) { send(s, { t: 'toast', text: '箱子里还有东西，先取出来' }); return }
        if (!addItem(s, furnItem(it.k))) { send(s, { t: 'toast', text: '背包满了' }); return }
        items.splice(i, 1)
      }
      saveHome(h)
      sendInv(s)
      pushHome(h)
      break
    }
    case 'buyFurn': {
      const d = FURNITURE[m.kind]
      const n = Math.max(1, Math.min(20, m.n | 0))
      if (!d || !myHome(s)) return
      if (s.coins < d.price * n) { send(s, { t: 'toast', text: '金币不够' }); return }
      if (!addItem(s, furnItem(m.kind), n)) { send(s, { t: 'toast', text: '背包满了' }); return }
      s.coins -= d.price * n
      sendInv(s)
      break
    }
    case 'chest': {
      const h = myHome(s)
      if (!h) return
      // 屋里得摆着箱子，而且人站在某个箱子旁边
      if (!h.data.items.some(it => FURNITURE[it.k]?.chest && Math.hypot(it.x - s.x, it.y - s.y) < 48)) return
      const box = h.data.chest
      if (m.op === 'put') {
        const i = m.slot ?? -1, slot = s.inv[i]
        if (!slot) return
        let to = box.findIndex(b => b && b.id === slot.id && ITEMS[slot.id]?.stack)
        if (to >= 0) box[to]!.n += slot.n
        else {
          to = box.findIndex(b => !b)
          if (to < 0) { send(s, { t: 'toast', text: '箱子满了' }); return }
          box[to] = { id: slot.id, n: slot.n }
        }
        s.inv[i] = null
      } else if (m.op === 'take') {
        const i = m.slot ?? -1, b = box[i]
        if (!b) return
        if (!addItem(s, b.id, b.n)) { send(s, { t: 'toast', text: '背包满了' }); return }
        box[i] = null
      }
      if (m.op !== 'open') { saveHome(h); sendInv(s) }
      send(s, { t: 'chest', slots: box })
      break
    }
    case 'travel': {
      // 出发点：潮汐港的栈桥/老潘身边，或者当前地图任意一块传送石旁
      const here = mapOf(s.scene)
      const atPortal = !!here && worldOf(here.id).portals.some(p => Math.hypot(s.x / TILE - p.x, s.y / TILE - p.y) < 2.5)
      if (!(onDock(s) || nearLaopan(s) || atPortal)) { send(s, { t: 'toast', text: '要在老潘的船边或者传送石旁边才能出发' }); return }
      if (m.to === 'island') {
        if (s.scene === 'island') return
        s.scene = 'island'; s.x = (PLACES.diveSpot.x0 + 2) * TILE; s.y = (PLACES.diveSpot.y0 + 0.6) * TILE
      } else {
        const md = mapOf(m.to)
        if (!md) return
        const w = worldOf(md.id)
        const p = w.portals[m.portal ?? 0] ?? w.portals[0]
        s.scene = m.to; s.x = p.x * TILE; s.y = p.y * TILE
      }
      s.dirty = true
      send(s, { t: 'goto', scene: s.scene, x: s.x, y: s.y })
      break
    }
    case 'surface': {
      if (s.scene !== 'sea') return
      if (m.lost && s.diveCatch.length) {
        for (const id of s.diveCatch) takeItem(s, id)
        send(s, { t: 'toast', text: `氧气耗尽！这次潜水抓到的 ${s.diveCatch.length} 条鱼都丢了` })
        sendInv(s)
      }
      s.diveCatch = []
      handle(s, { t: 'scene', to: 'island' })
      break
    }
    case 'shoot': {
      if (s.scene !== 'sea') return
      s.act = 'shoot'; s.actAt = Date.now()
      broadcast({ t: 'shot', by: s.id, x: m.x, y: m.y, dx: m.dx, dy: m.dy, gun: s.gear.harpoon }, o => o !== s && o.scene === 'sea')
      break
    }
    case 'hit': {
      const now = Date.now()
      // 打中鲨鱼：抓不了，但会被吓跑一阵
      const sh = sharks.get(m.fish)
      if (sh) {
        if (s.scene !== 'sea' || now - s.lastHitAt < 250 || Math.hypot(sh.x - s.x, sh.y - s.y) > HARPOONS[s.gear.harpoon].range + 80) return
        s.lastHitAt = now
        sharkFlee(sh, s.x, s.y, 6000)
        broadcast({ t: 'fishHit', fish: sh.id, hp: 1, by: s.id }, o => o.scene === 'sea')
        return
      }
      const f = fish.get(m.fish)
      if (!f || s.scene !== 'sea' || now - s.lastHitAt < 250) return
      const cap = BASKETS[s.gear.basket].cap
      if (s.diveCatch.length >= cap) {
        if (now - (s.fullToastAt ?? 0) > 3000) { s.fullToastAt = now; send(s, { t: 'toast', text: `鱼篓满了（${cap} 条），回船上卸货吧` }) }
        return
      }
      if (Math.hypot(f.x - s.x, f.y - s.y) > HARPOONS[s.gear.harpoon].range + 80) return
      s.lastHitAt = now
      f.hp -= HARPOONS[s.gear.harpoon].damage
      f.fleeUntil = now + 2500
      if (f.hp > 0) { broadcast({ t: 'fishHit', fish: f.id, hp: f.hp, by: s.id }, o => o.scene === 'sea'); return }
      fish.delete(f.id)
      const item = `fish_${f.kind}`
      if (addItem(s, item)) { s.diveCatch.push(item); sendInv(s); progress(s, 'catch') }
      else send(s, { t: 'toast', text: '背包满了，鱼跑掉了' })
      broadcast({ t: 'caught', fish: f.id, by: s.id, kind: f.kind }, o => o.scene === 'sea')
      break
    }
    case 'sell': {
      const atStall = Math.hypot(s.x / TILE - PLACES.stall.x, s.y / TILE - (PLACES.stall.y + 1)) < 3.2
      const atBin = Math.hypot(s.x / TILE - PLACES.bin.x, s.y / TILE - (PLACES.bin.y + 0.6)) < 2.4
      const atMarket = marketDay() && nearMarket(s.x / TILE, s.y / TILE)
      if (s.scene !== 'island' || !(atStall || atBin || atMarket || nearSeedshop(s))) return
      const slot = s.inv[m.slot]
      const price = slot ? ITEMS[slot.id]?.price : undefined
      if (!slot || !price) return
      const n = m.all ? slot.n : 1
      s.coins += Math.round(price * n * (atMarket ? 1.25 : 1))
      slot.n -= n
      if (slot.n <= 0) s.inv[m.slot] = null
      sendInv(s)
      progress(s, 'sell', n)
      break
    }
    case 'buy': {
      const def = ITEMS[m.item]
      const n = Math.max(1, Math.min(99, m.n | 0))
      if (!def?.buy || !def.seedOf || s.scene !== 'island') return
      if (!nearSeedshop(s)) return
      if (s.coins < def.buy * n) { send(s, { t: 'toast', text: '金币不够' }); return }
      if (!addItem(s, m.item, n)) { send(s, { t: 'toast', text: '背包满了' }); return }
      s.coins -= def.buy * n
      sendInv(s)
      break
    }
    case 'eat': {
      const slot = s.inv[m.slot]
      const food = slot ? ITEMS[slot.id]?.food : undefined
      if (!slot || !food || s.scene === 'sea') return
      const en = energyOf(s)
      if (en.v >= ENERGY_MAX) { send(s, { t: 'toast', text: '现在不饿' }); return }
      en.v = Math.min(ENERGY_MAX, en.v + food)
      slot.n--
      if (slot.n <= 0) s.inv[m.slot] = null
      s.dirty = true
      sendInv(s); sendEnergy(s)
      send(s, { t: 'toast', text: `吃了${ITEMS[slot.id].name}，体力 +${food}` })
      progress(s, 'eat')
      break
    }
    case 'swap': {
      if (m.a < 0 || m.b < 0 || m.a >= INV_SIZE || m.b >= INV_SIZE) return
      ;[s.inv[m.a], s.inv[m.b]] = [s.inv[m.b], s.inv[m.a]]
      sendInv(s)
      break
    }
    case 'cook': {
      const def = DISHES[m.dish]
      if (!def || s.scene !== 'restaurant') return
      if (s.holding) { send(s, { t: 'toast', text: '手上已经端着一道菜了' }); return }
      const st = stationAt(RESTAURANT, s.x, s.y)
      if (!st || st.station !== def.station) return
      const pick = pickIngredients(s.inv, def)
      if (!pick) { send(s, { t: 'toast', text: '食材不够' }); return }
      for (const i of pick.slots) { const slot = s.inv[i]!; slot.n--; if (slot.n <= 0) s.inv[i] = null }
      const q = Math.max(0, Math.min(2, m.quality | 0))
      s.holding = { dish: m.dish, value: Math.round(pick.value * QUALITY_MULT[q]), quality: q }
      s.act = 'cook'; s.actAt = Date.now()
      sendInv(s)
      send(s, { t: 'holding', hold: s.holding })
      break
    }
    case 'discard': {
      if (s.holding) { s.holding = null; send(s, { t: 'holding', hold: null }) }
      break
    }
    case 'serve': {
      const c = customers.get(m.customer)
      if (!c || c.state !== 'wait' || s.scene !== 'restaurant' || !s.holding) return
      if (s.holding.dish !== c.dish) { send(s, { t: 'toast', text: '客人点的是' + DISHES[c.dish].name }); return }
      if (!canServe(s.x, s.y, RESTAURANT.seats![c.seat])) return
      // 小费：等得越短给得越多（最多菜价的 30%）
      const left = Math.max(0, 1 - (Date.now() - c.since) / c.patience)
      const tip = Math.round(s.holding.value * 0.3 * left)
      const coins = s.holding.value + tip
      s.coins += coins
      s.holding = null
      setCustomer(c, 'eat')
      send(s, { t: 'holding', hold: null })
      sendInv(s)
      broadcast({ t: 'served', customer: c.id, by: s.id, coins, tip }, o => o.scene === 'restaurant')
      progress(s, 'serve')
      broadcast({ t: 'restaurant', ...restaurantState() }, o => o.scene === 'restaurant')
      break
    }
    case 'upgrade': {
      const kind = m.kind
      if ((kind !== 'tank' && kind !== 'harpoon' && kind !== 'basket') || !nearXiaoshan(s)) return
      const lv = s.gear[kind] + 1
      if (lv > gearMax(kind)) return
      const def = gearDef(kind, lv)
      if (!affordable(def.cost, s.coins, s.inv)) { send(s, { t: 'toast', text: '金币或材料不够' }); return }
      s.coins -= def.cost.coins
      for (const [id, n] of def.cost.items ?? []) for (let k = 0; k < n; k++) takeItem(s, id)
      s.gear = { ...s.gear, [kind]: lv }
      sendInv(s)
      send(s, { t: 'gear', gear: s.gear, upgraded: kind })
      broadcast({ t: 'chat', from: '', text: `${s.name} 换上了${def.name}`, sys: true }, o => o !== s)
      progress(s, 'upgrade')
      break
    }
    case 'chat': {
      const text = String(m.text ?? '').trim().slice(0, 80)
      if (text) broadcast({ t: 'chat', from: s.name, text })
      break
    }
  }
}

// ── HTTP：生产环境托管 dist/ ──
const MIME: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json', '.woff2': 'font/woff2', '.ogg': 'audio/ogg', '.mp3': 'audio/mpeg', '.txt': 'text/plain; charset=utf-8' }
const DIST = join(ROOT, 'dist')
const http = createServer((req, res) => {
  const url = decodeURIComponent((req.url ?? '/').split('?')[0])
  let file = join(DIST, url === '/' ? 'index.html' : url)
  if (!file.startsWith(DIST) || !existsSync(file) || statSync(file).isDirectory()) file = join(DIST, 'index.html')
  if (!existsSync(file)) { res.writeHead(404); res.end('dist/ 不存在：开发模式请访问 Vite 地址，或先 npm run build'); return }
  res.writeHead(200, { 'Content-Type': MIME[extname(file)] ?? 'application/octet-stream' })
  res.end(readFileSync(file))
})

const wss = new WebSocketServer({ server: http, path: '/ws' })
wss.on('connection', ws => {
  let s: Session | null = null
  ws.on('message', raw => {
    let m: ClientMsg
    try { m = JSON.parse(String(raw)) } catch { return }
    if (!s) { if (m.t === 'hello') s = hello(ws, m); return }
    handle(s, m)
  })
  ws.on('close', () => {
    if (!s || !sessions.has(s)) return
    sessions.delete(s)
    savePlayer(s)
    broadcast({ t: 'left', id: s.id })
    broadcast({ t: 'chat', from: '', text: `${s.name} 离开了`, sys: true })
  })
})

// ── 主循环 ──
let tick = 0
setInterval(() => {
  tick++
  stepFish(0.05)
  stepSharks(0.05)
  if (tick % 2 === 0) { // 10Hz 同步
    const list = [...sessions].map(pub)
    for (const s of sessions) send(s, { t: 'players', list: list.filter(p => p.scene === s.scene && p.id !== s.id) })
    const fl: FishPublic[] = [...fish.values()].map(f => ({ id: f.id, kind: f.kind, x: Math.round(f.x), y: Math.round(f.y), vx: Math.round(f.vx), vy: Math.round(f.vy), hp: f.hp }))
    for (const sh of sharks.values()) fl.push({ id: sh.id, kind: sh.kind, x: Math.round(sh.x), y: Math.round(sh.y), vx: Math.round(sh.vx), vy: Math.round(sh.vy), hp: 1, mad: !!sh.target })
    broadcast({ t: 'fish', list: fl }, s => s.scene === 'sea')
  }
  if (tick % 10 === 0) stepRestaurant() // 2Hz
  if (tick % 100 === 0) { // 5 秒
    processDays()
    rainWater()
    fillFish()
    // 体力随时间回：变了就推给客户端
    for (const s of sessions) if (energyOf(s).v !== s.sentEnergy) sendEnergy(s)
    broadcast({ t: 'clock', clock: clockNow(), day: dayOf(clockNow()) })
    for (const s of sessions) if (s.dirty) savePlayer(s)
  }
}, 50)

http.listen(PORT, () => console.log(`2D动森服务端 http://localhost:${PORT}  (ws: /ws)  第 ${dayOf(clockNow())} 天`))
