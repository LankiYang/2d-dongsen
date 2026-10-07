// 联机冒烟测试机器人：连上服务端，在自家门口附近绕圈走、偶尔说话，验证多人同步。
// 用法：node tools/bot.mjs [数量=1] [秒数=60]
import WebSocket from 'ws'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'

// 机器人的身份存档：复用同一批 token，免得每次测试都在村里多占一块宅基地
const TOKENS = new URL('./.bot-tokens.json', import.meta.url)
const tokens = existsSync(TOKENS) ? JSON.parse(readFileSync(TOKENS, 'utf8')) : {}

const N = Number(process.argv[2] ?? 1)
const SECONDS = Number(process.argv[3] ?? 60)
const WS_URL = process.env.TIDE_WS ?? 'ws://localhost:8799/ws'
const NAMES = ['渔夫小林', '阿珊', '老船长', '海藻', '椰子', '潜水员K']
const HUES = [0, 35, 95, 140, 215, 265, 315]

for (let b = 0; b < N; b++) {
  const ws = new WebSocket(WS_URL)
  const name = NAMES[b % NAMES.length]
  let me = null, t = Math.random() * 6, welcomed = false
  const stats = { players: 0, plots: 0 }
  ws.on('open', () => ws.send(JSON.stringify({ t: 'hello', token: tokens[name] ?? '', name, hue: HUES[b % HUES.length] })))
  ws.on('message', raw => {
    const m = JSON.parse(String(raw))
    if (m.t === 'welcome') { me = m; welcomed = true; tokens[name] = m.token; writeFileSync(TOKENS, JSON.stringify(tokens, null, 2)); stats.plots = Object.keys(m.plots).length; console.log(`[${name}] 进入世界 id=${m.you} 第${m.day}天 金币${m.coins} 在线${m.players.length}人`) }
    if (m.t === 'players') stats.players = m.list.length
    if (m.t === 'chat' && !m.sys && m.from !== name) console.log(`[${name}] 收到聊天 ${m.from}: ${m.text}`)
  })
  const loop = setInterval(() => {
    if (!welcomed) return
    t += 0.1
    const cx = me.x, cy = me.y + 30
    const x = cx + Math.cos(t * 0.8 + b) * 60, y = cy + Math.sin(t * 0.8 + b) * 30
    const dir = Math.abs(Math.cos(t * 0.8 + b)) > 0.7 ? (Math.sin(t * 0.8 + b) > 0 ? 'down' : 'up') : (Math.cos(t * 0.8 + b) < 0 ? 'right' : 'left')
    ws.send(JSON.stringify({ t: 'move', x, y, dir, moving: true }))
    if (Math.random() < 0.004) ws.send(JSON.stringify({ t: 'chat', text: ['今天鱼真多', '谁去蓝洞？', '番茄快熟了', '晚上一起烤鱼'][Math.floor(Math.random() * 4)] }))
  }, 100)
  setTimeout(() => {
    clearInterval(loop)
    console.log(`[${name}] 结束：能看到其他玩家 ${stats.players} 人，农田 ${stats.plots} 块`)
    ws.close()
  }, SECONDS * 1000)
}
