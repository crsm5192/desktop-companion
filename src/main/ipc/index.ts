import { Notification, ipcMain, screen } from 'electron'
import { IPC } from '../../shared/constants'
import type { AppConfig, ChatMessage, ChatPresentation, DeepPartial, DiaryEntry, ModelAction, SiyuanConfig, TodoItem, TtsConfig } from '../../shared/types'
import { getConfig, setConfig } from '../config'
import { getMainWindow, clampWindowPosition, setWindowPosition } from '../window'
import { applyPetWindowSettings, broadcastConfigChanged } from '../petSettings'
import { refreshTrayMenu } from '../tray'
import { dockChatWindow, getChatWindow, isChatOpen, setChatOpen } from '../chatWindow'
import { dockPanelWindow, getPanelWindow, getPanelWindowState, setPanelOpen, updatePanelOpacity } from '../panelWindows'
import { isPanelWindowName } from '../../shared/panelWindows'
import type { MusicPlaybackCommand, MusicPlaybackState } from '../../shared/music'
import { streamChat } from '../services/llm'
import { configureControlApi, getModelCapabilities } from '../services/control'
import { buildChatSystemPrompt, prepareChatMessages } from '../services/chatPrompt'
import { probeServer, synthesize } from '../services/tts'
import { listNotebooks, syncDiary, syncTodoList, testConnection as siyuanTest } from '../services/siyuan'
import { discoverModelActions, getModelTextureSizes, listModels, modelsDir } from '../services/models'
import { listMusic, musicDir } from '../services/music'
import { openDataDir, openModelsDir, openMusicDir } from '../services/folders'
import { appRootDir } from '../paths'
import { dbAddChat, dbAddTodo, dbClearChat, dbDeleteDiary, dbDeleteTodo, dbListChat, dbListDiary, dbListTodos, dbSaveDiary, dbUpdateTodo } from '../services/db'

export function registerIpc(): void {
  // ---------- 配置 ----------
  ipcMain.handle(IPC.ConfigGet, () => getConfig())
  ipcMain.handle(IPC.ChatPromptGet, (_event, target?: unknown) => buildChatSystemPrompt(getConfig(), getModelCapabilities(), target === 'agent' ? 'agent' : 'chat'))
  ipcMain.handle(IPC.ConfigSet, async (_e, patch: DeepPartial<AppConfig>) => {
    setConfig(patch)
    if (patch.controlApi) await configureControlApi()
    applyPetWindowSettings(patch.pet)
    if (patch.pet?.panelOpacity !== undefined) updatePanelOpacity()
    refreshTrayMenu()
    broadcastConfigChanged()
    return getConfig()
  })

  // ---------- 模型列表 ----------
  ipcMain.handle(IPC.ModelsList, () => listModels())
  ipcMain.handle(IPC.ModelsActions, (_e, model3Path: string) => discoverModelActions(model3Path))
  ipcMain.handle(IPC.ModelsRunAction, (event, action: ModelAction) => {
    if (event.sender !== getPanelWindow('actions')?.webContents || !action) throw new Error('无效的窗口')
    const model = getModelCapabilities()
    if (!model) throw new Error('请先加载 Live2D 模型')
    const actions = action.kind === 'expression' ? model.expressions : action.kind === 'motion' ? model.motions : []
    const known = actions.find(item => item.name === action.name && item.group === action.group && item.index === action.index)
    if (!known) throw new Error('模型中没有这个表情或动作')
    getMainWindow()?.webContents.send(IPC.ModelsRunAction, known)
  })
  // 贴图尺寸（主进程读 PNG 文件头，避免 app:// 下 fetch 不可用的问题）
  ipcMain.handle(IPC.ModelsTextureSizes, (_e, model3Path: string) => getModelTextureSizes(model3Path))

  // ---------- 音乐列表 ----------
  ipcMain.handle(IPC.MusicList, () => listMusic())
  let playback: MusicPlaybackState = { songs: [], index: -1, playing: false, shuffle: false, progress: 0, duration: 0 }
  ipcMain.handle(IPC.MusicPlaybackGet, () => playback)
  ipcMain.on(IPC.MusicPlaybackState, (event, state: MusicPlaybackState) => {
    if (event.sender !== getMainWindow()?.webContents) return
    playback = state
    getPanelWindow('music')?.webContents.send(IPC.MusicPlaybackState, state)
  })
  ipcMain.on(IPC.MusicPlaybackCommand, (event, command: MusicPlaybackCommand) => {
    if (event.sender !== getPanelWindow('music')?.webContents || !command) return
    if (command.type === 'play' || command.type === 'seek') {
      if (!Number.isFinite(command.value) || command.value < 0) return
      if (command.type === 'seek' && command.value > 1) return
      if (command.type === 'play' && !Number.isInteger(command.value)) return
    } else if (!['loadSongs', 'togglePlay', 'next', 'prev', 'toggleShuffle'].includes(command.type)) return
    getMainWindow()?.webContents.send(IPC.MusicPlaybackCommand, command)
  })
  ipcMain.handle(IPC.PanelWindowSetOpen, (_event, name: unknown, open: boolean) => {
    if (!isPanelWindowName(name)) throw new Error('未知窗口')
    return setPanelOpen(name, open === true)
  })
  ipcMain.handle(IPC.PanelWindowGetState, () => getPanelWindowState())
  ipcMain.handle(IPC.PanelWindowDock, (_event, name: unknown) => {
    if (!isPanelWindowName(name)) throw new Error('未知窗口')
    dockPanelWindow(name)
  })

  // ---------- 一键打开数据目录（模型 / 音乐 / 配置） ----------
  ipcMain.handle(IPC.OpenModelsDir, () => openModelsDir(modelsDir()))
  ipcMain.handle(IPC.OpenMusicDir, () => openMusicDir(musicDir()))
  ipcMain.handle(IPC.OpenDataDir, () => openDataDir(appRootDir()))

  // ---------- 点击穿透 ----------
  ipcMain.handle(IPC.PetSetClickThrough, (_e, ignore: boolean) => {
    getMainWindow()?.setIgnoreMouseEvents(ignore, { forward: true })
  })

  // ---------- 窗口位置（锁定模式下拖动移动宠物） ----------
  ipcMain.handle(IPC.PetGetPosition, () => getMainWindow()?.getPosition() ?? [0, 0])
  ipcMain.handle(IPC.PetSetPosition, (_e, x: number, y: number) => {
    const win = getMainWindow()
    if (win) setWindowPosition(win, x, y)
  })

  // 钳制窗口位置（松手/屏幕变化后调用一次，避免拖动中每帧钳制导致晃动）
  ipcMain.handle(IPC.PetClampPosition, () => {
    const win = getMainWindow()
    if (win) clampWindowPosition(win)
  })

  // ---------- 屏幕光标 + 窗口边界（眼睛追踪用） ----------
  ipcMain.handle(IPC.PetGetCursor, () => {
    const win = getMainWindow()
    if (!win) return null
    const [x, y] = win.getPosition()
    const [w, h] = win.getSize()
    const c = screen.getCursorScreenPoint()
    return { cx: c.x, cy: c.y, winX: x, winY: y, winW: w, winH: h }
  })

  // ---------- 对话（流式） ----------
  ipcMain.handle(IPC.ChatWindowSetOpen, (_event, open: boolean) => setChatOpen(open === true))
  ipcMain.handle(IPC.ChatWindowGetOpen, () => isChatOpen())
  ipcMain.handle(IPC.ChatWindowDock, () => dockChatWindow())
  ipcMain.on(IPC.ChatPresentation, (event, payload: ChatPresentation) => {
    if (event.sender !== getChatWindow()?.webContents || !payload) return
    if (!['start', 'progress', 'end', 'clear'].includes(payload.type)) return
    if (payload.type !== 'clear' && (typeof payload.id !== 'string' || payload.id.length > 128)) return
    if (payload.type === 'start' && (typeof payload.text !== 'string' || payload.text.length > 100000 || typeof payload.speaking !== 'boolean' || !Number.isFinite(payload.durationMs))) return
    if (payload.type === 'progress' && (!Number.isFinite(payload.progress) || payload.progress < 0 || payload.progress > 1)) return
    getMainWindow()?.webContents.send(IPC.ChatPresentation, payload)
  })
  ipcMain.on(IPC.PetSpeaking, (event, speaking: boolean) => {
    if (event.sender === getChatWindow()?.webContents) getMainWindow()?.webContents.send(IPC.PetSpeaking, speaking === true)
  })
  ipcMain.on(IPC.SpeechLevel, (event, payload: { speaking: boolean; level: number }) => {
    if (event.sender !== getChatWindow()?.webContents) return
    if (!payload || typeof payload.speaking !== 'boolean' || !Number.isFinite(payload.level)) return
    getMainWindow()?.webContents.send(IPC.SpeechLevel, { speaking: payload.speaking, level: Math.max(0, Math.min(1, payload.level)) })
  })
  ipcMain.on(IPC.ChatStream, async (event, messages: ChatMessage[]) => {
    const wc = event.sender
    try {
      const config = getConfig()
      const prepared = prepareChatMessages(messages, config, getModelCapabilities())
      await streamChat(config.llm, prepared, (delta) => {
        if (!wc.isDestroyed()) wc.send(IPC.ChatChunk, delta)
      })
      if (!wc.isDestroyed()) wc.send(IPC.ChatDone)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      if (!wc.isDestroyed()) wc.send(IPC.ChatError, msg)
    }
  })

  // ---------- 聊天历史（SQLite） ----------
  ipcMain.handle(IPC.ChatHistoryGet, () => dbListChat())
  ipcMain.handle(IPC.ChatHistoryAdd, (_e, msgs: ChatMessage[]) => dbAddChat(msgs))
  ipcMain.handle(IPC.ChatHistoryClear, () => dbClearChat())

  // ---------- TTS ----------
  ipcMain.handle(IPC.TtsSpeak, (_e, text: string) => synthesize(getConfig().tts, text))
  // 测试连接：允许传入临时配置（设置面板里改了地址还没保存也能测）
  ipcMain.handle(IPC.TtsProbe, (_e, cfg?: TtsConfig) => probeServer(cfg ?? getConfig().tts))

  // ---------- Todo ----------
  ipcMain.handle(IPC.TodoList, () => dbListTodos())
  ipcMain.handle(IPC.TodoAdd, (_e, title: string) => dbAddTodo(title))
  ipcMain.handle(IPC.TodoUpdate, (_e, patch: TodoItem) => dbUpdateTodo(patch))
  ipcMain.handle(IPC.TodoDelete, (_e, id: string) => dbDeleteTodo(id))

  // ---------- 日记 ----------
  ipcMain.handle(IPC.DiaryList, () => dbListDiary())
  ipcMain.handle(IPC.DiarySave, (_e, entry: DiaryEntry) => dbSaveDiary(entry))
  ipcMain.handle(IPC.DiaryDelete, (_e, id: string) => dbDeleteDiary(id))

  // ---------- 思源 ----------
  ipcMain.handle(IPC.SiyuanTest, (_e, cfg: SiyuanConfig) => siyuanTest(cfg))
  ipcMain.handle(IPC.SiyuanNotebooks, (_e, cfg?: SiyuanConfig) => listNotebooks(cfg ?? getConfig().siyuan))
  ipcMain.handle(IPC.SiyuanSyncDiary, (_e, entry: DiaryEntry) => syncDiary(getConfig().siyuan, entry))
  ipcMain.handle(IPC.SiyuanSyncTodo, (_e, items: TodoItem[]) => syncTodoList(getConfig().siyuan, items))

  // ---------- 系统通知 ----------
  ipcMain.handle(IPC.Notification, (_e, { title, body }: { title: string; body: string }) => {
    if (Notification.isSupported()) new Notification({ title, body }).show()
  })
}
