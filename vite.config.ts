import { defineConfig } from 'vite'
import type { Plugin } from 'vite'
import { writeFileSync, mkdirSync } from 'node:fs'

// 开发专用：POST /__shot（body 为 PNG dataURL）把画布截图存到 art/preview/shots/，方便离线检查美术效果
function shotPlugin(): Plugin {
  return {
    name: 'tide-shot',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__shot', (req, res) => {
        let body = ''
        req.on('data', c => (body += c))
        req.on('end', () => {
          const name = (new URL(req.url ?? '', 'http://x').searchParams.get('name') ?? 'shot').replace(/[^\w-]/g, '')
          mkdirSync('art/preview/shots', { recursive: true })
          writeFileSync(`art/preview/shots/${name}.png`, Buffer.from(body.split(',')[1], 'base64'))
          res.end('ok')
        })
      })
    },
  }
}

// 开发：Vite 在 5192 提供客户端，/ws 代理到 8799 的游戏服务端
// --mode test：/ws 改代理到 8796 的测试服务端（配合服务端的 --port 8796 --db server/data/test.db）
// 端口特意和潮汐港（5190 / 8787 / 8798）错开：两个项目同时开着也互不干扰
export default defineConfig(({ mode }) => ({
  plugins: [shotPlugin()],
  server: {
    port: 5192, strictPort: true,
    proxy: { '/ws': { target: `ws://localhost:${process.env.SERVER_PORT ?? (mode === 'test' ? 8796 : 8799)}`, ws: true } },
  },
  build: { target: 'es2022', assetsInlineLimit: 0 },
}))
