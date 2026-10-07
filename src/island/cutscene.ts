// 心事件播放器：一条一条执行剧本（摆位、走位、镜头、台词、表情、选项），期间玩家不能操作。
// 看完把事件 id 和选了哪个选项发给服务端，由服务端校验后加好感、给东西、开任务。
import type { HeartEvent, Cmd, Who, Emote } from '../../shared/events.ts'
import { NPC_INFO } from '../../shared/npcs.ts'
import type { NpcId } from '../../shared/npcs.ts'
import { TILE } from '../../shared/data.ts'
import type { Dir } from '../../shared/protocol.ts'
import type { Game } from '../game.ts'
import type { NpcActor } from './npcs.ts'
import { drawEmote } from './npcs.ts'
import type { Farmer } from './farmer.ts'
import { state } from '../state.ts'
import type { SfxName } from '../core/audio.ts'

// 场景要提供给播放器的东西
export interface Stage {
  g: Game
  me: Farmer
  npcs: NpcActor[]
  camTarget: { x: number, y: number } | null   // 剧情镜头（像素），null = 跟着玩家
  meWalk: { x: number, y: number } | null      // 剧情让玩家走到这里
  effect(kind: string, x: number, y: number): void   // 烟花、海里的荧光、灯塔光束开关
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))
async function until(f: () => boolean, max = 15000) {
  const t0 = performance.now()
  while (!f() && performance.now() - t0 < max) await sleep(30)
}

export class Cutscene {
  choice: string | undefined
  private used = new Set<NpcActor>()
  constructor(private st: Stage, public ev: HeartEvent) {}

  private actor(who: NpcId) {
    const a = this.st.npcs.find(n => n.def.id === who)!
    if (!a.scripted) { a.scripted = true; a.path = []; a.moving = false }
    this.used.add(a)
    return a
  }
  private speaker(who: Who) {
    if (who === 'me') return { name: state.me.name, title: '', face: '', voice: 1 }
    const i = NPC_INFO[who]
    return { name: i.name, title: i.title, face: who, voice: i.voice }
  }

  async run() {
    const { g } = this.st
    g.hud.hint(null)
    g.hud.closeModals()
    for (const c of this.ev.script) await this.exec(c)
    // 收尾：角色交还给日程，镜头回到玩家
    for (const a of this.used) a.release()
    this.st.camTarget = null
    this.st.meWalk = null
    this.st.me.moving = false
    g.hud.closeDialog()
    g.net.send({ t: 'event', id: this.ev.id, choice: this.choice })
  }

  private async exec(c: Cmd) {
    const { g, me } = this.st
    switch (c[0]) {
      case 'place': {
        const [, who, x, y, dir] = c
        if (who === 'me') { me.x = me.tx = x * TILE; me.y = me.ty = y * TILE; me.dir = dir; me.moving = false }
        else { const a = this.actor(who); a.x = a.tx = x * TILE; a.y = a.ty = y * TILE; a.dir = dir; a.moving = false; a.walkDone = true }
        return
      }
      case 'walk': {
        const [, who, x, y] = c
        if (who === 'me') { this.st.meWalk = { x: x * TILE, y: y * TILE }; await until(() => !this.st.meWalk) }
        else { const a = this.actor(who); a.walkTo(x * TILE, y * TILE); await until(() => a.walkDone) }
        return
      }
      case 'face': {
        const [, who, dir] = c
        if (who === 'me') me.dir = dir as Dir
        else this.actor(who).dir = dir as Dir
        return
      }
      case 'cam': this.st.camTarget = { x: c[1] * TILE, y: c[2] * TILE }; await sleep(650); return
      case 'say': await g.hud.say({ ...this.speaker(c[1]), text: c[2] }); return
      case 'emote': {
        const [, who, e] = c
        if (who === 'me') this.meEmote(e)
        else this.actor(who).showEmote(e)
        g.audio.play(e === '!' ? 'select' : 'chat', 0.35, e === '♥' ? 1.3 : 1)
        await sleep(750)
        return
      }
      case 'wait': await sleep(c[1]); return
      case 'note': await g.hud.say({ name: '', title: '', face: '', voice: 0.8, text: c[1] }); return
      case 'fx': this.st.effect(c[1], c[2], c[3]); return
      case 'fade': g.hud.fade(c[1] === 'out'); await sleep(550); return
      case 'sfx': g.audio.play(c[1] as SfxName, 0.5); return
      case 'ask': {
        const [, who, text, opts] = c
        const i = await g.hud.ask({ ...this.speaker(who), text: text || '……' }, opts.map(o => o[0]))
        this.choice = opts[i][1]
        for (const [w, line] of this.ev.choices?.[this.choice]?.reply ?? []) await g.hud.say({ ...this.speaker(w), text: line })
        return
      }
    }
  }

  private meEmote(e: Emote) {
    drawEmote(this.st.me.emote, e)
    this.st.me.emoteT = 1.5
  }
}
