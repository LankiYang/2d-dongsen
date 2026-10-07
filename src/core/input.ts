// 键鼠 + 触屏输入状态。聊天输入框获得焦点时游戏按键全部失效。
// 触屏：虚拟摇杆写进 stick（叠加到 axis），屏幕按钮用 press() 模拟按键；
// 手指点画布算一次点击，点的位置只在手指按着的时候当瞄准点（松手后 aimValid = false，场景改用面朝的方向）；双指捏合算滚轮缩放。
export class Input {
  keys = new Set<string>()
  pressed = new Set<string>()   // 本帧刚按下
  mouseX = 0
  mouseY = 0
  mouseDown = false
  clicked = false
  wheel = 0
  typing = () => false
  touch = false                 // 触屏模式（手机 / 平板）
  stick = { x: 0, y: 0 }        // 虚拟摇杆，-1 ~ 1
  aimValid = true               // 鼠标一直算；触屏只在手指按着（和点下去那一帧）算
  private touches = new Map<number, { x: number, y: number }>()
  private pinch = 0
  private releaseAim = false

  constructor(target: HTMLElement) {
    window.addEventListener('keydown', e => {
      if (this.typing()) return
      const k = e.key.toLowerCase()
      if (!this.keys.has(k)) this.pressed.add(k)
      this.keys.add(k)
      if ([' ', 'tab', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(k)) e.preventDefault()
    })
    window.addEventListener('keyup', e => this.keys.delete(e.key.toLowerCase()))
    window.addEventListener('blur', () => { this.keys.clear(); this.stick.x = this.stick.y = 0 })
    // 换算成画布像素：按画布在屏幕上的实际位置和大小算（页面被缩放时 offsetX 会不准）
    const pos = (e: PointerEvent) => {
      const r = target.getBoundingClientRect(), c = target as HTMLCanvasElement
      this.mouseX = ((e.clientX - r.left) / r.width) * (c.width || r.width * devicePixelRatio)
      this.mouseY = ((e.clientY - r.top) / r.height) * (c.height || r.height * devicePixelRatio)
    }
    target.addEventListener('pointerdown', e => {
      if (e.pointerType === 'mouse') {
        if (e.button !== 0) return
        pos(e); this.mouseDown = true; this.clicked = true; this.aimValid = true
        return
      }
      this.touches.set(e.pointerId, { x: e.clientX, y: e.clientY })
      try { target.setPointerCapture(e.pointerId) } catch { /* 合成事件没有真实指针 */ }
      if (this.touches.size === 1) { pos(e); this.mouseDown = true; this.clicked = true; this.aimValid = true; this.releaseAim = false }
      else { this.mouseDown = false; this.clicked = false; this.pinch = this.pinchDist() }   // 第二根手指：开始捏合，不算点击
    })
    target.addEventListener('pointermove', e => {
      if (e.pointerType === 'mouse') { pos(e); return }
      if (!this.touches.has(e.pointerId)) return
      this.touches.set(e.pointerId, { x: e.clientX, y: e.clientY })
      if (this.touches.size === 1) { pos(e); return }
      const d = this.pinchDist()
      if (Math.abs(d - this.pinch) > 45) { this.wheel += d > this.pinch ? -1 : 1; this.pinch = d }   // 张开 = 放大
    })
    const up = (e: PointerEvent) => {
      if (e.pointerType === 'mouse') { if (e.button === 0) this.mouseDown = false; return }
      if (!this.touches.delete(e.pointerId)) return
      if (!this.touches.size) { this.mouseDown = false; this.releaseAim = true }
    }
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', up)
    target.addEventListener('wheel', e => { this.wheel += Math.sign(e.deltaY); e.preventDefault() }, { passive: false })
    target.addEventListener('contextmenu', e => e.preventDefault())
  }

  private pinchDist() {
    const [a, b] = [...this.touches.values()]
    return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0
  }

  // 屏幕按钮：模拟按一下键
  press(k: string) { this.pressed.add(k) }
  down(...ks: string[]) { return !this.typing() && ks.some(k => this.keys.has(k)) }
  hit(...ks: string[]) { return !this.typing() && ks.some(k => this.pressed.has(k)) }
  axis() {
    let x = 0, y = 0
    if (this.down('a', 'arrowleft')) x -= 1
    if (this.down('d', 'arrowright')) x += 1
    if (this.down('w', 'arrowup')) y -= 1
    if (this.down('s', 'arrowdown')) y += 1
    if (!this.typing() && (this.stick.x || this.stick.y)) { x += this.stick.x; y += this.stick.y }
    return { x, y }
  }
  endFrame() {
    this.pressed.clear(); this.clicked = false; this.wheel = 0
    if (this.releaseAim) { this.aimValid = false; this.releaseAim = false }
  }
}

// 摇杆方向换算成角色朝向：看哪个轴更大（摇杆几乎不会正好是 0）
export const dirOf = (ax: { x: number, y: number }): 'left' | 'right' | 'up' | 'down' =>
  Math.abs(ax.x) >= Math.abs(ax.y) ? (ax.x < 0 ? 'left' : 'right') : (ax.y < 0 ? 'up' : 'down')
