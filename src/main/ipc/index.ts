import { Notification, ipcMain, screen } from 'electron'
import { IPC } from '../../shared/constants'
import type { AppConfig, ChatMessage, DeepPartial, DiaryEntry, SiyuanConfig, TodoItem, TtsConfig } from '../../shared/types'
import { getConfig, setConfig } from '../config'
import { getMainWindow, clampWindowPosition, setWindowPosition, applyFrameScale } from '../window'
import { streamChat } from '../services/llm'
import { probeServer, synthesize } from '../services/tts'
import { listNotebooks, syncDiary, syncTodoList, testConnection as siyuanTest } from '../services/siyuan'
import { discoverModelActions, listModels, modelsDir } from '../services/models'
import { listMusic, musicDir } from '../services/music'
import { openDataDir, openModelsDir, openMusicDir } from '../services/folders'
import { appRootDir } from '../paths'
import { dbAddChat, dbAddTodo, dbClearChat, dbDeleteDiary, dbDeleteTodo, dbListChat, dbListDiary, dbListTodos, dbSaveDiary, dbUpdateTodo } from '../services/db'

export function registerIpc(): void {
  // ---------- 配置 ----------
  ipcMain.handle(IPC.ConfigGet, () => getConfig())
  ipcMain.handle(IPC.ConfigSet, (_e, patch: DeepPartial<AppConfig>) => {
    const next = setConfig(patch)
    // 框架缩放：实时改窗口尺寸（模型随框架自动适配）
    if (typeof patch.pet?.frameScale === 'number') {
      const win = getMainWindow()
      if (win) applyFrameScale(win, patch.pet.frameScale)
    }
    return next
  })

  // ---------- 模型列表 ----------
  ipcMain.handle(IPC.ModelsList, () => listModels())
  ipcMain.handle(IPC.ModelsActions, (_e, model3Path: string) => discoverModelActions(model3Path))

  // ---------- 音乐列表 ----------
  ipcMain.handle(IPC.MusicList, () => listMusic())

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
  ipcMain.on(IPC.ChatStream, async (event, messages: ChatMessage[]) => {
    const wc = event.sender
    try {
      await streamChat(getConfig().llm, messages, (delta) => {
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
