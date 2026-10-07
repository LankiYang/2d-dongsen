// 测试用：在测试存档 server/data/test.db 里建好（或更新）指定 token 的玩家，塞满做菜食材、放到寿司店门口。
// 用法：node --disable-warning=ExperimentalWarning tools/seed-test.cjs [--at dock] [--hearts N] <token> [token2 …]（先断开这些玩家的连接）
//   --at dock   放到栈桥上（出航测试用），默认放在寿司店门口
//   --hearts N  和所有村民的好感设成 N 心（测心事件用；已看过的事件保留）
//   --stage N   复兴工程设成已完工 N 期（全服；要重启测试服务端才生效）
//   --rich      背包换成捐工程用的一堆鱼和作物，金币 20 万
//   --seen a,b  把这些事件记成看过（跳过前置）；--done story:x 把这些剧情任务记成完成
const { DatabaseSync } = require('node:sqlite')
const db = new DatabaseSync('server/data/test.db')
const inv = [['hoe', 1], ['can', 1], ['harpoon', 1], ['fish_clownfish', 9], ['fish_tang', 6], ['fish_tuna', 3], ['rice', 20], ['cucumber', 6], ['pumpkin', 5], ['strawberry', 5], ['tomato', 8]]
  .map(([id, n]) => ({ id, n }))
while (inv.length < 24) inv.push(null)
const NPCS = ['ahai', 'huashen', 'laopan', 'xiaoshan', 'zhoushu', 'alan', 'doudou']
const args = process.argv.slice(2)
let atDock = false, hearts = -1, stage = -1, rich = false, seen = [], done = []
for (let i = 0; i < args.length;) {
  if (args[i] === '--at') { atDock = args[i + 1] === 'dock'; args.splice(i, 2) }
  else if (args[i] === '--hearts') { hearts = Number(args[i + 1]); args.splice(i, 2) }
  else if (args[i] === '--stage') { stage = Number(args[i + 1]); args.splice(i, 2) }
  else if (args[i] === '--rich') { rich = true; args.splice(i, 1) }
  else if (args[i] === '--seen') { seen = args[i + 1].split(','); args.splice(i, 2) }
  else if (args[i] === '--done') { done = args[i + 1].split(','); args.splice(i, 2) }
  else i++
}
if (stage >= 0) {
  db.prepare('INSERT INTO meta(k,v) VALUES(?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v').run('restore', JSON.stringify({ done: stage, progress: {}, funded: null, top: [], credits: {} }))
  console.log('复兴工程：已完工', stage, '期')
}
if (rich) {
  inv.length = 0
  for (const [id, n] of [['hoe', 1], ['can', 1], ['harpoon', 1], ['fish_clownfish', 12], ['fish_tang', 10], ['fish_horse_mackerel', 14], ['fish_mackerel', 10], ['rice', 40], ['tomato', 20], ['pumpkin', 12], ['strawberry', 12]]) inv.push({ id, n })
  while (inv.length < 24) inv.push(null)
}
const x = (atDock ? 58 : 53.4) * 24, y = (atDock ? 24.6 : 23.5) * 24
for (const [k, token] of args.entries()) {
  const had = db.prepare('SELECT id, story FROM players WHERE token=?').get(token)
  if (had) db.prepare('UPDATE players SET inv=?, x=?, y=?, scene=? WHERE token=?').run(JSON.stringify(inv), x + k * 20, y, 'island', token)
  else db.prepare('INSERT INTO players(token,name,hue,coins,inv,scene,x,y) VALUES(?,?,?,?,?,?,?,?)').run(token, k ? '二号厨师' : '测试员', k ? 0 : 180, 150, JSON.stringify(inv), 'island', x + k * 20, y)
  if (hearts >= 0 || seen.length || done.length) {
    const st = had?.story ? JSON.parse(had.story) : null
    if (st) {
      for (const id of seen) if (!st.seen.includes(id)) st.seen.push(id)
      for (const id of done) if (!st.done.includes(id)) st.done.push(id)
    }
    if (st && hearts >= 0) {
      for (const n of NPCS) {
        st.rel[n] ??= { pts: 0, talk: 0, gift: 0, week: -1, gw: 0 }
        st.rel[n].pts = hearts * 250
        st.heartMail ??= {}
        st.heartMail[n] = Math.max(st.heartMail[n] ?? 0, hearts)   // 不补寄这些心数的感谢信
      }
    }
    if (st) db.prepare('UPDATE players SET story=? WHERE token=?').run(JSON.stringify(st), token)
    else console.log('  （这个玩家还没有关系存档，先登录一次再设好感）')
  }
  if (rich) db.prepare('UPDATE players SET coins=? WHERE token=?').run(200000, token)
  console.log(had ? 'updated' : 'inserted', token, hearts >= 0 ? `好感 ${hearts} 心` : '')
}
