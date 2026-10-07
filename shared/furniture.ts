// 家具（前后端共用）：定义、摆放规则、新房默认布置。
// 家具在背包里是普通物品（id = f_<种类>），在自家屋里拿在手上就能摆；摆好的家具存在房主的存档里。
import type { Room } from './rooms.ts'

// 和 data.ts 的 TILE 相同。这里不能 import data.ts：data.ts 要反过来引用家具表把家具登记成物品，会形成循环依赖
const TILE = 24

// floor：落地家具，有碰撞底座、参与景深排序；rug：地毯，画在地板上、不挡路；wall：挂在后墙上
export type FurnLayer = 'floor' | 'rug' | 'wall'
export interface FurnDef {
  name: string
  price: number
  layer: FurnLayer
  size: [number, number]            // 精灵大小（像素，和 furniture 图集一致）
  solid?: [number, number]          // 落地家具的碰撞底座（宽、高，底边中心对齐）
  light?: { r: number, color: number, dy: number }
  chest?: boolean                   // 储物箱：可以存东西
}

const F = (name: string, price: number, layer: FurnLayer, size: [number, number], o: Partial<FurnDef> = {}): FurnDef => ({ name, price, layer, size, ...o })
export const FURNITURE: Record<string, FurnDef> = {
  bed: F('木床', 800, 'floor', [51, 37], { solid: [48, 14] }),
  table: F('方桌', 300, 'floor', [30, 29], { solid: [28, 8] }),
  chair: F('木椅', 150, 'floor', [19, 34], { solid: [14, 5] }),
  chest: F('储物箱', 400, 'floor', [33, 29], { solid: [30, 9], chest: true }),
  wardrobe: F('衣柜', 600, 'floor', [29, 42], { solid: [28, 9] }),
  bookshelf: F('书架', 700, 'floor', [50, 39], { solid: [48, 9] }),
  round_table: F('圆桌', 350, 'floor', [28, 29], { solid: [22, 6] }),
  armchair: F('扶手椅', 500, 'floor', [34, 35], { solid: [30, 9] }),
  stove: F('铁炉', 900, 'floor', [23, 41], { solid: [22, 8], light: { r: 64, color: 0xff9a4a, dy: -12 } }),
  dresser: F('五斗柜', 450, 'floor', [29, 33], { solid: [28, 9] }),
  monstera: F('龟背竹', 250, 'floor', [32, 38], { solid: [16, 6] }),
  floor_lamp: F('落地灯', 300, 'floor', [14, 37], { solid: [8, 4], light: { r: 72, color: 0xffd8a0, dy: -30 } }),
  nightstand: F('床头柜', 200, 'floor', [19, 31], { solid: [18, 7], light: { r: 40, color: 0xffc070, dy: -26 } }),
  rocking_chair: F('摇椅', 450, 'floor', [28, 36], { solid: [22, 6] }),
  side_table: F('边桌', 250, 'floor', [26, 26], { solid: [24, 6] }),
  desk: F('书桌', 500, 'floor', [34, 31], { solid: [32, 7] }),
  rug_round: F('圆地毯', 200, 'rug', [38, 25]),
  rug_fish: F('鱼纹地毯', 250, 'rug', [40, 19]),
  rug_leaf: F('叶纹地毯', 250, 'rug', [42, 24]),
  doormat: F('门垫', 80, 'rug', [35, 17]),
  rug_stripe: F('条纹地毯', 250, 'rug', [47, 21]),
  painting_sunset: F('夕阳画', 350, 'wall', [31, 25]),
  clock: F('挂钟', 300, 'wall', [25, 25]),
  wall_shelf: F('贝壳壁架', 250, 'wall', [34, 18]),
  window: F('窗户', 400, 'wall', [35, 30]),
  fishnet: F('渔网', 200, 'wall', [40, 36]),
  ship_wheel: F('船舵', 350, 'wall', [35, 35]),
  herbs: F('干草药', 150, 'wall', [27, 35]),
  painting_lighthouse: F('灯塔画', 350, 'wall', [29, 32]),
  fish_trophy: F('鱼标本', 500, 'wall', [39, 20]),
  mirror: F('圆镜', 250, 'wall', [27, 26]),
}
export const furnItem = (kind: string) => `f_${kind}`
export const furnKind = (item: string) => item.startsWith('f_') && FURNITURE[item.slice(2)] ? item.slice(2) : null

// 屋里摆着的一件家具：x/y 是底边中心（像素，房间坐标）
export interface HomeItem { id: number, k: string, x: number, y: number, flip?: boolean }
export interface HomeData { items: HomeItem[], chest: ({ id: string, n: number } | null)[], next: number }
export const CHEST_SIZE = 24

type Rect = [number, number, number, number]
const overlap = (a: Rect, b: Rect, m = 0) => a[0] < b[2] + m && a[2] > b[0] - m && a[1] < b[3] + m && a[3] > b[1] - m
export function spriteRect(k: string, x: number, y: number): Rect {
  const [w, h] = FURNITURE[k].size
  return [x - w / 2, y - h, x + w / 2, y]
}
export function solidRect(k: string, x: number, y: number): Rect | null {
  const s = FURNITURE[k].solid
  return s ? [x - s[0] / 2, y - s[1], x + s[0] / 2, y] : null
}

// 这个位置能不能摆（服务端校验和客户端预览共用）
export function canPlace(room: Room, items: HomeItem[], k: string, x: number, y: number, ignore = -1): boolean {
  const d = FURNITURE[k]
  if (!d || !Number.isFinite(x) || !Number.isFinite(y)) return false
  const W = room.w * TILE, H = room.h * TILE, WALL = room.wallRows * TILE
  const r = spriteRect(k, x, y)
  if (r[0] < TILE + 1 || r[2] > W - TILE - 1) return false
  const others = items.filter(i => i.id !== ignore && FURNITURE[i.k])
  if (d.layer === 'wall') {
    // 整个挂在墙面上（顶梁以下、墙脚以上），不和别的墙饰重叠
    if (r[1] < 6 || y > WALL - 2) return false
    return !others.some(i => FURNITURE[i.k].layer === 'wall' && overlap(r, spriteRect(i.k, i.x, i.y), 1))
  }
  if (d.layer === 'rug') return r[1] >= WALL + 2 && y <= H - 2
  const s = solidRect(k, x, y)!
  if (s[1] < WALL + 2 || y > H - 10) return false
  // 门口留一条走道
  const dx = room.door.x
  if (s[2] > dx - 26 && s[0] < dx + 26 && y > H - 44) return false
  return !others.some(i => { const o = solidRect(i.k, i.x, i.y); return o && overlap(s, o, 1) })
}

// 新房默认布置：床、床头柜、桌椅、地毯、储物箱、窗户、画、盆栽、门垫
export function starterHome(room: Room): HomeData {
  const W = room.w * TILE, H = room.h * TILE, WALL = room.wallRows * TILE
  const plan: [string, number, number][] = [
    ['window', Math.round(W / 2 - 52), WALL - 26],
    ['painting_sunset', Math.round(W / 2 + 48), WALL - 30],
    ['bed', TILE + 30, WALL + 40],
    ['nightstand', TILE + 70, WALL + 24],
    ['rug_round', Math.round(W / 2), Math.round(WALL + (H - WALL) / 2 + 20)],
    ['table', Math.round(W / 2), Math.round(WALL + (H - WALL) / 2 + 10)],
    ['chair', Math.round(W / 2 + 26), Math.round(WALL + (H - WALL) / 2 + 12)],
    ['chest', W - TILE - 22, WALL + 22],
    ['monstera', W - TILE - 20, H - 48],
    ['doormat', room.door.x, H - 2],
  ]
  const items: HomeItem[] = []
  for (const [k, x, y] of plan) if (canPlace(room, items, k, x, y)) items.push({ id: items.length + 1, k, x, y })
  return { items, chest: Array(CHEST_SIZE).fill(null), next: items.length + 1 }
}
