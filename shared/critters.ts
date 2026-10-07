// 鱼和虫（前后端共用）：物种都是原作里有的真实物种，出没地点、月份、钟点、影子大小、价格照原作（北半球；南半球月份错开半年）。
// 先做一部分（鱼 22、虫 18），其余按季节补齐。
// 月份：[起, 止]（含两端，可以跨年，比如 [10, 4] = 10 月到次年 4 月），多段用数组；钟点：[起, 止)，跨午夜也行，[0, 24] = 全天
export type FishLoc = 'sea' | 'river' | 'pond'
export type BugLoc = 'fly' | 'flower' | 'ground' | 'tree' | 'beach'

export interface FishDef { id: string, name: string, loc: FishLoc, size: 1 | 2 | 3 | 4 | 5 | 6, months: [number, number][], hours: [number, number], price: number, w: number, icon: string }
export interface BugDef { id: string, name: string, loc: BugLoc, months: [number, number][], hours: [number, number], price: number, w: number, icon: string }

const ALL: [number, number][] = [[1, 12]]
const DAY: [number, number] = [0, 24]
const f = (id: string, name: string, loc: FishLoc, size: FishDef['size'], months: [number, number][], hours: [number, number], price: number, w: number): FishDef => ({ id, name, loc, size, months, hours, price, w, icon: `fsh_${id}` })
const b = (id: string, name: string, loc: BugLoc, months: [number, number][], hours: [number, number], price: number, w: number): BugDef => ({ id, name, loc, months, hours, price, w, icon: `bug_${id}` })

export const FISHES: FishDef[] = [
  // 海
  f('sea_bass', '鲈鱼', 'sea', 5, ALL, DAY, 400, 10),
  f('horse_mackerel', '竹荚鱼', 'sea', 2, ALL, DAY, 150, 10),
  f('red_snapper', '真鲷', 'sea', 4, ALL, DAY, 3000, 2),
  f('olive_flounder', '牙鲆', 'sea', 5, ALL, DAY, 800, 4),
  f('dab', '鲽鱼', 'sea', 3, [[10, 4]], DAY, 300, 6),
  f('anchovy', '鳀鱼', 'sea', 2, ALL, [4, 21], 200, 8),
  f('zebra_turkeyfish', '狮子鱼', 'sea', 3, [[4, 11]], DAY, 500, 4),
  f('barred_knifejaw', '条石鲷', 'sea', 3, [[3, 11]], DAY, 5000, 1),
  f('squid', '鱿鱼', 'sea', 3, [[12, 8]], DAY, 500, 4),
  f('puffer_fish', '河豚', 'sea', 3, [[7, 9]], DAY, 5000, 1),
  f('ocean_sunfish', '翻车鱼', 'sea', 6, [[7, 9]], [4, 21], 4000, 1),
  // 河
  f('crucian_carp', '鲫鱼', 'river', 2, ALL, DAY, 160, 10),
  f('dace', '雅罗鱼', 'river', 3, ALL, [16, 9], 240, 6),
  f('pale_chub', '宽鳍鱲', 'river', 1, ALL, [9, 16], 200, 7),
  f('black_bass', '黑鲈', 'river', 4, ALL, DAY, 400, 6),
  f('freshwater_goby', '淡水虾虎鱼', 'river', 2, ALL, [16, 9], 400, 4),
  f('mitten_crab', '大闸蟹', 'river', 2, [[9, 11]], [16, 9], 2000, 2),
  f('yellow_perch', '黄金鲈', 'river', 3, [[10, 3]], DAY, 300, 5),
  f('bluegill', '蓝鳃太阳鱼', 'river', 2, ALL, [9, 16], 180, 6),
  // 池塘
  f('carp', '鲤鱼', 'pond', 4, ALL, DAY, 300, 8),
  f('goldfish', '金鱼', 'pond', 1, ALL, DAY, 1300, 1),
  f('catfish', '鲶鱼', 'pond', 4, [[5, 10]], [16, 9], 800, 3),
]

export const BUGS: BugDef[] = [
  b('common_butterfly', '纹白蝶', 'fly', [[9, 6]], [4, 19], 160, 8),
  b('yellow_butterfly', '黄纹蝶', 'fly', [[3, 6], [9, 10]], [4, 19], 160, 6),
  b('tiger_butterfly', '虎纹凤蝶', 'fly', [[3, 9]], [4, 19], 240, 5),
  b('monarch_butterfly', '帝王斑蝶', 'fly', [[9, 11]], [4, 17], 140, 6),
  b('moth', '蛾', 'fly', ALL, [19, 4], 130, 6),
  b('honeybee', '蜜蜂', 'fly', [[3, 7]], [8, 17], 200, 4),
  b('red_dragonfly', '红蜻蜓', 'fly', [[9, 10]], [8, 19], 180, 7),
  b('common_dragonfly', '蜻蜓', 'fly', [[4, 10]], [8, 17], 230, 5),
  b('darner_dragonfly', '碧伟蜓', 'fly', [[4, 10]], [8, 17], 230, 3),
  b('rice_grasshopper', '稻蝗', 'ground', [[8, 11]], [8, 19], 400, 5),
  b('migratory_locust', '飞蝗', 'ground', [[8, 11]], [8, 19], 600, 3),
  b('cricket', '蟋蟀', 'ground', [[9, 11]], [17, 8], 130, 6),
  b('bell_cricket', '金钟儿', 'ground', [[9, 10]], [17, 8], 430, 3),
  b('mantis', '螳螂', 'flower', [[3, 11]], [8, 17], 430, 3),
  b('ladybug', '瓢虫', 'flower', [[3, 6], [10, 10]], [8, 17], 200, 5),
  b('stinkbug', '椿象', 'flower', [[3, 10]], DAY, 120, 4),
  b('hermit_crab', '寄居蟹', 'beach', ALL, [19, 8], 1000, 4),
  b('tiger_beetle', '虎甲', 'ground', [[2, 10]], DAY, 1500, 2),
]

export const FISH_BY = Object.fromEntries(FISHES.map(x => [x.id, x]))
export const BUG_BY = Object.fromEntries(BUGS.map(x => [x.id, x]))

const inMonths = (ms: [number, number][], m: number) => ms.some(([a, z]) => a <= z ? m >= a && m <= z : m >= a || m <= z)
const inHours = (h: [number, number], hour: number) => { const x = ((hour % 24) + 24) % 24; return h[0] <= h[1] ? x >= h[0] && x < h[1] : x >= h[0] || x < h[1] }
// 南半球：月份错开半年
const localMonth = (month: number, hemi: 'N' | 'S') => hemi === 'S' ? ((month + 5) % 12) + 1 : month

export function fishAvailable(fd: FishDef, month: number, hour: number, hemi: 'N' | 'S') { return inMonths(fd.months, localMonth(month, hemi)) && inHours(fd.hours, hour) }
export function bugAvailable(bd: BugDef, month: number, hour: number, hemi: 'N' | 'S') { return inMonths(bd.months, localMonth(month, hemi)) && inHours(bd.hours, hour) }

// 按权重随机挑一种（r ∈ [0,1)）
export function pickWeighted<T extends { w: number }>(list: T[], r: number): T | null {
  const sum = list.reduce((a, x) => a + x.w, 0)
  if (!sum) return null
  let k = r * sum
  for (const x of list) { k -= x.w; if (k <= 0) return x }
  return list[list.length - 1]
}
