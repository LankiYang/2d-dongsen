// 通用地图离线预览：不用开游戏就能看生成效果。
//   node tools/world-preview.mts <地图id> overview            整张图缩略（每地块 1~几个像素）+ 聚落/道路标注
//   node tools/world-preview.mts <地图id> detail x y w h      用真实烘焙 + 真实精灵渲染一块区域（地块坐标）
//   node tools/world-preview.mts all                          所有地图的缩略图 + 各自村子附近一块细节
// 输出到 art/preview/world/，并打印生成耗时和统计。
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { World } from '../shared/world/gen.ts'
import { bakeChunk } from '../shared/world/bake.ts'
import { MAPS } from '../shared/world/maps.ts'
import { CHUNK, TERRAIN, PLACEHOLDER } from '../shared/world/defs.ts'
import { TILE } from '../shared/data.ts'
const require = createRequire(import.meta.url)
const { PNG } = require('pngjs')

const OUT = 'art/preview/world'
mkdirSync(OUT, { recursive: true })
const hex = (h: number) => [(h >> 16) & 255, (h >> 8) & 255, h & 255]
// 水面：按着色器的五档色带近似
const WATER_RAMP = [[0.54, 0.89, 0.82], [0.27, 0.77, 0.79], [0.14, 0.58, 0.74], [0.11, 0.40, 0.64], [0.09, 0.28, 0.52]].map(c => c.map(v => Math.round(v * 255)))
const waterColor = (depth: number, shore: number) => {
  const k = depth * 0.85 + Math.min(1, shore / 26) * 0.22
  const c = WATER_RAMP[Math.min(4, Math.floor(Math.max(0, Math.min(0.999, k)) * 5))]
  return shore < 2.5 ? [220, 248, 248] : c
}

const atlases = ['island', 'decor'].map(n => ({ json: JSON.parse(readFileSync(`public/assets/${n}.json`, 'utf8')), png: PNG.sync.read(readFileSync(`public/assets/${n}.png`)) }))
const frameOf = (kind: string) => { for (const a of atlases) if (a.json.frames[kind]) return { f: a.json.frames[kind].frame, png: a.png }; return null }

function overview(id: string) {
  const def = MAPS[id]
  const t0 = performance.now()
  const world = new World(def)
  const tSkel = performance.now() - t0
  const k = Math.max(1, Math.ceil(Math.max(def.w, def.h) / 700))   // 每像素代表几格
  const sc = k === 1 ? Math.max(1, Math.floor(700 / Math.max(def.w, def.h))) : 1 // 小图放大
  const W = Math.ceil(def.w / k) * sc, H = Math.ceil(def.h / k) * sc
  const png = new PNG({ width: W, height: H })
  const count = new Map<string, number>()
  for (let py = 0; py < H; py += sc) for (let px = 0; px < W; px += sc) {
    const tx = (px / sc) * k + k / 2, ty = (py / sc) * k + k / 2
    const v = world.sample(tx, ty)
    const t = world.classifyV(v)
    const def2 = TERRAIN[t]
    count.set(def2.key, (count.get(def2.key) ?? 0) + 1)
    const c = def2.water ? waterColor(Math.max(0, -v[0] / 0.32), 20) : hex(def2.pal[2])
    for (let yy = 0; yy < sc; yy++) for (let xx = 0; xx < sc; xx++) {
      const o = ((py + yy) * W + px + xx) * 4
      png.data[o] = c[0]; png.data[o + 1] = c[1]; png.data[o + 2] = c[2]; png.data[o + 3] = 255
    }
  }
  // 聚落：红框；房子：小方块
  const mark = (x: number, y: number, r: number, c: number[]) => {
    const cx = Math.round(x / k * sc), cy = Math.round(y / k * sc)
    for (let yy = -r; yy <= r; yy++) for (let xx = -r; xx <= r; xx++) {
      if (Math.max(Math.abs(xx), Math.abs(yy)) !== r && r > 1) continue
      const X = cx + xx, Y = cy + yy
      if (X < 0 || Y < 0 || X >= W || Y >= H) continue
      const o = (Y * W + X) * 4
      png.data[o] = c[0]; png.data[o + 1] = c[1]; png.data[o + 2] = c[2]
    }
  }
  for (const s of world.settlements) {
    mark(s.x, s.y, Math.max(3, Math.round(8 * sc / k)), [230, 40, 40])
    for (const l of s.lots) mark(l.x, l.y - 1, 1, [120, 40, 30])
  }
  for (const p of world.portals) mark(p.x, p.y - 1, 2, [80, 240, 255])  // 传送石：青色
  const file = `${OUT}/${id}_overview.png`
  writeFileSync(file, PNG.sync.write(png))
  const total = [...count.values()].reduce((a, b) => a + b, 0)
  const mix = [...count].sort((a, b) => b[1] - a[1]).map(([kk, n]) => `${kk} ${(n / total * 100).toFixed(1)}%`).join('  ')
  console.log(`${def.name}（${id}）${def.w}×${def.h}  骨架 ${tSkel.toFixed(0)}ms  总 ${(performance.now() - t0).toFixed(0)}ms  村子 ${world.settlements.length}  传送石 ${world.portals.length}  房子 ${world.settlements.reduce((n, s) => n + s.lots.length, 0)}  道路 ${world.roads.length}`)
  console.log(`  地形：${mix}`)
  console.log(`  → ${file}`)
  return world
}

function detail(id: string, x0: number, y0: number, w: number, h: number, world = new World(MAPS[id]), tag = '') {
  const W = w * TILE, H = h * TILE
  const png = new PNG({ width: W, height: H })
  const cx0 = Math.floor(x0 / CHUNK), cy0 = Math.floor(y0 / CHUNK), cx1 = Math.floor((x0 + w - 1) / CHUNK), cy1 = Math.floor((y0 + h - 1) / CHUNK)
  const P = CHUNK * TILE
  let bakeMs = 0, genMs = 0, objs: any[] = []
  for (let cy = cy0; cy <= cy1; cy++) for (let cx = cx0; cx <= cx1; cx++) {
    const t0 = performance.now()
    const b = bakeChunk(world, cx, cy)
    const t1 = performance.now()
    const c = world.chunk(cx, cy)
    genMs += performance.now() - t1; bakeMs += t1 - t0
    objs.push(...c.objects)
    for (let y = 0; y < P; y++) for (let x = 0; x < P; x++) {
      const X = cx * P + x - x0 * TILE, Y = cy * P + y - y0 * TILE
      if (X < 0 || Y < 0 || X >= W || Y >= H) continue
      const s = (y * P + x) * 4, o = (Y * W + X) * 4
      let col: number[]
      if (b.water[s + 3]) {
        col = waterColor(b.water[s + 1] / 255, b.water[s] / 4)
        if (b.ground[s + 3]) { const a = b.ground[s + 3] / 255; col = col.map((v, i) => v * (1 - a) + b.ground[s + i] * a) }
      } else col = [b.ground[s], b.ground[s + 1], b.ground[s + 2]]
      png.data[o] = col[0]; png.data[o + 1] = col[1]; png.data[o + 2] = col[2]; png.data[o + 3] = 255
    }
  }
  // 物件按 y 排序贴上去
  objs.sort((a, b) => a.y - b.y)
  const missing = new Set<string>()
  for (const o of objs) {
    const ox = o.x - x0 * TILE, oy = o.y - y0 * TILE
    if (ox < -100 || oy < -10 || ox > W + 100 || oy > H + 200) continue
    // 阴影
    for (let yy = -2; yy <= 1; yy++) for (let xx = -8; xx <= 8; xx++) {
      if ((xx * xx) / 64 + (yy * yy) / 4 > 1) continue
      const X = ox + xx, Y = oy + yy
      if (X < 0 || Y < 0 || X >= W || Y >= H) continue
      const i = (Y * W + X) * 4
      for (let k = 0; k < 3; k++) png.data[i + k] *= 0.75
    }
    const fr = frameOf(o.kind)
    if (fr) {
      const { f, png: src } = fr
      const sx0 = Math.round(ox - f.w / 2), sy0 = Math.round(oy - f.h)
      for (let y = 0; y < f.h; y++) for (let x = 0; x < f.w; x++) {
        const sx = o.flip ? f.w - 1 - x : x
        const s = ((f.y + y) * src.width + f.x + sx) * 4
        const a = src.data[s + 3] / 255
        if (!a) continue
        const X = sx0 + x, Y = sy0 + y
        if (X < 0 || Y < 0 || X >= W || Y >= H) continue
        const i = (Y * W + X) * 4
        for (let k = 0; k < 3; k++) png.data[i + k] = png.data[i + k] * (1 - a) + src.data[s + k] * a
      }
    } else {
      // 还没有素材：画一个带描边的色块（大物件高、小物件矮）
      missing.add(o.kind)
      const big = /tree|pine|cactus_tall|stalagmite_big|dead_tree/.test(o.kind)
      const bw = big ? 18 : 12, bh = big ? 32 : 11
      const c = hex(PLACEHOLDER[o.kind] ?? 0xff00ff)
      for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) {
        const X = Math.round(ox - bw / 2) + x, Y = oy - bh + y
        if (X < 0 || Y < 0 || X >= W || Y >= H) continue
        const edge = x === 0 || y === 0 || x === bw - 1 || y === bh - 1
        const i = (Y * W + X) * 4
        const col = edge ? c.map(v => v * 0.45) : y < 2 ? c.map(v => Math.min(255, v * 1.2)) : c
        png.data[i] = col[0]; png.data[i + 1] = col[1]; png.data[i + 2] = col[2]
      }
    }
  }
  const file = `${OUT}/${id}_detail${tag}.png`
  writeFileSync(file, PNG.sync.write(png))
  const n = (cx1 - cx0 + 1) * (cy1 - cy0 + 1)
  console.log(`  细节 ${w}×${h} 格（${n} 个区块）：烘焙 ${(bakeMs / n).toFixed(0)}ms/块  物件 ${(genMs / n).toFixed(0)}ms/块  物件数 ${objs.length}${missing.size ? `  待画素材：${[...missing].join(' ')}` : ''}`)
  console.log(`  → ${file}`)
}

const [id, mode, ...rest] = process.argv.slice(2)
if (id === 'all' || !id) {
  for (const k of Object.keys(MAPS)) {
    const world = overview(k)
    const d = MAPS[k]
    const s = world.settlements[0]
    const cx = s ? s.x : d.w / 2, cy = s ? s.y : d.h / 2
    detail(k, Math.max(0, Math.round(cx - 24)), Math.max(0, Math.round(cy - 15)), 48, 30, world)
  }
} else if (mode === 'detail') {
  const [x, y, w, h] = rest.map(Number)
  detail(id, x, y, w, h)
} else overview(id)
