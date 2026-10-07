// DOM 界面：时钟、快捷栏、提示、聊天、商店、背包、海底仪表、登录
import { FURNITURE } from '../../shared/furniture.ts'
import { NPC_INFO, NPC_IDS, HEART, MAX_HEARTS, hearts, GIFTS_PER_WEEK, birthdayOf } from '../../shared/npcs.ts'
import type { NpcId } from '../../shared/npcs.ts'
import type { Quest, Mail } from '../../shared/quests.ts'
import { WEEKDAY_NAMES, calendarOf } from '../../shared/data.ts'
import { ITEMS, HOTBAR, SHIRT_HUES, INV_SIZE, DISHES, FISH, QUALITY_NAME, pickIngredients, TANKS, HARPOONS, BASKETS, ENERGY_MAX, gearDef, gearMax, countItem, affordable } from '../../shared/data.ts'
import type { DishId, Station, GearKind, TankDef, HarpoonDef } from '../../shared/data.ts'
import type { Slot, Holding } from '../../shared/protocol.ts'
import type { GameAssets } from '../core/assets.ts'
import type { Audio } from '../core/audio.ts'
import { state } from '../state.ts'
import { STAGES } from '../../shared/restore.ts'
import { TOOL_USES } from '../../shared/diy.ts'
import type { Req } from '../../shared/restore.ts'

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T

export class Hud {
  onChat: (text: string) => void = () => {}
  onBuy: (item: string, n: number) => void = () => {}
  onSell: (slot: number, all: boolean) => void = () => {}
  onSwap: (a: number, b: number) => void = () => {}
  onUpgrade: (kind: GearKind) => void = () => {}
  private tooltip = document.createElement('div')
  private lastZone = ''

  constructor(private assets: GameAssets, private audio: Audio) {
    this.tooltip.className = 'tooltip hidden'
    document.body.appendChild(this.tooltip)
    const input = $<HTMLInputElement>('chat-input')
    window.addEventListener('keydown', e => {
      if (e.key === 'Enter') {
        if (document.activeElement === input) {
          const text = input.value.trim()
          if (text) this.onChat(text)
          input.value = ''
          input.blur()
        } else if (!this.modalOpen() && e.target === document.body && !$('hud').classList.contains('hidden')) { input.focus(); e.preventDefault() }
      } else if (e.key === 'Escape') {
        if (document.activeElement === input) input.blur()
        this.closeModals()
      }
    })
    for (const b of document.querySelectorAll<HTMLElement>('[data-close]')) b.onclick = () => this.closeModals()
    // J：任务栏（聊天框或别的面板开着时不响应）
    window.addEventListener('keydown', e => {
      if (e.key.toLowerCase() !== 'j' || this.typing() || $('hud').classList.contains('hidden')) return
      if (!$('journal').classList.contains('hidden')) { this.closeModals(); return }
      if (!this.modalOpen()) this.openJournal()
    })
    for (const t of document.querySelectorAll<HTMLElement>('#journal .tab')) t.onclick = () => this.journalTab(t.dataset.tab as 'quests' | 'social')
    for (const m of document.querySelectorAll<HTMLElement>('.modal')) m.addEventListener('mousedown', e => { if (e.target === m) this.closeModals() })
  }

  typing() { return document.activeElement === $('chat-input') }
  modalOpen() { return [...document.querySelectorAll('.modal')].some(m => !m.classList.contains('hidden')) }
  closeModals() {
    let any = false
    clearInterval(this.dlgTimer)
    this.dropDlgKey()
    this.dropCook()
    for (const m of document.querySelectorAll('.modal')) { if (!m.classList.contains('hidden')) any = true; m.classList.add('hidden') }
    this.releaseDialog()
    if (any) this.audio.play('close', 0.4)
    this.tooltip.classList.add('hidden')
  }

  // ── 物品图标：直接用图集 PNG 做 CSS 背景 ──
  icon(id: string, box = 56): HTMLElement {
    const def = ITEMS[id]
    const atlas = def?.atlas ?? 'icons'
    const meta = this.assets.atlasMeta[atlas]
    const f = meta.frames[def?.icon ?? id]?.frame
    const el = document.createElement('div')
    el.className = 'ico'
    if (!f) return el
    // 高清图集：按比例平滑缩放到格子里
    if (atlas === 'icons_hd') { cssSprite(el, meta, f, (box * 0.72) / Math.max(f.w, f.h)); el.classList.add('hd'); return el }
    // 能整数放大就整数放大（像素不变形）；大鱼缩小到格子里
    const s = Math.min(3, box / Math.max(f.w, f.h))
    const sc = s >= 1 ? Math.max(1, Math.floor(s)) : s
    el.style.width = `${f.w}px`
    el.style.height = `${f.h}px`
    el.style.background = `url(/assets/${meta.image}) -${f.x}px -${f.y}px`
    el.style.transform = `scale(${sc})`
    return el
  }

  private slotEl(slot: Slot | null, i: number, key?: string) {
    const el = document.createElement('div')
    el.className = 'slot'
    if (key) { const k = document.createElement('span'); k.className = 'k'; k.textContent = key; el.appendChild(k) }
    if (slot) {
      el.appendChild(this.icon(slot.id))
      if (slot.n > 1) { const n = document.createElement('span'); n.className = 'n'; n.textContent = String(slot.n); el.appendChild(n) }
      // 会用坏的工具：底下一条耐久
      if (slot.d !== undefined && TOOL_USES[slot.id]) { const b = document.createElement('span'); b.className = 'dur'; const k = slot.d / TOOL_USES[slot.id]; b.innerHTML = `<i style="width:${Math.round(k * 100)}%;background:${k > 0.5 ? '#7cc95e' : k > 0.2 ? '#f0b440' : '#e0583a'}"></i>`; el.appendChild(b) }
      el.onmouseenter = () => this.showTip(el, slot)
      el.onmouseleave = () => this.tooltip.classList.add('hidden')
    }
    el.dataset.i = String(i)
    return el
  }

  private showTip(el: HTMLElement, slot: Slot) {
    const def = ITEMS[slot.id]
    if (!def) return
    const r = el.getBoundingClientRect()
    const name = def.tool === 'harpoon' ? HARPOONS[state.gear.harpoon].name : def.name
    this.tooltip.textContent = name + (slot.d !== undefined && TOOL_USES[slot.id] ? `  ·  还能用 ${slot.d} 次` : '') + (def.price ? `  ·  卖 ${def.price}` : def.quest ? '  ·  重要物品' : '') + (def.food ? `  ·  吃掉体力 +${def.food}` : '')
    this.tooltip.style.left = `${r.left}px`
    this.tooltip.style.top = `${r.top - 44}px`
    this.tooltip.classList.remove('hidden')
  }

  renderHotbar() {
    const bar = $('hotbar')
    bar.innerHTML = ''
    for (let i = 0; i < HOTBAR; i++) {
      const el = this.slotEl(state.me.inv[i] ?? null, i, String(i + 1))
      if (i === state.me.selected) el.classList.add('sel')
      el.onclick = () => { state.me.selected = i; this.audio.play('select', 0.3); this.renderHotbar() }
      bar.appendChild(el)
    }
    $('coins').textContent = String(state.me.coins)
    if (!$('shop').classList.contains('hidden')) this.renderShopSell()
    if (!$('inventory').classList.contains('hidden')) this.renderInventory()
    this.renderUpgrade()
  }

  setClock(hour: number, day: number, rain: boolean) {
    const h = Math.floor(hour) % 24, m = Math.floor((hour % 1) * 60)   // 现实时间：精确到分钟
    $('clock-time').textContent = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
    const c = calendarOf(day)
    $('clock-day').textContent = `${c.month}月${c.date}日 · 周${WEEKDAY_NAMES[c.weekday]}`
    const night = hour >= 19.5 || hour < 5.5
    $('clock-weather').textContent = rain ? '☂' : night ? '☾' : '☀'
  }

  onHint: ((html: string | null) => void) | null = null
  private lastHint: string | null = ''
  hint(html: string | null) {
    const el = $('hint')
    if (html && document.body.classList.contains('touch')) html = touchHint(html)
    if (html === this.lastHint) return
    this.lastHint = html
    this.onHint?.(html)
    if (!html) { el.classList.add('hidden'); return }
    el.innerHTML = html
    el.classList.remove('hidden')
  }
  // 触屏：点「聊天」按钮才露出输入框，输完收起
  openChat() {
    const input = $<HTMLInputElement>('chat-input')
    $('chat').classList.add('chatting')
    input.focus()
    input.onblur = () => $('chat').classList.remove('chatting')
  }

  toast(text: string, kind = '') {
    const el = document.createElement('div')
    el.className = `toast ${kind}`
    el.textContent = text
    $('toasts').appendChild(el)
    setTimeout(() => el.remove(), 2700)
  }

  chat(from: string, text: string, sys = false) {
    const log = $('chat-log')
    const line = document.createElement('div')
    if (sys) { line.className = 'sys'; line.textContent = `· ${text}` }
    else {
      const who = document.createElement('span'); who.className = 'who'; who.textContent = `${from}：`
      line.append(who, document.createTextNode(text))
    }
    log.appendChild(line)
    while (log.children.length > 9) log.firstChild!.remove()
  }

  // ── NPC 对话：打字机效果 + 各人不同音高的"说话声" + 选项 ──
  private dlgTimer = 0
  private dlgKey: ((e: KeyboardEvent) => void) | null = null
  // 同一时间只保留一个对话按键监听：换人说话或关闭时必须摘掉旧的，否则数字键会触发上一段对话的选项
  private dropDlgKey() { if (this.dlgKey) window.removeEventListener('keydown', this.dlgKey, true); this.dlgKey = null }
  dialogOpen() { return !$('dialog').classList.contains('hidden') }
  // 剧情用：说一句，等玩家点一下（E / 空格 / 回车 / 点对话框）再继续。
  // 对话框要是被别的途径关掉（Esc 关掉所有面板），也要让剧情接着走，不然会永远卡住
  private dlgResolve: (() => void) | null = null
  say(o: { name: string, title: string, face: string, voice: number, text: string }): Promise<void> {
    return new Promise(res => {
      this.dlgResolve = () => res()
      this.dialog({ ...o, options: [], onOption: () => {}, onDone: () => { this.dlgResolve = null; res() } })
    })
  }
  // 剧情用：提问，返回选了第几个（对话框被关掉就当选了 cancel 那一项，默认第一项）
  ask(o: { name: string, title: string, face: string, voice: number, text: string }, options: string[], cancel = 0): Promise<number> {
    return new Promise(res => {
      this.dlgResolve = () => res(cancel)
      this.dialog({ ...o, options: options.map(label => ({ label })), onOption: i => { this.dlgResolve = null; res(i) } })
    })
  }
  private releaseDialog() { const r = this.dlgResolve; this.dlgResolve = null; r?.() }

  dialog(o: { name: string, title: string, face: string, voice: number, text: string, options: { label: string }[], onOption: (i: number) => void, onDone?: () => void }) {
    const happy = o.text.startsWith('^')
    const text = happy ? o.text.slice(1) : o.text
    // 立绘：图集 PNG 做 CSS 背景，按屏幕高度取整数倍放大
    const meta = this.assets.atlasMeta.portraits
    const f = meta.frames[`${o.face}_${happy ? 1 : 0}`]?.frame
    const face = $('dlg-face')
    const sc = window.innerHeight >= 900 ? 3 : 2
    // 动物村民（v:<id>）：立绘是 icons_hd 里的高清立像
    const vf = o.face.startsWith('v:') ? this.assets.atlasMeta.icons_hd.frames[`face_${o.face.slice(2)}`]?.frame : undefined
    face.style.display = f || vf ? '' : 'none'
    if (!f && !vf) $('dialog').style.setProperty('--face-w', '0px')
    if (vf) {
      const k = (window.innerHeight >= 900 ? 190 : 140) / vf.h
      face.style.transform = 'none'
      cssSprite(face, this.assets.atlasMeta.icons_hd, vf, k)
      $('dialog').style.setProperty('--face-w', `${Math.round(vf.w * k) + 12}px`)
    } else if (f) {
      face.style.backgroundSize = ''
      face.style.width = `${f.w}px`; face.style.height = `${f.h}px`
      face.style.background = `url(/assets/${meta.image}) -${f.x}px -${f.y}px`
      face.style.setProperty('--face-scale', `scale(${sc})`)
      face.style.transform = `scale(${sc})`
      $('dialog').style.setProperty('--face-w', `${f.w * sc + 12}px`)
    }
    $('dlg-name').textContent = o.name
    $('dlg-title').textContent = o.title
    const box = $('dlg-text'), opts = $('dlg-options')
    opts.innerHTML = ''
    $('dialog').classList.remove('hidden')
    clearInterval(this.dlgTimer)
    this.dropDlgKey()
    let i = 0
    const finish = () => {
      clearInterval(this.dlgTimer)
      box.textContent = text
      opts.innerHTML = o.onDone && !o.options.length ? '<span class="dlg-more">▼</span>' : ''
      o.options.forEach((op, k) => {
        const b = document.createElement('button')
        b.className = 'btn'
        b.innerHTML = `<span class="num">${k + 1}</span>`
        b.append(op.label)
        b.onclick = () => { this.dropDlgKey(); this.audio.play('click', 0.35); o.onOption(k) }
        opts.appendChild(b)
      })
    }
    this.dlgTimer = window.setInterval(() => {
      i++
      box.textContent = text.slice(0, i)
      if (i % 2 === 0 && text[i - 1] !== '，' && text[i - 1] !== '。') this.audio.play('chat', 0.12, o.voice * (0.95 + Math.random() * 0.1))
      if (i >= text.length) finish()
    }, 38)
    // E / 空格 / 点击跳过打字；数字键选选项
    const onKey = (e: KeyboardEvent) => {
      if (!this.dialogOpen()) { this.dropDlgKey(); return }
      const k = e.key.toLowerCase()
      if ((k === 'e' || k === ' ' || k === 'enter') && i < text.length) { i = text.length; finish(); e.stopPropagation(); e.preventDefault(); return }
      if ((k === 'e' || k === ' ' || k === 'enter') && o.onDone && !o.options.length) { this.dropDlgKey(); this.audio.play('click', 0.25); o.onDone(); e.stopPropagation(); e.preventDefault(); return }
      const n = Number(k)
      if (n >= 1 && n <= o.options.length && i >= text.length) { this.dropDlgKey(); this.audio.play('click', 0.35); o.onOption(n - 1); e.stopPropagation() }
    }
    this.dlgKey = onKey
    window.addEventListener('keydown', onKey, true)
    box.onclick = () => {
      if (i < text.length) { i = text.length; finish() }
      else if (o.onDone && !o.options.length) { this.dropDlgKey(); this.audio.play('click', 0.25); o.onDone() }
    }
  }
  // 输入一行字（给岛起名）：回车或点确定
  prompt(title: string, initial = '', max = 8): Promise<string> {
    return new Promise(resolve => {
      const box = document.createElement('div')
      box.className = 'prompt-box panel'
      box.innerHTML = `<div class="pt">${title}</div><input maxlength="${max}" /><button class="btn">确定</button>`
      document.getElementById('ui')!.appendChild(box)
      const input = box.querySelector('input')!
      input.value = initial
      setTimeout(() => input.focus(), 30)
      const done = () => { const v = input.value.trim(); if (!v) return; box.remove(); this.audio.play('click', 0.4); resolve(v) }
      box.querySelector('button')!.onclick = done
      input.onkeydown = e => { e.stopPropagation(); if (e.key === 'Enter') done() }
    })
  }
  closeDialog() { clearInterval(this.dlgTimer); this.dropDlgKey(); $('dialog').classList.add('hidden'); this.releaseDialog() }

  // ── 商店：阿海收鱼和作物；花婶卖种子、收作物；出货箱什么都收 ──
  private shopMode: 'fish' | 'seeds' | 'bin' | 'market' = 'bin'
  openShop(mode: 'fish' | 'seeds' | 'bin' | 'market') {
    this.shopMode = mode
    const withBuy = mode === 'seeds'
    $('shop-title').textContent = mode === 'fish' ? '鱼摊 · 阿海' : mode === 'seeds' ? '种子铺 · 花婶' : mode === 'market' ? '潮汐集市（集市日卖价 +25%）' : '出货箱'
    $('shop-buy-col').classList.toggle('hidden', !withBuy)
    $('shop-sell-tip').textContent = document.body.classList.contains('touch') ? '卖出（点一下卖 1 个，长按全部卖出）' : '卖出（点击卖 1 个，Shift+点击 全部卖出）'
    const buy = $('shop-buy')
    buy.innerHTML = ''
    for (const [id, def] of Object.entries(ITEMS)) {
      if (!def.buy || !def.seedOf) continue
      const row = document.createElement('div')
      row.className = 'buy-row'
      const name = document.createElement('span'); name.className = 'name'; name.textContent = def.name
      const price = document.createElement('span'); price.className = 'price'; price.textContent = `${def.buy}`
      const b1 = document.createElement('button'); b1.className = 'btn'; b1.textContent = '买 1'
      const b5 = document.createElement('button'); b5.className = 'btn'; b5.textContent = '买 5'
      b1.onclick = () => { this.onBuy(id, 1); this.audio.play('coin', 0.4) }
      b5.onclick = () => { this.onBuy(id, 5); this.audio.play('coin', 0.4) }
      row.append(this.icon(id, 24), name, price, b1, b5)
      buy.appendChild(row)
    }
    this.renderShopSell()
    $('shop').classList.remove('hidden')
    this.audio.play('open', 0.4)
  }

  private renderShopSell() {
    const grid = $('shop-sell')
    grid.innerHTML = ''
    state.me.inv.forEach((slot, i) => {
      if (!slot || !ITEMS[slot.id]?.price) return
      // 花婶只收作物
      if (this.shopMode === 'seeds' && ITEMS[slot.id].atlas === 'sea') return
      const el = this.slotEl(slot, i)
      let longFired = false, longT = 0
      el.onpointerdown = e => {
        if (e.pointerType === 'mouse') return
        longFired = false
        longT = window.setTimeout(() => { longFired = true; this.onSell(i, true); this.audio.play('coin', 0.6, 1.2) }, 450)
      }
      el.onpointerup = el.onpointercancel = el.onpointerleave = () => clearTimeout(longT)
      el.onclick = e => { if (longFired) return; this.onSell(i, e.shiftKey); this.audio.play('coin', 0.5) }
      grid.appendChild(el)
    })
    if (!grid.children.length) {
      const empty = document.createElement('div')
      empty.className = 'empty-note'
      empty.textContent = this.shopMode === 'seeds' ? '花婶只收作物，你现在还没有' : this.shopMode === 'fish' ? '背包里没有能卖的东西' : '没有能卖的东西'
      grid.appendChild(empty)
    }
  }

  // ── 装备升级：小珊的潜水店 ──
  openUpgrade() {
    this.renderUpgrade(true)
    $('upgrade').classList.remove('hidden')
    this.audio.play('open', 0.4)
  }

  renderUpgrade(force = false) {
    if (!force && $('upgrade').classList.contains('hidden')) return
    const box = $('upgrade-cards')
    box.innerHTML = ''
    box.append(this.gearCard('basket', '鱼篓', 'net'), this.gearCard('tank', '气瓶', 'oxygen'), this.gearCard('harpoon', '鱼枪', 'harpoon'))
  }

  private gearStats(kind: GearKind, lv: number, prev?: number): string {
    const diff = (a: number, b: number | undefined, unit = '') => b === undefined || a === b ? `${a}${unit}` : `${b}${unit} → <b>${a}${unit}</b>`
    if (kind === 'basket') return `一趟最多带回 ${diff(BASKETS[lv].cap, prev === undefined ? undefined : BASKETS[prev].cap, ' 条')}${prev === undefined ? '<br>满了打死的鱼会逃掉' : ''}`
    if (kind === 'tank') {
      const t: TankDef = TANKS[lv], p = prev === undefined ? undefined : TANKS[prev]
      // 两级都能下深处时只比耗氧，省掉重复的「能下蓝洞深处」，一行放得下
      const deep = !t.deep ? '下不了蓝洞深处'
        : p?.deep ? `深处耗氧 ${diff(t.deepDrain, p.deepDrain, '×')}`
        : `${p ? '<b>能下蓝洞深处</b>' : '能下蓝洞深处'} · 深处耗氧 ${t.deepDrain}×`
      return `氧气 ${diff(t.oxygen, p?.oxygen, ' 秒')}<br>${deep}`
    }
    const h: HarpoonDef = HARPOONS[lv], p = prev === undefined ? undefined : HARPOONS[prev]
    return `伤害 ${diff(h.damage, p?.damage)} · 射程 ${diff(h.range, p?.range)}<br>上弦 ${diff(h.cooldown, p?.cooldown, ' 秒')}`
  }

  private gearCard(kind: GearKind, label: string, icon: string) {
    const lv = state.gear[kind], max = gearMax(kind)
    const card = document.createElement('div')
    card.className = 'gear-card'
    const head = document.createElement('div')
    head.className = 'gear-head'
    const ico = document.createElement('div'); ico.className = 'ico-box'
    ico.appendChild(this.icon(icon, 54))
    const title = document.createElement('div')
    title.innerHTML = `<div class="gear-kind">${label}</div><div class="gear-name">${gearDef(kind, lv).name}</div>`
    const pips = document.createElement('div'); pips.className = 'pips'
    for (let i = 0; i <= max; i++) { const p = document.createElement('i'); if (i <= lv) p.className = 'on'; pips.appendChild(p) }
    head.append(ico, title, pips)
    const now = document.createElement('div'); now.className = 'gear-stats'; now.innerHTML = this.gearStats(kind, lv)
    card.append(head, now)
    if (lv >= max) {
      const done = document.createElement('div'); done.className = 'gear-done'; done.textContent = '已经是最好的了'
      card.appendChild(done)
      return card
    }
    const next = gearDef(kind, lv + 1)
    const nx = document.createElement('div'); nx.className = 'gear-next'
    nx.innerHTML = `<div class="gear-sub">升级为 <b>${next.name}</b></div><div class="gear-desc">${next.desc}</div><div class="gear-stats">${this.gearStats(kind, lv + 1, lv)}</div>`
    const cost = document.createElement('div'); cost.className = 'gear-cost'
    const coin = document.createElement('span')
    coin.className = 'cost-coin' + (state.me.coins < next.cost.coins ? ' miss' : '')
    coin.textContent = `${next.cost.coins} 金币`
    cost.appendChild(coin)
    for (const [id, n] of next.cost.items ?? []) {
      const have = countItem(state.me.inv, id)
      const it = document.createElement('span'); it.className = 'cost-item' + (have < n ? ' miss' : '')
      const ib = document.createElement('span'); ib.className = 'ico-box'; ib.appendChild(this.icon(id, 52))
      const t = document.createElement('span'); t.textContent = `${ITEMS[id]?.name ?? id} ${Math.min(have, n)}/${n}`
      it.append(ib, t)
      it.onmouseenter = () => { this.tooltip.textContent = `${ITEMS[id]?.name}：背包里有 ${have} 条`; const r = it.getBoundingClientRect(); this.tooltip.style.left = `${r.left}px`; this.tooltip.style.top = `${r.top - 44}px`; this.tooltip.classList.remove('hidden') }
      it.onmouseleave = () => this.tooltip.classList.add('hidden')
      cost.appendChild(it)
    }
    const ok = affordable(next.cost, state.me.coins, state.me.inv)
    const btn = document.createElement('button'); btn.className = 'btn gear-buy'; btn.textContent = ok ? '升级' : '还差一点'
    btn.disabled = !ok
    btn.onclick = () => { if (ok) { btn.disabled = true; this.onUpgrade(kind); this.audio.play('coin', 0.5) } }
    nx.append(cost, btn)
    card.appendChild(nx)
    return card
  }

  // ── 村民头像：立绘的脸部裁一块 ──
  face(npc: NpcId, happy = false): HTMLElement {
    const meta = this.assets.atlasMeta.portraits
    const f = meta.frames[`${npc}_${happy ? 1 : 0}`]?.frame
    const el = document.createElement('div')
    el.className = 'face'
    if (f) el.style.background = `#e8d2a2 url(/assets/${meta.image}) -${Math.round(f.x + (f.w - 56) / 2)}px -${f.y + 4}px`
    return el
  }
  private heartsEl(pts: number) {
    const h = hearts(pts)
    const el = document.createElement('span')
    el.className = 'hearts'
    el.innerHTML = Array.from({ length: MAX_HEARTS }, (_, i) => `<span class="${i < h ? 'on' : ''}">♥</span>`).join('')
    el.title = `${pts} / ${(h + 1) * HEART}`
    return el
  }
  // 任务目标的进度文字（交付类看背包里有几个）
  questProgress(q: Quest): { text: string, done: boolean } {
    const o = q.obj
    if (o.kind === 'meet') {
      const met = q.met ?? []
      return { text: `认识的人 ${met.length}/${o.npcs.length}：还差 ${o.npcs.filter(n => !met.includes(n)).map(n => NPC_INFO[n].name).join('、') || '无'}`, done: met.length >= o.npcs.length }
    }
    if (o.kind === 'count') return { text: `${o.what} ${q.have ?? 0}/${o.n}`, done: (q.have ?? 0) >= o.n }
    const have = state.me.inv.reduce((a, x) => a + (x?.id === o.item ? x.n : 0), 0)
    return { text: `把 ${ITEMS[o.item]?.name ?? o.item} ×${o.n} 交给${NPC_INFO[o.to].name}（背包里 ${Math.min(have, o.n)}/${o.n}）`, done: have >= o.n }
  }
  private daysLeft(q: Quest) {
    if (q.deadline === undefined) return ''
    const left = q.deadline - calendarOfToday()
    return left <= 0 ? '今天截止' : `还剩 ${left + 1} 天`
  }

  // ── 任务追踪条（时钟下面） ──
  renderTracker() {
    const el = $('tracker')
    const qs = state.story?.quests ?? []
    if (!qs.length) { el.classList.add('hidden'); return }
    el.innerHTML = qs.slice(0, 3).map(q => {
      const p = this.questProgress(q)
      return `<div class="tq">${q.title}</div><div class="${p.done ? 'ok' : ''}">${p.text}${q.deadline !== undefined ? ' · ' + this.daysLeft(q) : ''}</div>`
    }).join('')
    el.classList.remove('hidden')
  }

  // ── 任务栏：任务 / 关系 ──
  openJournal(tab: 'quests' | 'social' = 'quests') {
    this.journalTab(tab)
    $('journal').classList.remove('hidden')
    this.audio.play('open', 0.4)
  }
  private journalTab(tab: 'quests' | 'social') {
    for (const t of document.querySelectorAll<HTMLElement>('#journal .tab')) t.classList.toggle('on', t.dataset.tab === tab)
    $('journal-quests').classList.toggle('hidden', tab !== 'quests')
    $('journal-social').classList.toggle('hidden', tab !== 'social')
    if (tab === 'quests') this.renderQuests(); else this.renderSocial()
  }
  private renderQuests() {
    const box = $('journal-quests')
    box.innerHTML = ''
    const qs = state.story?.quests ?? []
    if (!qs.length) { box.innerHTML = '<div class="empty-note">现在没有进行中的任务。去广场的告示板看看今天的委托吧。</div>'; return }
    for (const q of qs) {
      const p = this.questProgress(q)
      const row = document.createElement('div'); row.className = 'quest'
      const body = document.createElement('div')
      body.innerHTML = `<div class="qt"><span class="kind ${q.kind}">${q.id.startsWith('story:g_') || q.id === 'story:intro' ? '引导' : q.kind === 'story' ? '主线' : '委托'}</span>${q.title}</div>` +
        `<div class="qd">${q.desc}</div><div class="qo ${p.done ? 'ok' : ''}">${p.done ? '✓ ' : '· '}${p.text}</div>` +
        `<div class="qr">奖励：${q.reward.coins} 金币${q.reward.item ? `、${ITEMS[q.reward.item.id]?.name ?? q.reward.item.id} ×${q.reward.item.n}` : ''}${q.reward.friend ? `、${NPC_INFO[q.giver].name}好感 +${q.reward.friend}` : ''}${q.deadline !== undefined ? '　' + this.daysLeft(q) : ''}</div>`
      row.append(this.face(q.giver), body)
      box.appendChild(row)
    }
  }
  private renderSocial() {
    const box = $('journal-social')
    box.innerHTML = ''
    const cal = calendarOf(calendarOfToday())
    for (const id of NPC_IDS) {
      const info = NPC_INFO[id], r = state.story?.rel[id] ?? { pts: 0, talked: false, gifted: false, gw: 0 }
      const row = document.createElement('div'); row.className = 'npc-row'
      const who = document.createElement('div'); who.className = 'who'
      who.innerHTML = `<div class="nm">${info.name}</div><div class="tt">${info.title}</div>`
      const st = document.createElement('div'); st.className = 'st'
      const bd = birthdayOf(id), today = bd.month === cal.month && bd.date === cal.date
      st.innerHTML = `<span class="${r.talked ? 'ok' : ''}">${r.talked ? '✓ 今天聊过了' : '今天还没聊'}</span><br>` +
        `本周送礼 ${r.gw}/${GIFTS_PER_WEEK}${r.gifted ? '（今天送过）' : ''}<br>` +
        `生日：${bd.month} 月 ${bd.date} 日${today ? ' <b style="color:#e0503a">今天！</b>' : ''}`
      row.append(this.face(id), who, this.heartsEl(r.pts), st)
      box.appendChild(row)
    }
  }

  // ── 告示板：今天的委托 ──
  openBoard(onAccept: () => void) {
    const body = $('board-body')
    body.innerHTML = ''
    const b = state.story?.board
    if (!b || b.taken || !b.offer) {
      body.innerHTML = `<div class="empty-note">${b?.taken ? '今天的委托你已经接下了。完成了记得去交付。' : '今天没有新的委托。'}</div>`
    } else {
      const q = b.offer
      const card = document.createElement('div'); card.className = 'notice'
      const text = document.createElement('div')
      text.innerHTML = `<div class="qt">${q.title}</div><div class="qd">${q.desc}</div><div class="qr">奖励：${q.reward.coins} 金币、${NPC_INFO[q.giver].name}好感 +${q.reward.friend ?? 0}　期限 2 天</div>`
      const btn = document.createElement('button'); btn.className = 'btn'; btn.textContent = '接下委托'
      btn.onclick = () => { onAccept(); this.audio.play('coin', 0.4) }
      text.appendChild(document.createElement('br')); text.appendChild(btn)
      card.append(this.face(q.giver), text)
      body.appendChild(card)
    }
    $('board').classList.remove('hidden')
    this.audio.play('open', 0.4)
  }

  // ── 复兴工程告示板：四期进度、当前这期要的东西（每项一条进度条 + 捐赠按钮）、贡献榜 ──
  private onDonate: ((req: string, n: number) => void) | null = null
  openRestore(onDonate: (req: string, n: number) => void) {
    this.onDonate = onDonate
    this.renderRestore()
    $('restore').classList.remove('hidden')
    this.audio.play('open', 0.4)
  }
  refreshRestore() { if (!$('restore').classList.contains('hidden')) this.renderRestore() }
  private renderRestore() {
    const r = state.restore ?? { done: 0, progress: {}, funded: null, top: [] }
    const steps = $('restore-stages')
    steps.innerHTML = ''
    STAGES.forEach((st, i) => {
      const el = document.createElement('div')
      el.className = 'rs-step' + (i < r.done ? ' done' : i === r.done ? ' now' : '')
      el.innerHTML = `<span class="n">${i < r.done ? '✓' : i + 1}</span>${st.name}`
      steps.appendChild(el)
    })
    const body = $('restore-body')
    body.innerHTML = ''
    const st = STAGES[r.done]
    if (!st) {
      body.innerHTML = '<div class="rs-all">全部完工！<br>栈桥、灯塔、集市、客船——潮汐港活过来了。</div>'
    } else {
      const head = document.createElement('div'); head.className = 'rs-head'
      head.innerHTML = `<div class="rs-name">第${'一二三四'[r.done]}期 · ${st.name}</div><div class="rs-desc">${st.desc}</div><div class="rs-unlock">完工后：${st.unlock}</div>`
      body.appendChild(head)
      if (r.funded !== null) {
        const b = document.createElement('div'); b.className = 'rs-funded'; b.textContent = '材料都凑齐了！明天一早完工。'
        body.appendChild(b)
      }
      for (const bd of st.bundles) {
        const card = document.createElement('div'); card.className = 'rs-bundle'
        const bt = document.createElement('div'); bt.className = 'rs-bt'
        const full = bd.reqs.every(q => (r.progress[q.id] ?? 0) >= q.n)
        bt.textContent = bd.name + (full ? '  ✓' : '')
        card.appendChild(bt)
        for (const q of bd.reqs) card.appendChild(this.reqRow(q, r.progress[q.id] ?? 0, r.funded !== null))
        body.appendChild(card)
      }
    }
    const side = $('restore-side')
    side.innerHTML = '<div class="col-title">贡献榜</div>'
    if (!r.top.length) side.insertAdjacentHTML('beforeend', '<div class="empty-note">还没有人捐过</div>')
    r.top.forEach((t, i) => {
      const row = document.createElement('div'); row.className = 'rs-top'
      row.innerHTML = `<span class="rk">${i + 1}</span><span class="nm"></span><span class="pt">${t.pts}</span>`
      row.querySelector('.nm')!.textContent = t.name
      side.appendChild(row)
    })
    side.insertAdjacentHTML('beforeend', `<div class="rs-note">贡献分：金币每 10 枚 1 分，物品按卖价算。<br>凑齐一期，第二天一早完工。</div>`)
  }
  private reqRow(q: Req, have: number, locked: boolean) {
    const row = document.createElement('div'); row.className = 'rs-req'
    const coins = q.item === 'coins'
    const cell = document.createElement('div'); cell.className = 'ico-cell'
    if (coins) cell.innerHTML = '<i class="coin"></i>'; else cell.appendChild(this.icon(q.item, 32))
    const name = document.createElement('span'); name.className = 'name'; name.textContent = coins ? '金币' : ITEMS[q.item]?.name ?? q.item
    const bar = document.createElement('div'); bar.className = 'rs-bar'
    bar.innerHTML = `<i style="width:${Math.min(100, (have / q.n) * 100)}%"></i><span>${have} / ${q.n}</span>`
    row.append(cell, name, bar)
    const left = q.n - have
    const mine = coins ? state.me.coins : countItem(state.me.inv, q.item)
    const btn = (label: string, n: number) => {
      const b = document.createElement('button'); b.className = 'btn'; b.textContent = label
      b.disabled = locked || left <= 0 || mine <= 0 || n <= 0
      b.onclick = () => { this.onDonate?.(q.id, n); this.audio.play('coin', 0.4) }
      row.appendChild(b)
    }
    if (left <= 0) { const ok = document.createElement('span'); ok.className = 'rs-ok'; ok.textContent = '已凑齐'; row.appendChild(ok); return row }
    if (coins) { btn('捐 500', Math.min(500, left, mine)); btn('全捐', Math.min(left, mine)) }
    else { btn('捐 1', 1); btn('全捐', Math.min(left, mine)) }
    const hint = document.createElement('span'); hint.className = 'rs-have'; hint.textContent = `有 ${mine}`
    row.appendChild(hint)
    return row
  }

  // ── 信箱 ──
  private mailSel = -1
  private mailHandlers: { read: (id: number) => void, take: (id: number) => void } | null = null
  openMail(read: (id: number) => void, take: (id: number) => void) {
    this.mailHandlers = { read, take }
    const list = state.story?.mail ?? []
    this.mailSel = (list.find(m => !m.read) ?? list[0])?.id ?? -1
    this.renderMail()
    $('mail').classList.remove('hidden')
    this.audio.play('open', 0.4)
  }
  private renderMail() {
    const list = state.story?.mail ?? []
    const box = $('mail-list'), letter = $('mail-letter')
    box.innerHTML = ''
    if (!list.length) { box.innerHTML = '<div class="empty-note">信箱是空的</div>'; letter.innerHTML = ''; return }
    for (const m of list) {
      const it = document.createElement('div'); it.className = 'mail-item' + (m.id === this.mailSel ? ' on' : '')
      it.innerHTML = `<span class="dot ${m.read ? 'read' : ''}"></span><span class="mt">${m.title}</span><span class="mf">${NPC_INFO[m.from]?.name ?? ''}${m.attach && !m.taken ? ' 📦' : ''}</span>`
      it.onclick = () => { this.mailSel = m.id; this.renderMail(); this.audio.play('click', 0.3) }
      box.appendChild(it)
    }
    const m = list.find(x => x.id === this.mailSel)
    if (!m) { letter.innerHTML = ''; return }
    if (!m.read) this.mailHandlers?.read(m.id)
    letter.innerHTML = ''
    const t = document.createElement('div'); t.className = 'lt'; t.textContent = m.title
    const body = document.createElement('div'); body.textContent = m.body
    letter.append(t, body)
    if (m.attach) {
      const a = document.createElement('div'); a.className = 'attach'
      if ('coins' in m.attach) a.innerHTML = `<i class="coin"></i><span>${m.attach.coins} 金币</span>`
      else { a.appendChild(this.icon(m.attach.item, 32)); a.insertAdjacentHTML('beforeend', `<span>${ITEMS[m.attach.item]?.name ?? m.attach.item} ×${m.attach.n}</span>`) }
      const b = document.createElement('button'); b.className = 'btn'
      b.textContent = m.taken ? '已收下' : '收下'; b.disabled = !!m.taken
      b.onclick = () => { this.mailHandlers?.take(m.id); this.audio.play('coin', 0.4) }
      a.appendChild(b)
      letter.appendChild(a)
    }
  }
  // 关系/任务/信件更新了：刷新开着的面板和追踪条
  refreshStory() {
    this.renderTracker()
    if (!$('journal').classList.contains('hidden')) this.journalTab($('journal-social').classList.contains('hidden') ? 'quests' : 'social')
    if (!$('mail').classList.contains('hidden')) this.renderMail()
  }

  // ── 家具目录：落地家具 / 地毯 / 墙饰三栏 ──
  private onBuyFurn: ((kind: string) => void) | null = null
  openCatalog(onBuy: (kind: string) => void) {
    this.onBuyFurn = onBuy
    this.renderCatalog()
    $('catalog').classList.remove('hidden')
    this.audio.play('open', 0.4)
  }
  private renderCatalog() {
    $('catalog-coins').textContent = String(state.me.coins)
    const cols = $('catalog-cols')
    cols.innerHTML = ''
    const groups: [string, string][] = [['floor', '落地家具'], ['rug', '地毯'], ['wall', '墙饰']]
    for (const [layer, title] of groups) {
      const col = document.createElement('div')
      col.innerHTML = `<div class="col-title">${title}</div>`
      for (const [k, d] of Object.entries(FURNITURE)) {
        if (d.layer !== layer) continue
        const row = document.createElement('div')
        row.className = 'catalog-row' + (state.me.coins < d.price ? ' poor' : '')
        const cell = document.createElement('div'); cell.className = 'ico-cell'; cell.appendChild(this.icon(`f_${k}`, 44))
        const name = document.createElement('span'); name.className = 'name'; name.textContent = d.name
        const price = document.createElement('span'); price.className = 'price'; price.textContent = String(d.price)
        const b = document.createElement('button'); b.className = 'btn'; b.textContent = '买'
        b.onclick = () => { if (state.me.coins < d.price) { this.audio.play('error', 0.3); return } this.onBuyFurn?.(k); this.audio.play('coin', 0.4) }
        row.append(cell, name, price, b)
        col.appendChild(row)
      }
      cols.appendChild(col)
    }
  }

  // ── 储物箱 ──
  private chestSlots: (Slot | null)[] = []
  private chestHandlers: { take: (i: number) => void, put: (i: number) => void } | null = null
  openChest(slots: (Slot | null)[], take: (i: number) => void, put: (i: number) => void) {
    this.chestHandlers = { take, put }
    this.chestSlots = slots
    this.renderChest()
    $('chest').classList.remove('hidden')
    this.audio.play('open', 0.4)
  }
  updateChest(slots: (Slot | null)[]) { this.chestSlots = slots; if (!$('chest').classList.contains('hidden')) this.renderChest() }
  private renderChest() {
    const box = $('chest-box'), inv = $('chest-inv')
    box.innerHTML = ''; inv.innerHTML = ''
    this.chestSlots.forEach((sl, i) => {
      const el = this.slotEl(sl, i)
      if (sl) el.onclick = () => { this.chestHandlers?.take(i); this.audio.play('click', 0.35) }
      box.appendChild(el)
    })
    for (let i = 0; i < INV_SIZE; i++) {
      const sl = state.me.inv[i] ?? null
      const el = this.slotEl(sl, i)
      if (sl) el.onclick = () => { this.chestHandlers?.put(i); this.audio.play('click', 0.35) }
      inv.appendChild(el)
    }
    this.tooltip.classList.add('hidden')
  }
  // 背包/金币变了：开着的目录和箱子跟着刷新
  refreshPanels() {
    this.renderTracker()
    this.refreshRestore()
    if (!$('catalog').classList.contains('hidden')) this.renderCatalog()
    if (!$('chest').classList.contains('hidden')) this.renderChest()
  }

  // ── 背包（拖拽换位） ──
  toggleInventory() {
    const el = $('inventory')
    if (el.classList.contains('hidden')) { this.renderInventory(); el.classList.remove('hidden'); this.audio.play('open', 0.4) }
    else this.closeModals()
  }

  private renderInventory() {
    const grid = $('inv-grid')
    grid.innerHTML = ''
    let dragFrom = -1
    for (let i = 0; i < INV_SIZE; i++) {
      const el = this.slotEl(state.me.inv[i] ?? null, i, i < HOTBAR ? String(i + 1) : undefined)
      el.draggable = !!state.me.inv[i]
      el.ondragstart = () => { dragFrom = i }
      el.ondragover = e => e.preventDefault()
      el.ondrop = () => { if (dragFrom >= 0 && dragFrom !== i) { this.onSwap(dragFrom, i); this.audio.play('click', 0.4) } }
      el.onclick = () => {
        if (document.body.classList.contains('touch')) {
          if (this.invPick < 0) { if (state.me.inv[i]) { this.invPick = i; el.classList.add('picked'); this.audio.play('select', 0.3) } }
          else { if (this.invPick !== i) { this.onSwap(this.invPick, i); this.audio.play('click', 0.4) } this.invPick = -1; this.renderInventory() }
        }
        if (i < HOTBAR) { state.me.selected = i; this.renderHotbar() }
      }
      if (i === this.invPick) el.classList.add('picked')
      grid.appendChild(el)
    }
  }
  private invPick = -1

  // ── 端着的菜 ──
  setHolding(h: Holding | null) {
    const el = $('holding')
    if (!h) { el.classList.add('hidden'); return }
    const d = DISHES[h.dish]
    el.innerHTML = ''
    const text = document.createElement('span')
    text.innerHTML = `端着 ${d.name}（<span class="q${h.quality}">${QUALITY_NAME[h.quality]}</span>）· 值 <b>${h.value}</b> · 走到客人跟前按 <b>E</b> 上菜，<b>Q</b> 倒掉`
    el.append(this.dishBox(h.dish, 36), text)
    el.classList.remove('hidden')
  }

  private dishBox(id: DishId, box: number) {
    const wrap = document.createElement('div')
    wrap.className = 'ico-box'
    const meta = this.assets.atlasMeta.icons
    const f = meta.frames[DISHES[id].icon]?.frame
    if (!f) return wrap
    const el = document.createElement('div')
    el.className = 'ico'
    const s = Math.max(1, Math.floor(box / Math.max(f.w, f.h)))
    el.style.width = `${f.w}px`
    el.style.height = `${f.h}px`
    el.style.background = `url(/assets/${meta.image}) -${f.x}px -${f.y}px`
    el.style.transform = `scale(${s})`
    wrap.appendChild(el)
    return wrap
  }

  // ── 做菜：先挑菜，再玩「切三刀」的时机小游戏，切得准品质高 ──
  private cookKey: ((e: KeyboardEvent) => void) | null = null
  private cookRaf = 0
  private cookTimers: number[] = []
  private dropCook() {
    if (this.cookKey) window.removeEventListener('keydown', this.cookKey, true)
    this.cookKey = null
    cancelAnimationFrame(this.cookRaf)
    for (const t of this.cookTimers) clearTimeout(t)
    this.cookTimers = []
  }
  cookingOpen() { return !$('cook').classList.contains('hidden') }

  openCooking(station: Station, orders: Map<DishId, number>, onCook: (dish: DishId, quality: number) => void) {
    this.dropCook()
    $('cook-title').textContent = station === 'fryer' ? '油锅 · 炸物' : '砧板 · 寿司与冷盘'
    $('cook-list').classList.remove('hidden')
    $('cook-game').classList.add('hidden')
    const list = $('cook-list')
    list.innerHTML = ''
    // 有客人点的菜排在最前
    const dishes = (Object.keys(DISHES) as DishId[]).filter(id => DISHES[id].station === station)
      .sort((a, b) => (orders.get(b) ?? 0) - (orders.get(a) ?? 0))
    const starts: (() => void)[] = []
    dishes.forEach((id, k) => {
      const d = DISHES[id]
      const pick = pickIngredients(state.me.inv, d)
      const needs = new Map<string, number>()
      for (const n of d.needs) {
        const key = n.item ? ITEMS[n.item].name : n.fish === 'any' ? '任意鱼' : FISH[n.fish!]?.name ?? n.fish!
        needs.set(key, (needs.get(key) ?? 0) + 1)
      }
      const wait = orders.get(id) ?? 0
      const row = document.createElement('div')
      row.className = 'cook-row' + (pick ? '' : ' off')
      const num = document.createElement('span'); num.className = 'num'; num.textContent = String(k + 1)
      row.append(num, this.dishBox(id, 56))
      row.insertAdjacentHTML('beforeend',
        `<span class="name">${d.name}</span>` +
        `<span class="need">${[...needs].map(([n, c]) => n + (c > 1 ? ' ×' + c : '')).join(' + ')}${pick ? '' : ' <span class="miss">食材不够</span>'}</span>` +
        (wait ? `<span class="wait">${wait} 位在等</span>` : '') +
        `<span class="val">${pick ? '约 ' + pick.value + ' 金' : '—'}</span>`)
      const start = () => { if (pick) { this.audio.play('click', 0.35); this.cookGame(id, onCook) } else this.audio.play('error', 0.3) }
      row.onclick = start
      starts.push(start)
      list.appendChild(row)
    })
    this.cookKey = (e: KeyboardEvent) => {
      if (!this.cookingOpen()) { this.dropCook(); return }
      const n = Number(e.key)
      if (n >= 1 && n <= starts.length) { starts[n - 1](); e.stopPropagation(); e.preventDefault() }
    }
    window.addEventListener('keydown', this.cookKey, true)
    $('cook').classList.remove('hidden')
    this.audio.play('open', 0.4)
  }

  private cookGame(id: DishId, onCook: (dish: DishId, quality: number) => void) {
    this.dropCook()
    $('cook-list').classList.add('hidden')
    $('cook-game').classList.remove('hidden')
    const d = DISHES[id]
    const title = $('cook-dish')
    title.innerHTML = ''
    title.append(this.dishBox(id, 60), document.createTextNode(d.name))
    const zone = $('cook-zone'), knife = $('cook-knife'), cuts = $('cook-cuts'), hint = $('cook-hint')
    cuts.innerHTML = ''
    const verb = d.station === 'fryer' ? '下' : '刀'
    const scores: number[] = []
    let round = 0, zc = 0.5, zw = 0.2, done = false, t0 = performance.now()
    const newZone = () => {
      zw = 0.2 - round * 0.035
      zc = 0.15 + Math.random() * 0.7
      zone.style.left = `${(zc - zw / 2) * 100}%`
      zone.style.width = `${zw * 100}%`
      zone.classList.remove('perfect')
      hint.innerHTML = (d.station === 'fryer' ? '油温到了就起锅' : '刀落在绿区里') + `（第 <b>${round + 1}</b>/3 ${verb}）· 空格 / E / 点击`
    }
    // 刀来回扫，越往后越快
    const pos = () => {
      const period = 1000 - round * 170
      const p = ((performance.now() - t0) % (period * 2)) / period
      return p < 1 ? p : 2 - p
    }
    const frame = () => { knife.style.left = `${pos() * 100}%`; this.cookRaf = requestAnimationFrame(frame) }
    const cut = () => {
      if (done) return
      const p = pos()
      const score = Math.max(0, 1 - Math.abs(p - zc) / (zw * 1.5))
      scores.push(score)
      const mark = document.createElement('div')
      mark.className = 'cut'
      mark.style.left = `${p * 100}%`
      cuts.appendChild(mark)
      this.audio.play(score > 0.7 ? 'catch' : 'till', 0.45, 0.9 + score * 0.4)
      if (score > 0.7) zone.classList.add('perfect')
      round++
      if (round < 3) { this.cookTimers.push(window.setTimeout(newZone, 200)); return }
      done = true
      const avg = scores.reduce((a, b) => a + b, 0) / scores.length
      const q = avg >= 0.7 ? 2 : avg >= 0.35 ? 1 : 0
      hint.innerHTML = `<b>${QUALITY_NAME[q]}！</b>`
      this.cookTimers.push(window.setTimeout(() => {
        this.dropCook()
        $('cook').classList.add('hidden')
        onCook(id, q)
      }, 650))
    }
    newZone()
    frame()
    this.cookKey = (e: KeyboardEvent) => {
      if (!this.cookingOpen()) { this.dropCook(); return }
      const k = e.key.toLowerCase()
      if (k === ' ' || k === 'e' || k === 'enter') { if (!e.repeat) cut(); e.preventDefault(); e.stopPropagation() }
    }
    window.addEventListener('keydown', this.cookKey, true)
    ;(zone.parentElement as HTMLElement).onpointerdown = e => { e.preventDefault(); cut() }
  }

  // ── 海底 ──
  setSeaMode(on: boolean) { $('sea-hud').classList.toggle('hidden', !on) }
  setEnergy(v: number) {
    const el = $('energy-fill')
    el.style.width = `${Math.max(0, Math.min(1, v / ENERGY_MAX)) * 100}%`
    el.classList.toggle('low', v < 40)
    $('energy').textContent = String(Math.round(v))
  }
  setBasket(n: number, cap: number) {
    const el = $('basket')
    el.textContent = `鱼篓 ${n}/${cap}`
    el.classList.toggle('full', n >= cap)
  }
  setOxygen(frac: number) {
    const el = $('o2-fill')
    el.style.height = `${Math.max(0, frac) * 100}%`
    el.classList.toggle('low', frac < 0.25)
  }
  // 受伤：屏幕四周闪一下红
  hurt() {
    const el = $('hurt')
    el.classList.remove('on'); void el.offsetWidth; el.classList.add('on')
  }
  setPressure(on: boolean) { $('depth').classList.toggle('warn', on) }
  setDepth(m: number) { $('depth').textContent = `${Math.max(0, Math.round(m))} m` }
  showZone(name: string) {
    if (name === this.lastZone) return
    this.lastZone = name
    const el = $('zone')
    el.textContent = name
    el.classList.add('show')
    setTimeout(() => el.classList.remove('show'), 2200)
  }

  fade(on: boolean) { $('fade').classList.toggle('on', on) }
  setOffline(off: boolean) { $('offline').classList.toggle('hidden', !off) }

  // ── 标题画面的字幕：第几个镜头、这里能做什么。淡入淡出由标题场景按镜头时间驱动（titleCaptionFade） ──
  titleCaption(i: number, n: number, title: string, text: string) {
    $('cap-no').textContent = `${String(i + 1).padStart(2, '0')} / ${String(n).padStart(2, '0')}`
    $('cap-title').textContent = title
    $('cap-text').textContent = text
    const dots = $('title-dots')
    if (dots.children.length !== n) { dots.innerHTML = ''; for (let k = 0; k < n; k++) dots.appendChild(document.createElement('i')) }
    ;[...dots.children].forEach((d, k) => d.classList.toggle('on', k === i))
  }

  titleCaptionFade(a: number) {
    const cap = $('title-cap')
    cap.style.opacity = a.toFixed(3)
    cap.style.transform = `translateY(${Math.round((1 - a) * 6)}px)`
  }

  // ── 登录：标题画面上的「登岛」卡片。选名字和衬衫颜色，角色站在一小块草地上原地走、每隔一会儿转个身 ──
  login(saved: { name: string, hue: number }, simple = false): Promise<{ name: string, hue: number }> {
    $('loading').classList.add('hidden')
    $('login').classList.remove('hidden')
    // 2D动森：名字和外观在机场柜台登记，标题卡片上只留「开始」
    if (simple) {
      $('login').classList.add('simple')
      $('login-go').textContent = saved.name ? '继续' : '开始'
    }
    const nameIn = $<HTMLInputElement>('login-name')
    nameIn.value = saved.name
    let hue = saved.hue
    const hues = $('login-hues')
    const preview = $<HTMLCanvasElement>('login-preview')
    const S = 4                                        // 预览放大倍率（整数，保持像素锐利）
    let frame = 0
    const dirs = ['down', 'side', 'up', 'side'] as const
    const draw = () => {
      const g = preview.getContext('2d')!
      g.imageSmoothingEnabled = false
      g.clearRect(0, 0, preview.width, preview.height)
      const px = (x: number, y: number, w: number, h: number, c: string) => { g.fillStyle = c; g.fillRect(x * S, y * S, w * S, h * S) }
      // 脚下一小块草地（美术像素坐标，画布 = 36×40 美术像素）
      const W = preview.width / S, base = 33
      px(6, base + 1, W - 12, 5, '#6b4428'); px(7, base + 5, W - 14, 1, '#4a2e1b')
      px(5, base - 2, W - 10, 4, '#5f9e3e'); px(6, base - 3, W - 12, 1, '#86c451'); px(5, base + 1, W - 10, 1, '#3f7a2e')
      for (const [x, y] of [[9, base - 3], [24, base - 3], [15, base - 2], [28, base - 2]]) px(x, y - 1, 1, 1, '#9ad45e')
      px(12, base - 1, W - 24, 1, 'rgba(20,40,20,0.45)')   // 影子
      const di = Math.floor(frame / 12) % 4, row = dirs[di]
      const t = this.assets.farmers.get(hue)?.[`walk_${row}_${frame % 4}`]
      if (!t) return
      const src = t.source.resource as HTMLCanvasElement, fr = t.frame
      const dx = Math.round((W - fr.width) / 2) * S, dy = (base - fr.height) * S
      g.save()
      if (di === 3) { g.translate(dx * 2 + fr.width * S, 0); g.scale(-1, 1) }
      g.drawImage(src, fr.x, fr.y, fr.width, fr.height, dx, dy, fr.width * S, fr.height * S)
      g.restore()
    }
    hues.innerHTML = ''
    for (const h of SHIRT_HUES) {
      const b = document.createElement('button')
      b.style.background = `hsl(${h}deg 55% 45%)`
      if (h === hue) b.classList.add('on')
      b.onclick = () => { hue = h; for (const x of hues.children) x.classList.remove('on'); b.classList.add('on'); draw() }
      hues.appendChild(b)
    }
    draw()
    const timer = window.setInterval(() => { frame++; draw() }, 140)
    if (!document.body.classList.contains('touch')) nameIn.focus()
    return new Promise(resolve => {
      const go = () => {
        clearInterval(timer)
        const name = nameIn.value.trim() || '潜水员' + Math.floor(Math.random() * 900 + 100)
        $('login').classList.add('hidden')
        $('hud').classList.remove('hidden')
        resolve({ name, hue })
      }
      $('login-go').onclick = go
      nameIn.onkeydown = e => { if (e.key === 'Enter') go() }
    })
  }


  showHud(on: boolean) { $('hud').classList.toggle('hidden', !on) }
  setLoading(p: number) { ($('loading').querySelector('.bar i') as HTMLElement).style.width = `${Math.round(p * 100)}%` }
}

// 今天是第几天（由客户端时钟推算）
function calendarOfToday() { return state.day }

// 触屏上的提示文字：把键鼠说法换成按钮说法
function touchHint(html: string) {
  return html
    .replace(/<b>左键<\/b>\s*/g, '<b>点一下</b> ')
    .replace(/\s*·\s*<b>R<\/b>\s*翻转/g, '（「翻转」按钮）')
    .replace(/<b>C<\/b>\s*家具目录/g, '「目录」按钮：家具目录')
    .replace(/\s*·\s*<b>Shift\+E<\/b>\s*收起/g, '')
    .replace(/<b>E<\/b>/g, '<b class="ka">互动</b>')
}

// 高清图集里的一帧做 CSS 背景，按 k 倍缩放（背景图整张跟着缩）
function cssSprite(el: HTMLElement, meta: { image: string, size?: { w: number, h: number } }, f: { x: number, y: number, w: number, h: number }, k: number) {
  const sw = meta.size?.w ?? 4096, sh = meta.size?.h ?? 4096
  el.style.width = `${Math.round(f.w * k)}px`
  el.style.height = `${Math.round(f.h * k)}px`
  el.style.background = `url(/assets/${meta.image}) -${f.x * k}px -${f.y * k}px / ${sw * k}px ${sh * k}px no-repeat`
}
