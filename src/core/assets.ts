// 资源加载：精灵图集 + 运行时生成的程序纹理（光斑、阴影、耕地、换色角色）
import { Assets, CanvasSource, Rectangle, Texture } from 'pixi.js'
import type { Spritesheet } from 'pixi.js'
import { SHIRT_HUES, TILE } from '../../shared/data.ts'
import { HD } from '../acstyle.ts'

export interface Atlas { [name: string]: Texture }

export interface GameAssets {
  island: Atlas
  crops: Atlas
  sea: Atlas
  icons: Atlas
  chars: Atlas
  npcs: Atlas
  decor: Atlas
  interior: Atlas
  furniture: Atlas
  portraits: Atlas
  farmers: Map<number, Atlas>          // 按衬衫色相换过色的农夫帧
  light: Texture
  cone: Texture
  soil: { dry: Texture[], wet: Texture[] }  // 下标 = 四邻接掩码（上1 右2 下4 左8）
  shadow: (w: number) => Texture
  atlasMeta: Record<string, { image: string, size?: { w: number, h: number }, frames: Record<string, { frame: { x: number, y: number, w: number, h: number } }> }>
  icons_hd: Atlas
  bgReef: Texture
  bgDeep: Texture
}

async function loadSheet(name: string): Promise<{ atlas: Atlas, meta: any }> {
  const sheet = await Assets.load<Spritesheet>(`/assets/${name}.json`)
  return { atlas: sheet.textures as Atlas, meta: sheet.data }
}

// 高清图集（动森方向 · 高清平滑画风，tools/hd.cjs 打包，4 倍密度）：同名精灵覆盖像素版。
// 线性过滤 + mipmap，缩小看时不闪。还没出高清图集的就继续用像素版
const HD_ATLASES = ['island']
async function loadHD(name: string, into: Atlas) {
  try {
    const { atlas } = await loadSheet(`${name}_hd`)
    const src = Object.values(atlas)[0]?.source
    if (src) {
      src.scaleMode = 'linear'
      src.autoGenerateMipmaps = true
      src.mipLevelCount = Math.floor(Math.log2(Math.max(src.pixelWidth, src.pixelHeight))) + 1
    }
    Object.assign(into, atlas)
  } catch (e) {
    console.warn(`高清图集 ${name}_hd 没有加载`, e)
  }
}

export function texFrom(c: HTMLCanvasElement, scaleMode: 'nearest' | 'linear' = 'nearest'): Texture {
  return new Texture({ source: new CanvasSource({ resource: c, scaleMode }) })
}

export function canvas(w: number, h: number) {
  const c = document.createElement('canvas')
  c.width = w; c.height = h
  return { c, g: c.getContext('2d')! }
}

// 柔和光斑（给光照图用，线性过滤，放大后依然平滑）
function makeLight(): Texture {
  const { c, g } = canvas(128, 128)
  const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64)
  grd.addColorStop(0, 'rgba(255,255,255,1)')
  grd.addColorStop(0.35, 'rgba(255,255,255,0.55)')
  grd.addColorStop(1, 'rgba(255,255,255,0)')
  g.fillStyle = grd
  g.fillRect(0, 0, 128, 128)
  return texFrom(c, 'linear')
}

// 手电筒光锥：原点在左侧中点，朝右张开
function makeCone(): Texture {
  const { c, g } = canvas(256, 160)
  for (let x = 0; x < 256; x++) for (let y = 0; y < 160; y++) {
    const dx = x, dy = y - 80
    const ang = Math.abs(Math.atan2(dy, dx))
    const edge = Math.max(0, 1 - ang / 0.42)
    const fall = Math.max(0, 1 - dx / 256)
    const a = Math.pow(edge, 0.8) * Math.pow(fall, 1.2) * (dx < 8 ? dx / 8 : 1)
    if (a <= 0) continue
    g.fillStyle = `rgba(255,255,255,${a.toFixed(3)})`
    g.fillRect(x, y, 1, 1)
  }
  return texFrom(c, 'linear')
}

// 像素硬边椭圆阴影
const shadowCache = new Map<number, Texture>()
function makeShadow(w: number): Texture {
  w = Math.max(6, Math.round(w / 2) * 2)
  const hit = shadowCache.get(w)
  if (hit) return hit
  const h = Math.max(3, Math.round(w * 0.32))
  if (HD) {
    // 高清模式：4 倍密度的软边椭圆，边缘羽化
    const R = 4
    const { c, g } = canvas(w * R, h * R)
    g.translate(w * R / 2, h * R / 2)
    g.scale(1, h / w)
    const grd = g.createRadialGradient(0, 0, 0, 0, 0, w * R / 2)
    grd.addColorStop(0, 'rgba(20,24,40,0.30)')
    grd.addColorStop(0.7, 'rgba(20,24,40,0.26)')
    grd.addColorStop(1, 'rgba(20,24,40,0)')
    g.fillStyle = grd
    g.beginPath(); g.arc(0, 0, w * R / 2, 0, Math.PI * 2); g.fill()
    const t = new Texture({ source: new CanvasSource({ resource: c, scaleMode: 'linear', resolution: R }), defaultAnchor: { x: 0.5, y: 0.5 } })
    shadowCache.set(w, t)
    return t
  }
  const { c, g } = canvas(w, h)
  g.fillStyle = 'rgba(20,24,40,0.30)'
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const nx = (x + 0.5 - w / 2) / (w / 2), ny = (y + 0.5 - h / 2) / (h / 2)
    if (nx * nx + ny * ny <= 1) g.fillRect(x, y, 1, 1)
  }
  const t = new Texture({ source: new CanvasSource({ resource: c, scaleMode: 'nearest' }), defaultAnchor: { x: 0.5, y: 0.5 } })
  shadowCache.set(w, t)
  return t
}

// 程序生成耕地：按四邻接掩码画出连成一片的田垄，边缘圆角、上沿高光、下沿阴影
function makeSoil(wet: boolean): Texture[] {
  const pal = wet
    ? { base: [92, 58, 38], dark: [70, 43, 29], light: [118, 78, 50], edge: [52, 32, 22] }
    : { base: [150, 101, 62], dark: [124, 80, 48], light: [178, 126, 80], edge: [96, 62, 38] }
  const out: Texture[] = []
  for (let mask = 0; mask < 16; mask++) {
    const { c, g } = canvas(TILE, TILE)
    const up = mask & 1, right = mask & 2, down = mask & 4, left = mask & 8
    const img = g.createImageData(TILE, TILE)
    const put = (x: number, y: number, col: number[]) => {
      const i = (y * TILE + x) * 4
      img.data[i] = col[0]; img.data[i + 1] = col[1]; img.data[i + 2] = col[2]; img.data[i + 3] = 255
    }
    const inset = 1
    for (let y = 0; y < TILE; y++) for (let x = 0; x < TILE; x++) {
      const x0 = left ? 0 : inset, x1 = right ? TILE - 1 : TILE - 1 - inset
      const y0 = up ? 0 : inset, y1 = down ? TILE - 1 : TILE - 1 - inset
      if (x < x0 || x > x1 || y < y0 || y > y1) continue
      // 圆角：两个不相连的边相交处切掉一个像素角
      const cornerCut = (!left && !up && x === x0 && y === y0) || (!right && !up && x === x1 && y === y0) ||
        (!left && !down && x === x0 && y === y1) || (!right && !down && x === x1 && y === y1)
      if (cornerCut) continue
      let col = pal.base
      // 田垄：每 6 像素一道横向垄沟
      const row = (y + 2) % 6
      if (row === 0) col = pal.dark
      else if (row === 1) col = pal.light
      // 零星土粒
      const h = ((x * 73856093) ^ (y * 19349663) ^ (mask * 83492791)) >>> 0
      if (h % 23 === 0) col = pal.dark
      else if (h % 29 === 0) col = pal.light
      // 外沿
      if ((!up && y === y0) || (!left && x === x0)) col = pal.light
      if ((!down && y === y1) || (!right && x === x1)) col = pal.edge
      put(x, y, col)
    }
    g.putImageData(img, 0, 0)
    out.push(texFrom(c, 'nearest'))
  }
  return out
}

// 给农夫换衬衫颜色：把青绿色（色相 150~200°）的像素整体旋转到目标色相
async function recolorFarmers(meta: any): Promise<Map<number, Atlas>> {
  const img = await (await fetch(`/assets/${meta.meta.image}`)).blob().then(createImageBitmap)
  const { c: base, g: bg } = canvas(img.width, img.height)
  bg.drawImage(img, 0, 0)
  const src = bg.getImageData(0, 0, img.width, img.height)
  const out = new Map<number, Atlas>()
  const baseHue = 180
  for (const hue of SHIRT_HUES) {
    const { c, g } = canvas(img.width, img.height)
    const data = new ImageData(new Uint8ClampedArray(src.data), img.width, img.height)
    if (hue !== baseHue) {
      for (let i = 0; i < data.data.length; i += 4) {
        if (!data.data[i + 3]) continue
        const [h, s, l] = rgb2hsl(data.data[i], data.data[i + 1], data.data[i + 2])
        if (h >= 150 && h <= 205 && s > 0.2) {
          const [r, gg, b] = hsl2rgb(((h - baseHue + hue) % 360 + 360) % 360, Math.min(1, s * 1.05), l)
          data.data[i] = r; data.data[i + 1] = gg; data.data[i + 2] = b
        }
      }
    }
    g.putImageData(data, 0, 0)
    const source = texFrom(c, 'nearest').source
    const atlas: Atlas = {}
    for (const [name, f] of Object.entries<any>(meta.frames)) {
      const t = new Texture({ source, frame: new Rectangle(f.frame.x, f.frame.y, f.frame.w, f.frame.h), defaultAnchor: { x: f.anchor?.x ?? 0.5, y: f.anchor?.y ?? 1 } })
      atlas[name] = t
    }
    out.set(hue, atlas)
  }
  void base
  return out
}

function rgb2hsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255; g /= 255; b /= 255
  const max = Math.max(r, g, b), min = Math.min(r, g, b)
  const l = (max + min) / 2
  if (max === min) return [0, 0, l]
  const d = max - min
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  let h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4
  return [h * 60, s, l]
}
function hsl2rgb(h: number, s: number, l: number): [number, number, number] {
  const k = (n: number) => (n + h / 30) % 12
  const a = s * Math.min(l, 1 - l)
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)))
  return [Math.round(f(0) * 255), Math.round(f(8) * 255), Math.round(f(4) * 255)]
}

// 远景背景图：AI 生成的整幅场景，缩小一半并把上下边缘羽化成透明，方便叠在水色渐变上
async function loadBackdrop(url: string): Promise<Texture> {
  const img = await (await fetch(url)).blob().then(createImageBitmap)
  const w = Math.round(img.width / 2), h = Math.round(img.height / 2)
  const { c, g } = canvas(w, h)
  g.imageSmoothingEnabled = true
  g.drawImage(img, 0, 0, w, h)
  const data = g.getImageData(0, 0, w, h)
  for (let y = 0; y < h; y++) {
    const a = Math.min(1, y / (h * 0.35)) * Math.min(1, (h - y) / (h * 0.08))
    for (let x = 0; x < w; x++) {
      const e = Math.min(1, x / (w * 0.06), (w - x) / (w * 0.06))
      data.data[(y * w + x) * 4 + 3] *= a * e
    }
  }
  g.putImageData(data, 0, 0)
  return texFrom(c, 'nearest')
}

export async function loadAssets(onProgress: (p: number) => void): Promise<GameAssets> {
  const names = ['island', 'crops', 'sea', 'icons', 'chars', 'npcs', 'portraits', 'decor', 'interior', 'furniture', 'icons_hd'] as const
  const loaded: Record<string, { atlas: Atlas, meta: any }> = {}
  let done = 0
  await Promise.all(names.map(async n => { loaded[n] = await loadSheet(n); onProgress(++done / (names.length + 3)) }))
  if (HD) await Promise.all(HD_ATLASES.map(n => loadHD(n, loaded[n].atlas)))
  { const src = Object.values(loaded.icons_hd.atlas)[0]?.source; if (src) src.scaleMode = 'linear' }
  const farmers = await recolorFarmers(loaded.chars.meta)
  onProgress(++done / (names.length + 3))
  const [bgReef, bgDeep] = await Promise.all([loadBackdrop('/assets/bg_reef.png'), loadBackdrop('/assets/bg_deep.png')])
  onProgress(1)
  return {
    island: loaded.island.atlas, crops: loaded.crops.atlas, sea: loaded.sea.atlas, icons: loaded.icons.atlas, chars: loaded.chars.atlas, npcs: loaded.npcs.atlas, portraits: loaded.portraits.atlas, decor: loaded.decor.atlas, interior: loaded.interior.atlas, furniture: loaded.furniture.atlas,
    farmers,
    light: makeLight(),
    cone: makeCone(),
    soil: { dry: makeSoil(false), wet: makeSoil(true) },
    shadow: makeShadow,
    icons_hd: loaded.icons_hd.atlas,
    atlasMeta: Object.fromEntries(names.map(n => [n, { image: loaded[n].meta.meta.image, size: loaded[n].meta.meta.size, frames: loaded[n].meta.frames }])),
    bgReef, bgDeep,
  }
}
