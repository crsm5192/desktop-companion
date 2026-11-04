import type { ModelAction } from './types'

export const EMOTIONS = ['neutral', 'happy', 'sad', 'shy', 'surprised', 'thinking', 'angry'] as const
export const GESTURES = ['nod', 'shake', 'wave', 'blink'] as const
export type Emotion = typeof EMOTIONS[number]
export type Gesture = typeof GESTURES[number]
export interface PerformanceCue {
  emotion?: Emotion
  gesture?: Gesture
  gaze?: { x: number; y: number }
  intensity?: number
  durationMs?: number
}
export interface ControlApiConfig { enabled: boolean; endpoint?: string; listenHost?: string; port: number; token: string }
export function controlEndpoint(config: Pick<ControlApiConfig, 'endpoint' | 'port'>): string {
  return config.endpoint ?? `ws://127.0.0.1:${config.port}`
}
export function parseControlEndpoint(value: string): { endpoint: string; host: string; port: number } {
  let url: URL
  if (typeof value !== 'string' || /[\r\n\t]/.test(value)) throw new ControlError('INVALID_ENDPOINT', '请输入完整的 Agent 连接地址')
  try { url = new URL(value) } catch { throw new ControlError('INVALID_ENDPOINT', '请输入完整的控制接口地址，例如 ws://127.0.0.1:18790') }
  if (!['ws:', 'wss:'].includes(url.protocol) || !url.hostname || ['0.0.0.0', '[::]'].includes(url.hostname) || url.username || url.password || url.search || url.hash) {
    throw new ControlError('INVALID_ENDPOINT', 'Agent 地址须使用 ws:// 或 wss:// 和可连接的 IP 或域名；不能使用 0.0.0.0、账号密码或查询参数')
  }
  const port = Number(url.port || (url.protocol === 'wss:' ? 443 : 80))
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new ControlError('INVALID_ENDPOINT', 'Agent 连接端口必须是 1 到 65535 的整数')
  return { endpoint: `${url.protocol}//${url.host}${url.pathname === '/' ? '' : url.pathname}`, host: url.hostname.replace(/^\[|\]$/g, ''), port }
}
const LOOPBACK_HOSTS = ['127.0.0.1', 'localhost', '::1']
export function controlListenAddress(config: ControlApiConfig, allowEphemeral = false): { host: string; port: number } {
  const legacyHost = config.listenHost === undefined && config.endpoint ? parseControlEndpoint(config.endpoint).host : '127.0.0.1'
  const host = config.listenHost ?? (LOOPBACK_HOSTS.includes(legacyHost) ? legacyHost : '127.0.0.1')
  if (!['127.0.0.1', 'localhost', '::1', '0.0.0.0', '::'].includes(host)) throw new ControlError('INVALID_LISTEN_HOST', '监听范围须为本机或所有网络接口')
  if (!Number.isInteger(config.port) || (config.port < 1024 && !(allowEphemeral && config.port === 0)) || config.port > 65535) throw new ControlError('INVALID_PORT', '监听端口必须是 1024 到 65535 的整数')
  return { host, port: config.port }
}
export function mergeControlApi(base: ControlApiConfig, patch: Partial<ControlApiConfig> = {}): ControlApiConfig {
  // Configurations saved before listenHost coupled a loopback URL to the listening port.
  const legacy = base.listenHost === undefined && patch.listenHost === undefined
  let endpoint = patch.endpoint ?? controlEndpoint(base)
  const previous = parseControlEndpoint(controlEndpoint(base))
  if (patch.endpoint === undefined && patch.port !== undefined && LOOPBACK_HOSTS.includes(previous.host) && previous.port === base.port) {
    controlListenAddress({ ...base, port: patch.port })
    const previous = new URL(endpoint)
    previous.port = String(patch.port)
    endpoint = previous.toString()
  }
  const parsed = parseControlEndpoint(endpoint)
  const port = legacy && LOOPBACK_HOSTS.includes(parsed.host) ? parsed.port : patch.port ?? base.port
  const listenHost = patch.listenHost ?? base.listenHost ?? (LOOPBACK_HOSTS.includes(parsed.host) ? parsed.host : '127.0.0.1')
  const result = { ...base, ...patch, endpoint: parsed.endpoint, listenHost, port }
  controlListenAddress(result)
  return result
}
export interface ModelParameter { id: string; minimum: number; maximum: number; default: number; value: number }
export interface ModelCapabilities {
  modelPath: string
  expressions: ModelAction[]
  motions: ModelAction[]
  parameters: ModelParameter[]
  emotions: readonly Emotion[]
  gestures: readonly Gesture[]
}
export type ControlCommand =
  | { type: 'model.get'; data: Record<string, never> }
  | { type: 'expression.set'; data: { name: string; durationMs?: number } }
  | { type: 'motion.play'; data: { name: string; durationMs?: number } }
  | { type: 'gaze.set'; data: { x: number; y: number; durationMs?: number } }
  | { type: 'parameters.set'; data: { values: Array<{ id: string; value: number }>; durationMs?: number } }
  | { type: 'performance.play'; data: PerformanceCue }
  | { type: 'speech.play'; data: { text: string; performance?: PerformanceCue } }
  | { type: 'control.reset'; data: Record<string, never> }
export interface ControlReply { id: string; ok: boolean; data?: unknown; error?: { code: string; message: string } }
export class ControlError extends Error {
  constructor(public code: string, message: string) { super(message) }
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ControlError('INVALID_REQUEST', 'data 必须是对象')
  return value as Record<string, unknown>
}
function number(value: unknown, min: number, max: number, name: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
    throw new ControlError('INVALID_REQUEST', `${name} 必须在 ${min} 到 ${max} 之间`)
  }
  return value
}
function text(value: unknown, max: number, name: string): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new ControlError('INVALID_REQUEST', `${name} 不能为空且不能超过 ${max} 个字符`)
  return value
}
function duration(data: Record<string, unknown>): { durationMs?: number } {
  return data.durationMs === undefined ? {} : { durationMs: number(data.durationMs, 300, 30000, 'durationMs') }
}
export function validatePerformance(value: unknown): PerformanceCue {
  const data = object(value)
  const result: PerformanceCue = duration(data)
  if (data.emotion !== undefined) {
    if (!EMOTIONS.includes(data.emotion as Emotion)) throw new ControlError('INVALID_REQUEST', '不支持的情绪')
    result.emotion = data.emotion as Emotion
  }
  if (data.gesture !== undefined) {
    if (!GESTURES.includes(data.gesture as Gesture)) throw new ControlError('INVALID_REQUEST', '不支持的动作')
    result.gesture = data.gesture as Gesture
  }
  if (data.gaze !== undefined) {
    const gaze = object(data.gaze)
    result.gaze = { x: number(gaze.x, -1, 1, 'gaze.x'), y: number(gaze.y, -1, 1, 'gaze.y') }
  }
  if (data.intensity !== undefined) result.intensity = number(data.intensity, 0, 1, 'intensity')
  return result
}
export function validateControlCommand(type: unknown, value: unknown = {}): ControlCommand {
  const data = object(value)
  switch (type) {
    case 'model.get': case 'control.reset': return { type, data: {} }
    case 'expression.set': return { type, data: { name: text(data.name, 256, 'name'), ...duration(data) } }
    case 'motion.play': return { type, data: { name: text(data.name, 256, 'name'), ...duration(data) } }
    case 'gaze.set': return { type, data: { x: number(data.x, -1, 1, 'x'), y: number(data.y, -1, 1, 'y'), ...duration(data) } }
    case 'parameters.set': {
      if (!Array.isArray(data.values) || !data.values.length || data.values.length > 64) throw new ControlError('INVALID_REQUEST', 'values 必须包含 1 到 64 个参数')
      const values = data.values.map(v => {
        const item = object(v)
        return { id: text(item.id, 256, 'id'), value: number(item.value, -1000000, 1000000, 'value') }
      })
      return { type, data: { values, ...duration(data) } }
    }
    case 'performance.play': return { type, data: validatePerformance(data) }
    case 'speech.play': return { type, data: { text: text(data.text, 4000, 'text'), ...(data.performance === undefined ? {} : { performance: validatePerformance(data.performance) }) } }
    default: throw new ControlError('UNKNOWN_COMMAND', '不支持的命令')
  }
}

/** Remove complete and unfinished control tags while streaming, without exposing them in chat/TTS. */
export function extractPerformance(raw: string): { text: string; performance?: PerformanceCue } {
  let performance: PerformanceCue | undefined
  const clean = raw.replace(/<performance>\s*([\s\S]*?)\s*<\/performance>/gi, (_all, json: string) => {
    try { performance = validatePerformance(JSON.parse(json)) } catch { /* malformed cues are ignored */ }
    return ''
  }).replace(/<performance>[\s\S]*$/gi, '').replace(/<(?:p(?:e(?:r(?:f(?:o(?:r(?:m(?:a(?:n(?:c(?:e)?)?)?)?)?)?)?)?)?)?)?$/i, '')
  return { text: clean.trim(), performance }
}

export const PERFORMANCE_PROMPT = `每次回复可在最后追加一行 <performance>{"emotion":"happy","gesture":"nod","gaze":{"x":0,"y":0},"intensity":0.6,"durationMs":3500}</performance>。
这是桌宠表演指令，不要解释或朗读。emotion 只选 neutral/happy/sad/shy/surprised/thinking/angry；gesture 可省略，只选 nod/shake/wave/blink；gaze 可省略，x/y 范围 -1 到 1（右/上为正）；intensity 为 0 到 1；durationMs 为 300 到 10000。按语义选择，避免每句话都做动作。日语语音行保持原有格式。`
