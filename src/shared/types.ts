// 主进程 / 渲染进程共享的类型定义

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
  /** 用于 TTS 的文本（通常是日语版）；为空则用 content */
  speakText?: string
}

/**
 * 角色设定：让同一个桌宠程序可以装不同的「角色」。
 * 换名字/称呼即可变成通用伴侣，聊天人设仍由 chat.persona 单独控制。
 */
export interface CharacterConfig {
  /** 角色名（显示在聊天标题、气泡署名、托盘提示） */
  name: string
  /** 角色自我介绍用的别名，可留空 */
  alias: string
  /** 聊天时角色的自称（气泡落款） */
  shortName: string
  /** 对用户的称呼 */
  userName: string
}

export interface HermesConfig {
  /** hermes-agent 的 OpenAI 兼容 API 服务地址，例如 http://127.0.0.1:8000 */
  baseUrl: string
  apiKey: string
  model: string
}

export interface TtsServerConfig {
  /** 未来「常驻 TTS 服务」模式的地址（当前用 command 模式，可留空） */
  baseUrl: string
  voice: string
}

export interface TtsConfig {
  /** command = 调外部语音脚本；server = 常驻 HTTP TTS 服务 */
  mode: 'command' | 'server'
  /** CosyVoice 的 python.exe 绝对路径 */
  python: string
  /** 语音脚本绝对路径（文件进/文件出） */
  script: string
  /** 子进程工作目录 */
  cwd: string
  /** auto=按是否含假名自动判断，zh/jp 强制 */
  lang: 'auto' | 'zh' | 'jp'
  speed: number
  timeoutMs: number
  server: TtsServerConfig
}

export interface SiyuanConfig {
  baseUrl: string
  token: string
  /** 日记同步目标笔记本 id（空 = 未选择） */
  diaryNotebook: string
  /** 待办同步目标笔记本 id（空 = 未选择） */
  todoNotebook: string
  /** 保存日记时自动同步到思源 */
  syncDiary: boolean
  /** 待办变更时自动同步到思源 */
  syncTodo: boolean
}

export interface PetConfig {
  /** Live2D 模型的 model3.json 路径；留空则用内置占位动画 */
  modelPath: string
  scale: number
  /** 整体不透明度 0.2~1（1 = 完全不透明） */
  opacity: number
  /** 框架缩放：整个窗口（桌宠框架）的倍率 0.5~2，模型随框架自动适配 */
  frameScale: number
  /** 点击穿透（穿透到桌面） */
  clickThrough: boolean
  /** 锁定：true 时进入调整模式（左键移窗 / 右键平移 / 滑条缩放） */
  locked: boolean
  /** 眼球追踪鼠标（眼睛跟随光标） */
  eyeTracking: boolean
  /** 眼球追踪幅度（乘数，1 = 默认） */
  eyeTrackingStrength: number
  /** 模型平移偏移（像素，右键拖动） */
  offsetX: number
  offsetY: number
  /** 窗口位置（左键拖动后记住；null = 未设置，用默认位置） */
  winX: number | null
  winY: number | null
}

export interface ChatConfig {
  /** 桌宠人设 / 对话规则（系统提示词主体） */
  persona: string
  /** 语音输出规则（告诉模型如何输出「日语：」行） */
  voiceRule: string
  /** 发送给 hermes 的历史消息条数上限 */
  historyLimit: number
}

export interface AppConfig {
  character: CharacterConfig
  hermes: HermesConfig
  tts: TtsConfig
  siyuan: SiyuanConfig
  pet: PetConfig
  chat: ChatConfig
}

export interface TtsResult {
  mime: string
  base64: string
}

export interface TodoItem {
  id: string
  title: string
  done: boolean
  createdAt: number
}

export interface DiaryEntry {
  id: string
  /** YYYY-MM-DD */
  date: string
  title: string
  content: string
  updatedAt: number
}

export interface ModelInfo {
  /** 模型目录名（显示用） */
  name: string
  /** 相对 public 的 model3.json 路径（渲染层加载用） */
  model3Path: string
}

/** 模型的一个「按键」动作（表情或动作） */
export interface ModelAction {
  /** 按钮显示名 */
  name: string
  kind: 'expression' | 'motion'
  /** 表情：文件相对路径 */
  file?: string
  /** 动作：分组名 */
  group?: string
  /** 动作：组内序号 */
  index?: number
}

/** 模型按键探测结果（modelJSON 为补全声明后的版本） */
export interface ModelActionsInfo {
  modelJSON: unknown | null
  expressions: ModelAction[]
  motions: ModelAction[]
}

/** 深层 Partial：允许只传嵌套对象里的部分字段（用于配置部分更新） */
export type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K]
}

export interface SiyuanNotebook {
  id: string
  name: string
}

/** 思源同步结果：skipped = 未启用同步/未选笔记本（本地照常保存，不算失败） */
export interface SiyuanSyncResult {
  ok: boolean
  skipped?: boolean
  error?: string
}

export interface MusicInfo {
  /** 歌曲显示名（去掉扩展名） */
  name: string
  /** 艺术家（元数据，可选） */
  artist?: string
  /** 相对 public 的音乐文件路径（渲染层加载用） */
  path: string
}
