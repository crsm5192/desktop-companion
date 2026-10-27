import { app } from 'electron'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { AppConfig, DeepPartial } from '../shared/types'
import { externalConfigFile } from './paths'

// 默认配置 —— 请按你自己的环境修改（也可在设置面板或 config.json 里改）：
// - character：角色设定（名字/称呼），换掉这里就能装别的角色
// - hermes：OpenAI 兼容 API server（baseUrl/apiKey/model 按你的 gateway 配置填）
// - tts   ：CosyVoice 语音（server 模式 = 常驻 HTTP 服务；command 模式 = CLI 脚本）
// - siyuan：思源内核 HTTP API（默认 6806）
const DEFAULT_CONFIG: AppConfig = {
  character: {
    name: '桌面伴侣',
    alias: '',
    shortName: '伴侣',
    userName: '你'
  },
  hermes: {
    baseUrl: 'http://127.0.0.1:8642',
    apiKey: '',
    model: 'deepseek-v4-flash-0731'
  },
  tts: {
    mode: 'server', // server = 常驻 TTS 服务（推荐）；command = 每句 spawn 语音脚本（备用）
    python: '',
    script: '',
    cwd: '',
    lang: 'auto',
    speed: 1.0,
    timeoutMs: 300000,
    server: { baseUrl: 'http://127.0.0.1:8001', voice: 'default' }
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
    frameScale: 1.0,
    clickThrough: false,
    locked: false,
    eyeTracking: true,
    eyeTrackingStrength: 1.0,
    offsetX: 0,
    offsetY: 0,
    winX: null,
    winY: null
  },
  chat: {
    persona: `你是一个可爱的二次元桌宠伴侣，住在用户电脑桌面上。
要求：
1. 用中文聊天，语气自然亲切、有温度，像一个关心用户的朋友。
2. 回复正文里绝对不要出现：文件路径、🎧 符号、「语音」字样、「翻译」字样、不要生成或提及任何音频文件。`,
    voiceRule: `在回复的最后一行，单独写「日语：」开头，给出这段回复的日语口语版（用于语音合成）。日语要自然，不要敬语腔。`,
    historyLimit: 30
  }
}

let cache: AppConfig | null = null

function configFile(): string {
  // 便携：打包后 config.json 放 exe 旁边；开发用 userData
  return app.isPackaged ? externalConfigFile() : join(app.getPath('userData'), 'config.json')
}

function mergeConfig(base: AppConfig, patch: DeepPartial<AppConfig>): AppConfig {
  return {
    character: { ...base.character, ...(patch.character ?? {}) },
    hermes: { ...base.hermes, ...(patch.hermes ?? {}) },
    tts: { ...base.tts, ...(patch.tts ?? {}), server: { ...base.tts.server, ...(patch.tts?.server ?? {}) } },
    siyuan: { ...base.siyuan, ...(patch.siyuan ?? {}) },
    pet: { ...base.pet, ...(patch.pet ?? {}) },
    chat: { ...base.chat, ...(patch.chat ?? {}) }
  }
}

export function getConfig(): AppConfig {
  if (cache) return cache
  const f = configFile()
  let loaded = DEFAULT_CONFIG
  try {
    if (existsSync(f)) {
      loaded = mergeConfig(DEFAULT_CONFIG, JSON.parse(readFileSync(f, 'utf-8')) as Partial<AppConfig>)
    }
  } catch (e) {
    console.error('[config] 读取失败，回退默认配置：', e)
  }
  cache = loaded
  return loaded
}

export function setConfig(patch: DeepPartial<AppConfig>): AppConfig {
  const next = mergeConfig(getConfig(), patch)
  cache = next
  const f = configFile()
  mkdirSync(dirname(f), { recursive: true })
  writeFileSync(f, JSON.stringify(next, null, 2), 'utf-8')
  return next
}
