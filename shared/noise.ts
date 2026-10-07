// 确定性噪声：服务端和客户端必须对同一坐标算出同一个值，
// 地图形状、海底地形、装饰物摆放都依赖它，所以不能用 Math.random

export function hash2(x: number, y: number, seed = 0): number {
  let h = (x | 0) * 374761393 + (y | 0) * 668265263 + seed * 1442695041
  h = (h ^ (h >>> 13)) * 1274126177
  h = h ^ (h >>> 16)
  return (h >>> 0) / 4294967296
}

function smooth(t: number) { return t * t * (3 - 2 * t) }

export function valueNoise(x: number, y: number, seed = 0): number {
  const x0 = Math.floor(x), y0 = Math.floor(y)
  const fx = smooth(x - x0), fy = smooth(y - y0)
  const a = hash2(x0, y0, seed), b = hash2(x0 + 1, y0, seed)
  const c = hash2(x0, y0 + 1, seed), d = hash2(x0 + 1, y0 + 1, seed)
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy
}

// 分形噪声，输出约在 [0,1]
export function fbm(x: number, y: number, seed = 0, octaves = 4): number {
  let sum = 0, amp = 0.5, norm = 0
  for (let i = 0; i < octaves; i++) {
    sum += valueNoise(x, y, seed + i * 17) * amp
    norm += amp
    x *= 2; y *= 2; amp *= 0.5
  }
  return sum / norm
}

// 可复现的伪随机序列（摆放装饰、生成鱼群用）
export function rng(seed: number) {
  let s = seed >>> 0 || 1
  return () => {
    s ^= s << 13; s >>>= 0
    s ^= s >>> 17
    s ^= s << 5; s >>>= 0
    return s / 4294967296
  }
}
