// 第 0 天（开局）服务端流程回归测试：独立存档、独立端口，按原作开局走一遍。用法：node --disable-warning=ExperimentalWarning tools/test-day0.mjs
import { startServer, stopServer, connect, playDay0, cleanDb, failed } from './test-lib.mjs'

const DB = 'server/data/_d0.db', PORT = 8793
cleanDb(DB)
const srv = await startServer(DB, PORT)
const c = await connect(PORT)
await playDay0(c, 4242, { verbose: true })
c.ws.close(); await stopServer(srv)
cleanDb(DB)
if (/Error|错误/.test(srv.log)) console.log(srv.log.slice(-800))
console.log(failed() ? `\n${failed()} 项没过` : '\n全部通过')
process.exit(failed() ? 1 : 0)
