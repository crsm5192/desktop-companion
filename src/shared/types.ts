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

/** 大模型接口配置（任意 OpenAI 兼容服务） */
export interface LlmConfig {
  /** 服务地址，例如 https://api.deepseek.com 或 http://127.0.0.1:8000（自动补 /v1/chat/completions） */
  baseUrl: string
  apiKey: string
  model: string
}

/**
 * 常驻语音服务（server 模式）的连接配置。
 * 不同实现的接口字段不一样，这里用 `apiStyle` 区分：
 *  - `openai`  ：POST {baseUrl}/v1/audio/speech，body {input, voice, style?, speed?, response_format}
 *  - `legacy`  ：POST {baseUrl}/tts，body {text, lang, speed}（早期版本用的简单接口）
 */
export interface TtsServerConfig {
  /** 服务地址，例如 http://10.147.18.250:8001（不要带尾部斜杠，会自动去掉） */
  baseUrl: string
  /** 接口风格 */
  apiStyle: 'openai' | 'legacy'
  /** openai 风格：voice 字段（多数实现里等价于"说话人/音色"，部分服务当风格用） */
  voice: string
  /** openai 风格：可选的情绪/风格名（如 amai / excited / whisper），留空则不发送 */
  style: string
  /** 可选鉴权：填了就在请求头里带 Authorization: Bearer <token> */
  token: string
  /** 请求超时（毫秒），语音合成可能较慢，默认给足 */
  timeoutMs: number
  /**
   * 服务端要求的语言（可留空 = 不做语言适配，原样发送）。
   * 很多 CosyVoice 部署只挂一种语言的 LoRA，收到别的语言会直接 400。
   * 填了它，客户端就会把文本朝这个语言做适配（见 `langAdapt`）。
   * 常见值：`jp` / `zh` / `en`
   */
  lang: string
  /**
   * 语言适配策略（当 `lang` 非空且文本不是该语言时生效）：
   *  - `off`      ：不做处理，原样发送（服务端可能报错）
   *  - `simplify` ：只把简体字换成该语言可接受的字形（默认，轻量、不改语义）
   *  - `kana`     ：把文本转成日语假名读音（仅 lang=jp 有意义）
   */
  langAdapt: 'off' | 'simplify' | 'kana'
  /** 是否在服务返回「语言不支持」时自动重试一次（用 simplify 适配后再发） */
  autoRetryOnLangError: boolean
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
  /** command 模式用：auto=按是否含假名自动判断，zh/jp 强制 */
  lang: 'auto' | 'zh' | 'jp'
  /** 语速倍率 */
  speed: number
  /** command 模式超时 */
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
  /** 发送给模型的历史消息条数上限 */
  historyLimit: number
}

export interface AppConfig {
  character: CharacterConfig
  llm: LlmConfig
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

/** 单张贴图的尺寸信息（由主进程读文件头得到，不经浏览器解码） */
export interface TextureSizeInfo {
  /** 相对 model3.json 的路径 */
  file: string
  width: number
  height: number
  /** 是否成功读到尺寸 */
  known: boolean
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
