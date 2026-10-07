// 岛屿地图：地形由连续场函数定义（地块坐标，浮点）。
// 服务端按地块中心取样判断能不能走/能不能耕；客户端按像素取样画出有机的边缘。
import { fbm, rng, hash2 } from './noise.ts'
import { TILE } from './data.ts'

export const ISLAND_W = 72
export const ISLAND_H = 72

export const T = { DEEP: 0, SHALLOW: 1, SAND: 2, GRASS: 3, PATH: 4, FARM: 5, DOCK: 6 } as const
export type TerrainType = typeof T[keyof typeof T]

// 关键地点（地块坐标）
export const PLACES = {
  spawn: { x: 36, y: 20 },
  houseDoor: { x: 21.5, y: 13.2 },
  farm: { x0: 15, y0: 17, x1: 30, y1: 26 },           // 可耕地（含边界），外圈一格是篱笆
  bin: { x: 33.2, y: 18.4 },                            // 出货箱（底边中心）
  stall: { x: 46, y: 19.2 },                            // 鱼摊（底边中心）
  seedshop: { x: 34.6, y: 27 },                         // 花婶的种子铺（底边中心）
  restaurant: { x: 53.4, y: 22.8 },                     // 潮汐寿司（底边中心），门口正对港口路
  dock: { x0: 56, y0: 24, x1: 70, y1: 25 },            // 栈桥地块
  boat: { x: 66.5, y: 28.6 },                           // 潜水船（底边中心）
  diveSpot: { x0: 64, y0: 25, x1: 70, y1: 25 },        // 站在这里可以下潜
  bridge: { x0: 58, y0: 10, x1: 60, y1: 10 },           // 通往灯塔小岛的栈桥（复兴工程第一期修好之前是断桩）
  lighthouse: { x: 63.9, y: 11.9 },                     // 灯塔（底边中心）
  projectBoard: { x: 57.6, y: 28.3 },                   // 复兴工程告示板（码头入口南边的沙滩上）
}

// ── 道路：折线 + 半宽（地块）。主路 0.85，村道 0.8，各家门前小路 0.5 ──
interface Road { pts: [number, number][], w: number }
const ROADS: Road[] = [
  { w: 0.85, pts: [[21.5, 13.7], [21.5, 14.9], [31, 14.9], [37, 16.3], [39.5, 20.8], [46, 20.8]] },
  { w: 0.5, pts: [[21.5, 14.9], [21.5, 16.6]] },                                            // 通到农田北门
  { w: 0.85, pts: [[39.5, 20.8], [44, 23.2], [52, 24.6], [57, 24.6]] },
  { w: 0.75, pts: [[27.5, 27.5], [27.5, 28.8], [33, 29.4], [38.6, 28.4]] },
  { w: 0.55, pts: [[53.4, 23.3], [53.4, 24.5]] },                                          // 潮汐寿司门前                 // 农田南门 → 种子铺门前
  { w: 0.85, pts: [[39.5, 20.8], [39, 27.8], [35.5, 33], [34, 39], [33.3, 45]] },       // 通往潮汐村广场
  // 潮汐村：广场居中，西街/东街从广场往两边弯下去，南街从广场往南再分岔
  { w: 0.8, pts: [[30.2, 48.4], [26, 49.9], [19, 50.1], [13, 51.1], [8.5, 53.7], [6.5, 57]] },
  { w: 0.8, pts: [[35.8, 48.4], [40, 50], [47, 50.3], [53, 51.7], [58.5, 54.6]] },
  { w: 0.8, pts: [[33, 50.7], [33.3, 54.5], [30, 58.6], [24, 60.7], [16, 61.1], [10.5, 60.1]] },
  { w: 0.8, pts: [[33.3, 54.5], [38, 58.7], [45, 60.3], [52, 60.5], [57, 58.9]] },
]
// 村中心的圆形广场
export const PLAZA = { x: 33, y: 47.8, r: 2.8 }

// ── 潮汐村的房子：位置错落、样式固定（没人住时也建好，挂「空房」牌）──
// x/y 是房子底边中心（地块坐标），门在正中。decor：院子里的摆设，坐标相对房子底边中心；
// door：门前小路拐到村道的折点（相对坐标），不写就笔直往南接到最近的路
export interface Decor { k: string, dx: number, dy: number, solid?: boolean, flip?: boolean, sway?: number }
export interface Lot { id: number, x: number, y: number, style: number, decor: Decor[], door?: [number, number][] }
export const FLOWER_KINDS = ['flower_tulip', 'flower_cosmos', 'flower_pansy', 'flower_rose', 'flower_hyacinth', 'flower_windflower'] as const
export const HOUSE_STYLES = ['house_thatch', 'house_blue', 'house_stilt', 'house_stone'] as const
const D = (k: string, dx: number, dy: number, o: Partial<Decor> = {}): Decor => ({ k, dx, dy, ...o })
export const LOTS: Lot[] = [
  // ── 北排：广场西边三户、东边三户，两头是海边高脚屋 ──
  { id: 0, x: 10.5, y: 47.4, style: 2, decor: [D('potted_palm', 1.9, 0.6), D('mailbox', 1.4, 1.8), D('lounge_chair', -2.5, 2.3), D('surfboard', -3.5, 0.3)] },
  { id: 1, x: 18.6, y: 46.2, style: 0, decor: [D('planter', -1.95, 0.55), D('planter', 1.6, 0.55), D('bush_hibiscus', -1.9, 1.5, { sway: 0.4 }), D('mailbox', 1.4, 1.6)] },
  { id: 2, x: 26.2, y: 45.3, style: 1, decor: [D('fish_rack', 4, 0.6), D('water_barrel', -3.4, 0.2), D('fish_basket', 2.4, 1.5, { solid: false }), D('mailbox', -1.4, 1.8), D('planter', -1.95, 0.55)] },
  { id: 3, x: 40.3, y: 45.6, style: 3, decor: [D('cat', 0.8, 0.6, { solid: false }), D('bench', 3.1, 1.9), D('mailbox', -1.4, 1.8), D('planter', 1.95, 0.55)] },
  { id: 4, x: 47.8, y: 46.1, style: 0, decor: [D('coop', 3.6, 1.2), D('chicken_white', 2.6, 2.1, { solid: false }), D('chicken_brown', 1.1, 2.6, { solid: false, flip: true }), D('veggie_patch', -3, 2.3), D('beehive', -3.6, 1.0), D('mailbox', 1.4, 1.5)] },
  { id: 5, x: 55, y: 49.2, style: 2, decor: [D('potted_palm', 1.9, 0.6), D('surfboard', -3.5, 0.3), D('mailbox', -1.4, 1.8)] },
  // ── 南排：中间留一片小树林 ──
  { id: 6, x: 14.6, y: 57.2, style: 1, decor: [D('fish_rack', -3.9, 0.6), D('crates', 3.6, 0.3), D('water_barrel', 4.1, -0.8), D('mailbox', 1.4, 1.8), D('planter', 1.95, 0.55)] },
  { id: 7, x: 23.4, y: 56.4, style: 3, decor: [D('planter', -1.6, 0.55), D('bush_bougain', -1.8, 1.5, { sway: 0.4 }), D('stone_lantern', 2.2, 1.5), D('mailbox', 1.2, 1.2), D('laundry', 5.4, -0.3)] },
  { id: 8, x: 43, y: 56.2, style: 0, decor: [D('bench', -3.3, 1.5), D('woodpile', 3.8, -0.1), D('cat', -0.8, 0.6, { solid: false, flip: true }), D('planter', 1.95, 0.55), D('mailbox', -1.4, 1.8), D('tree_round', -5.4, -1.5, { sway: 0.5 })] },
  { id: 9, x: 51.8, y: 57, style: 1, decor: [D('veggie_patch', 3.8, 1.9), D('beehive', -3.8, 0.9), D('chicken_white', -2.2, 2.4, { solid: false }), D('mailbox', 1.4, 1.8), D('planter', -1.95, 0.55), D('coop', 4.3, -0.4)] },
]
export const PICKET_YARDS = [1, 7]
export function picketTiles(): [number, number][] {
  const out: [number, number][] = []
  for (const id of PICKET_YARDS) {
    const l = LOTS[id]
    const x0 = Math.floor(l.x - 3.3), x1 = Math.floor(l.x + 3.2), yb = Math.floor(l.y + 2.5), yt = Math.floor(l.y + 0.2)
    const gate = Math.floor(l.x)
    for (let x = x0; x <= x1; x++) if (x !== gate) out.push([x, yb])
    for (let y = yt; y < yb; y++) out.push([x0, y], [x1, y])
  }
  return out
}
export const lotDoor = (l: Lot) => ({ x: l.x, y: l.y + 0.3 })
export const lotSign = (l: Lot) => ({ x: l.x + 1.7, y: l.y + 1.25 })
// 房子挡住的地块：墙身那一截；屋顶后半部分可以走到后面去（被屋顶遮住，靠景深排序）
export const lotBlock = (l: Lot): [number, number, number, number] => [Math.floor(l.x - 2.9), Math.floor(l.y - 2.6), Math.floor(l.x + 2.8), Math.floor(l.y - 0.45)]

// 每户门前一条小路，笔直往南接到最近的村道
function doorPath(l: Lot): Road {
  const d = lotDoor(l)
  if (l.door) return { w: 0.5, pts: [[d.x, d.y + 0.25], ...l.door.map(([dx, dy]) => [l.x + dx, l.y + dy] as [number, number])] }
  let y = d.y + 0.3
  while (y < d.y + 6 && roadEdge(d.x, y, 4) > -0.3) y += 0.1
  return { w: 0.5, pts: [[d.x, d.y + 0.25], [d.x, y]] }
}

function segDist(px: number, py: number, ax: number, ay: number, bx: number, by: number) {
  const dx = bx - ax, dy = by - ay
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)))
  return Math.hypot(px - ax - t * dx, py - ay - t * dy)
}

// 到最近道路边缘的距离（负数表示在路面上）。count 限制只算前 count 条（门前小路生成时只看主路和村道）
function roadEdge(x: number, y: number, from = 0, roads: Road[] = ROADS): number {
  let d = Math.hypot(x - PLAZA.x, (y - PLAZA.y) * 1.15) - PLAZA.r
  for (let r = from; r < roads.length; r++) {
    const { pts, w } = roads[r]
    for (let i = 0; i < pts.length - 1; i++) d = Math.min(d, segDist(x, y, pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1]) - w)
  }
  return d
}
for (const l of LOTS) ROADS.push(doorPath(l))

export function pathEdge(x: number, y: number): number { return roadEdge(x, y) }
// 兼容旧接口：约等于「到一条 0.85 宽主路中心线的距离」
export function pathDist(x: number, y: number): number { return roadEdge(x, y) + 0.85 }

// 农田篱笆：农田外围一圈，留三个门（北门对着花婶家、南门通种子铺、东门挨着出货箱）
export const FENCE_GATES = new Set(['21,16', '22,16', '27,27', '28,27', '31,17', '31,18'])
export function fenceTiles(): [number, number][] {
  const { x0, y0, x1, y1 } = PLACES.farm
  const out: [number, number][] = []
  for (let x = x0 - 1; x <= x1 + 1; x++) out.push([x, y0 - 1], [x, y1 + 1])
  for (let y = y0; y <= y1; y++) out.push([x0 - 1, y], [x1 + 1, y])
  return out.filter(([x, y]) => !FENCE_GATES.has(`${x},${y}`))
}

// NPC 站位（地块坐标，脚底）
export const NPC_SPOTS = {
  ahai: { x: 48.5, y: 20.4 },
  huashen: { x: 37.7, y: 27.8 },
  laopan: { x: 68.4, y: 25.4 },
  xiaoshan: { x: 53.4, y: 27.6 },
  zhoushu: { x: 30.3, y: 49.9 },   // 广场西边
  alan: { x: 51.2, y: 24.5 },      // 寿司店门口
  doudou: { x: 33.9, y: 56.9 },    // 南边小树林
} as const
// 撒植被时要避开的站位：只算最早的四位（新增站位附近本来就是空地；加进来会让撒点的随机序列整体错位）
const SCATTER_CLEAR = ['ahai', 'huashen', 'laopan', 'xiaoshan'] as const
// 村里的告示板（广场东北角）
export const NOTICE_BOARD = { x: 35.4, y: 45.4 }

// 潮汐集市（复兴工程第三期）：主路西边那片草地。开张后客户端把这块地里的野生植物清掉、摆上摊位
export const MARKET = {
  clear: [24.5, 32.5, 34, 40.8] as [number, number, number, number],   // 清理范围（地块）
  stalls: [
    { kind: 'market_green', x: 27.4, y: 35.4 }, { kind: 'market_blue', x: 31.6, y: 35.4 },
    { kind: 'market_teal', x: 27.4, y: 39.8 }, { kind: 'market_orange', x: 31.6, y: 39.8 },
  ],
}
export const nearMarket = (tx: number, ty: number) => tx > MARKET.clear[0] - 1 && tx < MARKET.clear[2] + 2 && ty > MARKET.clear[1] && ty < MARKET.clear[3] + 1.5

// 东北角海里的灯塔小岛（一直都在；灯塔先是废墟，复兴工程第二期修好）
export const ISLET = { x: 63.6, y: 10.4, rx: 2.8, ry: 2.3 }

// 陆地场：>0 为陆地。椭圆岛 + 分形噪声扰动海岸线
export function landValue(x: number, y: number): number {
  const main = 1 - Math.hypot((x - 35) / 27, (y - 22.5) / 17.5)
  const south = 1 - Math.hypot((x - 33) / 31.5, (y - 53.5) / 16.5)
  // 平滑并集：两块陆地之间自然连成一条地峡
  const k = 0.18, h = Math.max(0, Math.min(1, 0.5 + (south - main) / (2 * k)))
  let v = main * (1 - h) + south * h + k * h * (1 - h)
  v += (fbm(x * 0.11, y * 0.11, 7) - 0.5) * 0.55
  // 东侧栈桥根部保证是沙滩
  if (x > 50 && x < 58 && y > 22 && y < 27) v = Math.max(v, 0.06 - (x - 56) * 0.03)
  // 灯塔小岛
  const islet = 1 - Math.hypot((x - ISLET.x) / ISLET.rx, (y - ISLET.y) / ISLET.ry)
  if (islet > -1) v = Math.max(v, islet * 0.4 + (fbm(x * 0.5, y * 0.5, 23) - 0.5) * 0.12)
  return v
}

function inRect(x: number, y: number, r: { x0: number, y0: number, x1: number, y1: number }) {
  return x >= r.x0 && x < r.x1 + 1 && y >= r.y0 && y < r.y1 + 1
}

// 任意位置的地形（x,y 为地块坐标，可以是小数）
export function classify(x: number, y: number): TerrainType {
  if (inRect(x, y, PLACES.dock)) return T.DOCK
  const land = landValue(x, y)
  if (land <= 0) return land > -0.13 ? T.SHALLOW : T.DEEP
  if (inRect(x, y, PLACES.farm)) return T.FARM
  // 小路边缘加一点噪声，不要像尺子画的
  if (pathEdge(x, y) < (fbm(x * 0.9, y * 0.9, 3) - 0.5) * 0.5) return T.PATH
  return land < 0.1 + (fbm(x * 0.5, y * 0.5, 11) - 0.5) * 0.06 ? T.SAND : T.GRASS
}

export interface IslandObject {
  kind: string              // island 图集帧名
  x: number; y: number      // 锚点（底边中心），像素坐标
  block?: [number, number, number, number] // 阻挡的地块矩形 [x0,y0,x1,y1]（含）
  sway?: number             // 随风摆动幅度
  light?: { r: number, color: number } // 夜间光源
  flip?: boolean
  lot?: number              // 属于哪栋村屋（客户端按有没有人住决定亮不亮灯）
  rect?: Rect               // 小物件的像素碰撞底座（由 SOLID_SIZE 生成）
}

export interface Island {
  types: Uint8Array
  blocked: Uint8Array          // 按地块阻挡：水、房子、篱笆
  objects: IslandObject[]
  solids: Rect[]               // 小物件按像素的碰撞底座
}
export type Rect = [number, number, number, number] // 像素 [x0, y0, x1, y1]

// 小物件的碰撞底座（像素：宽、高），底边中心对齐物件锚点。
// 以前小物件按整格阻挡，一个信箱能挡住一两格，院子里会出现看不见的墙、把人卡住。
export const SOLID_SIZE: Record<string, [number, number]> = {
  barrel: [16, 7], crates: [24, 9], ship_bin: [26, 9], well_front: [24, 10], lantern: [6, 5], mailbox: [8, 5], sign: [8, 5],
  wheelbarrow: [24, 7], fish_rack: [30, 5], campfire: [20, 7], boulder: [24, 10], rock_moss: [24, 9], flower_pot: [12, 6],
  palm_a: [8, 5], palm_b: [8, 5], tree_round: [12, 6], tree_mango: [12, 6], banana: [8, 5],
  bush_hibiscus: [22, 8], bush_bougain: [20, 8], shrub: [22, 8], fern: [16, 6],
  bench: [28, 6], planter: [30, 7], woodpile: [24, 8], water_barrel: [16, 7], notice_board: [26, 5],
  beehive: [14, 7], waystone_crystal: [24, 7], project_board: [40, 6], coop: [28, 10], stone_lantern: [10, 5], potted_palm: [14, 7], surfboard: [10, 4], lounge_chair: [28, 8],
}
// 建筑仍按地块阻挡
const BUILDINGS = new Set(['lighthouse_block', 'house', 'stall', 'seedshop', 'restaurant', ...['house_thatch', 'house_blue', 'house_stilt', 'house_stone']])

export function buildIsland(): Island {
  const W = ISLAND_W, H = ISLAND_H
  const types = new Uint8Array(W * H)
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) types[y * W + x] = classify(x + 0.5, y + 0.5)
  const blocked = new Uint8Array(W * H)
  for (let i = 0; i < W * H; i++) if (types[i] === T.DEEP || types[i] === T.SHALLOW) blocked[i] = 1

  const objects: IslandObject[] = []
  const px = (tx: number) => Math.round(tx * TILE)
  const solids: Rect[] = []
  const add = (o: IslandObject) => {
    objects.push(o)
    const size = SOLID_SIZE[o.kind]
    if (o.block && size && !BUILDINGS.has(o.kind)) {
      o.rect = [o.x - size[0] / 2, o.y - size[1], o.x + size[0] / 2, o.y]
      solids.push(o.rect)
      return
    }
    // 不在碰撞表里的小摆设（晾衣绳、吊床、菜畦、小动物……）不挡路
    if (o.block && !BUILDINGS.has(o.kind)) o.block = undefined
    if (o.block) for (let y = o.block[1]; y <= o.block[3]; y++) for (let x = o.block[0]; x <= o.block[2]; x++) {
      if (x >= 0 && y >= 0 && x < W && y < H) blocked[y * W + x] = 1
    }
  }

  // ── 建筑与固定道具 ──
  add({ kind: 'house', x: px(21.5), y: px(13), block: [18, 10, 24, 12], light: { r: 70, color: 0xffc36b } }) // 花婶家
  add({ kind: 'seedshop', x: px(PLACES.seedshop.x), y: px(PLACES.seedshop.y), block: [33, 24, 36, 25], light: { r: 60, color: 0xffd07a } })
  for (const [fx, fy] of [...fenceTiles(), ...picketTiles()]) { if (fx >= 0 && fy >= 0 && fx < W && fy < H) blocked[fy * W + fx] = 1 }
  add({ kind: 'stall', x: px(PLACES.stall.x), y: px(PLACES.stall.y), block: [44, 16, 48, 18], light: { r: 60, color: 0xffb35c } })
  add({ kind: 'ship_bin', x: px(PLACES.bin.x), y: px(PLACES.bin.y), block: [33, 17, 33, 17] })
  add({ kind: 'well_front', x: px(27.9), y: px(12.9), block: [27, 12, 28, 12] })
  add({ kind: 'boat', x: px(PLACES.boat.x), y: px(PLACES.boat.y) })
  add({ kind: 'mailbox', x: px(24.2), y: px(13.9), block: [24, 13, 24, 13] })
  add({ kind: 'barrel', x: px(16.9), y: px(13.4), block: [16, 12, 16, 13] })
  add({ kind: 'crates', x: px(25.6), y: px(13.1), block: [25, 12, 25, 12] })
  add({ kind: 'flower_pot', x: px(20.1), y: px(14.3) })
  add({ kind: 'sign', x: px(13.2), y: px(16.2), block: [13, 15, 13, 15] })
  add({ kind: 'wheelbarrow', x: px(12.6), y: px(21.8), block: [12, 21, 12, 21] })
  add({ kind: 'fish_rack', x: px(49.8), y: px(18.9), block: [49, 18, 50, 18] })
  add({ kind: 'fish_basket', x: px(43.3), y: px(20.4) })
  { const r = PLACES.restaurant
    add({ kind: 'restaurant', x: px(r.x), y: px(r.y), block: [Math.floor(r.x - 3.3), Math.floor(r.y - 2.6), Math.floor(r.x + 3.2), Math.floor(r.y - 0.45)], light: { r: 64, color: 0xffb870 } }) }
  add({ kind: 'crates', x: px(57.9), y: px(23.4), block: [57, 23, 57, 23] })
  add({ kind: 'barrel', x: px(49.6), y: px(21.9), block: [49, 21, 49, 21] })
  add({ kind: 'campfire', x: px(42.5), y: px(31.3), block: [42, 31, 42, 31], light: { r: 90, color: 0xff8c3a } })
  // 沿路的灯柱
  for (const [lx, ly] of [[29.5, 14], [33.6, 14.8], [40.8, 19.4], [48, 22.4], [55.5, 25.9], [62, 24.35], [69.6, 24.35],
    [40.6, 29], [35.4, 40], [22.6, 51.5], [43.6, 51.7], [11.4, 51.3], [55.4, 52.6], [27.6, 60.2], [36.9, 59.8], [19, 62.4], [48.5, 61.8]] as const) {
    add({ kind: 'lantern', x: px(lx), y: px(ly), block: [Math.floor(lx), Math.floor(ly) - 1, Math.floor(lx), Math.floor(ly) - 1], light: { r: 64, color: 0xffcf7a } })
  }

  // ── 潮汐村：房子（固定建好）+ 每户按院子风格摆装饰 + 广场 ──
  for (const l of LOTS) add({ kind: HOUSE_STYLES[l.style], x: px(l.x), y: px(l.y), block: lotBlock(l), lot: l.id })
  const deco = (kind: string, tx: number, ty: number, opts: Partial<IslandObject> & { solid?: boolean } = {}) => {
    const { solid = true, ...rest } = opts
    add({ kind, x: px(tx), y: px(ty), block: solid ? [Math.floor(tx - 0.3), Math.floor(ty - 0.5), Math.floor(tx + 0.3), Math.floor(ty - 0.5)] : undefined, ...rest })
  }
  for (const l of LOTS) for (const d of l.decor) deco(d.k, l.x + d.dx, l.y + d.dy, { solid: d.solid, flip: d.flip, sway: d.sway, lot: l.id })
  // 南排中间的小树林公园
  deco('tree_mango', 29.2, 53.6, { sway: 0.5 }); deco('tree_round', 37.8, 53.2, { sway: 0.5 }); deco('banana', 36.4, 56.2, { sway: 0.8 })
  deco('bench', 30.6, 56.1); deco('bush_bougain', 38.9, 55.3, { sway: 0.4 })
  // 广场：中间一口井，四周长椅、公告栏、石灯笼、盆栽
  deco('well_front', PLAZA.x, PLAZA.y + 0.3)
  deco('notice_board', PLAZA.x + 2.4, PLAZA.y - 2.4)
  deco('potted_palm', PLAZA.x - 3.9, PLAZA.y - 0.7)
  deco('potted_palm', PLAZA.x + 3.9, PLAZA.y - 0.7)

  // ── 植被：确定性随机撒点 ──
  const r = rng(20260926)
  const free = (tx: number, ty: number, rad: number) => {
    // 灯塔小岛不长植物（放在最前面：只拒绝、不多消耗随机数，岛上其余植被位置和加小岛之前完全一样）
    if (Math.hypot(tx - ISLET.x, ty - ISLET.y) < 5) return false
    for (let y = Math.floor(ty - rad); y <= Math.ceil(ty + rad); y++) for (let x = Math.floor(tx - rad); x <= Math.ceil(tx + rad); x++) {
      if (x < 0 || y < 0 || x >= W || y >= H) return false
      if (blocked[y * W + x]) return false
    }
    if (pathDist(tx, ty) < 1.6 + rad) return false
    if (tx > PLACES.farm.x0 - 2 && tx < PLACES.farm.x1 + 3 && ty > PLACES.farm.y0 - 2 && ty < PLACES.farm.y1 + 2) return false
    if (Math.hypot(tx - PLACES.spawn.x, ty - PLACES.spawn.y) < 3) return false
    for (const o of objects) if (Math.hypot(o.x - tx * TILE, o.y - ty * TILE) < rad * TILE + 16) return false
    for (const l of LOTS) if (tx > l.x - 6.5 && tx < l.x + 6.5 && ty > l.y - 5 && ty < l.y + 2.8) return false
    if (Math.hypot(tx - PLAZA.x, ty - PLAZA.y) < PLAZA.r + 2.5) return false
    if (Math.hypot(tx - PLACES.seedshop.x, ty - PLACES.seedshop.y + 2) < 4.5) return false
    if (tx > PLACES.restaurant.x - 5 && tx < PLACES.restaurant.x + 5 && ty > PLACES.restaurant.y - 5 && ty < PLACES.restaurant.y + 1.5) return false
    for (const k of SCATTER_CLEAR) { const n = NPC_SPOTS[k]; if (Math.hypot(tx - n.x, ty - n.y) < 2) return false }
    return true
  }
  const scatter = (n: number, test: (land: number) => boolean, pick: () => Omit<IslandObject, 'x' | 'y'>, rad: number, blockTrunk: boolean) => {
    for (let tries = 0, placed = 0; tries < n * 30 && placed < n; tries++) {
      const tx = 2 + r() * (W - 4), ty = 2 + r() * (H - 4)
      if (!test(landValue(tx, ty)) || !free(tx, ty, rad)) continue
      const o = pick()
      const bx = Math.floor(tx), by = Math.floor(ty)
      add({ ...o, x: px(tx), y: px(ty), block: blockTrunk ? [bx, by, bx, by] : undefined })
      placed++
    }
  }
  scatter(22, l => l > 0.03 && l < 0.2, () => ({ kind: r() < 0.5 ? 'palm_a' : 'palm_b', sway: 1, flip: r() < 0.5 }), 1.2, true)
  scatter(16, l => l > 0.3, () => ({ kind: r() < 0.6 ? 'tree_round' : 'tree_mango', sway: 0.5, flip: r() < 0.5 }), 1.6, true)
  scatter(10, l => l > 0.2, () => ({ kind: 'banana', sway: 0.8, flip: r() < 0.5 }), 1, true)
  scatter(24, l => l > 0.15, () => ({ kind: ['bush_hibiscus', 'bush_bougain', 'shrub', 'fern'][Math.floor(r() * 4)], sway: 0.4, flip: r() < 0.5 }), 0.8, true)
  scatter(40, l => l > 0.12, () => ({ kind: 'grass_tall', sway: 1, flip: r() < 0.5 }), 0.4, false)
  scatter(10, l => l > 0.2, () => ({ kind: r() < 0.5 ? 'boulder' : 'rock_moss' }), 0.8, true)
  scatter(14, l => l > 0.005 && l < 0.07, () => ({ kind: ['conch', 'starfish', 'driftwood', 'pebbles'][Math.floor(r() * 4)] }), 0.5, false)

  // ── 复兴工程相关：放在撒植被之后，免得撒点避让它们、打乱整座岛的随机序列 ──
  // 灯塔：只占地块，精灵由客户端按工程进度画废墟版或修好版
  { const L = PLACES.lighthouse; add({ kind: 'lighthouse_block', x: px(L.x), y: px(L.y), block: [Math.floor(L.x - 0.9), Math.floor(L.y - 1.9), Math.floor(L.x + 0.9), Math.floor(L.y - 0.1)] }) }
  { const B = PLACES.projectBoard
    add({ kind: 'project_board', x: px(B.x), y: px(B.y), block: [Math.floor(B.x), Math.floor(B.y) - 1, Math.floor(B.x), Math.floor(B.y) - 1] })
    add({ kind: 'donation_box', x: px(B.x + 1.5), y: px(B.y + 0.2) }) }

  // 野花（动森方向）：一半多的高草按位置换成六种花（郁金香、波斯菊、三色堇、玫瑰、风信子、银莲花）。只改种类、不挪位置、不消耗随机数，别的物件摆放不受影响
  for (const o of objects) {
    if (o.kind !== 'grass_tall') continue
    const h = hash2(Math.round(o.x), Math.round(o.y), 91)
    if (h < 0.6) o.kind = FLOWER_KINDS[Math.floor((h / 0.6) * FLOWER_KINDS.length)]
  }

  // 深度排序在客户端做；这里按 y 排好方便调试
  objects.sort((a, b) => a.y - b.y)
  return { types, blocked, objects, solids }
}

export function isTillable(island: Island, tx: number, ty: number) {
  if (tx < 0 || ty < 0 || tx >= ISLAND_W || ty >= ISLAND_H) return false
  return island.types[ty * ISLAND_W + tx] === T.FARM && !island.blocked[ty * ISLAND_W + tx]
}

// 草地上的细节随机数（客户端画地形用）
export const detailHash = (x: number, y: number) => hash2(x, y, 99)
