// 客户端共享状态（服务端下发的权威数据的本地镜像）
import type { HouseInfo, PlotState, Slot, Holding, ServerMsg, IslePublic } from '../shared/protocol.ts'
import { dayOf, hourOf, rainingAt, START_GEAR } from '../shared/data.ts'
import type { Gear } from '../shared/data.ts'
import type { RestoreState } from '../shared/restore.ts'

export const state = {
  me: { id: 0, name: '', hue: 180, coins: 0, inv: [] as (Slot | null)[], selected: 0 },
  plots: new Map<string, PlotState>(),
  houses: [] as HouseInfo[],
  myLot: null as number | null,
  holding: null as Holding | null,
  home: null as Extract<ServerMsg, { t: 'home' }> | null,   // 最近一次收到的小屋家具
  story: null as Extract<ServerMsg, { t: 'story' }> | null, // 和村民的关系、任务、信件
  restore: null as RestoreState | null,                     // 复兴工程的全服进度
  lastEventDay: -1,   // 上一段心事件是哪天看的（每天最多一段，免得两段剧情连着演）
  gear: { ...START_GEAR } as Gear,
  isle: null as IslePublic | null,   // 自己所在的岛（2D动森）
  energy: 100,        // 体力（服务端下发）
  clockBase: 0,
  clockAt: 0,
  get clock() { return this.clockBase + (performance.now() - this.clockAt) },
  get day() { return dayOf(this.clock) },
  get hour() { return hourOf(this.clock) },
  get rain() { return rainingAt(this.clock) },   // 现在是不是在下雨（雨只下一天里的一段）
  syncClock(c: number) { this.clockBase = c; this.clockAt = performance.now() },
}

export function selectedItem() {
  return state.me.inv[state.me.selected] ?? null
}
