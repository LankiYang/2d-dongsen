// 动森式岛屿生成器（前后端共用，完全由种子决定）。
//
// 结构照原作：长方形的岛，四周沙滩；北边两层悬崖；两条河从高处流下来，在南岸机场两侧入海；一两个池塘；
// 南边机场、中间广场（岛务所）、侧面码头；特产水果树、阔叶树、海边椰子树、6 块石头、花、杂草、地上的树枝。
// 开局在机场柜台从 4 个种子里挑一张（原作也是 4 张地图挑 1 张）。
//
// 地形由几个连续场定义（地块坐标，浮点），服务端按地块中心取样判断能不能走，客户端拿来画平滑的边：
//   land  > 0 陆地（海岸、河、池塘都是 < 0）
//   sand  < 0 沙滩（只看海岸，河边是草）
//   cliff 0～2 悬崖层（0.5、1.5 是两层的边）
// 动态的东西（砍掉的树、摘掉的水果、捡走的树枝、搭好的帐篷）不在这里，存在服务端的岛屿存档里。
import { fbm, hash2, rng } from '../noise.ts'
import { TILE } from '../data.ts'

export const ISLE_M = 10                       // 四周海面的宽度（地块）
export const ISLE_LW = 112, ISLE_LH = 96       // 陆地块（含沙滩）
export const ISLE_W = ISLE_LW + 2 * ISLE_M, ISLE_H = ISLE_LH + 2 * ISLE_M

// 地块类型
export const IT = { DEEP: 0, SHALLOW: 1, SAND: 2, GRASS: 3, RIVER: 4, POND: 5 } as const
export const isWaterT = (t: number) => t === IT.DEEP || t === IT.SHALLOW || t === IT.RIVER || t === IT.POND

export const FRUITS = ['apple', 'orange', 'pear', 'peach', 'cherry'] as const
export type Fruit = typeof FRUITS[number]
export const FRUIT_NAME: Record<Fruit, string> = { apple: '苹果', orange: '橘子', pear: '梨', peach: '桃子', cherry: '樱桃' }
export const FLOWER_SPECIES = ['flower_tulip', 'flower_cosmos', 'flower_pansy', 'flower_rose', 'flower_hyacinth', 'flower_windflower'] as const

export interface IsleObj {
  id: number                // 岛内唯一，存档里按它记砍掉 / 摘掉
  kind: string              // tree / fruit_tree / palm / rock / money_rock / flower_* / weed / branch / shell_*
  x: number; y: number      // 像素，锚点在底边中心
  flip?: boolean
}
export interface Building { kind: 'airport' | 'plaza' | 'dock', x: number, y: number, w: number, h: number }  // 地块矩形（x,y 左上）

export interface Isle {
  seed: number
  fruit: Fruit
  flower: string
  types: Uint8Array          // ISLE_W × ISLE_H
  level: Uint8Array          // 悬崖层 0～2
  blocked: Uint8Array        // 地形 + 建筑 + 树干 + 石头（不含动态的帐篷，那个由服务端叠加）
  objects: IsleObj[]
  airport: Building
  plaza: Building
  dock: Building
  arrive: { x: number, y: number }   // 机场门口（像素）
  start: Uint8Array          // 从机场出发、不过河不爬悬崖能走到的地块（第 0 天的任务都放在这里面）
  fields: IsleFields
}

// ── 连续场 ──
interface River { pts: [number, number][], w: number }
export interface IsleFields {
  land(x: number, y: number): number
  sand(x: number, y: number): number
  cliff(x: number, y: number): number
  // 一次取三个（共用海岸和沙滩宽度的噪声，客户端烘焙地面时几十万次取样用这个）：[land, cliff, sand]
  sample(x: number, y: number): [number, number, number]
}

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v))
function segDist(px: number, py: number, ax: number, ay: number, bx: number, by: number) {
  const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy
  const t = l2 ? clamp(((px - ax) * dx + (py - ay) * dy) / l2, 0, 1) : 0
  return Math.hypot(px - ax - dx * t, py - ay - dy * t)
}
// 圆角矩形的有向距离（内部为负）
function sdRoundRect(px: number, py: number, hx: number, hy: number, r: number) {
  const qx = Math.abs(px) - hx + r, qy = Math.abs(py) - hy + r
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r
}

type Blob = [number, number, number]   // x, y, 半径
function makeFields(seed: number, rivers: River[], ponds: [number, number, number][], cliff1: (x: number) => number, cliff2: (x: number) => number, plateau2: (x: number) => number, bays: Blob[], capes: Blob[]): IsleFields {
  const cx = ISLE_W / 2, cy = ISLE_H / 2
  const coast = (x: number, y: number) => {
    let v = -sdRoundRect(x - cx, y - cy, ISLE_LW / 2, ISLE_LH / 2, 14)
    // 半岛往外鼓、海湾往里凹（平滑并 / 差）
    for (const [bx, by, br] of capes) v = Math.max(v, br - Math.hypot(x - bx, (y - by) * 1.2))
    for (const [bx, by, br] of bays) v = Math.min(v, Math.hypot(x - bx, (y - by) * 1.1) - br)
    return v + (fbm(x * 0.07, y * 0.07, seed + 3) - 0.5) * 8 + (fbm(x * 0.25, y * 0.25, seed + 4) - 0.5) * 1.6
  }
  const beachW = (x: number, y: number) => 3.6 + (fbm(x * 0.05, y * 0.05, seed + 5) - 0.5) * 3 + (y > cy ? 1.2 : 0)
  const water = (x: number, y: number) => {
    let d = Infinity
    for (const r of rivers) {
      for (let i = 0; i < r.pts.length - 1; i++) {
        const [ax, ay] = r.pts[i], [bx, by] = r.pts[i + 1]
        // 包围盒剪枝
        if (x < Math.min(ax, bx) - 6 || x > Math.max(ax, bx) + 6 || y < Math.min(ay, by) - 6 || y > Math.max(ay, by) + 6) continue
        d = Math.min(d, segDist(x, y, ax, ay, bx, by) - r.w / 2)
      }
    }
    for (const [px, py, pr] of ponds) d = Math.min(d, Math.hypot(x - px, (y - py) * 1.15) - pr - (fbm(x * 0.4, y * 0.4, seed + 9) - 0.5) * 1.2)
    return d + (fbm(x * 0.3, y * 0.3, seed + 8) - 0.5) * 0.5
  }
  const land = (x: number, y: number) => Math.min(coast(x, y), water(x, y))
  const sand = (x: number, y: number) => coast(x, y) - beachW(x, y)
  // 悬崖：北边一大片一层，里面再有一两块二层；离沙滩至少 4 格
  const cliffFrom = (x: number, y: number, inner: number) => {
    const n = (fbm(x * 0.09, y * 0.09, seed + 11) - 0.5) * 5
    const e1 = Math.min(cliff1(x) + n - y, inner)
    const e2 = Math.min(cliff2(x) + n * 0.8 - y, inner - 4, plateau2(x), e1 - 3)
    return clamp(e1, -1, 1) * 0.5 + 0.5 + clamp(e2, -1, 1) * 0.5 + 0.5
  }
  const cliff = (x: number, y: number) => cliffFrom(x, y, coast(x, y) - beachW(x, y) - 4)
  const sample = (x: number, y: number): [number, number, number] => {
    const c = coast(x, y), sd = c - beachW(x, y)
    // 离岸很远（深海）就不用算河和悬崖了
    if (c < -6) return [c, 0, sd]
    return [Math.min(c, water(x, y)), sd > -6 ? cliffFrom(x, y, sd - 4) : 0, sd]
  }
  return { land, sand, cliff, sample }
}

// 蜿蜒的河：从源头（北边）到河口（海里），每 6 格一个点，左右摆动
function meander(r: () => number, ax: number, ay: number, bx: number, by: number, amp: number): [number, number][] {
  const pts: [number, number][] = []
  const len = Math.hypot(bx - ax, by - ay), n = Math.max(3, Math.round(len / 6))
  const nx = -(by - ay) / len, ny = (bx - ax) / len
  let off = 0
  for (let i = 0; i <= n; i++) {
    const t = i / n
    if (i > 0 && i < n) off = clamp(off + (r() - 0.5) * amp, -amp * 1.2, amp * 1.2); else off = 0
    pts.push([ax + (bx - ax) * t + nx * off, ay + (by - ay) * t + ny * off])
  }
  return pts
}

// 生成一张岛；布局不合格（广场或机场被河截断、能走的地方太小）就换个随机数重来
export function makeIsle(seed: number): Isle {
  for (let k = 0; k < 20; k++) {
    const isle = tryIsle(seed, k)
    if (isle) return isle
  }
  return tryIsle(seed, 99, true)!
}

function tryIsle(seed: number, attempt: number, force = false): Isle | null {
  const r = rng(seed * 7919 + 13 + attempt * 104729)
  const W = ISLE_W, H = ISLE_H, M = ISLE_M
  const top = M, bottom = M + ISLE_LH
  const fruit = FRUITS[Math.floor(r() * FRUITS.length)]
  const flower = FLOWER_SPECIES[Math.floor(r() * FLOWER_SPECIES.length)]

  // ── 悬崖线 ──
  const c1 = top + ISLE_LH * (0.33 + r() * 0.1), c2 = c1 - 9 - r() * 5
  const p1 = r() * 100, p2 = r() * 100
  const cliff1 = (x: number) => c1 + Math.sin(x * 0.07 + p1) * 4 + Math.sin(x * 0.19 + p2) * 2
  const cliff2 = (x: number) => c2 + Math.sin(x * 0.11 + p2) * 3
  // 二层只在一两段 x 范围内
  const plat = r() < 0.5 ? [[0.18, 0.46], [0.6, 0.86]] : [[0.3, 0.75]]
  const plateau2 = (x: number) => {
    const u = (x - M) / ISLE_LW
    let best = -10
    for (const [a, b] of plat) best = Math.max(best, Math.min(u - a, b - u) * ISLE_LW)
    return best
  }

  // ── 河：源头在北边高处，几种走法随机挑一种（原作的岛也是河的走向各不相同）──
  const rivers: River[] = []
  const pattern = Math.floor(r() * 4)
  const srcL = M + ISLE_LW * (0.26 + r() * 0.12), srcR = M + ISLE_LW * (0.56 + r() * 0.14)
  const srcY = () => top + 8 + r() * 8
  const southL = () => M + ISLE_LW * (0.14 + r() * 0.12), southR = () => M + ISLE_LW * (0.74 + r() * 0.12)
  const sideY = () => top + ISLE_LH * (0.5 + r() * 0.25)
  const run = (ax: number, ay: number, bx: number, by: number) => rivers.push({ pts: meander(r, ax, ay, bx, by, 7), w: 3.2 + r() * 0.6 })
  if (pattern === 0) { run(srcL, srcY(), southL(), bottom + 3); run(srcR, srcY(), southR(), bottom + 3) }                 // 两条都往南
  else if (pattern === 1) { run(srcL, srcY(), southL(), bottom + 3); run(srcR, srcY(), ISLE_W - M + 3, sideY()) }        // 西南 + 东
  else if (pattern === 2) { run(srcL, srcY(), M - 3, sideY()); run(srcR, srcY(), southR(), bottom + 3) }                 // 西 + 东南
  else {
    // 一条河中途分叉：主干往南，支流往东或西
    const main = meander(r, srcL + ISLE_LW * 0.08, srcY(), southL(), bottom + 3, 7)
    rivers.push({ pts: main, w: 3.6 })
    const j = main[Math.floor(main.length * (0.35 + r() * 0.15))]
    run(j[0], j[1], r() < 0.5 ? ISLE_W - M + 3 : southR(), r() < 0.5 ? sideY() : bottom + 3)
  }
  // 海湾和半岛
  const edgePt = (): [number, number] => {
    const side = Math.floor(r() * 4), u = 0.2 + r() * 0.6
    return side === 0 ? [M + ISLE_LW * u, top] : side === 1 ? [M + ISLE_LW * u, bottom] : side === 2 ? [M, top + ISLE_LH * u] : [ISLE_W - M, top + ISLE_LH * u]
  }
  const bays: Blob[] = [], capes: Blob[] = []
  for (let i = 0, n = 1 + Math.floor(r() * 3); i < n; i++) { const [x, y] = edgePt(); if (Math.abs(x - ISLE_W / 2) > 14 || y < bottom - 4) bays.push([x, y, 5 + r() * 6]) }
  for (let i = 0, n = Math.floor(r() * 3); i < n; i++) { const [x, y] = edgePt(); capes.push([x, y, 4 + r() * 5]) }
  // 池塘：一个在中间区域偏旁边，一个可能在悬崖上
  const ponds: [number, number, number][] = [[M + ISLE_LW * (0.4 + r() * 0.2) + (r() < 0.5 ? -14 : 14), top + ISLE_LH * (0.58 + r() * 0.1), 2.6 + r()]]
  if (r() < 0.7) ponds.push([M + ISLE_LW * (0.1 + r() * 0.8), top + ISLE_LH * (0.12 + r() * 0.14), 2.4 + r()])
  const fields = makeFields(seed, rivers, ponds, cliff1, cliff2, plateau2, bays, capes)

  // ── 地块 ──
  const types = new Uint8Array(W * H), level = new Uint8Array(W * H)
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x, fx = x + 0.5, fy = y + 0.5
    const land = fields.land(fx, fy)
    if (land <= 0) {
      // 内陆的水是河或池塘，外面是海
      const coastSide = fields.sand(fx, fy) < 0 || fields.land(fx, fy) < -0.01 && (fx < M || fx > W - M || fy < M || fy > H - M)
      let t: number
      if (ponds.some(([px, py, pr]) => Math.hypot(fx - px, fy - py) < pr + 2)) t = IT.POND
      else if (!coastSide && fields.sand(fx, fy) > 0.5) t = IT.RIVER
      else t = land > -4 ? IT.SHALLOW : IT.DEEP
      // 河口穿过沙滩的那一段也算河
      if (t === IT.SHALLOW && rivers.some(rv => rv.pts.some(([px, py]) => Math.hypot(fx - px, fy - py) < 3)) && fy < bottom + 1) t = IT.RIVER
      types[i] = t
    } else types[i] = fields.sand(fx, fy) < 0 ? IT.SAND : IT.GRASS
    const c = fields.cliff(fx, fy)
    level[i] = c > 1.5 ? 2 : c > 0.5 ? 1 : 0
  }

  // ── 建筑 ──
  // 机场：南边正中，门朝南（对着镜头）；门前留一片空地，再往南是沙滩
  const ax = Math.round(W / 2 - 4.5)
  let ay = bottom - 1
  while (ay > H / 2 && types[ay * W + Math.round(W / 2)] !== IT.GRASS) ay--
  ay -= 9
  const airport: Building = { kind: 'airport', x: ax, y: ay, w: 9, h: 5 }
  // 广场：机场正北，岛中间偏南（一定在第 0 层）
  let py = Math.round(top + ISLE_LH * 0.52)
  while (py < ay - 14 && level[py * W + Math.round(W / 2)] > 0) py++
  const plaza: Building = { kind: 'plaza', x: Math.round(W / 2 - 6), y: py, w: 12, h: 8 }
  // 码头：东岸或西岸的沙滩，往海里伸 6 格。从岸边往里最多找 25 格沙滩，旁边要是海；找不到就换一行、换一边
  const east0 = r() < 0.5
  let dock: Building | null = null
  for (let k = 0; k < 40 && !dock; k++) {
    const east = k % 2 ? !east0 : east0
    const dyk = Math.round(top + ISLE_LH * (0.5 + ((k * 0.37) % 1) * 0.3))
    for (let n = 0; n < 25; n++) {
      const x = east ? W - 1 - n : n
      const t = types[dyk * W + x]
      if (t === IT.SAND || t === IT.GRASS) {
        const sea = types[dyk * W + x + (east ? 1 : -1)]
        if (t === IT.SAND && (sea === IT.SHALLOW || sea === IT.DEEP) && types[(dyk + 1) * W + x] === IT.SAND) dock = { kind: 'dock', x: east ? x : x - 6, y: dyk, w: 7, h: 2 }
        break
      }
    }
  }
  if (!dock) dock = { kind: 'dock', x: W - M - 2, y: Math.round(top + ISLE_LH * 0.6), w: 7, h: 2 }

  // ── 阻挡：水、悬崖（第 0 天还没有梯子，高处都上不去）、建筑 ──
  const blocked = new Uint8Array(W * H)
  for (let i = 0; i < W * H; i++) blocked[i] = isWaterT(types[i]) || level[i] > 0 ? 1 : 0
  for (const b of [airport]) for (let y = b.y; y < b.y + b.h; y++) for (let x = b.x; x < b.x + b.w; x++) blocked[y * W + x] = 1
  for (let y = dock.y; y < dock.y + dock.h; y++) for (let x = dock.x; x < dock.x + dock.w; x++) if (isWaterT(types[y * W + x])) blocked[y * W + x] = 0

  // 机场门口
  const arrive = { x: (airport.x + airport.w / 2) * TILE, y: (airport.y + airport.h + 1.2) * TILE }
  const b0 = Uint8Array.from(blocked)
  // 从机场出发能走到的范围
  const start = new Uint8Array(W * H)
  const q = [Math.floor(arrive.y / TILE) * W + Math.floor(arrive.x / TILE)]
  start[q[0]] = 1
  while (q.length) {
    const i = q.pop()!, x = i % W
    for (const j of [x > 0 ? i - 1 : -1, x < W - 1 ? i + 1 : -1, i - W, i + W]) {
      if (j < 0 || j >= W * H || start[j] || blocked[j]) continue
      start[j] = 1; q.push(j)
    }
  }

  if (!force) {
    let bad = 0, inStart = 0
    for (let y = plaza.y; y < plaza.y + plaza.h; y++) for (let x = plaza.x; x < plaza.x + plaza.w; x++) { if (blocked[y * W + x]) bad++; if (start[y * W + x]) inStart++ }
    const startTiles = start.reduce((a, b) => a + b, 0)
    if (bad > 2 || inStart < plaza.w * plaza.h * 0.8 || startTiles < 1300 || startTiles > 4200) return null
  }

  // ── 物件 ──
  const objects: IsleObj[] = []
  const occ = new Uint8Array(W * H)   // 已经有东西的格子（含周围一圈留白）
  const reserve = (b: Building, pad: number) => { for (let y = b.y - pad; y < b.y + b.h + pad; y++) for (let x = b.x - pad; x < b.x + b.w + pad; x++) if (x >= 0 && y >= 0 && x < W && y < H) occ[y * W + x] = 1 }
  reserve(airport, 2); reserve(plaza, 1); reserve(dock, 1)
  for (let y = airport.y + airport.h; y < airport.y + airport.h + 4; y++) for (let x = airport.x - 1; x < airport.x + airport.w + 1; x++) occ[y * W + x] = 1
  const free = (x: number, y: number, rad: number, needStart = false) => {
    for (let yy = y - rad; yy <= y + rad; yy++) for (let xx = x - rad; xx <= x + rad; xx++) {
      if (xx < 0 || yy < 0 || xx >= W || yy >= H) return false
      const i = yy * W + xx
      if (occ[i] || blocked[i]) return false
    }
    return !needStart || start[y * W + x] === 1
  }
  // 地形上能不能摆：草地、同一层（不压在崖边上）、没被占
  const freeT = (x: number, y: number, rad: number) => {
    const lv = level[y * W + x]
    for (let yy = y - rad; yy <= y + rad; yy++) for (let xx = x - rad; xx <= x + rad; xx++) {
      if (xx < 0 || yy < 0 || xx >= W || yy >= H) return false
      const i = yy * W + xx
      if (occ[i] || isWaterT(types[i]) || level[i] !== lv || (b0[i] && level[i] === 0)) return false
    }
    return level[(y - 1) * W + x] === lv && level[(y + 1) * W + x] === lv
  }
  const take = (x: number, y: number, rad: number) => { for (let yy = y - rad; yy <= y + rad; yy++) for (let xx = x - rad; xx <= x + rad; xx++) occ[yy * W + xx] = 1 }
  let nid = 1
  const add = (kind: string, tx: number, ty: number, o: Partial<IsleObj> = {}) => {
    objects.push({ id: nid++, kind, x: (tx + 0.5) * TILE + (hash2(tx, ty, seed + 31) - 0.5) * 6, y: (ty + 0.75) * TILE, ...o })
  }
  // 树：抖动网格撒点，离广场、机场越远越密；悬崖上也有（只是现在上不去）
  const trees: [number, number][] = []
  for (let gy = 0; gy < H; gy += 3) for (let gx = 0; gx < W; gx += 3) {
    const x = gx + Math.floor(r() * 3), y = gy + Math.floor(r() * 3)
    if (x >= W || y >= H || types[y * W + x] !== IT.GRASS) continue
    const dPlaza = Math.hypot(x - (plaza.x + plaza.w / 2), y - (plaza.y + plaza.h / 2))
    const dens = 0.18 + 0.32 * clamp((dPlaza - 10) / 30, 0, 1) + (fbm(x * 0.08, y * 0.08, seed + 21) - 0.5) * 0.5
    if (r() > dens || !freeT(x, y, 1)) continue
    take(x, y, 1)
    trees.push([x, y])
  }
  // 特产水果树：广场附近、能走到的地方 8 棵（第 0 天要摘 6 个水果）
  const fruitSpots: [number, number][] = []
  for (let tries = 0; tries < 4000 && fruitSpots.length < 8; tries++) {
    const a = r() * Math.PI * 2, d = 7 + r() * 16
    const x = Math.round(plaza.x + plaza.w / 2 + Math.cos(a) * d * 1.3), y = Math.round(plaza.y + plaza.h / 2 + Math.sin(a) * d)
    if (x < 0 || y < 0 || x >= W || y >= H || types[y * W + x] !== IT.GRASS || !free(x, y, 1, true)) continue
    take(x, y, 1); fruitSpots.push([x, y])
  }
  for (const [x, y] of fruitSpots) add('fruit_tree', x, y, { flip: r() < 0.5 })
  for (const [x, y] of trees) add('tree', x, y, { flip: r() < 0.5 })
  // 椰子树：沙滩上靠草地那一侧
  for (let n = 0, tries = 0; n < 14 && tries < 3000; tries++) {
    const x = Math.floor(r() * W), y = Math.floor(r() * H)
    if (types[y * W + x] !== IT.SAND || fields.sand(x + 0.5, y + 0.5) < -2.2 || !free(x, y, 1)) continue
    take(x, y, 1); add(r() < 0.5 ? 'palm_a' : 'palm_b', x, y, { flip: r() < 0.5 }); n++
  }
  // 石头：6 块（第 0 层、能走到的地方至少 3 块），其中一块是钱石（每天换，由服务端决定）
  for (let n = 0, tries = 0; n < 6 && tries < 5000; tries++) {
    const x = Math.floor(r() * W), y = Math.floor(r() * H)
    if (types[y * W + x] !== IT.GRASS || !(n < 3 ? free(x, y, 1, true) : freeT(x, y, 1))) continue
    if ([IT.RIVER, IT.POND].some(t => [-2, 2].some(d => types[y * W + x + d] === t || types[(y + d) * W + x] === t))) continue
    take(x, y, 1); add('rock', x, y); n++
  }
  // 花：特产花一丛一丛
  for (let n = 0, tries = 0; n < 10 && tries < 3000; tries++) {
    const x = Math.floor(r() * W), y = Math.floor(r() * H)
    if (types[y * W + x] !== IT.GRASS || !freeT(x, y, 0)) continue
    const k = 2 + Math.floor(r() * 3)
    for (let j = 0; j < k; j++) {
      const fx = x + Math.floor(r() * 3) - 1, fy = y + Math.floor(r() * 3) - 1
      if (types[fy * W + fx] === IT.GRASS && freeT(fx, fy, 0)) { occ[fy * W + fx] = 1; add(flower, fx, fy) }
    }
    n++
  }
  // 杂草
  for (let n = 0, tries = 0; n < 30 && tries < 3000; tries++) {
    const x = Math.floor(r() * W), y = Math.floor(r() * H)
    if (types[y * W + x] !== IT.GRASS || !freeT(x, y, 0)) continue
    occ[y * W + x] = 1; add('weed', x, y, { flip: r() < 0.5 }); n++
  }
  // 树枝：散在能走到的阔叶树旁边，至少 14 根（第 0 天要捡 10 根）
  const reachTrees = trees.filter(([x, y]) => start[(y + 1) * W + x] || start[(y + 2) * W + x])
  for (let n = 0, tries = 0; n < 16 && tries < 4000; tries++) {
    const [tx, ty] = reachTrees[Math.floor(r() * reachTrees.length)] ?? [0, 0]
    const x = tx + Math.floor(r() * 5) - 2, y = ty + 1 + Math.floor(r() * 2)
    if (x < 0 || y < 0 || x >= W || y >= H || types[y * W + x] !== IT.GRASS || !start[y * W + x] || occ[y * W + x]) continue
    occ[y * W + x] = 1; add('branch', x, y, { flip: r() < 0.5 }); n++
  }
  // 树干、石头挡路
  for (const o of objects) if (o.kind === 'tree' || o.kind === 'fruit_tree' || o.kind.startsWith('palm') || o.kind === 'rock') {
    blocked[Math.floor((o.y - 2) / TILE) * W + Math.floor(o.x / TILE)] = 1
  }
  return { seed, fruit, flower, types, level, blocked, objects, airport, plaza, dock, arrive, start, fields }
}

// 小地图（机场柜台挑岛、手机地图用）：每地块一个像素，RGBA
export function isleMinimap(isle: Isle): Uint8ClampedArray {
  const W = ISLE_W, H = ISLE_H, out = new Uint8ClampedArray(W * H * 4)
  const col: Record<number, number[]> = {
    [IT.DEEP]: [52, 120, 196], [IT.SHALLOW]: [86, 186, 212], [IT.SAND]: [240, 226, 178],
    [IT.GRASS]: [118, 196, 96], [IT.RIVER]: [92, 168, 226], [IT.POND]: [92, 168, 226],
  }
  for (let i = 0; i < W * H; i++) {
    let c = col[isle.types[i]]
    if (isle.types[i] === IT.GRASS && isle.level[i]) c = isle.level[i] === 1 ? [96, 168, 80] : [78, 142, 66]
    out.set([c[0], c[1], c[2], 255], i * 4)
  }
  const paint = (b: Building, c: number[]) => { for (let y = b.y; y < b.y + b.h; y++) for (let x = b.x; x < b.x + b.w; x++) out.set([c[0], c[1], c[2], 255], (y * W + x) * 4) }
  paint(isle.plaza, [236, 200, 120]); paint(isle.airport, [230, 230, 236]); paint(isle.dock, [176, 120, 72])
  for (const o of isle.objects) if (o.kind === 'tree' || o.kind === 'fruit_tree') {
    const i = Math.floor((o.y - 2) / TILE) * W + Math.floor(o.x / TILE)
    out.set(o.kind === 'fruit_tree' ? [214, 98, 70, 255] : [58, 120, 58, 255], i * 4)
  }
  return out
}
