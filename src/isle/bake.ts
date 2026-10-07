// 动森式岛屿：地面场纹理 + 水面数据（离岸距离、深度），都按种子算一次，同一座岛来回进出复用
import { Texture } from 'pixi.js'
import { TILE } from '../../shared/data.ts'
import { ISLE_W, ISLE_H } from '../../shared/isle/gen.ts'
import type { Isle } from '../../shared/isle/gen.ts'
import { canvas, texFrom } from '../core/assets.ts'
import { isleFieldTexture } from './ground.ts'

export interface IsleBake {
  field: Texture; S: number    // 场纹理：第 i 个采样点在世界坐标 i×S（纹素中心对齐）
  water: Texture; WS: number   // 水面数据：每格 WS 像素，R = 离岸距离（像素 ×4），G = 深度
  cliff: Float32Array; gw: number; gh: number   // 悬崖层的采样（和场纹理同一套网格），走路碰撞按画出来的崖边算
}

const cache = new Map<number, IsleBake>()

export function bakeIsle(isle: Isle): IsleBake {
  const hit = cache.get(isle.seed)
  if (hit) return hit
  const W = ISLE_W * TILE, H = ISLE_H * TILE
  // ── 场：每 6 像素一个采样点 ──
  const S = 6, gw = Math.ceil(W / S) + 2, gh = Math.ceil(H / S) + 2
  const land = new Float32Array(gw * gh), cliff = new Float32Array(gw * gh), sand = new Float32Array(gw * gh)
  for (let gy = 0; gy < gh; gy++) for (let gx = 0; gx < gw; gx++) {
    const i = gy * gw + gx
    const v = isle.fields.sample((gx * S) / TILE, (gy * S) / TILE)
    land[i] = v[0]; cliff[i] = v[1]; sand[i] = v[2]
  }
  const field = isleFieldTexture(gw, gh, i => [land[i], cliff[i], sand[i]])

  // ── 水面：每 4 像素一格，陆地值从场里双线性插值 ──
  const WS = 4, ww = Math.ceil(W / WS), wh = Math.ceil(H / WS)
  const lw = new Float32Array(ww * wh)
  for (let y = 0; y < wh; y++) for (let x = 0; x < ww; x++) {
    const fx = ((x + 0.5) * WS) / S, fy = ((y + 0.5) * WS) / S
    const x0 = Math.min(gw - 2, Math.floor(fx)), y0 = Math.min(gh - 2, Math.floor(fy)), tx = fx - x0, ty = fy - y0
    const i = y0 * gw + x0
    lw[y * ww + x] = (land[i] * (1 - tx) + land[i + 1] * tx) * (1 - ty) + (land[i + gw] * (1 - tx) + land[i + gw + 1] * tx) * ty
  }
  // 离岸距离（格数），两遍倒角距离
  const dist = new Float32Array(ww * wh)
  for (let i = 0; i < ww * wh; i++) dist[i] = lw[i] <= 0 ? 1e9 : 0
  for (let y = 0; y < wh; y++) for (let x = 0; x < ww; x++) {
    const i = y * ww + x
    if (x > 0) dist[i] = Math.min(dist[i], dist[i - 1] + 1)
    if (y > 0) dist[i] = Math.min(dist[i], dist[i - ww] + 1)
    if (x > 0 && y > 0) dist[i] = Math.min(dist[i], dist[i - ww - 1] + 1.414)
    if (x < ww - 1 && y > 0) dist[i] = Math.min(dist[i], dist[i - ww + 1] + 1.414)
  }
  for (let y = wh - 1; y >= 0; y--) for (let x = ww - 1; x >= 0; x--) {
    const i = y * ww + x
    if (x < ww - 1) dist[i] = Math.min(dist[i], dist[i + 1] + 1)
    if (y < wh - 1) dist[i] = Math.min(dist[i], dist[i + ww] + 1)
    if (x < ww - 1 && y < wh - 1) dist[i] = Math.min(dist[i], dist[i + ww + 1] + 1.414)
    if (x > 0 && y < wh - 1) dist[i] = Math.min(dist[i], dist[i + ww - 1] + 1.414)
  }
  const { c, g } = canvas(ww, wh)
  const img = g.createImageData(ww, wh)
  for (let i = 0; i < ww * wh; i++) {
    // 陆地下面也铺满（离岸 0），地面抗锯齿的半透明边下面总有水
    const d = lw[i] <= 0 ? dist[i] * WS : 0
    img.data[i * 4] = Math.min(255, d * 4)
    img.data[i * 4 + 1] = Math.max(0, Math.min(255, (-lw[i] / 7) * 255))
    img.data[i * 4 + 3] = 255
  }
  g.putImageData(img, 0, 0)
  const res = { field, S, water: texFrom(c, 'linear'), WS, cliff, gw, gh }
  cache.set(isle.seed, res)
  return res
}
