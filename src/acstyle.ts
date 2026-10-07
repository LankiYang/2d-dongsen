// 动森画风开关（animal-crossing 分支）：2026-09-30 用户定了「粉嫩圆润版」，这个分支默认就是新画风；
// 网址加 ?oldstyle 显示星露谷方向的旧画风，用来对照。等旧素材全部按新画风重做完，这个开关和 acKind 的替换表就删掉。
// 注意：已经重做的素材（自然物件等）直接替换了原来的名字，?oldstyle 下也是新图，只有地形配色、水色、界面和下面这张表会切回旧的。
export const AC_STYLE = typeof location === 'undefined' || !new URLSearchParams(location.search).has('oldstyle')
// 高清平滑画风（2026-09-30 用户改定：不要像素颗粒）：陆地场景按屏幕分辨率渲染，见 core/pixelview.ts。海底不变，还是像素
export const HD = AC_STYLE
// 世界坐标取整：像素模式下角色要落在美术像素上，高清模式不取整（否则镜头平滑滚动时角色会一格一格抖）
export const snap = (v: number) => HD ? v : Math.round(v)

// 还没重做的物件先用样图顶上（art/raw/ac_*.png → island 图集里的 ac_*）
export function acKind(kind: string, _x: number, _y: number): string {
  if (!AC_STYLE) return kind
  const map: Record<string, string> = {
    house: 'ac_house', house_thatch: 'ac_house', house_blue: 'ac_house', house_stilt: 'ac_house', house_stone: 'ac_house',
  }
  return map[kind] ?? kind
}
