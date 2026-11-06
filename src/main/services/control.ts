import { app, ipcMain } from 'electron'
import { randomUUID } from 'node:crypto'
import { IPC } from '../../shared/constants'
import { ControlError, controlEndpoint, controlListenAddress, validateControlCommand, type ControlCommand, type ControlReply, type ModelCapabilities } from '../../shared/control'
import { getConfig } from '../config'
import { getMainWindow, createMainWindow } from '../window'
import { getChatWindow } from '../chatWindow'
import { getPanelWindow } from '../panelWindows'
import { createControlServer } from './controlServer'

let server: Awaited<ReturnType<typeof createControlServer>> | null = null
let model: ModelCapabilities | null = null
let error = ''
let configuration = ''
let restarting = Promise.resolve()
const pending = new Map<string, { resolve: (data: unknown) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>()
function failPending(): void {
  for (const request of pending.values()) { clearTimeout(request.timer); request.reject(new ControlError('MODEL_NOT_READY', '模型已卸载')) }
  pending.clear()
}
export function controlStatus() {
  const config = getConfig().controlApi
  const address = controlListenAddress(config)
  return { enabled: config.enabled, listening: !!server, endpoint: controlEndpoint(config), host: server?.host ?? address.host, port: server?.port ?? address.port, modelReady: !!model, modelPath: model?.modelPath ?? null, error: error || undefined }
}
export function getModelCapabilities(): ModelCapabilities | null { return model }
function dispatch(command: ControlCommand): Promise<unknown> {
  if (!model) return Promise.reject(new ControlError('MODEL_NOT_READY', '请先加载 Live2D 模型'))
  const window = getMainWindow()
  if (!window || window.isDestroyed() || window.webContents.isDestroyed()) return Promise.reject(new ControlError('MODEL_NOT_READY', '模型窗口不可用'))
  if (pending.size >= 32) return Promise.reject(new ControlError('BUSY', '同时执行的命令过多'))
  return new Promise((resolve, reject) => {
    const id = randomUUID()
    const timer = setTimeout(() => { pending.delete(id); reject(new ControlError('TIMEOUT', '模型执行超时')) }, command.type === 'speech.play' ? 180000 : 10000)
    pending.set(id, { resolve, reject, timer })
    window.webContents.send(IPC.ControlCommand, { id, ...command })
  })
}
export function configureControlApi(): Promise<void> {
  restarting = restarting.then(async () => {
    const config = { ...getConfig().controlApi }
    const key = JSON.stringify(config)
    if (configuration === key) return
    configuration = key
    const previous = server; server = null
    await previous?.close()
    error = ''
    if (!config.enabled) return
    try { server = await createControlServer({ config, execute: dispatch, status: controlStatus }) }
    catch (err) { error = err instanceof Error ? err.message : String(err); console.error('[control-api] 无法开启端口:', error); configuration = '' }
  })
  return restarting
}
export function registerControlIpc(): void {
  ipcMain.handle(IPC.ControlStatus, () => controlStatus())
  ipcMain.handle(IPC.ControlExecute, (event, command: ControlCommand) => {
    const actionsWindow = event.sender === getPanelWindow('actions')?.webContents
    if (actionsWindow && command?.type !== 'model.get') throw new Error('无效的表情指令')
    if (!actionsWindow && event.sender !== getChatWindow()?.webContents && event.sender !== getMainWindow()?.webContents) throw new Error('无效的窗口')
    return dispatch(validateControlCommand(command?.type, command?.data))
  })
  ipcMain.on(IPC.ControlReply, (event, reply: ControlReply) => {
    if (event.sender !== getMainWindow()?.webContents) return
    const request = pending.get(reply.id)
    if (!request) return
    pending.delete(reply.id); clearTimeout(request.timer)
    if (reply.ok) request.resolve(reply.data)
    else request.reject(new ControlError(reply.error?.code ?? 'EXECUTION_FAILED', reply.error?.message ?? '执行失败'))
  })
  ipcMain.on(IPC.ControlReady, (event, capabilities: ModelCapabilities | null) => {
    if (event.sender !== getMainWindow()?.webContents) return
    model = capabilities
    if (!model) failPending()
    getPanelWindow('actions')?.webContents.send(IPC.ConfigChanged)
    server?.emit('model.changed', { ready: !!model, modelPath: model?.modelPath ?? null })
  })
  ipcMain.on(IPC.ControlEvent, (event, payload: { type: string; data: unknown }) => {
    if (event.sender === getMainWindow()?.webContents || (event.sender === getChatWindow()?.webContents && ['speech.started', 'speech.finished'].includes(payload.type))) server?.emit(payload.type, payload.data)
  })
  app.on('before-quit', () => { failPending(); void server?.close(); server = null })
}
export function bindControlWindow(): void {
  const window = getMainWindow() ?? createMainWindow()
  const invalidate = (): void => { model = null; failPending(); getPanelWindow('actions')?.webContents.send(IPC.ConfigChanged); server?.emit('model.changed', { ready: false }) }
  window.webContents.on('did-start-loading', invalidate)
  window.webContents.on('render-process-gone', invalidate)
  window.on('closed', invalidate)
}
