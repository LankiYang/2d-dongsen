// 测试用：在一个跑着的服务端上新建玩家、自动走完第 0 天，打印存档 token（浏览器里填进 localStorage 就能直接从第 1 天玩起）。
// 用法：node --disable-warning=ExperimentalWarning tools/seed-day1.mjs [端口=8796] [岛种子=4242]
import { connect, playDay0, wait } from './test-lib.mjs'
const port = Number(process.argv[2] ?? 8796), seed = Number(process.argv[3] ?? 4242)
const c = await connect(port)
await playDay0(c, seed)
c.send({ t: 'scene', to: `isle:${c.isle.id}` }); await wait(300)
console.log(JSON.stringify({ stage: c.isle.stage, token: c.welcome.token, name: c.welcome.name, hue: c.welcome.hue }))
c.ws.close()
process.exit(0)
