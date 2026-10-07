// DIY 配方、工具耐久、里程成就（前后端共用）。数值照原作（见 docs/acnh-research.md）。
import type { ItemId } from './data.ts'

// ── 工具：用几次会坏（原作：简易钓竿 / 捕虫网 10 次，简易斧头 / 铲子 40 次，简易洒水壶 20 次）──
export type ToolKind = 'rod' | 'net' | 'axe' | 'shovel' | 'can'
export const TOOL_USES: Record<string, number> = { flimsy_rod: 10, flimsy_net: 10, flimsy_axe: 40, flimsy_shovel: 40, flimsy_can: 20 }

// ── 配方 ──
export interface Recipe { id: string, name: string, makes: ItemId, mats: [ItemId, number][] }
export const RECIPES: Record<string, Recipe> = {
  flimsy_rod: { id: 'flimsy_rod', name: '简易钓竿', makes: 'flimsy_rod', mats: [['branch', 5]] },
  flimsy_net: { id: 'flimsy_net', name: '简易捕虫网', makes: 'flimsy_net', mats: [['branch', 5]] },
  campfire: { id: 'campfire', name: '篝火', makes: 'campfire', mats: [['branch', 3]] },
  flimsy_axe: { id: 'flimsy_axe', name: '简易斧头', makes: 'flimsy_axe', mats: [['branch', 5], ['stone', 1]] },
  flimsy_can: { id: 'flimsy_can', name: '简易洒水壶', makes: 'flimsy_can', mats: [['softwood', 5]] },
  flimsy_shovel: { id: 'flimsy_shovel', name: '简易铲子', makes: 'flimsy_shovel', mats: [['hardwood', 5]] },
  vaulting_pole: { id: 'vaulting_pole', name: '撑竿', makes: 'vaulting_pole', mats: [['softwood', 5]] },
}

// ── 里程：成就（第一次做到某件事，之后按档位）──
export type Stat = 'moved' | 'fish' | 'bugs' | 'crafts' | 'sold' | 'weeds' | 'wood' | 'rocks' | 'fruit' | 'shells' | 'species'
export interface Achievement { id: string, name: string, stat: Stat, tiers: [number, number][] }   // [做到多少, 给多少里程]
export const ACHIEVEMENTS: Achievement[] = [
  { id: 'moved', name: '搬进无人岛', stat: 'moved', tiers: [[1, 500]] },
  { id: 'fish', name: '钓鱼的乐趣', stat: 'fish', tiers: [[1, 300], [10, 500], [50, 1000], [100, 2000]] },
  { id: 'bugs', name: '捕虫的乐趣', stat: 'bugs', tiers: [[1, 300], [10, 500], [50, 1000], [100, 2000]] },
  { id: 'crafts', name: '动手做做看', stat: 'crafts', tiers: [[1, 300], [5, 500], [20, 1000], [50, 2000]] },
  { id: 'sold', name: '第一笔买卖', stat: 'sold', tiers: [[1, 300], [20, 500], [100, 1000]] },
  { id: 'weeds', name: '拔草专家', stat: 'weeds', tiers: [[10, 300], [50, 500], [200, 1000]] },
  { id: 'wood', name: '伐木工', stat: 'wood', tiers: [[10, 300], [50, 500], [200, 1000]] },
  { id: 'rocks', name: '敲石头', stat: 'rocks', tiers: [[10, 300], [50, 500], [200, 1000]] },
  { id: 'fruit', name: '摘果子', stat: 'fruit', tiers: [[10, 300], [50, 500], [200, 1000]] },
  { id: 'shells', name: '海边拾贝', stat: 'shells', tiers: [[10, 300], [50, 500], [200, 1000]] },
  { id: 'species', name: '图鉴收集家', stat: 'species', tiers: [[5, 500], [20, 1000], [40, 2000]] },
]

// 移居账单：铃钱或里程，二选一（原作 49,800 铃钱 / 5,000 里程）
export const MOVE_BILL = { bells: 49800, miles: 5000 }

// 帐篷里阿海的小摊卖的东西（原作简易工具 400 / 200 左右）
export const TENT_SHOP: [ItemId, number][] = [['flimsy_rod', 400], ['flimsy_net', 400], ['flimsy_axe', 200], ['flimsy_can', 200]]

// 周叔要研究岛上的生物：交满几只给什么（原作 2 只简易斧头配方、4 只简易洒水壶配方、5 只馆长要来）
export const CRITTER_REWARDS: [number, string][] = [[2, 'flimsy_axe'], [4, 'flimsy_can']]
export const CRITTERS_FOR_CURATOR = 5
// 馆长来了以后再捐多少件不同的东西（鱼、虫、鉴定过的化石）就盖博物馆（原作 15）
export const MUSEUM_GOAL = 15
