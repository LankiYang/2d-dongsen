// 化石（前后端共用）：地上星形裂缝用铲子挖出来是「未鉴定的化石」，拿给馆长鉴定才知道是什么，鉴定过的能捐给博物馆或者卖掉。
// 都是真实存在的化石；价格照原作的区间（小件 1,000 上下，大型头骨 2,500～5,500）。原作是一副副骨架拆成好几块，我们先做成一件一件的。
export interface FossilDef { id: string, name: string, price: number, icon: string }

const f = (id: string, name: string, price: number): FossilDef => ({ id, name, price, icon: `fos_${id}` })

export const FOSSILS: FossilDef[] = [
  f('amber', '琥珀', 1200),
  f('ammonite', '菊石', 1100),
  f('trilobite', '三叶虫', 1300),
  f('shark_tooth', '巨齿鲨的牙齿', 1000),
  f('coprolite', '粪化石', 1100),
  f('dino_track', '恐龙足迹', 1000),
  f('fish', '古鱼化石', 1000),
  f('juramaia', '侏罗兽', 1500),
  f('archelon_skull', '古巨龟头骨', 4000),
  f('trex_skull', '霸王龙头骨', 5500),
  f('tricera_skull', '三角龙头骨', 5500),
  f('stego_tail', '剑龙尾巴', 5000),
  f('mammoth_skull', '猛犸象头骨', 3000),
  f('sabertooth_skull', '剑齿虎头骨', 2500),
  f('archaeopteryx', '始祖鸟', 1300),
  f('ptera_wing', '翼龙翅膀', 4500),
]
export const FOSSIL_BY = Object.fromEntries(FOSSILS.map(x => [x.id, x]))

// 化石点：每天最多新出 4 个，全岛最多 6 个（原作）
export const DIGS_PER_DAY = 4, DIGS_MAX = 6
