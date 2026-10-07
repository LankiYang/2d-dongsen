// 主线「潮汐港复兴计划」（前后端共用）：全服一起往工程里捐东西，凑齐一期就开工，第二天完工。
// 设定见 docs/story.md。捐赠在码头入口的工程告示板。
export interface Req { id: string, item: string, n: number }   // item = 'coins' 表示金币
export interface Bundle { name: string, reqs: Req[] }
export interface Stage { name: string, desc: string, unlock: string, bundles: Bundle[] }

const R = (id: string, item: string, n: number): Req => ({ id, item, n })

export const STAGES: Stage[] = [
  {
    name: '修复栈桥',
    desc: '通往灯塔小岛的木栈桥在台风里塌了。先把桥修起来，大家才能上岛看看灯塔还剩下什么。',
    unlock: '栈桥修好了，可以走到东北角的灯塔小岛',
    bundles: [
      { name: '工钱与木料', reqs: [R('s1_coins', 'coins', 8000)] },
      { name: '给工匠的渔获', reqs: [R('s1_clown', 'fish_clownfish', 10), R('s1_tang', 'fish_tang', 8), R('s1_mack', 'fish_horse_mackerel', 12), R('s1_mackerel', 'fish_mackerel', 8)] },
      { name: '工地伙食', reqs: [R('s1_rice', 'rice', 30), R('s1_tomato', 'tomato', 15)] },
    ],
  },
  {
    name: '重建灯塔',
    desc: '灯室碎了，塔身也裂了。修好它，夜里的船就又能找到回家的方向。',
    unlock: '灯塔重新亮起，夜里光束会扫过海面',
    bundles: [
      { name: '灯室玻璃与工钱', reqs: [R('s2_coins', 'coins', 25000)] },
      { name: '深海的礼物', reqs: [R('s2_bonito', 'fish_bonito', 5), R('s2_blue', 'fish_bluefish', 5), R('s2_amber', 'fish_amberjack', 3), R('s2_grouper', 'fish_grouper', 3)] },
      { name: '发光的灯芯', reqs: [R('s2_jb', 'fish_jelly_blue', 8), R('s2_jp', 'fish_jelly_pink', 8)] },
      { name: '守塔人的饭', reqs: [R('s2_pumpkin', 'pumpkin', 10), R('s2_straw', 'strawberry', 10)] },
    ],
  },
  {
    name: '重开潮汐集市',
    desc: '以前每周六，广场上都摆满了摊子。把集市办起来，岛上才有烟火气。',
    unlock: '广场摆起集市摊位；每周六是集市日，那天卖东西多给 25%',
    bundles: [
      { name: '摊位与布料', reqs: [R('s3_coins', 'coins', 20000)] },
      { name: '丰收', reqs: [R('s3_rice', 'rice', 50), R('s3_cucumber', 'cucumber', 30), R('s3_tomato', 'tomato', 30), R('s3_straw', 'strawberry', 20), R('s3_pumpkin', 'pumpkin', 15)] },
      { name: '码头鲜货', reqs: [R('s3_snapper', 'fish_snapper', 10), R('s3_bream', 'fish_bream', 10), R('s3_cuttle', 'fish_cuttlefish', 5), R('s3_octo', 'fish_octopus', 5)] },
    ],
  },
  {
    name: '迎来客船',
    desc: '灯塔亮了，集市开了，就差一艘船。把码头收拾体面，办一场潮汐节，把客船请回来。',
    unlock: '客船停靠码头，寿司店的客人变多；潮汐节',
    bundles: [
      { name: '潮汐节经费', reqs: [R('s4_coins', 'coins', 50000)] },
      { name: '海里的珍品', reqs: [R('s4_tuna', 'fish_tuna', 3), R('s4_seahorse', 'fish_seahorse', 5), R('s4_parrot', 'fish_parrotfish', 5), R('s4_moray', 'fish_moray', 3), R('s4_flounder', 'fish_flounder', 5)] },
      { name: '节日宴席', reqs: [R('s4_rice', 'rice', 60), R('s4_pumpkin', 'pumpkin', 20), R('s4_straw', 'strawberry', 20)] },
    ],
  },
]
export const ALL_REQS: Record<string, { stage: number, req: Req }> = {}
STAGES.forEach((st, i) => { for (const b of st.bundles) for (const r of b.reqs) ALL_REQS[r.id] = { stage: i, req: r } })

// 全服状态：done = 已完工几期；progress = 当前这期每一项捐了多少；funded = 凑齐的那天（第二天完工）
export interface RestoreState { done: number, progress: Record<string, number>, funded: number | null, top: { name: string, pts: number }[] }
export const stageFunded = (st: RestoreState) => {
  const s = STAGES[st.done]
  return !!s && s.bundles.every(b => b.reqs.every(r => (st.progress[r.id] ?? 0) >= r.n))
}
// 捐赠折算成贡献分：金币 1 分/10 金，物品按卖价
export const MARKET_DAY = 5   // 周六（weekday 从 0 = 周一算）
