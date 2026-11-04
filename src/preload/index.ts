import { contextBridge, ipcRenderer } from 'electron'
import { IPC } from '../shared/constants'
import type { ControlCommand, ControlReply, ModelCapabilities } from '../shared/control'
import type { AppConfig, ChatMessage, ChatPresentation, DeepPartial, DiaryEntry, ModelActionsInfo, ModelInfo, MusicInfo, SiyuanConfig, SiyuanNotebook, SiyuanSyncResult, TextureSizeInfo, TodoItem, TtsConfig, TtsResult } from '../shared/types'

const api = {
  control: {
    execute: (command: ControlCommand): Promise<unknown> => ipcRenderer.invoke(IPC.ControlExecute, command),
    status: (): Promise<{ enabled: boolean; listening: boolean; endpoint: string; host: string; port: number; modelReady: boolean; error?: string }> => ipcRenderer.invoke(IPC.ControlStatus),
    ready: (capabilities: ModelCapabilities | null): void => ipcRenderer.send(IPC.ControlReady, capabilities),
    reply: (reply: ControlReply): void => ipcRenderer.send(IPC.ControlReply, reply),
    emit: (type: string, data: unknown): void => ipcRenderer.send(IPC.ControlEvent, { type, data }),
    onCommand: (callback: (request: ControlCommand & { id: string }) => void): (() => void) => {
      const listener = (_event: unknown, request: ControlCommand & { id: string }): void => callback(request)
      ipcRenderer.on(IPC.ControlCommand, listener)
      return () => ipcRenderer.removeListener(IPC.ControlCommand, listener)
    },
    speechLevel: (speaking: boolean, level: number): void => ipcRenderer.send(IPC.SpeechLevel, { speaking, level }),
    onSpeechLevel: (callback: (payload: { speaking: boolean; level: number }) => void): (() => void) => {
      const listener = (_event: unknown, payload: { speaking: boolean; level: number }): void => callback(payload)
      ipcRenderer.on(IPC.SpeechLevel, listener)
      return () => ipcRenderer.removeListener(IPC.SpeechLevel, listener)
    }
  },
  getConfig: (): Promise<AppConfig> => ipcRenderer.invoke(IPC.ConfigGet),
  setConfig: (patch: DeepPartial<AppConfig>): Promise<AppConfig> => ipcRenderer.invoke(IPC.ConfigSet, patch),
  onConfigChanged: (cb: () => void): (() => void) => {
    const listener = (): void => cb()
    ipcRenderer.on(IPC.ConfigChanged, listener)
    return () => ipcRenderer.removeListener(IPC.ConfigChanged, listener)
  },

  chatWindow: {
    setOpen: (open: boolean): Promise<boolean> => ipcRenderer.invoke(IPC.ChatWindowSetOpen, open),
    getOpen: (): Promise<boolean> => ipcRenderer.invoke(IPC.ChatWindowGetOpen),
    dock: (): Promise<void> => ipcRenderer.invoke(IPC.ChatWindowDock),
    onState: (cb: (open: boolean) => void): (() => void) => {
      const listener = (_event: unknown, open: boolean): void => cb(open)
      ipcRenderer.on(IPC.ChatWindowState, listener)
      return () => ipcRenderer.removeListener(IPC.ChatWindowState, listener)
    },
    setSpeaking: (speaking: boolean): void => ipcRenderer.send(IPC.PetSpeaking, speaking),
    onSpeaking: (cb: (speaking: boolean) => void): (() => void) => {
      const listener = (_event: unknown, speaking: boolean): void => cb(speaking)
      ipcRenderer.on(IPC.PetSpeaking, listener)
      return () => ipcRenderer.removeListener(IPC.PetSpeaking, listener)
    }
  },

  chat: {
    present: (payload: ChatPresentation): void => ipcRenderer.send(IPC.ChatPresentation, payload),
    onPresentation: (callback: (payload: ChatPresentation) => void): (() => void) => {
      const listener = (_event: unknown, payload: ChatPresentation): void => callback(payload)
      ipcRenderer.on(IPC.ChatPresentation, listener)
      return () => ipcRenderer.removeListener(IPC.ChatPresentation, listener)
    },
    prompt: (target: 'chat' | 'agent' = 'chat'): Promise<string> => ipcRenderer.invoke(IPC.ChatPromptGet, target),
    send: (messages: ChatMessage[]): void => {
      ipcRenderer.send(IPC.ChatStream, messages)
    },
    onChunk: (cb: (delta: string) => void): (() => void) => {
      const listener = (_e: unknown, delta: string): void => cb(delta)
      ipcRenderer.on(IPC.ChatChunk, listener)
      return () => ipcRenderer.removeListener(IPC.ChatChunk, listener)
    },
    onDone: (cb: () => void): (() => void) => {
      const listener = (): void => cb()
      ipcRenderer.on(IPC.ChatDone, listener)
      return () => ipcRenderer.removeListener(IPC.ChatDone, listener)
    },
    onError: (cb: (err: string) => void): (() => void) => {
      const listener = (_e: unknown, err: string): void => cb(err)
      ipcRenderer.on(IPC.ChatError, listener)
      return () => ipcRenderer.removeListener(IPC.ChatError, listener)
    },
    history: {
      get: (): Promise<ChatMessage[]> => ipcRenderer.invoke(IPC.ChatHistoryGet),
      add: (msgs: ChatMessage[]): Promise<void> => ipcRenderer.invoke(IPC.ChatHistoryAdd, msgs),
      clear: (): Promise<void> => ipcRenderer.invoke(IPC.ChatHistoryClear)
    }
  },

  tts: {
    speak: (text: string): Promise<TtsResult> => ipcRenderer.invoke(IPC.TtsSpeak, text),
    /** 测试语音服务连通性（可传当前面板里的临时配置） */
    probe: (
      cfg?: TtsConfig
    ): Promise<{ ok: boolean; device?: string; styles?: string[]; error?: string }> =>
      ipcRenderer.invoke(IPC.TtsProbe, cfg)
  },

  todo: {
    list: (): Promise<TodoItem[]> => ipcRenderer.invoke(IPC.TodoList),
    add: (title: string): Promise<TodoItem> => ipcRenderer.invoke(IPC.TodoAdd, title),
    update: (item: TodoItem): Promise<TodoItem[]> => ipcRenderer.invoke(IPC.TodoUpdate, item),
    remove: (id: string): Promise<TodoItem[]> => ipcRenderer.invoke(IPC.TodoDelete, id)
  },

  diary: {
    list: (): Promise<DiaryEntry[]> => ipcRenderer.invoke(IPC.DiaryList),
    save: (entry: DiaryEntry): Promise<DiaryEntry> => ipcRenderer.invoke(IPC.DiarySave, entry),
    remove: (id: string): Promise<DiaryEntry[]> => ipcRenderer.invoke(IPC.DiaryDelete, id)
  },

  siyuan: {
    test: (cfg: SiyuanConfig): Promise<{ ok: boolean; version?: string }> => ipcRenderer.invoke(IPC.SiyuanTest, cfg),
    notebooks: (cfg?: SiyuanConfig): Promise<SiyuanNotebook[]> => ipcRenderer.invoke(IPC.SiyuanNotebooks, cfg ?? null),
    syncDiary: (entry: DiaryEntry): Promise<SiyuanSyncResult> => ipcRenderer.invoke(IPC.SiyuanSyncDiary, entry),
    syncTodo: (items: TodoItem[]): Promise<SiyuanSyncResult> => ipcRenderer.invoke(IPC.SiyuanSyncTodo, items)
  },

  models: {
    list: (): Promise<ModelInfo[]> => ipcRenderer.invoke(IPC.ModelsList),
    actions: (model3Path: string): Promise<ModelActionsInfo> =>
      ipcRenderer.invoke(IPC.ModelsActions, model3Path),
    /** 贴图尺寸（主进程读 PNG 文件头，比浏览器解码快得多） */
    textureSizes: (model3Path: string): Promise<TextureSizeInfo[]> =>
      ipcRenderer.invoke(IPC.ModelsTextureSizes, model3Path)
  },

  music: {
    list: (): Promise<MusicInfo[]> => ipcRenderer.invoke(IPC.MusicList)
  },

  /** 一键打开数据目录（在系统文件管理器里） */
  folders: {
    openModels: (): Promise<{ ok: boolean; path: string; error?: string }> =>
      ipcRenderer.invoke(IPC.OpenModelsDir),
    openMusic: (): Promise<{ ok: boolean; path: string; error?: string }> =>
      ipcRenderer.invoke(IPC.OpenMusicDir),
    openData: (): Promise<{ ok: boolean; path: string; error?: string }> =>
      ipcRenderer.invoke(IPC.OpenDataDir)
  },

  setClickThrough: (ignore: boolean): Promise<void> => ipcRenderer.invoke(IPC.PetSetClickThrough, ignore),
  onModelReset: (callback: () => void): (() => void) => {
    const listener = (): void => callback()
    ipcRenderer.on(IPC.PetResetModel, listener)
    return () => ipcRenderer.removeListener(IPC.PetResetModel, listener)
  },
  getPetPosition: (): Promise<[number, number]> => ipcRenderer.invoke(IPC.PetGetPosition),
  setPetPosition: (x: number, y: number): Promise<void> => ipcRenderer.invoke(IPC.PetSetPosition, x, y),
  clampPosition: (): Promise<void> => ipcRenderer.invoke(IPC.PetClampPosition),
  getCursor: (): Promise<{ cx: number; cy: number; winX: number; winY: number; winW: number; winH: number } | null> =>
    ipcRenderer.invoke(IPC.PetGetCursor),

  notify: (title: string, body: string): Promise<void> =>
    ipcRenderer.invoke(IPC.Notification, { title, body })
}

contextBridge.exposeInMainWorld('api', api)

export type Api = typeof api
