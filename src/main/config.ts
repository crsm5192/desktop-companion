import { app } from 'electron'
import { randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { AppConfig, DeepPartial } from '../shared/types'
import { mergeControlApi } from '../shared/control'
import { externalConfigFile } from './paths'

// 默认配置 —— 请按你自己的环境修改（也可在设置面板或 config.json 里改）：
// - character：角色设定（名字/称呼），换掉这里就能装别的角色
// - llm   ：任意 OpenAI 兼容对话接口（OpenAI / DeepSeek / 智谱 / 本地 vLLM 等）
// - tts   ：语音合成（server 模式 = 常驻 HTTP 服务；command 模式 = CLI 脚本）
// - siyuan：思源内核 HTTP API（默认 6806）
const DEFAULT_CONFIG: AppConfig = {
  character: {
    name: '桌面伴侣',
    alias: '',
    shortName: '伴侣',
    userName: '你'
  },
  llm: {
    baseUrl: 'https://api.deepseek.com',
    apiKey: '',
    model: 'deepseek-chat'
  },
  tts: {
    mode: 'server', // server = 常驻 TTS 服务（推荐）；command = 每句 spawn 语音脚本（备用）
    python: '',
    script: '',
    cwd: '',
    lang: 'auto',
    speed: 1.0,
    timeoutMs: 300000,
    server: {
      baseUrl: 'http://127.0.0.1:8001',
      apiStyle: 'openai',
      voice: 'jp',
      style: '',
      token: '',
      timeoutMs: 120000,
      /** 服务端要求的语言，留空 = 不做适配（原样发送） */
      lang: 'jp',
      langAdapt: 'simplify',
      autoRetryOnLangError: true
    }
  },
  siyuan: {
    baseUrl: 'http://127.0.0.1:6806',
    token: '',
    diaryNotebook: '',
    todoNotebook: '',
    syncDiary: false,
    syncTodo: false
  },
  pet: {
    modelPath: '', // 留空 = CSS 占位；填 public/models 下 model3.json 的相对路径启用 Live2D
    scale: 1.0,
    opacity: 1.0,
    panelOpacity: 1.0,
    frameScale: 1.0,
    clickThrough: false,
    locked: false,
    interactionEnabled: false,
    edgeSnapEnabled: false,
    eyeTracking: true,
    eyeTrackingStrength: 1.0,
    offsetX: 0,
    offsetY: 0,
    winX: null,
    winY: null
  },
  chat: {
    performanceEnabled: true,
    persona: `你是一个可爱的二次元桌宠伴侣，住在用户电脑桌面上。
要求：
1. 用中文聊天，语气自然亲切、有温度，像一个关心用户的朋友。
2. 回复正文里绝对不要出现：文件路径、🎧 符号、「语音」字样、「翻译」字样、不要生成或提及任何音频文件。`,
    voiceRule: `在回复的最后一行，单独写「日语：」开头，给出这段回复的日语口语版（用于语音合成）。日语要自然，不要敬语腔。`,
    historyLimit: 30
  },
  controlApi: { enabled: true, endpoint: 'ws://127.0.0.1:18790', port: 18790, token: '' }
}

let cache: AppConfig | null = null

function configFile(): string {
  // 便携：打包后 config.json 放 exe 旁边；开发用 userData
  return app.isPackaged ? externalConfigFile() : join(app.getPath('userData'), 'config.json')
}

function mergeConfig(base: AppConfig, patch: DeepPartial<AppConfig>): AppConfig {
  return {
    character: { ...base.character, ...(patch.character ?? {}) },
    llm: { ...base.llm, ...(patch.llm ?? {}) },
    tts: { ...base.tts, ...(patch.tts ?? {}), server: { ...base.tts.server, ...(patch.tts?.server ?? {}) } },
    siyuan: { ...base.siyuan, ...(patch.siyuan ?? {}) },
    pet: { ...base.pet, ...(patch.pet ?? {}) },
    chat: { ...base.chat, ...(patch.chat ?? {}) },
    controlApi: mergeControlApi(base.controlApi, patch.controlApi)
  }
}

/**
 * 兼容旧版配置：老版本把对话接口配置存在 `hermes` 段，现在改名为 `llm`。
 * 载入时若发现只有 `hermes` 就自动映射过去，避免用户升级后接口失效。
 */
function migrateLegacyKeys(raw: Record<string, unknown>): Record<string, unknown> {
  const out = { ...raw }
  // Preserve the appearance of windows that previously shared the pet's opacity.
  if (out.pet && typeof out.pet === 'object' && !Array.isArray(out.pet)) {
    const pet = out.pet as Record<string, unknown>
    if (pet.panelOpacity === undefined && typeof pet.opacity === 'number' && Number.isFinite(pet.opacity)) {
      out.pet = { ...pet, panelOpacity: pet.opacity }
    }
  }
  if (!out.llm && out.hermes) {
    out.llm = out.hermes
    delete out.hermes
  }
  return out
}

export function getConfig(): AppConfig {
  if (cache) return cache
  const f = configFile()
  let loaded = mergeConfig(DEFAULT_CONFIG, {})
  try {
    if (existsSync(f)) {
      const raw = JSON.parse(readFileSync(f, 'utf-8')) as Record<string, unknown>
      loaded = mergeConfig(DEFAULT_CONFIG, migrateLegacyKeys(raw) as Partial<AppConfig>)
    }
  } catch (e) {
    console.error('[config] 读取失败，回退默认配置：', e)
  }
  if (!loaded.controlApi.token) {
    loaded = { ...loaded, controlApi: { ...loaded.controlApi, token: randomBytes(24).toString('hex') } }
    mkdirSync(dirname(f), { recursive: true })
    writeFileSync(f, JSON.stringify(loaded, null, 2), 'utf-8')
  }
  cache = loaded
  return loaded
}

export function setConfig(patch: DeepPartial<AppConfig>): AppConfig {
  const next = mergeConfig(getConfig(), patch)
  if (!Number.isInteger(next.controlApi.port) || next.controlApi.port < 1024 || next.controlApi.port > 65535) throw new Error('控制端口必须是 1024 到 65535 的整数')
  if (typeof next.controlApi.token !== 'string' || next.controlApi.token.length < 16 || next.controlApi.token.length > 256) throw new Error('连接令牌必须为 16 到 256 个字符')
  cache = next
  const f = configFile()
  mkdirSync(dirname(f), { recursive: true })
  writeFileSync(f, JSON.stringify(next, null, 2), 'utf-8')
  return next
}
