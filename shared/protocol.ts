// 网络协议（JSON over WebSocket）
import type { CropId, ItemId, DishId, Gear, GearKind } from './data.ts'
import type { HomeItem } from './furniture.ts'
import type { NpcId, Taste } from './npcs.ts'
import type { Quest, Mail } from './quests.ts'
import type { RestoreState } from './restore.ts'

// 和某位村民的关系（发给客户端的摘要）
export interface RelPublic { pts: number, talked: boolean, gifted: boolean, gw: number }

// isle:<岛号> = 动森式的岛（每人一座）；tent:<玩家号> = 玩家的帐篷里面
export type SceneId = 'island' | 'sea' | 'restaurant' | `map:${string}` | `home:${number}` | `isle:${number}` | `tent:${number}`   // map:<地图id> = shared/world 生成的地图

// ── 动森式的岛（2D动森，还原原作的流程）──
// 序章第 0 天的阶段：登岛 → 说明会 → 搭自己的帐篷 → 帮两位村民选位置 → 捡树枝 → 摘水果 → 篝火会起岛名 → 睡觉 → 第 1 天
export type IsleStage = 'arrive' | 'tent' | 'neighbors' | 'branches' | 'fruit' | 'party' | 'sleep' | 'day1'
export interface TentSpot { tx: number, ty: number }        // 帐篷占地的底边中间那一格
export interface IsleDrop { id: number, item: ItemId, x: number, y: number }   // 地上的东西（摇下来的水果、树枝）
export interface IslePublic {
  id: number
  owner: number
  ownerName: string
  seed: number
  name: string                 // 岛名（篝火会上起，之前是空的）
  stage: IsleStage
  tent: TentSpot | null        // 岛主的帐篷
  villagers: { id: string, tent: TentSpot | null }[]
  removed: number[]            // 被帐篷压掉、被捡走的地图物件 id
  fruitTaken: Record<number, number>   // 果树 id → 哪天摘的（3 天后再结果）
  drops: IsleDrop[]
  hemi: 'N' | 'S'
}
export type Dir = 'down' | 'up' | 'left' | 'right'

export interface Slot { id: ItemId, n: number }

export interface PlayerPublic {
  id: number
  name: string
  hue: number
  scene: SceneId
  x: number
  y: number
  dir: Dir
  moving: boolean
  act?: string     // 正在做的动作（挥锄/浇水/射击），给别人播动画用
  actAt?: number
  hold?: DishId    // 手上端着的菜
}

// 餐厅顾客：look 决定用哪套精灵（guest_kid / npc:ahai / farmer:95 …）
export interface Customer {
  id: number
  look: string
  seat: number
  dish: DishId
  state: 'arrive' | 'wait' | 'eat' | 'leave'
  age: number      // 进入当前状态多少毫秒了
  patience: number // 等菜的总耐心（毫秒）
  angry?: boolean  // 等太久气走了
}

export interface Holding { dish: DishId, value: number, quality: number }

export interface PlotState {
  tilled: boolean
  watered: boolean
  crop?: CropId
  grown?: number   // 已经长了几天
  owner?: number
}

// 潮汐村的房子：每个玩家一块宅基地
export interface HouseInfo { lot: number, owner: number, name: string, style: number }

export interface FishPublic {
  id: number
  kind: string
  x: number
  y: number
  vx: number
  vy: number
  hp: number
  mad?: boolean   // 鲨鱼正在追人
}

export type ClientMsg =
  | { t: 'hello', token: string, name: string, hue: number }
  // 机场柜台办移居手续：名字、生日、外观、半球、挑中的岛（种子）、「带什么去荒岛」的回答
  | { t: 'checkin', name: string, hue: number, birthday: [number, number], hemi: 'N' | 'S', seed: number, answer: number }
  | { t: 'pickup', obj?: number, drop?: number }        // 捡起地图上的东西（树枝）或者地上掉的东西
  | { t: 'shake', obj: number }                         // 摇树
  | { t: 'place', slot: number, tx: number, ty: number } // 把背包里的帐篷包放下
  | { t: 'prologue', step: string, name?: string }      // 序章推进（说明会听完、交树枝、交水果、给岛起名、睡觉……），服务端校验
  | { t: 'move', x: number, y: number, dir: Dir, moving: boolean }
  | { t: 'act', kind: 'till' | 'water' | 'plant' | 'harvest', tx: number, ty: number, slot?: number }
  | { t: 'scene', to: SceneId }
  | { t: 'travel', to: SceneId, portal?: number }
  | { t: 'enterHome', lot: number }
  | { t: 'talk', npc: NpcId }                           // 打开对话（每天第一次 +好感，推进「认识大家」）
  | { t: 'gift', npc: NpcId, slot: number }             // 送出背包里这一格的一个
  | { t: 'accept' }                                     // 接下告示板今天的委托
  | { t: 'deliver', quest: string }                     // 交付送货委托
  | { t: 'mailRead', id: number }
  | { t: 'event', id: string, choice?: string }          // 心事件看完了（带上选了哪个选项）
  | { t: 'donate', req: string, n: number }             // 往复兴工程捐东西（金币或物品）
  | { t: 'seaFind', id: string }                        // 在海底捡起剧情物品
  | { t: 'mailTake', id: number }                                  // 进（自己或别人的）小屋
  | { t: 'furnish', op: 'place', slot: number, x: number, y: number, flip?: boolean }  // 把背包里的家具摆到屋里
  | { t: 'furnish', op: 'pickup', id: number }                       // 收回背包
  | { t: 'buyFurn', kind: string, n: number }                        // 家具目录
  | { t: 'chest', op: 'open' | 'put' | 'take', slot?: number }       // 储物箱：put = 背包格 → 箱子，take = 箱子格 → 背包   // 出航/传送：island 或 map:<id>；portal = 目标地图的第几块传送石
  | { t: 'shoot', x: number, y: number, dx: number, dy: number }
  | { t: 'hit', fish: number }
  | { t: 'sell', slot: number, all: boolean }
  | { t: 'buy', item: ItemId, n: number }
  | { t: 'swap', a: number, b: number }
  | { t: 'surface', lost: boolean }
  | { t: 'chat', text: string }
  | { t: 'cook', dish: DishId, quality: number }
  | { t: 'serve', customer: number }
  | { t: 'discard' }
  | { t: 'upgrade', kind: GearKind }
  | { t: 'eat', slot: number }                          // 吃掉背包里的作物回体力

export type ServerMsg =
  | { t: 'welcome', you: number, token: string, coins: number, inv: (Slot | null)[], plots: Record<string, PlotState>, clock: number, day: number, epoch: number, players: PlayerPublic[], scene: SceneId, x: number, y: number, houses: HouseInfo[], lot: number | null, gear: Gear, isle?: IslePublic, miles?: number, name?: string, hue?: number }
  | { t: 'checkin' }                                    // 新玩家：先去机场柜台办手续
  | { t: 'isle', isle: IslePublic }                     // 岛的状态变了（帐篷、捡东西、阶段……）
  | { t: 'players', list: PlayerPublic[] }
  | { t: 'fish', list: FishPublic[] }
  | { t: 'plot', key: string, plot: PlotState | null }
  | { t: 'plots', plots: Record<string, PlotState> }
  | { t: 'inv', coins: number, inv: (Slot | null)[] }
  | { t: 'clock', clock: number, day: number }
  | { t: 'chat', from: string, text: string, sys?: boolean }
  | { t: 'toast', text: string }
  | { t: 'caught', fish: number, by: number, kind: string }
  | { t: 'fishHit', fish: number, hp: number, by: number }
  | { t: 'shot', by: number, x: number, y: number, dx: number, dy: number, gun?: number }
  | { t: 'left', id: number }
  | { t: 'houses', list: HouseInfo[] }
  | { t: 'restaurant', open: boolean, left: number, customers: Customer[] }   // left：今天还会来几位客人
  | { t: 'holding', hold: Holding | null }
  | { t: 'goto', scene: SceneId, x: number, y: number }
  | { t: 'home', lot: number, owner: number, ownerName: string, items: HomeItem[] }
  | { t: 'chest', slots: (Slot | null)[] }
  | { t: 'story', rel: Partial<Record<NpcId, RelPublic>>, quests: Quest[], board: { offer: Quest | null, taken: boolean }, mail: Mail[], seen: string[], done: string[] }
  | { t: 'restore', state: RestoreState }                              // 复兴工程的全服进度
  | { t: 'giftResult', npc: NpcId, taste: Taste, delta: number, birthday: boolean }
  | { t: 'questDone', id: string, npc: NpcId, to: NpcId, coins: number, title: string, thanks?: string }  // 服务端批准了出航/传送：客户端据此切场景
  | { t: 'served', customer: number, by: number, coins: number, tip: number }
  | { t: 'gear', gear: Gear, upgraded?: GearKind }
  | { t: 'energy', v: number }                          // 体力
  | { t: 'bitten', shark: number, bite: number, dx: number, dy: number }  // 被鲨鱼咬了：扣氧气，按 dx/dy 方向被撞开

export const plotKey = (tx: number, ty: number) => `${tx},${ty}`
