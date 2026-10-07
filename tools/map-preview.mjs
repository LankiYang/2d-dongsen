// 离线地图预览：按地块着色地形，再按真实精灵尺寸把所有物件贴上去（按 y 排序），
// 输出 art/preview/map_<区域>.png，并报告布局冲突。调整 shared/island.ts 的摆放时用它快速迭代。
//   node --disable-warning=ExperimentalWarning tools/map-preview.mjs [x0 y0 x1 y1]（地块坐标，默认整张图）
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const { PNG } = require('pngjs')
const I = await import('../shared/island.ts')
const { TILE } = await import('../shared/data.ts')

const [x0 = 0, y0 = 0, x1 = I.ISLAND_W, y1 = I.ISLAND_H] = process.argv.slice(2).map(Number)
const W = (x1 - x0) * TILE, H = (y1 - y0) * TILE
const out = new PNG({ width: W, height: H })
const COL = { [I.T.DEEP]: [26, 92, 150], [I.T.SHALLOW]: [60, 180, 190], [I.T.SAND]: [228, 202, 147], [I.T.GRASS]: [104, 170, 70], [I.T.PATH]: [178, 138, 92], [I.T.FARM]: [120, 160, 70], [I.T.DOCK]: [140, 90, 52] }
for (let py = 0; py < H; py++) for (let px = 0; px < W; px++) {
  const t = I.classify(x0 + (px + 0.5) / TILE, y0 + (py + 0.5) / TILE)
  const c = COL[t], o = (py * W + px) * 4
  out.data[o] = c[0]; out.data[o + 1] = c[1]; out.data[o + 2] = c[2]; out.data[o + 3] = 255
}
// 地块网格淡线
for (let py = 0; py < H; py++) for (let px = 0; px < W; px++) if (px % TILE === 0 || py % TILE === 0) { const o = (py * W + px) * 4; for (let k = 0; k < 3; k++) out.data[o + k] *= 0.93 }

const atlases = ['island', 'decor'].map(n => ({ json: JSON.parse(readFileSync(`public/assets/${n}.json`, 'utf8')), png: PNG.sync.read(readFileSync(`public/assets/${n}.png`)) }))
const frameOf = kind => { for (const a of atlases) if (a.json.frames[kind]) return { f: a.json.frames[kind].frame, png: a.png }; return null }

const island = I.buildIsland()
const objs = [...island.objects].sort((a, b) => a.y - b.y)
const problems = []
for (const o of objs) {
  const fr = frameOf(o.kind)
  if (!fr) { problems.push(`缺素材 ${o.kind}`); continue }
  const { f, png } = fr
  const ox = Math.round(o.x - f.w / 2 - x0 * TILE), oy = Math.round(o.y - f.h - y0 * TILE)
  for (let y = 0; y < f.h; y++) for (let x = 0; x < f.w; x++) {
    const sx = o.flip ? f.w - 1 - x : x
    const s = ((f.y + y) * png.width + f.x + sx) * 4
    const a = png.data[s + 3] / 255
    if (!a) continue
    const dx = ox + x, dy = oy + y
    if (dx < 0 || dy < 0 || dx >= W || dy >= H) continue
    const d = (dy * W + dx) * 4
    for (let k = 0; k < 3; k++) out.data[d + k] = png.data[s + k] * a + out.data[d + k] * (1 - a)
  }
}

// ── 冲突检查 ──
const tileType = (tx, ty) => island.types[ty * I.ISLAND_W + tx]
const inPlaza = (tx, ty) => Math.hypot(tx + 0.5 - I.PLAZA.x, ty + 0.5 - I.PLAZA.y) < I.PLAZA.r + 1
const owner = new Map()
const ownerLot = new Map()
for (const [x, y] of [...I.picketTiles(), ...I.fenceTiles()]) { const tt = tileType(x, y); if (tt === I.T.PATH) problems.push(`栅栏压在路上 (${x},${y})`); owner.set(`${x},${y}`, '栅栏') }
for (const o of objs) {
  if (!o.block) continue
  const [bx0, by0, bx1, by1] = o.block
  for (let y = by0; y <= by1; y++) for (let x = bx0; x <= bx1; x++) {
    const t = tileType(x, y)
    if ((t === I.T.PATH) && !inPlaza(x, y) && o.kind !== 'lantern') problems.push(`${o.kind}@${(o.x / TILE).toFixed(1)},${(o.y / TILE).toFixed(1)} 压在路上 (${x},${y})`)
    const stiltOk = o.kind === 'house_stilt' && t === I.T.SHALLOW
    if ((t === I.T.DEEP || t === I.T.SHALLOW) && o.kind !== 'lantern' && !stiltOk) problems.push(`${o.kind}@${(o.x / TILE).toFixed(1)},${(o.y / TILE).toFixed(1)} 在水里 (${x},${y})`)
    const k = `${x},${y}`
    const sameLot = o.lot !== undefined && ownerLot.get(k) === o.lot
    if (owner.has(k) && !sameLot) problems.push(`${o.kind} 与 ${owner.get(k)} 重叠 (${x},${y})`)
    else { owner.set(k, o.kind); ownerLot.set(k, o.lot) }
  }
}
// 小物件的像素碰撞底座：不能压路、不能进水、不能压到房子/篱笆、彼此不能重叠
const rectTiles = r => { const out = []; for (let y = Math.floor(r[1] / TILE); y <= Math.floor((r[3] - 0.01) / TILE); y++) for (let x = Math.floor(r[0] / TILE); x <= Math.floor((r[2] - 0.01) / TILE); x++) out.push([x, y]); return out }
const withRect = objs.filter(o => o.rect)
for (const o of withRect) {
  const at = `${o.kind}@${(o.x / TILE).toFixed(1)},${(o.y / TILE).toFixed(1)}`
  const cx = (o.rect[0] + o.rect[2]) / 2 / TILE, cy = (o.rect[1] + o.rect[3]) / 2 / TILE
  if (o.kind !== 'lantern' && I.pathEdge(cx, cy) < -0.1 && Math.hypot(cx - I.PLAZA.x, cy - I.PLAZA.y) > I.PLAZA.r + 1) problems.push(`${at} 压在路上`)
  for (const [x, y] of rectTiles(o.rect)) {
    const t = tileType(x, y)
    if ((t === I.T.DEEP || t === I.T.SHALLOW) && o.kind !== 'lantern') problems.push(`${at} 在水里`)
    const own = o.lot !== undefined && (() => { const b = I.lotBlock(I.LOTS[o.lot]); return x >= b[0] && x <= b[2] && y >= b[1] && y <= b[3] })()
    if (island.blocked[y * I.ISLAND_W + x] && t !== I.T.DEEP && t !== I.T.SHALLOW && !own) problems.push(`${at} 压到房子或篱笆 (${x},${y})`)
  }
  for (const p of withRect) if (p !== o && o.rect[0] < p.rect[2] && o.rect[2] > p.rect[0] && o.rect[1] < p.rect[3] && o.rect[3] > p.rect[1] && o.x < p.x) problems.push(`${at} 与 ${p.kind} 重叠`)
}
for (const l of I.LOTS) {
  const d = I.lotDoor(l)
  if (I.pathEdge(d.x, d.y + 0.6) > 0) problems.push(`${l.id} 号房门前没有路`)
}
mkdirSync('art/preview', { recursive: true })
const file = `art/preview/map_${x0}_${y0}_${x1}_${y1}.png`
writeFileSync(file, PNG.sync.write(out))
console.log(`${file}  ${W}×${H}`)
console.log(problems.length ? `⚠️ ${problems.length} 处问题：\n  ` + [...new Set(problems)].join('\n  ') : '✅ 没有布局冲突')
