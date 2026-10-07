// 海底地图（侧视）：y=0 是海面，向下为正。单位是美术像素。
// 碰撞按 8 像素网格预计算，服务端用它给鱼选路线，客户端用它做玩家碰撞和画地形。
import { fbm, rng } from './noise.ts'
import type { Zone } from './data.ts'

export const SEA_W = 2400
export const SEA_H = 1800
export const SEA_CELL = 8
export const GW = SEA_W / SEA_CELL
export const GH = SEA_H / SEA_CELL
export const BOAT_X = 1250
export const PX_PER_METER = 36 // 深度计换算：潜水员约 1.8 米 ≈ 67 像素

export const ZONES: Record<Zone, { y0: number, y1: number, name: string }> = {
  reef: { y0: 70, y1: 620, name: '珊瑚浅滩' },
  mid: { y0: 520, y1: 1180, name: '蓝色断层' },
  deep: { y0: 1080, y1: 1760, name: '蓝洞深处' },
}

export function zoneAt(y: number): Zone {
  return y < 560 ? 'reef' : y < 1120 ? 'mid' : 'deep'
}

function floorY(x: number) {
  // 中段是蓝洞，海床更深
  const hole = Math.max(0, 1 - Math.abs(x - 1250) / 520)
  return 1540 + (fbm(x * 0.004, 3.3, 21) - 0.5) * 280 + hole * hole * 190
}

// 连续定义：某个像素是不是岩石
export function solidAt(x: number, y: number): boolean {
  if (y < 0) return false
  if (x < 0 || x >= SEA_W || y >= SEA_H) return true
  if (y > floorY(x)) return true
  // 左右崖壁
  const wall = 60 + fbm(y * 0.008, 1.7, 31) * 150
  if (x < wall || x > SEA_W - wall) return true
  // 船正下方留一条通道，保证下潜路线畅通
  const lane = Math.abs(x - BOAT_X) < 170 && y < 1300
  // 左侧珊瑚礁台地，向蓝洞方向倾斜下降
  const shelfL = 330 + (fbm(x * 0.012, 0.5, 41) - 0.5) * 120 + Math.max(0, x - 560) * 1.25
  if (!lane && x < 1000 && y > shelfL) return true
  // 右侧台地更深
  const shelfR = 470 + (fbm(x * 0.012, 8.5, 43) - 0.5) * 140 + Math.max(0, 1880 - x) * 1.1
  if (!lane && x > 1450 && y > shelfR) return true
  // 深处的悬空岩柱和洞穴
  if (!lane && y > 700 && fbm(x * 0.0065, y * 0.0065, 51) > 0.66) return true
  return false
}

export interface SeaMap {
  grid: Uint8Array     // 1 = 岩石
  dist: Float32Array   // 到最近岩石的距离（格），给鱼选开阔水域用
}

export function buildSea(): SeaMap {
  const grid = new Uint8Array(GW * GH)
  for (let gy = 0; gy < GH; gy++) for (let gx = 0; gx < GW; gx++) {
    grid[gy * GW + gx] = solidAt(gx * SEA_CELL + 4, gy * SEA_CELL + 4) ? 1 : 0
  }
  // 两遍扫描的近似距离变换（切比雪夫距离）
  const dist = new Float32Array(GW * GH)
  for (let i = 0; i < GW * GH; i++) dist[i] = grid[i] ? 0 : 1e9
  for (let y = 0; y < GH; y++) for (let x = 0; x < GW; x++) {
    const i = y * GW + x
    if (x > 0) dist[i] = Math.min(dist[i], dist[i - 1] + 1)
    if (y > 0) dist[i] = Math.min(dist[i], dist[i - GW] + 1)
  }
  for (let y = GH - 1; y >= 0; y--) for (let x = GW - 1; x >= 0; x--) {
    const i = y * GW + x
    if (x < GW - 1) dist[i] = Math.min(dist[i], dist[i + 1] + 1)
    if (y < GH - 1) dist[i] = Math.min(dist[i], dist[i + GW] + 1)
  }
  return { grid, dist }
}

export function seaSolid(map: SeaMap, x: number, y: number): boolean {
  if (y < 0) return false
  const gx = Math.floor(x / SEA_CELL), gy = Math.floor(y / SEA_CELL)
  if (gx < 0 || gy < 0 || gx >= GW || gy >= GH) return true
  return map.grid[gy * GW + gx] === 1
}

export function openness(map: SeaMap, x: number, y: number): number {
  const gx = Math.floor(x / SEA_CELL), gy = Math.floor(y / SEA_CELL)
  if (gx < 0 || gy < 0 || gx >= GW || gy >= GH) return 0
  return map.dist[gy * GW + gx] * SEA_CELL
}

// 在某个区域里挑一个开阔水域的点
export function randomOpenPoint(map: SeaMap, zone: Zone, rand: () => number, clearance = 40) {
  const z = ZONES[zone]
  for (let i = 0; i < 200; i++) {
    const x = 80 + rand() * (SEA_W - 160), y = z.y0 + rand() * (z.y1 - z.y0)
    if (openness(map, x, y) >= clearance) return { x, y }
  }
  return { x: BOAT_X, y: (z.y0 + z.y1) / 2 }
}

export interface SeaDecor { kind: string, x: number, y: number, flip: boolean, glow?: number }

// 沿岩石上表面摆放珊瑚/海草/海带，按深度分区选种类
export function buildSeaDecor(map: SeaMap): SeaDecor[] {
  const r = rng(424242)
  const out: SeaDecor[] = []
  const shallow = ['coral_pink', 'coral_orange', 'seafan', 'brain_coral', 'staghorn', 'sponge', 'anemone_green', 'anemone_purple', 'seagrass', 'seagrass', 'clam']
  const middle = ['seafan', 'sponge', 'anemone_purple', 'urchin', 'rock_small', 'boulder_moss', 'seagrass', 'kelp', 'staghorn']
  const deep = ['glow_plant', 'glow_mushroom', 'urchin', 'rock_small', 'boulder_moss', 'anemone_purple', 'rock_small', 'urchin']
  for (let gx = 2; gx < GW - 2; gx++) {
    for (let gy = 1; gy < GH; gy++) {
      const i = gy * GW + gx
      if (!map.grid[i] || map.grid[i - GW]) continue
      // 上表面：本格是石头、上一格是水
      const y = gy * SEA_CELL
      if (r() > (y < 1120 ? 0.42 : 0.2)) continue // 深处装饰稀疏一些，荧光才显得珍贵
      const pool = y < 560 ? shallow : y < 1120 ? middle : deep
      let kind = pool[Math.floor(r() * pool.length)]
      if (kind === 'kelp' || (y < 700 && r() < 0.08)) kind = 'kelp'
      const x = gx * SEA_CELL + r() * SEA_CELL
      // 下沉 2 像素，让底座埋进岩石里
      out.push({ kind, x, y: y + 3, flip: r() < 0.5, glow: kind.startsWith('glow') ? (kind === 'glow_plant' ? 0x40e0ff : 0xd070ff) : undefined })
    }
  }
  // 宝箱和陶罐：少量放在深处
  let extras = 0
  for (let t = 0; t < 4000 && extras < 5; t++) {
    const gx = 4 + Math.floor(r() * (GW - 8)), gy = Math.floor(900 / SEA_CELL + r() * (GH - 900 / SEA_CELL - 2))
    const i = gy * GW + gx
    if (map.grid[i] && !map.grid[i - GW] && !map.grid[i - GW * 3]) {
      out.push({ kind: extras % 2 ? 'amphora' : 'chest', x: gx * SEA_CELL + 4, y: gy * SEA_CELL + 3, flip: r() < 0.5 })
      extras++
    }
  }
  return out
}

// 海底的剧情物品：接了对应的任务才会在水底闪光，游过去按 E 捡起来（服务端核对任务和距离）
export const SEA_FINDS: Record<string, { item: string, quest: string, x: number, y: number }> = {
  watch: { item: 'q_watch', quest: 'story:laopan8', x: 440, y: 312 },    // 珊瑚浅滩西边的礁石台子上
  knife: { item: 'q_knife', quest: 'story:ahai8', x: 1225, y: 1458 },   // 蓝洞最底下（要高压气瓶）
}
