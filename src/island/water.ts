// 岛屿水面：在美术像素分辨率上逐像素着色（所以结果本身就是像素画）。
// 深浅四色分带 + 有序抖动过渡、水面闪光短线、岸边一圈圈推上来的浪花、雨滴涟漪。
import { Filter, GlProgram, UniformGroup, defaultFilterVert } from 'pixi.js'
import { NOISE_GLSL } from '../fx/glsl.ts'
import { AC_STYLE, HD } from '../acstyle.ts'
import type { PixelView } from '../core/pixelview.ts'

const fragment = /* glsl */ `
precision highp float;
in vec2 vTextureCoord;
out vec4 finalColor;
uniform sampler2D uTexture;
uniform vec4 uInputSize;
uniform vec4 uOutputFrame;
uniform vec2 uOrigin;
uniform float uTime;
uniform float uRain;

${NOISE_GLSL}

vec3 ramp(float k, float dither) {
  vec3 c0 = vec3(0.54, 0.89, 0.82);
  vec3 c1 = vec3(0.27, 0.77, 0.79);
  vec3 c2 = vec3(0.14, 0.58, 0.74);
  vec3 c3 = vec3(0.11, 0.40, 0.64);
  vec3 c4 = vec3(0.09, 0.28, 0.52);
  float b = clamp(k, 0.0, 0.999) * 4.0;
  float i = floor(b), f = fract(b);
  // 带内大部分是纯色，只在带与带之间一小段做抖动
  float step_ = f > mix(0.72, 0.98, dither) ? 1.0 : 0.0;
  float idx = i + step_;
  if (idx < 0.5) return c0;
  if (idx < 1.5) return c1;
  if (idx < 2.5) return c2;
  if (idx < 3.5) return c3;
  return c4;
}

void main() {
  vec4 d = texture(uTexture, vTextureCoord);
  if (d.a < 0.5) { finalColor = vec4(0.0); return; }
  vec2 p = floor(vTextureCoord * uInputSize.xy + uOutputFrame.xy) + uOrigin;
  float shore = d.r * 255.0 / 4.0;
  float depth = d.g;
  float dither = bayer4(p);
  float k = depth * 0.85 + smoothstep(0.0, 26.0, shore) * 0.22 + (fbm(p * 0.018 + vec2(uTime * 0.03, 0.0)) - 0.5) * 0.16;
  vec3 col = ramp(k, dither);

  // 水面闪光：6×3 的格子里偶尔亮起一段 3 像素长的横线，随时间明灭
  vec2 cell = floor(p / vec2(9.0, 4.0));
  float phase = hash12(cell) * 6.2831;
  float life = sin(uTime * 0.9 + phase);
  vec2 inCell = p - cell * vec2(9.0, 4.0);
  float ox = floor(hash12(cell + 7.0) * 5.0);
  if (life > 0.94 && inCell.y == 1.0 && inCell.x >= ox && inCell.x < ox + 3.0 + step(0.9, life)) {
    col = mix(col, vec3(0.86, 0.98, 0.98), 0.75);
  }
  // 大尺度的波光：缓慢漂移的浅色条纹
  float w = vnoise(vec2(p.x * 0.05 + uTime * 0.25, p.y * 0.22));
  if (w > 0.84 && mod(p.y, 4.0) < 1.0 && mod(p.x + floor(p.y / 4.0) * 7.0, 13.0) < 6.0 && shore > 8.0) col = mix(col, vec3(0.75, 0.95, 0.95), 0.3);

  // 岸边浪花：以离岸距离为相位，一圈圈往岸上推
  float wob = (fbm(p * 0.06) - 0.5) * 5.0;
  float wave = sin((shore + wob) * 0.42 - uTime * 1.8);
  if (shore < 1.6) col = vec3(0.93, 0.98, 0.95);
  else if (shore < 13.0 && wave > 0.86 - shore * 0.012) col = mix(col, vec3(0.92, 0.98, 0.96), 0.85 - shore * 0.045);
  else if (shore < 5.0) col = mix(col, vec3(0.7, 0.93, 0.86), 0.35);

  // 雨：随机格子里出现扩散的小圆环
  if (uRain > 0.0) {
    vec2 rc = floor(p / 14.0);
    float t0 = fract(uTime * 0.7 + hash12(rc) * 13.0);
    vec2 center = rc * 14.0 + 3.0 + floor(vec2(hash12(rc + 1.3), hash12(rc + 2.7)) * 8.0);
    float r = length((p - center) * vec2(1.0, 1.8));
    if (abs(r - t0 * 6.0) < 0.6 && t0 < 0.8) col = mix(col, vec3(0.85, 0.95, 1.0), 0.6 * uRain);
  }
  finalColor = vec4(col, 1.0);
}
`

// 高清版（动森方向 · 高清平滑画风）：按屏幕分辨率逐像素着色，世界坐标是连续的；
// 色带之间柔和过渡（不抖动），闪光、浪花、雨圈都是按世界坐标画的矢量小笔触。
// 水面数据纹理是线性过滤的，离岸距离平滑，海岸线的浪花也就是平滑的曲线
const fragmentHD = /* glsl */ `#version 300 es
precision highp float;
in vec2 vTextureCoord;
out vec4 finalColor;
uniform sampler2D uTexture;
uniform vec4 uInputSize;
uniform vec4 uOutputFrame;
uniform vec2 uOrigin;
uniform float uScale;
uniform float uTime;
uniform float uRain;

${NOISE_GLSL}

vec3 ramp(float k) {
  vec3 c0 = vec3(0.62, 0.95, 0.88);
  vec3 c1 = vec3(0.40, 0.88, 0.87);
  vec3 c2 = vec3(0.25, 0.74, 0.86);
  vec3 c3 = vec3(0.18, 0.58, 0.81);
  vec3 c4 = vec3(0.14, 0.45, 0.72);
  // 色带：带内是纯色，带与带之间一小段柔和过渡
  float b = clamp(k, 0.0, 0.999) * 4.0;
  float i = floor(b), t = smoothstep(0.78, 1.0, fract(b));
  vec3 a = i < 0.5 ? c0 : i < 1.5 ? c1 : i < 2.5 ? c2 : i < 3.5 ? c3 : c4;
  vec3 n = i < 0.5 ? c1 : i < 1.5 ? c2 : i < 2.5 ? c3 : c4;
  return mix(a, n, t);
}
float seg(vec2 p, vec2 a, vec2 b) { vec2 pa = p - a, ba = b - a; float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0); return length(pa - ba * h); }

void main() {
  vec4 d = texture(uTexture, vTextureCoord);
  vec2 p = (vTextureCoord * uInputSize.xy + uOutputFrame.xy) / uScale + uOrigin;
  float aa = 0.75 / uScale;                     // 屏幕 1 像素在世界里的宽度，当抗锯齿宽度
  float shore = d.r * 255.0 / 4.0;
  float depth = d.g;
  float k = depth * 0.85 + smoothstep(0.0, 26.0, shore) * 0.22 + (fbm(p * 0.018 + vec2(uTime * 0.03, 0.0)) - 0.5) * 0.16;
  vec3 col = ramp(k);

  // 水面闪光：9×4 的格子里偶尔亮起一小段横线，随时间明灭
  vec2 cell = floor(p / vec2(9.0, 4.0));
  float life = sin(uTime * 0.9 + hash12(cell) * 6.2831);
  vec2 o = cell * vec2(9.0, 4.0) + vec2(floor(hash12(cell + 7.0) * 5.0) + 0.5, 1.5);
  float len = mix(1.0, 2.2, smoothstep(0.975, 1.0, life));
  float sp = 1.0 - smoothstep(0.3 - aa, 0.3 + aa + 0.25, seg(p, o, o + vec2(len, 0.0)));
  col = mix(col, vec3(0.9, 0.99, 0.98), sp * smoothstep(0.965, 0.995, life) * 0.7);

  // 岸边浪花：以离岸距离为相位，一圈圈往岸上推
  float wob = (fbm(p * 0.06) - 0.5) * 5.0;
  float wave = sin((shore + wob) * 0.42 - uTime * 1.8);
  float ww = fwidth(wave) * 0.8 + 1e-4;
  float thr = 0.86 - shore * 0.012;
  float band = smoothstep(thr - ww, thr + ww, wave) * (1.0 - smoothstep(12.0, 13.0, shore));
  col = mix(col, vec3(0.7, 0.93, 0.86), (1.0 - smoothstep(4.0, 5.0, shore)) * 0.35);
  col = mix(col, vec3(0.92, 0.98, 0.96), band * max(0.0, 0.85 - shore * 0.045));
  col = mix(col, vec3(0.95, 0.99, 0.97), 1.0 - smoothstep(1.3, 1.9, shore));

  // 雨：随机格子里出现扩散的小圆环
  if (uRain > 0.0) {
    vec2 rc = floor(p / 14.0);
    float t0 = fract(uTime * 0.7 + hash12(rc) * 13.0);
    vec2 center = rc * 14.0 + 3.0 + floor(vec2(hash12(rc + 1.3), hash12(rc + 2.7)) * 8.0);
    float r = length((p - center) * vec2(1.0, 1.8));
    float ring = 1.0 - smoothstep(0.45 - aa, 0.45 + aa, abs(r - t0 * 6.0));
    col = mix(col, vec3(0.85, 0.95, 1.0), ring * step(t0, 0.8) * 0.6 * uRain);
  }
  finalColor = vec4(col, 1.0);
}
`

export class WaterFilter extends Filter {
  constructor() {
    super({
      glProgram: HD
        ? GlProgram.from({ vertex: defaultFilterVert, fragment: fragmentHD, name: 'tide-water-hd' })
        : GlProgram.from({ vertex: defaultFilterVert, fragment: AC_STYLE ? acWater(fragment) : fragment, name: AC_STYLE ? 'tide-water-ac' : 'tide-water' }),
      resolution: 1,
      antialias: 'off',
      padding: 0,
      resources: {
        water: new UniformGroup({
          uOrigin: { value: new Float32Array([0, 0]), type: 'vec2<f32>' },
          uScale: { value: 1, type: 'f32' },
          uTime: { value: 0, type: 'f32' },
          uRain: { value: 0, type: 'f32' },
        }),
      },
    })
  }
  // 像素模式：渲染纹理的原点是 floor(cam) - 1，1 纹素 = 1 美术像素；高清模式：原点就是镜头，1 屏幕像素 = 1/scale 美术像素
  update(v: PixelView, time: number, rain: number) {
    const u = this.resources.water.uniforms
    if (v.hd) { u.uOrigin[0] = v.camX; u.uOrigin[1] = v.camY; u.uScale = v.scale }
    else { u.uOrigin[0] = Math.floor(v.camX) - 1; u.uOrigin[1] = Math.floor(v.camY) - 1; u.uScale = 1 }
    u.uTime = time
    u.uRain = rain
  }
}

// 动森风的水色：更亮、更青，深处是清澈的蓝（?oldstyle 用旧水色）
function acWater(src: string) {
  return src
    .replace('vec3 c0 = vec3(0.54, 0.89, 0.82);', 'vec3 c0 = vec3(0.62, 0.95, 0.88);')
    .replace('vec3 c1 = vec3(0.27, 0.77, 0.79);', 'vec3 c1 = vec3(0.38, 0.87, 0.86);')
    .replace('vec3 c2 = vec3(0.14, 0.58, 0.74);', 'vec3 c2 = vec3(0.22, 0.72, 0.85);')
    .replace('vec3 c3 = vec3(0.11, 0.40, 0.64);', 'vec3 c3 = vec3(0.16, 0.55, 0.80);')
    .replace('vec3 c4 = vec3(0.09, 0.28, 0.52);', 'vec3 c4 = vec3(0.13, 0.42, 0.70);')
}
