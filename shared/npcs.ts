// 村民（前后端共用）：生日、礼物喜好、按好感分档的台词、收礼反应。设定见 docs/story.md。
// 台词开头带 ^ 的用开心表情立绘。
import { ITEMS, FISH, SEASON_FIRST_MONTH } from './data.ts'

export type NpcId = 'ahai' | 'huashen' | 'laopan' | 'xiaoshan' | 'zhoushu' | 'alan' | 'doudou'
export type Taste = 'love' | 'like' | 'neutral' | 'dislike' | 'hate'
export const TASTE_PTS: Record<Taste, number> = { love: 80, like: 45, neutral: 20, dislike: -20, hate: -40 }
export const TASTE_NAME: Record<Taste, string> = { love: '最爱', like: '喜欢', neutral: '一般', dislike: '不喜欢', hate: '讨厌' }
export const HEART = 250                 // 一颗心的好感点
export const MAX_HEARTS = 10
export const TALK_PTS = 20               // 每天第一次聊天
export const QUEST_PTS = 150             // 完成对方的委托
export const GIFTS_PER_WEEK = 2
export const BIRTHDAY_MULT = 8
export const hearts = (pts: number) => Math.min(MAX_HEARTS, Math.floor(Math.max(0, pts) / HEART))

// 心数 → 台词档位（0/2/4/6/8）
export const tierOf = (h: number) => (Math.min(8, Math.floor(h / 2) * 2)) as 0 | 2 | 4 | 6 | 8

export interface NpcInfo {
  id: NpcId
  name: string
  title: string
  birthday: [number, number]          // [季（0 春 1 夏 2 秋 3 冬）, 日]；现实日期取那一季的第一个月（夏 9 日 = 6 月 9 日），见 birthdayOf
  voice: number                       // 说话声音高
  // 喜好：物品 id，或者类别 fish / fish:reef / fish:mid / fish:deep / jelly / crop / seed
  tastes: Partial<Record<Exclude<Taste, 'neutral'>, string[]>>
  intro: string                       // 第一次见面
  lines: Record<0 | 2 | 4 | 6 | 8, string[]>
  react: Record<Taste, string[]> & { birthday: string[] }
  thanks: string[]                    // 交付委托时
}

export const NPC_INFO: Record<NpcId, NpcInfo> = {
  ahai: {
    id: 'ahai', name: '阿海', title: '鱼摊老板', birthday: [1, 9], voice: 0.8,
    tastes: { love: ['fish_tuna', 'fish_grouper'], like: ['fish'], dislike: ['strawberry'], hate: ['jelly'] },
    intro: '新来的？嗯……胳膊挺结实，能下海。我是阿海，这岛上的鱼都得从我这儿过一遍。',
    lines: {
      0: ['嗯？想卖鱼就拿出来，我阿海收鱼从不压价。', '又来啦。今天海里收成怎么样？', '别在摊子前面晃，挡着我的光了。……开玩笑的。'],
      2: ['^你这手法越来越像样了。我年轻时候，一口气能憋三分钟！', '看鱼新不新鲜，先看眼睛。眼睛亮的，才是早上刚上来的。', '码头以前一到傍晚全是船，灯一亮，跟集市似的。'],
      4: ['蓝洞那地方……我年轻时下去过一次，差点没上来。你去的时候，记得看好氧气。', '别看我嘴硬，每回你下潜，我都往海面瞟两眼。', '花婶那边……她最近身体还好吧？我就随口一问。'],
      6: ['^你是我见过胆子最大的新人。比我当年还野！', '有些东西沉在海里太久，就不想捞了。可有时候，又梦见它。', '我这摊子，本来想着收了就收了。现在嘛……多撑几年也行。'],
      8: ['^你要是想学看潮水，随时来找我。这本事我没教过别人。', '我写过很多信，一封都没寄出去。……你别问是给谁的。', '有你在，这港口像是又活过来了。'],
    },
    react: {
      love: ['^好家伙！这可是好东西！今晚我得喝两杯！', '^你小子……眼光不错。这个我收下了。'],
      like: ['^嗯，新鲜！谢了。', '不错不错，这鱼肉紧实。'],
      neutral: ['嗯，谢了。', '哦，给我的？好。'],
      dislike: ['……这玩意儿，还是你自己留着吧。', '甜的？我这把年纪吃不了这个。'],
      hate: ['水母？！你是想让我这摊子关门吗！', '拿走拿走，别往我这儿塞这个。'],
      birthday: ['^你还记得我生日？……咳，风太大，眼睛进沙子了。'],
    },
    thanks: ['^来得正好！这个价钱我认，谢了！', '嗯，货不错，收下了。'],
  },
  huashen: {
    id: 'huashen', name: '花婶', title: '种子铺', birthday: [0, 14], voice: 1.15,
    tastes: { love: ['strawberry', 'pumpkin'], like: ['crop'], dislike: ['fish_pufferfish', 'fish_lionfish'], hate: ['fish_moray'] },
    intro: '^哎呀，新面孔！快过来让婶子看看——瘦了瘦了，得多吃点。我是花婶，种子、菜苗，找我就对了！',
    lines: {
      0: ['^哎呀，小家伙来啦！今天想种点啥？', '番茄得天天浇水，跟养孩子一个样。', '来得正好，刚到了一批新种子。'],
      2: ['地要是空着不种，过几天就荒回去了。人也一样，得有事干。', '^我那孙子豆豆又跑哪儿野去了？你看见跟我说一声。', '稻子是做寿司少不了的，阿澜那姑娘天天来问我要米。'],
      4: ['豆豆他爸在城里上班，一年回来一两趟。孩子嘴上不说，心里想。', '以前码头办潮汐节，我能一口气包三百个饭团。', '^你这孩子心眼好，婶子看人准。'],
      6: ['这岛要是散了，我们这些老骨头能去哪儿呢……好在你们来了。', '阿海那个倔老头……年轻时候可不是这样。算了，不提了。', '^有空来我这儿吃饭，婶子给你做南瓜粥！'],
      8: ['我年轻的时候啊，差点嫁给一个跑船的。后来他一走就是好几年。', '^你就像婶子自家孩子一样。', '要是豆豆他爸哪天回来，看见岛上这么热闹，得多高兴。'],
    },
    react: {
      love: ['^哎哟！这么好的东西给婶子？太贴心了！', '^我最喜欢这个了！你怎么知道的？'],
      like: ['^谢谢你呀，孩子。', '这个好，晚上正好加个菜。'],
      neutral: ['哦？谢谢啦。', '有心了，有心了。'],
      dislike: ['这个……婶子不太会弄。', '哎，这个就不必了吧。'],
      hate: ['海鳗！快拿走！看着就瘆得慌！', '哎呀我的天，这个可别往我这儿送！'],
      birthday: ['^你还记得婶子生日！来来来，今天必须留下吃饭！'],
    },
    thanks: ['^太好了，这下能赶上了！谢谢你呀！', '^就是这个！婶子没白托你。'],
  },
  laopan: {
    id: 'laopan', name: '老潘', title: '船长', birthday: [2, 21], voice: 0.68,
    tastes: { love: ['fish_tuna', 'fish_bonito'], like: ['fish_horse_mackerel', 'fish_mackerel', 'fish:deep'], dislike: ['tomato'], hate: ['jelly'] },
    intro: '……嗯。船上吐了没有？没吐就好。我是老潘，要出海找我。',
    lines: {
      0: ['要出海吗？船随时能开。', '嗯。风平浪静，适合下潜。', '氧气见底之前一定要回来。海可不等人。'],
      2: ['东北角那座灯塔，以前能照出去二十海里。夜航的船都靠它认路。', '越往下越黑，过了三十米就只能靠手电了。', '^你胆子不小。像我年轻时候。'],
      4: ['晚上睡不着，我就开船出去转转。……海上安静。', '这烟斗是我老伴给我买的。她说我抽起烟来像个老船长。我本来就是。', '那座灯塔黑了五年了。'],
      6: ['秀兰——我老伴——守了三十年灯塔。每天晚上七点，她准时点灯。', '她走的第二年，台风就把灯室打碎了。我一直没去修。修好了，里面也没有她了。', '^你有空跟我出海吧。有个人说说话，也挺好。'],
      8: ['她有一块铜怀表，掉进灯塔底下的海里了。我找了好几年。', '^谢谢你肯听我这个老头子唠叨。', '要是灯塔能再亮起来……我想亲手点一次灯。'],
    },
    react: {
      love: ['……好东西。谢谢。', '^你懂行。这个，我收下了。'],
      like: ['嗯，不错。', '谢了。'],
      neutral: ['嗯。', '放那儿吧。'],
      dislike: ['这个我不吃。', '……你自己留着吧。'],
      hate: ['水母缠渔网，我见了就头疼。', '拿开。'],
      birthday: ['……多少年没人给我过生日了。谢谢。'],
    },
    thanks: ['嗯。办得好。', '^不错，靠得住。'],
  },
  xiaoshan: {
    id: 'xiaoshan', name: '小珊', title: '潜水教练', birthday: [1, 26], voice: 1.3,
    tastes: { love: ['fish_seahorse', 'fish_parrotfish'], like: ['fish:reef', 'cucumber'], dislike: ['pumpkin'], hate: ['fish_moray'] },
    intro: '^嘿！新来的潜水员？我是小珊，这岛上唯一的持证潜水教练——想学潜水、升级装备，找我！',
    lines: {
      0: ['^嘿！想学潜水？找我就对了。', '今天水很清，能看到好远。', '鱼枪瞄准鱼身子的中间最稳，别打尾巴。'],
      2: ['^比比谁憋气久？我可是练过的！', '我以前在大陆练自由潜水，每天下水八个小时。', '深处的水母会发光，看见光点就知道到蓝洞了。'],
      4: ['全国赛那次……我在六十米的地方慌了，提前拉了绳。倒数第三。', '回岛上开潜水店，一开始只是想躲一躲。现在觉得，这儿挺好。', '^你下潜的样子越来越稳了，有点教练的风范哦。'],
      6: ['听说蓝洞最深处有蓝鳍金枪鱼群洄游。我想拍到它们。', '^我借你我的水下相机！帮我拍张蓝洞的照片好不好？', '海里的东西不会骗人。你慌了，它就知道。'],
      8: ['^等灯塔亮了，我们一起夜潜吧！发光的水母群，绝对值得看。', '跟你一起下潜的时候，我一点都不慌。', '^下次比赛，我想再试一次。'],
    },
    react: {
      love: ['^哇！这个超棒的！谢谢你！', '^你怎么知道我喜欢这个？！'],
      like: ['^谢啦！', '嘿嘿，不错嘛。'],
      neutral: ['哦，谢谢。', '嗯，收下啦。'],
      dislike: ['南瓜……我从小就不爱吃。', '呃，这个就算了吧。'],
      hate: ['海鳗？！我小时候被咬过一口！', '拿走拿走！'],
      birthday: ['^哇啊！生日礼物！你太好了吧！'],
    },
    thanks: ['^太棒了，谢谢你！', '^靠谱！下次训练我请你喝椰子水！'],
  },
  zhoushu: {
    id: 'zhoushu', name: '周叔', title: '村长', birthday: [3, 5], voice: 0.75,
    tastes: { love: ['pumpkin', 'fish_snapper'], like: ['rice', 'crop'], dislike: ['cucumber'], hate: ['fish_pufferfish'] },
    intro: '你好你好，欢迎来到潮汐港。我姓周，是这里的村长。房子还住得惯吗？有什么缺的，尽管跟我说。',
    lines: {
      0: ['潮汐港以前可热闹了。现在嘛……慢慢来。', '你好。今天也辛苦了。', '我在记今年的收成账。一笔一笔，心里才踏实。'],
      2: ['^你来了以后，码头上又能听见说话声了。', '这本账本记了四十年，从我接手村长那天起。', '我在想，要是大家一起出点力，码头是不是能修一修。'],
      4: ['村会上有人说我瞎折腾。可总得有人先动起来。', '年轻人都去大陆了，我不怪他们。岛上留不住人，是我们没本事。', '^你肯留下来，我很高兴。真的。'],
      6: ['台风以后，是我在村会上说「灯塔太贵，先不修」。……我一直后悔。', '老潘从来没怪过我。他越不说，我越难受。', '^现在修，还不晚。对吧？'],
      8: ['这本老村志，你帮我收着吧。岛上的事，总得有人记得。', '^潮汐港能有今天，你出了大力气。', '等港口修好了，我想办一次潮汐节。像以前那样。'],
    },
    react: {
      love: ['^哎呀，这怎么好意思……谢谢，谢谢。', '^正合我意。你真是细心。'],
      like: ['^谢谢你。', '有心了。'],
      neutral: ['谢谢。', '嗯，我收下了。'],
      dislike: ['这个……我胃不太好，就不要了吧。', '心意领了。'],
      hate: ['河豚？太危险了，可不能乱吃。', '这个可使不得。'],
      birthday: ['^记得我的生日……谢谢。我都快忘了。'],
    },
    thanks: ['^帮大忙了！我记在账上了。', '^好，好！村里都谢谢你。'],
  },
  alan: {
    id: 'alan', name: '阿澜', title: '寿司师傅', birthday: [2, 3], voice: 1.2,
    tastes: { love: ['fish_tuna', 'fish_snapper'], like: ['rice', 'cucumber', 'fish'], dislike: ['tomato'], hate: ['jelly'] },
    intro: '你就是新来的潜水员？我是阿澜，潮汐寿司的师傅。你抓到好鱼，记得先拿来给我看。',
    lines: {
      0: ['鱼要新鲜，米要温热，手要凉。这是寿司的规矩。', '晚上五点开店。来帮忙的话，先洗手。', '你今天抓了什么？让我看看。'],
      2: ['^你切鱼的手法有进步。……一点点。', '我两年前从大陆过来的。这家店关了好多年，我把它重新开起来了。', '花婶的米是岛上最好的。'],
      4: ['我奶奶是岛上出去的人，留下一本手写菜谱。上面画了一栋房子，我一直在找。', '^你有空帮我留意一下吧？房子门口有棵歪脖子树。', '做菜跟潜水一样，慌了就会出错。'],
      6: ['^和你一起开店，客人都多了。', '奶奶说，潮汐港的鱼是全世界最甜的。我以前不信。', '有时候觉得，我不是来开店的，是来找奶奶的。'],
      8: ['^我们找到奶奶的房子了。谢谢你……我好像终于回家了。', '这份菜谱，我想加上你教我的做法。', '^以后这家店，也有你的一份。'],
    },
    react: {
      love: ['^这成色……完美。今晚的特供有了！', '^你懂鱼。谢谢。'],
      like: ['不错，能用。谢了。', '^挺新鲜的，谢谢。'],
      neutral: ['嗯，谢谢。', '我收下了。'],
      dislike: ['番茄冷盘？这也叫料理？……开玩笑的，谢谢。', '这个我用不上。'],
      hate: ['水母不能进我的厨房。', '拿走，谢谢。'],
      birthday: ['^你记得我生日？……今天给你捏一份特制握寿司。'],
    },
    thanks: ['^正好缺这个！谢谢，晚上来店里吃一份。', '好，品质合格。谢了。'],
  },
  doudou: {
    id: 'doudou', name: '豆豆', title: '花婶的孙子', birthday: [0, 27], voice: 1.55,
    tastes: { love: ['strawberry', 'fish_clownfish'], like: ['tomato', 'fish:reef'], dislike: ['cucumber'], hate: ['fish_pufferfish'] },
    intro: '^你就是新来的！你会潜水吗？海底有没有美人鱼？我叫豆豆！我以后也要当潜水员！',
    lines: {
      0: ['^我今天捡到三个贝壳！', '奶奶不让我下海……可是我会游泳！', '你看见小丑鱼了吗？它们住在海葵里！'],
      2: ['^跟我玩捉迷藏吧！你数到一百！', '小珊姐姐说，等我长大了教我潜水。', '我爸爸在大陆，他说过年回来。'],
      4: ['^你是岛上第二好的大人！第一是奶奶。', '我偷偷在栈桥底下藏了一个宝藏，不告诉别人。', '阿海爷爷看起来很凶，其实会偷偷给我糖。'],
      6: ['^我给你画了一张地图！上面有潮汐港所有的秘密！', '岛上没有别的小孩……幸好有你陪我玩。', '要是灯塔亮了，爸爸的船晚上也能找到路吧？'],
      8: ['……我想爸爸了。你别告诉奶奶。', '^长大了我要跟你一起下潜！去最深的地方！', '^你是我最好的朋友！'],
    },
    react: {
      love: ['^哇！！给我的吗？！你最好了！', '^草莓！我最最最喜欢草莓！'],
      like: ['^谢谢你！', '^嘿嘿，我喜欢这个！'],
      neutral: ['哦……谢谢。', '这是啥？谢谢！'],
      dislike: ['黄瓜……我不要吃黄瓜。', '呃……奶奶说不能浪费，那我给奶奶吧。'],
      hate: ['河豚会爆炸的！快扔掉！', '哇啊！拿走拿走！'],
      birthday: ['^你记得我生日！！今天是我最开心的一天！'],
    },
    thanks: ['^哇！谢谢！你真厉害！', '^太好啦！'],
  },
}
export const NPC_IDS = Object.keys(NPC_INFO) as NpcId[]

// 物品的类别标签：用来匹配「喜欢所有鱼」「喜欢浅海鱼」这类喜好
export function itemTags(item: string): string[] {
  // 从具体到笼统排列：先匹配到的优先（讨厌水母要压过喜欢所有鱼）
  const tags = [item]
  if (item.startsWith('fish_')) {
    const f = FISH[item.slice(5)]
    if (item.startsWith('fish_jelly')) tags.push('jelly')
    if (f) tags.push(`fish:${f.zone}`)
    tags.push('fish')
  } else if (ITEMS[item]?.seedOf) tags.push('seed')
  else if (ITEMS[item]?.price && !ITEMS[item]?.furniture) tags.push('crop')
  return tags
}
// 能不能送（工具、家具不能送）
export const giftable = (item: string) => !!ITEMS[item]?.price
// 口味：先看具体物品，再看类别（越具体越优先）
export function tasteOf(npc: NpcId, item: string): Taste {
  const t = NPC_INFO[npc].tastes
  for (const tag of itemTags(item)) for (const k of ['love', 'hate', 'like', 'dislike'] as const) if (t[k]?.includes(tag)) return k
  return 'neutral'
}

// ── 生日：现实日期（动森方向，游戏时间跟现实同步）──
export const birthdayOf = (npc: NpcId) => ({ month: SEASON_FIRST_MONTH[NPC_INFO[npc].birthday[0]], date: NPC_INFO[npc].birthday[1] })
export const isBirthday = (npc: NpcId, month: number, date: number) => { const b = birthdayOf(npc); return b.month === month && b.date === date }
