// ═══ 高清素材构建（动森方向 · 高清平滑版）═══
// 像素版（build-art.cjs 的默认流程）会先把原图还原成 1x 像素网格；高清版不做这一步：
//   原图白底 → 软边抠图（沿描边外侧估算透明度，去掉白边）→ 切块 → 按目标高度做面积平均缩小 → 打成 RES 倍密度的图集。
// 图集 json 的 meta.scale = RES，PixiJS 读进来后精灵在世界里的尺寸（美术像素）和像素版一样，游戏逻辑不用改。
//
// 清单（art/manifest.json 里名字以 _hd 结尾的图集）条目字段：
//   raw      原图名
//   names    切块按「先行后列」依次命名，null 丢弃
//   heights  每块在游戏里的高度（美术像素，和 names 一一对应）；宽度按原图比例
//   pick     只取这几块（同一张原图拆给多个条目时用）
//   gap      切块时的合并距离（原图像素，默认 6）
//   holes    被主体围住的成片白底也当背景抠掉（数值 = 最小面积，原图像素）；有白色高光的素材（眼睛、窗户）别开
const { readPng, writePng, makeImg } = require('./pixelize.cjs')

const RES = 4

const lum = (d, i) => d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114
// 近白：够亮、几乎没饱和度（画出来的奶油色、浅粉带色偏，不算）
const nearWhite = (d, i) => Math.min(d[i], d[i + 1], d[i + 2]) >= 232 && Math.max(d[i], d[i + 1], d[i + 2]) - Math.min(d[i], d[i + 1], d[i + 2]) <= 20

// ── 软边抠图 ──
// 1. 从四周 flood-fill 近白像素 = 背景（holes 打开时，成片的近白连通块也算）
// 2. 贴着背景 2 像素以内的边缘像素是「描边色 × 白」的混合：取附近最暗的非背景像素当前景色 F，
//    alpha = (255 - C) / (255 - F)，颜色直接用 F，这样缩小后边缘不会泛白
function matte(img, holes = 0) {
  const { width: W, height: H, data: d } = img
  const N = W * H
  const bg = new Uint8Array(N)
  const st = []
  const seed = p => { if (!bg[p] && nearWhite(d, p * 4)) { bg[p] = 1; st.push(p) } }
  for (let x = 0; x < W; x++) { seed(x); seed((H - 1) * W + x) }
  for (let y = 0; y < H; y++) { seed(y * W); seed(y * W + W - 1) }
  const flood = () => {
    while (st.length) {
      const p = st.pop(), x = p % W
      if (x > 0) seed(p - 1)
      if (x < W - 1) seed(p + 1)
      if (p >= W) seed(p - W)
      if (p < N - W) seed(p + W)
    }
  }
  flood()
  if (holes) {
    const seen = new Uint8Array(N)
    for (let k = 0; k < N; k++) {
      if (bg[k] || seen[k] || !nearWhite(d, k * 4)) continue
      const comp = [k], s2 = [k]; seen[k] = 1
      while (s2.length) {
        const p = s2.pop(), x = p % W
        for (const q of [x > 0 ? p - 1 : -1, x < W - 1 ? p + 1 : -1, p - W, p + W]) {
          if (q < 0 || q >= N || seen[q] || bg[q] || !nearWhite(d, q * 4)) continue
          seen[q] = 1; s2.push(q); comp.push(q)
        }
      }
      if (comp.length >= holes) for (const p of comp) bg[p] = 1
    }
  }
  // 到背景的距离（棋盘距离，最多算到 3）
  const dist = new Uint8Array(N).fill(255)
  let front = []
  for (let p = 0; p < N; p++) if (bg[p]) { dist[p] = 0; front.push(p) }
  for (let r = 1; r <= 3; r++) {
    const next = []
    for (const p of front) {
      const x = p % W, y = (p / W) | 0
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const xx = x + dx, yy = y + dy
        if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue
        const q = yy * W + xx
        if (dist[q] > r) { dist[q] = r; next.push(q) }
      }
    }
    front = next
  }
  const out = makeImg(W, H)
  const o = out.data
  for (let p = 0; p < N; p++) {
    const i = p * 4
    if (bg[p]) continue
    if (dist[p] > 2) { o[i] = d[i]; o[i + 1] = d[i + 1]; o[i + 2] = d[i + 2]; o[i + 3] = 255; continue }
    // 边缘：半径 3 内最暗的非背景像素当前景色
    const x = p % W, y = (p / W) | 0
    let best = i, bl = lum(d, i)
    for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) {
      const xx = x + dx, yy = y + dy
      if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue
      const q = yy * W + xx
      if (bg[q]) continue
      const l = lum(d, q * 4)
      if (l < bl) { bl = l; best = q * 4 }
    }
    const den = (255 - d[best]) + (255 - d[best + 1]) + (255 - d[best + 2])
    const num = (255 - d[i]) + (255 - d[i + 1]) + (255 - d[i + 2])
    const a = den < 30 ? 1 : Math.max(0, Math.min(1, num / den))
    if (a < 0.03) continue
    o[i] = d[best]; o[i + 1] = d[best + 1]; o[i + 2] = d[best + 2]; o[i + 3] = Math.round(a * 255)
  }
  return out
}

// ── 连通块切分（按 alpha > 一半），行优先排序 ──
function split(img, gap = 6, minArea = 200) {
  const { width: W, height: H, data } = img
  const N = W * H
  const solid = new Uint8Array(N)
  for (let p = 0; p < N; p++) solid[p] = data[p * 4 + 3] > 20 ? 1 : 0
  // 膨胀 gap：先按行、再按列求「gap 以内有实心像素」（可分离的方形膨胀，比逐圈膨胀快）
  const rowD = new Uint8Array(N), mask = new Uint8Array(N)
  for (let y = 0; y < H; y++) { let last = -1e9; for (let x = 0; x < W; x++) { if (solid[y * W + x]) last = x; if (x - last <= gap) rowD[y * W + x] = 1 } last = 1e9; for (let x = W - 1; x >= 0; x--) { if (solid[y * W + x]) last = x; if (last - x <= gap) rowD[y * W + x] = 1 } }
  for (let x = 0; x < W; x++) { let last = -1e9; for (let y = 0; y < H; y++) { if (rowD[y * W + x]) last = y; if (y - last <= gap) mask[y * W + x] = 1 } last = 1e9; for (let y = H - 1; y >= 0; y--) { if (rowD[y * W + x]) last = y; if (last - y <= gap) mask[y * W + x] = 1 } }
  const label = new Int32Array(N).fill(-1)
  const boxes = []
  for (let s = 0; s < N; s++) {
    if (!mask[s] || label[s] >= 0) continue
    const id = boxes.length, b = { id, x0: W, y0: H, x1: -1, y1: -1, area: 0 }
    const st = [s]; label[s] = id
    while (st.length) {
      const p = st.pop(), x = p % W, y = (p / W) | 0
      if (solid[p]) { b.area++; if (x < b.x0) b.x0 = x; if (x > b.x1) b.x1 = x; if (y < b.y0) b.y0 = y; if (y > b.y1) b.y1 = y }
      for (const q of [x > 0 ? p - 1 : -1, x < W - 1 ? p + 1 : -1, y > 0 ? p - W : -1, y < H - 1 ? p + W : -1]) if (q >= 0 && mask[q] && label[q] < 0) { label[q] = id; st.push(q) }
    }
    boxes.push(b)
  }
  const kept = boxes.filter(b => b.area >= minArea)
  kept.sort((a, b) => a.y1 - b.y1)
  const rows = []
  for (const b of kept) {
    const row = rows.find(r => Math.min(r.y1, b.y1) - Math.max(r.y0, b.y0) + 1 > 0.4 * Math.min(r.y1 - r.y0 + 1, b.y1 - b.y0 + 1))
    if (row) row.items.push(b); else rows.push({ y0: b.y0, y1: b.y1, items: [b] })
  }
  rows.sort((a, b) => a.y0 - b.y0)
  return rows.flatMap(r => r.items.sort((a, b) => a.x0 - b.x0)).map(b => {
    const w = b.x1 - b.x0 + 1, h = b.y1 - b.y0 + 1, out = makeImg(w, h)
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const p = (b.y0 + y) * W + b.x0 + x
      if (label[p] === b.id) data.copy(out.data, (y * w + x) * 4, p * 4, p * 4 + 4)
    }
    return out
  })
}

// ── 面积平均缩放（预乘 alpha，边缘不发黑不泛白）──
function resize(img, w, h) {
  const out = makeImg(w, h)
  const fx = img.width / w, fy = img.height / h
  const s = img.data, o = out.data
  for (let y = 0; y < h; y++) {
    const sy0 = y * fy, sy1 = (y + 1) * fy
    for (let x = 0; x < w; x++) {
      const sx0 = x * fx, sx1 = (x + 1) * fx
      let r = 0, g = 0, b = 0, a = 0, area = 0
      for (let sy = Math.floor(sy0); sy < Math.ceil(sy1); sy++) {
        if (sy >= img.height) break
        const wy = Math.min(sy + 1, sy1) - Math.max(sy, sy0)
        for (let sx = Math.floor(sx0); sx < Math.ceil(sx1); sx++) {
          if (sx >= img.width) break
          const wgt = wy * (Math.min(sx + 1, sx1) - Math.max(sx, sx0))
          const i = (sy * img.width + sx) * 4, al = s[i + 3] / 255 * wgt
          r += s[i] * al; g += s[i + 1] * al; b += s[i + 2] * al; a += al; area += wgt
        }
      }
      if (a <= 0) continue
      const i = (y * w + x) * 4
      o[i] = Math.round(r / a); o[i + 1] = Math.round(g / a); o[i + 2] = Math.round(b / a); o[i + 3] = Math.round(a / area * 255)
    }
  }
  return out
}

// 裁掉四周全透明的行列
function trim(img) {
  const { width: W, height: H, data } = img
  let x0 = W, y0 = H, x1 = -1, y1 = -1
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (data[(y * W + x) * 4 + 3] > 8) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y }
  if (x1 < 0) return img
  const w = x1 - x0 + 1, h = y1 - y0 + 1, out = makeImg(w, h)
  for (let y = 0; y < h; y++) data.copy(out.data, y * w * 4, ((y0 + y) * W + x0) * 4, ((y0 + y) * W + x0 + w) * 4)
  return out
}

// 货架法打包，精灵之间留 2 像素（线性过滤 + mipmap 不串色）
function pack(sprites, maxW = 4096) {
  const order = [...sprites].sort((a, b) => b.img.height - a.img.height)
  let x = 2, y = 2, rowH = 0, W = 0
  for (const s of order) {
    if (x + s.img.width + 2 > maxW) { x = 2; y += rowH + 2; rowH = 0 }
    s.x = x; s.y = y
    x += s.img.width + 2; rowH = Math.max(rowH, s.img.height); W = Math.max(W, x)
  }
  const sheet = makeImg(W, y + rowH + 2)
  for (const s of order) for (let r = 0; r < s.img.height; r++) s.img.data.copy(sheet.data, ((s.y + r) * sheet.width + s.x) * 4, r * s.img.width * 4, (r + 1) * s.img.width * 4)
  return sheet
}

function buildHD(ROOT, OUT, atlasName, entries, path, fs, preview) {
  const sprites = []
  let ok = true
  for (const e of entries) {
    const raw = readPng(path.join(ROOT, 'art/raw', `${e.raw}.png`))
    let parts = split(matte(raw, e.holes ?? 0), e.gap ?? 6, e.minArea ?? 200)
    if (e.pick) parts = e.pick.map(i => parts[i]).filter(Boolean)
    preview(parts, path.join(ROOT, 'art/preview', `${atlasName}__${e.raw}.png`))
    if (parts.length !== e.names.length) {
      console.log(`  ❌ ${e.raw}: 切出 ${parts.length} 块，清单写了 ${e.names.length} 个名字 → 看 art/preview/${atlasName}__${e.raw}.png`)
      ok = false
      continue
    }
    const sizes = []
    parts.forEach((p, i) => {
      const name = e.names[i]
      if (name === null) return
      const hh = e.heights[i]
      const h = Math.max(1, Math.round(hh * RES)), w = Math.max(1, Math.round(p.width * h / p.height))
      const img = trim(resize(p, w, h))
      sprites.push({ name, img, anchor: e.anchor ?? 'bottom' })
      sizes.push(`${(img.width / RES).toFixed(0)}×${(img.height / RES).toFixed(0)}`)
    })
    console.log(`  ✅ ${e.raw} → ${parts.length} 块（游戏尺寸 ${sizes.join(' ')}）`)
  }
  if (!sprites.length) return ok
  const sheet = pack(sprites)
  writePng(path.join(OUT, `${atlasName}.png`), sheet)
  const frames = {}
  for (const s of sprites) frames[s.name] = {
    frame: { x: s.x, y: s.y, w: s.img.width, h: s.img.height },
    sourceSize: { w: s.img.width, h: s.img.height },
    spriteSourceSize: { x: 0, y: 0, w: s.img.width, h: s.img.height },
    anchor: s.anchor === 'center' ? { x: 0.5, y: 0.5 } : { x: 0.5, y: 1 },
  }
  fs.writeFileSync(path.join(OUT, `${atlasName}.json`), JSON.stringify({
    frames, meta: { image: `${atlasName}.png`, format: 'RGBA8888', size: { w: sheet.width, h: sheet.height }, scale: String(RES) },
  }))
  console.log(`📦 ${atlasName}: ${sprites.length} 个精灵 → ${sheet.width}×${sheet.height}（${RES} 倍密度）`)
  return ok
}

module.exports = { RES, matte, split, resize, buildHD }
