// 海底岩石烘焙：从 8 像素碰撞网格插值出有机轮廓，按深度分三套调色板，
// 上表面铺沙/苔藓、受光面提亮、岩体内部压暗出体积，深处点缀荧光斑点。
import type { Texture } from 'pixi.js'
import { SEA_W, SEA_H, SEA_CELL, GW, GH } from '../../shared/sea.ts'
import type { SeaMap } from '../../shared/sea.ts'
import { fbm, hash2, valueNoise } from '../../shared/noise.ts'
import { canvas, texFrom } from '../core/assets.ts'

const hex = (h: number) => [(h >> 16) & 255, (h >> 8) & 255, h & 255]
const ROCK = {
  shallow: [0x28303f, 0x374457, 0x4a5b70, 0x607487, 0x7b8f9c].map(hex),
  mid: [0x1c2438, 0x28334d, 0x364564, 0x46597c, 0x5a6f92].map(hex),
  deep: [0x121528, 0x1a1e37, 0x242a4a, 0x30385e, 0x3d4672].map(hex),
}
const TOP = {
  shallow: [0xb9a578, 0xd6c393, 0x8f9a66].map(hex),  // 沙 + 苔
  mid: [0x3f6558, 0x55806c, 0x2f4d48].map(hex),
  deep: [0x2a3558, 0x36436b, 0x202845].map(hex),
}

export function bakeSea(map: SeaMap): { rock: Texture, mask: Texture } {
  const W = SEA_W, H = SEA_H
  // ── 1. 像素级实心判定：网格值双线性插值 + 细噪声 ──
  const solid = new Uint8Array(W * H)
  const gv = (gx: number, gy: number) => (gx < 0 || gy < 0 || gx >= GW || gy >= GH) ? 1 : map.grid[gy * GW + gx]
  for (let y = 0; y < H; y++) {
    const fy = y / SEA_CELL - 0.5, gy = Math.floor(fy), ty = fy - gy
    for (let x = 0; x < W; x++) {
      const fx = x / SEA_CELL - 0.5, gx = Math.floor(fx), tx = fx - gx
      const v = (gv(gx, gy) * (1 - tx) + gv(gx + 1, gy) * tx) * (1 - ty) + (gv(gx, gy + 1) * (1 - tx) + gv(gx + 1, gy + 1) * tx) * ty
      const n = (valueNoise(x / 5, y / 5, 71) - 0.5) * 0.5
      solid[y * W + x] = v + n > 0.5 ? 1 : 0
    }
  }
  // ── 2. 到岩石边缘的距离（岩体内部压暗用）+ 头顶水面距离（受光/表层用） ──
  const dist = new Float32Array(W * H)
  for (let i = 0; i < W * H; i++) dist[i] = solid[i] ? 1e6 : 0
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x
    if (!solid[i]) continue
    if (x > 0) dist[i] = Math.min(dist[i], dist[i - 1] + 1)
    if (y > 0) dist[i] = Math.min(dist[i], dist[i - W] + 1)
  }
  for (let y = H - 1; y >= 0; y--) for (let x = W - 1; x >= 0; x--) {
    const i = y * W + x
    if (!solid[i]) continue
    if (x < W - 1) dist[i] = Math.min(dist[i], dist[i + 1] + 1)
    if (y < H - 1) dist[i] = Math.min(dist[i], dist[i + W] + 1)
  }
  const fromTop = new Uint16Array(W * H) // 这一列从上方最近的水到这里隔了几层岩石
  for (let x = 0; x < W; x++) {
    let run = 999
    for (let y = 0; y < H; y++) {
      const i = y * W + x
      run = solid[i] ? run + 1 : 0
      fromTop[i] = Math.min(run, 65535)
    }
  }

  // ── 3. 高度场（2 像素网格）：大块岩团 + 小凹凸，用它的梯度当法线做顶光照明，岩石才有体积 ──
  const hw = Math.ceil(W / 2) + 2, hh = Math.ceil(H / 2) + 2
  const hf = new Float32Array(hw * hh)
  for (let gy = 0; gy < hh; gy++) for (let gx = 0; gx < hw; gx++) {
    const x = gx * 2, y = gy * 2
    hf[gy * hw + gx] = fbm(x / 34, y / 34, 81, 3) * 0.75 + valueNoise(x / 9, y / 9, 82) * 0.25
  }
  const hAt = (x: number, y: number) => {
    const fx = Math.max(0, x / 2), fy = Math.max(0, y / 2), x0 = Math.min(hw - 2, Math.floor(fx)), y0 = Math.min(hh - 2, Math.floor(fy))
    const tx = fx - x0, ty = fy - y0, i = y0 * hw + x0
    return (hf[i] * (1 - tx) + hf[i + 1] * tx) * (1 - ty) + (hf[i + hw] * (1 - tx) + hf[i + hw + 1] * tx) * ty
  }

  // ── 4. 上色 ──
  const { c, g } = canvas(W, H)
  const img = g.createImageData(W, H)
  const d = img.data
  // 焦散遮罩：只有朝上、离水面近的岩面才接得到焦散光斑（R 通道 = 受光程度）
  const { c: mc, g: mg } = canvas(W, H)
  const mimg = mg.createImageData(W, H)
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x
    if (!solid[i]) continue
    const dither = (((x & 3) + ((y & 3) << 2)) * 7 % 16) / 16
    const zf = y / 560 + (dither - 0.5) * 0.5
    const zone = zf < 1 ? 'shallow' : y / 1120 + (dither - 0.5) * 0.3 < 1 ? 'mid' : 'deep'
    const pal = ROCK[zone]
    // 法线 · 光照方向（左上方来光）
    const gx = hAt(x + 2, y) - hAt(x - 2, y), gy = hAt(x, y + 2) - hAt(x, y - 2)
    let shade = 0.5 + (gx * 0.45 + gy * 1.0) * -7 + (hAt(x, y) - 0.5) * 0.6
    const di = dist[i], top = fromTop[i]
    shade += Math.max(0, 1 - top / 18) * 0.35      // 朝上的一面被水面光照亮
    shade -= Math.min(0.45, Math.max(0, di - 14) / 90) // 岩体深处压暗
    const lv = shade * 4 + (dither - 0.5) * 0.9
    let col = pal[Math.max(0, Math.min(4, Math.floor(lv)))]
    if (di <= 1 && top > 3) col = pal[0]                        // 轮廓
    // 上表面：沙/苔藓覆盖层，边缘不规则
    const cover = 2 + Math.floor(valueNoise(x / 7, 3, 91) * 4)
    if (top <= cover) {
      const tp = TOP[zone]
      col = top === 1 ? tp[1] : (hash2(x, y, 92) < 0.25 ? tp[2] : tp[0])
    }
    // 深处荧光斑点
    if (zone === 'deep' && hash2(x, y, 93) < 0.0012 && di < 30) col = hash2(x, y, 94) < 0.5 ? [90, 220, 255] : [190, 120, 255]
    d[i * 4] = col[0]; d[i * 4 + 1] = col[1]; d[i * 4 + 2] = col[2]; d[i * 4 + 3] = 255
    mimg.data[i * 4] = Math.max(0, 1 - top / 26) * 255; mimg.data[i * 4 + 3] = 255
  }
  mg.putImageData(mimg, 0, 0)
  g.putImageData(img, 0, 0)
  return { rock: texFrom(c), mask: texFrom(mc, 'linear') }
}
