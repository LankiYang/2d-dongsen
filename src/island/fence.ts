// 程序绘制的木篱笆：和栈桥同一套木色调色板，按四邻接自动连接。
// 纹理 24×32，地面线在 y=29（精灵锚点），木桩高出地面约 20 像素，横档向相邻篱笆延伸。
import type { Texture } from 'pixi.js'
import { canvas, texFrom } from '../core/assets.ts'

const WOOD = ['#4a2e1b', '#6b4428', '#8a5a34', '#a36d40', '#bd8552', '#d49c63']
const W = 24, H = 32, GROUND = 29

const cache = new Map<string, Texture>()

// mask：上1 右2 下4 左8；gate：这一根挨着门，画成更高、带顶饰的门柱
export function fenceTexture(mask: number, gate: boolean, style: 'rustic' | 'picket' = 'rustic'): Texture {
  const key = `${mask}:${gate}:${style}`
  const hit = cache.get(key)
  if (hit) return hit
  const { c, g } = canvas(W, H)
  const px = (x: number, y: number, col: string) => { g.fillStyle = col; g.fillRect(x, y, 1, 1) }
  const rect = (x: number, y: number, w: number, h: number, col: string) => { g.fillStyle = col; g.fillRect(x, y, w, h) }

  if (style === 'picket') { drawPicket(g, mask, gate); const t = texFrom(c); cache.set(key, t); return t }

  // 地面投影
  g.fillStyle = 'rgba(20,24,40,0.28)'
  for (let x = 6; x <= 17; x++) for (let y = GROUND - 1; y <= GROUND + 1; y++) {
    const nx = (x - 11.5) / 6, ny = (y - GROUND) / 1.6
    if (nx * nx + ny * ny <= 1) g.fillRect(x, y, 1, 1)
  }
  if (mask & 2) rect(14, GROUND, 10, 1, 'rgba(20,24,40,0.2)')
  if (mask & 8) rect(0, GROUND, 10, 1, 'rgba(20,24,40,0.2)')

  // 横档：上下两根，顶面高光 / 中间 / 底边暗
  const rail = (x0: number, x1: number) => {
    for (const ry of [GROUND - 17, GROUND - 9]) {
      rect(x0, ry, x1 - x0, 1, WOOD[5])
      rect(x0, ry + 1, x1 - x0, 1, WOOD[3])
      rect(x0, ry + 2, x1 - x0, 1, WOOD[0])
      // 木纹：零星暗点
      for (let x = x0; x < x1; x++) if ((x * 7 + ry) % 11 === 0) px(x, ry + 1, WOOD[2])
    }
  }
  if (mask & 8) rail(0, 10)
  if (mask & 2) rail(14, 24)
  // 竖向连接：3/4 视角下上方那根木桩就在头顶，补一段立柱把两根桩连成一线
  if (mask & 1) { rect(10, 0, 4, GROUND - 20, WOOD[2]); rect(10, 0, 1, GROUND - 20, WOOD[4]); rect(13, 0, 1, GROUND - 20, WOOD[1]); rect(9, 0, 1, GROUND - 20, WOOD[0]); rect(14, 0, 1, GROUND - 20, WOOD[0]) }

  // 木桩
  const top = gate ? GROUND - 25 : GROUND - 20
  rect(9, top, 6, GROUND - top + 1, WOOD[0])            // 描边
  rect(10, top + 1, 1, GROUND - top - 1, WOOD[4])       // 左侧受光
  rect(11, top + 1, 2, GROUND - top - 1, WOOD[3])
  rect(13, top + 1, 1, GROUND - top - 1, WOOD[1])       // 右侧背光
  rect(10, top + 1, 4, 1, WOOD[5])                      // 桩顶
  for (let y = top + 4; y < GROUND; y += 5) px(12, y, WOOD[2]) // 木纹
  rect(10, GROUND - 1, 4, 1, WOOD[1])                   // 入土处发暗
  if (gate) {
    // 门柱顶饰：一圈加宽的桩帽
    rect(8, top - 2, 8, 3, WOOD[0])
    rect(9, top - 1, 6, 1, WOOD[5])
    rect(9, top, 6, 1, WOOD[3])
  }
  const t = texFrom(c)
  cache.set(key, t)
  return t
}

export const FENCE_ANCHOR_Y = GROUND / H

// 白色尖木栅栏（村里的小院）：一排刷白漆的尖头板条，后面两道横档
const PAINT = ['#4d5263', '#9aa1b3', '#cfd4de', '#eef1f5', '#ffffff']
function drawPicket(g: CanvasRenderingContext2D, mask: number, gate: boolean) {
  const r = (x: number, y: number, w: number, h: number, col: string) => { g.fillStyle = col; g.fillRect(x, y, w, h) }
  g.fillStyle = 'rgba(20,24,40,0.22)'
  g.fillRect(mask & 8 ? 0 : 8, GROUND, (mask & 2 ? 24 : 16) - (mask & 8 ? 0 : 8), 1)
  const horiz = (mask & 2) || (mask & 8)
  const x0 = mask & 8 ? 0 : 9, x1 = mask & 2 ? 24 : 15
  // 横档（只有左右连着别的栅栏才画）
  if (horiz) for (const ry of [GROUND - 11, GROUND - 5]) { r(x0, ry, x1 - x0, 2, PAINT[2]); r(x0, ry + 2, x1 - x0, 1, PAINT[0]) }
  // 板条：每 6 像素一根，3 像素宽，尖头
  const picket = (px: number, h: number) => {
    const top = GROUND - h
    r(px - 1, top + 1, 5, h, PAINT[0])
    r(px, top + 2, 3, h - 2, PAINT[3]); r(px, top + 2, 1, h - 2, PAINT[4]); r(px + 2, top + 2, 1, h - 2, PAINT[1])
    r(px + 1, top, 1, 1, PAINT[0]); r(px, top + 1, 3, 1, PAINT[0]); r(px + 1, top + 1, 1, 1, PAINT[4])
    r(px, GROUND - 1, 3, 1, PAINT[1])
  }
  if (horiz) {
    for (let px = 1; px < 24; px += 6) {
      if (px + 3 <= x0 || px >= x1) continue
      picket(px, px === 13 || px === 7 ? 15 : 14)
    }
  }
  // 竖向那一段：3/4 视角下是一列柱子，用一根细立杆把上下连起来
  if (mask & 1) { r(10, 0, 3, GROUND - 13, PAINT[0]); r(11, 0, 1, GROUND - 13, PAINT[3]) }
  if (!horiz || mask & 1 || mask & 4) picket(10, 16)
  if (gate) { picket(10, 19); r(9, GROUND - 21, 5, 2, PAINT[0]); r(10, GROUND - 20, 3, 1, PAINT[4]) }
}
