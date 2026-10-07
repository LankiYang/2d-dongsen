// 按图集里的命名顺序把精灵排成网格放大预览，控制台同时打印同顺序的名字列表，
// 用来核对「切块顺序 ↔ 清单命名」是否对得上：node tools/atlas-preview.cjs sea [--cols=8] [--scale=3]
const fs = require('fs')
const path = require('path')
const { readPng, writePng, makeImg } = require('./pixelize.cjs')

const ROOT = path.join(__dirname, '..')
const argv = process.argv.slice(2)
const name = argv.find(a => !a.startsWith('--'))
const opt = (k, d) => +(argv.find(a => a.startsWith(`--${k}=`))?.split('=')[1] ?? d)
const cols = opt('cols', 8), scale = opt('scale', 3)
const atlas = JSON.parse(fs.readFileSync(path.join(ROOT, 'public/assets', `${name}.json`), 'utf8'))
const sheet = readPng(path.join(ROOT, 'public/assets', `${name}.png`))
const frames = Object.entries(atlas.frames)
const cw = Math.max(...frames.map(([, f]) => f.frame.w)) + 4, ch = Math.max(...frames.map(([, f]) => f.frame.h)) + 4
const out = makeImg(cols * cw * scale, Math.ceil(frames.length / cols) * ch * scale)
frames.forEach(([n, f], i) => {
  const ox = (i % cols) * cw, oy = ((i / cols) | 0) * ch
  for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) {
    let c = ((x >> 2) + (y >> 2)) & 1 ? [196, 204, 196] : [226, 232, 226]
    const sx = x - 2, sy = y - 2
    if (sx >= 0 && sy >= 0 && sx < f.frame.w && sy < f.frame.h) {
      const s = ((f.frame.y + sy) * sheet.width + f.frame.x + sx) * 4
      if (sheet.data[s + 3]) c = [sheet.data[s], sheet.data[s + 1], sheet.data[s + 2]]
    }
    for (let yy = 0; yy < scale; yy++) for (let xx = 0; xx < scale; xx++) {
      const o = (((oy + y) * scale + yy) * out.width + (ox + x) * scale + xx) * 4
      out.data[o] = c[0]; out.data[o + 1] = c[1]; out.data[o + 2] = c[2]; out.data[o + 3] = 255
    }
  }
})
writePng(path.join(ROOT, 'art/preview', `atlas_${name}.png`), out)
frames.forEach(([n, f], i) => process.stdout.write(`${i % cols === 0 ? '\n' : ''}${String(i).padStart(2)}:${n}(${f.frame.w}×${f.frame.h})  `))
console.log()
