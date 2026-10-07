// ═══ 潮汐港 · 像素化工具 ═══
// AI 出的"像素风"图其实是 1024 的大图，每个美术像素是一个 N×N 的色块，边缘还有插值噪点。
// 这个工具把它还原成真正 1:1 的像素图：
//   1. 从边缘分布里估出像素网格的周期和相位（不需要事先知道 N）
//   2. 每个格子取中心区域的众数颜色 → 得到干净的 1x 像素图
//   3. 从四周 flood-fill 抠掉背景（白底）
//   4. 裁到内容包围盒；可选按目标高度重采样、按空白列切帧
//
// 用法（库）：const { pixelize } = require('./pixelize.cjs')
// 用法（命令行）：node tools/pixelize.cjs art/raw/x.png [--h=32] [--split] [--scene] [--out=art/sprites/x.png]
const fs = require('fs')
const path = require('path')
const { PNG } = require('pngjs')

const ROOT = path.join(__dirname, '..')

function readPng(file) { return PNG.sync.read(fs.readFileSync(file)) }
function writePng(file, img) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, PNG.sync.write(img))
}
function makeImg(w, h) { const img = new PNG({ width: w, height: h }); img.data.fill(0); return img }

// ── 1. 网格估计 ──
// 对每一列（行）统计与前一列（行）颜色差异大的像素数，得到边缘剖面 E[x]。
// 对候选周期 p，把每个边缘位置映射成相位角 2πx/p，求加权合向量长度 R(p)：
// 边缘严格按 p 周期出现时 R≈1。p 的约数（p/2, p/3…）同样得到 R≈1，
// 所以取「R 不低于最大值 90% 的最大 p」。
function edgeProfile(img, axis) {
  const { width: W, height: H, data } = img
  const n = axis === 'x' ? W : H
  const E = new Float64Array(n)
  const m = axis === 'x' ? H : W
  for (let i = 1; i < n; i++) {
    let c = 0
    for (let j = 0; j < m; j++) {
      const a = axis === 'x' ? (j * W + i) * 4 : (i * W + j) * 4
      const b = axis === 'x' ? (j * W + i - 1) * 4 : ((i - 1) * W + j) * 4
      const d = Math.abs(data[a] - data[b]) + Math.abs(data[a + 1] - data[b + 1]) + Math.abs(data[a + 2] - data[b + 2])
      if (d > 48) c++
    }
    E[i] = c
  }
  return E
}

function estimatePeriod(E, minP = 2, maxP = 64) {
  let total = 0
  for (const e of E) total += e
  if (total === 0) return null
  const scores = []
  for (let p = minP; p <= maxP; p += 0.01) {
    let cs = 0, sn = 0
    const k = (2 * Math.PI) / p
    for (let x = 0; x < E.length; x++) {
      if (!E[x]) continue
      cs += E[x] * Math.cos(k * x); sn += E[x] * Math.sin(k * x)
    }
    scores.push({ p, R: Math.hypot(cs, sn) / total, phase: Math.atan2(sn, cs) })
  }
  const best = Math.max(...scores.map(s => s.R))
  // 最大的、足够好的周期；再在它 ±0.3 邻域取 R 峰值
  const good = scores.filter(s => s.R >= best * 0.9)
  const pick = good[good.length - 1]
  const local = scores.filter(s => Math.abs(s.p - pick.p) < 0.3).sort((a, b) => b.R - a.R)[0]
  // 相位角 → 网格线偏移：边缘在 offset + k·p 处
  let offset = (local.phase / (2 * Math.PI)) * local.p
  if (offset < 0) offset += local.p
  return { period: local.p, offset, R: local.R }
}

// ── 2. 按网格降采样：每格取中心 50% 区域的众数颜色 ──
function downsample(img, gx, gy) {
  const { width: W, height: H, data } = img
  // 只保留完整落在图内的格子：起点取第一条网格线（相位对周期取模）
  const startX = ((gx.offset % gx.period) + gx.period) % gx.period
  const startY = ((gy.offset % gy.period) + gy.period) % gy.period
  const cols = Math.floor((W - startX) / gx.period)
  const rows = Math.floor((H - startY) / gy.period)
  const out = makeImg(cols, rows)
  for (let cy = 0; cy < rows; cy++) {
    for (let cx = 0; cx < cols; cx++) {
      const x0 = startX + cx * gx.period, y0 = startY + cy * gy.period
      const counts = new Map()
      let best = null, bestN = 0
      for (let y = Math.round(y0 + gy.period * 0.25); y <= Math.round(y0 + gy.period * 0.75); y++) {
        for (let x = Math.round(x0 + gx.period * 0.25); x <= Math.round(x0 + gx.period * 0.75); x++) {
          if (x < 0 || y < 0 || x >= W || y >= H) continue
          const i = (y * W + x) * 4
          // 量化到 5bit 做众数统计，最后输出该桶的平均色
          const key = ((data[i] >> 3) << 10) | ((data[i + 1] >> 3) << 5) | (data[i + 2] >> 3)
          let e = counts.get(key)
          if (!e) { e = { n: 0, r: 0, g: 0, b: 0, a: 0 }; counts.set(key, e) }
          e.n++; e.r += data[i]; e.g += data[i + 1]; e.b += data[i + 2]; e.a += data[i + 3]
          if (e.n > bestN) { bestN = e.n; best = e }
        }
      }
      const o = (cy * cols + cx) * 4
      if (best) {
        out.data[o] = best.r / best.n; out.data[o + 1] = best.g / best.n
        out.data[o + 2] = best.b / best.n; out.data[o + 3] = best.a / best.n
      }
    }
  }
  return out
}

// ── 3. 抠背景：取四周像素的中位色为背景色，从四周 flood-fill ──
function removeBackground(img, tol = 60) {
  const { width: W, height: H, data } = img
  const border = []
  for (let x = 0; x < W; x++) border.push(x, (H - 1) * W + x)
  for (let y = 0; y < H; y++) border.push(y * W, y * W + W - 1)
  const opaque = border.filter(p => data[p * 4 + 3] > 0)
  const ch = c => opaque.map(p => data[p * 4 + c]).sort((a, b) => a - b)[opaque.length >> 1]
  const bg = [ch(0), ch(1), ch(2)]
  const isBg = p => {
    const i = p * 4
    if (data[i + 3] === 0) return true
    return Math.abs(data[i] - bg[0]) + Math.abs(data[i + 1] - bg[1]) + Math.abs(data[i + 2] - bg[2]) < tol
  }
  const seen = new Uint8Array(W * H)
  const stack = border.filter(isBg)
  for (const p of stack) seen[p] = 1
  while (stack.length) {
    const p = stack.pop()
    data[p * 4 + 3] = 0
    const x = p % W, y = (p / W) | 0
    for (const q of [x > 0 ? p - 1 : -1, x < W - 1 ? p + 1 : -1, y > 0 ? p - W : -1, y < H - 1 ? p + W : -1]) {
      if (q >= 0 && !seen[q] && isBg(q)) { seen[q] = 1; stack.push(q) }
    }
  }
  // 去掉孤立的 1~2 像素噪点
  for (let p = 0; p < W * H; p++) {
    if (!data[p * 4 + 3]) continue
    const x = p % W, y = (p / W) | 0
    let n = 0
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const xx = x + dx, yy = y + dy
      if (xx >= 0 && yy >= 0 && xx < W && yy < H && data[(yy * W + xx) * 4 + 3]) n++
    }
    if (n === 0) data[p * 4 + 3] = 0
  }
  return bg
}

function bbox(img) {
  const { width: W, height: H, data } = img
  let x0 = W, y0 = H, x1 = -1, y1 = -1
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (data[(y * W + x) * 4 + 3] > 0) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y }
  }
  return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 }
}

function crop(img, r) {
  const out = makeImg(r.w, r.h)
  for (let y = 0; y < r.h; y++) img.data.copy(out.data, y * r.w * 4, ((r.y + y) * img.width + r.x) * 4, ((r.y + y) * img.width + r.x + r.w) * 4)
  return out
}

// 最近邻重采样（只在网格估计出的尺寸与目标差很多时用）
function resample(img, w, h) {
  const out = makeImg(w, h)
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const sx = Math.min(img.width - 1, Math.floor((x + 0.5) * img.width / w))
    const sy = Math.min(img.height - 1, Math.floor((y + 0.5) * img.height / h))
    img.data.copy(out.data, (y * w + x) * 4, (sy * img.width + sx) * 4, (sy * img.width + sx) * 4 + 4)
  }
  return out
}

// 按全透明的列把一条横向精灵带切成多帧（生长阶段、动作帧）
function splitColumns(img, minGap = 1) {
  const { width: W, height: H, data } = img
  const empty = x => { for (let y = 0; y < H; y++) if (data[(y * W + x) * 4 + 3]) return false; return true }
  const frames = []
  let start = -1, gap = 0
  for (let x = 0; x <= W; x++) {
    const e = x === W || empty(x)
    if (!e) { if (start < 0) start = x; gap = 0 }
    else if (start >= 0 && ++gap >= minGap) { frames.push({ x: start, w: x - gap + 1 - start }); start = -1 }
  }
  return frames.map(f => crop(img, { x: f.x, y: 0, w: f.w, h: H }))
}

function pixelize(file, opts = {}) {
  const src = readPng(file)
  const gx = estimatePeriod(edgeProfile(src, 'x'))
  const gy = estimatePeriod(edgeProfile(src, 'y'))
  if (!gx || !gy) throw new Error('没有检测到边缘：' + file)
  // 两轴周期应当一致，取 R 更可信的那个轴的周期，另一轴沿用自己的相位
  const period = gx.R >= gy.R ? gx.period : gy.period
  let img = downsample(src, { ...gx, period }, { ...gy, period })
  if (!opts.scene) removeBackground(img, opts.tol ?? 60)
  if (!opts.scene) { const r = bbox(img); if (!r) throw new Error('抠完是空的：' + file); img = crop(img, r) }
  if (opts.h && Math.abs(img.height - opts.h) / opts.h > 0.12) {
    img = resample(img, Math.max(1, Math.round(img.width * opts.h / img.height)), opts.h)
  }
  return { img, period, R: Math.min(gx.R, gy.R) }
}

// 放大预览（肉眼检查用），透明处画棋盘格
function preview(img, scale = 8) {
  const out = makeImg(img.width * scale, img.height * scale)
  for (let y = 0; y < out.height; y++) for (let x = 0; x < out.width; x++) {
    const s = ((((y / scale) | 0) * img.width) + ((x / scale) | 0)) * 4, o = (y * out.width + x) * 4
    const a = img.data[s + 3] / 255
    const chk = ((x >> 3) + (y >> 3)) & 1 ? 200 : 235
    for (let c = 0; c < 3; c++) out.data[o + c] = img.data[s + c] * a + chk * (1 - a)
    out.data[o + 3] = 255
  }
  return out
}

module.exports = { pixelize, preview, splitColumns, readPng, writePng, makeImg, crop, bbox, resample, removeBackground }

if (require.main === module) {
  const argv = process.argv.slice(2)
  const file = argv.find(a => !a.startsWith('--'))
  const opt = k => argv.find(a => a.startsWith(`--${k}=`))?.split('=')[1]
  const name = path.basename(file, '.png')
  const { img, period, R } = pixelize(file, { h: opt('h') ? +opt('h') : undefined, scene: argv.includes('--scene') })
  const out = opt('out') ?? path.join(ROOT, 'art/sprites', `${name}.png`)
  console.log(`${name}: 周期 ${period.toFixed(2)}px (R=${R.toFixed(2)}) → ${img.width}×${img.height}`)
  if (argv.includes('--split')) {
    splitColumns(img).forEach((f, i) => writePng(out.replace(/\.png$/, `_${i}.png`), f))
  } else writePng(out, img)
  writePng(path.join(ROOT, 'art/preview', `${name}.png`), preview(img))
}
