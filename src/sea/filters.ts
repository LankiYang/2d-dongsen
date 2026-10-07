// 海底着色器：水体背景（深度渐变 + 抖动 + 丁达尔光束 + 海面波光）和岩石焦散
import { Filter, GlProgram, Texture, UniformGroup, defaultFilterVert } from 'pixi.js'
import { NOISE_GLSL } from '../fx/glsl.ts'

const HEADER = /* glsl */ `
precision highp float;
in vec2 vTextureCoord;
out vec4 finalColor;
uniform sampler2D uTexture;
uniform vec4 uInputSize;
uniform vec4 uOutputFrame;
uniform vec2 uOrigin;
uniform float uTime;
${NOISE_GLSL}
vec2 worldPos() { return floor(vTextureCoord * uInputSize.xy + uOutputFrame.xy) + uOrigin; }
`

const bgFragment = HEADER + /* glsl */ `
vec3 water(float d) {
  vec3 a = vec3(0.42, 0.83, 0.90);
  vec3 b = vec3(0.17, 0.62, 0.80);
  vec3 c = vec3(0.09, 0.42, 0.66);
  vec3 e = vec3(0.05, 0.25, 0.46);
  vec3 f = vec3(0.03, 0.11, 0.25);
  if (d < 220.0) return mix(a, b, d / 220.0);
  if (d < 620.0) return mix(b, c, (d - 220.0) / 400.0);
  if (d < 1150.0) return mix(c, e, (d - 620.0) / 530.0);
  return mix(e, f, clamp((d - 1150.0) / 650.0, 0.0, 1.0));
}
void main() {
  vec2 p = worldPos();
  float dth = bayer4(p);
  vec3 col;
  if (p.y < 0.0) {
    // 海面以上：天空渐变 + 缓慢飘过的云
    float t = clamp(-p.y / 180.0, 0.0, 1.0);
    col = mix(vec3(0.86, 0.96, 1.0), vec3(0.47, 0.76, 0.98), t);
    float cl = fbm(vec2(p.x * 0.006 + uTime * 0.01, p.y * 0.02));
    if (cl > 0.62 + (dth - 0.5) * 0.06) col = mix(col, vec3(1.0), 0.8);
  } else {
    // 水色按 12 像素一档量化，档与档之间抖动，保持像素画质感
    float d = p.y;
    float q = floor(d / 12.0 + dth);
    col = water(q * 12.0);
    // 丁达尔光束：斜向条带，两组不同频率相乘得到疏密变化
    float ang = p.x + p.y * 0.42;
    float r1 = sin(ang * 0.016 + uTime * 0.22) * 0.5 + 0.5;
    float r2 = sin(ang * 0.037 - uTime * 0.13 + 1.7) * 0.5 + 0.5;
    float ray = pow(r1 * r2, 1.6) * (1.0 - smoothstep(0.0, 950.0, d)) * (0.6 + 0.4 * vnoise(vec2(ang * 0.01, uTime * 0.2)));
    float lvl = floor(ray * 4.0 + dth * 0.999) / 4.0;
    col += vec3(0.30, 0.42, 0.40) * lvl * 0.55;
    // 海面：从水下仰望的亮色波纹带
    float wv = sin(p.x * 0.05 + uTime * 1.6) * 1.5 + sin(p.x * 0.021 - uTime * 0.9) * 2.0;
    if (d < 5.0 + wv) col = mix(col, vec3(0.86, 0.98, 1.0), 0.7);
    else if (d < 9.0 + wv && mod(p.x + floor(uTime * 6.0), 7.0) < 3.0) col = mix(col, vec3(0.8, 0.96, 1.0), 0.35);
  }
  finalColor = vec4(col, 1.0);
}
`

const causticFragment = HEADER + /* glsl */ `
uniform sampler2D uMask;
uniform vec2 uWorldSize;
void main() {
  vec4 c = texture(uTexture, vTextureCoord);
  if (c.a < 0.01) { finalColor = c; return; }
  vec2 p = worldPos();
  float lit = texture(uMask, (p + 0.5) / uWorldSize).r;
  float fade = (1.0 - smoothstep(40.0, 820.0, p.y)) * lit;
  if (fade > 0.0) {
    vec2 q = p * 0.07;
    float n1 = vnoise(q + vec2(uTime * 0.32, uTime * 0.17));
    float n2 = vnoise(q * 1.63 + vec2(-uTime * 0.21, uTime * 0.26) + 4.0);
    float ca = 1.0 - abs(n1 - n2) * 6.0;
    float lvl = ca > 0.7 ? 1.0 : ca > 0.45 ? 0.5 : 0.0;
    c.rgb += vec3(0.45, 0.66, 0.58) * lvl * fade * 0.6 * c.a;
  }
  finalColor = c;
}
`

class WorldFilter extends Filter {
  constructor(fragment: string, name: string, mask?: Texture) {
    super({
      glProgram: GlProgram.from({ vertex: defaultFilterVert, fragment, name }),
      resolution: 1,
      antialias: 'off',
      padding: 0,
      resources: {
        // 纹理资源要在构造时就声明，才会绑定到自己的纹理单元
        ...(mask ? { uMask: mask.source } : {}),
        u: new UniformGroup({
          uOrigin: { value: new Float32Array([0, 0]), type: 'vec2<f32>' },
          uTime: { value: 0, type: 'f32' },
          uWorldSize: { value: new Float32Array([mask?.width ?? 1, mask?.height ?? 1]), type: 'vec2<f32>' },
        }),
      },
    })
  }
  update(ox: number, oy: number, time: number) {
    const u = this.resources.u.uniforms
    u.uOrigin[0] = ox; u.uOrigin[1] = oy; u.uTime = time
  }
}

export const makeBackgroundFilter = () => new WorldFilter(bgFragment, 'tide-sea-bg')
export const makeCausticFilter = (mask: Texture) => new WorldFilter(causticFragment, 'tide-caustic', mask)
export type { WorldFilter }
