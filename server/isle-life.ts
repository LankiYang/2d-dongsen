// 岛上的日常（2D动森，第 1 天起）：每天早上的刷新、砍树敲石头、DIY、钓鱼抓虫、交给周叔研究、帐篷小摊、移居费、里程成就；
// 第 2 天起：馆长（龟教授）、化石点和铲子、鉴定、捐博物馆。
// 数值照原作（docs/acnh-research.md）。规则全在服务端，客户端只负责演和发请求。
import { TILE, ITEMS, calendarOf, dayOf, hourOf } from '../shared/data.ts'
import { ISLE_W, IT, isWaterT, FRUITS } from '../shared/isle/gen.ts'
import { objTile, MUSEUM_DESK } from '../shared/isle/rules.ts'
import { RECIPES, ACHIEVEMENTS, TOOL_USES, TENT_SHOP, CRITTER_REWARDS, CRITTERS_FOR_CURATOR, MOVE_BILL, MUSEUM_GOAL } from '../shared/diy.ts'
import { FOSSILS, DIGS_PER_DAY, DIGS_MAX } from '../shared/fossils.ts'
import type { Stat } from '../shared/diy.ts'
import { FISH_BY, BUG_BY, fishAvailable, bugAvailable } from '../shared/critters.ts'
import { hash2 } from '../shared/noise.ts'
import type { ProgPublic } from '../shared/protocol.ts'
import type { IsleCtx, IsleSession, IsleRec, Prog, initIsles } from './isle.ts'
import { loadProg } from './isle.ts'

export function initLife<S extends IsleSession>(ctx: IsleCtx<S> & { clock(): number }, isles: ReturnType<typeof initIsles<S>>) {
  const { geo, push, isleOfScene, nearPx, toast, drop, curatorAt, load } = isles
  const CURATOR_STAGES = ['curatorHere', 'museum15', 'museumBuild', 'museumOpen']
  // 人在哪座岛上（岛上或者博物馆里）
  const isleHere = (s: S) => isleOfScene(s.scene) ?? (s.scene.startsWith('museum:') ? load(Number(s.scene.slice(7))) : null)
  // 够得着馆长：开馆前在他帐篷门口，开馆后在馆里的前台
  const byCurator = (r: IsleRec, s: S) => {
    if (s.scene === `museum:${r.id}`) return r.st.stage === 'museumOpen' && nearPx(s, MUSEUM_DESK.x, MUSEUM_DESK.y + 30, 3)
    const c = curatorAt(r)
    return !!c && r.st.stage !== 'museumOpen' && nearPx(s, c.x, c.y, 4)
  }

  const prog = (s: S): Prog => (s.prog ??= loadProg(null))
  const progPub = (p: Prog): ProgPublic => ({ miles: p.miles, phone: p.phone, recipes: p.recipes, pedia: p.pedia, stats: p.stats, achieved: p.achieved, bill: p.bill, given: p.given })
  const sendProg = (s: S) => { s.dirty = true; ctx.send(s, { t: 'prog', prog: progPub(prog(s)) }) }

  // 统计 +n，跨过成就档位就给里程
  function stat(s: S, key: Stat, n = 1) {
    const p = prog(s)
    p.stats[key] = (p.stats[key] ?? 0) + n
    for (const a of ACHIEVEMENTS) {
      if (a.stat !== key) continue
      let got = p.achieved[a.id] ?? 0
      while (got < a.tiers.length && p.stats[key] >= a.tiers[got][0]) {
        const miles = a.tiers[got][1]
        p.miles += miles
        got++
        ctx.send(s, { t: 'miles', name: a.tiers.length > 1 ? `${a.name}（${a.tiers[got - 1][0]}）` : a.name, miles })
      }
      p.achieved[a.id] = got
    }
    sendProg(s)
  }
  const learn = (s: S, id: string) => { const p = prog(s); if (!p.recipes.includes(id)) p.recipes.push(id) }
  const count = (s: S, id: string) => s.inv.reduce((a, x) => a + (x?.id === id ? x.n : 0), 0)
  // 从好几格里一共拿走 n 个
  function takeN(s: S, id: string, n: number) {
    if (count(s, id) < n) return false
    for (let i = 0; i < s.inv.length && n > 0; i++) {
      const x = s.inv[i]
      if (x?.id !== id) continue
      const k = Math.min(n, x.n)
      x.n -= k; n -= k
      if (x.n <= 0) s.inv[i] = null
    }
    return true
  }
  // 工具：放进空格，带耐久
  function addTool(s: S, id: string) {
    const i = s.inv.findIndex(x => !x)
    if (i < 0) return false
    s.inv[i] = { id, n: 1, d: TOOL_USES[id] }
    return true
  }
  // 用一次工具：耐久 -1，用完就坏
  function wear(s: S, slot: number) {
    const it = s.inv[slot]
    if (!it || it.d === undefined) return
    it.d--
    if (it.d <= 0) { s.inv[slot] = null; toast(s, `${ITEMS[it.id]?.name ?? '工具'}坏掉了……`) }
  }
  const toolAt = (s: S, slot: number, kinds: string[]) => { const it = s.inv[slot]; return it && kinds.includes(ITEMS[it.id]?.tool ?? '') ? it : null }

  // ── 每天早上的刷新（原作数据挖掘的 GrowUp，数值见调研文档）──
  function growUp(r: IsleRec) {
    const today = ctx.today()
    if (r.st.day === today) return
    const g = geo(r.seed)
    const W = ISLE_W
    const st = r.st
    const days = st.day === undefined ? 1 : Math.min(7, Math.max(1, today - st.day))
    // 地上已经有东西（掉落物、花草树枝、树干石头）的格子不再放
    const busy = new Set<number>()
    for (const o of g.objects) if (!st.removed.includes(o.id)) { const [x, y] = objTile(o); busy.add(y * W + x) }
    const tileFree = (x: number, y: number) => !busy.has(y * W + x) && !st.drops.some(d => Math.floor(d.x / TILE) === x && Math.floor(d.y / TILE) === y) && !g.blocked[y * W + x]
    const rand = (n: number) => Math.floor(Math.random() * n)
    // 馆长第二天到；捐满后第二天博物馆开馆
    if (st.stage === 'curatorWait' && (st.curatorDay ?? today) < today) st.stage = 'curatorHere'
    if (st.stage === 'museumBuild' && (st.museumDay ?? today) < today) st.stage = 'museumOpen'
    for (let k = 0; k < days; k++) {
      // 化石点：馆长来了以后才有；每天最多新出 4 个，全岛最多 6 个，在平地的草上
      if (CURATOR_STAGES.includes(st.stage)) {
        st.digs ??= []; st.digSeq ??= 1
        const want = Math.min(DIGS_PER_DAY, DIGS_MAX - st.digs.length)
        for (let i = 0, tries = 0; i < want && tries < 400; tries++) {
          const x = rand(W), y = rand(g.types.length / W)
          if (g.types[y * W + x] !== IT.GRASS || g.level[y * W + x] || !tileFree(x, y) || st.digs.some(d => Math.abs(d.tx - x) + Math.abs(d.ty - y) < 3)) continue
          if (st.curatorTent && Math.abs(x - st.curatorTent.tx) <= 4 && y >= st.curatorTent.ty - 4 && y <= st.curatorTent.ty + 2) continue
          st.digs.push({ id: st.digSeq++, tx: x, ty: y }); i++
        }
      }
      // 树枝：地上最多 15 根，阔叶树底下冒出来
      const trees = g.objects.filter(o => o.kind === 'tree' && !st.removed.includes(o.id))
      const nb = st.drops.filter(d => d.item === 'branch').length + g.objects.filter(o => o.kind === 'branch' && !st.removed.includes(o.id)).length
      for (let i = 0, tries = 0; i < Math.min(15 - nb, 6) && tries < 200; tries++) {
        const t = trees[rand(trees.length)]
        if (!t) break
        const [tx, ty] = objTile(t)
        const x = tx + rand(5) - 2, y = ty + 1 + rand(2)
        if (x < 0 || y < 0 || g.types[y * W + x] !== IT.GRASS || !tileFree(x, y)) continue
        drop(r, 'branch', (x + 0.5) * TILE + (Math.random() - 0.5) * 8, (y + 0.6) * TILE); i++
      }
      // 杂草：少于 30 棵每天长 2 棵，30～149 棵长 1 棵，150 棵就不长了
      const nw = st.drops.filter(d => d.item === 'weeds').length + g.objects.filter(o => o.kind === 'weed' && !st.removed.includes(o.id)).length
      const grow = nw < 30 ? 2 : nw < 150 ? 1 : 0
      for (let i = 0, tries = 0; i < grow && tries < 300; tries++) {
        const x = rand(W), y = rand(g.types.length / W)
        if (g.types[y * W + x] !== IT.GRASS || !tileFree(x, y)) continue
        st.drops.push({ id: st.dropSeq++, item: 'weeds', x: Math.round((x + 0.5) * TILE), y: Math.round((y + 0.7) * TILE), look: 'weed' }); i++
      }
      // 贝壳：沙滩上最多 15 个（夏天多一种夏日贝壳）
      const month = calendarOf(today).month
      const summer = r.hemi === 'N' ? month >= 6 && month <= 8 : month === 12 || month <= 2
      const table: [string, number][] = summer
        ? [['shell_summer', 10], ['shell_conch', 6], ['shell_giant_clam', 10], ['shell_coral', 10], ['shell_venus_comb', 10], ['shell_sea_snail', 10], ['shell_cowrie', 17], ['shell_sand_dollar', 27]]
        : [['shell_conch', 5], ['shell_giant_clam', 11], ['shell_coral', 11], ['shell_venus_comb', 11], ['shell_sea_snail', 11], ['shell_cowrie', 20], ['shell_sand_dollar', 31]]
      const ns = st.drops.filter(d => d.item.startsWith('shell_')).length
      for (let i = 0, tries = 0; i < Math.min(15 - ns, 8) && tries < 600; tries++) {
        const x = rand(W), y = rand(g.types.length / W)
        if (g.types[y * W + x] !== IT.SAND || !tileFree(x, y) || g.fields.sand(x + 0.5, y + 0.5) > -0.8) continue
        let roll = Math.random() * table.reduce((a, t) => a + t[1], 0), item = table[0][0]
        for (const [id, w] of table) { roll -= w; if (roll <= 0) { item = id; break } }
        drop(r, item, (x + 0.5) * TILE, (y + 0.6) * TILE); i++
      }
    }
    // 今天的钱石
    const rocks = g.objects.filter(o => o.kind === 'rock' && !st.removed.includes(o.id))
    st.moneyRock = rocks.length ? rocks[Math.floor(hash2(today, r.seed, 77) * rocks.length)].id : -1
    st.day = today
    r.fresh = true
  }
  isles.hooks.onLoad = growUp
  // 每 5 秒检查一次：有人在的岛换日了就刷新、推给客户端（读档时刷新过的也在这里推）
  const tick = () => {
    for (const s of ctx.sessions) {
      const r = isleHere(s) ?? (s.scene.startsWith('tent:') && s.isle ? isles.load(s.isle) : null)
      if (r?.fresh) { r.fresh = false; push(r) }
    }
  }

  isles.hooks.onPickup = (s: S, item: string) => {
    if (item === 'weeds') stat(s, 'weeds')
    else if (item.startsWith('shell_')) stat(s, 'shells')
    else if ((FRUITS as readonly string[]).includes(item)) stat(s, 'fruit')
  }
  // 第一次见馆长：铲子、撑竿的配方；周叔那 5 只算捐过的
  isles.hooks.onCurator = (s: S, r: IsleRec) => {
    learn(s, 'flimsy_shovel'); learn(s, 'vaulting_pole')
    const given = prog(s).given
    r.st.museum = { donated: [...given], base: given.length }
    sendProg(s)
  }
  // 第 1 天早上：手机、移居成就、钓竿配方（DIY 教室）
  isles.hooks.onPhone = (s: S) => {
    const p = prog(s)
    p.phone = true
    learn(s, 'flimsy_rod')
    if (!p.stats.moved) stat(s, 'moved')
    sendProg(s)
  }

  // 附近有什么水（钓鱼地点）：看玩家周围 5 格
  function waterNear(r: IsleRec, s: S): Set<string> {
    const g = geo(r.seed), W = ISLE_W, out = new Set<string>()
    const cx = Math.floor(s.x / TILE), cy = Math.floor(s.y / TILE)
    for (let y = cy - 5; y <= cy + 5; y++) for (let x = cx - 5; x <= cx + 5; x++) {
      const t = g.types[y * W + x]
      if (t === IT.SHALLOW || t === IT.DEEP) out.add('sea')
      else if (t === IT.RIVER) out.add('river')
      else if (t === IT.POND) out.add('pond')
    }
    return out
  }
  const nearPlaza = (r: IsleRec, s: S, rad = 7) => { const p = geo(r.seed).plaza; return nearPx(s, (p.x + p.w / 2) * TILE, (p.y + 4) * TILE, rad) }

  return {
    tick, sendProg, progPub, prog,

    // 斧头砍树 / 敲石头（斧头、铲子都行）
    tool(s: S, m: { kind: 'chop' | 'rock', obj: number, slot?: number }) {
      const r = isleOfScene(s.scene)
      if (!r) return
      const g = geo(r.seed)
      const o = g.objects.find(x => x.id === m.obj)
      const slot = m.slot ?? -1
      if (!o || r.st.removed.includes(o.id) || !nearPx(s, o.x, o.y - 6, 2.6)) return
      const today = ctx.today()
      if (m.kind === 'chop') {
        if (!toolAt(s, slot, ['axe']) || !(o.kind === 'tree' || o.kind === 'fruit_tree' || o.kind.startsWith('palm'))) return
        const c = (r.st.chops ??= {})[o.id]
        const n = c && c[0] === today ? c[1] : 0
        wear(s, slot)
        if (n < 3) {
          // 原作的掉率：阔叶树 软木 30 / 木材 35 / 硬木 35；椰子树 35 / 30 / 35
          const palm = o.kind.startsWith('palm')
          const k = Math.random() * 100
          const item = k < (palm ? 35 : 30) ? 'softwood' : k < 65 ? 'wood' : 'hardwood'
          drop(r, item, o.x + (Math.random() < 0.5 ? -16 : 16), o.y + 6 + Math.random() * 8)
          r.st.chops![o.id] = [today, n + 1]
          stat(s, 'wood')
        }
      } else {
        if (!toolAt(s, slot, ['axe', 'shovel']) || o.kind !== 'rock') return
        const h = (r.st.rockHits ??= {})[o.id]
        const n = h && h[0] === today ? h[1] : 0
        if (n >= 8) return
        wear(s, slot)
        r.st.rockHits![o.id] = [today, n + 1]
        if (o.id === r.st.moneyRock) {
          // 钱石：8 下依次 100～200、100～200、300、500、1000、2000、4000、8000
          const bells = [100 + Math.floor(Math.random() * 101), 100 + Math.floor(Math.random() * 101), 300, 500, 1000, 2000, 4000, 8000][n]
          s.coins += bells
          ctx.send(s, { t: 'inv', coins: s.coins, inv: s.inv })
          toast(s, `+${bells} 铃钱`)
        } else {
          // 石块 50 / 铁矿石 34 / 黏土 15 / 金矿石 1（一天最多一块金）
          const k = Math.random() * 100
          let item = k < 50 ? 'stone' : k < 84 ? 'iron_nugget' : k < 99 ? 'clay' : 'gold_nugget'
          if (item === 'gold_nugget') { if (r.st.goldDay === today) item = 'stone'; else r.st.goldDay = today }
          const a = Math.random() * Math.PI * 2
          drop(r, item, o.x + Math.cos(a) * 20, o.y + 4 + Math.abs(Math.sin(a)) * 14)
        }
        stat(s, 'rocks')
      }
      ctx.sendInv(s)
      push(r)
    },

    // 在工作台做东西（岛务所帐篷前的工作台）
    craft(s: S, recipe: string) {
      const r = isleOfScene(s.scene)
      const rc = RECIPES[recipe]
      if (!r || !rc || !prog(s).recipes.includes(recipe) || !nearPlaza(r, s, 6)) return
      if (!rc.mats.every(([id, n]) => count(s, id) >= n)) { toast(s, '材料不够'); return }
      if (!s.inv.some(x => !x) && !rc.mats.some(([id, n]) => count(s, id) === n)) { toast(s, '口袋满了'); return }
      for (const [id, n] of rc.mats) takeN(s, id, n)
      if (TOOL_USES[rc.makes]) addTool(s, rc.makes); else ctx.addItem(s, rc.makes)
      ctx.send(s, { t: 'toast', text: `做好了「${rc.name}」！` })
      // DIY 教室：做出第一把钓竿以后，学会捕虫网和篝火，开始研究岛上的生物
      if (recipe === 'flimsy_rod' && r.st.stage === 'diy' && r.owner === s.id) {
        learn(s, 'flimsy_net'); learn(s, 'campfire')
        r.st.stage = 'critters'
        push(r)
      }
      ctx.sendInv(s)
      stat(s, 'crafts')
    },

    // 钓到 / 抓到（服务端核对工具、季节、钟点、地点、频率）
    catch(s: S, m: { kind: 'fish' | 'bug', id: string, slot?: number }) {
      const r = isleOfScene(s.scene)
      if (!r) return
      const p = prog(s)
      const now = Date.now()
      if (p.lastCatch && now - p.lastCatch < 1000) return
      const slot = m.slot ?? -1
      const clock = ctx.clock()
      const month = calendarOf(dayOf(clock)).month, hour = hourOf(clock)
      if (m.kind === 'fish') {
        const fd = FISH_BY[m.id]
        if (!fd || !toolAt(s, slot, ['rod']) || !fishAvailable(fd, month, hour, r.hemi) || !waterNear(r, s).has(fd.loc)) return
      } else {
        const bd = BUG_BY[m.id]
        if (!bd || !toolAt(s, slot, ['net']) || !bugAvailable(bd, month, hour, r.hemi)) return
      }
      p.lastCatch = now
      wear(s, slot)
      const item = m.kind === 'fish' ? `fsh_${m.id}` : `bug_${m.id}`
      const kept = ctx.addItem(s, item)
      ctx.send(s, { t: 'got', kind: m.kind, id: m.id, kept })
      const list = m.kind === 'fish' ? p.pedia.fish : p.pedia.bugs
      const fresh = !list.includes(m.id)
      if (fresh) list.push(m.id)
      ctx.sendInv(s)
      stat(s, m.kind === 'fish' ? 'fish' : 'bugs')
      if (fresh) stat(s, 'species')
    },

    // 交给周叔研究（第 1 天：5 种不同的鱼或虫）
    give(s: S, slot: number) {
      const r = isleOfScene(s.scene)
      const it = s.inv[slot]
      if (!r || r.owner !== s.id || r.st.stage !== 'critters' || !it || !ITEMS[it.id]?.critter || !nearPlaza(r, s, 8)) return
      const p = prog(s)
      if (p.given.includes(it.id)) { toast(s, '这个周叔已经研究过了'); return }
      ctx.takeItem(s, it.id)
      p.given.push(it.id)
      for (const [n, recipe] of CRITTER_REWARDS) if (p.given.length === n) { learn(s, recipe); ctx.send(s, { t: 'toast', text: `学会了「${RECIPES[recipe].name}」的做法！` }) }
      if (p.given.length >= CRITTERS_FOR_CURATOR) {
        // 交满了：周叔把馆长的帐篷包交给你，挑地方放（按博物馆的大小）
        r.st.stage = 'curator'
        if (!ctx.addItem(s, 'kit_curator')) toast(s, '口袋满了，等会儿再找周叔拿帐篷')
        push(r)
      }
      ctx.sendInv(s)
      sendProg(s)
    },

    // 拿铲子挖面前那一格：化石点出未鉴定的化石（口袋满了就掉在地上）
    dig(s: S, m: { tx: number, ty: number, slot: number }) {
      const r = isleOfScene(s.scene)
      if (!r || !toolAt(s, m.slot, ['shovel'])) return
      if (!nearPx(s, (m.tx + 0.5) * TILE, (m.ty + 0.5) * TILE, 2)) return
      const d = r.st.digs?.find(x => x.tx === m.tx && x.ty === m.ty)
      if (!d) return
      r.st.digs = r.st.digs!.filter(x => x !== d)
      wear(s, m.slot)
      if (!ctx.addItem(s, 'fossil')) drop(r, 'fossil', (m.tx + 0.5) * TILE, (m.ty + 0.7) * TILE)
      ctx.send(s, { t: 'toast', text: '挖到了化石！' })
      ctx.sendInv(s)
      push(r)
    },

    // 请馆长鉴定：口袋里所有未鉴定的化石一次鉴定完
    assess(s: S) {
      const r = isleHere(s)
      if (!r || !CURATOR_STAGES.includes(r.st.stage) || r.st.stage === 'curatorHere' || !byCurator(r, s)) return
      const items: string[] = []
      s.inv.forEach((x, i) => {
        if (x?.id !== 'fossil') return
        const f = FOSSILS[Math.floor(Math.random() * FOSSILS.length)]
        s.inv[i] = { id: `fos_${f.id}`, n: 1 }
        items.push(`fos_${f.id}`)
      })
      if (!items.length) return
      ctx.send(s, { t: 'assessed', items })
      ctx.sendInv(s)
    },

    // 捐给博物馆：鱼、虫、鉴定过的化石，每种只收第一件
    museumDonate(s: S, slot: number) {
      const r = isleHere(s)
      const it = s.inv[slot]
      if (!r || !['museum15', 'museumBuild', 'museumOpen'].includes(r.st.stage) || !it || !byCurator(r, s)) return
      if (!ITEMS[it.id]?.critter && !it.id.startsWith('fos_')) return
      const mu = (r.st.museum ??= { donated: [], base: 0 })
      if (mu.donated.includes(it.id)) { toast(s, '这个博物馆里已经有了'); return }
      ctx.takeItem(s, it.id)
      mu.donated.push(it.id)
      if (r.st.stage === 'museum15' && mu.donated.length - mu.base >= MUSEUM_GOAL) { r.st.stage = 'museumBuild'; r.st.museumDay = ctx.today() }
      ctx.sendInv(s)
      push(r)
    },

    // 帐篷里阿海的小摊
    shop(s: S, m: { op: 'buy', item: string, n: number } | { op: 'sell', slot: number, all: boolean }) {
      const r = isleOfScene(s.scene)
      if (!r || !nearPlaza(r, s, 8)) return
      if (m.op === 'buy') {
        const row = TENT_SHOP.find(([id]) => id === m.item)
        if (!row) return
        const n = Math.max(1, Math.min(10, m.n | 0))
        for (let i = 0; i < n; i++) {
          if (s.coins < row[1]) { toast(s, '铃钱不够'); break }
          if (!(TOOL_USES[row[0]] ? addTool(s, row[0]) : ctx.addItem(s, row[0]))) { toast(s, '口袋满了'); break }
          s.coins -= row[1]
        }
      } else {
        const it = s.inv[m.slot]
        if (!it) return
        const def = ITEMS[it.id]
        if (!def?.price || def.quest) return
        // 外地水果卖 500（本地 100）
        const isFruit = (FRUITS as readonly string[]).includes(it.id)
        const price = isFruit && it.id !== geo(r.seed).fruit ? 500 : def.price
        const n = m.all ? it.n : 1
        it.n -= n
        if (it.n <= 0) s.inv[m.slot] = null
        s.coins += price * n
        stat(s, 'sold', n)
      }
      ctx.sendInv(s)
    },

    // 付移居费：5,000 里程或 49,800 铃钱
    payBill(s: S, w: 'miles' | 'bells') {
      const r = isleOfScene(s.scene)
      const p = prog(s)
      if (!r || p.bill.paid || !nearPlaza(r, s, 8)) return
      if (w === 'miles') { if (p.miles < MOVE_BILL.miles) { toast(s, '里程不够'); return } p.miles -= MOVE_BILL.miles }
      else { if (s.coins < MOVE_BILL.bells) { toast(s, '铃钱不够'); return } s.coins -= MOVE_BILL.bells; ctx.sendInv(s) }
      p.bill.paid = true
      ctx.send(s, { t: 'toast', text: '移居费付清了！' })
      sendProg(s)
    },
  }
}
