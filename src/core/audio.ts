// 声音：背景音乐淡入淡出切换 + 音效 + 程序合成的环境声（海浪 / 水下低鸣）
const SFX = {
  step_grass: ['footstep_grass_000', 'footstep_grass_001', 'footstep_grass_002'],
  step_wood: ['footstep_wood_000', 'footstep_wood_001', 'footstep_wood_002'],
  till: ['impactSoft_medium_000', 'impactSoft_medium_001'],
  water: ['drop_001'],
  plant: ['pluck_001'],
  harvest: ['impactSoft_heavy_000'],
  coin: ['confirmation_002'],
  click: ['click_001'],
  open: ['open_001'],
  close: ['close_001'],
  error: ['error_001'],
  shoot: ['impactMetal_light_000'],
  hit: ['impactGeneric_light_000'],
  catch: ['confirmation_001'],
  splash: ['impactPlank_medium_000'],
  select: ['select_001'],
  chat: ['tick_001'],
  boom: ['bong_001'],
  whoosh: ['maximize_003'],
  chop: ['impactWood_light_000'],
  toggle: ['toggle_001'],
} as const
export type SfxName = keyof typeof SFX

const MUSIC = {
  morning: '/audio/music/music_good_morning.ogg',
  day: '/audio/music/music_gone_fishin.mp3',
  evening: '/audio/music/music_bossa.mp3',
  sea: '/audio/music/music_aquaria.ogg',
} as const
export type MusicName = keyof typeof MUSIC | 'none'

export class Audio {
  ctx: AudioContext | null = null
  private buffers = new Map<string, AudioBuffer>()
  private music: { name: MusicName, src: AudioBufferSourceNode, gain: GainNode } | null = null
  private musicBuffers = new Map<string, Promise<AudioBuffer>>()
  private ambient: { gain: GainNode, filter: BiquadFilterNode, lfo: OscillatorNode } | null = null
  master!: GainNode
  musicVol = 0.45
  wanted: MusicName = 'none'

  // 浏览器要求首次交互后才能出声
  unlock() {
    if (this.ctx) { this.ctx.resume(); return }
    this.ctx = new AudioContext()
    this.master = this.ctx.createGain()
    this.master.gain.value = 0.9
    this.master.connect(this.ctx.destination)
    for (const files of Object.values(SFX)) for (const f of files) this.loadSfx(f)
    this.startAmbient()
    const w = this.wanted
    this.wanted = 'none'
    this.playMusic(w)
  }

  private async decode(url: string) {
    const buf = await (await fetch(url)).arrayBuffer()
    return this.ctx!.decodeAudioData(buf)
  }
  private async loadSfx(f: string) {
    try { this.buffers.set(f, await this.decode(`/audio/sfx/${f}.ogg`)) } catch { /* 缺文件就静音 */ }
  }

  play(name: SfxName, vol = 0.5, rate = 1) {
    if (!this.ctx) return
    const files = SFX[name]
    const buf = this.buffers.get(files[Math.floor(Math.random() * files.length)])
    if (!buf) return
    const src = this.ctx.createBufferSource()
    src.buffer = buf
    src.playbackRate.value = rate * (0.94 + Math.random() * 0.12)
    const g = this.ctx.createGain()
    g.gain.value = vol
    src.connect(g).connect(this.master)
    src.start()
  }

  playMusic(name: MusicName) {
    if (name === this.wanted) return
    this.wanted = name
    if (!this.ctx) return
    const ctx = this.ctx
    const old = this.music
    if (old) {
      old.gain.gain.cancelScheduledValues(ctx.currentTime)
      old.gain.gain.setValueAtTime(old.gain.gain.value, ctx.currentTime)
      old.gain.gain.linearRampToValueAtTime(0, ctx.currentTime + 2.5)
      old.src.stop(ctx.currentTime + 2.6)
      this.music = null
    }
    if (name === 'none') return
    let p = this.musicBuffers.get(name)
    if (!p) { p = this.decode(MUSIC[name]); this.musicBuffers.set(name, p) }
    p.then(buf => {
      if (this.wanted !== name) return
      const src = ctx.createBufferSource()
      src.buffer = buf
      src.loop = true
      const gain = ctx.createGain()
      gain.gain.value = 0
      gain.gain.linearRampToValueAtTime(this.musicVol, ctx.currentTime + 3)
      src.connect(gain).connect(this.master)
      src.start()
      this.music = { name, src, gain }
    }).catch(() => {})
  }

  // 环境声：白噪声经低通滤波 + 慢速 LFO 调制截止频率，岛上像海浪，水下调低就是闷闷的水声
  private startAmbient() {
    const ctx = this.ctx!
    const len = ctx.sampleRate * 3
    const buf = ctx.createBuffer(1, len, ctx.sampleRate)
    const d = buf.getChannelData(0)
    let b = 0
    for (let i = 0; i < len; i++) { b = 0.97 * b + 0.03 * (Math.random() * 2 - 1); d[i] = b * 3 }
    const src = ctx.createBufferSource()
    src.buffer = buf
    src.loop = true
    const filter = ctx.createBiquadFilter()
    filter.type = 'lowpass'
    filter.frequency.value = 700
    const lfo = ctx.createOscillator()
    lfo.frequency.value = 0.12
    const lfoGain = ctx.createGain()
    lfoGain.gain.value = 380
    lfo.connect(lfoGain).connect(filter.frequency)
    const gain = ctx.createGain()
    gain.gain.value = 0.0
    src.connect(filter).connect(gain).connect(this.master)
    src.start(); lfo.start()
    this.ambient = { gain, filter, lfo }
  }

  setAmbient(mode: 'shore' | 'underwater', level: number) {
    if (!this.ambient || !this.ctx) return
    const t = this.ctx.currentTime
    const a = this.ambient
    a.gain.gain.setTargetAtTime(mode === 'shore' ? 0.22 * level : 0.3 * level, t, 0.8)
    a.filter.frequency.setTargetAtTime(mode === 'shore' ? 750 : 260, t, 0.8)
    a.lfo.frequency.setTargetAtTime(mode === 'shore' ? 0.12 : 0.05, t, 0.8)
  }
}
