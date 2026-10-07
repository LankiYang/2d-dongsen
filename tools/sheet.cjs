// 拼接对比图（肉眼验收用）：node tools/sheet.cjs out.png a.png b.png ... [--cell=256] [--cols=4]
const path = require('path')
const { readPng, writePng, makeImg } = require('./pixelize.cjs')

const argv = process.argv.slice(2)
const opt = (k, d) => +(argv.find(a => a.startsWith(`--${k}=`))?.split('=')[1] ?? d)
const [out, ...files] = argv.filter(a => !a.startsWith('--'))
const cell = opt('cell', 256), cols = opt('cols', 4)
const rows = Math.ceil(files.length / cols)
const sheet = makeImg(cols * cell, rows * cell)
files.forEach((f, i) => {
  const img = readPng(f)
  const s = Math.min((cell - 8) / img.width, (cell - 8) / img.height)
  const w = Math.max(1, Math.floor(img.width * s)), h = Math.max(1, Math.floor(img.height * s))
  const ox = (i % cols) * cell + ((cell - w) >> 1), oy = ((i / cols) | 0) * cell + ((cell - h) >> 1)
  for (let y = 0; y < cell; y++) for (let x = 0; x < cell; x++) {
    const o = ((((i / cols) | 0) * cell + y) * sheet.width + (i % cols) * cell + x) * 4
    const v = ((x >> 4) + (y >> 4)) & 1 ? 190 : 220
    sheet.data[o] = v; sheet.data[o + 1] = v; sheet.data[o + 2] = v; sheet.data[o + 3] = 255
  }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const si = (Math.floor(y / s) * img.width + Math.floor(x / s)) * 4
    const o = ((oy + y) * sheet.width + ox + x) * 4, a = img.data[si + 3] / 255
    for (let c = 0; c < 3; c++) sheet.data[o + c] = img.data[si + c] * a + sheet.data[o + c] * (1 - a)
  }
})
writePng(path.resolve(out), sheet)
console.log(`${out}: ${files.length} 张`)
