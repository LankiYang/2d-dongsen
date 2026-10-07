// 动森式岛屿的规则（前后端共用）：帐篷能不能放、某格现在能不能走
import { TILE } from '../data.ts'
import { ISLE_W, ISLE_H, IT } from './gen.ts'
import type { Isle } from './gen.ts'
import type { TentSpot } from '../protocol.ts'

export interface IsleDyn { tent: TentSpot | null, villagers: { id: string, tent: TentSpot | null }[], removed: number[] }

// 帐篷占 3×2 格，(tx, ty) 是底边中间那一格
export const TENT_W = 3, TENT_H = 2
export function tentTiles(t: TentSpot): [number, number][] {
  const out: [number, number][] = []
  for (let y = t.ty - TENT_H + 1; y <= t.ty; y++) for (let x = t.tx - 1; x <= t.tx + 1; x++) out.push([x, y])
  return out
}
export const allTents = (d: IsleDyn): TentSpot[] => [d.tent, ...d.villagers.map(v => v.tent)].filter((t): t is TentSpot => !!t)

// 地图物件压在哪一格（锚点在底边，往上挪 2 像素算）
export const objTile = (o: { x: number, y: number }) => [Math.floor(o.x / TILE), Math.floor((o.y - 2) / TILE)] as const

// 能放返回 null，不能放返回原因
export function canPlaceTent(g: Isle, d: IsleDyn, spot: TentSpot): string | null {
  const W = ISLE_W
  const others = allTents(d)
  for (const [x, y] of tentTiles(spot)) {
    if (x < 1 || y < 1 || x >= ISLE_W - 1 || y >= ISLE_H - 1) return '这里放不下'
    const i = y * W + x
    if (g.types[i] !== IT.GRASS && g.types[i] !== IT.SAND) return '只能放在平地上'
    if (g.level[i] > 0 || g.level[i - W] > g.level[i]) return '这里放不下'
    if ([g.airport, g.plaza, g.dock].some(k => x >= k.x - 1 && x < k.x + k.w + 1 && y >= k.y - 1 && y < k.y + k.h + 2)) return '离设施太近了'
    if (others.some(o => Math.abs(o.tx - x) <= 2 && y >= o.ty - TENT_H && y <= o.ty + 1)) return '离别的帐篷太近了'
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
  // 广场上岛务所的帐篷
  const p = g.plaza
  for (let y = p.y + 1; y < p.y + 4; y++) for (let x = p.x + p.w / 2 - 2; x < p.x + p.w / 2 + 2; x++) b[y * ISLE_W + x] = 1
  return b
}
