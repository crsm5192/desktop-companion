import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { TtsConfig, TtsResult } from '../../shared/types'

/**
 * 语音合成。
 * 默认 command 模式：复用外部语音脚本（文件进/文件出）；server 模式：调常驻 TTS 服务。
 */
export async function synthesize(cfg: TtsConfig, text: string): Promise<TtsResult> {
  if (cfg.mode === 'server') return synthesizeServer(cfg, text)
  return synthesizeCommand(cfg, text)
}

/** 含假名则判为日语，否则中文 */
function detectLang(text: string, lang: TtsConfig['lang']): 'zh' | 'jp' {
  if (lang !== 'auto') return lang
  return /[\u3040-\u30ff]/.test(text) ? 'jp' : 'zh'
}

async function synthesizeCommand(cfg: TtsConfig, text: string): Promise<TtsResult> {
  const lang = detectLang(text, cfg.lang)
  const dir = mkdtempSync(join(tmpdir(), 'pet-tts-'))
  const inputPath = join(dir, 'input.txt')
  const outputPath = join(dir, 'output.wav')
  writeFileSync(inputPath, text, 'utf-8')

  const args = ['-u', cfg.script, inputPath, outputPath, lang, String(cfg.speed)]
  console.log(`[tts] 开始合成 lang=${lang} len=${text.length} text=${text.slice(0, 30)}`)

  try {
    await new Promise<void>((resolve, reject) => {
      const child = spawn(cfg.python, args, {
        cwd: cfg.cwd || undefined,
        windowsHide: true
      })
      let stderr = ''
      child.stdout?.on('data', (d) => console.log('[tts] stdout:', d.toString().trim()))
      child.stderr?.on('data', (d) => {
        stderr += d.toString()
      })
      child.on('error', (e) => {
        console.error('[tts] spawn error:', e)
        reject(e)
      })
      child.on('close', (code) => {
        console.log(`[tts] 进程退出 code=${code} output存在=${existsSync(outputPath)}`)
        if (code === 0 && existsSync(outputPath)) resolve()
        else reject(new Error(`TTS 命令退出码 ${code}：${stderr.slice(-800)}`))
      })
      setTimeout(() => {
        child.kill()
        reject(new Error('TTS 超时'))
      }, cfg.timeoutMs)
    })

    const buf = readFileSync(outputPath)
    console.log(`[tts] 合成完成 ${buf.length} bytes`)
    return { mime: 'audio/wav', base64: buf.toString('base64') }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

async function synthesizeServer(cfg: TtsConfig, text: string): Promise<TtsResult> {
  const base = (cfg.server.baseUrl || 'http://127.0.0.1:8001').replace(/\/+$/, '')
  const res = await fetch(`${base}/tts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, lang: cfg.lang, speed: cfg.speed })
  })
  if (!res.ok) {
    const err = await res.text().catch(() => '')
    throw new Error(
      `TTS 服务返回 ${res.status}：${err.slice(0, 300)}。请先启动你的 TTS 服务（或用 command 模式）`
    )
  }
  const buf = Buffer.from(await res.arrayBuffer())
  return { mime: 'audio/wav', base64: buf.toString('base64') }
}
