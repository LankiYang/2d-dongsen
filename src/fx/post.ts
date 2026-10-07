// 屏幕分辨率上的后处理：环境光 × 像素画 + 光照图、云影、海底深度色偏、暗角
import { Filter, GlProgram, Texture, UniformGroup, defaultFilterVert } from 'pixi.js'
import { NOISE_GLSL } from './glsl.ts'

const fragment = /* glsl */ `
precision highp float;
in vec2 vTextureCoord;
out vec4 finalColor;
uniform sampler2D uTexture;
uniform sampler2D uLight;
uniform vec4 uInputSize;
uniform vec4 uOutputFrame;

uniform vec4 uLightRect;
uniform vec2 uCam;
uniform float uScale;
uniform float uTime;
uniform vec2 uScreen;
uniform vec3 uAmbient;
uniform float uLightGain;
uniform float uClouds;
uniform float uMode;
uniform float uFlash;
uniform float uSat;

${NOISE_GLSL}

void main() {
  vec4 c = texture(uTexture, vTextureCoord);
  vec2 screen = vTextureCoord * uInputSize.xy + uOutputFrame.xy;
  vec2 world = uCam + screen / uScale;
  vec3 light = texture(uLight, (screen - uLightRect.xy) / uLightRect.zw).rgb;
  vec3 col = c.rgb;
  vec3 amb = uAmbient;
  if (uMode > 0.5) {
    // 海底：环境光随深度衰减，颜色往蓝绿偏
    float d = max(world.y, 0.0);
    float t = smoothstep(30.0, 1350.0, d);
    amb = world.y < 0.0 ? vec3(1.0) : mix(vec3(1.02, 1.0, 0.98), vec3(0.09, 0.15, 0.27), t);
    amb *= mix(1.0, 0.5, smoothstep(1300.0, 1760.0, d));
    vec3 tint = mix(vec3(0.9, 1.0, 1.03), vec3(0.55, 0.82, 1.12), t);
    if (world.y >= 0.0) col *= tint;
  }
  vec3 lit = col * (amb + light * uLightGain);
  if (uClouds > 0.0) {
    float n = fbm(world * 0.0045 + vec2(uTime * 0.018, uTime * 0.006));
    lit *= 1.0 - uClouds * smoothstep(0.5, 0.72, n) * 0.3;
  }
  // 轻微饱和度调整（黄昏/夜晚降低一点）
  float g = dot(lit, vec3(0.299, 0.587, 0.114));
  lit = mix(vec3(g), lit, uSat);
  vec2 uv = screen / uScreen;
  float v = smoothstep(1.0, 0.38, length((uv - 0.5) * vec2(1.0, 0.9)));
  lit *= mix(0.7, 1.0, v);
  lit = mix(lit, vec3(1.0), uFlash);
  finalColor = vec4(lit * c.a, c.a);
}
`

type Val = number | number[]

export class PostFilter extends Filter {
  constructor() {
    super({
      glProgram: GlProgram.from({ vertex: defaultFilterVert, fragment, name: 'tide-post' }),
      resolution: 1,
      antialias: 'off',
      padding: 0,
      resources: {
        // 纹理资源必须在构造时声明，之后赋值才会绑定到采样器；否则 uLight 会退回 0 号纹理单元（场景本身）
        uLight: Texture.WHITE.source,
        post: new UniformGroup({
          uLightRect: { value: new Float32Array([0, 0, 1, 1]), type: 'vec4<f32>' },
          uCam: { value: new Float32Array([0, 0]), type: 'vec2<f32>' },
          uScale: { value: 3, type: 'f32' },
          uTime: { value: 0, type: 'f32' },
          uScreen: { value: new Float32Array([1, 1]), type: 'vec2<f32>' },
          uAmbient: { value: new Float32Array([1, 1, 1]), type: 'vec3<f32>' },
          uLightGain: { value: 1, type: 'f32' },
          uClouds: { value: 0, type: 'f32' },
          uMode: { value: 0, type: 'f32' },
          uFlash: { value: 0, type: 'f32' },
          uSat: { value: 1, type: 'f32' },
        }),
      },
    })
  }

  set lightTexture(t: Texture) { this.resources.uLight = t.source }

  set(name: string, v: Val) {
    const u = this.resources.post.uniforms
    if (Array.isArray(v)) { const arr = u[name] as Float32Array; for (let i = 0; i < v.length; i++) arr[i] = v[i] }
    else u[name] = v
  }
}
