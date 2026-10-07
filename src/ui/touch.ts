// 触屏操作（手机 / 平板）：
// - 左下角浮动摇杆：手指按在左下区域哪里，摇杆就出现在哪里
// - 右下角两个大按钮：「互动」（= E，按钮上写着当前能做的事）、「使用 / 射击」（= 空格）
// - 左上角一排小按钮：背包、任务、聊天、全屏
// - 场景相关的按钮由场景的 touchButtons() 提供（小屋里的目录 / 翻转、寿司店里丢掉手上的菜）
// 画布上的点击、捏合缩放在 Input 里处理。
import type { Input } from '../core/input.ts'
import type { Hud } from './hud.ts'
import type { Game } from '../game.ts'

export interface TouchButton { label: string, key: string }

// 主要指针是手指就算触屏设备；网址带 ?touch 可以在电脑上强制打开（调试用）
export function isTouchDevice() {
  return new URLSearchParams(location.search).has('touch') || matchMedia('(pointer: coarse)').matches
}

const R = 46            // 摇杆能推多远（CSS 像素）
const DEAD = 0.18       // 死区

export class TouchControls {
  private root = document.createElement('div')
  private zone = document.createElement('div')
  private base = document.createElement('div')
  private knob = document.createElement('div')
  private act = document.createElement('button')
  private use = document.createElement('button')
  private extra = document.createElement('div')
  private stickId = -1
  private ox = 0
  private oy = 0
  private extraSig = ''

  constructor(private input: Input, private hud: Hud, private game: Game) {
    document.body.classList.add('touch')
    input.touch = true
    const r = this.root
    r.id = 'touch'
    this.zone.className = 'stick-zone'
    this.base.className = 'stick-base'
    this.knob.className = 'stick-knob'
    this.base.appendChild(this.knob)
    this.zone.appendChild(this.base)
    this.act.className = 'tb tb-act'
    this.use.className = 'tb tb-use'
    this.extra.className = 'tb-extra'
    const top = document.createElement('div')
    top.className = 'tb-top'
    const small = (label: string, fn: () => void) => {
      const b = document.createElement('button'); b.className = 'tb-s'; b.textContent = label
      b.addEventListener('pointerdown', e => { e.preventDefault(); e.stopPropagation(); fn() })
      top.appendChild(b)
      return b
    }
    small('背包', () => { if (!this.busy()) hud.toggleInventory(); else hud.closeModals() })
    small('任务', () => { if (!this.busy()) hud.openJournal(); else hud.closeModals() })
    small('聊天', () => hud.openChat())
    const canFull = !!document.documentElement.requestFullscreen
    if (canFull) small('全屏', () => this.toggleFullscreen())
    r.append(this.zone, this.use, this.act, this.extra, top)
    document.getElementById('hud')!.appendChild(r)

    // 摇杆
    this.zone.addEventListener('pointerdown', e => {
      if (this.stickId >= 0) return
      e.preventDefault()
      this.stickId = e.pointerId
      try { this.zone.setPointerCapture(e.pointerId) } catch { /* 合成事件没有真实指针 */ }
      const zr = this.zone.getBoundingClientRect()
      this.ox = e.clientX; this.oy = e.clientY
      this.base.style.left = `${e.clientX - zr.left}px`
      this.base.style.top = `${e.clientY - zr.top}px`
      this.base.classList.add('on')
      this.move(e.clientX, e.clientY)
    })
    this.zone.addEventListener('pointermove', e => { if (e.pointerId === this.stickId) this.move(e.clientX, e.clientY) })
    const end = (e: PointerEvent) => {
      if (e.pointerId !== this.stickId) return
      this.stickId = -1
      input.stick.x = input.stick.y = 0
      this.knob.style.transform = ''
      this.base.classList.remove('on')
      this.base.style.left = ''; this.base.style.top = ''
    }
    this.zone.addEventListener('pointerup', end)
    this.zone.addEventListener('pointercancel', end)

    // 按钮：按下就触发（不等松手，手感更跟手）
    const tap = (el: HTMLElement, key: string) => el.addEventListener('pointerdown', e => { e.preventDefault(); e.stopPropagation(); input.press(key); el.classList.add('down') })
    for (const el of [this.act, this.use]) {
      el.addEventListener('pointerup', () => el.classList.remove('down'))
      el.addEventListener('pointercancel', () => el.classList.remove('down'))
    }
    tap(this.act, 'e')
    tap(this.use, ' ')
    // 提示条本身也能点（= 互动）
    document.getElementById('hint')!.addEventListener('pointerdown', e => { e.preventDefault(); input.press('e') })
    hud.onHint = html => this.setAct(html)

    setInterval(() => this.refresh(), 120)
    this.refresh()
  }

  private busy() { return this.hud.modalOpen() }

  private move(x: number, y: number) {
    let dx = x - this.ox, dy = y - this.oy
    const d = Math.hypot(dx, dy)
    if (d > R) { dx *= R / d; dy *= R / d }
    this.knob.style.transform = `translate(${dx}px, ${dy}px)`
    const m = Math.min(1, d / R)
    if (m < DEAD) { this.input.stick.x = this.input.stick.y = 0; return }
    this.input.stick.x = dx / R
    this.input.stick.y = dy / R
  }

  // 互动按钮上写当前能做的事（提示里带「互动」标记的那一段，hud 已经把 <b>E</b> 换成了它），没有就灰掉
  private setAct(html: string | null) {
    const m = html?.match(/<b class="ka">互动<\/b>\s*([^·<（(]*)/)
    const label = m?.[1]?.trim()
    this.act.textContent = label ? (label.length > 7 ? label.slice(0, 7) + '…' : label) : '互动'
    this.act.classList.toggle('off', !label)
  }

  // 按场景换「使用」按钮的字、场景自己的按钮；有面板或剧情时把摇杆和按钮收起来
  private refresh() {
    const sc = this.game.scene as ({ cutscene?: unknown, touchButtons?: () => TouchButton[] } | null)
    const id = this.game.sceneId
    const hide = this.hud.modalOpen() || !!sc?.cutscene || this.game.switching
    this.root.classList.toggle('hide', hide)
    if (hide && this.stickId >= 0) { this.stickId = -1; this.input.stick.x = this.input.stick.y = 0; this.knob.style.transform = ''; this.base.classList.remove('on') }
    const useLabel = id === 'sea' ? '射击' : id === 'island' || id.startsWith('map:') ? '使用' : ''
    this.use.textContent = useLabel
    this.use.classList.toggle('gone', !useLabel)
    const btns = sc?.touchButtons?.() ?? []
    const sig = btns.map(b => b.label + b.key).join('|')
    if (sig !== this.extraSig) {
      this.extraSig = sig
      this.extra.innerHTML = ''
      for (const b of btns) {
        const el = document.createElement('button'); el.className = 'tb-s'; el.textContent = b.label
        el.addEventListener('pointerdown', e => { e.preventDefault(); e.stopPropagation(); this.input.press(b.key) })
        this.extra.appendChild(el)
      }
    }
  }

  private async toggleFullscreen() {
    try {
      if (document.fullscreenElement) { await document.exitFullscreen(); return }
      await document.documentElement.requestFullscreen({ navigationUI: 'hide' })
      await (screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> }).lock?.('landscape').catch(() => {})
    } catch { /* 有的浏览器不让全屏，忽略 */ }
  }
}
