// 高清地面（动森方向 · 高清平滑画风）：不再烘焙逐像素的像素画地面，
// 而是把三个连续场（陆地、小路、沙滩）存进一张低分辨率的场纹理（线性过滤），由着色器在屏幕分辨率上逐像素上色：
// 边界按阈值 + 抗锯齿，草地边缘高出一截（下沿深色唇边 + 落在沙地/小路上的投影）、上沿高光，
// 草簇、沙粒、卵石都是按世界坐标画的矢量小笔触，放大多少倍都是平滑的。
import { Filter, GlProgram, Texture, UniformGroup, defaultFilterVert, BufferImageSource } from 'pixi.js'
import { TILE } from '../../shared/data.ts'
import { NOISE_GLSL } from '../fx/glsl.ts'

// 场的编码范围：只有阈值附近的精度要紧
export const FIELD = {
  landMin: -0.2, landMax: 0.3,     // 陆地：>0 为陆地
  pathMin: -2, pathMax: 2,         // 小路：<0 为路（地块单位）
  sandMin: -0.15, sandMax: 0.15,   // 沙滩：<0 为沙
}

const enc = (v: number, lo: number, hi: number) => Math.max(0, Math.min(255, Math.round((v - lo) / (hi - lo) * 255)))

// f(i) 返回 [land, path, sand]；gw×gh 个采样点，间距 S 美术像素
export function fieldTexture(gw: number, gh: number, f: (i: number) => [number, number, number]): Texture {
  const data = new Uint8Array(gw * gh * 4)
  for (let i = 0; i < gw * gh; i++) {
    const [land, path, sand] = f(i)
    data[i * 4] = enc(land, FIELD.landMin, FIELD.landMax)
    data[i * 4 + 1] = enc(path, FIELD.pathMin, FIELD.pathMax)
    data[i * 4 + 2] = enc(sand, FIELD.sandMin, FIELD.sandMax)
    data[i * 4 + 3] = 255
  }
  return new Texture({ source: new BufferImageSource({ resource: data, width: gw, height: gh, scaleMode: 'linear' }) })
}

const rgb = (h: number) => `vec3(${(((h >> 16) & 255) / 255).toFixed(4)}, ${(((h >> 8) & 255) / 255).toFixed(4)}, ${((h & 255) / 255).toFixed(4)})`

const fragment = /* glsl */ `#version 300 es
precision highp float;
in vec2 vTextureCoord;
out vec4 finalColor;
uniform sampler2D uTexture;
uniform vec4 uInputSize;
uniform vec4 uOutputFrame;
uniform vec2 uCam;
uniform float uScale;
uniform vec4 uFarm;

${NOISE_GLSL}

const vec3 G0 = ${rgb(0x5aa84a)}; const vec3 G1 = ${rgb(0x68b653)}; const vec3 G2 = ${rgb(0x76c25d)}; const vec3 G3 = ${rgb(0x84cb67)}; const vec3 G4 = ${rgb(0xa6e08a)};
const vec3 F2 = ${rgb(0x80c462)}; const vec3 F3 = ${rgb(0x8dcd6c)};
const vec3 S0 = ${rgb(0xd9c28c)}; const vec3 S1 = ${rgb(0xe6d3a2)}; const vec3 S2 = ${rgb(0xf1e3bb)}; const vec3 S3 = ${rgb(0xf6ecca)}; const vec3 S4 = ${rgb(0xfbf4dc)};
const vec3 P0 = ${rgb(0xb8925f)}; const vec3 P2 = ${rgb(0xd5b587)}; const vec3 P3 = ${rgb(0xdcbe92)}; const vec3 P4 = ${rgb(0xeed8b4)};

// 场解码
vec3 fields(vec2 uv) {
  vec3 f = texture(uTexture, uv).rgb;
  return vec3(
    mix(${FIELD.landMin.toFixed(3)}, ${FIELD.landMax.toFixed(3)}, f.r),
    mix(${FIELD.pathMin.toFixed(3)}, ${FIELD.pathMax.toFixed(3)}, f.g),
    mix(${FIELD.sandMin.toFixed(3)}, ${FIELD.sandMax.toFixed(3)}, f.b));
}
// 抗锯齿阈值：v > 0 → 1
float cover(float v) { float w = max(fwidth(v), 1e-5) * 0.7; return smoothstep(-w, w, v); }
// 世界坐标矩形覆盖（带抗锯齿）。屏幕上 1 像素 = 世界里 1/uScale，直接用它当抗锯齿宽度，
// 不用 fwidth——分支里的导数是未定义的
float rectCover(vec2 p, vec4 r) {
  vec2 w = vec2(0.75 / uScale);
  vec2 a = smoothstep(r.xy - w, r.xy + w, p) * (1.0 - smoothstep(r.zw - w, r.zw + w, p));
  return a.x * a.y;
}
// 「草地」程度：陆地、不是沙、不是路（农田算草）
float grassAt(vec3 f, vec2 p) {
  float land = cover(f.x);
  float farm = rectCover(p, uFarm);
  return land * max(farm, (1.0 - cover(-f.z)) * (1.0 - cover(-f.y)));
}
// 点到线段的距离
float seg(vec2 p, vec2 a, vec2 b) { vec2 pa = p - a, ba = b - a; float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0); return length(pa - ba * h); }
// 画一笔：半宽 r 的线段，抗锯齿
float stroke(float d, float r) { float w = 0.75 / uScale; return 1.0 - smoothstep(r - w, r + w, d); }

void main() {
  vec2 screen = vTextureCoord * uInputSize.xy + uOutputFrame.xy;
  vec2 p = uCam + screen / uScale;               // 世界坐标（美术像素）
  vec2 px = vec2(0.0, uScale) * uInputSize.zw;   // 世界里往下 1 像素对应的纹理坐标偏移
  vec3 f = fields(vTextureCoord);
  float land = cover(f.x);   // 不提前 return：后面的 fwidth 要在统一的控制流里算
  float farm = rectCover(p, uFarm);
  float sand = cover(-f.z) * (1.0 - farm);
  float path = cover(-f.y) * (1.0 - farm);

  // ── 草 ──
  float n = fbm(p / 46.0) * 1.15 + (vnoise(p / 9.0) - 0.5) * 0.35;
  vec3 grass = mix(G1, G2, smoothstep(0.38, 0.5, n));
  grass = mix(grass, G3, smoothstep(0.62, 0.74, n));
  vec3 farmG = mix(F2, F3, smoothstep(0.5, 0.66, n));
  grass = mix(grass, farmG, farm);
  // 草簇：7×6 的格子里偶尔一个「人」字小笔触
  vec2 cell = floor(p / vec2(7.0, 6.0));
  float ch = hash12(cell + 21.0);
  if (ch < mix(0.5, 0.25, farm)) {
    vec2 o = cell * vec2(7.0, 6.0) + vec2(1.0 + floor(hash12(cell + 22.0) * 4.0), 3.0 + floor(hash12(cell + 23.0) * 2.0));
    float d = min(seg(p, o + vec2(0.0, 0.3), o + vec2(0.9, -1.3)), seg(p, o + vec2(0.9, -1.3), o + vec2(1.9, 0.2)));
    grass = mix(grass, G1 * 0.92, stroke(d, 0.3) * 0.6);
  }

  // ── 沙 ──
  float sn = fbm(p / 30.0);
  vec3 sandC = mix(S2, S3, smoothstep(0.45, 0.55, sn));
  sandC = mix(S1, sandC, smoothstep(0.012, 0.03, f.x));   // 湿沙带
  sandC = mix(S0, sandC, smoothstep(0.0, 0.012, f.x));
  vec2 sc = floor(p / 4.0);
  float sh = hash12(sc + 31.0);
  if (sh < 0.12) { vec2 o = sc * 4.0 + 1.0 + vec2(hash12(sc + 32.0), hash12(sc + 33.0)) * 2.0; sandC = mix(sandC, S1, stroke(length(p - o), 0.35) * 0.8); }
  else if (sh > 0.94) { vec2 o = sc * 4.0 + 1.0 + vec2(hash12(sc + 34.0), hash12(sc + 35.0)) * 2.0; sandC = mix(sandC, S4, stroke(length(p - o), 0.35)); }

  // ── 小路 ──
  float pn = fbm(p / 20.0);
  vec3 pathC = mix(P2, P3, smoothstep(0.48, 0.58, pn));
  vec2 pc = floor(p / 5.0);
  if (hash12(pc + 42.0) < 0.18) {
    vec2 o = pc * 5.0 + 1.5 + vec2(hash12(pc + 43.0), hash12(pc + 44.0)) * 2.0;
    vec2 q = (p - o) * vec2(1.0, 1.6);
    pathC = mix(pathC, P0, stroke(length(q - vec2(0.0, 0.5)), 0.9) * 0.6);
    pathC = mix(pathC, P4, stroke(length(q), 0.85));
  }

  vec3 col = grass;
  col = mix(col, sandC, sand);
  col = mix(col, pathC, path);

  // ── 草地边缘：高出一截 ──
  float g = grassAt(f, p);
  float below1 = grassAt(fields(vTextureCoord + px * 1.2), p + vec2(0.0, 1.2));
  float below2 = grassAt(fields(vTextureCoord + px * 2.4), p + vec2(0.0, 2.4));
  float above1 = grassAt(fields(vTextureCoord - px * 1.0), p - vec2(0.0, 1.0));
  vec3 lip = mix(G0, G1, below1);                 // 最下沿最深
  col = mix(col, lip, g * (1.0 - below2));
  col = mix(col, G4, g * (1.0 - above1) * below2 * 0.9);  // 上沿高光
  // 草地往下 2.5 像素的投影落在沙地 / 小路上
  float above3 = grassAt(fields(vTextureCoord - px * 2.6), p - vec2(0.0, 2.6));
  col *= mix(1.0, 0.8, (1.0 - g) * above3);

  finalColor = vec4(col * land, land);
}
`

export class GroundFilter extends Filter {
  constructor(farm: { x0: number, y0: number, x1: number, y1: number }) {
    super({
      glProgram: GlProgram.from({ vertex: defaultFilterVert, fragment, name: 'tide-ground-hd' }),
      resolution: 1,
      antialias: 'off',
      padding: 0,
      resources: {
        ground: new UniformGroup({
          uCam: { value: new Float32Array([0, 0]), type: 'vec2<f32>' },
          uScale: { value: 4, type: 'f32' },
          uFarm: { value: new Float32Array([farm.x0 * TILE, farm.y0 * TILE, (farm.x1 + 1) * TILE, (farm.y1 + 1) * TILE]), type: 'vec4<f32>' },
        }),
      },
    })
  }
  update(camX: number, camY: number, scale: number) {
    const u = this.resources.ground.uniforms
    u.uCam[0] = camX; u.uCam[1] = camY
    u.uScale = scale
  }
}
