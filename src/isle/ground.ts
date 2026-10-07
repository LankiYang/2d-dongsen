// 动森式岛屿的地面（高清）：场纹理（R 陆地、G 悬崖层、B 沙滩，线性过滤）→ 着色器逐屏幕像素上色。
// 和潮汐港的地面着色器（island/ground.ts）同一套画法，多了两样：
//  · 悬崖：G 通道是 0～2 的连续值，0.5 / 1.5 是两层的边。朝南的边往下画一截崖面（FACE 像素高），
//    崖面区域 = 「往上 FACE 像素是高处、自己是低处」，下沿就是上沿平移下来的平滑曲线；
//  · 瀑布：崖面那一截如果是水（河流过悬崖），画成往下流的白色水帘，盖住下面的水面。
import { Filter, GlProgram, Texture, UniformGroup, defaultFilterVert, BufferImageSource } from 'pixi.js'
import { NOISE_GLSL } from '../fx/glsl.ts'

export const ISLE_FIELD = {
  landMin: -6, landMax: 6,       // 陆地（地块）：> 0 陆地
  cliffMin: -0.5, cliffMax: 2.5, // 悬崖层
  sandMin: -4, sandMax: 4,       // 沙滩（地块）：< 0 沙
}
export const FACE = 22           // 崖面高度（美术像素）

const enc = (v: number, lo: number, hi: number) => Math.max(0, Math.min(255, Math.round((v - lo) / (hi - lo) * 255)))
export function isleFieldTexture(gw: number, gh: number, f: (i: number) => [number, number, number]): Texture {
  const F = ISLE_FIELD, data = new Uint8Array(gw * gh * 4)
  for (let i = 0; i < gw * gh; i++) {
    const [land, cliff, sand] = f(i)
    data[i * 4] = enc(land, F.landMin, F.landMax)
    data[i * 4 + 1] = enc(cliff, F.cliffMin, F.cliffMax)
    data[i * 4 + 2] = enc(sand, F.sandMin, F.sandMax)
    data[i * 4 + 3] = 255
  }
  return new Texture({ source: new BufferImageSource({ resource: data, width: gw, height: gh, scaleMode: 'linear' }) })
}

const rgb = (h: number) => `vec3(${(((h >> 16) & 255) / 255).toFixed(4)}, ${(((h >> 8) & 255) / 255).toFixed(4)}, ${((h & 255) / 255).toFixed(4)})`
const F = ISLE_FIELD

const fragment = /* glsl */ `#version 300 es
precision highp float;
in vec2 vTextureCoord;
out vec4 finalColor;
uniform sampler2D uTexture;
uniform vec4 uInputSize;
uniform vec4 uOutputFrame;
uniform vec2 uCam;
uniform float uScale;
uniform float uTime;

${NOISE_GLSL}

const vec3 G0 = ${rgb(0x5aa84a)}; const vec3 G1 = ${rgb(0x68b653)}; const vec3 G2 = ${rgb(0x76c25d)}; const vec3 G3 = ${rgb(0x84cb67)}; const vec3 G4 = ${rgb(0xa6e08a)};
const vec3 S0 = ${rgb(0xd9c28c)}; const vec3 S1 = ${rgb(0xe6d3a2)}; const vec3 S2 = ${rgb(0xf1e3bb)}; const vec3 S3 = ${rgb(0xf6ecca)}; const vec3 S4 = ${rgb(0xfbf4dc)};
const vec3 R0 = ${rgb(0x8a6a4c)}; const vec3 R1 = ${rgb(0xa98463)}; const vec3 R2 = ${rgb(0xc4a07c)}; const vec3 R3 = ${rgb(0xd8b994)};
const float FACE = ${FACE.toFixed(1)};

vec3 fields(vec2 uv) {
  vec3 f = texture(uTexture, uv).rgb;
  return vec3(mix(${F.landMin.toFixed(2)}, ${F.landMax.toFixed(2)}, f.r), mix(${F.cliffMin.toFixed(2)}, ${F.cliffMax.toFixed(2)}, f.g), mix(${F.sandMin.toFixed(2)}, ${F.sandMax.toFixed(2)}, f.b));
}
float cover(float v) { float w = max(fwidth(v), 1e-5) * 0.7; return smoothstep(-w, w, v); }
float seg(vec2 p, vec2 a, vec2 b) { vec2 pa = p - a, ba = b - a; float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0); return length(pa - ba * h); }
float stroke(float d, float r) { float w = 0.75 / uScale; return 1.0 - smoothstep(r - w, r + w, d); }
// 草地程度：陆地、不是沙
float grassAt(vec3 f) { return cover(f.x) * (1.0 - cover(-f.z)); }

void main() {
  vec2 screen = vTextureCoord * uInputSize.xy + uOutputFrame.xy;
  vec2 p = uCam + screen / uScale;
  vec2 px = vec2(0.0, uScale) * uInputSize.zw;     // 世界里往下 1 像素对应的纹理坐标偏移
  vec3 f = fields(vTextureCoord);
  float land = cover(f.x);
  float sand = cover(-f.z);

  // ── 草 ──
  float n = fbm(p / 46.0) * 1.15 + (vnoise(p / 9.0) - 0.5) * 0.35;
  vec3 grass = mix(G1, G2, smoothstep(0.38, 0.5, n));
  grass = mix(grass, G3, smoothstep(0.62, 0.74, n));
  vec2 cell = floor(p / vec2(7.0, 6.0));
  float ch = hash12(cell + 21.0);
  if (ch < 0.45) {
    vec2 o = cell * vec2(7.0, 6.0) + vec2(1.0 + floor(hash12(cell + 22.0) * 4.0), 3.0 + floor(hash12(cell + 23.0) * 2.0));
    float d = min(seg(p, o + vec2(0.0, 0.3), o + vec2(0.9, -1.3)), seg(p, o + vec2(0.9, -1.3), o + vec2(1.9, 0.2)));
    grass = mix(grass, G1 * 0.92, stroke(d, 0.3) * 0.6);
  }
  // ── 沙 ──
  float sn = fbm(p / 30.0);
  vec3 sandC = mix(S2, S3, smoothstep(0.45, 0.55, sn));
  sandC = mix(S1, sandC, smoothstep(0.4, 1.4, f.x));     // 湿沙带
  sandC = mix(S0, sandC, smoothstep(0.0, 0.5, f.x));
  vec2 sc = floor(p / 4.0);
  float sh = hash12(sc + 31.0);
  if (sh < 0.12) { vec2 o = sc * 4.0 + 1.0 + vec2(hash12(sc + 32.0), hash12(sc + 33.0)) * 2.0; sandC = mix(sandC, S1, stroke(length(p - o), 0.35) * 0.8); }
  else if (sh > 0.94) { vec2 o = sc * 4.0 + 1.0 + vec2(hash12(sc + 34.0), hash12(sc + 35.0)) * 2.0; sandC = mix(sandC, S4, stroke(length(p - o), 0.35)); }

  vec3 col = mix(grass, sandC, sand);

  // ── 草地边缘高出一截（海岸、河岸）──
  float g = grassAt(f);
  float below2 = grassAt(fields(vTextureCoord + px * 2.4));
  float below1 = grassAt(fields(vTextureCoord + px * 1.2));
  float above1 = grassAt(fields(vTextureCoord - px * 1.0));
  col = mix(col, mix(G0, G1, below1), g * (1.0 - below2));
  col = mix(col, G4, g * (1.0 - above1) * below2 * 0.9);
  float above3 = grassAt(fields(vTextureCoord - px * 2.6));
  col *= mix(1.0, 0.8, (1.0 - g) * above3 * land);

  // ── 悬崖 ──
  // 两条边（0.5 / 1.5）各算一遍：这里是低处、往上 FACE 像素是高处 → 在崖面里
  float alpha = land;
  vec3 fu = fields(vTextureCoord - px * FACE);
  vec3 fu2 = fields(vTextureCoord - px * (FACE * 0.5));
  for (int k = 0; k < 2; k++) {
    float t = k == 0 ? 0.5 : 1.5;
    float face = cover(fu.y - t) * (1.0 - cover(f.y - t));
    // 竖直方向离上沿多远（0 上沿 → 1 下沿）：用上方半截的取样估一下
    float slope = max((fu.y - f.y) / FACE, 1e-4);
    float depth = clamp((t - f.y) / slope / FACE, 0.0, 1.0);
    // 岩面：上亮下暗，竖条纹理，顶上一圈草沿
    float streak = vnoise(vec2(p.x * 0.32, p.y * 0.04)) * 0.6 + vnoise(vec2(p.x * 1.1, 3.0)) * 0.4;
    vec3 rock = mix(R3, R1, smoothstep(0.1, 0.95, depth));
    rock = mix(rock, R0, smoothstep(0.55, 0.8, streak) * 0.45);
    rock = mix(rock, R2 * 1.05, (1.0 - smoothstep(0.0, 0.08, depth)) * 0.6);
    rock = mix(G0, rock, smoothstep(0.03, 0.13, depth));        // 上沿垂下来一点草
    // 瀑布：上方是水（河流过悬崖）
    float wet = 1.0 - cover(fu2.x);
    float flow = fract((p.y - uTime * 46.0) / 13.0 + vnoise(vec2(p.x * 0.45, 0.0)) * 0.8);
    vec3 fall = mix(vec3(0.64, 0.88, 0.96), vec3(0.96, 1.0, 1.0), smoothstep(0.55, 0.85, flow));
    rock = mix(rock, fall, wet);
    col = mix(col, rock, face);
    alpha = max(alpha, face);
    // 崖脚的接触阴影
    vec3 fd = fields(vTextureCoord - px * (FACE + 4.0));
    float foot = cover(fd.y - t) * (1.0 - cover(fu.y - t)) * (1.0 - cover(f.y - t));
    col *= mix(1.0, 0.82, foot);
  }
  // 高台侧边、背面的轮廓：层级变化处压一条暗边
  float lv = cover(f.y - 0.5) + cover(f.y - 1.5);
  float rim = clamp(fwidth(lv) * uScale * 0.9, 0.0, 1.0);
  col = mix(col, G0 * 0.85, rim * 0.6 * land);

  finalColor = vec4(col * alpha, alpha);
}
`

export class IsleGroundFilter extends Filter {
  constructor() {
    super({
      glProgram: GlProgram.from({ vertex: defaultFilterVert, fragment, name: 'isle-ground' }),
      resolution: 1,
      antialias: 'off',
      padding: 0,
      resources: {
        ground: new UniformGroup({
          uCam: { value: new Float32Array([0, 0]), type: 'vec2<f32>' },
          uScale: { value: 4, type: 'f32' },
          uTime: { value: 0, type: 'f32' },
        }),
      },
    })
  }
  update(camX: number, camY: number, scale: number, time: number) {
    const u = this.resources.ground.uniforms
    u.uCam[0] = camX; u.uCam[1] = camY
    u.uScale = scale
    u.uTime = time
  }
}
