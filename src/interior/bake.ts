// 室内地板与墙面烘焙：和岛上地面一样逐像素画，调色板取自木屋/家具素材
import type { Texture } from 'pixi.js'
import { TILE } from '../../shared/data.ts'
import type { Room } from '../../shared/rooms.ts'
import { hash2 } from '../../shared/noise.ts'
import { canvas, texFrom } from '../core/assets.ts'

const hex = (h: number): [number, number, number] => [(h >> 16) & 255, (h >> 8) & 255, h & 255]
// 地板：原木（寿司店）/ 浅色（白墙屋、高脚屋）/ 深色胡桃木（石屋）
const FLOORS = {
  wood: [0x5a3820, 0x7a4c2c, 0x8c5a34, 0x9c683c, 0xb07a48].map(hex),
  light: [0x7a5a36, 0xa3804f, 0xb8935e, 0xc7a36c, 0xd9b982].map(hex),
  dark: [0x2e1c12, 0x4a2e1c, 0x5a3922, 0x68432a, 0x7d5334].map(hex),
}
const PLANK = [0x3e2616, 0x6b4428, 0x80522f, 0x915f37, 0xa87244].map(hex)
const WHITE = [0xb9b2a4, 0xd9d3c6, 0xe8e3d8, 0xf2eee5, 0xfbf9f3].map(hex)
const BLUE = [0x1f3a5a, 0x2d5582, 0x3b6a9c, 0x5585b8].map(hex)
const STONE = [0x3a3a40, 0x5c5c63, 0x707078, 0x83838b, 0x9a9aa2].map(hex)
const PLASTER = [0xcfbf9e, 0xdccdae, 0xe8dcc0, 0xf1e7cf].map(hex)
const BEAM = [0x2e1b10, 0x4a2e1b, 0x6b4428, 0x8a5a34, 0xa36d40].map(hex)
const PAPER = [0xd9cba5, 0xf3ead2, 0xfbf5e6].map(hex)
const MAT = [0x9c7e48, 0xc9a86a, 0xdcc080].map(hex)

export function bakeRoom(room: Room): Texture {
  const W = room.w * TILE, H = room.h * TILE, WALL = room.wallRows * TILE
  const { c, g } = canvas(W, H)
  const img = g.createImageData(W, H)
  const d = img.data
  const put = (x: number, y: number, col: [number, number, number]) => {
    if (x < 0 || y < 0 || x >= W || y >= H) return
    const i = (y * W + x) * 4
    d[i] = col[0]; d[i + 1] = col[1]; d[i + 2] = col[2]; d[i + 3] = 255
  }
  const dither = (x: number, y: number) => (((x & 3) + ((y & 3) << 2)) * 7 % 16) / 16

  // ── 地板：横向木条，每条 8 像素高，接缝错开，木纹用抖动点缀 ──
  const FLOOR = FLOORS[room.floor as keyof typeof FLOORS] ?? FLOORS.wood
  for (let y = WALL; y < H; y++) for (let x = 0; x < W; x++) {
    const row = Math.floor((y - WALL) / 8), ry = (y - WALL) % 8
    const seamX = Math.floor(hash2(row, 7, 3) * 96) + 40
    const board = Math.floor((x + (row % 2) * 48) / 96)
    const tone = hash2(board, row, 5)
    let col = FLOOR[tone < 0.3 ? 2 : tone < 0.75 ? 3 : 2]
    if (ry === 0) col = FLOOR[0]                                  // 木条之间的缝
    else if (ry === 1) col = FLOOR[4]                             // 缝下的高光
    else if ((x + (row % 2) * 48) % 96 === seamX % 96) col = FLOOR[1] // 木条接头
    else if (hash2(x >> 2, y, 9) < 0.08 && dither(x, y) < 0.5) col = FLOOR[1] // 木纹
    put(x, y, col)
  }
  // 墙脚投影：墙下 5 像素地板压暗
  for (let y = WALL; y < WALL + 5; y++) for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 4, k = 0.55 + (y - WALL) * 0.09
    d[i] *= k; d[i + 1] *= k; d[i + 2] *= k
  }

  // ── 后墙：顶梁 → 灰泥墙面（竖向木柱、两扇和纸拉窗）→ 木护墙板 ──
  const wainscot = WALL - 22
  for (let y = 0; y < WALL; y++) for (let x = 0; x < W; x++) {
    let col: [number, number, number]
    if (y < 5) col = BEAM[y < 2 ? 0 : y < 4 ? 1 : 3]
    else if (y >= wainscot) {
      const py = y - wainscot
      col = py === 0 ? BEAM[4] : py === 1 ? BEAM[2] : py > 19 ? BEAM[0] : ((x % 24) === 0 ? BEAM[0] : ((x % 24) === 1 ? BEAM[3] : BEAM[1]))
    } else {
      const n = hash2(x >> 1, y >> 1, 11)
      col = PLASTER[n < 0.15 ? 1 : n > 0.9 ? 3 : 2]
      if (y === wainscot - 1) col = PLASTER[0]
    }
    put(x, y, col)
  }
  // 小屋的墙面换材质：原木板墙 / 白灰泥墙 + 蓝色护墙板 / 石砖墙（顶梁保留）
  if (room.wall !== 'washi') for (let y = 5; y < WALL; y++) for (let x = 0; x < W; x++) {
    let col: [number, number, number]
    const low = y >= wainscot
    if (room.wall === 'plank') {
      // 横向原木板：每条 9 像素，上沿高光、下沿缝，接头错开；护墙板部分竖向
      if (low) { const py = y - wainscot; col = py === 0 ? PLANK[4] : py > 19 ? PLANK[0] : (x % 12 === 0 ? PLANK[0] : PLANK[1]) }
      else {
        const row = Math.floor((y - 5) / 9), ry = (y - 5) % 9
        const seam = (x + row * 37) % 88 === 0
        const tone = hash2(Math.floor((x + row * 37) / 88), row, 3)
        col = ry === 8 || seam ? PLANK[0] : ry === 0 ? PLANK[4] : PLANK[tone < 0.4 ? 2 : 3]
        if (ry > 1 && ry < 8 && hash2(x >> 2, y, 7) < 0.05) col = PLANK[1]
      }
    } else if (room.wall === 'plaster') {
      if (low) { const py = y - wainscot; col = py === 0 ? BLUE[3] : py === 1 ? BLUE[2] : py > 19 ? BLUE[0] : (x % 16 === 0 ? BLUE[0] : BLUE[1]) }
      else { const n = hash2(x >> 1, y >> 1, 11); col = WHITE[n < 0.12 ? 1 : n > 0.92 ? 4 : 2]; if (y === wainscot - 1) col = WHITE[0] }
    } else {
      // 石砖：16×8 错缝，灰浆缝深色，每块砖明暗不同
      if (low) { const py = y - wainscot; col = py === 0 ? BEAM[4] : py === 1 ? BEAM[2] : py > 19 ? BEAM[0] : BEAM[1] }
      else {
        const row = Math.floor((y - 5) / 8), ry = (y - 5) % 8
        const bx = x + (row % 2) * 8, bi = Math.floor(bx / 16)
        const tone = hash2(bi, row, 21)
        col = ry === 7 || bx % 16 === 15 ? STONE[0] : ry === 0 ? STONE[4] : STONE[tone < 0.3 ? 1 : tone < 0.75 ? 2 : 3]
      }
    }
    put(x, y, col)
  }
  // 木柱：每 72 像素一根（只有寿司店的灰泥和纸墙有）
  if (room.wall === 'washi') for (let px0 = 0; px0 < W; px0 += 72) for (let y = 5; y < wainscot; y++) for (let k = 0; k < 6; k++) {
    put(px0 + k, y, BEAM[k === 0 ? 0 : k === 1 ? 3 : k === 5 ? 0 : 2])
  }
  // 和纸拉窗：避开墙上挂的东西（小屋的窗户是可以摆的家具，这里不画）
  const windows = room.wall !== 'washi' ? [] : room.objects.some(o => o.wall && o.kind === 'menu_board') ? [[150, 190], [242, 282]] : [[W / 2 - 40, W / 2 + 40]]
  for (const [x0, x1] of windows) {
    const y0 = 16, y1 = wainscot - 8
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const edge = x === x0 || x === x1 || y === y0 || y === y1
      const lattice = (x - x0) % 10 === 0 || (y - y0) % 12 === 0
      put(x, y, edge ? BEAM[0] : lattice ? BEAM[2] : PAPER[(y - y0) < 3 ? 0 : hash2(x, y, 13) < 0.1 ? 2 : 1])
    }
    for (let x = x0 - 2; x <= x1 + 2; x++) { put(x, y1 + 1, BEAM[3]); put(x, y1 + 2, BEAM[1]) } // 窗台
  }

  // ── 左右墙：3/4 视角下看到的是墙顶，画成深色木框 ──
  for (let y = 0; y < H; y++) for (let x = 0; x < TILE; x++) {
    const inner = TILE - 1 - x
    const col = inner === 0 ? BEAM[3] : inner === 1 ? BEAM[1] : BEAM[0]
    put(x, y, col); put(W - 1 - x, y, col)
  }
  // ── 下沿墙：一道深色木框，门口留空；门口铺一块草席 ──
  const dx0 = room.door.x - 22, dx1 = room.door.x + 22
  for (let y = H - 6; y < H; y++) for (let x = 0; x < W; x++) {
    if (x >= dx0 && x < dx1) continue
    put(x, y, y === H - 6 ? BEAM[3] : BEAM[0])
  }
  for (let y = H - 22; y < H - 2; y++) for (let x = dx0 + 4; x < dx1 - 4; x++) {
    const edge = y === H - 22 || y === H - 3 || x === dx0 + 4 || x === dx1 - 5
    put(x, y, edge ? MAT[0] : ((y - (H - 22)) % 3 === 0 ? MAT[0] : MAT[hash2(x, y, 17) < 0.2 ? 2 : 1]))
  }
  g.putImageData(img, 0, 0)
  return texFrom(c)
}
