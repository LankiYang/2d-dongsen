// 后台烘焙区块地面：每块要 0.2~0.3 秒，放在主线程走路会卡。
// 主线程发 { t:'init', def } 一次，之后发 { t:'bake', cx, cy }；这边回 { t:'baked', cx, cy, ground, water }（像素缓冲转移所有权，不拷贝）。
import { World } from '../../shared/world/gen.ts'
import type { MapDef } from '../../shared/world/gen.ts'
import { bakeChunk } from '../../shared/world/bake.ts'

let world: World | null = null
self.onmessage = (e: MessageEvent) => {
  const m = e.data as { t: 'init', def: MapDef } | { t: 'bake', cx: number, cy: number }
  if (m.t === 'init') { world = new World(m.def); return }
  if (!world) return
  const b = bakeChunk(world, m.cx, m.cy)
  const ground = b.ground.buffer as ArrayBuffer, water = b.water.buffer as ArrayBuffer
  ;(self as unknown as Worker).postMessage({ t: 'baked', cx: m.cx, cy: m.cy, size: b.size, ground, water }, [ground, water])
}
