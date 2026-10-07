// 动森式岛屿的规则（前后端共用）：帐篷能不能放、某格现在能不能走
import { TILE } from '../data.ts'
import { ISLE_W, ISLE_H, IT } from './gen.ts'
import type { Isle } from './gen.ts'
import type { TentSpot } from '../protocol.ts'

export interface IsleDyn { tent: TentSpot | null, villagers: { id: string, tent: TentSpot | null }[], removed: number[], curatorTent?: TentSpot | null, stage?: string }

// 帐篷占 3×2 格，(tx, ty) 是底边中间那一格；博物馆占 7×4（馆长的帐篷放下时就按博物馆的大小预留，原作也是这样）
export const TENT_W = 3, TENT_H = 2
export const MUSEUM_W = 7, MUSEUM_H = 4
// 博物馆里面（格）
export const MUSEUM_ROOM = { w: 26, h: 16 }
// 博物馆前台（像素，馆长站在台子后面，人站在台子前面说话）
export const MUSEUM_DESK = { x: 9.5 * 24, y: 12.2 * 24 }
export function footTiles(t: TentSpot, w: number, h: number): [number, number][] {
  const out: [number, number][] = []
  const half = Math.floor(w / 2)
  for (let y = t.ty - h + 1; y <= t.ty; y++) for (let x = t.tx - half; x <= t.tx + half; x++) out.push([x, y])
  return out
}
export const tentTiles = (t: TentSpot) => footTiles(t, TENT_W, TENT_H)
export const museumTiles = (t: TentSpot) => footTiles(t, MUSEUM_W, MUSEUM_H)
export const allTents = (d: IsleDyn): TentSpot[] => [d.tent, ...d.villagers.map(v => v.tent)].filter((t): t is TentSpot => !!t)
// 已经放下的建筑占的格子（帐篷 + 馆长的帐篷 / 博物馆）
function placedTiles(d: IsleDyn): [number, number][] {
  const out = allTents(d).flatMap(t => tentTiles(t))
  if (d.curatorTent) out.push(...museumTiles(d.curatorTent))
  return out
}
export const museumBuilt = (d: IsleDyn) => d.stage === 'museumOpen'

// 地图物件压在哪一格（锚点在底边，往上挪 2 像素算）
export const objTile = (o: { x: number, y: number }) => [Math.floor(o.x / TILE), Math.floor((o.y - 2) / TILE)] as const

// 能放返回 null，不能放返回原因
export const canPlaceTent = (g: Isle, d: IsleDyn, spot: TentSpot) => canPlaceFoot(g, d, spot, TENT_W, TENT_H)
export function canPlaceFoot(g: Isle, d: IsleDyn, spot: TentSpot, w: number, h: number): string | null {
  const W = ISLE_W
  const taken = new Set(placedTiles(d).map(([x, y]) => y * W + x))
  for (const [x, y] of footTiles(spot, w, h)) {
    if (x < 1 || y < 1 || x >= ISLE_W - 1 || y >= ISLE_H - 1) return '这里放不下'
    const i = y * W + x
    if (g.types[i] !== IT.GRASS && g.types[i] !== IT.SAND) return '只能放在平地上'
    if (g.level[i] > 0 || g.level[i - W] > g.level[i]) return '这里放不下'
    if ([g.airport, g.plaza, g.dock].some(k => x >= k.x - 1 && x < k.x + k.w + 1 && y >= k.y - 1 && y < k.y + k.h + 2)) return '离设施太近了'
    // 和别的建筑之间至少空一格
    for (let yy = y - 1; yy <= y + 1; yy++) for (let xx = x - 1; xx <= x + 1; xx++) if (taken.has(yy * W + xx)) return '离别的帐篷太近了'
    if (g.objects.some(o => o.kind === 'rock' && !d.removed.includes(o.id) && objTile(o)[0] === x && objTile(o)[1] === y)) return '石头挪不动'
  }
  const di = (spot.ty + 1) * W + spot.tx
  if ((g.types[di] !== IT.GRASS && g.types[di] !== IT.SAND) || g.level[di] > 0) return '门口要留出能走的地方'
  return null
}

// 当前的阻挡：地形 + 建筑 + 没被清掉的树干和石头 + 帐篷
export function isleBlocked(g: Isle, d: IsleDyn): Uint8Array {
  const b = Uint8Array.from(g.blocked)
  for (const o of g.objects) if (d.removed.includes(o.id) && (o.kind === 'tree' || o.kind === 'fruit_tree' || o.kind.startsWith('palm') || o.kind === 'rock')) {
    const [x, y] = objTile(o)
    b[y * ISLE_W + x] = g.types[y * ISLE_W + x] === IT.GRASS || g.types[y * ISLE_W + x] === IT.SAND ? 0 : 1
  }
  for (const t of allTents(d)) for (const [x, y] of tentTiles(t)) b[y * ISLE_W + x] = 1
  // 馆长的帐篷只挡中间 3×2；盖成博物馆以后整片 7×4 都挡住（门口在底边中间，从下面一格进）
  if (d.curatorTent) for (const [x, y] of museumBuilt(d) ? museumTiles(d.curatorTent) : tentTiles(d.curatorTent)) b[y * ISLE_W + x] = 1
  // 广场上岛务所的帐篷
  const p = g.plaza
  for (let y = p.y + 1; y < p.y + 4; y++) for (let x = p.x + p.w / 2 - 2; x < p.x + p.w / 2 + 2; x++) b[y * ISLE_W + x] = 1
  return b
}
