// 地图注册表：新地图 = 在这里加一行（类型、尺寸、种子、群系），其余全部由生成器算出来。
import type { MapDef } from './gen.ts'

export const MAPS: Record<string, MapDef> = {
  palm_isle: { id: 'palm_isle', name: '棕榈岛', kind: 'island', w: 120, h: 100, seed: 11, biome: 'tropical', settlements: 1 },
  frost_isle: { id: 'frost_isle', name: '霜岛', kind: 'island', w: 110, h: 100, seed: 23, biome: 'snow', settlements: 1 },
  ember_isle: { id: 'ember_isle', name: '余烬岛', kind: 'island', w: 100, h: 100, seed: 37, biome: 'volcanic', settlements: 0 },
  dune_isle: { id: 'dune_isle', name: '沙丘岛', kind: 'island', w: 110, h: 90, seed: 41, biome: 'desert', settlements: 1 },
  coral_reach: { id: 'coral_reach', name: '珊瑚群岛', kind: 'archipelago', w: 320, h: 240, seed: 53, biome: 'tropical', islands: 9 },
  mainland: { id: 'mainland', name: '大陆', kind: 'continent', w: 1024, h: 1024, seed: 7 },
  echo_cave: { id: 'echo_cave', name: '回声洞', kind: 'cave', w: 160, h: 140, seed: 61 },
}
