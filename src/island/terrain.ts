// 岛屿地面烘焙：按像素求地形类型，再用手调调色板 + 噪声 + 抖动画成像素画地面。
// 输出两张图：ground（陆地/栈桥，水域透明）和 waterData（水域的离岸距离/深度，给水面着色器用）。
import { CanvasSource, Texture } from 'pixi.js'
import { TILE } from '../../shared/data.ts'
import { ISLAND_W, ISLAND_H, PLACES, T, landValue, pathDist } from '../../shared/island.ts'
import { fbm, hash2, valueNoise } from '../../shared/noise.ts'
import { canvas, texFrom } from '../core/assets.ts'
import { AC_STYLE } from '../acstyle.ts'
import { fieldTexture } from './ground.ts'

const hex = (h: number): [number, number, number] => [(h >> 16) & 255, (h >> 8) & 255, h & 255]
// 动森风（粉嫩圆润版）：草是柔和的苹果绿、沙是奶油色、路是浅土色，明暗差小；?oldstyle 用旧配色
const GRASS = (AC_STYLE ? [0x66b953, 0x72c35c, 0x7fcd66, 0x8ed672, 0xa2e082] : [0x3f7431, 0x4f8a37, 0x5f9e3e, 0x71b046, 0x86c451]).map(hex)
const FARMG = (AC_STYLE ? [0x6cb453, 0x78bf5b, 0x85c964, 0x93d26f, 0xa5dc7e] : [0x46712f, 0x557f34, 0x64903b, 0x739f43, 0x86b04f]).map(hex)
const SAND = (AC_STYLE ? [0xe0cc98, 0xe9d8aa, 0xf1e3bb, 0xf6ecca, 0xfbf4dc] : [0xc4a068, 0xd6b87e, 0xe4ca93, 0xefdba8, 0xf7e9c2]).map(hex)
const PATH = (AC_STYLE ? [0xbf9a6a, 0xcaa778, 0xd5b587, 0xdfc296, 0xe8cfa6] : [0x7e5638, 0x946844, 0xa97b50, 0xbb8f60, 0xcca273]).map(hex)
const WOOD = [0x4a2e1b, 0x6b4428, 0x8a5a34, 0xa36d40, 0xbd8552].map(hex)
const FLOWERS = [0xf4f1e0, 0xf6d65a, 0xf08bb0, 0xa9c8ff].map(hex)

// 高清模式（hd）：不烘焙像素画地面，改出场纹理 field（地面着色器用，见 ground.ts）和单独的高清栈桥 dock；
// 水面数据改成线性过滤、陆地下面也铺满（离岸距离 0），海岸线上地面半透明的抗锯齿边缘底下总有水，不会露出黑边
export interface IslandBake {
  ground: Texture | null
  water: Texture
  field?: { tex: Texture, S: number }
  dock?: { tex: Texture, x: number, y: number }
}

export function bakeIsland(hd = false): IslandBake {
  const W = ISLAND_W * TILE, H = ISLAND_H * TILE
  // ── 1. 在 3 像素步长的网格上取样连续场，逐像素双线性插值 ──
  const S = 3, gw = Math.ceil(W / S) + 2, gh = Math.ceil(H / S) + 2
  const fLand = new Float32Array(gw * gh), fPath = new Float32Array(gw * gh), fSand = new Float32Array(gw * gh)
  for (let gy = 0; gy < gh; gy++) for (let gx = 0; gx < gw; gx++) {
    const x = (gx * S) / TILE, y = (gy * S) / TILE, i = gy * gw + gx
    const land = landValue(x, y)
    fLand[i] = land
    fPath[i] = pathDist(x, y) - 0.85 - (fbm(x * 0.9, y * 0.9, 3) - 0.5) * 0.5
    fSand[i] = land - (0.1 + (fbm(x * 0.5, y * 0.5, 11) - 0.5) * 0.06)
  }
  const sample = (f: Float32Array, px: number, py: number) => {
    const fx = px / S, fy = py / S, x0 = Math.floor(fx), y0 = Math.floor(fy), tx = fx - x0, ty = fy - y0
    const i = y0 * gw + x0
    return (f[i] * (1 - tx) + f[i + 1] * tx) * (1 - ty) + (f[i + gw] * (1 - tx) + f[i + gw + 1] * tx) * ty
  }

  const types = new Uint8Array(W * H)
  const landAt = new Float32Array(W * H)
  const dock = PLACES.dock, farm = PLACES.farm
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x
    const land = sample(fLand, x + 0.5, y + 0.5)
    landAt[i] = land
    const tx = x / TILE, ty = y / TILE
    let t: number
    if (land <= 0) t = land > -0.13 ? T.SHALLOW : T.DEEP
    else if (tx >= farm.x0 && tx < farm.x1 + 1 && ty >= farm.y0 && ty < farm.y1 + 1) t = T.FARM
    else if (sample(fPath, x + 0.5, y + 0.5) < 0) t = T.PATH
    else if (sample(fSand, x + 0.5, y + 0.5) < 0) t = T.SAND
    else t = T.GRASS
    types[i] = t
  }

  if (hd) {
    return {
      ground: null,
      water: waterData(W, H, types, landAt, true),
      field: { tex: fieldTexture(gw, gh, i => [fLand[i], fPath[i], fSand[i]]), S },
      dock: dockHD(),
    }
  }

  // ── 2. 上色 ──
  const { c: gc, g: gctx } = canvas(W, H)
  const img = gctx.createImageData(W, H)
  const px = img.data
  const put = (i: number, col: [number, number, number], a = 255) => { px[i * 4] = col[0]; px[i * 4 + 1] = col[1]; px[i * 4 + 2] = col[2]; px[i * 4 + 3] = a }
  const isGrass = (t: number) => t === T.GRASS || t === T.FARM
  const isWater = (t: number) => t === T.SHALLOW || t === T.DEEP
  const ty = (x: number, y: number) => (x < 0 || y < 0 || x >= W || y >= H) ? T.DEEP : types[y * W + x]

  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x, t = types[i]
    if (isWater(t)) continue
    const h = hash2(x, y, 5)
    const d = (((x & 3) + ((y & 3) << 2)) * 7 % 16) / 16 // 简易有序抖动
    if (isGrass(t)) {
      const pal = GRASS
      // 大块明暗 → 2/3 号色之间抖动过渡
      const n = fbm(x / 46, y / 46, 13)
      const n2 = valueNoise(x / 9, y / 9, 17)
      let k = n * 1.15 + (n2 - 0.5) * 0.35
      let ci = k < 0.42 ? 1 : k < 0.5 ? (d < (k - 0.42) / 0.08 ? 2 : 1) : k < 0.66 ? 2 : k < 0.72 ? (d < (k - 0.66) / 0.06 ? 3 : 2) : 3
      put(i, pal[ci])
      // 草簇：7×6 格子里随机放一个小「人」字笔触
      const cx = Math.floor(x / 7), cy = Math.floor(y / 6)
      const ch = hash2(cx, cy, 21)
      if (ch < (t === T.FARM ? 0.25 : 0.5)) {
        const ox = cx * 7 + Math.floor(hash2(cx, cy, 22) * 5), oy = cy * 6 + 2 + Math.floor(hash2(cx, cy, 23) * 3)
        if ((x === ox && y === oy) || (x === ox + 1 && y === oy - 1) || (x === ox + 2 && y === oy)) put(i, pal[Math.max(0, ci - 2)])
        if (x === ox + 1 && y === oy && ch < 0.2) put(i, pal[Math.min(4, ci + 1)])
      }
      // 小花
      if (t === T.GRASS && h < 0.0035) {
        put(i, FLOWERS[Math.floor(hash2(x, y, 6) * FLOWERS.length)])
      }
    } else if (t === T.SAND) {
      const n = fbm(x / 30, y / 30, 31)
      const land = landAt[i]
      let ci = n < 0.45 ? 2 : n < 0.52 ? (d < (n - 0.45) / 0.07 ? 3 : 2) : 3
      if (land < 0.028) ci = land < 0.012 ? 0 : 1 // 湿沙带
      put(i, SAND[ci])
      if (h < 0.02) put(i, SAND[Math.max(0, ci - 1)])
      else if (h > 0.985) put(i, SAND[4])
    } else if (t === T.PATH) {
      const n = fbm(x / 20, y / 20, 41)
      const ci = n < 0.5 ? 2 : n < 0.56 ? (d < (n - 0.5) / 0.06 ? 3 : 2) : 3
      put(i, PATH[ci])
      // 卵石：2×1 亮点 + 下方暗点
      const cx = Math.floor(x / 5), cy = Math.floor(y / 5)
      if (hash2(cx, cy, 42) < 0.18) {
        const ox = cx * 5 + 1 + Math.floor(hash2(cx, cy, 43) * 2), oy = cy * 5 + 1 + Math.floor(hash2(cx, cy, 44) * 2)
        if (y === oy && (x === ox || x === ox + 1)) put(i, PATH[4])
        if (y === oy + 1 && (x === ox || x === ox + 1)) put(i, PATH[0])
      }
    }
  }

  // ── 3. 边缘：草地高出一截（下沿深色唇边 + 投影），上沿高光 ──
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x, t = types[i]
    if (!isGrass(t)) continue
    const pal = GRASS
    const below1 = ty(x, y + 1), below2 = ty(x, y + 2)
    if (!isGrass(below1)) put(i, pal[0])
    else if (!isGrass(below2)) put(i, pal[1])
    else if (!isGrass(ty(x, y - 1))) put(i, pal[4])
    else if (!isGrass(ty(x - 1, y)) || !isGrass(ty(x + 1, y))) put(i, pal[1])
  }
  // 草地下方 2 像素投影落在沙地/小路上
  for (let y = H - 1; y >= 2; y--) for (let x = 0; x < W; x++) {
    const i = y * W + x, t = types[i]
    if (isGrass(t) || isWater(t)) continue
    if (isGrass(ty(x, y - 1)) || isGrass(ty(x, y - 2))) {
      px[i * 4] *= 0.78; px[i * 4 + 1] *= 0.76; px[i * 4 + 2] *= 0.8
    }
  }

  // ── 4. 栈桥：南北向木板（每块由两截错缝拼成），南北两侧压一条纵梁，下沿侧面 + 桩子 + 水面投影 ──
  const dx0 = dock.x0 * TILE, dx1 = (dock.x1 + 1) * TILE, dy0 = dock.y0 * TILE, dy1 = (dock.y1 + 1) * TILE
  for (let y = dy0 - 1; y < dy1 + 12; y++) for (let x = dx0; x < dx1; x++) {
    if (y >= H || y < 0) continue
    const i = y * W + x
    const ly = y - dy0
    if (y < dy0) { if (isWater(types[i])) put(i, [20, 50, 70], 70); continue } // 北侧一像素暗边
    if (y < dy1) {
      const board = Math.floor((x - dx0) / 6), bx = (x - dx0) % 6
      const bh = hash2(board, 0, 61)
      const seam = 10 + Math.floor(hash2(board, 1, 63) * 28)          // 这块板的接缝位置
      let col = WOOD[bh < 0.35 ? 2 : bh < 0.8 ? 3 : 2]
      if (bx === 5) col = WOOD[0]                                       // 板缝
      else if (bx === 0) col = WOOD[4]                                  // 板边高光
      else if (hash2(x, y, 62) < 0.05) col = WOOD[bh < 0.35 ? 1 : 2]   // 木纹
      if (ly === seam) col = WOOD[0]
      if (ly === seam + 1 && bx < 5) col = WOOD[4]
      // 纵梁
      if (ly < 4) col = ly === 0 ? WOOD[4] : ly === 3 ? WOOD[0] : WOOD[2 + ((x >> 3) & 1)]
      if (ly >= 44) col = ly === 44 ? WOOD[4] : ly === 47 ? WOOD[1] : WOOD[2 + ((x >> 3) & 1)]
      if ((ly === 1 || ly === 45) && (x - dx0) % 12 === 3) col = WOOD[0]  // 钉子
      put(i, col)
    } else if (y < dy1 + 4) {
      put(i, WOOD[y === dy1 ? 1 : 0])                                   // 侧面厚度
    } else {
      const post = (x - dx0) % (TILE * 2)
      if (post >= 3 && post < 8 && y < dy1 + 11) put(i, WOOD[post === 3 ? 2 : post === 7 ? 0 : 1])
      else if (y < dy1 + 9 && isWater(types[i])) put(i, [10, 40, 60], 95)
    }
  }
  gctx.putImageData(img, 0, 0)
  return { ground: texFrom(gc), water: waterData(W, H, types, landAt, false) }
}

// ── 5. 水面数据：R = 离岸距离（像素，0~63），G = 深度 ──
function waterData(W: number, H: number, types: Uint8Array, landAt: Float32Array, hd: boolean): Texture {
  const isWater = (t: number) => t === T.SHALLOW || t === T.DEEP
  const dist = new Float32Array(W * H)
  for (let i = 0; i < W * H; i++) dist[i] = isWater(types[i]) ? 1e9 : 0
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x
    if (x > 0) dist[i] = Math.min(dist[i], dist[i - 1] + 1)
    if (y > 0) dist[i] = Math.min(dist[i], dist[i - W] + 1)
    if (x > 0 && y > 0) dist[i] = Math.min(dist[i], dist[i - W - 1] + 1.414)
    if (x < W - 1 && y > 0) dist[i] = Math.min(dist[i], dist[i - W + 1] + 1.414)
  }
  for (let y = H - 1; y >= 0; y--) for (let x = W - 1; x >= 0; x--) {
    const i = y * W + x
    if (x < W - 1) dist[i] = Math.min(dist[i], dist[i + 1] + 1)
    if (y < H - 1) dist[i] = Math.min(dist[i], dist[i + W] + 1)
    if (x < W - 1 && y < H - 1) dist[i] = Math.min(dist[i], dist[i + W + 1] + 1.414)
    if (x > 0 && y < H - 1) dist[i] = Math.min(dist[i], dist[i + W - 1] + 1.414)
  }
  const { c: wc, g: wctx } = canvas(W, H)
  const wimg = wctx.createImageData(W, H)
  for (let i = 0; i < W * H; i++) {
    if (!isWater(types[i])) { if (hd) wimg.data[i * 4 + 3] = 255; continue }
    wimg.data[i * 4] = Math.min(255, dist[i] * 4)
    wimg.data[i * 4 + 1] = Math.max(0, Math.min(255, (-landAt[i] / 0.32) * 255))
    wimg.data[i * 4 + 2] = 0
    wimg.data[i * 4 + 3] = 255
  }
  wctx.putImageData(wimg, 0, 0)
  return texFrom(wc, hd ? 'linear' : 'nearest')
}

// ── 高清栈桥：南北向木板 + 两侧纵梁 + 侧面 + 桩子 + 水面投影，按 4 倍密度用矢量画 ──
const DOCK_RES = 4
const DWOOD = ['#7a5236', '#9a6b45', '#b98555', '#cf9b66', '#e2b684']
function dockHD(): { tex: Texture, x: number, y: number } {
  const dock = PLACES.dock
  const x0 = dock.x0 * TILE, x1 = (dock.x1 + 1) * TILE, y0 = dock.y0 * TILE, y1 = (dock.y1 + 1) * TILE
  const w = x1 - x0, deck = y1 - y0, h = deck + 14
  const R = DOCK_RES
  const { c, g } = canvas(w * R, h * R)
  g.scale(R, R)
  g.translate(0, 1) // 上面留 1 像素画北侧暗边
  const rr = (x: number, y: number, ww: number, hh: number, r: number, col: string) => { g.fillStyle = col; g.beginPath(); g.roundRect(x, y, ww, hh, r); g.fill() }
  // 水面投影、北侧暗边
  const grd = g.createLinearGradient(0, deck, 0, deck + 11)
  grd.addColorStop(0, 'rgba(10,40,60,0.38)'); grd.addColorStop(1, 'rgba(10,40,60,0)')
  g.fillStyle = grd; g.fillRect(0, deck, w, 11)
  g.fillStyle = 'rgba(20,50,70,0.28)'; g.fillRect(0, -1, w, 1)
  // 桩子
  for (let px = 3; px < w; px += TILE * 2) { rr(px, deck + 1, 5, 9, 1.2, DWOOD[0]); rr(px + 0.8, deck + 1, 1.2, 7.5, 0.6, DWOOD[1]) }
  // 侧面厚度
  rr(0, deck - 1, w, 5, 1, DWOOD[0]); g.fillStyle = DWOOD[1]; g.fillRect(0, deck - 1, w, 1.4)
  // 木板
  for (let b = 0; b * 6 < w; b++) {
    const bx = b * 6, bh = hash2(b, 0, 61)
    rr(bx + 0.3, 0, 5.4, deck, 1.2, DWOOD[bh < 0.35 ? 2 : bh < 0.8 ? 3 : 2])
    g.fillStyle = 'rgba(255,240,210,0.35)'; g.fillRect(bx + 0.8, 1, 0.8, deck - 2)
    const seam = 10 + Math.floor(hash2(b, 1, 63) * 28)
    g.fillStyle = DWOOD[1]; g.fillRect(bx + 0.3, seam, 5.4, 0.7)
    g.fillStyle = 'rgba(255,240,210,0.45)'; g.fillRect(bx + 0.3, seam + 0.7, 5.4, 0.6)
  }
  // 两侧纵梁 + 钉子
  for (const by of [0, deck - 4]) {
    rr(-0.5, by, w + 1, 4, 1.5, DWOOD[2])
    g.fillStyle = DWOOD[4]; g.fillRect(0, by + 0.4, w, 0.8)
    g.fillStyle = DWOOD[1]; g.fillRect(0, by + 3.2, w, 0.8)
    g.fillStyle = DWOOD[0]
    for (let nx = 3; nx < w; nx += 12) { g.beginPath(); g.arc(nx + 0.5, by + 1.8, 0.55, 0, Math.PI * 2); g.fill() }
  }
  const tex = new Texture({ source: new CanvasSource({ resource: c, scaleMode: 'linear', resolution: R }) })
  return { tex, x: x0, y: y0 - 1 }
}
