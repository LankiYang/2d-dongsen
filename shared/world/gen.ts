// 通用地图生成器（前后端共用，完全由种子决定）。
//
// 分两层：
//  1. 骨架（makeWorld 时一次算完，数据量很小）：聚落位置、道路折线、房子和院子摆设
//  2. 区块（genChunk 按需算）：地块类型、阻挡、植被散布。任意区块都能单独算，结果与相邻区块无缝衔接，
//     所以地图可以非常大——只算玩家附近的区块。
//
// 地形由一组连续场定义（地块坐标，浮点）：陆地高度、温度、湿度、河流、熔岩、海岸、到道路的距离。
// 服务端按地块中心取样判断能不能走；客户端在 3 像素网格上取样再插值，画出有机的边缘。
import { fbm, hash2, rng } from '../noise.ts'
import { TILE } from '../data.ts'
import { SOLID_SIZE } from '../island.ts'
import { BIOMES, CHUNK, TERRAIN, TID } from './defs.ts'
import type { BiomeDef, Scatter } from './defs.ts'

export type MapKind = 'island' | 'archipelago' | 'continent' | 'cave'
export interface MapDef {
  id: string
  name: string
  kind: MapKind
  w: number; h: number   // 地块
  seed: number
  biome?: string         // 固定群系（大陆按气候自动分）
  islands?: number       // 群岛：岛的数量
  settlements?: number   // 村子数量
  rivers?: boolean
}

export type Rect = [number, number, number, number]
export interface Road { pts: [number, number][], w: number }
export interface Decor { k: string, dx: number, dy: number, solid?: boolean, flip?: boolean, sway?: number }
export interface Lot { id: number, x: number, y: number, style: string, decor: Decor[] }
export interface Settlement { id: number, x: number, y: number, r: number, biome: string, lots: Lot[], name: string }
// 传送石：到达和离开这张地图都在这里。x/y 是站位（石碑正前方），石碑本身在站位北边 1.1 格
export interface Portal { id: number, x: number, y: number, name: string }
// 骨架里的固定物件（房子、院子摆设、井、路灯……），坐标是地块、锚点在底边中心
export interface Feature {
  kind: string
  x: number; y: number
  block?: Rect           // 按地块阻挡（含两端）
  sway?: number
  flip?: boolean
  light?: { r: number, color: number }
  solid?: boolean
  lot?: number
}
// 区块里输出的物件：坐标换成像素（和岛屿场景的 IslandObject 一致）
export interface WObj {
  kind: string
  x: number; y: number
  sway?: number
  flip?: boolean
  light?: { r: number, color: number }
  lot?: number
  rect?: Rect            // 像素碰撞底座
}
export interface ChunkData {
  cx: number; cy: number
  types: Uint8Array      // CHUNK×CHUNK 地块类型
  blocked: Uint8Array
  objects: WObj[]
  solids: Rect[]
}

// 连续场取样向量的下标
export const F = { LAND: 0, TEMP: 1, MOIST: 2, RIVER: 3, LAVA: 4, SHORE: 5, ROAD: 6, VOLC: 7, POOL: 8, N: 9 } as const

export const BIOME_KEYS = Object.keys(BIOMES)
const BIOME_IDX: Record<string, number> = Object.fromEntries(BIOME_KEYS.map((k, i) => [k, i]))

const clamp01 = (v: number) => Math.max(0, Math.min(1, v))
// 平滑并集：两块陆地之间自然连成地峡
function smax(a: number, b: number, k: number) {
  const h = clamp01(0.5 + (b - a) / (2 * k))
  return a * (1 - h) + b * h + k * h * (1 - h)
}
function segDist(px: number, py: number, ax: number, ay: number, bx: number, by: number) {
  const dx = bx - ax, dy = by - ay
  const l2 = dx * dx + dy * dy
  const t = l2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l2)) : 0
  return Math.hypot(px - ax - t * dx, py - ay - t * dy)
}

// 按格子分桶的空间索引（道路线段、圆形广场、禁放区）
const GRID = 8
class Buckets<T> {
  map = new Map<number, T[]>()
  add(x0: number, y0: number, x1: number, y1: number, item: T) {
    for (let gy = Math.floor(y0 / GRID); gy <= Math.floor(y1 / GRID); gy++) for (let gx = Math.floor(x0 / GRID); gx <= Math.floor(x1 / GRID); gx++) {
      const k = gy * 65536 + gx
      const l = this.map.get(k)
      if (l) l.push(item); else this.map.set(k, [item])
    }
  }
  at(x: number, y: number) { return this.map.get(Math.floor(y / GRID) * 65536 + Math.floor(x / GRID)) }
}
type Seg = { ax: number, ay: number, bx: number, by: number, w: number } | { cx: number, cy: number, r: number }

export class World {
  def: MapDef
  roads: Road[] = []
  settlements: Settlement[] = []
  features: Feature[] = []
  portals: Portal[] = []
  private roadIdx = new Buckets<Seg>()
  private noGo = new Buckets<Rect>()        // 植被禁放区（院子、广场）
  private featIdx = new Buckets<Feature>()
  private landFn: (x: number, y: number) => number
  private shallowDepth: number
  private chunkCache = new Map<number, ChunkData>()

  constructor(def: MapDef) {
    this.def = def
    this.landFn = makeLand(def)
    this.shallowDepth = def.kind === 'continent' ? 0.07 : 0.13
    if (def.kind !== 'cave') this.buildSkeleton()
    if (!this.portals.length) this.wildPortal()
  }

  // 立一块传送石（站位 x,y），周围 3 格不长植物
  private addPortal(x: number, y: number, name: string) {
    this.portals.push({ id: this.portals.length, x, y, name })
    this.addFeature({ kind: 'waystone_crystal', x, y: y - 1.1, solid: true, light: { r: 72, color: 0x6fe3ff } })
    this.noGo.add(x - 4, y - 5, x + 4, y + 3, [x - 2.5, y - 3.5, x + 2.5, y + 1.5])
  }
  // 没有村子的地图（洞穴、火山岛）：从中心往外找一块开阔地放传送石
  private wildPortal() {
    const open = (x: number, y: number) => {
      for (let oy = -2; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) if (this.blockedAt(Math.floor(x + ox), Math.floor(y + oy))) return false
      return true
    }
    let at = { x: this.def.w / 2, y: this.def.h / 2 }
    search: for (let r = 0; r < Math.max(this.def.w, this.def.h) / 2; r += 1) for (let a = 0; a < 24; a++) {
      const x = this.def.w / 2 + Math.cos(a / 24 * Math.PI * 2) * r, y = this.def.h / 2 + Math.sin(a / 24 * Math.PI * 2) * r
      if (open(x, y)) { at = { x: Math.floor(x) + 0.5, y: Math.floor(y) + 0.5 }; break search }
    }
    this.addPortal(at.x, at.y, this.def.kind === 'cave' ? '洞口' : '渡口')
    this.chunkCache.clear() // 找空地时生成的区块里还没有这块石碑
  }

  // ── 连续场 ──
  sample(x: number, y: number, out = new Float32Array(F.N)): Float32Array {
    const d = this.def, s = d.seed
    const land = this.landFn(x, y)
    out[F.LAND] = land
    if (d.kind === 'continent') {
      out[F.TEMP] = 0.08 + 0.9 * (y / d.h) + (fbm(x / 120, y / 120, s + 21) - 0.5) * 0.5 - Math.max(0, land - 0.45) * 0.6
      out[F.MOIST] = fbm(x / 140, y / 140, s + 31) * 1.3 - 0.15
      out[F.VOLC] = fbm(x / 90, y / 90, s + 61, 3) - 0.7
    } else { out[F.TEMP] = 0.5; out[F.MOIST] = 0.5; out[F.VOLC] = -1 }
    // 河流：扭曲过的噪声的等值线，只在大陆上
    if (d.kind === 'continent' && d.rivers !== false && land > 0.02) {
      const wx = x + (fbm(x / 40, y / 40, s + 41) - 0.5) * 50, wy = y + (fbm(x / 40, y / 40, s + 42) - 0.5) * 50
      const n = fbm(wx / 170, wy / 170, s + 43)
      out[F.RIVER] = Math.abs(n - 0.5) * 170 - (0.9 + Math.min(1.6, land * 3))  // 约等于到河心的距离 - 河宽（地块）
    } else out[F.RIVER] = 99
    out[F.LAVA] = 0.68 - fbm(x * 0.06, y * 0.06, s + 51, 3)
    out[F.SHORE] = land - ((d.kind === 'continent' ? 0.05 : 0.1) + (fbm(x * 0.5, y * 0.5, s + 11) - 0.5) * 0.06)
    out[F.ROAD] = this.roadEdge(x, y) - (fbm(x * 0.9, y * 0.9, 3) - 0.5) * 0.5
    out[F.POOL] = d.kind === 'cave' ? fbm(x * 0.09, y * 0.09, s + 9, 3) - 0.3 : 1
    return out
  }

  biomeOf(v: Float32Array): number {
    const d = this.def
    if (d.biome) return BIOME_IDX[d.biome]
    if (d.kind === 'cave') return BIOME_IDX.cave
    const t = v[F.TEMP], m = v[F.MOIST]
    if (v[F.VOLC] > 0 && v[F.LAND] > 0.2) return BIOME_IDX.volcanic
    if (t < 0.28) return BIOME_IDX.snow
    if (t < 0.45) return BIOME_IDX.forest
    if (t > 0.7 && m < 0.42) return BIOME_IDX.desert
    if (t > 0.6 && m > 0.45) return BIOME_IDX.tropical
    if (m > 0.62) return BIOME_IDX.forest
    return BIOME_IDX.meadow
  }

  // 由取样向量判断地形。jitter 用来让群系交界处抖动过渡（按像素给一点随机偏移）
  classifyV(v: Float32Array, jitter = 0): number {
    const d = this.def
    const land = v[F.LAND]
    if (d.kind === 'cave') {
      if (land <= 0) return TID.cavewall
      if (v[F.ROAD] < 0) return TID.path
      if (v[F.POOL] < 0 && land > 0.03) return TID.shallow
      return TID.cave
    }
    let bi = this.biomeOf(v)
    if (jitter && d.kind === 'continent') {
      const t = v[F.TEMP]; v[F.TEMP] = t + jitter * 0.012
      bi = this.biomeOf(v); v[F.TEMP] = t
    }
    const b = BIOMES[BIOME_KEYS[bi]]
    const road = v[F.ROAD] < 0
    if (land <= 0) {
      const shallow = land > -this.shallowDepth
      if (shallow && road) return TID.bridge
      if (shallow && b.water) return TID[b.water]
      return shallow ? TID.shallow : TID.deep
    }
    if (v[F.RIVER] < 0) return road ? TID.bridge : b.water ? TID[b.water] : TID.shallow
    if (b.key === 'volcanic' && v[F.LAVA] < 0 && !road && land > 0.12) return TID.lava
    if (road) return TID.path
    if (v[F.SHORE] < 0) return TID[b.shore]
    return TID[b.ground]
  }

  terrainAt(x: number, y: number) { return this.classifyV(this.sample(x, y)) }
  biomeAt(x: number, y: number) { return BIOME_KEYS[this.biomeOf(this.sample(x, y))] }

  // 到最近道路/广场边缘的距离（负数 = 在路面上）
  roadEdge(x: number, y: number): number {
    const list = this.roadIdx.at(x, y)
    if (!list) return 99
    let d = 99
    for (const s of list) {
      if ('r' in s) d = Math.min(d, Math.hypot(x - s.cx, (y - s.cy) * 1.15) - s.r)
      else d = Math.min(d, segDist(x, y, s.ax, s.ay, s.bx, s.by) - s.w)
    }
    return d
  }

  private addRoad(r: Road) {
    this.roads.push(r)
    for (let i = 0; i < r.pts.length - 1; i++) {
      const [ax, ay] = r.pts[i], [bx, by] = r.pts[i + 1]
      const m = r.w + 3
      this.roadIdx.add(Math.min(ax, bx) - m, Math.min(ay, by) - m, Math.max(ax, bx) + m, Math.max(ay, by) + m, { ax, ay, bx, by, w: r.w })
    }
  }
  private addFeature(f: Feature) {
    this.features.push(f)
    this.featIdx.add(f.x - 2, f.y - 2, f.x + 2, f.y + 2, f)
  }

  // ── 骨架：聚落 → 道路 → 街道上排房子 ──
  private buildSkeleton() {
    const d = this.def, r = rng(d.seed * 7919 + 13)
    const v = new Float32Array(F.N)
    // 1. 聚落选址：粗网格上找够大、够平的陆地，互相隔开
    const step = d.kind === 'continent' ? 6 : 2
    const minLand = d.kind === 'continent' ? 0.3 : 0.22
    const want = d.settlements ?? (d.kind === 'island' ? 1 : d.kind === 'archipelago' ? Math.ceil((d.islands ?? 6) * 0.6) : Math.round((d.w * d.h) / 30000))
    const minDist = d.kind === 'continent' ? 90 : d.kind === 'archipelago' ? 18 : 30
    const cands: [number, number, number][] = []
    for (let y = 10; y < d.h - 10; y += step) for (let x = 10; x < d.w - 10; x += step) {
      this.sample(x, y, v)
      if (v[F.LAND] < minLand || v[F.RIVER] < 3) continue
      const bk = BIOME_KEYS[this.biomeOf(v)]
      if (bk === 'volcanic' || bk === 'cave') continue
      // 四周也要是陆地：北边一排房子、南边后街和第二排房子、东西两条街都要摆得下
      let ok = true
      for (const [ox, oy] of [[-12, 0], [12, 0], [0, -6], [0, 11], [-12, 9], [12, 9], [-6, -5], [6, -5]]) { this.sample(x + ox, y + oy, v); if (v[F.LAND] < 0.1 || v[F.RIVER] < 1) { ok = false; break } }
      if (ok) cands.push([x, y, r()])
    }
    cands.sort((a, b) => a[2] - b[2])
    for (const [x, y] of cands) {
      if (this.settlements.length >= want) break
      if (this.settlements.some(s => Math.hypot(s.x - x, s.y - y) < minDist)) continue
      this.sample(x, y, v)
      const biome = BIOME_KEYS[this.biomeOf(v)]
      this.settlements.push({ id: this.settlements.length, x, y, r: 2.8, biome, lots: [], name: villageName(biome, this.settlements.length, d.seed, this.settlements.map(o => o.name)) })
    }
    for (const s of this.settlements) this.roadIdx.add(s.x - 6, s.y - 6, s.x + 6, s.y + 6, { cx: s.x, cy: s.y, r: s.r })

    // 2. 道路：最小生成树 + 少量额外连线，每条用 A* 在粗网格上绕开深水和熔岩
    const edges = mstEdges(this.settlements.map(s => [s.x, s.y]))
    const cost = this.costGrid()
    const streets = new Map<number, [number, number][][]>()
    for (const [a, b] of edges) {
      const A = this.settlements[a], B = this.settlements[b]
      const path = cost.path(A.x, A.y, B.x, B.y)
      if (!path) continue // 隔着深海（群岛之间靠船）
      const pts = smooth(simplify(path))
      this.addRoad({ pts, w: 0.85 })
      cost.markRoad(path)
      pushMap(streets, a, pts)
      pushMap(streets, b, [...pts].reverse())
    }

    // 3. 每个聚落：街道 = 从广场出发的道路前 26 格，不够两条就补东西两条短街；沿街排房子
    for (const s of this.settlements) {
      const list = (streets.get(s.id) ?? []).map(p => cut(p, 26))
      const landOk = (pts: [number, number][]) => pts.every(([x, y]) => (this.sample(x, y, v), v[F.LAND] > 0.05 && v[F.RIVER] > 0.5))
      // 横街：从广场往东西方向弯出去，能多长就多长（最多 24 格）
      const street = (x: number, y: number, dir: number, phase: number) => {
        const pts: [number, number][] = [[x, y]]
        for (let k = 1; k <= 6; k++) {
          const p: [number, number] = [x + dir * k * 4, y + Math.sin(k * 0.9 + phase) * 0.9]
          if (!landOk([p, [p[0], p[1] - 4.5]])) break
          pts.push(p)
        }
        return pts.length >= 3 ? smooth(pts) : null
      }
      for (const dir of [1, -1]) {
        if (list.length >= 2) break
        const st = street(s.x, s.y, dir, s.id)
        if (st) { this.addRoad({ pts: st, w: 0.8 }); list.push(st) }
      }
      // 后街：广场往南 8.5 格再开一条平行的横街，用一小段竖巷接回广场（第二排房子朝它开门）
      const by = s.y + 8.5
      if (landOk([[s.x, s.y + 3], [s.x, by], [s.x, by + 1.5]])) {
        this.addRoad({ pts: [[s.x, s.y + s.r], [s.x, by]], w: 0.75 })
        for (const dir of [1, -1]) {
          const st = street(s.x, by, dir, s.id + 2)
          if (st) { this.addRoad({ pts: st, w: 0.75 }); list.push(st) }
        }
      }
      this.layoutLots(s, list, r)
      // 广场：井、公告栏、盆栽
      this.addFeature({ kind: 'well_front', x: s.x, y: s.y + 0.3, block: [Math.floor(s.x) - 1, Math.floor(s.y), Math.floor(s.x), Math.floor(s.y)] })
      this.addFeature({ kind: 'notice_board', x: s.x + 2.4, y: s.y - 2.4, solid: true })
      if (s.biome === 'tropical') this.addFeature({ kind: 'potted_palm', x: s.x + 3.9, y: s.y - 0.7, solid: true })
      // 广场西北角（和公告栏对称）立传送石
      this.addPortal(s.x - 2.4, s.y - 1.3, s.name)
      this.noGo.add(s.x - 6, s.y - 6, s.x + 6, s.y + 6, [s.x - 5.5, s.y - 5.5, s.x + 5.5, s.y + 5.5])
    }
  }

  private layoutLots(s: Settlement, streets: [number, number][][], r: () => number) {
    const v = new Float32Array(F.N)
    const biome = BIOMES[s.biome]
    const styles = biome.house ?? ['house_stone']
    const taken: Rect[] = [[s.x - 5, s.y - 5, s.x + 5, s.y + 4]]
    const maxLots = 6 + Math.floor(r() * 5)
    const landOk = (x: number, y: number) => { this.sample(x, y, v); return v[F.LAND] > 0.06 && v[F.RIVER] > 0.5 && !(biome.key === 'volcanic' && v[F.LAVA] < 0) }
    for (const st of streets) {
      for (const [px, py, dx, dy] of along(st, 7, 8.2)) {
        if (s.lots.length >= maxLots) return
        const horiz = Math.abs(dx) >= Math.abs(dy)
        const sides = horiz ? [0] : [1, -1]
        for (const side of sides) {
          if (s.lots.length >= maxLots) return
          const hx = horiz ? px : px + side * 4.6, hy = horiz ? py - 1.5 : py
          const rect: Rect = [hx - 3.4, hy - 3.2, hx + 3.4, hy + 0.4]
          if (taken.some(t => rect[0] < t[2] + 0.6 && rect[2] > t[0] - 0.6 && rect[1] < t[3] + 0.6 && rect[3] > t[1] - 0.6)) continue
          let ok = true
          for (let yy = rect[1]; yy <= rect[3] && ok; yy += 1) for (let xx = rect[0]; xx <= rect[2] && ok; xx += 1) {
            if (!landOk(xx, yy) || this.roadEdge(xx, yy) < 0.2) ok = false
          }
          if (!ok) continue
          taken.push(rect)
          const id = this.settlements.reduce((n, x) => n + x.lots.length, 0)
          const tpl = LOT_DECOR[Math.floor(r() * LOT_DECOR.length)]
          const mirror = r() < 0.5 ? -1 : 1
          const lot: Lot = { id, x: hx, y: hy, style: styles[Math.floor(r() * styles.length)], decor: tpl.map(dc => ({ ...dc, dx: dc.dx * mirror, flip: mirror < 0 ? !dc.flip : dc.flip })) }
          s.lots.push(lot)
          // 门前小路
          const door: [number, number] = [hx, hy + 0.25]
          this.addRoad({ w: 0.5, pts: horiz ? [door, [hx, py]] : [door, [hx, hy + 1.3], [px, hy + 1.3]] })
          this.addFeature({ kind: lot.style, x: hx, y: hy, lot: id, block: [Math.floor(hx - 2.9), Math.floor(hy - 2.6), Math.floor(hx + 2.8), Math.floor(hy - 0.45)], light: { r: 52, color: 0xffc36b } })
          for (const dc of lot.decor) {
            const fx = hx + dc.dx, fy = hy + dc.dy
            if (!landOk(fx, fy) || this.roadEdge(fx, fy) < 0.1) continue
            this.addFeature({ kind: dc.k, x: fx, y: fy, solid: dc.solid !== false, flip: dc.flip, sway: dc.sway, lot: id })
          }
          this.noGo.add(hx - 7, hy - 6, hx + 7, hy + 3, [hx - 6.5, hy - 5, hx + 6.5, hy + 2.8])
        }
      }
      // 沿街路灯
      for (const [px, py, dx, dy] of along(st, 5, 9)) {
        const lx = px - dy * 1.4, ly = py + dx * 1.4
        if (landOk(lx, ly) && this.roadEdge(lx, ly) > 0.1 && !taken.some(t => lx > t[0] && lx < t[2] && ly > t[1] && ly < t[3])) {
          this.addFeature({ kind: 'lantern', x: lx, y: ly, solid: true, light: { r: 64, color: 0xffcf7a } })
        }
      }
    }
  }

  // A* 用的代价网格
  private costGrid() {
    const d = this.def
    const C = d.kind === 'continent' ? 4 : 1
    const gw = Math.ceil(d.w / C), gh = Math.ceil(d.h / C)
    const cost = new Float32Array(gw * gh)
    const v = new Float32Array(F.N)
    for (let gy = 0; gy < gh; gy++) for (let gx = 0; gx < gw; gx++) {
      this.sample(gx * C + C / 2, gy * C + C / 2, v)
      const t = TERRAIN[this.classifyV(v)].key
      cost[gy * gw + gx] = t === 'deep' || t === 'lava' || t === 'cavewall' ? Infinity
        : t === 'shallow' ? (v[F.LAND] > 0 ? 10 : 22) : t === 'ice' ? 2 : v[F.SHORE] < 0 ? 1.6 : 1
    }
    return {
      markRoad(path: [number, number][]) { for (const [x, y] of path) { const i = Math.floor(y / C) * gw + Math.floor(x / C); if (cost[i] < Infinity) cost[i] = Math.min(cost[i], 0.35) } },
      path(ax: number, ay: number, bx: number, by: number): [number, number][] | null {
        const start = Math.floor(ay / C) * gw + Math.floor(ax / C), goal = Math.floor(by / C) * gw + Math.floor(bx / C)
        const g = new Float32Array(gw * gh).fill(Infinity), from = new Int32Array(gw * gh).fill(-1)
        const heap = new Heap()
        g[start] = 0; heap.push(start, 0)
        const gx1 = goal % gw, gy1 = Math.floor(goal / gw)
        while (heap.size) {
          const cur = heap.pop()
          if (cur === goal) break
          const cx = cur % gw, cy = Math.floor(cur / gw)
          for (let k = 0; k < 8; k++) {
            const nx = cx + DX[k], ny = cy + DY[k]
            if (nx < 0 || ny < 0 || nx >= gw || ny >= gh) continue
            const n = ny * gw + nx
            const step = (k < 4 ? 1 : 1.414) * (cost[n] + cost[cur]) / 2
            if (!(step < Infinity)) continue
            const ng = g[cur] + step
            if (ng < g[n]) { g[n] = ng; from[n] = cur; heap.push(n, ng + Math.hypot(nx - gx1, ny - gy1) * 0.35) }
          }
        }
        if (from[goal] < 0) return null
        const out: [number, number][] = []
        for (let c = goal; c !== start; c = from[c]) out.push([(c % gw) * C + C / 2, Math.floor(c / gw) * C + C / 2])
        out.push([ax, ay]); out.reverse(); out[out.length - 1] = [bx, by]
        return out
      },
    }
  }

  // ── 区块 ──
  chunk(cx: number, cy: number): ChunkData {
    const key = cy * 65536 + cx
    let c = this.chunkCache.get(key)
    if (!c) {
      c = this.genChunk(cx, cy)
      this.chunkCache.set(key, c)
      if (this.chunkCache.size > 400) this.chunkCache.delete(this.chunkCache.keys().next().value!)
    }
    return c
  }

  genChunk(cx: number, cy: number): ChunkData {
    const x0 = cx * CHUNK, y0 = cy * CHUNK
    const types = new Uint8Array(CHUNK * CHUNK), blocked = new Uint8Array(CHUNK * CHUNK)
    const v = new Float32Array(F.N)
    for (let y = 0; y < CHUNK; y++) for (let x = 0; x < CHUNK; x++) {
      const tx = x0 + x, ty = y0 + y
      const t = tx >= this.def.w || ty >= this.def.h ? TID.deep : this.classifyV(this.sample(tx + 0.5, ty + 0.5, v))
      types[y * CHUNK + x] = t
      if (!TERRAIN[t].walk) blocked[y * CHUNK + x] = 1
    }
    const objects: WObj[] = [], solids: Rect[] = []
    const px = (t: number) => Math.round(t * TILE)
    const put = (o: WObj, solid: boolean, tier = 1) => {
      if (solid) {
        const sz = SOLID_SIZE[o.kind] ?? (tier >= 2 ? [10, 5] : [16, 6])
        o.rect = [o.x - sz[0] / 2, o.y - sz[1], o.x + sz[0] / 2, o.y]
        solids.push(o.rect)
      }
      objects.push(o)
    }
    // 骨架物件：房子挡整块地块，小物件用像素底座
    const seen = new Set<Feature>()
    for (let gy = Math.floor((y0 - 4) / GRID); gy <= Math.floor((y0 + CHUNK + 4) / GRID); gy++) for (let gx = Math.floor((x0 - 4) / GRID); gx <= Math.floor((x0 + CHUNK + 4) / GRID); gx++) {
      for (const f of this.featIdx.map.get(gy * 65536 + gx) ?? []) {
        if (seen.has(f)) continue
        seen.add(f)
        if (f.block) for (let by = f.block[1]; by <= f.block[3]; by++) for (let bx = f.block[0]; bx <= f.block[2]; bx++) {
          if (bx >= x0 && by >= y0 && bx < x0 + CHUNK && by < y0 + CHUNK) blocked[(by - y0) * CHUNK + bx - x0] = 1
        }
        if (f.x < x0 || f.y < y0 || f.x >= x0 + CHUNK || f.y >= y0 + CHUNK) continue
        put({ kind: f.kind, x: px(f.x), y: px(f.y), sway: f.sway, flip: f.flip, light: f.light, lot: f.lot }, !!f.solid && !f.block)
      }
    }
    // 植被散布
    const memo = new Map<string, Cand | null>()
    for (const [bi, b] of BIOME_KEYS.map((k, i) => [i, BIOMES[k]] as const)) {
      b.scatter.forEach((rule, ri) => {
        const sp = rule.spacing
        for (let j = Math.floor(y0 / sp); j <= Math.floor((y0 + CHUNK) / sp); j++) for (let i = Math.floor(x0 / sp); i <= Math.floor((x0 + CHUNK) / sp); i++) {
          const c = this.cand(memo, bi, b, ri, i, j)
          if (!c || c.x < x0 || c.y < y0 || c.x >= x0 + CHUNK || c.y >= y0 + CHUNK) continue
          put({ kind: c.kind, x: px(c.x), y: px(c.y), sway: rule.sway, flip: c.flip }, !!rule.solid, rule.tier)
        }
      })
    }
    objects.sort((a, b) => a.y - b.y)
    return { cx, cy, types, blocked, objects, solids }
  }

  // 抖动网格上 (i,j) 格的候选植物；和更高一级的候选靠太近就让位。结果只由坐标决定，区块边界两侧算出来一样
  private cand(memo: Map<string, Cand | null>, bi: number, b: BiomeDef, ri: number, i: number, j: number): Cand | null {
    const key = `${bi},${ri},${i},${j}`
    if (memo.has(key)) return memo.get(key)!
    const rule = b.scatter[ri], sd = this.def.seed + bi * 101 + ri * 7
    let res: Cand | null = null
    if (hash2(i, j, sd) < rule.chance) {
      const x = (i + 0.15 + hash2(i, j, sd + 1) * 0.7) * rule.spacing, y = (j + 0.15 + hash2(i, j, sd + 2) * 0.7) * rule.spacing
      if (x > 1 && y > 1 && x < this.def.w - 1 && y < this.def.h - 1 && this.okSpot(x, y, bi, rule)) {
        res = { x, y, kind: rule.kinds[Math.floor(hash2(i, j, sd + 3) * rule.kinds.length)], flip: hash2(i, j, sd + 4) < 0.5, r: rule.clear }
        // 让位给更高级别（更大）的植物
        for (let rk = 0; rk < b.scatter.length && res; rk++) {
          const big = b.scatter[rk]
          if (big.tier <= rule.tier && !(big.tier === rule.tier && rk < ri)) continue
          const bs = big.spacing, need = big.clear * 0.8 + rule.clear * 0.6 + 0.3
          for (let jj = Math.floor((y - need) / bs); jj <= Math.floor((y + need) / bs) && res; jj++) for (let ii = Math.floor((x - need) / bs); ii <= Math.floor((x + need) / bs) && res; ii++) {
            const o = this.cand(memo, bi, b, rk, ii, jj)
            if (o && Math.hypot(o.x - x, o.y - y) < need) res = null
          }
        }
      }
    }
    memo.set(key, res)
    return res
  }

  private okSpot(x: number, y: number, bi: number, rule: Scatter) {
    const v = this.sample(x, y)
    if (this.biomeOf(v) !== bi) return false
    const t = TERRAIN[this.classifyV(v)].key
    if (!rule.on.includes(t)) return false
    const land = v[F.LAND]
    if (rule.shore && land > 0.22) return false
    if (rule.inland && land < 0.25) return false
    if (v[F.ROAD] < rule.clear + 0.6 || v[F.RIVER] < rule.clear) return false
    if (this.def.kind === 'cave' && (land < 0.04 || v[F.POOL] < 0.03)) return false
    for (const r of this.noGo.at(x, y) ?? []) if (x > r[0] && x < r[2] && y > r[1] && y < r[3]) return false
    for (const f of this.featIdx.at(x, y) ?? []) if (Math.hypot(f.x - x, f.y - y) < rule.clear + 0.8) return false
    // 离水太近的大树会长进水里
    if (rule.tier >= 1) for (const [ox, oy] of [[0.6, 0], [-0.6, 0], [0, 0.5]]) {
      const w = TERRAIN[this.terrainAt(x + ox, y + oy)]
      if (!w.walk || w.key === 'path') return false
    }
    return true
  }

  // 到达点（地块坐标）= 第一块传送石的站位
  spawn(): { x: number, y: number } {
    const p = this.portals[0]
    return { x: p.x, y: p.y }
  }
  nearestPortal(x: number, y: number) {
    let best = this.portals[0], bd = Infinity
    for (const p of this.portals) { const d = Math.hypot(p.x - x, p.y - y); if (d < bd) { bd = d; best = p } }
    return { portal: best, dist: bd }
  }

  // 地块是否可走（服务端/客户端碰撞共用）
  blockedAt(tx: number, ty: number) {
    if (tx < 0 || ty < 0 || tx >= this.def.w || ty >= this.def.h) return true
    const c = this.chunk(Math.floor(tx / CHUNK), Math.floor(ty / CHUNK))
    return c.blocked[(ty - c.cy * CHUNK) * CHUNK + tx - c.cx * CHUNK] === 1
  }
}

interface Cand { x: number, y: number, kind: string, flip: boolean, r: number }

// ── 陆地场 ──
function makeLand(d: MapDef): (x: number, y: number) => number {
  const r = rng(d.seed * 31 + 7), s = d.seed
  const edge = (x: number, y: number, m: number) => Math.min(x, y, d.w - x, d.h - y) / m
  if (d.kind === 'island') {
    const lobes = [{ x: d.w / 2, y: d.h / 2, rx: d.w * 0.33, ry: d.h * 0.28 }]
    for (let k = 0; k < 2; k++) {
      const a = r() * Math.PI * 2
      lobes.push({ x: d.w / 2 + Math.cos(a) * d.w * 0.17, y: d.h / 2 + Math.sin(a) * d.h * 0.17, rx: d.w * (0.14 + r() * 0.1), ry: d.h * (0.12 + r() * 0.1) })
    }
    return (x, y) => {
      let v = -9
      for (const l of lobes) v = smax(v, 1 - Math.hypot((x - l.x) / l.rx, (y - l.y) / l.ry), 0.18)
      v += (fbm(x * 0.11, y * 0.11, s + 7) - 0.5) * 0.55 + (fbm(x * 0.035, y * 0.035, s + 8) - 0.5) * 0.35
      const e = edge(x, y, 6)
      return e < 1 ? v - (1 - e) : v
    }
  }
  if (d.kind === 'archipelago') {
    // 每座岛 = 一个主椭圆 + 1~3 个偏移的副块（平滑并集），岛与岛之间取最大值（隔着海不会粘在一起）
    type Blob = { x: number, y: number, rx: number, ry: number }
    const isl: { x: number, y: number, r: number, blobs: Blob[] }[] = []
    const n = d.islands ?? 6, base = Math.min(d.w, d.h)
    for (let tries = 0; isl.length < n && tries < 500; tries++) {
      const rr = base * (0.06 + r() * 0.07), asp = 0.7 + r() * 0.6
      const x = rr * 1.8 + r() * (d.w - rr * 3.6), y = rr * 1.8 + r() * (d.h - rr * 3.6)
      if (isl.some(o => Math.hypot(o.x - x, o.y - y) < (o.r + rr) * 1.45)) continue
      const blobs: Blob[] = [{ x, y, rx: rr * asp, ry: rr / asp }]
      for (let k = 0, m = 1 + Math.floor(r() * 3); k < m; k++) {
        const a = r() * Math.PI * 2, dd = rr * (0.45 + r() * 0.35), sr = rr * (0.35 + r() * 0.3)
        blobs.push({ x: x + Math.cos(a) * dd, y: y + Math.sin(a) * dd * 0.8, rx: sr * (0.8 + r() * 0.5), ry: sr * (0.8 + r() * 0.4) })
      }
      isl.push({ x, y, r: rr, blobs })
    }
    return (x, y) => {
      let v = -9
      for (const l of isl) {
        if (Math.abs(x - l.x) > l.r * 3 || Math.abs(y - l.y) > l.r * 3) continue
        let u = -9
        for (const b of l.blobs) u = smax(u, 1 - Math.hypot((x - b.x) / b.rx, (y - b.y) / b.ry), 0.25)
        v = Math.max(v, u)
      }
      if (v < -3) v = -1.5
      return v + (fbm(x * 0.11, y * 0.11, s + 7) - 0.5) * 0.6 + (fbm(x * 0.045, y * 0.045, s + 8) - 0.5) * 0.45
    }
  }
  if (d.kind === 'continent') {
    const m = Math.min(d.w, d.h) * 0.1
    return (x, y) => {
      let v = (fbm(x / 200, y / 200, s, 5) - 0.5) * 2.2 + 0.28 + (fbm(x * 0.08, y * 0.08, s + 9, 3) - 0.5) * 0.22
      const e = edge(x, y, m)
      if (e < 1) v -= (1 - e) * (1 - e) * 1.3
      return v
    }
  }
  // 洞穴：land > 0 是地面，<= 0 是岩壁。大厅（团状噪声）+ 隧道（噪声等值线）
  return (x, y) => {
    const hall = fbm(x * 0.065, y * 0.065, s, 3) - 0.53
    const tun = (0.04 - Math.abs(fbm(x * 0.022, y * 0.022, s + 5, 3) - 0.5)) * 2
    let v = Math.max(hall, tun)
    const e = edge(x, y, 8)
    if (e < 1) v -= (1 - e) * 0.6
    return v
  }
}

// ── 小工具 ──
const DX = [1, -1, 0, 0, 1, 1, -1, -1], DY = [0, 0, 1, -1, 1, -1, 1, -1]
class Heap {
  private ids: number[] = []; private pr: number[] = []
  get size() { return this.ids.length }
  push(id: number, p: number) {
    const a = this.ids, q = this.pr
    let i = a.length; a.push(id); q.push(p)
    while (i > 0) { const up = (i - 1) >> 1; if (q[up] <= p) break; a[i] = a[up]; q[i] = q[up]; i = up }
    a[i] = id; q[i] = p
  }
  pop(): number {
    const a = this.ids, q = this.pr, top = a[0]
    const id = a.pop()!, p = q.pop()!
    if (a.length) {
      let i = 0
      for (;;) {
        let c = i * 2 + 1
        if (c >= a.length) break
        if (c + 1 < a.length && q[c + 1] < q[c]) c++
        if (q[c] >= p) break
        a[i] = a[c]; q[i] = q[c]; i = c
      }
      a[i] = id; q[i] = p
    }
    return top
  }
}

function mstEdges(pts: number[][]): [number, number][] {
  const n = pts.length, inTree = new Array(n).fill(false), out: [number, number][] = []
  if (!n) return out
  const best = new Array(n).fill(Infinity), from = new Array(n).fill(-1)
  best[0] = 0
  for (let k = 0; k < n; k++) {
    let u = -1
    for (let i = 0; i < n; i++) if (!inTree[i] && (u < 0 || best[i] < best[u])) u = i
    inTree[u] = true
    if (from[u] >= 0) out.push([from[u], u])
    for (let i = 0; i < n; i++) {
      const dd = Math.hypot(pts[i][0] - pts[u][0], pts[i][1] - pts[u][1])
      if (!inTree[i] && dd < best[i]) { best[i] = dd; from[i] = u }
    }
  }
  // 额外连一些近邻，路网不至于全是树形死胡同
  for (let i = 0; i < n; i++) {
    let j = -1, bd = Infinity
    for (let k = 0; k < n; k++) {
      if (k === i || out.some(([a, b]) => (a === i && b === k) || (a === k && b === i))) continue
      const dd = Math.hypot(pts[i][0] - pts[k][0], pts[i][1] - pts[k][1])
      if (dd < bd) { bd = dd; j = k }
    }
    if (j >= 0 && hash2(i, j, 77) < 0.3) out.push([i, j])
  }
  return out
}

// 去掉共线的中间点
function simplify(p: [number, number][]): [number, number][] {
  if (p.length < 3) return p
  const out = [p[0]]
  for (let i = 1; i < p.length - 1; i++) {
    const [ax, ay] = out[out.length - 1], [bx, by] = p[i], [cx, cy] = p[i + 1]
    if (Math.abs((bx - ax) * (cy - ay) - (by - ay) * (cx - ax)) > 1e-6) out.push(p[i])
  }
  out.push(p[p.length - 1])
  return out
}
// Chaikin 平滑两遍：折线变成自然的弯
function smooth(p: [number, number][]): [number, number][] {
  let cur = p
  for (let it = 0; it < 2; it++) {
    const out: [number, number][] = [cur[0]]
    for (let i = 0; i < cur.length - 1; i++) {
      const [ax, ay] = cur[i], [bx, by] = cur[i + 1]
      out.push([ax * 0.75 + bx * 0.25, ay * 0.75 + by * 0.25], [ax * 0.25 + bx * 0.75, ay * 0.25 + by * 0.75])
    }
    out.push(cur[cur.length - 1])
    cur = out
  }
  return cur
}
// 折线前 len 格
function cut(p: [number, number][], len: number): [number, number][] {
  const out: [number, number][] = [p[0]]
  let acc = 0
  for (let i = 0; i < p.length - 1; i++) {
    const [ax, ay] = p[i], [bx, by] = p[i + 1], l = Math.hypot(bx - ax, by - ay)
    if (acc + l >= len) { const k = (len - acc) / l; out.push([ax + (bx - ax) * k, ay + (by - ay) * k]); return out }
    acc += l; out.push(p[i + 1])
  }
  return out
}
// 沿折线每隔 step 取一个点（从 start 开始），带单位方向
function along(p: [number, number][], start: number, step: number): [number, number, number, number][] {
  const out: [number, number, number, number][] = []
  let next = start, acc = 0
  for (let i = 0; i < p.length - 1; i++) {
    const [ax, ay] = p[i], [bx, by] = p[i + 1], l = Math.hypot(bx - ax, by - ay)
    while (l > 0 && next <= acc + l) {
      const k = (next - acc) / l
      out.push([ax + (bx - ax) * k, ay + (by - ay) * k, (bx - ax) / l, (by - ay) / l])
      next += step
    }
    acc += l
  }
  return out
}
function pushMap<K, V>(m: Map<K, V[]>, k: K, v: V) { const l = m.get(k); if (l) l.push(v); else m.set(k, [v]) }

// 村名：按群系取两个字，同一张图里不重名
const NAME_PARTS: Record<string, [string[], string[]]> = {
  tropical: [['椰', '潮', '珊', '榕', '棕', '渔', '汐', '贝', '蕉', '鲸'], ['湾', '村', '屿', '埠', '口', '滩']],
  meadow: [['麦', '风', '杏', '柳', '禾', '芦', '桃', '青'], ['庄', '村', '坡', '甸', '原', '集']],
  forest: [['松', '杉', '鹿', '枫', '橡', '蕨', '菇', '栗'], ['林', '寨', '谷', '屯', '岭', '坳']],
  snow: [['霜', '雪', '冰', '白', '寒', '驯', '银', '北'], ['堡', '村', '屯', '岭', '原', '湖']],
  desert: [['沙', '驼', '金', '枣', '旱', '砂', '日', '红'], ['堡', '井', '集', '城', '洲', '泉']],
}
function villageName(biome: string, id: number, seed: number, used: string[]) {
  const [a, b] = NAME_PARTS[biome] ?? NAME_PARTS.meadow
  for (let k = 0; k < 60; k++) {
    const n = a[Math.floor(hash2(id, k, seed) * a.length)] + b[Math.floor(hash2(id, k, seed + 1) * b.length)]
    if (!used.includes(n)) return n
  }
  return a[id % a.length] + b[id % b.length] + (id + 1)
}

// 院子摆设模板（取自潮汐村手摆的几户），随机选一种、随机左右镜像
const D = (k: string, dx: number, dy: number, o: Partial<Decor> = {}): Decor => ({ k, dx, dy, ...o })
const LOT_DECOR: Decor[][] = [
  [D('potted_palm', 1.9, 0.6), D('mailbox', 1.4, 1.8), D('lounge_chair', -2.5, 2.3), D('surfboard', -3.5, 0.3)],
  [D('planter', -1.95, 0.55), D('planter', 1.6, 0.55), D('bush_hibiscus', -1.9, 1.5, { sway: 0.4 }), D('mailbox', 1.4, 1.6)],
  [D('fish_rack', 4, 0.6), D('water_barrel', -3.4, 0.2), D('fish_basket', 2.4, 1.5, { solid: false }), D('mailbox', -1.4, 1.8), D('planter', -1.95, 0.55)],
  [D('cat', 0.8, 0.6, { solid: false }), D('bench', 3.1, 1.9), D('mailbox', -1.4, 1.8), D('planter', 1.95, 0.55)],
  [D('coop', 3.6, 1.2), D('chicken_white', 2.6, 2.1, { solid: false }), D('chicken_brown', 1.1, 2.6, { solid: false, flip: true }), D('veggie_patch', -3, 2.3), D('beehive', -3.6, 1.0), D('mailbox', 1.4, 1.5)],
  [D('fish_rack', -3.9, 0.6), D('crates', 3.6, 0.3), D('water_barrel', 4.1, -0.8), D('mailbox', 1.4, 1.8), D('planter', 1.95, 0.55)],
  [D('planter', -1.6, 0.55), D('bush_bougain', -1.8, 1.5, { sway: 0.4 }), D('stone_lantern', 2.2, 1.5), D('mailbox', 1.2, 1.2)],
  [D('bench', -3.3, 1.5), D('woodpile', 3.8, -0.1), D('cat', -0.8, 0.6, { solid: false, flip: true }), D('planter', 1.95, 0.55), D('mailbox', -1.4, 1.8)],
]
