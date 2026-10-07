// 岛上的界面（2D动森）：手机（里程、DIY 配方、图鉴、地图、护照）、工作台、阿海的小摊、钓到 / 抓到的弹窗、里程到账。
// 都是 DOM 弹窗（class="modal"），Esc、点空白处关掉，跟别的面板一样。
import type { Game } from '../game.ts'
import { state } from '../state.ts'
import { ITEMS, TILE } from '../../shared/data.ts'
import { RECIPES, ACHIEVEMENTS, TENT_SHOP, MOVE_BILL, TOOL_USES } from '../../shared/diy.ts'
import { FISHES, BUGS, FISH_BY, BUG_BY, fishAvailable, bugAvailable } from '../../shared/critters.ts'
import type { FishDef, BugDef } from '../../shared/critters.ts'
import { makeIsle, isleMinimap, ISLE_W, ISLE_H, FRUIT_NAME, FRUITS } from '../../shared/isle/gen.ts'
import { calendarOf } from '../../shared/data.ts'

const LOC_NAME: Record<string, string> = { sea: '海', river: '河', pond: '池塘', fly: '空中', flower: '花上', ground: '地上', tree: '树上', beach: '沙滩' }
const el = (tag: string, cls = '', html = '') => { const e = document.createElement(tag); if (cls) e.className = cls; if (html) e.innerHTML = html; return e }

// 月份、钟点写成人话（南半球月份错开半年）
function monthsText(ms: [number, number][], hemi: 'N' | 'S') {
  if (ms.length === 1 && ms[0][0] === 1 && ms[0][1] === 12) return '全年'
  const sh = (m: number) => hemi === 'S' ? ((m + 5) % 12) + 1 : m
  return ms.map(([a, z]) => a === z ? `${sh(a)} 月` : `${sh(a)}～${sh(z)} 月`).join('、')
}
function hoursText(h: [number, number]) {
  if (h[0] === 0 && h[1] === 24) return '全天'
  return `${h[0]} 点～${h[1] < h[0] ? '次日 ' : ''}${h[1]} 点`
}

export class IsleUI {
  private phone = el('div', 'modal hidden phone-modal')
  private craft = el('div', 'modal hidden')
  private shop = el('div', 'modal hidden')
  private catchEl = el('div', 'catch-pop hidden')
  private app = ''
  private pediaTab: 'fish' | 'bugs' = 'fish'
  private crafting = false
  private phoneBtn = el('button', 'phone-btn hidden')
  // P：开 / 关手机（聊天框里打字、别的面板开着时不响应）
  private onKey = (e: KeyboardEvent) => {
    if (e.key.toLowerCase() !== 'p' || document.activeElement?.tagName === 'INPUT' || document.getElementById('hud')?.classList.contains('hidden')) return
    if (this.phoneOpen()) { this.g.hud.closeModals(); return }
    if (!this.g.hud.modalOpen()) this.openPhone()
  }

  constructor(private g: Game) {
    const ui = document.getElementById('ui')!
    this.phone.id = 'phone'; this.craft.id = 'craft'; this.shop.id = 'ishop'
    for (const m of [this.phone, this.craft, this.shop]) { m.addEventListener('mousedown', e => { if (e.target === m) g.hud.closeModals() }); ui.appendChild(m) }
    ui.appendChild(this.catchEl)
    // 手机按钮（鼠标、触屏用）：拿到手机以后才出现
    this.phoneBtn.title = '手机（P）'
    this.phoneBtn.appendChild(this.hdIcon('icon_phone', 54))
    this.phoneBtn.onclick = () => { if (!this.g.hud.modalOpen()) this.openPhone() }
    document.getElementById('hud')!.appendChild(this.phoneBtn)
    this.syncPhoneBtn()
    window.addEventListener('keydown', this.onKey)
  }
  private syncPhoneBtn() { this.phoneBtn.classList.toggle('hidden', !state.prog?.phone) }
  destroy() {
    for (const m of [this.phone, this.craft, this.shop, this.catchEl, this.phoneBtn]) m.remove()
    window.removeEventListener('keydown', this.onKey)
  }

  // ── 高清图集里任意一帧（物品、App 图标、村民头像） ──
  hdIcon(frame: string, box = 48) {
    const e = el('div', 'ico hd')
    const meta = this.g.assets.atlasMeta.icons_hd
    const f = meta?.frames[frame]?.frame
    if (!f) return e
    const k = (box * 0.8) / Math.max(f.w, f.h)
    const sw = meta.size?.w ?? 4096, sh = meta.size?.h ?? 4096
    e.style.width = `${Math.round(f.w * k)}px`; e.style.height = `${Math.round(f.h * k)}px`
    e.style.background = `url(/assets/${meta.image}) -${f.x * k}px -${f.y * k}px / ${sw * k}px ${sh * k}px no-repeat`
    return e
  }
  private itemIcon(id: string, box = 48) { return this.hdIcon(ITEMS[id]?.icon ?? id, box) }
  private have(id: string) { return state.me.inv.reduce((a, x) => a + (x?.id === id ? x.n : 0), 0) }

  // ═══ 手机 ═══
  openPhone(app = '') {
    if (!state.prog?.phone) return
    this.app = app
    this.renderPhone()
    this.phone.classList.remove('hidden')
    this.g.audio.play('open', 0.4)
  }
  togglePhone() { if (this.phone.classList.contains('hidden')) this.openPhone(); else this.g.hud.closeModals() }
  phoneOpen() { return !this.phone.classList.contains('hidden') }

  private renderPhone() {
    const p = state.prog!
    const pub = state.isle!
    const hour = state.hour, c = calendarOf(state.day)
    const h = Math.floor(hour) % 24, m = Math.floor((hour % 1) * 60)
    const box = el('div', 'phone')
    const top = el('div', 'ph-top', `<span>${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}</span><span>${c.month}月${c.date}日</span>`)
    box.appendChild(top)
    const body = el('div', 'ph-body')
    box.appendChild(body)
    const apps: [string, string, string][] = [['miles', 'app_miles', '岛务里程'], ['diy', 'app_diy', 'DIY 配方'], ['pedia', 'app_pedia', '图鉴'], ['map', 'app_map', '地图'], ['passport', 'app_passport', '护照'], ['chat', 'app_chat', '聊天']]
    if (!this.app) {
      body.appendChild(el('div', 'ph-brand', `${pub.name ? pub.name + '岛' : '无人岛'} · 岛务手机`))
      const grid = el('div', 'ph-apps')
      for (const [id, icon, name] of apps) {
        const b = el('button', 'ph-app')
        b.appendChild(this.hdIcon(icon, 78))
        b.appendChild(el('span', '', name))
        b.onclick = () => {
          this.g.audio.play('click', 0.4)
          if (id === 'chat') { this.g.hud.closeModals(); this.g.hud.openChat(); return }
          this.app = id; this.renderPhone()
        }
        grid.appendChild(b)
      }
      body.appendChild(grid)
      body.appendChild(el('div', 'ph-foot', `里程 <b>${p.miles.toLocaleString()}</b>`))
    } else {
      const head = el('div', 'ph-head')
      const back = el('button', 'ph-back', '‹')
      back.onclick = () => { this.g.audio.play('click', 0.4); this.app = ''; this.renderPhone() }
      head.append(back, el('span', '', apps.find(a => a[0] === this.app)?.[2] ?? ''))
      body.appendChild(head)
      const page = el('div', 'ph-page')
      body.appendChild(page)
      if (this.app === 'miles') this.pageMiles(page)
      else if (this.app === 'diy') this.pageDiy(page)
      else if (this.app === 'pedia') this.pagePedia(page)
      else if (this.app === 'map') this.pageMap(page)
      else if (this.app === 'passport') this.pagePassport(page)
    }
    this.phone.innerHTML = ''
    this.phone.appendChild(box)
  }

  private pageMiles(page: HTMLElement) {
    const p = state.prog!
    page.appendChild(el('div', 'mi-total', `<span>岛务里程</span><b>${p.miles.toLocaleString()}</b>`))
    if (!p.bill.paid) page.appendChild(el('div', 'mi-bill', `移居费还没付：${MOVE_BILL.miles.toLocaleString()} 里程或 ${MOVE_BILL.bells.toLocaleString()} 铃钱（去广场找周叔）`))
    else page.appendChild(el('div', 'mi-bill ok', '移居费已经付清'))
    const list = el('div', 'mi-list')
    for (const a of ACHIEVEMENTS) {
      const got = p.achieved[a.id] ?? 0
      const n = p.stats[a.stat] ?? 0
      const done = got >= a.tiers.length
      const next = a.tiers[Math.min(got, a.tiers.length - 1)]
      const row = el('div', `mi-row${done ? ' done' : ''}`)
      const pct = done ? 100 : Math.min(100, Math.round((n / next[0]) * 100))
      row.innerHTML = `<div class="mi-name">${a.name}<span>${'★'.repeat(got)}${'☆'.repeat(a.tiers.length - got)}</span></div>
        <div class="mi-bar"><i style="width:${pct}%"></i></div>
        <div class="mi-sub">${done ? '全部完成' : `${Math.min(n, next[0])} / ${next[0]}　→ +${next[1]} 里程`}</div>`
      list.appendChild(row)
    }
    page.appendChild(list)
  }

  private pageDiy(page: HTMLElement) {
    const p = state.prog!
    if (!p.recipes.length) { page.appendChild(el('div', 'ph-empty', '还没有学会任何配方')); return }
    for (const id of p.recipes) {
      const r = RECIPES[id]
      if (!r) continue
      const row = el('div', 'dy-row')
      row.appendChild(this.itemIcon(r.makes, 52))
      const info = el('div', 'dy-info', `<div class="dy-name">${r.name}</div>`)
      const mats = el('div', 'dy-mats')
      for (const [mid, n] of r.mats) {
        const chip = el('span', `dy-mat${this.have(mid) >= n ? '' : ' miss'}`)
        chip.appendChild(this.itemIcon(mid, 26)); chip.appendChild(el('span', '', `${ITEMS[mid]?.name ?? mid} ${this.have(mid)}/${n}`))
        mats.appendChild(chip)
      }
      info.appendChild(mats)
      row.appendChild(info)
      page.appendChild(row)
    }
    page.appendChild(el('div', 'ph-note', '材料凑齐了，到岛务所帐篷旁边的工作台做'))
  }

  private pagePedia(page: HTMLElement) {
    const p = state.prog!
    const pub = state.isle!
    const tabs = el('div', 'pd-tabs')
    for (const [k, name] of [['fish', '鱼'], ['bugs', '虫']] as const) {
      const t = el('button', `tab${this.pediaTab === k ? ' on' : ''}`, `${name} ${k === 'fish' ? p.pedia.fish.length : p.pedia.bugs.length}/${k === 'fish' ? FISHES.length : BUGS.length}`)
      t.onclick = () => { this.pediaTab = k; this.renderPhone() }
      tabs.appendChild(t)
    }
    page.appendChild(tabs)
    const month = calendarOf(state.day).month, hour = state.hour
    const grid = el('div', 'pd-grid')
    const detail = el('div', 'pd-detail', '点一下看看')
    const list: (FishDef | BugDef)[] = this.pediaTab === 'fish' ? FISHES : BUGS
    for (const d of list) {
      const caught = (this.pediaTab === 'fish' ? p.pedia.fish : p.pedia.bugs).includes(d.id)
      const now = this.pediaTab === 'fish' ? fishAvailable(d as FishDef, month, hour, pub.hemi) : bugAvailable(d as BugDef, month, hour, pub.hemi)
      const cell = el('button', `pd-cell${caught ? '' : ' unk'}${now ? ' now' : ''}`)
      cell.appendChild(this.hdIcon(d.icon, 56))
      cell.onclick = () => {
        this.g.audio.play('click', 0.3)
        detail.innerHTML = caught
          ? `<b>${d.name}</b>　${LOC_NAME[d.loc]}　·　${monthsText(d.months, pub.hemi)}　·　${hoursText(d.hours)}　·　卖 ${d.price} 铃钱`
          : `<b>？？？</b>　还没${this.pediaTab === 'fish' ? '钓到' : '抓到'}${now ? '　（现在就能找到）' : ''}`
      }
      grid.appendChild(cell)
    }
    page.appendChild(grid)
    page.appendChild(detail)
    page.appendChild(el('div', 'ph-note', '绿点 = 这个月、这个钟点出没'))
  }

  private pageMap(page: HTMLElement) {
    const pub = state.isle!
    const isle = makeIsle(pub.seed)
    const cv = document.createElement('canvas')
    cv.width = ISLE_W; cv.height = ISLE_H
    cv.className = 'mp-canvas'
    const ctx = cv.getContext('2d')!
    ctx.putImageData(new ImageData(isleMinimap(isle) as Uint8ClampedArray<ArrayBuffer>, ISLE_W, ISLE_H), 0, 0)
    const dot = (x: number, y: number, c: string, r = 2) => { ctx.fillStyle = c; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill() }
    if (pub.tent) dot(pub.tent.tx + 0.5, pub.tent.ty + 0.5, '#f08a3c', 2.2)
    for (const v of pub.villagers) if (v.tent) dot(v.tent.tx + 0.5, v.tent.ty + 0.5, '#5aa0e0', 2)
    const me = (this.g.scene as any)?.me
    if (me) { dot(me.x / TILE, me.y / TILE, '#fff', 3); dot(me.x / TILE, me.y / TILE, '#e0453a', 2) }
    page.appendChild(cv)
    page.appendChild(el('div', 'ph-note', '红点：你　橙色：你的帐篷　蓝色：邻居的帐篷　米色：广场'))
  }

  private pagePassport(page: HTMLElement) {
    const pub = state.isle!
    const isle = makeIsle(pub.seed)
    const card = el('div', 'pp-card')
    card.innerHTML = `<div class="pp-name">${state.me.name}</div>
      <div class="pp-row"><span>岛</span><b>${pub.name ? pub.name + '岛' : '（还没起名）'}</b></div>
      <div class="pp-row"><span>特产</span><b>${FRUIT_NAME[isle.fruit]}</b></div>
      <div class="pp-row"><span>半球</span><b>${pub.hemi === 'S' ? '南半球' : '北半球'}</b></div>
      <div class="pp-row"><span>里程</span><b>${state.prog!.miles.toLocaleString()}</b></div>
      <div class="pp-row"><span>图鉴</span><b>鱼 ${state.prog!.pedia.fish.length} · 虫 ${state.prog!.pedia.bugs.length}</b></div>`
    page.appendChild(card)
  }

  // ═══ 工作台 ═══
  openCraft() {
    this.renderCraft()
    this.craft.classList.remove('hidden')
    this.g.audio.play('open', 0.4)
  }
  private renderCraft() {
    const p = state.prog!
    const box = el('div', 'panel craft-panel')
    box.appendChild(el('div', 'title', '工作台<button class="x">×</button>'))
    ;(box.querySelector('.x') as HTMLElement).onclick = () => this.g.hud.closeModals()
    const list = el('div', 'cr-list')
    for (const id of p?.recipes ?? []) {
      const r = RECIPES[id]
      if (!r) continue
      const ok = r.mats.every(([m, n]) => this.have(m) >= n)
      const row = el('div', `cr-row${ok ? '' : ' off'}`)
      row.appendChild(this.itemIcon(r.makes, 56))
      const info = el('div', 'dy-info', `<div class="dy-name">${r.name}${TOOL_USES[r.makes] ? `<small>能用 ${TOOL_USES[r.makes]} 次</small>` : ''}</div>`)
      const mats = el('div', 'dy-mats')
      for (const [mid, n] of r.mats) {
        const chip = el('span', `dy-mat${this.have(mid) >= n ? '' : ' miss'}`)
        chip.appendChild(this.itemIcon(mid, 26)); chip.appendChild(el('span', '', `${ITEMS[mid]?.name ?? mid} ${this.have(mid)}/${n}`))
        mats.appendChild(chip)
      }
      info.appendChild(mats)
      const b = el('button', 'btn', '做！') as HTMLButtonElement
      b.disabled = !ok || this.crafting
      b.onclick = () => this.doCraft(id, row)
      row.append(info, b)
      list.appendChild(row)
    }
    if (!list.children.length) list.appendChild(el('div', 'ph-empty', '还没有学会任何配方'))
    box.appendChild(list)
    box.appendChild(el('div', 'inv-tip', '配方在手机的「DIY 配方」里也能看'))
    this.craft.innerHTML = ''
    this.craft.appendChild(box)
  }
  // 敲敲打打一会儿再做好（原作有一段做东西的动画）
  private doCraft(id: string, row: HTMLElement) {
    if (this.crafting) return
    this.crafting = true
    const bar = el('div', 'cr-prog', '<i></i>')
    row.appendChild(bar)
    const fill = bar.querySelector('i') as HTMLElement
    const t0 = performance.now()
    let hits = 0
    const step = () => {
      const k = Math.min(1, (performance.now() - t0) / 1300)
      fill.style.width = `${k * 100}%`
      if (k > hits * 0.3 && hits < 4) { this.g.audio.play(hits % 2 ? 'chop' : 'till', 0.45, 1 + hits * 0.08); hits++ }
      if (k < 1) requestAnimationFrame(step)
      else {
        this.crafting = false
        this.g.net.send({ t: 'craft', recipe: id })
        this.g.audio.play('catch', 0.5)
        setTimeout(() => { if (!this.craft.classList.contains('hidden')) this.renderCraft() }, 250)
      }
    }
    step()
  }
  refresh() {
    this.syncPhoneBtn()
    if (!this.craft.classList.contains('hidden') && !this.crafting) this.renderCraft()
    if (!this.shop.classList.contains('hidden')) this.renderShop()
    if (!this.phone.classList.contains('hidden')) this.renderPhone()
  }

  // ═══ 阿海的小摊 ═══
  openShop() {
    this.renderShop()
    this.shop.classList.remove('hidden')
    this.g.audio.play('open', 0.4)
  }
  private sellPrice(id: string) {
    const fruit = makeIsle(state.isle!.seed).fruit
    if ((FRUITS as readonly string[]).includes(id) && id !== fruit) return 500
    return ITEMS[id]?.price ?? 0
  }
  private renderShop() {
    const box = el('div', 'panel shop-panel')
    box.appendChild(el('div', 'title', `<span>阿海的小摊</span><span class="sh-coins">${state.me.coins.toLocaleString()} 铃钱</span><button class="x">×</button>`))
    ;(box.querySelector('.x') as HTMLElement).onclick = () => this.g.hud.closeModals()
    const cols = el('div', 'shop-cols')
    const buyCol = el('div', 'col', '<div class="col-title">买</div>')
    for (const [id, price] of TENT_SHOP) {
      const row = el('div', 'buy-row')
      row.appendChild(this.itemIcon(id, 34))
      row.appendChild(el('span', 'name', ITEMS[id]?.name ?? id))
      row.appendChild(el('span', 'price', `${price}`))
      const b = el('button', 'btn', '买') as HTMLButtonElement
      b.disabled = state.me.coins < price
      b.onclick = () => { this.g.net.send({ t: 'isleShop', op: 'buy', item: id, n: 1 }); this.g.audio.play('coin', 0.4) }
      row.appendChild(b)
      buyCol.appendChild(row)
    }
    const sellCol = el('div', 'col', '<div class="col-title">卖（点一下卖 1 个，Shift+点 全部卖掉）</div>')
    const grid = el('div', 'grid')
    state.me.inv.forEach((slot, i) => {
      if (!slot) return
      const def = ITEMS[slot.id]
      if (!def || def.quest || !this.sellPrice(slot.id)) return
      const cell = el('div', 'slot')
      cell.appendChild(this.itemIcon(slot.id, 56))
      if (slot.n > 1) cell.appendChild(el('span', 'n', String(slot.n)))
      cell.appendChild(el('span', 'pr', String(this.sellPrice(slot.id))))
      cell.title = `${def.name} · ${this.sellPrice(slot.id)} 铃钱`
      cell.onclick = e => { this.g.net.send({ t: 'isleShop', op: 'sell', slot: i, all: e.shiftKey }); this.g.audio.play('coin', 0.4) }
      grid.appendChild(cell)
    })
    if (!grid.children.length) grid.appendChild(el('div', 'empty-note', '口袋里没有能卖的东西'))
    sellCol.appendChild(grid)
    cols.append(buyCol, sellCol)
    box.appendChild(cols)
    this.shop.innerHTML = ''
    this.shop.appendChild(box)
  }

  // ═══ 钓到 / 抓到 ═══
  private catchTimer = 0
  showCatch(kind: 'fish' | 'bug', id: string, kept: boolean, fresh: boolean) {
    const d = kind === 'fish' ? FISH_BY[id] : BUG_BY[id]
    if (!d) return
    const big = kind === 'fish' && (d as FishDef).size >= 5
    const line = !kept ? '口袋满了，只好放走了……' : fresh ? '图鉴新登录！' : big ? '好大一条！' : `能卖 ${d.price} 铃钱`
    this.catchEl.innerHTML = ''
    this.catchEl.appendChild(this.hdIcon(d.icon, 150))
    this.catchEl.appendChild(el('div', 'cp-title', `${kind === 'fish' ? '钓到了' : '抓到了'}「${d.name}」！`))
    this.catchEl.appendChild(el('div', `cp-sub${fresh ? ' new' : ''}`, line))
    this.catchEl.classList.remove('hidden', 'out')
    clearTimeout(this.catchTimer)
    this.catchTimer = window.setTimeout(() => this.hideCatch(), 2600)
  }
  catchOpen() { return !this.catchEl.classList.contains('hidden') }
  hideCatch() { this.catchEl.classList.add('out'); clearTimeout(this.catchTimer); this.catchTimer = window.setTimeout(() => this.catchEl.classList.add('hidden'), 250) }

  // 里程到账
  milesToast(name: string, miles: number) {
    const t = el('div', 'toast miles')
    t.appendChild(this.hdIcon('app_miles', 30))
    t.appendChild(el('span', '', `<b>+${miles}</b> 里程　${name}`))
    document.getElementById('toasts')!.appendChild(t)
    setTimeout(() => t.remove(), 3200)
    this.g.audio.play('coin', 0.5, 1.2)
  }
}
