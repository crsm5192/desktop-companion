// node scripts/control-demo.cjs --config <path-to-config.json>
const fs = require('node:fs')
const path = require('node:path')
const { WebSocket } = require('ws')
const argument = name => { const index = process.argv.indexOf(name); return index < 0 ? undefined : process.argv[index + 1] }
const file = argument('--config') || path.join(process.env.APPDATA || '', 'desktop-companion', 'config.json')
const config = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')).controlApi : {}
const token = process.env.DESKTOP_COMPANION_CONTROL_TOKEN || config?.token
const address = argument('--address') || (argument('--port') ? `ws://127.0.0.1:${Number(argument('--port'))}` : config?.endpoint || `ws://127.0.0.1:${config?.port || 18790}`)
if (!token) { console.error('请指定 --config 配置文件，或设置 DESKTOP_COMPANION_CONTROL_TOKEN。'); process.exit(1) }
const socket = new WebSocket(address)
const pending = new Map(); let sequence = 0
function request(type, data = {}) {
  return new Promise((resolve, reject) => {
    const id = String(++sequence)
    const timer = setTimeout(() => { pending.delete(id); reject(new Error('命令超时')) }, 10000)
    pending.set(id, { resolve, reject, timer })
    socket.send(JSON.stringify({ id, type, data }))
  })
}
socket.on('message', buffer => {
  const message = JSON.parse(buffer.toString())
  if (message.event) { console.log('事件:', message.event); return }
  const handler = pending.get(message.id)
  if (!handler) return
  pending.delete(message.id); clearTimeout(handler.timer)
  message.ok ? handler.resolve(message.data) : handler.reject(new Error(message.error.message))
})
socket.on('error', error => { console.error('连接失败:', error.message); process.exitCode = 1 })
socket.on('close', () => { for (const handler of pending.values()) { clearTimeout(handler.timer); handler.reject(new Error('连接已关闭')) } pending.clear() })
socket.on('open', async () => {
  try {
    await request('authenticate', { token })
    const model = await request('model.get')
    console.log(`模型: ${model.modelPath}；表情 ${model.expressions.length}；动作 ${model.motions.length}；参数 ${model.parameters.length}`)
    await request('performance.play', { emotion: 'shy', gesture: 'nod', gaze: { x: 0, y: 0 }, durationMs: 2500 })
    await new Promise(resolve => setTimeout(resolve, 3000))
    await request('gaze.set', { x: -0.8, y: 0.4, durationMs: 1500 })
    await new Promise(resolve => setTimeout(resolve, 2000))
    await request('control.reset')
    console.log('演示完成。')
  } catch (error) { console.error(error.message); process.exitCode = 1 }
  finally { socket.close() }
})
