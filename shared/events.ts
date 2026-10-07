// 心事件（前后端共用）：好感到了、时段和天气对、玩家走进指定区域，就播放一段过场剧情。
// 小镇事件（town）：复兴工程每完工一期，全镇看一段剧情；不占「每天一段心事件」的名额。
// 剧本由客户端播放；选项的效果（加好感、给东西、开任务）由服务端校验后执行。设定见 docs/story.md。
// 坐标都是地块坐标；台词开头带 ^ 用开心表情立绘。
import type { NpcId } from './npcs.ts'
import type { Quest } from './quests.ts'
import type { Dir } from './protocol.ts'

export type Who = NpcId | 'me'
export type Emote = '!' | '?' | '♥' | '…'
export type Cmd =
  | ['place', Who, number, number, Dir]        // 把角色放到某处、面朝某个方向（剧情开始时摆位）
  | ['walk', Who, number, number]              // 走过去（等走到）
  | ['face', Who, Dir]
  | ['cam', number, number]                    // 镜头移到这里
  | ['say', Who, string]                       // 说一句（点一下继续）
  | ['emote', Who, Emote]                      // 头顶冒个表情
  | ['wait', number]                           // 毫秒
  | ['fade', 'out' | 'in']
  | ['sfx', string]
  | ['ask', Who, string, [string, string][]]   // 选项：[文字, 效果 key]
  | ['note', string]                           // 旁白（没有立绘和名字）
  | ['fx', 'fireworks' | 'glow' | 'beamoff' | 'beamon', number, number]   // 特效：烟花 / 海里的荧光 / 灯塔光束关开（不等）

export interface Effect {
  friend?: number                              // 事件主角的好感
  also?: { npc: NpcId, pts: number }           // 顺带给别人加好感
  give?: { item: string, n: number }
  quest?: Quest
  reply?: [Who, string][]                      // 选了之后接着说的话
}
export interface HeartEvent {
  id: string
  npc: NpcId
  hearts: number
  title: string
  hours: [number, number]                      // 钟点范围（6~30，30 = 次日 6 点）
  noRain?: boolean
  area: { x: number, y: number, r: number }    // 玩家走进这个圆就触发
  after?: string[]                             // 先看过这些事件
  stage?: number                               // 复兴工程至少完工几期
  quest?: string                               // 先完成这个任务
  town?: boolean                               // 小镇事件：好感不限，只看工程进度
  script: Cmd[]
  choices?: Record<string, Effect>
  end?: Effect                                 // 不管怎么选都会执行
}

const E = (e: HeartEvent) => e

export const EVENTS: HeartEvent[] = [
  // ───────────── 阿海 ─────────────
  E({
    id: 'ahai_2', npc: 'ahai', hearts: 2, title: '看鱼眼睛', hours: [17, 19.5], noRain: true, area: { x: 48.5, y: 21.4, r: 4 },
    script: [
      ['place', 'ahai', 48.5, 20.4, 'down'], ['place', 'me', 48.5, 22.2, 'up'], ['cam', 48.5, 21.2],
      ['say', 'ahai', '哟，来得正好，我正收摊呢。'],
      ['say', 'ahai', '考考你——这两条鲭鱼，哪条是早上刚上来的？'],
      ['emote', 'me', '?'],
      ['say', 'ahai', '^看眼睛！眼睛亮、鼓着的，是新鲜的。眼睛发浑、塌下去的，就放久了。'],
      ['say', 'ahai', '我年轻那会儿啊，不看鱼眼睛，看海。一口气扎下去三分钟，海底什么样，我比谁都清楚。'],
      ['ask', 'ahai', '你信不信？', [['三分钟？教教我！', 'teach'], ['吹牛吧……', 'doubt']]],
      ['say', 'ahai', '行了，天黑前得把这点鱼卖完。明天见。'],
    ],
    choices: {
      teach: { friend: 40, reply: [['ahai', '^哈哈！好！改天带你去栈桥底下练练。憋气这事，靠的是心静。']] },
      doubt: { friend: 10, reply: [['ahai', '嘿，你这小家伙！……好吧，现在是憋不了三分钟了。老了。']] },
    },
  }),
  E({
    id: 'ahai_4', npc: 'ahai', hearts: 4, title: '蓝洞往事', hours: [19, 22], area: { x: 58, y: 25, r: 4 },
    script: [
      ['place', 'ahai', 58.5, 25.0, 'right'], ['place', 'me', 56.6, 25.0, 'right'], ['cam', 58, 24.6],
      ['emote', 'ahai', '…'],
      ['say', 'ahai', '……是你啊。'],
      ['face', 'ahai', 'left'],
      ['say', 'ahai', '看见东边那片颜色最深的海没有？那就是蓝洞。'],
      ['say', 'ahai', '三十多年前，我一个人下去过。想找传说里的金枪鱼群。'],
      ['say', 'ahai', '下到一半，手电灭了。四面八方全是黑的，分不清哪边是上。'],
      ['say', 'ahai', '我在里面转了不知道多久。最后是摸着石壁，一点一点爬上来的。'],
      ['say', 'ahai', '上来以后，我就再也没下过深水。'],
      ['ask', 'me', '……', [['那不是你的错。', 'kind'], ['现在还想下去吗？', 'ask']]],
      ['say', 'ahai', '天凉了，回去吧。'],
    ],
    choices: {
      kind: { friend: 60, reply: [['ahai', '……嗯。'], ['ahai', '^谢了。这话，三十年没人跟我说过。']] },
      ask: { friend: 30, reply: [['ahai', '想啊。做梦都想。'], ['ahai', '可这把老骨头……算了，有你们年轻人替我去看看，也好。']] },
    },
  }),
  E({
    id: 'ahai_6', npc: 'ahai', hearts: 6, title: '顺路送鱼', hours: [8, 14], area: { x: 48.5, y: 21.4, r: 4 }, after: ['ahai_4'],
    script: [
      ['place', 'ahai', 48.5, 20.4, 'down'], ['place', 'me', 48.5, 22.2, 'up'], ['cam', 48.5, 21.2],
      ['say', 'ahai', '你来得正好。帮我个忙。'],
      ['say', 'ahai', '这条真鲷，是今天最好的一条。你……顺路带给花婶。'],
      ['emote', 'me', '?'],
      ['emote', 'ahai', '!'],
      ['say', 'ahai', '别说是我送的！就说……就说是你抓的！'],
      ['say', 'ahai', '看什么看，快去！'],
    ],
    end: {
      give: { item: 'fish_snapper', n: 1 },
      quest: {
        id: 'story:ahai6', kind: 'story', title: '顺路送鱼', giver: 'ahai',
        desc: '阿海塞给你一条真鲷，让你「顺路」带给花婶，还叮嘱千万别说是他送的。',
        obj: { kind: 'deliver', item: 'fish_snapper', n: 1, to: 'huashen' }, reward: { coins: 0, friend: 100 },
        thanks: '^这真鲷……是那个倔老头让你送的吧？哼，我就知道。……替我谢谢他。',
      },
    },
  }),

  // ───────────── 花婶 ─────────────
  E({
    id: 'huashen_2', npc: 'huashen', hearts: 2, title: '认土', hours: [8, 12], noRain: true, area: { x: 37.7, y: 28.8, r: 4 },
    script: [
      ['place', 'huashen', 37.7, 27.8, 'down'], ['place', 'me', 37.7, 29.6, 'up'], ['cam', 37.7, 28.6],
      ['say', 'huashen', '^来来来，婶子教你个本事。'],
      ['say', 'huashen', '你抓一把土，攥紧了再松开——一松就散的，是沙土，存不住水，得天天浇。'],
      ['say', 'huashen', '攥成团、一碰就碎的，是好土，种啥都长。'],
      ['say', 'huashen', '要是黏成泥巴团、捏都捏不开，那就得先掺点沙子。'],
      ['ask', 'huashen', '记住了没？', [['记住了，谢谢花婶！', 'ok'], ['能再说一遍吗……', 'again']]],
    ],
    choices: {
      ok: { friend: 30, reply: [['huashen', '^好孩子，一点就通！']] },
      again: { friend: 20, reply: [['huashen', '^哈哈，不急不急，种着种着就会了。']] },
    },
  }),
  E({
    id: 'huashen_4', npc: 'huashen', hearts: 4, title: '豆豆闯祸', hours: [12, 16], area: { x: 37.7, y: 29, r: 4 },
    script: [
      ['place', 'huashen', 37.7, 27.8, 'down'], ['place', 'doudou', 40.2, 29.4, 'left'], ['place', 'me', 37.4, 30.2, 'up'], ['cam', 38.6, 28.8],
      ['sfx', 'hit'],
      ['emote', 'huashen', '!'],
      ['say', 'huashen', '豆豆！你又把我的花盆踢翻了！'],
      ['say', 'doudou', '……我是在练习踢球！爸爸说城里的小孩都踢球！'],
      ['say', 'huashen', '练、练、练！练到奶奶的花盆上来了！'],
      ['walk', 'doudou', 45, 30.6],
      ['say', 'huashen', '……唉。'],
      ['face', 'huashen', 'down'],
      ['say', 'huashen', '你别看我骂他，这孩子心里苦。'],
      ['say', 'huashen', '他爸爸在城里上班，一年回来一两趟。每回走的时候，豆豆都躲在被子里不出来。'],
      ['ask', 'huashen', '^好啦，婶子不跟你倒苦水了。', [['我帮您把土扫一扫。', 'help'], ['豆豆那边我去看看。', 'kid']]],
    ],
    choices: {
      help: { friend: 40, reply: [['huashen', '^哎，你这孩子，真贴心。']] },
      kid: { friend: 30, also: { npc: 'doudou', pts: 30 }, reply: [['huashen', '也好，他就听你的。']] },
    },
  }),
  E({
    id: 'huashen_6', npc: 'huashen', hearts: 6, title: '老照片', hours: [19, 23], area: { x: 37.7, y: 28.8, r: 4 },
    script: [
      ['place', 'huashen', 37.7, 27.8, 'down'], ['place', 'me', 37.7, 29.6, 'up'], ['cam', 37.7, 28.6],
      ['say', 'huashen', '你来啦。来，看看婶子翻出来的宝贝。'],
      ['emote', 'me', '?'],
      ['say', 'huashen', '这是十几年前的潮汐节。你看，码头上挤满了人，灯塔亮着呢。'],
      ['say', 'huashen', '^这个举着饭团的是我，这个抢我饭团的小胖子……是周叔！哈哈。'],
      ['say', 'huashen', '站在最边上、板着脸的那个，是阿海。'],
      ['say', 'huashen', '那时候啊，每到夏天，整座岛都是亮的。'],
      ['ask', 'huashen', '你说，还能有那样的一天吗？', [['一定会有的。', 'sure'], ['我们一起想办法。', 'together']]],
    ],
    choices: {
      sure: { friend: 40, reply: [['huashen', '^嗯！婶子信你。']] },
      together: { friend: 50, reply: [['huashen', '^好！婶子这把老骨头，也还能出把力！']] },
    },
  }),

  // ───────────── 老潘 ─────────────
  E({
    id: 'laopan_2', npc: 'laopan', hearts: 2, title: '回家的方向', hours: [9, 17], area: { x: 67.5, y: 25.2, r: 4 },
    script: [
      ['place', 'laopan', 68.4, 25.2, 'up'], ['place', 'me', 66.6, 25.2, 'right'], ['cam', 67.6, 24.6],
      ['say', 'laopan', '……看见东北角那座塔了吗？'],
      ['say', 'laopan', '那是潮汐港的灯塔。以前每晚都亮，光能照出去二十海里。'],
      ['say', 'laopan', '夜里跑船的人，看见那道光，心就定了——那是回家的方向。'],
      ['emote', 'laopan', '…'],
      ['say', 'laopan', '现在黑了五年了。'],
      ['ask', 'me', '……', [['为什么不修呢？', 'why'], ['（安静地陪他看一会儿）', 'quiet']]],
    ],
    choices: {
      why: { friend: 20, reply: [['laopan', '……修要钱，也要人。'], ['laopan', '走吧，要出海就说一声。']] },
      quiet: { friend: 40, reply: [['laopan', '……'], ['laopan', '谢谢。']] },
    },
  }),
  E({
    id: 'laopan_4', npc: 'laopan', hearts: 4, title: '夜里的栈桥', hours: [20, 23], area: { x: 62.5, y: 24.8, r: 4 },
    script: [
      ['place', 'laopan', 63.5, 24.7, 'right'], ['place', 'me', 61, 24.7, 'right'], ['cam', 62.6, 24.4],
      ['say', 'laopan', '这么晚还不睡？'],
      ['face', 'laopan', 'left'],
      ['say', 'laopan', '我？我每天晚上都在这儿坐一会儿。'],
      ['say', 'laopan', '以前这个点，灯塔刚好亮。秀兰——我老伴——七点准时点灯，一分钟都不差。'],
      ['say', 'laopan', '我在船上看见那道光，就知道她在塔上，知道该回家了。'],
      ['emote', 'laopan', '…'],
      ['say', 'laopan', '……说多了。'],
      ['ask', 'me', '……', [['老潘，晚安。', 'night'], ['我陪您再坐会儿。', 'stay']]],
    ],
    choices: {
      night: { friend: 30, reply: [['laopan', '嗯。晚安。']] },
      stay: { friend: 50, reply: [['laopan', '……'], ['laopan', '^好。']] },
    },
  }),
  E({
    id: 'laopan_6', npc: 'laopan', hearts: 6, title: '守塔日志', hours: [8, 18], area: { x: 67.5, y: 25.2, r: 4 }, after: ['laopan_4'],
    script: [
      ['place', 'laopan', 68.4, 25.2, 'left'], ['place', 'me', 66.6, 25.2, 'right'], ['cam', 67.6, 24.6],
      ['say', 'laopan', '给你看样东西。'],
      ['say', 'laopan', '这是秀兰的守塔日志。三十年，一天没落下。'],
      ['say', 'laopan', '「三月四日，雾大，灯油添了半桶。老潘出海未归，灯多点一个钟头。」'],
      ['say', 'laopan', '「六月九日，晴。潮汐节，豆豆他爸在码头摔了一跤，全村都笑了。」'],
      ['say', 'laopan', '最后一页……'],
      ['emote', 'laopan', '…'],
      ['say', 'laopan', '「明天记得给老潘带伞。」'],
      ['wait', 800],
      ['say', 'laopan', '第二天，她就病倒了。'],
      ['say', 'laopan', '……这本东西，我从没给别人看过。'],
      ['ask', 'me', '……', [['谢谢您愿意给我看。', 'thanks'], ['秀兰阿姨一定很爱您。', 'love']]],
    ],
    choices: {
      thanks: { friend: 40, reply: [['laopan', '嗯。']] },
      love: { friend: 60, reply: [['laopan', '……'], ['laopan', '^嗯。她是个爱操心的人。']] },
    },
  }),

  // ───────────── 小珊 ─────────────
  E({
    id: 'xiaoshan_2', npc: 'xiaoshan', hearts: 2, title: '憋气比赛', hours: [9, 16], noRain: true, area: { x: 53.4, y: 28.6, r: 4 },
    script: [
      ['place', 'xiaoshan', 53.4, 27.6, 'down'], ['place', 'me', 53.4, 29.4, 'up'], ['cam', 53.4, 28.4],
      ['say', 'xiaoshan', '^嘿！来得正好！比比谁憋气久？'],
      ['say', 'xiaoshan', '预备——开始！'],
      ['fade', 'out'], ['wait', 1500], ['fade', 'in'],
      ['emote', 'me', '…'],
      ['emote', 'xiaoshan', '!'],
      ['say', 'xiaoshan', '哇……你、你憋了多久？比我还久？！'],
      ['ask', 'xiaoshan', '不可能！再来一次！', [['好，再来！', 'again'], ['算你赢啦。', 'yield']]],
    ],
    choices: {
      again: { friend: 40, reply: [['xiaoshan', '^这才对嘛！……下次，下次我一定赢。']] },
      yield: { friend: 30, reply: [['xiaoshan', '不行！我不要你让着我！'], ['xiaoshan', '^……不过谢啦。']] },
    },
  }),
  E({
    id: 'xiaoshan_4', npc: 'xiaoshan', hearts: 4, title: '六十米', hours: [16, 19], noRain: true, area: { x: 56, y: 30.4, r: 4 },
    script: [
      ['place', 'xiaoshan', 56.5, 30.5, 'left'], ['place', 'me', 54.9, 30.6, 'right'], ['cam', 55.8, 30.2],
      ['say', 'xiaoshan', '……我跟你说件事，你别笑我。'],
      ['say', 'xiaoshan', '我回岛上之前，参加过全国自由潜水比赛。'],
      ['say', 'xiaoshan', '下到六十米的时候，我慌了。耳朵里全是自己的心跳声。'],
      ['say', 'xiaoshan', '我提前拉了绳。倒数第三。'],
      ['say', 'xiaoshan', '回来开潜水店，一开始只是想躲一躲。'],
      ['ask', 'me', '……', [['你已经很厉害了。', 'comfort'], ['那就再比一次！', 'again']]],
    ],
    choices: {
      comfort: { friend: 50, reply: [['xiaoshan', '……嗯。谢谢你。']] },
      again: { friend: 80, reply: [['xiaoshan', '再比一次……'], ['xiaoshan', '^对啊！为什么不呢！你等着，下次我拿个名次回来给你看！']] },
    },
  }),
  E({
    id: 'xiaoshan_6', npc: 'xiaoshan', hearts: 6, title: '秘密计划', hours: [9, 15], area: { x: 53.4, y: 28.6, r: 4 }, after: ['xiaoshan_4'],
    script: [
      ['place', 'xiaoshan', 53.4, 27.6, 'down'], ['place', 'me', 53.4, 29.4, 'up'], ['cam', 53.4, 28.4],
      ['say', 'xiaoshan', '^跟你说个秘密计划！'],
      ['say', 'xiaoshan', '蓝洞最深处，每年都有一群蓝鳍金枪鱼洄游经过。从来没人拍到过。'],
      ['say', 'xiaoshan', '我想拍到它们。不是为了比赛——就是想亲眼看一看。'],
      ['say', 'xiaoshan', '可是我一个人下去……还是有点怕。'],
      ['ask', 'xiaoshan', '等你装备升级了，陪我去好不好？', [['一言为定！', 'promise'], ['我先去探探路。', 'scout']]],
    ],
    choices: {
      promise: { friend: 50, reply: [['xiaoshan', '^一言为定！拉钩！']] },
      scout: { friend: 40, reply: [['xiaoshan', '^好！那你看到什么，一定先告诉我！']] },
    },
  }),

  // ───────────── 周叔 ─────────────
  E({
    id: 'zhoushu_2', npc: 'zhoushu', hearts: 2, title: '账本', hours: [8, 12], area: { x: 30.3, y: 50.8, r: 4 },
    script: [
      ['place', 'zhoushu', 30.3, 49.9, 'down'], ['place', 'me', 30.3, 51.6, 'up'], ['cam', 30.4, 50.6],
      ['say', 'zhoushu', '你来了。来，给你看看这个。'],
      ['say', 'zhoushu', '这是村里的账本。四十年了，一笔一笔，都在这儿。'],
      ['say', 'zhoushu', '你看这一页——五年前，台风那年。码头塌了，灯塔的灯室碎了。'],
      ['say', 'zhoushu', '后面这几年，出去的人越来越多，进来的一个都没有。'],
      ['say', 'zhoushu', '……直到你来。'],
      ['say', 'zhoushu', '^你来的那天，我在账本上记了一笔：「新邻居一人」。好久没写过这一栏了。'],
      ['ask', 'me', '……', [['以后这一栏会越来越长的。', 'longer'], ['我会好好干的！', 'work']]],
    ],
    choices: {
      longer: { friend: 40, reply: [['zhoushu', '^借你吉言！']] },
      work: { friend: 30, reply: [['zhoushu', '^好，好。']] },
    },
  }),
  E({
    id: 'zhoushu_4', npc: 'zhoushu', hearts: 4, title: '村会', hours: [17, 20], area: { x: 30.3, y: 51.5, r: 5 },
    script: [
      ['place', 'zhoushu', 30.3, 49.9, 'down'], ['place', 'ahai', 28.4, 51.2, 'right'], ['place', 'huashen', 32.3, 51.2, 'left'], ['place', 'me', 31.1, 53, 'up'], ['cam', 30.6, 51.2],
      ['say', 'ahai', '老周，我就直说了。修码头？拿什么修？岛上就这么几个人。'],
      ['say', 'huashen', '哎呀阿海，你少说两句……'],
      ['say', 'ahai', '我说的是实话！当年说不修灯塔的是谁？现在又要修码头？'],
      ['emote', 'zhoushu', '…'],
      ['say', 'zhoushu', '……是我。'],
      ['say', 'zhoushu', '当年是我说灯塔太贵，先不修。这个责任，我担着。'],
      ['say', 'zhoushu', '所以这一回，我想试试。哪怕只修好一块木板，也比看着它烂掉强。'],
      ['emote', 'ahai', '…'],
      ['say', 'ahai', '……哼。要人手的时候，吱一声。'],
      ['walk', 'ahai', 25.5, 51],
      ['say', 'huashen', '^这个倔老头，嘴上不饶人，心里比谁都急。'],
      ['ask', 'zhoushu', '让你看笑话了。', [['我也来帮忙。', 'help'], ['您做得对。', 'right']]],
    ],
    choices: {
      help: { friend: 50, also: { npc: 'ahai', pts: 20 }, reply: [['zhoushu', '^好！有你这句话，我心里就有底了。']] },
      right: { friend: 40, reply: [['zhoushu', '……谢谢。']] },
    },
  }),
  E({
    id: 'zhoushu_6', npc: 'zhoushu', hearts: 6, title: '当年的决定', hours: [19, 23], area: { x: 30.3, y: 50.8, r: 4 }, after: ['zhoushu_4'],
    script: [
      ['place', 'zhoushu', 30.3, 49.9, 'down'], ['place', 'me', 30.3, 51.6, 'up'], ['cam', 30.4, 50.6],
      ['say', 'zhoushu', '睡不着，出来走走。你也是？'],
      ['say', 'zhoushu', '那天村会上的事，你都听见了。'],
      ['say', 'zhoushu', '台风过后，修灯塔要一大笔钱。我算了三天三夜的账，最后说：先不修。'],
      ['say', 'zhoushu', '我以为只是晚几年。可灯一灭，船就不来了；船不来，人就走了。'],
      ['say', 'zhoushu', '老潘从来没怪过我。他越不说，我心里越难受。'],
      ['ask', 'zhoushu', '你说……现在修，还来得及吗？', [['现在修也不晚。', 'late'], ['大家会一起帮您的。', 'together']]],
    ],
    choices: {
      late: { friend: 60, reply: [['zhoushu', '……嗯。现在修，也不晚。'], ['zhoushu', '^谢谢你。我这心里，好像轻了点。']] },
      together: { friend: 50, reply: [['zhoushu', '^大家一起……对，大家一起。']] },
    },
  }),

  // ───────────── 阿澜 ─────────────
  E({
    id: 'alan_2', npc: 'alan', hearts: 2, title: '拉，不是压', hours: [11, 16.5], area: { x: 51.2, y: 25.4, r: 4 },
    script: [
      ['place', 'alan', 51.2, 24.5, 'down'], ['place', 'me', 51.2, 26.2, 'up'], ['cam', 51.2, 25.2],
      ['say', 'alan', '你上次在店里切鱼的样子，我看见了。'],
      ['emote', 'me', '!'],
      ['say', 'alan', '刀太用力，鱼肉都压扁了。'],
      ['say', 'alan', '切刺身要「拉」，不是「压」。刀从根部下去，一口气拉到刀尖，不要来回锯。'],
      ['say', 'alan', '手要凉。手热了，鱼油就化了，入口是腥的。'],
      ['ask', 'alan', '记住了吗？', [['记住了，师傅！', 'master'], ['你好严格啊……', 'strict']]],
    ],
    choices: {
      master: { friend: 40, reply: [['alan', '……谁是你师傅。'], ['alan', '^不过……叫得还挺顺耳的。']] },
      strict: { friend: 20, reply: [['alan', '做菜就得严格。客人吃进嘴里的东西，马虎不得。']] },
    },
  }),
  E({
    id: 'alan_4', npc: 'alan', hearts: 4, title: '奶奶的菜谱', hours: [11, 16.5], area: { x: 51.2, y: 25.4, r: 4 }, after: ['alan_2'],
    script: [
      ['place', 'alan', 51.2, 24.5, 'down'], ['place', 'me', 51.2, 26.2, 'up'], ['cam', 51.2, 25.2],
      ['say', 'alan', '……你有空吗？给你看样东西。'],
      ['say', 'alan', '这是我奶奶的手写菜谱。她是这座岛上出去的人。'],
      ['say', 'alan', '最后一页画了一栋房子。门口有棵歪脖子树，屋檐下挂着一串贝壳风铃。'],
      ['say', 'alan', '奶奶说，那是她长大的地方。我来岛上两年了，一直没找到。'],
      ['ask', 'alan', '你在岛上见过这样的房子吗？', [['我帮你一起找！', 'help'], ['好像有点眼熟……', 'familiar']]],
    ],
    choices: {
      help: { friend: 50, reply: [['alan', '^真的？……谢谢。']] },
      familiar: { friend: 40, reply: [['alan', '真的？！在哪儿？'], ['alan', '……想不起来了？没关系。想起来一定告诉我。']] },
    },
  }),
  E({
    id: 'alan_6', npc: 'alan', hearts: 6, title: '屋檐下的钉子', hours: [7, 9.5], area: { x: 46.8, y: 22.8, r: 4 }, after: ['alan_4'],
    script: [
      ['place', 'alan', 46.8, 21.9, 'down'], ['place', 'me', 46.8, 23.6, 'up'], ['cam', 46.8, 22.6],
      ['say', 'alan', '我把岛上的房子都看了一遍。'],
      ['say', 'alan', '没有歪脖子树。……也许早就被砍了。'],
      ['say', 'alan', '不过我发现，村子里有一间空房子，屋檐下的钉子排列的样子，跟奶奶画的风铃一模一样。'],
      ['emote', 'alan', '!'],
      ['say', 'alan', '^也许……就是那一间。等我确定了，第一个告诉你。'],
      ['ask', 'me', '……', [['我陪你去看看。', 'go'], ['一定会找到的。', 'sure']]],
    ],
    choices: {
      go: { friend: 50, reply: [['alan', '^好。等店里不忙的时候。']] },
      sure: { friend: 40, reply: [['alan', '^嗯。']] },
    },
  }),

  // ───────────── 豆豆 ─────────────
  E({
    id: 'doudou_2', npc: 'doudou', hearts: 2, title: '捉迷藏', hours: [8, 12], noRain: true, area: { x: 33.9, y: 57.8, r: 4 },
    script: [
      ['place', 'doudou', 33.9, 56.9, 'down'], ['place', 'me', 33.9, 58.6, 'up'], ['cam', 33.9, 57.6],
      ['say', 'doudou', '^来玩捉迷藏！你当鬼！数到一百！'],
      ['fade', 'out'], ['place', 'doudou', 30.0, 54.3, 'down'], ['place', 'me', 33.9, 58.6, 'up'], ['wait', 900], ['fade', 'in'],
      ['say', 'me', '九十八、九十九、一百！'],
      ['cam', 32, 56.4],
      ['emote', 'me', '?'],
      ['wait', 500],
      ['say', 'doudou', '嘿嘿嘿……你找不到我！'],
      ['walk', 'me', 30.6, 55.8],
      ['emote', 'doudou', '!'],
      ['say', 'doudou', '啊！被发现了！'],
      ['ask', 'doudou', '^再来一次！这次换你藏！', [['好！', 'again'], ['今天先玩到这儿吧。', 'stop']]],
    ],
    choices: {
      again: { friend: 40, reply: [['doudou', '^耶！']] },
      stop: { friend: 30, reply: [['doudou', '哼……那明天再玩！拉钩！']] },
    },
  }),
  E({
    id: 'doudou_4', npc: 'doudou', hearts: 4, title: '偷偷下海', hours: [12, 17], area: { x: 57.2, y: 25, r: 4 },
    script: [
      ['place', 'doudou', 60.5, 24.7, 'right'], ['place', 'xiaoshan', 56.2, 25.2, 'right'], ['place', 'me', 55.2, 24.9, 'right'], ['cam', 58.2, 24.6],
      ['say', 'doudou', '我就下去看一眼！就一眼！'],
      ['emote', 'xiaoshan', '!'],
      ['walk', 'xiaoshan', 59.3, 24.8],
      ['say', 'xiaoshan', '豆豆！说了多少次，没有大人陪着不准下水！'],
      ['face', 'doudou', 'left'],
      ['say', 'doudou', '……可是我已经会游泳了！'],
      ['say', 'xiaoshan', '会游泳和会潜水是两回事！'],
      ['emote', 'doudou', '…'],
      ['ask', 'me', '……', [['他只是太想学潜水了。', 'plead'], ['小珊说得对，太危险了。', 'agree']]],
    ],
    choices: {
      plead: { friend: 50, also: { npc: 'xiaoshan', pts: 20 }, reply: [['xiaoshan', '……'], ['xiaoshan', '好吧。豆豆，这周六上午，我教你浮潜。但是只能在浅水区！'], ['doudou', '^真的？！耶！！']] },
      agree: { friend: 20, also: { npc: 'xiaoshan', pts: 30 }, reply: [['doudou', '……哼。'], ['xiaoshan', '豆豆，等你再长大一点，我亲自教你。说话算话。']] },
    },
  }),
  E({
    id: 'doudou_6', npc: 'doudou', hearts: 6, title: '藏宝图', hours: [8, 12], area: { x: 33.9, y: 57.8, r: 4 }, after: ['doudou_2'],
    script: [
      ['place', 'doudou', 33.9, 56.9, 'down'], ['place', 'me', 33.9, 58.6, 'up'], ['cam', 33.9, 57.6],
      ['say', 'doudou', '^我给你画了一张地图！'],
      ['say', 'doudou', '这是潮汐港！这是奶奶的铺子，这是阿海爷爷的鱼摊，这个圈圈是灯塔！'],
      ['say', 'doudou', '这个叉叉……是我的秘密基地。只告诉你一个人。'],
      ['say', 'doudou', '岛上没有别的小孩……你来了以后，我就不无聊了。'],
      ['ask', 'doudou', '你会一直住在这儿吗？', [['会的。', 'stay'], ['我们拉钩。', 'pinky']]],
    ],
    choices: {
      stay: { friend: 50, reply: [['doudou', '^太好啦！']] },
      pinky: { friend: 60, reply: [['doudou', '^拉钩上吊，一百年不许变！']] },
    },
  }),
  // ───────────── 小镇事件：复兴工程每完工一期看一段（在工程告示板附近触发，镜头带你去现场） ─────────────
  E({
    id: 'town_1', npc: 'zhoushu', hearts: 0, town: true, stage: 1, title: '新栈桥', hours: [7, 19], area: { x: 57.6, y: 28.3, r: 9 },
    script: [
      ['fade', 'out'],
      ['place', 'zhoushu', 56.3, 10.95, 'right'], ['place', 'laopan', 57.3, 10.5, 'right'], ['place', 'me', 55.4, 10.6, 'right'], ['cam', 58.8, 10.4],
      ['fade', 'in'],
      ['note', '（新栈桥的木板还带着松脂味，一直铺到灯塔脚下。）'],
      ['say', 'zhoushu', '^修好了！真修好了！'],
      ['say', 'zhoushu', '钱是大家一点一点捐的，木料是从大陆运的。账我都记着——每一笔都记着。'],
      ['say', 'laopan', '……五年了。'],
      ['walk', 'laopan', 61.6, 10.5],
      ['face', 'laopan', 'right'],
      ['emote', 'laopan', '…'],
      ['wait', 600],
      ['say', 'zhoushu', '让他一个人待一会儿吧。'],
      ['say', 'zhoushu', '下一期，是灯塔。灯室的玻璃得从大陆订，灯芯嘛……阿海说，蓝洞里的发光水母能用。'],
      ['ask', 'zhoushu', '你还愿意帮忙吗？', [['当然！', 'sure'], ['灯塔一定要亮起来。', 'light']]],
    ],
    choices: {
      sure: { friend: 40, reply: [['zhoushu', '^好！新的清单我已经贴在告示板上了。']] },
      light: { friend: 40, also: { npc: 'laopan', pts: 40 }, reply: [['zhoushu', '……嗯。一定。']] },
    },
  }),
  E({
    id: 'town_2', npc: 'zhoushu', hearts: 0, town: true, stage: 2, title: '灯塔亮了', hours: [19, 26], area: { x: 57.6, y: 28.3, r: 9 },
    script: [
      ['fade', 'out'],
      ['fx', 'beamoff', 0, 0],
      ['place', 'laopan', 57.3, 10.5, 'right'], ['place', 'zhoushu', 56.4, 11.5, 'right'], ['place', 'ahai', 55.4, 11.5, 'right'], ['place', 'me', 55.4, 10.4, 'right'], ['cam', 61.5, 9.6],
      ['fade', 'in'],
      ['note', '（入夜。岛上的人都聚到了栈桥这头，望着黑了五年的灯塔。）'],
      ['say', 'zhoushu', '老潘，时间到了。'],
      ['say', 'laopan', '……嗯。七点整。'],
      ['say', 'laopan', '秀兰，我来点灯了。'],
      ['wait', 900],
      ['fx', 'beamon', 0, 0], ['sfx', 'whoosh'],
      ['wait', 1200],
      ['note', '（灯室里亮起一团暖黄的光。光束慢慢转起来，扫过海面，扫过码头，扫过每一户人家的屋顶。）'],
      ['say', 'ahai', '^……亮了。真亮了。'],
      ['say', 'zhoushu', '二十海里。夜里跑船的人，又能看见回家的方向了。'],
      ['emote', 'laopan', '…'],
      ['say', 'laopan', '^……谢谢你们。'],
      ['ask', 'me', '……', [['（静静地看着光）', 'quiet'], ['老潘，您上去看看吧。', 'go']]],
    ],
    choices: {
      quiet: { friend: 30, also: { npc: 'laopan', pts: 40 } },
      go: { friend: 30, also: { npc: 'laopan', pts: 60 }, reply: [['laopan', '……等哪天，我准备好了。']] },
    },
  }),
  E({
    id: 'town_3', npc: 'zhoushu', hearts: 0, town: true, stage: 3, title: '集市开张', hours: [8, 17], area: { x: 57.6, y: 28.3, r: 9 },
    script: [
      ['fade', 'out'],
      ['place', 'zhoushu', 29.5, 40.9, 'down'], ['place', 'huashen', 27.2, 41.1, 'right'], ['place', 'doudou', 26.0, 41.4, 'right'], ['place', 'alan', 32.8, 41.1, 'left'],
      ['place', 'me', 31.0, 41.9, 'up'], ['cam', 29.5, 38.4],
      ['fade', 'in'],
      ['note', '（广场北边的空地上，四个摊子摆开了，挂满了彩色的布篷。）'],
      ['say', 'huashen', '^哎哟，这阵仗，跟十几年前一模一样！'],
      ['say', 'zhoushu', '绿棚子、青棚子卖菜卖果子，蓝棚子卖贝壳和海边的小玩意儿，橙棚子卖布和篮子……'],
      ['say', 'zhoushu', '往后每个礼拜六就是集市日。那天在集市上卖东西，价钱比平时好。'],
      ['say', 'alan', '我也会来。……只卖饭团，别想让我在路边切刺身。'],
      ['say', 'doudou', '^奶奶！我要那个贝壳风铃！'],
      ['say', 'huashen', '你就知道要！……好好好，买。'],
      ['say', 'zhoushu', '灯塔亮了，集市开了。就差最后一步了——还差一艘船。'],
      ['ask', 'zhoushu', '最后一期，是把客船请回来。这回的清单可不短。', [['交给我吧！', 'sure'], ['大家一起，肯定行。', 'together']]],
    ],
    choices: {
      sure: { friend: 40, reply: [['zhoushu', '^好！']] },
      together: { friend: 40, also: { npc: 'huashen', pts: 30 }, reply: [['zhoushu', '^对，大家一起。']] },
    },
  }),
  E({
    id: 'town_4', npc: 'zhoushu', hearts: 0, town: true, stage: 4, title: '潮汐节', hours: [18.5, 26], area: { x: 57.6, y: 28.3, r: 9 },
    script: [
      ['fade', 'out'],
      ['place', 'zhoushu', 62.0, 24.5, 'down'], ['place', 'huashen', 60.6, 25.3, 'up'], ['place', 'doudou', 61.3, 25.7, 'up'], ['place', 'ahai', 63.4, 25.4, 'up'],
      ['place', 'laopan', 64.4, 24.9, 'left'], ['place', 'xiaoshan', 59.6, 25.0, 'right'], ['place', 'alan', 58.8, 25.5, 'right'], ['place', 'me', 62.4, 25.8, 'up'],
      ['cam', 63.5, 22.6],
      ['fade', 'in'],
      ['note', '（客船「潮汐号」静静地靠在栈桥边，彩旗在晚风里哗啦啦地响。全村的人都来了。）'],
      ['say', 'zhoushu', '咳，咳。大家……静一静。'],
      ['say', 'zhoushu', '五年前，我在村会上说：灯塔太贵，先不修。'],
      ['say', 'zhoushu', '后来灯灭了，船不来了，年轻人一个一个走了。我一直觉得，是我把潮汐港弄散的。'],
      ['say', 'zhoushu', '可是今年，栈桥修好了，灯塔亮了，集市开了……今天，客船也回来了。'],
      ['say', 'zhoushu', '^这些都不是我做的。是大家一条鱼、一粒米、一个铜板凑出来的。'],
      ['say', 'ahai', '啰嗦！快放烟花！'],
      ['say', 'huashen', '^就是！老周你再念下去，天都亮了！'],
      ['say', 'zhoushu', '^好，好——潮汐节，开幕！'],
      ['fx', 'fireworks', 60, 18.5], ['wait', 1600],
      ['emote', 'doudou', '!'],
      ['say', 'doudou', '^哇——！！'],
      ['fx', 'fireworks', 57.5, 19], ['wait', 900], ['fx', 'fireworks', 63, 18], ['wait', 1200],
      ['say', 'laopan', '……秀兰，你看见了吗。'],
      ['say', 'xiaoshan', '^明年的潮汐节，我要办潜水比赛！谁都不许跑！'],
      ['say', 'alan', '宴席的菜我包了。……当然，食材得你们出。'],
      ['fx', 'fireworks', 59.5, 17.5], ['wait', 700], ['fx', 'fireworks', 62, 19], ['wait', 1400],
      ['note', '（烟花一朵接一朵在灯塔上方炸开，把整片海都照亮了。）'],
      ['ask', 'zhoushu', '……谢谢你。', [['潮汐港，欢迎回来。', 'welcome'], ['明年还要一起过节！', 'next']]],
      ['fx', 'fireworks', 60.5, 18],
    ],
    choices: {
      welcome: { friend: 60, reply: [['zhoushu', '^……嗯。欢迎回来。']] },
      next: { friend: 50, reply: [['zhoushu', '^一言为定！']] },
    },
  }),

  // ───────────── 8 心、10 心 ─────────────
  E({
    id: 'ahai_8', npc: 'ahai', hearts: 8, title: '蓝洞里的刀', hours: [18, 22], area: { x: 58, y: 25, r: 4 }, after: ['ahai_6'],
    script: [
      ['place', 'ahai', 58.5, 25.0, 'right'], ['place', 'me', 56.6, 25.0, 'right'], ['cam', 58, 24.6],
      ['say', 'ahai', '又是你。坐吧。'],
      ['say', 'ahai', '上回跟你说我在蓝洞里迷了路。有件事，我没说。'],
      ['say', 'ahai', '那天我腰上别着一把潜水刀，是我爹留下的。刀柄上刻着一个「海」字。'],
      ['say', 'ahai', '我拼命往上游的时候，刀滑出去了。我连回头看一眼都不敢。'],
      ['emote', 'ahai', '…'],
      ['say', 'ahai', '三十年了。那把刀，应该还躺在蓝洞最底下。'],
      ['ask', 'ahai', '……算了，说这个干嘛。', [['我去帮您找回来。', 'find'], ['那一定是很重要的东西。', 'matter']]],
    ],
    choices: {
      find: { friend: 40, reply: [['ahai', '你？那可是蓝洞最深的地方！'], ['ahai', '……真要去，先找小珊换最好的气瓶。氧气剩三成就上来，听见没有！']] },
      matter: { friend: 30, reply: [['ahai', '……嗯。'], ['ahai', '要是哪天你下得去蓝洞最底下……帮我看一眼。就看一眼。']] },
    },
    end: {
      quest: {
        id: 'story:ahai8', kind: 'story', title: '蓝洞里的旧刀', giver: 'ahai',
        desc: '阿海年轻时在蓝洞迷路，丢了父亲留下的潜水刀，刀柄刻着「海」字。它应该还在蓝洞最深处的海床上（要高压气瓶才下得去）。',
        obj: { kind: 'deliver', item: 'q_knife', n: 1, to: 'ahai' }, reward: { coins: 0, friend: 150 },
        thanks: '^……三十年了。刀锈成这样，「海」字倒还在。谢了，真的谢了。',
      },
    },
  }),
  E({
    id: 'ahai_10', npc: 'ahai', hearts: 10, title: '三十年的信', hours: [9, 16], area: { x: 48.5, y: 21.4, r: 4 }, after: ['ahai_8'], quest: 'story:ahai8',
    script: [
      ['place', 'ahai', 48.5, 20.4, 'down'], ['place', 'me', 48.5, 22.2, 'up'], ['cam', 48.5, 21.2],
      ['say', 'ahai', '你来了。……我、我有样东西。'],
      ['say', 'ahai', '这是一封信。写了三十年，一直没寄出去。'],
      ['say', 'ahai', '年轻那会儿，我跟阿花——就是花婶——说好了，等我跑完那趟船就回来。'],
      ['say', 'ahai', '结果那趟船一跑就是八年。等我回来，她已经嫁人了。'],
      ['emote', 'ahai', '…'],
      ['ask', 'ahai', '你说，一把年纪了，还有这个必要吗？', [['现在给也不晚。', 'now'], ['我陪您一起去。', 'together']]],
      ['fade', 'out'],
      ['place', 'huashen', 37.7, 27.8, 'down'], ['place', 'ahai', 37.2, 29.5, 'up'], ['place', 'me', 38.6, 29.7, 'up'], ['cam', 37.7, 28.6],
      ['fade', 'in'],
      ['say', 'huashen', '哟，稀客啊。阿海，你来买种子？'],
      ['say', 'ahai', '我……这个，给你。'],
      ['emote', 'huashen', '?'],
      ['note', '（花婶拆开信，看了很久很久。）'],
      ['say', 'huashen', '……你这个死老头子。'],
      ['say', 'huashen', '三十年了，字还是写得这么丑。'],
      ['emote', 'huashen', '♥'],
      ['say', 'huashen', '^……今晚来家里吃饭。豆豆念叨你好久了。'],
      ['emote', 'ahai', '♥'],
      ['say', 'ahai', '^好、好！'],
    ],
    choices: {
      now: { friend: 50, reply: [['ahai', '……也是。再拖下去，我就真成老糊涂了。']] },
      together: { friend: 60, reply: [['ahai', '^……你小子。好，走！']] },
    },
    end: { also: { npc: 'huashen', pts: 60 } },
  }),
  E({
    id: 'huashen_8', npc: 'huashen', hearts: 8, title: '跑船的', hours: [19, 23], area: { x: 37.7, y: 28.8, r: 4 }, after: ['huashen_6'],
    script: [
      ['place', 'huashen', 37.7, 27.8, 'down'], ['place', 'me', 37.7, 29.6, 'up'], ['cam', 37.7, 28.6],
      ['say', 'huashen', '睡不着，出来吹吹风。你也还没睡？'],
      ['say', 'huashen', '婶子跟你说个事，你可别笑。'],
      ['say', 'huashen', '我年轻的时候啊，差点嫁给一个跑船的。'],
      ['emote', 'me', '!'],
      ['say', 'huashen', '那人嗓门大，脾气倔，出海前拍着胸脯说，跑完这趟就回来娶我。'],
      ['say', 'huashen', '结果一走好几年，一封信都没有。我等不下去，就嫁了豆豆他爷爷。'],
      ['say', 'huashen', '老头子待我很好，我不后悔。……就是有时候会想，那个人后来怎么样了。'],
      ['ask', 'huashen', '哎呀，说这些干嘛。', [['那个人……是阿海吧？', 'ahai'], ['他一定也常想起您。', 'miss']]],
    ],
    choices: {
      ahai: { friend: 50, reply: [['huashen', '你、你怎么知道的！'], ['huashen', '……不许告诉别人！尤其是那个死老头子！']] },
      miss: { friend: 40, reply: [['huashen', '^……谁知道呢。']] },
    },
  }),
  E({
    id: 'huashen_10', npc: 'huashen', hearts: 10, stage: 4, title: '团圆', hours: [9, 17], area: { x: 37.7, y: 28.8, r: 4 }, after: ['huashen_8'],
    script: [
      ['place', 'huashen', 37.7, 27.8, 'down'], ['place', 'doudou', 36.7, 28.5, 'down'], ['place', 'me', 37.7, 29.7, 'up'], ['cam', 37.7, 28.6],
      ['say', 'doudou', '^爸爸回来啦！爸爸坐客船回来啦！'],
      ['say', 'huashen', '^你看这孩子，从早上蹦到现在。'],
      ['note', '（一个背着大包、晒得黝黑的年轻人从路那头跑过来，一把抱起了豆豆。）'],
      ['say', 'huashen', '……阿斌说，大陆那边的活儿辞了。'],
      ['say', 'huashen', '他说港口活过来了，想回岛上开一间修船铺。'],
      ['emote', 'huashen', '♥'],
      ['say', 'huashen', '^婶子最怕的，就是这个岛散了。现在……散不了了。'],
      ['ask', 'huashen', '这些，都是托了你的福。', [['是大家一起做到的。', 'all'], ['恭喜您，一家团圆。', 'congrats']]],
    ],
    choices: {
      all: { friend: 60, reply: [['huashen', '^对，大家一起。今晚都来家里吃饭，婶子做一桌！']] },
      congrats: { friend: 60, reply: [['huashen', '^哎！团圆了，团圆了！']] },
    },
    end: { also: { npc: 'doudou', pts: 60 }, give: { item: 'strawberry', n: 5 } },
  }),
  E({
    id: 'laopan_8', npc: 'laopan', hearts: 8, title: '铜怀表', hours: [8, 18], area: { x: 67.5, y: 25.2, r: 4 }, after: ['laopan_6'],
    script: [
      ['place', 'laopan', 68.4, 25.2, 'left'], ['place', 'me', 66.6, 25.2, 'right'], ['cam', 67.6, 24.6],
      ['say', 'laopan', '有件事，想请你帮忙。'],
      ['say', 'laopan', '秀兰有一块铜怀表，是我们结婚那年，我在大陆给她买的。'],
      ['say', 'laopan', '台风前一年的冬天，她在礁石边给我送饭，表链断了，掉进了海里。'],
      ['say', 'laopan', '她心疼了好几天，说等开春水暖了，自己潜下去找。'],
      ['emote', 'laopan', '…'],
      ['say', 'laopan', '后来她就病了。'],
      ['say', 'laopan', '表应该还在珊瑚浅滩西边的礁石台子上。我这把老骨头，下不去了。'],
      ['ask', 'laopan', '……能帮我找找吗？', [['我这就去。', 'go'], ['一定帮您找回来。', 'promise']]],
    ],
    choices: {
      go: { friend: 30, reply: [['laopan', '嗯。浅滩西边，礁石台子上。别逞强。']] },
      promise: { friend: 40, reply: [['laopan', '……嗯。']] },
    },
    end: {
      quest: {
        id: 'story:laopan8', kind: 'story', title: '秀兰的怀表', giver: 'laopan',
        desc: '老潘的妻子秀兰生前把一块铜怀表掉进了海里。它应该在珊瑚浅滩西边的礁石台子上——下潜时留意水底一闪一闪的东西。',
        obj: { kind: 'deliver', item: 'q_watch', n: 1, to: 'laopan' }, reward: { coins: 0, friend: 150 },
        thanks: '^……是它。表盖里还夹着我们俩的照片。谢谢你，孩子。',
      },
    },
  }),
  E({
    id: 'laopan_10', npc: 'laopan', hearts: 10, stage: 2, title: '上塔', hours: [19, 24], area: { x: 62.5, y: 24.8, r: 4 }, after: ['laopan_8'], quest: 'story:laopan8',
    script: [
      ['place', 'laopan', 63.5, 24.7, 'right'], ['place', 'me', 61.8, 24.7, 'right'], ['cam', 62.6, 24.4],
      ['say', 'laopan', '来了。……陪我去个地方。'],
      ['fade', 'out'],
      ['place', 'laopan', 63.4, 12.6, 'up'], ['place', 'me', 62.3, 12.7, 'right'], ['cam', 63.6, 10.6],
      ['fade', 'in'],
      ['say', 'laopan', '灯塔重新亮起来以后，我每天晚上都在下面看。一直没敢上去。'],
      ['say', 'laopan', '今天，我想上去看看。'],
      ['fade', 'out'],
      ['note', '（螺旋楼梯一百二十八级。老潘走得很慢，每一级都要停一下。）'],
      ['fade', 'in'],
      ['note', '（灯室里，巨大的透镜缓缓转动。窗台上放着一只落了灰的搪瓷杯。）'],
      ['say', 'laopan', '这是她的杯子。'],
      ['say', 'laopan', '秀兰，表找回来了。'],
      ['note', '（老潘把铜怀表轻轻放在杯子旁边，上好了发条。滴答，滴答。）'],
      ['say', 'laopan', '以后，就让它替我陪着你。'],
      ['emote', 'laopan', '♥'],
      ['ask', 'laopan', '……走吧，下去。', [['老潘……', 'soft'], ['秀兰阿姨会很高兴的。', 'glad']]],
      ['fade', 'out'],
      ['place', 'laopan', 63.5, 24.7, 'right'], ['place', 'me', 61.8, 24.7, 'right'], ['cam', 62.6, 24.4],
      ['fade', 'in'],
      ['say', 'laopan', '^谢谢你，孩子。'],
    ],
    choices: {
      soft: { friend: 50, reply: [['laopan', '……我没事。心里敞亮了。']] },
      glad: { friend: 60, reply: [['laopan', '^……嗯。她一定在笑我，磨蹭了这么多年。']] },
    },
  }),
  E({
    id: 'xiaoshan_8', npc: 'xiaoshan', hearts: 8, title: '会发光的海', hours: [20, 24], noRain: true, area: { x: 56, y: 30.4, r: 4 }, after: ['xiaoshan_6'],
    script: [
      ['place', 'xiaoshan', 57.4, 30.2, 'right'], ['place', 'me', 56.2, 30.2, 'right'], ['cam', 58.6, 30.8],
      ['say', 'xiaoshan', '嘘——别说话，看海里。'],
      ['fx', 'glow', 60, 31.5],
      ['wait', 1500],
      ['note', '（黑漆漆的海面下，一点、两点……成千上万点蓝光亮了起来，随着浪一明一暗。）'],
      ['emote', 'me', '!'],
      ['say', 'xiaoshan', '^是发光水母！还有夜光藻！一年就这几天能看到。'],
      ['say', 'xiaoshan', '我小时候以为，这是天上的星星掉进海里了。'],
      ['say', 'xiaoshan', '比赛失误以后，我差点再也不下水了。是回到岛上，看见这片光，才又想潜下去。'],
      ['say', 'xiaoshan', '这件事我跟谁都没说过……你是第一个。'],
      ['ask', 'xiaoshan', '好看吗？', [['比星星还好看。', 'stars'], ['和你一起看，更好看。', 'you']]],
    ],
    choices: {
      stars: { friend: 40, reply: [['xiaoshan', '^对吧！']] },
      you: { friend: 60, reply: [['xiaoshan', '……！'], ['xiaoshan', '^笨、笨蛋，说什么呢！……不过，谢谢。']] },
    },
  }),
  E({
    id: 'xiaoshan_10', npc: 'xiaoshan', hearts: 10, title: '金枪鱼群', hours: [9, 16], area: { x: 53.4, y: 28.6, r: 4 }, after: ['xiaoshan_8'],
    script: [
      ['place', 'xiaoshan', 53.4, 27.6, 'down'], ['place', 'me', 53.4, 29.4, 'up'], ['cam', 53.4, 28.4],
      ['say', 'xiaoshan', '^你来得正好！快看快看！'],
      ['say', 'xiaoshan', '我拍到了！蓝洞深处的金枪鱼群！几百条，银光闪闪的，像一场暴风雪！'],
      ['say', 'xiaoshan', '我在水下等了四十分钟，氧气差点见底……不过值了！'],
      ['say', 'xiaoshan', '照片我洗了两张。一张挂在店里。'],
      ['say', 'xiaoshan', '另一张给你。要不是你一直陪我练，我没胆子下到那么深。'],
      ['say', 'xiaoshan', '对了，店里那张旁边，我还挂了一张你的照片。不许有意见！'],
      ['ask', 'xiaoshan', '怎么样，我厉害吧？', [['你是岛上最厉害的潜水员。', 'best'], ['下次带我一起去。', 'together']]],
    ],
    choices: {
      best: { friend: 50, reply: [['xiaoshan', '^哼哼，那当然！']] },
      together: { friend: 60, reply: [['xiaoshan', '^一言为定！下次我们一起去拍更大的！']] },
    },
    end: { give: { item: 'q_photo', n: 1 } },
  }),
  E({
    id: 'zhoushu_8', npc: 'zhoushu', hearts: 8, title: '村志', hours: [8, 12], area: { x: 30.3, y: 50.8, r: 4 }, after: ['zhoushu_6'],
    script: [
      ['place', 'zhoushu', 30.3, 49.9, 'down'], ['place', 'me', 30.3, 51.6, 'up'], ['cam', 30.4, 50.6],
      ['say', 'zhoushu', '早啊。给你看样东西。'],
      ['say', 'zhoushu', '这是潮汐港的村志。从我爷爷那辈开始记：谁家添了孩子，哪年来了台风，哪天灯塔换了灯芯，都在里面。'],
      ['say', 'zhoushu', '最后几页是我记的。台风以后，就只剩「某某家搬去了大陆」。'],
      ['say', 'zhoushu', '我想请你替我保管它。'],
      ['emote', 'me', '?'],
      ['say', 'zhoushu', '我这人，一拿起它就忍不住往回看。你不一样，你是往前走的人。'],
      ['say', 'zhoushu', '等复兴计划做完了，新的一页，你来写。'],
      ['ask', 'zhoushu', '……可以吗？', [['我会好好保管的。', 'keep'], ['我们一起写。', 'together']]],
    ],
    choices: {
      keep: { friend: 40, reply: [['zhoushu', '^谢谢。']] },
      together: { friend: 60, reply: [['zhoushu', '^一起写……好，一起写。']] },
    },
    end: { give: { item: 'q_chronicle', n: 1 } },
  }),
  E({
    id: 'zhoushu_10', npc: 'zhoushu', hearts: 10, stage: 4, title: '结清', hours: [8, 12], area: { x: 30.3, y: 50.8, r: 4 }, after: ['zhoushu_8', 'town_4'],
    script: [
      ['place', 'zhoushu', 30.3, 49.9, 'down'], ['place', 'me', 30.3, 51.6, 'up'], ['cam', 30.4, 50.6],
      ['say', 'zhoushu', '你来了。复兴计划的账，我昨晚算完了。'],
      ['say', 'zhoushu', '栈桥、灯塔、集市、客船。一共收了……算了，数字不重要。'],
      ['say', 'zhoushu', '最后一行，我写的是「结清」。'],
      ['say', 'zhoushu', '五年了，我头一回觉得，心里不欠谁的了。'],
      ['emote', 'zhoushu', '♥'],
      ['say', 'zhoushu', '^哈哈……哈哈哈！你看我，笑得像个孩子。'],
      ['say', 'zhoushu', '那本村志，新的一页你写了吗？'],
      ['ask', 'zhoushu', '写的什么？', [['「潮汐港，灯又亮了。」', 'light'], ['「这里是我的家。」', 'home']]],
    ],
    choices: {
      light: { friend: 60, reply: [['zhoushu', '^好！写得好！']] },
      home: { friend: 80, reply: [['zhoushu', '……'], ['zhoushu', '^嗯。欢迎回家。']] },
    },
  }),
  E({
    id: 'alan_8', npc: 'alan', hearts: 8, stage: 1, title: '门框上的钉子', hours: [7, 9.5], area: { x: 46.8, y: 22.8, r: 4 }, after: ['alan_6'],
    script: [
      ['place', 'alan', 46.8, 21.9, 'down'], ['place', 'me', 46.8, 23.6, 'up'], ['cam', 46.8, 22.6],
      ['say', 'alan', '你来得正好。那间空房子，不是奶奶家。'],
      ['say', 'alan', '可我想起来，菜谱里还有一句：「推开窗，就是灯。」'],
      ['say', 'alan', '栈桥修好了。……陪我去一趟灯塔。'],
      ['fade', 'out'],
      ['place', 'alan', 63.3, 12.6, 'up'], ['place', 'me', 62.4, 12.6, 'right'], ['cam', 63.4, 10.8],
      ['fade', 'in'],
      ['note', '（灯塔的门框上，钉着一排生了锈的小钉子。）'],
      ['say', 'alan', '……就是这个排法。一模一样。'],
      ['say', 'alan', '奶奶画的不是房子，是灯塔。她是守塔人家的女儿。'],
      ['say', 'alan', '那秀兰奶奶……是她的妹妹？'],
      ['emote', 'alan', '!'],
      ['say', 'alan', '那老潘，就是我的……姨爷爷？'],
      ['emote', 'me', '!'],
      ['say', 'alan', '我在岛上找了两年的「家」，原来一直在这里亮着。'],
      ['ask', 'alan', '……我该怎么跟老潘说？', [['就直接告诉他吧。', 'tell'], ['我陪你一起去说。', 'together']]],
    ],
    choices: {
      tell: { friend: 40, reply: [['alan', '^嗯。……今晚请他来店里吃饭。']] },
      together: { friend: 60, also: { npc: 'laopan', pts: 40 }, reply: [['alan', '^……谢谢你。有你在，我就没那么紧张了。']] },
    },
  }),
  E({
    id: 'alan_10', npc: 'alan', hearts: 10, title: '灯塔茶泡饭', hours: [11, 16.5], area: { x: 51.2, y: 25.4, r: 4 }, after: ['alan_8'],
    script: [
      ['place', 'alan', 51.2, 24.5, 'down'], ['place', 'laopan', 50.0, 25.3, 'right'], ['place', 'me', 51.2, 26.2, 'up'], ['cam', 51.0, 25.2],
      ['say', 'alan', '来得正好。尝尝这个。'],
      ['note', '（一碗鲷鱼茶泡饭。汤是清的，上面撒着烤过的海苔和芝麻。）'],
      ['say', 'alan', '奶奶菜谱的最后一道菜。我试了两年，一直不对味。'],
      ['say', 'alan', '昨天老潘……姨爷爷尝了一口，说「差不多了」。'],
      ['say', 'laopan', '^……咸了一点。秀兰做的，咸得刚刚好。'],
      ['say', 'alan', '^你看，他就是嘴硬。'],
      ['say', 'alan', '我打算把它放进菜单，叫「灯塔茶泡饭」。'],
      ['ask', 'alan', '第一碗，给你。', [['好吃！', 'yum'], ['这是家的味道。', 'home']]],
    ],
    choices: {
      yum: { friend: 50, reply: [['alan', '^……那就好。']] },
      home: { friend: 70, reply: [['alan', '……嗯。'], ['alan', '^家的味道。']] },
    },
    end: { also: { npc: 'laopan', pts: 30 } },
  }),
  E({
    id: 'doudou_8', npc: 'doudou', hearts: 8, title: '想爸爸', hours: [17, 20], area: { x: 33.9, y: 57.8, r: 4 }, after: ['doudou_6'],
    script: [
      ['place', 'doudou', 33.9, 56.9, 'down'], ['place', 'me', 33.9, 58.6, 'up'], ['cam', 33.9, 57.6],
      ['emote', 'doudou', '…'],
      ['say', 'doudou', '……我没哭。是沙子进眼睛了。'],
      ['say', 'doudou', '今天是爸爸的生日。我给他打电话，他说在加班，说了两句就挂了。'],
      ['say', 'doudou', '奶奶说大陆的活儿忙。可是……别人的爸爸都在家。'],
      ['say', 'doudou', '要是客船回来了，爸爸是不是就能常常回家了？'],
      ['ask', 'doudou', '……', [['会的。我们一起把船请回来。', 'ship'], ['（摸摸他的头）', 'pat']]],
    ],
    choices: {
      ship: { friend: 50, reply: [['doudou', '^真的？！那我也要帮忙！我去捡最好看的贝壳捐给工程！']] },
      pat: { friend: 60, reply: [['doudou', '……'], ['doudou', '^嘿嘿。你的手好暖和。']] },
    },
  }),
  E({
    id: 'doudou_10', npc: 'doudou', hearts: 10, stage: 4, title: '第一个看见', hours: [6.5, 11], area: { x: 66, y: 25, r: 4 }, after: ['doudou_8'],
    script: [
      ['place', 'doudou', 64.6, 24.6, 'right'], ['place', 'me', 63.4, 24.8, 'right'], ['cam', 65.5, 23.2],
      ['say', 'doudou', '^来了来了！你看！海上那个白点！'],
      ['say', 'doudou', '是客船！我第一个看见的！'],
      ['say', 'doudou', '爸爸说，以后每个月都坐船回来。他还说，等我长大了，教我开船。'],
      ['say', 'doudou', '不过我还是想当潜水员。像小珊姐姐那样的！'],
      ['say', 'doudou', '我把第一个看见客船的事写进日记了。日记里还写了你。'],
      ['say', 'doudou', '写的是：「我最好的朋友，帮潮汐港把船请回来了。」'],
      ['ask', 'doudou', '你会一直在这里吧？', [['一直都在。', 'always'], ['拉钩。', 'pinky']]],
    ],
    choices: {
      always: { friend: 60, reply: [['doudou', '^嗯！']] },
      pinky: { friend: 70, reply: [['doudou', '^拉钩上吊，一百年……不，一万年不许变！']] },
    },
  }),
]
export const EVENT_BY_ID: Record<string, HeartEvent> = Object.fromEntries(EVENTS.map(e => [e.id, e]))

// 钟点是否在范围内（范围可以跨午夜：[22, 26] 表示 22 点到次日 2 点）
export function inHours(hour: number, [a, b]: [number, number]) {
  const h = hour < 6 ? hour + 24 : hour
  return h >= a && h < b
}
