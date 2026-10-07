// 区块地面烘焙（纯函数，不依赖 Pixi：客户端转成纹理，预览工具直接写 PNG）。
// 在 3 像素网格上取样连续场、逐像素双线性插值后判地形，再按地形的画法 + 手调调色板 + 有序抖动逐像素上色。
// 输出：ground（陆地 RGBA，水面透明）和 water（水面数据：R = 离岸距离 ×4，G = 深度，给水面着色器用）。
import { TILE } from '../data.ts'
import { fbm, hash2, valueNoise } from '../noise.ts'
import { CHUNK, TERRAIN, TID } from './defs.ts'
import { F } from './gen.ts'
import type { World } from './gen.ts'

export interface ChunkBake { size: number, ground: Uint8ClampedArray, water: Uint8ClampedArray }

const hex = (h: number): [number, number, number] => [(h >> 16) & 255, (h >> 8) & 255, h & 255]
const PAL = TERRAIN.map(t => t.pal.map(hex))
const FLOWERS = TERRAIN.map(t => (t.flowers ?? []).map(hex))
const RAISED = TERRAIN.map(t => !!t.raised)
const WATER = TERRAIN.map(t => !!t.water)
const STYLE = TERRAIN.map(t => t.style)
const WOOD = PAL[TID.bridge]
const M = 64 // 外扩边距：水面离岸距离、唇边投影都要看到区块外面

export function bakeChunk(world: World, cx: number, cy: number): ChunkBake {
  const P = CHUNK * TILE, R = P + M * 2
  const X0 = cx * P - M, Y0 = cy * P - M          // 区域左上角（世界像素）
  const mapW = world.def.w * TILE, mapH = world.def.h * TILE

  // ── 1. 3 像素网格取样 ──
  const S = 3, gw = Math.ceil(R / S) + 2, gh = gw
  const grid = new Float32Array(gw * gh * F.N)
  const v = new Float32Array(F.N)
  for (let gy = 0; gy < gh; gy++) for (let gx = 0; gx < gw; gx++) {
    world.sample((X0 + gx * S) / TILE, (Y0 + gy * S) / TILE, v)
    grid.set(v, (gy * gw + gx) * F.N)
  }
  const types = new Uint8Array(R * R)
  const landAt = new Float32Array(R * R)
  for (let y = 0; y < R; y++) for (let x = 0; x < R; x++) {
    const wx = X0 + x, wy = Y0 + y
    const i = y * R + x
    if (wx < 0 || wy < 0 || wx >= mapW || wy >= mapH) { types[i] = world.def.kind === 'cave' ? TID.cavewall : TID.deep; landAt[i] = -1; continue }
    const fx = (x + 0.5) / S, fy = (y + 0.5) / S, x0 = Math.floor(fx), y0 = Math.floor(fy), tx = fx - x0, ty = fy - y0
    const a = (y0 * gw + x0) * F.N, b = a + F.N, c = a + gw * F.N, d = c + F.N
    for (let k = 0; k < F.N; k++) v[k] = (grid[a + k] * (1 - tx) + grid[b + k] * tx) * (1 - ty) + (grid[c + k] * (1 - tx) + grid[d + k] * tx) * ty
    types[i] = world.classifyV(v, valueNoise(wx / 3, wy / 3, 9) - 0.5)
    landAt[i] = v[F.LAND]
  }
  const T = (x: number, y: number) => (x < 0 || y < 0 || x >= R || y >= R) ? TID.deep : types[y * R + x]

  // ── 2. 上色（只画中间 P×P） ──
  const g = new Uint8ClampedArray(P * P * 4)
  const put = (x: number, y: number, col: [number, number, number], a = 255) => {
    const o = ((y - M) * P + x - M) * 4
    g[o] = col[0]; g[o + 1] = col[1]; g[o + 2] = col[2]; g[o + 3] = a
  }
  for (let y = M; y < M + P; y++) for (let x = M; x < M + P; x++) {
    const t = types[y * R + x]
    if (WATER[t]) continue
    const wx = X0 + x, wy = Y0 + y
    const pal = PAL[t], st = STYLE[t]
    const h = hash2(wx, wy, 5)
    const dth = (((wx & 3) + ((wy & 3) << 2)) * 7 % 16) / 16
    if (st === 'grass') {
      const n = fbm(wx / 46, wy / 46, 13), n2 = valueNoise(wx / 9, wy / 9, 17)
      const k = n * 1.15 + (n2 - 0.5) * 0.35
      const ci = k < 0.42 ? 1 : k < 0.5 ? (dth < (k - 0.42) / 0.08 ? 2 : 1) : k < 0.66 ? 2 : k < 0.72 ? (dth < (k - 0.66) / 0.06 ? 3 : 2) : 3
      put(x, y, pal[ci])
      const tcx = Math.floor(wx / 7), tcy = Math.floor(wy / 6), ch = hash2(tcx, tcy, 21)
      if (ch < (TERRAIN[t].tufts ?? 0.4)) {
        const ox = tcx * 7 + Math.floor(hash2(tcx, tcy, 22) * 5), oy = tcy * 6 + 2 + Math.floor(hash2(tcx, tcy, 23) * 3)
        if ((wx === ox && wy === oy) || (wx === ox + 1 && wy === oy - 1) || (wx === ox + 2 && wy === oy)) put(x, y, pal[Math.max(0, ci - 2)])
        if (wx === ox + 1 && wy === oy && ch < 0.2) put(x, y, pal[Math.min(4, ci + 1)])
      }
      const fl = FLOWERS[t]
      if (fl.length && h < 0.0035) put(x, y, fl[Math.floor(hash2(wx, wy, 6) * fl.length)])
    } else if (st === 'wall') {
      // 岩壁顶面：统一的暗色 + 零星碎石点，侧面在下面单独画
      put(x, y, pal[h < 0.04 ? 1 : h > 0.985 ? 2 : 0])
    } else if (st === 'speckle') {
      const n = fbm(wx / 30, wy / 30, 31)
      let ci = n < 0.45 ? 2 : n < 0.52 ? (dth < (n - 0.45) / 0.07 ? 3 : 2) : 3
      const land = landAt[y * R + x]
      if (st === 'speckle' && land < 0.028 && near(T, x, y, 6, tt => WATER[tt])) ci = land < 0.012 ? 0 : 1 // 湿沙带
      put(x, y, pal[ci])
      if (h < 0.02) put(x, y, pal[Math.max(0, ci - 1)])
      else if (h > 0.985) put(x, y, pal[4])
    } else if (st === 'path') {
      const n = fbm(wx / 20, wy / 20, 41)
      put(x, y, pal[n < 0.5 ? 2 : n < 0.56 ? (dth < (n - 0.5) / 0.06 ? 3 : 2) : 3])
      const pcx = Math.floor(wx / 5), pcy = Math.floor(wy / 5)
      if (hash2(pcx, pcy, 42) < 0.18) {
        const ox = pcx * 5 + 1 + Math.floor(hash2(pcx, pcy, 43) * 2), oy = pcy * 5 + 1 + Math.floor(hash2(pcx, pcy, 44) * 2)
        if (wy === oy && (wx === ox || wx === ox + 1)) put(x, y, pal[4])
        if (wy === oy + 1 && (wx === ox || wx === ox + 1)) put(x, y, pal[0])
      }
    } else if (st === 'wood') {
      const board = Math.floor(wx / 6), bx = ((wx % 6) + 6) % 6, bh = hash2(board, 0, 61)
      let col = pal[bh < 0.35 ? 2 : bh < 0.8 ? 3 : 2]
      if (bx === 5) col = pal[0]; else if (bx === 0) col = pal[4]; else if (hash2(wx, wy, 62) < 0.05) col = pal[1]
      // 桥两侧的扶手：上下方不是桥就画深色边
      if (T(x, y - 2) !== TID.bridge || T(x, y + 2) !== TID.bridge) col = pal[T(x, y - 1) !== TID.bridge ? 4 : 0]
      put(x, y, col)
    } else if (st === 'ice') {
      const n = fbm(wx / 25, wy / 25, 71)
      let ci = n < 0.48 ? 2 : n < 0.54 ? (dth < (n - 0.48) / 0.06 ? 3 : 2) : 3
      if (Math.abs(valueNoise(wx / 14, wy / 14, 72) - 0.5) < 0.02) ci = 1           // 冰裂纹
      if (((wx + wy) % 29 < 2) && hash2(Math.floor((wx - wy) / 29), 0, 73) < 0.4) ci = 4 // 斜向反光
      if (near(T, x, y, 1, tt => tt !== TID.ice)) ci = 1
      put(x, y, pal[ci])
    } else if (st === 'lava') {
      const n = fbm(wx / 14, wy / 14, 81)
      let ci = n < 0.42 ? 1 : n < 0.52 ? 2 : n < 0.62 ? 3 : 4
      if (near(T, x, y, 2, tt => tt !== TID.lava)) ci = 0                           // 冷却的硬壳
      put(x, y, pal[ci])
    }
  }

  // ── 3. 高地边缘：下沿深色唇边 + 上沿高光；岩壁有 8 像素高的侧面 ──
  for (let y = M; y < M + P; y++) for (let x = M; x < M + P; x++) {
    const t = types[y * R + x]
    if (!RAISED[t]) continue
    const pal = PAL[t]
    if (STYLE[t] === 'wall') {
      const FACE = 22
      let face = -1
      for (let k = 1; k <= FACE; k++) if (!RAISED[T(x, y + k)]) { face = k; break }
      if (face > 0) {
        // 崖壁侧面（离底边 face 像素）：顶上一道亮边，往下是带竖向裂纹的岩面，底部压暗
        const wx = X0 + x
        const crack = hash2(wx >> 1, Math.floor((Y0 + y) / 5), 91) < 0.18 || hash2(wx, 0, 92) < 0.08
        const band = Math.floor((Y0 + y + (hash2(wx >> 2, 0, 93) * 3 | 0)) / 4) % 2
        let ci = face >= FACE - 1 ? 4 : face <= 2 ? 0 : face <= 6 ? 1 : face >= FACE - 4 ? 3 : 2 + band
        if (crack && face > 2 && face < FACE) ci = 1
        put(x, y, pal[Math.min(4, ci)])
      } else if (!RAISED[T(x, y - 1)]) put(x, y, pal[3])
      continue
    }
    const b1 = T(x, y + 1), b2 = T(x, y + 2)
    if (!RAISED[b1]) put(x, y, pal[0])
    else if (!RAISED[b2]) put(x, y, pal[1])
    else if (!RAISED[T(x, y - 1)]) put(x, y, pal[4])
    else if (!RAISED[T(x - 1, y)] || !RAISED[T(x + 1, y)]) put(x, y, pal[1])
  }
  // 高地往下投 2~3 像素阴影
  for (let y = M; y < M + P; y++) for (let x = M; x < M + P; x++) {
    const t = types[y * R + x]
    if (RAISED[t] || WATER[t]) continue
    const deep = STYLE[T(x, y - 1)] === 'wall' || STYLE[T(x, y - 3)] === 'wall'
    if (RAISED[T(x, y - 1)] || RAISED[T(x, y - 2)] || deep) {
      const o = ((y - M) * P + x - M) * 4, k = deep ? 0.6 : 0.78
      g[o] *= k; g[o + 1] *= k * 0.98; g[o + 2] *= k * 1.02
    }
  }
  // 桥的侧面和桩子（画在桥下方的水面上）
  for (let y = M; y < M + P; y++) for (let x = M; x < M + P; x++) {
    if (!WATER[types[y * R + x]]) continue
    let up = 0
    for (let k = 1; k <= 11; k++) if (T(x, y - k) === TID.bridge) { up = k; break }
    if (!up) continue
    if (up <= 3) put(x, y, WOOD[up === 1 ? 1 : 0])
    else {
      const post = ((X0 + x) % 48 + 48) % 48
      if (post >= 3 && post < 8 && up <= 10) put(x, y, WOOD[post === 3 ? 2 : post === 7 ? 0 : 1])
      else if (up <= 8) put(x, y, [10, 40, 60], 95)
    }
  }

  // ── 4. 水面数据：两遍距离变换 ──
  const dist = new Float32Array(R * R)
  for (let i = 0; i < R * R; i++) dist[i] = WATER[types[i]] ? 1e9 : 0
  for (let y = 0; y < R; y++) for (let x = 0; x < R; x++) {
    const i = y * R + x
    if (x > 0) dist[i] = Math.min(dist[i], dist[i - 1] + 1)
    if (y > 0) dist[i] = Math.min(dist[i], dist[i - R] + 1)
    if (x > 0 && y > 0) dist[i] = Math.min(dist[i], dist[i - R - 1] + 1.414)
    if (x < R - 1 && y > 0) dist[i] = Math.min(dist[i], dist[i - R + 1] + 1.414)
  }
  for (let y = R - 1; y >= 0; y--) for (let x = R - 1; x >= 0; x--) {
    const i = y * R + x
    if (x < R - 1) dist[i] = Math.min(dist[i], dist[i + 1] + 1)
    if (y < R - 1) dist[i] = Math.min(dist[i], dist[i + R] + 1)
    if (x < R - 1 && y < R - 1) dist[i] = Math.min(dist[i], dist[i + R + 1] + 1.414)
    if (x > 0 && y < R - 1) dist[i] = Math.min(dist[i], dist[i + R - 1] + 1.414)
  }
  const w = new Uint8ClampedArray(P * P * 4)
  for (let y = M; y < M + P; y++) for (let x = M; x < M + P; x++) {
    const i = y * R + x
    if (!WATER[types[i]]) continue
    const o = ((y - M) * P + x - M) * 4
    w[o] = Math.min(255, dist[i] * 4)
    w[o + 1] = types[i] === TID.shallow && landAt[i] > 0 ? 40 : Math.max(0, Math.min(255, (-landAt[i] / 0.32) * 255))
    w[o + 3] = 255
  }
  return { size: P, ground: g, water: w }
}

function near(T: (x: number, y: number) => number, x: number, y: number, r: number, f: (t: number) => boolean) {
  for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) if ((dx || dy) && f(T(x + dx, y + dy))) return true
  return false
}
