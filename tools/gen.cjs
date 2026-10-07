// ═══ 潮汐港 · 生图工具 ═══
// 用法：
//   node tools/gen.cjs jobs/xxx.json            → 批量生成（已存在的跳过）
//   node tools/gen.cjs jobs/xxx.json --force    → 覆盖重生成
//   node tools/gen.cjs jobs/xxx.json --only=a,b → 只跑指定 name
// 任务文件格式：[{ name, prompt, style: LAND|SEA|ICON|SCENE, grid?: "32x32", bg?: "scene", refs?: ["art/raw/x.png"] }]
// 输出：art/raw/<name>.png（1024 原图）+ art/raw/<name>.json（实际发送的 prompt，方便复现）
const https = require('https')
const dns = require('dns')
const tls = require('tls')
const fs = require('fs')
const path = require('path')
const { buildPrompt } = require('./style.cjs')

const ROOT = path.join(__dirname, '..')
const RAW = path.join(ROOT, 'art/raw')

for (const line of fs.readFileSync(path.join(ROOT, '.env'), 'utf8').split('\n')) {
  const m = line.match(/^([A-Z_]+)=(.*)$/)
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim()
}
const API_KEY = process.env.CLOUDSWAY_API_KEY
if (!API_KEY) { console.log('❌ .env 里没有 CLOUDSWAY_API_KEY'); process.exit(1) }
const API_HOST = 'genaiapi-m2.cloudsway.net'
const API_PATH = '/v1/chat/completions'
const API_MODEL = 'MaaS_Ge_3.1_flash_image_20260528'
const CONCURRENCY = 3

function dataUrl(file) {
  return 'data:image/png;base64,' + fs.readFileSync(path.join(ROOT, file)).toString('base64')
}

// 接口域名走 CDN，解析出来的几个节点有时会有坏的（TLS 握手直接断），Node 默认总连第一个。
// 所以先把所有地址解析出来、各试一次 TLS 握手（5 秒超时），握手成功的排前面；每次重试换一个节点
let addrsP = null   // 并发的几个任务共用同一次探测
function probe(a) {
  return new Promise(resolve => {
    const t0 = Date.now()
    const sock = tls.connect({ host: a.address, port: 443, servername: API_HOST, timeout: 5000 }, () => { sock.destroy(); resolve(Date.now() - t0) })
    sock.on('error', () => resolve(Infinity))
    sock.on('timeout', () => { sock.destroy(); resolve(Infinity) })
  })
}
function addresses() { return addrsP ??= probeAll() }
async function probeAll() {
  const list = await dns.promises.lookup(API_HOST, { all: true }).catch(() => [])
  const ms = await Promise.all(list.map(probe))
  const addrs = list.map((a, i) => ({ a, ms: ms[i] })).sort((x, y) => x.ms - y.ms).map(x => x.a)
  const ok = ms.filter(m => m < Infinity).length
  if (ok < list.length) console.log(`  节点 ${ok}/${list.length} 可用，优先用 ${addrs[0]?.address}`)
  return addrs
}

function request(content, addr) {
  const postData = JSON.stringify({ model: API_MODEL, temperature: 1, stream: false, messages: [{ role: 'user', content }] })
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: API_HOST, path: API_PATH, method: 'POST',
      ...(addr ? { lookup: (_h, opts, cb) => opts && opts.all ? cb(null, [addr]) : cb(null, addr.address, addr.family) } : {}),
      headers: { Authorization: `Bearer ${API_KEY}`, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(postData) },
    }, res => {
      let body = ''
      res.on('data', d => body += d)
      res.on('end', () => {
        try {
          const data = JSON.parse(body)
          if (data.error) return reject(new Error(JSON.stringify(data.error).slice(0, 300)))
          const url = data.choices?.[0]?.message?.images?.[0]?.image_url?.url ?? ''
          const m = url.match(/^data:image\/\w+;base64,(.+)$/)
          if (!m) return reject(new Error('响应中没有图片: ' + body.slice(0, 200)))
          resolve(Buffer.from(m[1], 'base64'))
        } catch (e) { reject(e) }
      })
    })
    req.on('error', reject)
    req.setTimeout(180000, () => { req.destroy(); reject(new Error('timeout')) })
    req.write(postData)
    req.end()
  })
}

async function runJob(job, force) {
  const out = path.join(RAW, `${job.name}.png`)
  if (!force && fs.existsSync(out)) { console.log(`  ⏭  ${job.name}（已存在）`); return true }
  const prompt = buildPrompt(job)
  const content = job.refs?.length
    ? [...job.refs.map(r => ({ type: 'image_url', image_url: { url: dataUrl(r) } })), { type: 'text', text: prompt }]
    : prompt
  const list = await addresses()
  for (let attempt = 1; attempt <= 6; attempt++) {
    try {
      const buf = await request(content, list.length ? list[(attempt - 1) % list.length] : null)
      fs.mkdirSync(path.dirname(out), { recursive: true })
      fs.writeFileSync(out, buf)
      fs.writeFileSync(out.replace(/\.png$/, '.json'), JSON.stringify({ ...job, sentPrompt: prompt }, null, 2))
      console.log(`  ✅ ${job.name} (${(buf.length / 1024).toFixed(0)}KB)`)
      return true
    } catch (e) {
      console.log(`  ⚠️  ${job.name} 第${attempt}次失败: ${e.message}`)
      if (/white list/.test(e.message)) break // IP 白名单问题重试没用
      // 上游配额限流：退避后再试，并发打满时这很常见
      if (/rate.?limit/i.test(e.message)) await new Promise(r => setTimeout(r, 8000 * attempt))
    }
  }
  return false
}

async function main() {
  const argv = process.argv.slice(2)
  const file = argv.find(a => !a.startsWith('--'))
  if (!file) { console.log('用法：node tools/gen.cjs jobs/xxx.json [--force] [--only=a,b]'); return }
  const force = argv.includes('--force')
  const only = argv.find(a => a.startsWith('--only='))?.slice(7).split(',')
  let jobs = JSON.parse(fs.readFileSync(path.resolve(file), 'utf8'))
  if (only) jobs = jobs.filter(j => only.includes(j.name))
  console.log(`生成 ${jobs.length} 张（并发 ${CONCURRENCY}）`)
  const queue = [...jobs]
  let failed = 0
  await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
    while (queue.length) { if (!(await runJob(queue.shift(), force))) failed++ }
  }))
  console.log(failed ? `完成，失败 ${failed} 张` : '全部完成')
  if (failed) process.exitCode = 1
}

main()
