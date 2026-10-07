// 村民日程（前后端共用）：按钟点在岛上几个地方之间走动。
// 客户端据此让 NPC 寻路走过去；服务端据此判断「玩家是不是真的在这位村民身边」（对话、送礼、交付）。
// 钟点和世界时钟一致：6.0 ~ 30.0（30 = 次日 6 点）。
import type { NpcId } from './npcs.ts'
import { NPC_SPOTS } from './island.ts'

export interface Stop { from: number, x: number, y: number, rain?: { x: number, y: number }, note?: string }

const S = (from: number, x: number, y: number, note?: string, rain?: { x: number, y: number }): Stop => ({ from, x, y, note, rain })
const home = (id: NpcId) => NPC_SPOTS[id]

export const SCHEDULES: Record<NpcId, Stop[]> = {
  // 白天看鱼摊，傍晚去码头看海，夜里回摊子收拾
  ahai: [S(6, home('ahai').x, home('ahai').y, '鱼摊'), S(18, 58.5, 25.0, '码头', home('ahai')), S(22, home('ahai').x, home('ahai').y, '鱼摊')],
  // 白天看铺子，傍晚去广场找人唠嗑
  huashen: [S(6, home('huashen').x, home('huashen').y, '种子铺'), S(16, 32.0, 50.3, '广场', home('huashen')), S(19, home('huashen').x, home('huashen').y, '种子铺')],
  // 白天守着船，入夜在栈桥中间抽烟斗
  laopan: [S(6, home('laopan').x, home('laopan').y, '船边'), S(19, 63.5, 24.7, '栈桥'), S(23, home('laopan').x, home('laopan').y, '船边')],
  // 白天在潜水店，傍晚去沙滩练憋气
  xiaoshan: [S(6, home('xiaoshan').x, home('xiaoshan').y, '潜水店'), S(16, 56.5, 30.5, '沙滩', home('xiaoshan')), S(19, home('xiaoshan').x, home('xiaoshan').y, '潜水店')],
  // 上午在广场，中午去种子铺串门，下午去码头看看，傍晚回广场
  zhoushu: [S(6, home('zhoushu').x, home('zhoushu').y, '广场'), S(12, 36.2, 29.3, '种子铺', home('zhoushu')), S(15, 49.6, 25.3, '码头', home('zhoushu')), S(17, home('zhoushu').x, home('zhoushu').y, '广场')],
  // 一早在鱼摊挑鱼，开门前回店里备料
  alan: [S(6, 46.8, 21.9, '鱼摊'), S(9.5, home('alan').x, home('alan').y, '寿司店')],
  // 上午在小树林，中午去西边海滩捡贝壳，下午去奶奶的铺子，晚上回树林边
  doudou: [S(6, home('doudou').x, home('doudou').y, '小树林'), S(12, 10, 61, '西海滩', { x: 39.2, y: 29.2 }), S(16, 39.2, 29.2, '种子铺'), S(20, home('doudou').x, home('doudou').y, '小树林')],
}

// 集市日（复兴工程第三期完工后的每个周六）：几个人白天去集市摆摊、逛摊子。
// town.market 由服务端和客户端各自按工程进度和星期几设置
export const town = { market: false }
const MARKET_SCHEDULES: Partial<Record<NpcId, Stop[]>> = {
  huashen: [S(6, home('huashen').x, home('huashen').y, '种子铺'), S(9, 27.4, 36.3, '集市菜摊', home('huashen')), S(15, home('huashen').x, home('huashen').y, '种子铺'), S(16, 32.0, 50.3, '广场', home('huashen')), S(19, home('huashen').x, home('huashen').y, '种子铺')],
  zhoushu: [S(6, home('zhoushu').x, home('zhoushu').y, '广场'), S(9, 31.6, 36.3, '集市', home('zhoushu')), S(12, 36.2, 29.3, '种子铺', home('zhoushu')), S(15, 49.6, 25.3, '码头', home('zhoushu')), S(17, home('zhoushu').x, home('zhoushu').y, '广场')],
  doudou: [S(6, home('doudou').x, home('doudou').y, '小树林'), S(12, 29.5, 41.0, '集市', { x: 39.2, y: 29.2 }), S(16, 39.2, 29.2, '种子铺'), S(20, home('doudou').x, home('doudou').y, '小树林')],
}

// 某钟点的站位（和上一站，用来判断走在路上的时候）
export function stopAt(npc: NpcId, hour: number, rain: boolean): { at: { x: number, y: number }, prev: { x: number, y: number }, since: number } {
  const h = hour < 6 ? hour + 24 : hour
  const list = (town.market && MARKET_SCHEDULES[npc]) || SCHEDULES[npc]
  let i = 0
  for (let k = 0; k < list.length; k++) if (list[k].from <= h) i = k
  const pick = (s: Stop) => (rain && s.rain) ? s.rain : { x: s.x, y: s.y }
  const cur = list[i], prev = list[(i - 1 + list.length) % list.length]
  return { at: pick(cur), prev: pick(prev), since: cur.from }
}

// 玩家（地块坐标）离这位村民现在可能在的地方够不够近：在站位附近，或者在上一站到这一站的路上
export function nearScheduled(npc: NpcId, hour: number, rain: boolean, px: number, py: number, r = 6): boolean {
  const { at, prev } = stopAt(npc, hour, rain)
  const dx = at.x - prev.x, dy = at.y - prev.y, l2 = dx * dx + dy * dy
  const t = l2 ? Math.max(0, Math.min(1, ((px - prev.x) * dx + (py - prev.y) * dy) / l2)) : 1
  // 路径是绕着房子走的，比直线远一些，所以沿途放宽一倍
  const seg = Math.hypot(px - prev.x - t * dx, py - prev.y - t * dy)
  return Math.hypot(px - at.x, py - at.y) < r || seg < r * 2
}
