// 任务与信件（前后端共用）：每日委托的生成规则、新手主线、村民的感谢信。设定见 docs/story.md。
import { ITEMS } from './data.ts'
import { hash2 } from './noise.ts'
import { NPC_IDS, NPC_INFO } from './npcs.ts'
import type { NpcId } from './npcs.ts'

export type Objective =
  | { kind: 'deliver', item: string, n: number, to: NpcId }   // 把东西交给某人
  | { kind: 'meet', npcs: NpcId[] }                          // 和列出的每个人都说上话
  | { kind: 'count', action: GuideAction, n: number, what: string }   // 做某件事 N 次（进度存在 quest.have）
// 新手引导里要数的动作（服务端在对应的地方记一笔）
export type GuideAction = 'plant' | 'water' | 'catch' | 'sell' | 'gift' | 'serve' | 'harvest' | 'eat' | 'daily' | 'donate' | 'upgrade'
// 任务指路：屏幕边上的箭头指向某位村民或某个地方（地块坐标）
export type GuideTarget = { npc: NpcId } | { x: number, y: number, label: string }
export interface Quest {
  id: string              // daily:<日> 或 story:<名字>
  kind: 'daily' | 'story'
  title: string
  giver: NpcId
  desc: string
  obj: Objective
  reward: { coins: number, friend?: number, item?: { id: string, n: number } }
  deadline?: number       // 最后一天（含）
  met?: NpcId[]           // meet 的进度
  thanks?: string         // 交付时收件人说的话（不写就用委托人的通用道谢）
  have?: number           // count 的进度
  to?: GuideTarget        // 指路
}

export interface Mail {
  id: number
  from: NpcId
  day: number
  title: string
  body: string
  attach?: { item: string, n: number } | { coins: number }
  read?: boolean
  taken?: boolean
}

// ── 每日委托：按「玩家 + 日期」确定性生成，同一天看几次都一样 ──
const REQUESTS: Record<NpcId, string[]> = {
  ahai: ['fish_clownfish', 'fish_tang', 'fish_butterflyfish', 'fish_horse_mackerel', 'fish_mackerel', 'fish_bream', 'fish_snapper'],
  laopan: ['fish_mackerel', 'fish_horse_mackerel', 'fish_idol', 'fish_bream', 'fish_pufferfish'],
  huashen: ['rice', 'cucumber', 'tomato', 'strawberry', 'pumpkin'],
  doudou: ['strawberry', 'fish_clownfish', 'tomato'],
  alan: ['fish_snapper', 'fish_tang', 'rice', 'cucumber', 'fish_bream'],
  zhoushu: ['rice', 'pumpkin', 'tomato', 'cucumber'],
  xiaoshan: ['fish_parrotfish', 'fish_seahorse', 'fish_pufferfish', 'fish_idol', 'fish_clownfish'],
}
// 委托文案：{item} {n} 会被替换
const REQUEST_TEXT: Record<NpcId, [string, string][]> = {
  ahai: [['急收{item}', '今天有熟客点名要{item}，我这儿断货了。帮我弄 {n} 条来，价钱好说。——阿海'], ['{item}要货', '码头那边有人订了{item}，{n} 条，越新鲜越好。'] ],
  laopan: [['船上的伙食', '明早出海，船上想备点{item}。{n} 条就够。——老潘'], ['压舱鱼', '老规矩，{n} 条{item}，放我船上。']],
  huashen: [['婶子缺{item}', '哎呀，今天铺子里的{item}不够卖了，你那儿有的话拿 {n} 个来，婶子不让你白跑！'], ['给邻居的回礼', '隔壁送了我一篮鱼，我想回点{item}，要 {n} 个。']],
  doudou: [['豆豆的秘密任务', '帮我找 {n} 个{item}！不要告诉奶奶！'], ['我想要{item}', '我想要{item}……{n} 个！拜托拜托！']],
  alan: [['今天的食材', '今天的菜单缺{item}，需要 {n} 份。品质不好的不要。——阿澜'], ['新菜试做', '我在试一道新菜，要用{item}，{n} 份。']],
  zhoushu: [['村里的储备', '村里在攒一批{item}，给复兴工程的师傅们做伙食。能帮忙凑 {n} 份吗？——周叔'], ['帮个小忙', '想请你帮忙准备 {n} 份{item}，村会上要用。']],
  xiaoshan: [['训练用鱼', '我在做鱼类观察记录，需要 {n} 条{item}。拜托啦！——小珊'], ['给学员看看', '明天有学员上课，想给他们看看{item}，{n} 条就行。']],
}

export function dailyQuest(playerId: number, day: number): Quest {
  const seed = 7331
  const npc = NPC_IDS[Math.floor(hash2(playerId, day, seed) * NPC_IDS.length)]
  const pool = REQUESTS[npc]
  const item = pool[Math.floor(hash2(playerId, day, seed + 1) * pool.length)]
  const price = ITEMS[item]?.price ?? 50
  // 便宜的多要几个（最多 6 个，一趟鱼篓装得下），贵的要一两个
  const n = Math.max(1, Math.min(6, Math.round(120 / price)))
  const [title, desc] = REQUEST_TEXT[npc][Math.floor(hash2(playerId, day, seed + 2) * REQUEST_TEXT[npc].length)]
  const name = ITEMS[item]?.name ?? item
  const fill = (s: string) => s.replace('{item}', name).replace('{n}', String(n))
  return {
    id: `daily:${day}`, kind: 'daily', title: fill(title), giver: npc, desc: fill(desc),
    obj: { kind: 'deliver', item, n, to: npc },
    reward: { coins: Math.max(150, price * n * 3), friend: 150 },
  }
}

// ── 新手主线：周叔的欢迎信 + 认识大家 ──
export const INTRO_QUEST: Quest = {
  id: 'story:intro', kind: 'story', title: '认识大家', giver: 'zhoushu',
  desc: '潮汐港不大，住着的都是好人。去和每个人打声招呼吧——周叔',
  obj: { kind: 'meet', npcs: [...NPC_IDS] }, reward: { coins: 150 }, met: [],
}
// ── 新手引导：一步教一样东西，做完自动接下一步（和「认识大家」同时进行）。走完一遍，七位村民也就都见过了 ──
const FARM = { x: 22.5, y: 21.5, label: '农田' }
const G = (id: string, giver: NpcId, title: string, action: GuideAction, n: number, what: string, desc: string, to: GuideTarget | undefined, reward: Quest['reward']): Quest =>
  ({ id: `story:g_${id}`, kind: 'story', title, giver, desc, obj: { kind: 'count', action, n, what }, reward, to, have: 0 })
export const GUIDE: Quest[] = [
  G('plant', 'huashen', '种下第一批种子', 'plant', 6, '种下种子',
    '岛北边篱笆围着的是大家的农田。先拿锄头（快捷栏第 1 格）对着田里的空地点一下，锄出几块地；再换成种子，点一下锄好的地就种下了。——花婶',
    FARM, { coins: 50, friend: 30 }),
  G('water', 'huashen', '浇水', 'water', 6, '浇水',
    '种子得喝了水才长。换上水壶（快捷栏第 2 格），把刚种下的地挨个浇一遍。每天早上 6 点，浇过水的庄稼长一天；下雨天老天爷替你浇。——花婶',
    FARM, { coins: 40, friend: 20 }),
  G('dive', 'laopan', '第一次出海', 'catch', 3, '抓到的鱼',
    '到栈桥尽头找我，我载你出海。出一趟海要花 40 体力，歇一会儿就缓过来（每分钟回 1 点）；饿了就吃点自己种的东西。鱼枪点哪儿射哪儿，大鱼要多射几下；腰上的鱼篓只装得下 8 条，满了就回船上。断层往下有鲨鱼，浅滩是安全的。——老潘',
    { npc: 'laopan' }, { coins: 80, friend: 30 }),
  G('sell', 'ahai', '换点零花钱', 'sell', 3, '卖出的东西',
    '急用钱就拿东西来我摊子上卖，或者丢进农田边的出货箱。不过我跟你说句实话：鱼直接卖不值几个钱，一条小丑鱼才六块。拿去阿澜那儿做成寿司，能翻好几倍。——阿海',
    { npc: 'ahai' }, { coins: 50, friend: 30 }),
  G('gift', 'doudou', '送个小礼物', 'gift', 1, '送出的礼物',
    '你能送我个礼物吗？！\n怎么送：先在下面的快捷栏里点一下要送的东西，把它拿在手上（背包里的东西要先换到快捷栏前 8 格）；再走到人跟前和他说话（按 E，手机上点「互动」），选「送出××」就送出去啦！手上拿着锄头、水壶的话，是没有「送出」这一项的哦。\n鱼和作物都能送，种子、工具不行。每个人一天只收一份、一周两份，生日那天送最管用（生日在任务栏的「关系」页能看到）。每个人喜欢的都不一样，送了看他的反应就知道了！\n我最喜欢草莓和小丑鱼！我白天在村子南边的小树林，中午去西边海滩捡贝壳，下午在奶奶的种子铺。——豆豆',
    { npc: 'doudou' }, { coins: 30, friend: 40, item: { id: 'seed_strawberry', n: 3 } }),
  G('cook', 'alan', '帮厨', 'serve', 1, '端给客人的菜',
    '同样一条小丑鱼，直接卖只值六块；切成刺身端给客人，能卖五十多——手艺是值钱的。潮汐寿司每天上午十点开门，晚上十点打烊，一天来的客人有数，早点来别错过。进店以后在砧板或油锅前选菜、切好，端给吧台前等着的客人。——阿澜',
    { x: 53.4, y: 23.4, label: '潮汐寿司' }, { coins: 100, friend: 30 }),
  G('harvest', 'huashen', '收获', 'harvest', 3, '收获的作物',
    '你种的稻子该熟了吧？熟了的庄稼会一跳一跳的，走过去点一下就收下来了。收下来的可以卖、做寿司、捐给复兴工程，也能吃。——花婶',
    FARM, { coins: 80, friend: 30, item: { id: 'seed_pumpkin', n: 3 } }),
  G('eat', 'huashen', '累了就吃', 'eat', 1, '吃掉的作物',
    '出一趟海要花 40 体力，体力每分钟回 1 点，一百分钟回满。等不及的话，把自己种的东西拿在手上「使用」一下就吃了：稻米回 10，南瓜能回 40。时钟下面那条绿的就是体力。——花婶',
    undefined, { coins: 30, friend: 20 }),
  G('board', 'zhoushu', '街坊的委托', 'daily', 1, '完成的委托',
    '广场上的告示板每天给你贴一张委托。接下来两天内做完，报酬是东西卖价的三倍，委托人也会记着你的好。去接一张试试。——周叔',
    { x: 35.4, y: 46.2, label: '告示板' }, { coins: 100, friend: 30 }),
  G('donate', 'zhoushu', '复兴计划', 'donate', 1, '给复兴工程的捐赠',
    '码头入口南边那块「复兴工程」告示板，是全岛一起修港口的账本。捐什么都行，一条鱼、一把米都算。凑齐一期，第二天一早就完工。——周叔',
    { x: 57.6, y: 29.2, label: '复兴工程告示板' }, { coins: 150, friend: 50 }),
  G('gear', 'xiaoshan', '更好的装备', 'upgrade', 1, '升级装备',
    '想去更深的地方、带更多鱼回来，就得换装备！来潜水店找我：大鱼篓一趟多装四条，大容量气瓶能多憋一分钟，大鱼得靠好鱼枪。高压气瓶才下得了蓝洞深处哦！——小珊',
    { npc: 'xiaoshan' }, { coins: 150, friend: 50 }),
]
// 新手引导走完：周叔的信，告诉玩家往后能做什么
export const GUIDE_DONE_MAIL: Omit<Mail, 'id' | 'day'> = {
  from: 'zhoushu', title: '往后的日子',
  body: '该教你的，大家都教完了。往后怎么过，全看你自己：\n\n· 鱼和作物做成菜才值钱，潮汐寿司每天都缺人手\n· 体力每分钟回 1 点，歇一歇再下海；饿了吃自己种的\n· 广场的告示板每天都有新委托\n· 复兴工程一期一期往前走，灯塔、集市、客船都等着你\n· 和村民多聊聊、送送礼，关系近了，他们会跟你说心里话\n· 每周六的集市、蓝洞深处的大鱼……\n\n潮汐港是你的家了。\n——周叔',
  attach: { coins: 250 },
}

export const WELCOME_MAIL: Omit<Mail, 'id' | 'day'> = {
  from: 'zhoushu', title: '欢迎来到潮汐港',
  body: '新邻居你好：\n\n我是村长老周。岛上这几年冷清了不少，你能来，大家都很高兴。\n\n房子里缺什么，跟我说；想认识认识邻居，广场上、码头边都能找到他们。广场的告示板每天会贴大家的委托，帮上忙的话，街坊们都会记着你的好。\n\n附上一点心意，买点种子先种上吧。\n\n——周叔',
  attach: { coins: 100 },
}

// ── 好感到了 2、4、6、8、10 心：村民寄来的信 ──
export const HEART_MAIL: Partial<Record<NpcId, Record<number, Omit<Mail, 'id' | 'day' | 'from'>>>> = {
  ahai: {
    2: { title: '给你留了点鱼', body: '今天收了一批好鲭鱼，给你留了几条。别谢我，下回多拿好货来就行。\n——阿海', attach: { item: 'fish_mackerel', n: 3 } },
    4: { title: '（字写得歪歪扭扭）', body: '那天跟你说的蓝洞的事，别往外传。\n下潜的时候，氧气剩三成就往上走。我是认真的。\n——海', attach: { item: 'fish_snapper', n: 2 } },
    6: { title: '鱼摊的钥匙', body: '我要是哪天去码头喝多了，摊子你帮我看着。\n钥匙在鱼篓底下。别告诉花婶我喝酒。\n——阿海', attach: { item: 'fish_grouper', n: 1 } },
    8: { title: '（信纸上有鱼腥味）', body: '你这家伙，比我儿子还像我儿子。\n——哦，我没儿子。反正就是那个意思。\n——阿海', attach: { item: 'fish_amberjack', n: 2 } },
    10: { title: '阿海的手艺', body: '我跟阿花说好了，往后每个礼拜天去她家吃饭。\n你也来。不来我就去你家门口骂街。\n附上我亲手晒的鱼干——鱼摊的独门手艺，不外传，就传你。\n——阿海', attach: { item: 'fish_tuna', n: 1 } },
  },
  huashen: {
    2: { title: '婶子的一点心意', body: '孩子，看你天天忙里忙外的，婶子给你包了几颗草莓种子。春天种下去，结了果先给豆豆尝一个！\n——花婶', attach: { item: 'seed_strawberry', n: 5 } },
    4: { title: '南瓜长大了', body: '今年的南瓜结得好，给你留了一个最大的。你呀，别光顾着干活，按时吃饭。\n——花婶', attach: { item: 'pumpkin', n: 1 } },
    6: { title: '照片', body: '那张潮汐节的老照片，婶子又洗了一张给你。\n等码头修好了，咱们再拍一张新的，把你也拍进去！\n——花婶', attach: { item: 'seed_pumpkin', n: 5 } },
    8: { title: '那天晚上的话', body: '那天晚上婶子说的话，你就当没听见啊！\n……不过说出来以后，心里还真舒坦了。\n——花婶', attach: { item: 'seed_strawberry', n: 10 } },
    10: { title: '全家福', body: '阿斌回来了，婶子拍了张全家福。照片上，婶子特意在旁边留了个位置——那是给你的。\n以后逢年过节，家里多摆一副碗筷。\n——花婶', attach: { item: 'pumpkin', n: 5 } },
  },
  laopan: {
    2: { title: '（一张船票背面写的字）', body: '明早风向好，适合下潜。\n——潘', attach: { item: 'fish_horse_mackerel', n: 4 } },
    4: { title: '灯塔', body: '那天晚上你看见我的船了吧。我只是去灯塔那边转转，没什么。\n谢谢你没多问。\n——老潘', attach: { item: 'fish_bonito', n: 1 } },
    6: { title: '（一把旧伞）', body: '秀兰的伞。放我这儿也是落灰。\n岛上雨多，你拿着。\n——潘', attach: { coins: 600 } },
    8: { title: '（船票背面）', body: '明天风平浪静。\n浅滩西边的礁石台子，下去的时候慢一点。\n——潘', attach: { item: 'fish_bonito', n: 2 } },
    10: { title: '守塔日志·新的一页', body: '我在秀兰的日志后面接着写了一页：\n「今晚灯亮了。有个孩子陪我上了塔。」\n——潘', attach: { coins: 2000 } },
  },
  xiaoshan: {
    2: { title: '憋气挑战书！', body: '上次算你赢！下次我一定憋得比你久！\n附上我最喜欢的鱼，当是训练补给～\n——小珊', attach: { item: 'fish_parrotfish', n: 1 } },
    4: { title: '谢谢你听我说', body: '那天说了比赛的事，说出来以后，心里轻了好多。\n以后下潜，我罩着你。\n——小珊', attach: { coins: 400 } },
    6: { title: '训练计划表', body: '给你写了一份憋气训练计划！每天早上对着海练十分钟。\n等你练好了，我们就去蓝洞！\n——小珊', attach: { item: 'fish_seahorse', n: 1 } },
    8: { title: '秘密基地', body: '看过那片会发光的海的人，只有你和我。\n这是我们两个人的秘密基地，不许带别人去！\n——小珊', attach: { item: 'fish_parrotfish', n: 2 } },
    10: { title: '潜水店的墙', body: '照片挂好了！金枪鱼群在左边，你在右边。\n客人问那是谁，我就说：「我的潜伴。」\n——小珊', attach: { coins: 1500 } },
  },
  zhoushu: {
    2: { title: '村里的账本', body: '你帮村里做的事，我都一笔一笔记在账上了。\n这是村里的一点谢意，别推辞。\n——周叔', attach: { coins: 300 } },
    4: { title: '一点旧东西', body: '整理村公所的时候翻出几袋稻种，放着也是放着，给你吧。\n——周叔', attach: { item: 'seed_rice', n: 15 } },
    6: { title: '谢谢你那天晚上', body: '那天晚上跟你说的话，我憋了五年。\n说出来以后，我去找老潘喝了一杯。他说：「早该来了。」\n——周叔', attach: { coins: 800 } },
    8: { title: '村志的保管费', body: '村志交给你保管，这是村里给的保管费。\n别推辞，账上已经记了。\n——周叔', attach: { coins: 1200 } },
    10: { title: '新的一页', body: '我把你写的那一页抄了一份，贴在村公所的墙上了。\n以后谁来村公所，都能看见。\n——周叔', attach: { coins: 2000 } },
  },
  alan: {
    2: { title: '员工餐', body: '今天剩了点米，捏了几个饭团……不对，写信又送不了饭团。那送你点米吧。\n——阿澜', attach: { item: 'rice', n: 6 } },
    4: { title: '奶奶的菜谱', body: '奶奶的菜谱里夹着一张画，画上是一栋房子，门口有棵歪脖子树。\n你在岛上见过吗？见过的话告诉我。\n——阿澜', attach: { item: 'fish_tang', n: 3 } },
    6: { title: '员工餐（真的）', body: '这次真的是员工餐。米是花婶的，鱼是你抓的，手艺是我的。\n……信封装不下，折成金币了。\n——阿澜', attach: { coins: 700 } },
    8: { title: '姨爷爷', body: '那天晚上，老潘吃了三碗饭，一句话没说。走的时候，他在门口站了很久，说：「长得真像她。」\n——阿澜', attach: { item: 'rice', n: 20 } },
    10: { title: '员工餐（灯塔茶泡饭）', body: '以后来店里，灯塔茶泡饭不收你钱。\n这是规矩，我定的。\n——阿澜', attach: { item: 'fish_snapper', n: 3 } },
  },
  doudou: {
    2: { title: '给你的！！', body: '我在海边捡到的！送给你！！\n（信封里掉出来几颗亮晶晶的小石子，和一条小丑鱼……活的？）\n——豆豆', attach: { item: 'fish_clownfish', n: 1 } },
    4: { title: '秘密', body: '我告诉你一个秘密：栈桥底下第三根柱子旁边有宝藏！\n你别告诉别人！\n——豆豆', attach: { coins: 50 } },
    6: { title: '藏宝图（背面）', body: '地图背面写着：\n「给我最好的朋友。这张图上的宝藏，都分你一半。」\n（信封里还有一颗亮晶晶的弹珠。）\n——豆豆', attach: { item: 'strawberry', n: 3 } },
    8: { title: '悄悄话', body: '那天你摸我头的事，不许告诉奶奶！\n……不过谢谢你。\n（信封里有一颗最亮的贝壳。）\n——豆豆', attach: { item: 'fish_clownfish', n: 2 } },
    10: { title: '爸爸教我画的', body: '爸爸教我画了一艘船！船上有你、有我、有奶奶、有爸爸！\n还有阿海爷爷，他非要站在船头。\n——豆豆', attach: { item: 'strawberry', n: 5 } },
  },
}

export const RESTORE_MAIL: Omit<Mail, 'id' | 'day'> = {
  from: 'zhoushu', title: '潮汐港复兴计划',
  body: '码头入口南边的沙滩上，我立了一块「复兴工程」告示板。\n修栈桥、修灯塔、办集市、把客船请回来——一期一期来。\n工程要的鱼、作物和工钱，谁都可以捐，捐多少都记在账上。凑齐一期，第二天一早就完工。\n潮汐港能不能活过来，就看大家的了。\n——周叔',
}

export const npcName = (id: NpcId) => NPC_INFO[id].name
