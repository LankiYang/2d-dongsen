// 通用地图：地形与生物群系注册表。
// 新地貌 = 在这里加一种地形（画法 + 调色板）和/或一个群系（地面用什么地形、撒什么植被），渲染代码不用改。

export const CHUNK = 32 // 区块边长（地块）

// ── 地形 ──
// style 决定逐像素画法；pal 是 5 档由暗到亮的手调调色板
export type PaintStyle = 'grass' | 'speckle' | 'path' | 'wood' | 'ice' | 'lava' | 'wall' | 'water'
export interface TerrainDef {
  key: string
  name: string
  style: PaintStyle
  pal: number[]
  walk: boolean        // 能不能走
  water?: boolean      // 水面着色器负责画（地面层透明）
  raised?: boolean     // 比周围高一截：下沿画深色唇边 + 往下投影
  tufts?: number       // grass 画法的草簇密度
  flowers?: number[]   // 零星小花的颜色
  till?: boolean       // 能不能锄地
}

const TERRAIN_LIST: TerrainDef[] = [
  { key: 'deep', name: '深水', style: 'water', pal: [], walk: false, water: true },
  { key: 'shallow', name: '浅水', style: 'water', pal: [], walk: false, water: true },
  { key: 'sand', name: '沙滩', style: 'speckle', pal: [0xc4a068, 0xd6b87e, 0xe4ca93, 0xefdba8, 0xf7e9c2], walk: true },
  { key: 'grass', name: '热带草地', style: 'grass', pal: [0x3f7431, 0x4f8a37, 0x5f9e3e, 0x71b046, 0x86c451], walk: true, raised: true, tufts: 0.5, flowers: [0xf4f1e0, 0xf6d65a, 0xf08bb0, 0xa9c8ff], till: true },
  { key: 'meadow', name: '温带草甸', style: 'grass', pal: [0x4f6e2c, 0x648437, 0x7a9a40, 0x92b04e, 0xabc562], walk: true, raised: true, tufts: 0.45, flowers: [0xf4f1e0, 0xe9d36a, 0xc9a2e8], till: true },
  { key: 'forest', name: '林地', style: 'grass', pal: [0x28462a, 0x335a33, 0x3f6c3a, 0x4d7f43, 0x5f934e], walk: true, raised: true, tufts: 0.6, flowers: [0xd8c7a0] },
  { key: 'farm', name: '农田', style: 'grass', pal: [0x46712f, 0x557f34, 0x64903b, 0x739f43, 0x86b04f], walk: true, raised: true, tufts: 0.25, till: true },
  { key: 'snow', name: '雪地', style: 'grass', pal: [0x9db2c6, 0xd2dfe9, 0xdde8f0, 0xe9f1f7, 0xffffff], walk: true, raised: true, tufts: 0.15 },
  { key: 'desert', name: '沙漠', style: 'speckle', pal: [0xc08a50, 0xd29c5c, 0xe0b06c, 0xebc281, 0xf5d59a], walk: true },
  { key: 'gravel', name: '碎石滩', style: 'speckle', pal: [0x6d6a66, 0x86827b, 0x9d988f, 0xb3ada2, 0xcac4b8], walk: true },
  { key: 'basalt', name: '玄武岩', style: 'speckle', pal: [0x2a2427, 0x3a3236, 0x4a4045, 0x5b5055, 0x6f6368], walk: true },
  { key: 'path', name: '泥土路', style: 'path', pal: [0x7e5638, 0x946844, 0xa97b50, 0xbb8f60, 0xcca273], walk: true },
  { key: 'bridge', name: '木桥', style: 'wood', pal: [0x4a2e1b, 0x6b4428, 0x8a5a34, 0xa36d40, 0xbd8552], walk: true },
  { key: 'ice', name: '冰面', style: 'ice', pal: [0x7fb2d4, 0x9ccbe6, 0xb9ddf0, 0xd4ecf7, 0xf0faff], walk: true },
  { key: 'lava', name: '熔岩', style: 'lava', pal: [0x7a1a0c, 0xb8320f, 0xe8601a, 0xffa032, 0xffe07a], walk: false },
  { key: 'cave', name: '洞穴地面', style: 'speckle', pal: [0x2b2530, 0x383040, 0x463c4e, 0x54495c, 0x655a6c], walk: true },
  { key: 'cavewall', name: '岩壁', style: 'wall', pal: [0x16121a, 0x241e2a, 0x3a3242, 0x51475a, 0x6d6276], walk: false, raised: true },
]
export const TERRAIN = TERRAIN_LIST
export const TID: Record<string, number> = Object.fromEntries(TERRAIN_LIST.map((t, i) => [t.key, i]))
export const terrainOf = (id: number) => TERRAIN_LIST[id]

// ── 散布规则 ──
// spacing：抖动网格的格子边长（地块），每格最多一个候选；chance：候选落地概率；
// clear：离道路/建筑至少多远；on：只长在这些地形上；tier：大的先摆，小的要避开大的
export interface Scatter {
  kinds: string[]
  spacing: number
  chance: number
  clear: number
  on: string[]
  tier: number
  sway?: number
  solid?: boolean
  shore?: boolean      // 只长在离水近的地方
  inland?: boolean     // 只长在离水远的地方
}

// ── 群系 ──
export interface BiomeDef {
  key: string
  name: string
  ground: string       // 主地面
  shore: string        // 海岸
  water?: string       // 水面换成什么（雪原的湖结冰）
  house?: string[]     // 村子里用的房子样式（图集帧名）
  scatter: Scatter[]
}

const S = (kinds: string[], spacing: number, chance: number, on: string[], tier: number, o: Partial<Scatter> = {}): Scatter =>
  ({ kinds, spacing, chance, on, tier, clear: tier >= 2 ? 1.6 : tier === 1 ? 1 : 0.5, solid: tier >= 1, ...o })

export const BIOMES: Record<string, BiomeDef> = {
  tropical: {
    key: 'tropical', name: '热带', ground: 'grass', shore: 'sand',
    house: ['house_thatch', 'house_blue', 'house_stilt', 'house_stone'],
    scatter: [
      S(['palm_a', 'palm_b'], 5, 0.55, ['sand', 'grass'], 2, { sway: 1, shore: true }),
      S(['tree_round', 'tree_mango'], 6, 0.35, ['grass'], 2, { sway: 0.5, inland: true }),
      S(['banana'], 7, 0.25, ['grass'], 2, { sway: 0.8 }),
      S(['bush_hibiscus', 'bush_bougain', 'shrub', 'fern'], 4, 0.3, ['grass'], 1, { sway: 0.4 }),
      S(['boulder', 'rock_moss'], 9, 0.2, ['grass'], 1),
      S(['grass_tall'], 2.5, 0.22, ['grass'], 0, { sway: 1, solid: false }),
      S(['conch', 'starfish', 'driftwood', 'pebbles'], 4, 0.18, ['sand'], 0, { solid: false, shore: true }),
    ],
  },
  meadow: {
    key: 'meadow', name: '温带草原', ground: 'meadow', shore: 'sand',
    house: ['house_thatch', 'house_stone'],
    scatter: [
      S(['tree_round'], 7, 0.3, ['meadow'], 2, { sway: 0.5 }),
      S(['shrub', 'fern'], 4, 0.25, ['meadow'], 1, { sway: 0.4 }),
      S(['boulder', 'rock_moss'], 8, 0.25, ['meadow'], 1),
      S(['grass_tall'], 2.2, 0.35, ['meadow'], 0, { sway: 1, solid: false }),
      S(['pebbles', 'driftwood'], 5, 0.12, ['sand'], 0, { solid: false, shore: true }),
    ],
  },
  forest: {
    key: 'forest', name: '森林', ground: 'forest', shore: 'gravel',
    house: ['house_stone', 'house_thatch'],
    scatter: [
      S(['pine', 'tree_round'], 3.2, 0.7, ['forest'], 2, { sway: 0.4 }),
      S(['fern', 'shrub', 'mushroom'], 3, 0.35, ['forest'], 1, { sway: 0.4 }),
      S(['rock_moss', 'stump'], 7, 0.25, ['forest'], 1),
      S(['pebbles'], 4, 0.2, ['gravel'], 0, { solid: false }),
    ],
  },
  snow: {
    key: 'snow', name: '雪原', ground: 'snow', shore: 'gravel', water: 'ice',
    house: ['house_stone'],
    scatter: [
      S(['pine_snow'], 4, 0.5, ['snow'], 2, { sway: 0.3 }),
      S(['snow_rock', 'ice_crystal'], 8, 0.25, ['snow', 'gravel'], 1),
      S(['snow_shrub'], 4, 0.2, ['snow'], 1, { sway: 0.3 }),
      S(['pebbles'], 5, 0.15, ['gravel'], 0, { solid: false }),
    ],
  },
  desert: {
    key: 'desert', name: '沙漠', ground: 'desert', shore: 'sand',
    house: ['house_stone'],
    scatter: [
      S(['cactus', 'cactus_tall'], 6, 0.4, ['desert'], 2, { sway: 0 }),
      S(['palm_a', 'palm_b'], 4, 0.6, ['desert', 'sand'], 2, { sway: 1, shore: true }),
      S(['desert_rock', 'boulder'], 8, 0.3, ['desert'], 1),
      S(['dry_bush', 'bones'], 5, 0.2, ['desert'], 0, { solid: false }),
    ],
  },
  volcanic: {
    key: 'volcanic', name: '火山', ground: 'basalt', shore: 'gravel',
    scatter: [
      S(['dead_tree'], 8, 0.3, ['basalt'], 2),
      S(['lava_rock', 'boulder'], 5, 0.35, ['basalt'], 1),
      S(['obsidian', 'ember_vent'], 7, 0.2, ['basalt'], 1),
    ],
  },
  cave: {
    key: 'cave', name: '洞穴', ground: 'cave', shore: 'cave',
    scatter: [
      S(['stalagmite', 'stalagmite_big'], 5, 0.4, ['cave'], 2),
      S(['crystal_blue', 'crystal_pink', 'ore_copper', 'ore_iron'], 6, 0.3, ['cave'], 1),
      S(['mushroom_glow', 'cave_rock', 'bones'], 3.5, 0.3, ['cave'], 0, { solid: false }),
    ],
  },
}

// 预览工具用：还没有美术素材的新物件先画成色块
export const PLACEHOLDER: Record<string, number> = {
  pine: 0x2f5a36, pine_snow: 0xdfeaf2, mushroom: 0xc4523c, stump: 0x6b4428, snow_rock: 0xc9d3dd, ice_crystal: 0x9fe0ff, snow_shrub: 0xb6c7b8,
  cactus: 0x4f8a3a, cactus_tall: 0x3f7a32, desert_rock: 0xb07a48, dry_bush: 0x9a7a4a, bones: 0xe8e0cc, dead_tree: 0x3a2e2a, lava_rock: 0x5a3030,
  obsidian: 0x201a2a, ember_vent: 0xff7a2a, stalagmite: 0x6a5f72, stalagmite_big: 0x7a6e82, crystal_blue: 0x6fd6ff, crystal_pink: 0xff8fd8,
  ore_copper: 0xd07a3a, ore_iron: 0x9aa0a8, mushroom_glow: 0x7affd0, cave_rock: 0x4a4052,
}
