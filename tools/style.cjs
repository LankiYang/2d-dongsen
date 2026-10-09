// ═══ 潮汐港 · 美术圣经（所有生图 prompt 的风格来源）═══
// 所有素材都必须从这里拼风格后缀，不要在任务文件里另写一套风格描述，
// 否则同一个世界里会混进好几种画风。

// 抠图素材的背景要求：必须纯平纯白、四角等亮。模型容易偷偷加暗角，
// pixelize.cjs 从四周取背景色做 flood-fill，背景不干净会把浅色主体一起抠掉。
const WHITE_BG =
  'THE BACKGROUND MUST BE PURE FLAT SOLID WHITE (#FFFFFF), identical in every corner and along every edge. ' +
  'No vignette, no gradient, no floor, no cast shadow on the background, no text, no border, no frame.'

// 画风内核：现代独立游戏的 hi-bit 像素风——温暖、饱和、层次清楚
const CORE =
  'high quality hand-crafted pixel art in the style of a modern cozy indie game, ' +
  'crisp hard-edged square pixels on a strict grid, absolutely no anti-aliasing, no blur, no gradients inside pixels, ' +
  'limited harmonious palette, warm saturated colors, clean 1-pixel dark outline tinted with the local color (never pure black), ' +
  'soft light coming from the top-left, readable silhouette'

// 陆地物件：3/4 俯视（农场游戏的标准视角）
const LAND = `${CORE}, three-quarter top-down view like a farming game, grounded object`
// 水下生物：纯侧视、朝右
const SEA = `${CORE}, pure side view, facing right, underwater creature`
// 图标：正面、居中、厚实
const ICON = `${CORE}, single inventory icon, centered, chunky and readable at small size`
// 大场景/远景：不抠图
const SCENE =
  'beautiful detailed pixel art game background, modern indie game quality, rich atmospheric lighting, ' +
  'crisp pixels, no text, no UI, no characters'

// ═══ 动森方向（animal-crossing 分支，2026-09-30 用户定稿：粉嫩圆润版）═══
// 这个分支的新素材一律用 AC_*；上面的 CORE / LAND / SEA / ICON / SCENE 是星露谷方向的旧风格，只在对照时用。
// 观感：粉嫩、圆滚滚、像玩具，明亮干净、留白多，嫩绿草地、清透的海、柔和阴影、淡描边，花和果树多
const AC_CORE =
  'high quality pixel art for a bright, gentle, cozy island-life game, extra soft, round and toy-like: ' +
  'chunky rounded shapes with soft bulgy volumes and rounded corners everywhere, ' +
  'a soft pastel palette that is still fresh and cheerful (light apple and mint greens, sky and turquoise blues, cream, peach, coral pink, lemon yellow, lavender), ' +
  'soft even daylight with gentle soft shadows, thin soft outlines tinted with the local color (never black, never harsh), ' +
  'minimal dithering, simple clean surfaces instead of busy texture, uncluttered and readable, ' +
  'crisp square pixels on a strict grid, absolutely no anti-aliasing, no blur'
// 角色的通用比例：Q 版大头
const AC_CHIBI =
  'cute chibi proportions: a big round head about half of the total height, a small round body, short limbs, ' +
  'simple friendly face with small dot eyes with a tiny highlight and soft rosy cheeks'
const AC_LAND = `${AC_CORE}, three-quarter top-down view like a cozy life-sim game, grounded object`
const AC_ICON = `${AC_CORE}, single inventory icon, centered, chunky and readable at small size`
const AC_SCENE =
  'beautiful pixel art key art for a cozy island-life game, ' + AC_CORE +
  ', calm clean composition with generous open grass and breathing space, no text, no UI'

const AC_CHAR = `${AC_CORE}, ${AC_CHIBI}`

// ═══ 动森方向 · 高清平滑版（2026-09-30 用户改定：画面不要像素颗粒）═══
// 从这里起新素材一律用 HD_*（上面的 AC_* 是像素版的粉嫩圆润，已停用）。
// 抠图靠「白底 + 整圈描边」：描边把主体和白底隔开，构建时沿描边外侧做软边抠图，所以描边必须闭合、粗细均匀。
const HD_CORE =
  'clean smooth 2D cartoon game art for a bright, gentle, cozy island-life game, NOT pixel art, no pixels at all: ' +
  'smooth anti-aliased vector-like shapes, extra soft, round and toy-like, chunky rounded shapes with soft bulgy volumes and rounded corners everywhere, ' +
  'a soft pastel palette that is still fresh and cheerful (light apple and mint greens, sky and turquoise blues, cream, peach, coral pink, lemon yellow, lavender), ' +
  'flat colors with gentle soft cel shading (one soft shadow tone and one soft highlight per surface) and very subtle smooth gradients, soft even daylight from the top-left, ' +
  'a clean smooth closed outline of even medium thickness around the whole silhouette, tinted a darker shade of the local color (never black), thinner soft inner lines, ' +
  'simple clean surfaces, no texture noise, no grain, no dithering, uncluttered and readable'
// 视角：正视角（2026-10-09 用户纠正：我们是正视角，不是等轴侧）。正面平行于屏幕，顶面只露出窄窄一条，看不到侧面，没有透视
const HD_LAND = `${HD_CORE}, straight front view like a classic 2D top-down RPG such as Stardew Valley: the front face is flat and parallel to the screen, the top seen slightly from above as a thin strip, symmetric, no side faces visible, no perspective, NOT isometric, NOT three-quarter, NOT seen from a corner, grounded object`
const HD_ICON = `${HD_CORE}, single inventory icon, centered, chunky and readable at small size`
const HD_SCENE =
  'beautiful smooth 2D key art for a cozy island-life game, ' + HD_CORE +
  ', calm clean composition with generous open grass and breathing space, no text, no UI'
const HD_CHAR = `${HD_CORE}, ${AC_CHIBI}`

const STYLES = { LAND, SEA, ICON, SCENE, CORE, AC_CORE, AC_LAND, AC_ICON, AC_SCENE, AC_CHAR, HD_CORE, HD_LAND, HD_ICON, HD_SCENE, HD_CHAR }

// sizeHint 会写进 prompt，告诉模型目标像素网格大概多大
function buildPrompt(job) {
  const style = STYLES[job.style] ?? job.style ?? CORE
  const grid = job.grid ? `, drawn on a ${job.grid} pixel grid so each art pixel is a large visible square` : ''
  const bg = job.bg === 'scene' ? '' : ` ${WHITE_BG}`
  // 高清版拿像素样图当参考时只借造型和配色，画法不能跟着变回像素
  const hd = /^HD_/.test(job.style ?? '')
  const ref = !job.refs?.length ? ''
    : hd ? 'Use the reference image(s) only for the designs, shapes and colors: redraw them in the smooth non-pixel style described below, do not copy any pixel look. '
    : 'Match the exact art style, palette, outline treatment and pixel size of the reference image(s). '
  return `${ref}${job.prompt}. ${style}${grid}.${bg}`
}

module.exports = { STYLES, WHITE_BG, buildPrompt }
