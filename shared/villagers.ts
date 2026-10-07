// 动物村民（前后端共用）。性格照原作分 8 种：男 —— 悠闲、运动、暴躁、自恋；女 —— 普通、元气、成熟、大姐姐。
// 性格决定说话方式（台词按性格写，同性格的村民共用一套，再带上各自的口头禅）。
// 角色、名字、台词都是我们自己的；sprite 是 island_hd 图集里的帧名，face 是 icons_hd 里的立绘。

export type Personality = 'lazy' | 'jock' | 'cranky' | 'smug' | 'normal' | 'peppy' | 'snooty' | 'sisterly'
export const PERSONALITY_NAME: Record<Personality, string> = {
  lazy: '悠闲', jock: '运动', cranky: '暴躁', smug: '自恋', normal: '普通', peppy: '元气', snooty: '成熟', sisterly: '大姐姐',
}

export interface VillagerDef {
  id: string
  name: string
  species: string
  personality: Personality
  phrase: string          // 口头禅（加在句尾）
  voice: number           // 说话声音高低
  tent: 'tent_orange' | 'tent_blue'
}

export const VILLAGERS: Record<string, VillagerDef> = {
  v_dog: { id: 'v_dog', name: '团子', species: '小狗', personality: 'lazy', phrase: '汪呜', voice: 0.85, tent: 'tent_blue' },
  v_bear: { id: 'v_bear', name: '阿壮', species: '小熊', personality: 'jock', phrase: '嘿哈', voice: 0.8, tent: 'tent_blue' },
  v_gator: { id: 'v_gator', name: '老戈', species: '鳄鱼', personality: 'cranky', phrase: '哼', voice: 0.65, tent: 'tent_orange' },
  v_duck: { id: 'v_duck', name: '白少', species: '鸭子', personality: 'smug', phrase: '呱哉', voice: 0.95, tent: 'tent_blue' },
  v_bunny: { id: 'v_bunny', name: '棉花', species: '兔子', personality: 'normal', phrase: '嗯呐', voice: 1.25, tent: 'tent_orange' },
  v_cat_yellow: { id: 'v_cat_yellow', name: '柠柠', species: '小猫', personality: 'peppy', phrase: '喵哈', voice: 1.45, tent: 'tent_orange' },
  v_bunny2: { id: 'v_bunny2', name: '跳跳', species: '兔子', personality: 'peppy', phrase: '蹦蹦', voice: 1.4, tent: 'tent_orange' },
  v_squirrel: { id: 'v_squirrel', name: '栗子', species: '松鼠', personality: 'normal', phrase: '咔哩', voice: 1.3, tent: 'tent_orange' },
  v_bear_green: { id: 'v_bear_green', name: '抹茶', species: '小熊', personality: 'sisterly', phrase: '呗', voice: 1.05, tent: 'tent_blue' },
  v_squirrel_purple: { id: 'v_squirrel_purple', name: '紫苑', species: '松鼠', personality: 'snooty', phrase: '呢', voice: 1.2, tent: 'tent_orange' },
  v_deer: { id: 'v_deer', name: '鹿鸣', species: '小鹿', personality: 'snooty', phrase: '哦呵', voice: 1.15, tent: 'tent_orange' },
  v_cat: { id: 'v_cat', name: '阿芙', species: '小猫', personality: 'sisterly', phrase: '喵咧', voice: 1.0, tent: 'tent_blue' },
}
export const VILLAGER_IDS = Object.keys(VILLAGERS)

// 开局同来的两位：原作固定是一位运动、一位大姐姐（按岛的种子挑）
export function starters(seed: number): [string, string] {
  const pick = (p: Personality, k: number) => {
    const list = VILLAGER_IDS.filter(id => VILLAGERS[id].personality === p)
    return list[Math.abs(seed * 31 + k) % list.length]
  }
  return [pick('jock', 1), pick('sisterly', 2)]
}

// 句尾加口头禅
export const withPhrase = (v: VillagerDef, text: string) => {
  const m = text.match(/^(.*?)([。！？…]*)$/s)
  return m ? `${m[1]}，${v.phrase}${m[2] || '！'}` : text
}

// ── 第 0 天的台词（按性格）──
// 登岛时打招呼 / 请玩家帮忙挑帐篷位置 / 搭好以后 / 篝火会上
export const DAY0_LINES: Record<Personality, { hello: string, ask: string, done: string, party: string }> = {
  jock: {
    hello: '嘿！你也是来这座岛的吧？我们一起把这里变成最棒的训练场',
    ask: '帐篷要搭在哪儿呢……你帮我挑个地方吧！我相信你的眼光',
    done: '好地方！早上起来就能直接开跑',
    party: '今天一路都在搬东西，正好当热身了',
  },
  sisterly: {
    hello: '哟，新来的？以后就是一个岛上的人了，有事就喊我',
    ask: '我的帐篷你帮我放吧，我懒得挑。别放太偏就行',
    done: '不错嘛，挺会挑的。谢啦',
    party: '这火烤着真舒服。以后谁欺负你，跟我说',
  },
  lazy: {
    hello: '嗯……你好呀。这座岛上的零食应该很好吃吧',
    ask: '帐篷……你帮我放吧，我想先躺一会儿',
    done: '这里晒得到太阳，适合睡午觉',
    party: '火边暖暖的……要是有棉花糖就好了',
  },
  cranky: {
    hello: '哼，又来一个。别在我睡觉的时候吵吵嚷嚷',
    ask: '帐篷你看着放吧。离吵闹的地方远一点',
    done: '还行。算你有点眼光',
    party: '……这火生得还不错',
  },
  smug: {
    hello: '幸会。这座岛有我在，品味自然不会差',
    ask: '帐篷的位置就交给你了，要配得上我的风度',
    done: '嗯，视野不错，配得上我',
    party: '火光、星空、还有我，真是一幅好画',
  },
  normal: {
    hello: '你好呀！以后请多关照，我会做好吃的点心分给大家',
    ask: '能帮我挑个搭帐篷的地方吗？靠近花的地方就更好啦',
    done: '谢谢你！这里真舒服',
    party: '大家一起围着火，好温暖呀',
  },
  peppy: {
    hello: '哇！新朋友！我们一起在这座岛上开心地生活吧',
    ask: '帮我挑帐篷的位置吧！要能看到海的那种',
    done: '耶！我太喜欢这里了',
    party: '好想唱歌！你也一起来嘛',
  },
  snooty: {
    hello: '你好。希望这座岛的生活能有点格调',
    ask: '帐篷的位置你来定吧，可别太寒酸',
    done: '还算体面，就这样吧',
    party: '篝火晚会……偶尔也挺有情调的',
  },
}

// 第 1 天起的日常闲聊（按性格，每天换一句）
export const DAILY_LINES: Record<Personality, string[]> = {
  jock: ['早上跑了一圈海滩，这岛的沙子踩着正好', '钓鱼也是锻炼！收竿那一下全靠爆发力', '你今天动了吗？没动的话跟我一起做深蹲'],
  sisterly: ['岛上的虫子你别怕，抓多了就习惯了', '我昨晚在帐篷外面听了一晚上的海浪，挺好睡', '有人欺负你没？……好吧，这岛上也就我们几个'],
  lazy: ['我刚在树下睡了一觉，掉下来的树枝差点砸到我', '你钓到鱼的话……能不能让我闻闻', '今天也什么都不想做，真好'],
  cranky: ['哼，这岛上的蚊子比人还多', '年轻人就是精力好，一大早就在拔草', '钓鱼要耐得住性子，浮漂没沉下去别乱拉'],
  smug: ['这岛的日落，配得上我的品味', '捕虫网挥得好不好看，其实很重要', '我已经在想帐篷前面该摆什么花了'],
  normal: ['今天天气真好，适合在海边捡贝壳', '我在研究用岛上的水果做点心', '你的口袋看起来鼓鼓的，收获不错吧'],
  peppy: ['我今天看到一只超漂亮的蝴蝶！差一点就抓到了', '岛上的一切都好新鲜！明天会有什么呢', '我们来比赛谁先钓到大鱼吧'],
  snooty: ['在这里生活，总得讲究一点', '我不太喜欢虫子，不过蝴蝶还算优雅', '这座岛……还有很大的改进空间'],
}
