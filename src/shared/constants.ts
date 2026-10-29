// IPC 通道名统一定义，避免主/渲染两端字符串漂移
export const IPC = {
  ConfigGet: 'config:get',
  ConfigSet: 'config:set',

  ModelsList: 'models:list',
  ModelsActions: 'models:actions',
  MusicList: 'music:list',

  ChatStream: 'chat:stream',
  ChatChunk: 'chat:chunk',
  ChatDone: 'chat:done',
  ChatError: 'chat:error',
  ChatHistoryGet: 'chat:history:get',
  ChatHistoryAdd: 'chat:history:add',
  ChatHistoryClear: 'chat:history:clear',

  TtsSpeak: 'tts:speak',
  TtsProbe: 'tts:probe',

  TodoList: 'todo:list',
  TodoAdd: 'todo:add',
  TodoUpdate: 'todo:update',
  TodoDelete: 'todo:delete',

  DiaryList: 'diary:list',
  DiarySave: 'diary:save',
  DiaryDelete: 'diary:delete',

  SiyuanTest: 'siyuan:test',
  SiyuanNotebooks: 'siyuan:notebooks',
  SiyuanSyncDiary: 'siyuan:sync-diary',
  SiyuanSyncTodo: 'siyuan:sync-todo',

  PetSetClickThrough: 'pet:set-click-through',
  PetGetPosition: 'pet:get-position',
  PetSetPosition: 'pet:set-position',
  PetClampPosition: 'pet:clamp-position',
  PetGetCursor: 'pet:get-cursor',

  Notification: 'app:notify'
} as const

export type IpcChannel = (typeof IPC)[keyof typeof IPC]
