// 静态规则数据：物品、作物、鱼种。前后端共用，数值只在这里改。
import { FURNITURE } from './furniture.ts'
import { hash2 } from './noise.ts'

export const TILE = 24               // 岛屿地块边长（美术像素）
// ── 世界时钟（动森方向：游戏时间就是现实时间，北京时间）──
// clock 是从「第 1 天早上 6 点」（世界纪元 epoch）起算的毫秒数，每天 6:00 换日、结算作物。
// 星露谷方向是 10 分钟一天、自己的历法（4 季 × 28 天）；这个分支改成现实的日子、现实的星期和月份
export const DAY_MS = 24 * 60 * 60 * 1000
export const DAY_START_HOUR = 6
export const TZ_MS = 8 * 60 * 60 * 1000   // 北京时间 UTC+8

let worldEpoch = 0
// epoch：第 1 天早上 6 点（北京时间）的时间戳。服务端启动时设，客户端收到 welcome 时设
export function setWorldEpoch(ms: number) { worldEpoch = ms }
// 某个时刻之前最近的一个北京时间早上 6 点
export function sixAm(ms: number) { return Math.floor((ms + TZ_MS - DAY_START_HOUR * 3600000) / DAY_MS) * DAY_MS + DAY_START_HOUR * 3600000 - TZ_MS }

// 历法：现实的年月日、星期（weekday 0 = 周一）、按北半球月份分季节（3～5 月春、6～8 月夏、9～11 月秋、12～2 月冬）
export const SEASON_NAMES = ['春', '夏', '秋', '冬'] as const
export const WEEKDAY_NAMES = ['一', '二', '三', '四', '五', '六', '日'] as const
export const SEASON_FIRST_MONTH = [3, 6, 9, 12] as const
export function calendarOf(day: number) {
  // 取那天北京时间中午，避开换日边界
  const local = worldEpoch + (day - 1) * DAY_MS + 6 * 3600000 + TZ_MS
  const d = new Date(local)
  const month = d.getUTCMonth() + 1
  const localDays = Math.floor(local / DAY_MS)            // 1970-01-01（星期四）起的天数
  return {
    year: d.getUTCFullYear(), month, date: d.getUTCDate(),
    season: month >= 3 && month <= 5 ? 0 : month >= 6 && month <= 8 ? 1 : month >= 9 && month <= 11 ? 2 : 3,
    weekday: (d.getUTCDay() + 6) % 7,
    week: Math.floor((localDays + 3) / 7),                // 按周一起算的周序号
  }
}
export function dayOf(clock: number) { return Math.floor(clock / DAY_MS) + 1 }
export function hourOf(clock: number) { return DAY_START_HOUR + ((clock % DAY_MS) / DAY_MS) * 24 } // 6.0 ~ 30.0（24 以后是第二天凌晨）

// ── 天气：大约三成的日子会下雨，只下其中一段（2～6 个钟点，6 点到 22 点之间开始）──
// 下雨的时候田地自动浇透（服务端在雨开始时浇），村民的去处、对话也跟着变
export function rainWindow(day: number): [number, number] | null {
  if (day <= 1 || hash2(day, 3, 7) >= 0.3) return null   // 第一天必定晴
  const start = DAY_START_HOUR + Math.floor(hash2(day, 5, 7) * 16 * 4) / 4
  return [start, start + 2 + Math.floor(hash2(day, 6, 7) * 16) / 4]
}
export function isRainy(day: number) { return rainWindow(day) !== null }   // 这一天会不会下雨
export function rainingAt(clock: number) {
  const w = rainWindow(dayOf(clock)), h = hourOf(clock)
  return !!w && h >= w[0] && h < w[1]
}

export type ItemId = string

export interface ItemDef {
  name: string
  icon: string          // icons 图集里的帧名（鱼用 sea 图集）
  atlas?: 'icons' | 'sea' | 'furniture'
  price?: number        // 卖价
  buy?: number          // 在鱼摊能买到的价格
  tool?: 'hoe' | 'can' | 'harpoon'
  seedOf?: CropId
  furniture?: boolean   // 家具（只在家具目录卖）
  quest?: boolean       // 剧情物品：不能卖、不能送礼，交给对的人
  food?: number         // 能吃：吃掉回多少体力
  stack?: boolean
}

export type CropId = 'rice' | 'cucumber' | 'tomato' | 'pumpkin' | 'strawberry'

export interface CropDef {
  name: string
  days: number      // 从播种到成熟需要浇水的天数
  harvest: ItemId
}

export const CROPS: Record<CropId, CropDef> = {
  rice: { name: '稻米', days: 2, harvest: 'rice' },
  cucumber: { name: '黄瓜', days: 3, harvest: 'cucumber' },
  tomato: { name: '番茄', days: 3, harvest: 'tomato' },
  strawberry: { name: '草莓', days: 4, harvest: 'strawberry' },
  pumpkin: { name: '南瓜', days: 5, harvest: 'pumpkin' },
}

// 生长阶段 1..4 对应 crops 图集的 <crop>_<stage>
export function cropStage(crop: CropId, grown: number): number {
  const d = CROPS[crop].days
  if (grown >= d) return 4
  return 1 + Math.min(2, Math.floor((grown / d) * 3))
}

export type Zone = 'reef' | 'mid' | 'deep'

export interface FishDef {
  name: string
  sprite: string
  zone: Zone
  price: number
  hp: number          // 需要命中几次
  speed: number       // 巡游速度（像素/秒）
  school?: number     // 成群出现时的群体数量
  weight: number      // 刷新权重
  glow?: string       // 深海发光色
  flee?: boolean      // 受惊会逃
}

// 鱼价（2026-09 重做经济，两轮）：鱼主要是做菜和交复兴工程的材料，直接卖不值几个钱；大鱼血厚，要好鱼枪才打得下来。数值依据见 docs/economy.md
export const FISH: Record<string, FishDef> = {
  clownfish: { name: '小丑鱼', sprite: 'clownfish', zone: 'reef', price: 6, hp: 2, speed: 26, weight: 6 },
  tang: { name: '蓝倒吊', sprite: 'tang', zone: 'reef', price: 10, hp: 2, speed: 30, weight: 5 },
  butterflyfish: { name: '蝴蝶鱼', sprite: 'butterflyfish', zone: 'reef', price: 9, hp: 2, speed: 26, weight: 5 },
  seahorse: { name: '海马', sprite: 'seahorse', zone: 'reef', price: 20, hp: 2, speed: 10, weight: 2 },
  pufferfish: { name: '河豚', sprite: 'pufferfish', zone: 'reef', price: 15, hp: 3, speed: 16, weight: 3 },
  idol: { name: '镰鱼', sprite: 'idol', zone: 'reef', price: 13, hp: 2, speed: 24, weight: 3 },
  parrotfish: { name: '鹦嘴鱼', sprite: 'parrotfish', zone: 'reef', price: 22, hp: 3, speed: 28, weight: 3 },
  horse_mackerel: { name: '竹荚鱼', sprite: 'horse_mackerel', zone: 'reef', price: 7, hp: 2, speed: 44, weight: 4, school: 7, flee: true },
  snapper: { name: '真鲷', sprite: 'snapper', zone: 'mid', price: 28, hp: 4, speed: 34, weight: 5 },
  bream: { name: '黑鲷', sprite: 'bream', zone: 'mid', price: 22, hp: 3, speed: 32, weight: 5 },
  mackerel: { name: '鲭鱼', sprite: 'mackerel', zone: 'mid', price: 12, hp: 2, speed: 52, weight: 5, school: 8, flee: true },
  lionfish: { name: '狮子鱼', sprite: 'lionfish', zone: 'mid', price: 25, hp: 3, speed: 14, weight: 3 },
  flounder: { name: '比目鱼', sprite: 'flounder', zone: 'mid', price: 30, hp: 4, speed: 18, weight: 2 },
  cuttlefish: { name: '乌贼', sprite: 'cuttlefish', zone: 'mid', price: 33, hp: 4, speed: 22, weight: 3, flee: true },
  octopus: { name: '章鱼', sprite: 'octopus', zone: 'mid', price: 40, hp: 5, speed: 16, weight: 2, flee: true },
  moray: { name: '海鳗', sprite: 'moray', zone: 'mid', price: 36, hp: 5, speed: 20, weight: 2 },
  bonito: { name: '鲣鱼', sprite: 'bonito', zone: 'deep', price: 30, hp: 4, speed: 60, weight: 4, school: 5, flee: true },
  bluefish: { name: '青甘', sprite: 'bluefish', zone: 'deep', price: 35, hp: 4, speed: 56, weight: 3 },
  amberjack: { name: '鰤鱼', sprite: 'amberjack', zone: 'deep', price: 70, hp: 7, speed: 50, weight: 2 },
  grouper: { name: '石斑鱼', sprite: 'grouper', zone: 'deep', price: 85, hp: 8, speed: 22, weight: 2 },
  tuna: { name: '蓝鳍金枪鱼', sprite: 'tuna', zone: 'deep', price: 150, hp: 10, speed: 64, weight: 1 },
  jelly_blue: { name: '蓝水母', sprite: 'jelly_blue', zone: 'deep', price: 16, hp: 2, speed: 8, weight: 4, glow: '#5fd8ff' },
  jelly_pink: { name: '粉水母', sprite: 'jelly_pink', zone: 'deep', price: 14, hp: 2, speed: 8, weight: 3, glow: '#ff8fd8' },
}

// ── 鲨鱼：抓不了的敌人，在断层和蓝洞巡游，靠近了会追过来咬人（扣氧气）──
// 浅滩没有鲨鱼，是安全区；鲨鱼追人不会离开自己的海域。被鱼枪打中会吓跑一阵
export interface SharkDef {
  name: string
  zone: Zone
  count: number     // 这片海域里同时有几条
  patrol: number    // 巡游速度
  chase: number     // 追人速度（潜水员最快 120，拼命游能甩掉）
  sense: number     // 发现潜水员的距离
  bite: number      // 咬一口扣几秒氧气
}
export const SHARKS: Record<string, SharkDef> = {
  reef_shark: { name: '礁鲨', zone: 'mid', count: 2, patrol: 40, chase: 100, sense: 230, bite: 25 },
  blue_shark: { name: '大青鲨', zone: 'deep', count: 2, patrol: 46, chase: 112, sense: 280, bite: 40 },
}
export const SHARK_BITE_RANGE = 26      // 鲨鱼嘴离潜水员多近算咬到
export const BITE_INVULN_MS = 2500      // 被咬后的无敌时间

// 不能捕、只会游来游去的生物（氛围）
export const AMBIENT_CREATURES = ['turtle', 'reef_shark', 'shark_pup'] as const

export const ITEMS: Record<ItemId, ItemDef> = {
  hoe: { name: '锄头', icon: 'hoe', tool: 'hoe' },
  can: { name: '水壶', icon: 'watering_can', tool: 'can' },
  harpoon: { name: '鱼枪', icon: 'harpoon', tool: 'harpoon' },
  seed_rice: { icon: 'seed_rice', name: '稻种', seedOf: 'rice', buy: 20, stack: true },
  seed_cucumber: { icon: 'seed_cucumber', name: '黄瓜种子', seedOf: 'cucumber', buy: 30, stack: true },
  seed_tomato: { icon: 'seed_tomato', name: '番茄种子', seedOf: 'tomato', buy: 40, stack: true },
  seed_strawberry: { icon: 'seed_strawberry', name: '草莓种子', seedOf: 'strawberry', buy: 60, stack: true },
  seed_pumpkin: { icon: 'seed_pumpkin', name: '南瓜种子', seedOf: 'pumpkin', buy: 80, stack: true },
  rice: { name: '稻米', icon: 'rice', price: 55, stack: true, food: 10 },
  cucumber: { name: '黄瓜', icon: 'cucumber', price: 80, stack: true, food: 15 },
  tomato: { name: '番茄', icon: 'tomato', price: 95, stack: true, food: 15 },
  strawberry: { name: '草莓', icon: 'strawberry', price: 170, stack: true, food: 25 },
  pumpkin: { name: '南瓜', icon: 'pumpkin', price: 300, stack: true, food: 40 },
  q_watch: { name: '秀兰的铜怀表', icon: 'q_watch', quest: true },
  q_knife: { name: '刻着「海」字的潜水刀', icon: 'q_knife', quest: true },
  q_photo: { name: '金枪鱼群的照片', icon: 'q_photo', quest: true },
  q_chronicle: { name: '潮汐港村志', icon: 'q_chronicle', quest: true },
}
for (const [id, f] of Object.entries(FISH)) {
  ITEMS[`fish_${id}`] = { name: f.name, icon: f.sprite, atlas: 'sea', price: f.price, stack: true }
}
// 家具：在屋里的家具目录买（不能卖），图标就是家具图集里的精灵
for (const [k, d] of Object.entries(FURNITURE)) ITEMS[`f_${k}`] = { name: d.name, icon: k, atlas: 'furniture', buy: d.price, stack: true, furniture: true }

export const INV_SIZE = 24
export const HOTBAR = 8
export const START_COINS = 150
export const START_INV: [ItemId, number][] = [['hoe', 1], ['can', 1], ['harpoon', 1], ['seed_rice', 12], ['seed_tomato', 6]]

// ── 潜水装备（小珊那里升级）──
// 装备不占背包格：气瓶是身上背的，鱼枪升级直接改造快捷栏里那把
export interface Gear { tank: number, harpoon: number, basket: number }
export type GearKind = keyof Gear
export const START_GEAR: Gear = { tank: 0, harpoon: 0, basket: 0 }
export type Cost = { coins: number, items?: [ItemId, number][] }

export interface TankDef {
  name: string
  oxygen: number      // 满瓶秒数
  deep: boolean       // 扛得住蓝洞深处的水压
  deepDrain: number   // 在蓝洞深处的耗氧倍率
  cost: Cost
  desc: string
}
export const TANKS: TankDef[] = [
  { name: '标准气瓶', oxygen: 150, deep: false, deepDrain: 1.5, cost: { coins: 0 }, desc: '潜水店的入门款，够在浅滩和断层转一圈。' },
  { name: '大容量气瓶', oxygen: 210, deep: false, deepDrain: 1.5, cost: { coins: 600 }, desc: '瓶身加长，能在水下多待一分钟。' },
  { name: '高压气瓶', oxygen: 270, deep: true, deepDrain: 1.4, cost: { coins: 2000, items: [['fish_snapper', 3]] }, desc: '扛得住蓝洞深处的水压。' },
  { name: '双联气瓶', oxygen: 360, deep: true, deepDrain: 1.15, cost: { coins: 5200, items: [['fish_grouper', 2]] }, desc: '两只高压瓶并联，深处也不怕耗氧。' },
]

export interface HarpoonDef {
  name: string
  damage: number      // 每次命中扣几点血
  range: number       // 射程（像素）
  cooldown: number    // 两发间隔（秒）
  tip: number         // 枪头颜色
  cost: Cost
  desc: string
}
export const HARPOONS: HarpoonDef[] = [
  { name: '竹柄鱼枪', damage: 1, range: 150, cooldown: 0.55, tip: 0xf2fbff, cost: { coins: 0 }, desc: '橡皮筋弹射，打小鱼够用。' },
  { name: '钢芯鱼枪', damage: 1, range: 185, cooldown: 0.45, tip: 0xdfe8f0, cost: { coins: 500 }, desc: '钢芯枪杆，射得更远、上弦更快。' },
  { name: '气动鱼枪', damage: 2, range: 215, cooldown: 0.4, tip: 0xffe08a, cost: { coins: 1600, items: [['fish_bream', 3]] }, desc: '气压推进，一发顶两发。' },
  { name: '潘家祖传鱼枪', damage: 3, range: 245, cooldown: 0.34, tip: 0xff9a6a, cost: { coins: 4800, items: [['fish_amberjack', 2]] }, desc: '老潘年轻时用的枪，专打大家伙。' },
]

// 鱼篓：一次下潜最多带回几条鱼（满了打死的鱼会逃掉，得回船上卸货）
export interface BasketDef { name: string, cap: number, cost: Cost, desc: string }
export const BASKETS: BasketDef[] = [
  { name: '小竹篓', cap: 8, cost: { coins: 0 }, desc: '挂在腰上的小竹篓。' },
  { name: '大竹篓', cap: 12, cost: { coins: 400 }, desc: '编得更密更大，多装四条。' },
  { name: '网兜鱼篓', cap: 18, cost: { coins: 1500, items: [['fish_mackerel', 5]] }, desc: '尼龙网兜，折起来不占地方。' },
  { name: '潜水员背篓', cap: 24, cost: { coins: 4000, items: [['fish_octopus', 3]] }, desc: '背在气瓶旁边，装得下一整船。' },
]

// ── 体力：上限 100，随时间慢慢回（每分钟 1 点，100 分钟回满）；出海一次花 40，吃作物能回 ──
// 星露谷方向是「每个 10 分钟的游戏日早上回满」；现实时间下一天只回一次就太少了，改成按分钟回
export const ENERGY_MAX = 100
export const DIVE_ENERGY = 40
export const ENERGY_REGEN_MS = 60 * 1000

// 没有高压气瓶时能下到的最深处（再往下水压太大）；蓝洞深处从 1120 开始
export const PRESSURE_LIMIT_Y = 1100
const GEARS: Record<GearKind, (TankDef | HarpoonDef | BasketDef)[]> = { tank: TANKS, harpoon: HARPOONS, basket: BASKETS }
export const gearDef = (kind: GearKind, lv: number) => GEARS[kind][lv]
export const gearMax = (kind: GearKind) => GEARS[kind].length - 1

// 玩家外观：衬衫颜色（客户端按色相重着色）
export const SHIRT_HUES = [180, 0, 35, 95, 140, 215, 265, 315] // 180 = 原画的青绿色

// ── 潮汐寿司（白天连续营业，现实钟点；晚上上线的人也要能做到）──
export const RESTAURANT_OPEN = 10   // 10:00 开门
export const RESTAURANT_CLOSE = 22  // 22:00 打烊
// 每天最多来多少位客人（全服共享）。现实时间一天营业 12 个钟点，不封顶的话有人一直待在店里就能刷出几千位；
// 星露谷方向 10 分钟一天约 18 位。客船停靠（复兴工程第四期）后多五成。经济按现实时间整体重算时再定
export const RESTAURANT_GUESTS_PER_DAY = 24
export const restaurantOpen = (hour: number) => hour >= RESTAURANT_OPEN && hour < RESTAURANT_CLOSE

export type DishId = 'sashimi' | 'nigiri' | 'kappa' | 'kaisendon' | 'tempura' | 'daifuku' | 'tomato' | 'toro'
export type Station = 'board' | 'fryer'
// fish: 'any' 表示任意一条鱼（自动挑背包里最便宜的，不浪费好鱼），或者指定鱼种
export interface Need { item?: ItemId, fish?: string }
export interface DishDef {
  name: string
  icon: string
  station: Station
  needs: Need[]
  base: number     // 手艺费：用最便宜的鱼做也值这些
  mult: number     // 菜价 = 手艺费 + 所用食材卖价之和 × mult（做成菜总比直接卖原料赚）
  weight: number   // 顾客点这道菜的权重
}

export const DISHES: Record<DishId, DishDef> = {
  sashimi: { name: '刺身拼盘', icon: 'sashimi', station: 'board', needs: [{ fish: 'any' }], base: 45, mult: 1.5, weight: 5 },
  nigiri: { name: '握寿司', icon: 'nigiri', station: 'board', needs: [{ fish: 'any' }, { item: 'rice' }], base: 50, mult: 1.3, weight: 6 },
  kappa: { name: '黄瓜卷', icon: 'kappa', station: 'board', needs: [{ item: 'cucumber' }, { item: 'rice' }], base: 40, mult: 1.3, weight: 4 },
  kaisendon: { name: '海鲜盖饭', icon: 'kaisendon', station: 'board', needs: [{ fish: 'any' }, { fish: 'any' }, { item: 'rice' }], base: 70, mult: 1.4, weight: 3 },
  tempura: { name: '南瓜天妇罗', icon: 'tempura', station: 'fryer', needs: [{ item: 'pumpkin' }], base: 40, mult: 1.4, weight: 3 },
  daifuku: { name: '草莓大福', icon: 'daifuku', station: 'board', needs: [{ item: 'strawberry' }, { item: 'rice' }], base: 40, mult: 1.4, weight: 3 },
  tomato: { name: '番茄冷盘', icon: 'tomato_salad', station: 'board', needs: [{ item: 'tomato' }, { item: 'tomato' }], base: 30, mult: 1.3, weight: 3 },
  toro: { name: '金枪鱼大腹', icon: 'toro', station: 'board', needs: [{ fish: 'tuna' }], base: 120, mult: 1.8, weight: 1 },
}

// 从背包里挑出做这道菜要用的格子；做不了返回 null。
// 返回每个用到的格子序号（同一格可能出现多次）和菜的基础价值
export function pickIngredients(inv: ({ id: ItemId, n: number } | null)[], dish: DishDef): { slots: number[], value: number } | null {
  const used = new Map<number, number>()
  const take = (i: number) => used.set(i, (used.get(i) ?? 0) + 1)
  const left = (i: number) => (inv[i]?.n ?? 0) - (used.get(i) ?? 0)
  const slots: number[] = []
  let sum = 0
  for (const need of dish.needs) {
    let pick = -1
    if (need.item) pick = inv.findIndex((s, i) => s?.id === need.item && left(i) > 0)
    else if (need.fish === 'any') {
      let best = Infinity
      inv.forEach((s, i) => {
        if (!s?.id.startsWith('fish_') || left(i) <= 0) return
        const p = ITEMS[s.id]?.price ?? 0
        if (p < best) { best = p; pick = i }
      })
    } else if (need.fish) pick = inv.findIndex((s, i) => s?.id === `fish_${need.fish}` && left(i) > 0)
    if (pick < 0) return null
    take(pick); slots.push(pick)
    sum += ITEMS[inv[pick]!.id]?.price ?? 0
  }
  return { slots, value: Math.round(dish.base + sum * dish.mult) }
}

// 做菜小游戏的评价 → 价格系数
export const QUALITY_MULT = [0.8, 1, 1.25] as const  // 一般 / 不错 / 完美
export const QUALITY_NAME = ['一般', '不错', '完美'] as const

export function countItem(inv: ({ id: ItemId, n: number } | null)[], id: ItemId) {
  return inv.reduce((a, s) => a + (s?.id === id ? s.n : 0), 0)
}
// 付得起这笔开销吗（金币 + 材料）
export function affordable(cost: Cost, coins: number, inv: ({ id: ItemId, n: number } | null)[]) {
  return coins >= cost.coins && (cost.items ?? []).every(([id, n]) => countItem(inv, id) >= n)
}
