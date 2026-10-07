// WebSocket 连接：自动重连，消息按类型分发
import type { ClientMsg, ServerMsg } from '../../shared/protocol.ts'

type Handler = (m: any) => void

export class Net {
  ws: WebSocket | null = null
  private handlers = new Map<string, Handler[]>()
  onOpen: () => void = () => {}
  onClose: () => void = () => {}

  connect() {
    const url = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`
    const ws = new WebSocket(url)
    this.ws = ws
    ws.onopen = () => this.onOpen()
    ws.onmessage = e => {
      const m = JSON.parse(e.data) as ServerMsg
      for (const h of this.handlers.get(m.t) ?? []) h(m)
    }
    ws.onclose = ev => {
      this.onClose()
      if (ev.code !== 4000) setTimeout(() => this.connect(), 1500)
    }
  }

  on<T extends ServerMsg['t']>(t: T, h: (m: Extract<ServerMsg, { t: T }>) => void) {
    const list = this.handlers.get(t) ?? []
    list.push(h as Handler)
    this.handlers.set(t, list)
    return () => this.handlers.set(t, (this.handlers.get(t) ?? []).filter(x => x !== h))
  }

  send(m: ClientMsg) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(m))
  }
}
