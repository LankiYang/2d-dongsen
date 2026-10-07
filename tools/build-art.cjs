// ═══ 潮汐港 · 素材构建 ═══
// 读 art/manifest.json：每个条目指向一张 art/raw 原图，
// 经 pixelize 还原成 1x 像素图 → 按连通块切出各个精灵 → 命名 → 打成图集。
//
//   node tools/build-art.cjs            → 构建全部
//   node tools/build-art.cjs fish crops → 只构建指定图集
//
// 输出：public/assets/<atlas>.png + <atlas>.json（PixiJS Spritesheet 格式）
//       art/preview/<atlas>_split.png（切块编号预览，顺序 = 行优先）
//
// 清单条目字段：
//   raw     原图名（art/raw/<raw>.png）
//   names   切出来的连通块按「先行后列」排序后依次命名；数量对不上会报错并打预览
//   single  整张图只有一个主体时用它代替 names
//   skip    按序号跳过（模型多画了东西时）
//   scale   统一缩放系数（<1 为缩小，用众数盒采样，保住像素边缘）
//   anchor  "bottom"（陆地物件，锚点在脚底）| "center"（水下生物）
//   gap     切块时的合并距离（默认 2 像素，零件分散的素材调大）
//   minArea 小于这个像素数的碎块丢掉（默认 12）
//   fitH    整组等比缩放到最高帧等于这个高度（行走帧对齐身高用）
//   alignFacing 以第一帧为准自动翻转朝向相反的帧（行走帧用）
//
// 名字以 _hd 结尾的图集是高清版（动森方向），字段不同，见 tools/hd.cjs
const fs = require('fs')
const path = require('path')
const { pixelize, readPng, writePng, makeImg, crop } = require('./pixelize.cjs')

const ROOT = path.join(__dirname, '..')
const OUT = path.join(ROOT, 'public/assets')

// ── 连通块切分 ──
function components(img, gap = 2, minArea = 12) {
  const { width: W, height: H, data } = img
  const solid = new Uint8Array(W * H)
  for (let p = 0; p < W * H; p++) solid[p] = data[p * 4 + 3] > 0 ? 1 : 0
  // 膨胀 gap 像素，让分离的小零件（气泡、鳍尖）并入主体
  let mask = solid
  for (let g = 0; g < gap; g++) {
    const next = new Uint8Array(W * H)
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const p = y * W + x
      next[p] = mask[p] || (x > 0 && mask[p - 1]) || (x < W - 1 && mask[p + 1]) || (y > 0 && mask[p - W]) || (y < H - 1 && mask[p + W]) ? 1 : 0
    }
    mask = next
  }
  const label = new Int32Array(W * H).fill(-1)
  const boxes = []
  for (let s = 0; s < W * H; s++) {
    if (!mask[s] || label[s] >= 0) continue
    const id = boxes.length
    const b = { x0: W, y0: H, x1: -1, y1: -1, area: 0 }
    const stack = [s]; label[s] = id
    while (stack.length) {
      const p = stack.pop()
      const x = p % W, y = (p / W) | 0
      if (solid[p]) { b.area++; if (x < b.x0) b.x0 = x; if (x > b.x1) b.x1 = x; if (y < b.y0) b.y0 = y; if (y > b.y1) b.y1 = y }
      for (const q of [x > 0 ? p - 1 : -1, x < W - 1 ? p + 1 : -1, y > 0 ? p - W : -1, y < H - 1 ? p + W : -1]) {
        if (q >= 0 && mask[q] && label[q] < 0) { label[q] = id; stack.push(q) }
      }
    }
    b.id = id
    boxes.push(b)
  }
  const kept = boxes.filter(b => b.area >= minArea)
  // 行优先排序：按底边排序，与当前行首块在垂直方向重叠超过较矮者 40% 的归入同一行。
  // 行的范围固定为首块的范围、不随成员扩张——否则一条大鱼会把上下两行都吞进来；
  // 用重叠而不是中心距离，是因为底边对齐的生长阶段高矮差很多，中心会错开
  kept.sort((a, b) => a.y1 - b.y1)
  const rows = []
  for (const b of kept) {
    const row = rows.find(r => {
      const ov = Math.min(r.y1, b.y1) - Math.max(r.y0, b.y0) + 1
      return ov > 0.4 * Math.min(r.y1 - r.y0 + 1, b.y1 - b.y0 + 1)
    })
    if (row) row.items.push(b)
    else rows.push({ y0: b.y0, y1: b.y1, items: [b] })
  }
  rows.sort((a, b) => a.y0 - b.y0)
  const ordered = rows.flatMap(r => r.items.sort((a, b) => a.x0 - b.x0))
  // 每块只保留属于自己标签的像素（相邻块的包围盒可能重叠）
  return ordered.map(b => {
    const w = b.x1 - b.x0 + 1, h = b.y1 - b.y0 + 1
    const out = makeImg(w, h)
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const p = (b.y0 + y) * W + b.x0 + x
      if (label[p] === b.id && solid[p]) data.copy(out.data, (y * w + x) * 4, p * 4, p * 4 + 4)
    }
    return out
  })
}

// ── 众数盒采样缩放：每个目标像素取源区域内出现最多的不透明颜色；覆盖率 <50% 则透明 ──
function scaleMode(img, s) {
  if (s === 1) return img
  const w = Math.max(1, Math.round(img.width * s)), h = Math.max(1, Math.round(img.height * s))
  const out = makeImg(w, h)
  const fx = img.width / w, fy = img.height / h
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const counts = new Map()
    let total = 0, opaque = 0, best = null, bestN = 0
    for (let sy = Math.floor(y * fy); sy < Math.ceil((y + 1) * fy); sy++) for (let sx = Math.floor(x * fx); sx < Math.ceil((x + 1) * fx); sx++) {
      if (sx >= img.width || sy >= img.height) continue
      const i = (sy * img.width + sx) * 4
      total++
      if (img.data[i + 3] < 128) continue
      opaque++
      const key = (img.data[i] << 16) | (img.data[i + 1] << 8) | img.data[i + 2]
      const n = (counts.get(key) ?? 0) + 1
      counts.set(key, n)
      if (n > bestN) { bestN = n; best = key }
    }
    if (best === null || opaque / total < 0.5) continue
    const o = (y * w + x) * 4
    out.data[o] = best >> 16; out.data[o + 1] = (best >> 8) & 255; out.data[o + 2] = best & 255; out.data[o + 3] = 255
  }
  return out
}

// ── 缩小后补描边：贴着透明区的边缘像素如果不够暗，压暗成同色相的深色描边 ──
// 2:1 缩小时 1 像素宽的原描边可能被众数投票吃掉，轮廓会发虚，这里补回来
function reoutline(img) {
  const { width: W, height: H, data } = img
  const edge = []
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 4
    if (!data[i + 3]) continue
    const t = (xx, yy) => xx < 0 || yy < 0 || xx >= W || yy >= H || !data[(yy * W + xx) * 4 + 3]
    if (t(x - 1, y) || t(x + 1, y) || t(x, y - 1) || t(x, y + 1)) edge.push(i)
  }
  for (const i of edge) {
    const lum = 0.3 * data[i] + 0.59 * data[i + 1] + 0.11 * data[i + 2]
    if (lum < 70) continue // 已经是深色描边
    // 压暗并略微偏冷，保持和原画「带色相的描边」一致
    data[i] = data[i] * 0.42; data[i + 1] = data[i + 1] * 0.42; data[i + 2] = Math.min(255, data[i + 2] * 0.5 + 8)
  }
  return img
}

// ── 朝向校正：行走帧里模型经常混着画朝左和朝右的。以第一帧为准，
// 只比上半身（头 + 躯干，腿每帧都不一样），跟镜像后的第一帧更像的帧就翻过来 ──
function flipX(img) {
  const out = makeImg(img.width, img.height)
  for (let y = 0; y < img.height; y++) for (let x = 0; x < img.width; x++) {
    img.data.copy(out.data, (y * img.width + (img.width - 1 - x)) * 4, (y * img.width + x) * 4, (y * img.width + x) * 4 + 4)
  }
  return out
}
function upperDiff(a, b) {
  // 底边中心对齐，比较上 55% 的区域
  const h = Math.round(Math.min(a.height, b.height) * 0.55), w = Math.max(a.width, b.width)
  let d = 0
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const ax = x - Math.floor((w - a.width) / 2), bx = x - Math.floor((w - b.width) / 2)
    const ay = a.height - Math.min(a.height, b.height) + y, by = b.height - Math.min(a.height, b.height) + y
    const pa = ax >= 0 && ax < a.width ? (ay * a.width + ax) * 4 : -1, pb = bx >= 0 && bx < b.width ? (by * b.width + bx) * 4 : -1
    const oa = pa >= 0 && a.data[pa + 3], ob = pb >= 0 && b.data[pb + 3]
    if (!oa && !ob) continue
    if (!oa || !ob) { d += 300; continue }
    d += Math.abs(a.data[pa] - b.data[pb]) + Math.abs(a.data[pa + 1] - b.data[pb + 1]) + Math.abs(a.data[pa + 2] - b.data[pb + 2])
  }
  return d
}
function alignFacing(parts) {
  const ref = parts[0], refFlip = flipX(ref)
  return parts.map((p, i) => {
    if (i === 0) return p
    const direct = upperDiff(p, ref), mirrored = upperDiff(p, refFlip)
    if (mirrored < direct * 0.9) { console.log(`    ↔ 第 ${i} 帧朝向和第 0 帧相反，已翻转`); return flipX(p) }
    return p
  })
}

// ── 图集打包：按高度排序的货架法，精灵之间留 1 像素空隙防渗色 ──
function pack(sprites, maxW = 1024) {
  const order = [...sprites].sort((a, b) => b.img.height - a.img.height)
  let x = 1, y = 1, rowH = 0, W = 0
  for (const s of order) {
    if (x + s.img.width + 1 > maxW) { x = 1; y += rowH + 1; rowH = 0 }
    s.x = x; s.y = y
    x += s.img.width + 1; rowH = Math.max(rowH, s.img.height); W = Math.max(W, x)
  }
  const H = y + rowH + 1
  const sheet = makeImg(W, H)
  for (const s of order) for (let r = 0; r < s.img.height; r++) {
    s.img.data.copy(sheet.data, ((s.y + r) * W + s.x) * 4, r * s.img.width * 4, (r + 1) * s.img.width * 4)
  }
  return sheet
}

// 切块预览：每块画在独立格子里，按编号顺序排（左上角的色条长度 = 序号，方便对照）
function splitPreview(parts, file) {
  const cell = Math.max(...parts.map(p => Math.max(p.width, p.height))) + 6
  const cols = Math.min(parts.length, 8)
  const scale = Math.max(1, Math.floor(1200 / (cols * cell)))
  const sheet = makeImg(cols * cell * scale, Math.ceil(parts.length / cols) * cell * scale)
  parts.forEach((p, i) => {
    const ox = (i % cols) * cell, oy = ((i / cols) | 0) * cell
    for (let y = 0; y < cell; y++) for (let x = 0; x < cell; x++) {
      let c = ((x >> 2) + (y >> 2)) & 1 ? [200, 200, 200] : [230, 230, 230]
      if (y < 2 && x < Math.min(cell, (i + 1) * 2)) c = [220, 40, 40] // 序号色条
      const px = x - 3, py = y - 3
      if (px >= 0 && py >= 0 && px < p.width && py < p.height && p.data[(py * p.width + px) * 4 + 3]) {
        const s = (py * p.width + px) * 4
        c = [p.data[s], p.data[s + 1], p.data[s + 2]]
      }
      for (let yy = 0; yy < scale; yy++) for (let xx = 0; xx < scale; xx++) {
        const o = (((oy + y) * scale + yy) * sheet.width + (ox + x) * scale + xx) * 4
        sheet.data[o] = c[0]; sheet.data[o + 1] = c[1]; sheet.data[o + 2] = c[2]; sheet.data[o + 3] = 255
      }
    }
  })
  writePng(file, sheet)
}

// 抠「洞」：四周 flood-fill 够不着被围住的白底（凳子腿之间、栏杆缝、叶子缝）。
// 只对清单里 holes 点名的精灵做，只清近纯白像素（画出来的白色一般带点灰或色偏，留着）
// minArea：只清成片的白（客船的彩旗绳和桅杆围出来的大块白底），船身上零星的白色高光留着
function clearHoles(img, minArea = 0) {
  const d = img.data, w = img.width, h = img.height
  const white = i => d[i * 4 + 3] && d[i * 4] + d[i * 4 + 1] + d[i * 4 + 2] >= 735 && Math.min(d[i * 4], d[i * 4 + 1], d[i * 4 + 2]) >= 235
  const seen = new Uint8Array(w * h)
  for (let k = 0; k < w * h; k++) {
    if (seen[k] || !white(k)) continue
    const comp = [k], st = [k]; seen[k] = 1
    while (st.length) {
      const p = st.pop(), x = p % w
      for (const q of [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, p - w, p + w]) {
        if (q < 0 || q >= w * h || seen[q] || !white(q)) continue
        seen[q] = 1; st.push(q); comp.push(q)
      }
    }
    if (comp.length >= minArea) for (const p of comp) d[p * 4 + 3] = 0
  }
}

function buildAtlas(atlasName, entries) {
  // 名字以 _hd 结尾的图集走高清流程（tools/hd.cjs）：不还原像素网格，软边抠图 + 面积平均缩小
  if (atlasName.endsWith('_hd')) return require('./hd.cjs').buildHD(ROOT, OUT, atlasName, entries, path, fs, splitPreview)
  const sprites = []
  let ok = true
  for (const e of entries) {
    const { img } = pixelize(path.join(ROOT, 'art/raw', `${e.raw}.png`), { tol: e.tol })
    let parts = e.single ? [img] : components(img, e.gap ?? 2, e.minArea ?? 12)
    if (e.skip) parts = parts.filter((_, i) => !e.skip.includes(i))
    if (e.pick) parts = e.pick.map(i => parts[i]) // 同一张原图拆成多个条目、分别缩放时用
    // fitH：整组按同一比例缩放，让最高的那帧正好等于目标高度
    if (e.fitH) { const s = e.fitH / Math.max(...parts.map(p => p.height)); if (Math.abs(s - 1) > 0.02) parts = parts.map(p => reoutline(scaleMode(p, s))) }
    else if (e.scale) parts = parts.map(p => reoutline(scaleMode(p, e.scale)))
    if (e.alignFacing) parts = alignFacing(parts)
    const names = e.single ? [e.single] : e.names
    splitPreview(parts, path.join(ROOT, 'art/preview', `${atlasName}__${e.raw}.png`))
    if (parts.length !== names.length) {
      console.log(`  ❌ ${e.raw}: 切出 ${parts.length} 块，清单写了 ${names.length} 个名字 → 看 art/preview/${atlasName}__${e.raw}.png`)
      ok = false
      continue
    }
    parts.forEach((img, i) => {
      if (names[i] === null) return // 清单里写 null 表示丢弃这一块
      if (e.holes?.includes(names[i])) clearHoles(img, e.holesMin)
      sprites.push({ name: names[i], img, anchor: e.anchor ?? 'bottom' })
    })
    console.log(`  ✅ ${e.raw} → ${parts.length} 块 (${parts.map(p => `${p.width}×${p.height}`).join(' ')})`)
  }
  if (!sprites.length) return ok
  const sheet = pack(sprites)
  writePng(path.join(OUT, `${atlasName}.png`), sheet)
  const frames = {}
  for (const s of sprites) {
    frames[s.name] = {
      frame: { x: s.x, y: s.y, w: s.img.width, h: s.img.height },
      sourceSize: { w: s.img.width, h: s.img.height },
      spriteSourceSize: { x: 0, y: 0, w: s.img.width, h: s.img.height },
      anchor: s.anchor === 'center' ? { x: 0.5, y: 0.5 } : { x: 0.5, y: 1 },
    }
  }
  fs.writeFileSync(path.join(OUT, `${atlasName}.json`), JSON.stringify({
    frames, meta: { image: `${atlasName}.png`, format: 'RGBA8888', size: { w: sheet.width, h: sheet.height }, scale: '1' },
  }))
  console.log(`📦 ${atlasName}: ${sprites.length} 个精灵 → ${sheet.width}×${sheet.height}`)
  return ok
}

function main() {
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'art/manifest.json'), 'utf8'))
const only = process.argv.slice(2)
let allOk = true
for (const [atlas, entries] of Object.entries(manifest)) {
  if (atlas.startsWith('//') || (only.length && !only.includes(atlas))) continue
  console.log(`图集 ${atlas}`)
  allOk = buildAtlas(atlas, entries) && allOk
}
if (!allOk) process.exitCode = 1
}

if (require.main === module) main()

module.exports = { components, scaleMode, flipX }
