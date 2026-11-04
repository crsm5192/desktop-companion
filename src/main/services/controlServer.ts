import { timingSafeEqual } from 'node:crypto'
import { WebSocket, WebSocketServer } from 'ws'
import { ControlError, controlListenAddress, validateControlCommand, type ControlApiConfig, type ControlCommand } from '../../shared/control'

export interface ControlServerOptions {
  config: ControlApiConfig
  execute: (command: ControlCommand) => Promise<unknown>
  status: () => unknown
}
export async function createControlServer(options: ControlServerOptions): Promise<{
  host: string
  port: number
  emit: (type: string, data: unknown) => void
  close: () => Promise<void>
}> {
  const { config } = options
  if (!config.token) throw new Error('控制 API 缺少连接令牌')
  const addressConfig = controlListenAddress(config, true)
  const server = new WebSocketServer({ host: addressConfig.host, port: addressConfig.port, maxPayload: 65536 })
  await new Promise<void>((resolve, reject) => {
    server.once('listening', resolve)
    server.once('error', reject)
  })
  server.on('error', error => console.error('[control-api]', error.message))
  const authenticated = new Set<WebSocket>()
  let totalPending = 0
  const send = (socket: WebSocket, value: unknown): void => {
    if (socket.readyState !== WebSocket.OPEN) return
    if (socket.bufferedAmount > 1048576) { socket.close(1013, 'Client too slow'); return }
    socket.send(JSON.stringify(value))
  }
  server.on('connection', (socket, request) => {
    // Native Agent clients (local or remote) omit Origin; browser clients are rejected.
    if (request.headers.origin || server.clients.size > 16) { socket.close(1008, 'Native clients only'); return }
    const authTimer = setTimeout(() => socket.close(1008, 'Authentication timeout'), 5000)
    const inFlight = new Set<string>()
    let attempts = 0
    socket.on('error', () => { /* connection errors are isolated from the application */ })
    socket.on('close', () => { clearTimeout(authTimer); authenticated.delete(socket) })
    socket.on('message', async (buffer, binary) => {
      let id = ''
      let counted = false
      try {
        if (binary) throw new ControlError('INVALID_REQUEST', '只支持 JSON 文本消息')
        const body = JSON.parse(buffer.toString()) as { id?: unknown; type?: unknown; data?: unknown }
        if (!body || typeof body !== 'object' || Array.isArray(body) || typeof body.id !== 'string' || !body.id || body.id.length > 128) throw new ControlError('INVALID_REQUEST', 'id 必须是 1 到 128 个字符的字符串')
        id = body.id
        if (body.type === 'authenticate') {
          const token = (body.data as { token?: unknown } | undefined)?.token
          const a = Buffer.from(typeof token === 'string' ? token : '')
          const b = Buffer.from(config.token)
          if (a.length !== b.length || !timingSafeEqual(a, b)) {
            if (++attempts >= 3) socket.close(1008, 'Authentication failed')
            throw new ControlError('UNAUTHORIZED', '连接令牌不正确')
          }
          authenticated.add(socket)
          clearTimeout(authTimer)
          send(socket, { id, ok: true, data: { protocol: 'desktop-companion', version: 1 } })
          return
        }
        if (!authenticated.has(socket)) throw new ControlError('UNAUTHORIZED', '请先 authenticate')
        if (inFlight.has(id)) throw new ControlError('DUPLICATE_ID', '请求 id 正在使用')
        if (inFlight.size >= 8 || totalPending >= 32) throw new ControlError('BUSY', '同时执行的命令过多')
        const command = body.type === 'status.get' ? null : validateControlCommand(body.type, body.data ?? {})
        inFlight.add(id); totalPending++; counted = true
        const data = command ? await options.execute(command) : options.status()
        send(socket, { id, ok: true, data })
      } catch (error) {
        const err = error instanceof ControlError ? error : new ControlError('INVALID_REQUEST', error instanceof SyntaxError ? 'JSON 格式不正确' : error instanceof Error ? error.message : '命令失败')
        send(socket, { id, ok: false, error: { code: err.code, message: err.message } })
      } finally {
        if (counted) { inFlight.delete(id); totalPending-- }
      }
    })
  })
  const address = server.address()
  return {
    host: addressConfig.host,
    port: typeof address === 'object' && address ? address.port : config.port,
    emit: (type, data) => { for (const socket of authenticated) send(socket, { event: type, data }) },
    close: () => new Promise<void>(resolve => {
      for (const socket of server.clients) socket.terminate()
      server.close(() => resolve())
    })
  }
}
