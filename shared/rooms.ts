// 室内场景定义（前后端共用）。坐标单位是像素，原点在房间左上角；物件锚点在底边中心。
// 画法和岛屿一致：3/4 俯视，后墙是一条竖直的墙面，地板在墙下面铺开。
import { TILE } from './data.ts'
import type { Station } from './data.ts'

export type Rect = [number, number, number, number]

export interface RoomObj {
  kind: string            // interior / decor 图集帧名
  x: number; y: number
  solid?: [number, number] // 碰撞底座（宽、高，底边中心对齐）
  wall?: boolean          // 挂在墙上的装饰：画在地板层之上、人物之下，不挡路
  z?: number              // 强制景深（比如摆在吧台上的盘子要画在吧台前面）
  light?: { r: number, color: number, dy: number }
  station?: Station       // 做菜的灶台
}

export interface Room {
  id: string
  name: string
  w: number; h: number    // 地块数
  wallRows: number        // 后墙占几行地块
  floor: 'wood' | 'light' | 'dark'
  wall: 'washi' | 'plank' | 'plaster' | 'stone'
  door: { x: number, y: number }   // 门口（像素），走到这里下方就出门
  spawn: { x: number, y: number }
  objects: RoomObj[]
  seats?: { x: number, y: number }[] // 顾客座位（凳子的位置）
}

const px = (t: number) => Math.round(t * TILE)

// ── 潮汐寿司：后墙一排灶台，中间一条吧台，吧台前一排座位，正门在下方中间 ──
const SEATS = [56, 104, 152, 200, 248, 296].map(x => ({ x, y: 178 }))
export const RESTAURANT: Room = {
  id: 'restaurant', name: '潮汐寿司',
  w: 18, h: 12, wallRows: 3, floor: 'wood', wall: 'washi',
  door: { x: px(9), y: px(12) },
  spawn: { x: px(9), y: px(11) - 4 },
  seats: SEATS,
  objects: [
    // 墙上
    { kind: 'menu_board', x: 216, y: 60, wall: true },
    { kind: 'sake_shelf', x: 118, y: 46, wall: true },
    { kind: 'sake_shelf', x: 318, y: 46, wall: true },
    { kind: 'lantern_red', x: 40, y: 64, wall: true, light: { r: 70, color: 0xff9a5a, dy: -24 } },
    { kind: 'lantern_red', x: 392, y: 64, wall: true, light: { r: 70, color: 0xff9a5a, dy: -24 } },
    // 墙下的灶台
    { kind: 'icebox', x: 58, y: 92, solid: [34, 10] },
    { kind: 'board', x: 146, y: 92, solid: [46, 10], station: 'board' },
    { kind: 'rice_cooker', x: 198, y: 92, solid: [26, 10] },
    { kind: 'board', x: 250, y: 92, solid: [46, 10], station: 'board' },
    { kind: 'fryer', x: 306, y: 92, solid: [26, 10], station: 'fryer' },
    { kind: 'fish_tank', x: 372, y: 92, solid: [38, 10], light: { r: 50, color: 0x7fd8ff, dy: -20 } },
    // 吧台：四段拼成一条，右侧留出进后厨的通道
    ...[60, 132, 204, 276].map(x => ({ kind: 'counter', x, y: 152, solid: [72, 16] as [number, number] })),
    { kind: 'plates', x: 292, y: 128, z: 153 },
    { kind: 'tea_station', x: 36, y: 130, z: 153 },
    // 座位
    ...SEATS.map(s => ({ kind: 'stool', x: s.x, y: s.y, solid: [12, 5] as [number, number] })),
    // 前厅
    { kind: 'register', x: 364, y: 210, solid: [30, 10] },
    { kind: 'bonsai', x: 390, y: 150, solid: [20, 8] },
    { kind: 'bamboo', x: 40, y: 272, solid: [16, 6] },
    { kind: 'bamboo', x: 392, y: 272, solid: [16, 6] },
    // 从房梁吊下来的灯笼：不挡路、没有地面阴影，永远画在人物前面
    { kind: 'lantern_red', x: 150, y: 250, light: { r: 60, color: 0xffa060, dy: -26 }, z: 9999 },
    { kind: 'lantern_red', x: 282, y: 250, light: { r: 60, color: 0xffa060, dy: -26 }, z: 9999 },
  ],
}

export const ROOMS: Record<string, Room> = { restaurant: RESTAURANT }

// ── 玩家小屋：按房子样式定尺寸和材质（茅草屋 / 蓝顶白墙 / 高脚屋 / 石屋）──
const HOME_STYLE: { w: number, h: number, floor: Room['floor'], wall: Room['wall'] }[] = [
  { w: 13, h: 9, floor: 'wood', wall: 'plank' },
  { w: 14, h: 9, floor: 'light', wall: 'plaster' },
  { w: 12, h: 9, floor: 'light', wall: 'plank' },
  { w: 14, h: 10, floor: 'dark', wall: 'stone' },
]
export function homeRoom(lot: number, style: number): Room {
  const st = HOME_STYLE[style] ?? HOME_STYLE[0]
  const doorX = Math.round(st.w / 2) * TILE
  return {
    id: `home:${lot}`, name: '小屋', w: st.w, h: st.h, wallRows: 3, floor: st.floor, wall: st.wall,
    door: { x: doorX, y: st.h * TILE }, spawn: { x: doorX, y: st.h * TILE - 26 }, objects: [],
  }
}

// 房间里的阻挡：四周墙、后墙、物件底座
export function roomSolids(room: Room): Rect[] {
  const W = room.w * TILE, H = room.h * TILE
  const out: Rect[] = [
    [0, 0, W, room.wallRows * TILE + 14],       // 后墙（墙脚往下留一点，人不会贴进墙里）
    [0, 0, TILE, H], [W - TILE, 0, W, H],       // 左右墙
    [0, H - 2, room.door.x - 22, H], [room.door.x + 22, H - 2, W, H], // 下方墙，门口留空
  ]
  for (const o of room.objects) if (o.solid) out.push([o.x - o.solid[0] / 2, o.y - o.solid[1], o.x + o.solid[0] / 2, o.y])
  return out
}

export function roomFree(solids: Rect[], x: number, y: number) {
  const x0 = x - 5, x1 = x + 5, y0 = y - 4, y1 = y
  for (const r of solids) if (x1 > r[0] && x0 < r[2] && y1 > r[1] && y0 < r[3]) return false
  return true
}

// 站在哪个灶台前（灶台底边往下 36 像素内、左右 30 像素内）
export function stationAt(room: Room, x: number, y: number): RoomObj | null {
  let best: RoomObj | null = null, bd = Infinity
  for (const o of room.objects) {
    if (!o.station) continue
    const dx = Math.abs(x - o.x), dy = y - o.y
    if (dx < 30 && dy > -4 && dy < 36 && dx + dy < bd) { bd = dx + dy; best = o }
  }
  return best
}

// 隔着吧台上菜：人在吧台后面、和座位左右对齐；或者直接站在顾客旁边
export function canServe(x: number, y: number, seat: { x: number, y: number }) {
  return Math.abs(x - seat.x) < 28 && y < seat.y + 24 && y > seat.y - 80
}
