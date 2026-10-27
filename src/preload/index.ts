import { contextBridge, ipcRenderer } from 'electron'
import { IPC } from '../shared/constants'
import type { AppConfig, ChatMessage, DeepPartial, DiaryEntry, ModelActionsInfo, ModelInfo, MusicInfo, SiyuanConfig, SiyuanNotebook, SiyuanSyncResult, TodoItem, TtsResult } from '../shared/types'

const api = {
  getConfig: (): Promise<AppConfig> => ipcRenderer.invoke(IPC.ConfigGet),
  setConfig: (patch: DeepPartial<AppConfig>): Promise<AppConfig> => ipcRenderer.invoke(IPC.ConfigSet, patch),

  chat: {
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
    speak: (text: string): Promise<TtsResult> => ipcRenderer.invoke(IPC.TtsSpeak, text)
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
      ipcRenderer.invoke(IPC.ModelsActions, model3Path)
  },

  music: {
    list: (): Promise<MusicInfo[]> => ipcRenderer.invoke(IPC.MusicList)
  },

  setClickThrough: (ignore: boolean): Promise<void> => ipcRenderer.invoke(IPC.PetSetClickThrough, ignore),
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
