import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { TtsConfig, TtsResult } from '../../shared/types'
import { adaptForTts, isLangError } from './ttsLang'

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

/** 嗅探响应实际是什么格式（远端可能忽略 response_format） */
function sniffMime(buf: Buffer): string {
  if (buf.length >= 12 && buf.toString('ascii', 0, 4) === 'RIFF') return 'audio/wav'
  if (buf.length >= 3 && buf.toString('ascii', 0, 3) === 'ID3') return 'audio/mpeg'
  if (buf.length >= 2 && buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0) return 'audio/mpeg'
  if (buf.length >= 8 && buf.toString('ascii', 4, 8) === 'ftyp') return 'audio/mp4'
  if (buf.length >= 4 && buf.toString('ascii', 0, 4) === 'OggS') return 'audio/ogg'
  return 'audio/wav'
}

/**
 * 调常驻语音服务合成。支持两种接口风格（由 `server.apiStyle` 决定）：
 *  - `openai`：POST {base}/v1/audio/speech  { input, voice, style?, speed?, response_format }
 *  - `legacy`：POST {base}/tts              { text, lang, speed }
 * `server.token` 非空时带 Authorization: Bearer。
 */
async function synthesizeServer(cfg: TtsConfig, text: string): Promise<TtsResult> {
  const s = cfg.server
  const base = (s.baseUrl || 'http://127.0.0.1:8001').replace(/\/+$/, '')
  const style = (s.apiStyle || 'openai') as 'openai' | 'legacy'
  const targetLang = (s.lang || '').trim()
  const adaptMode = s.langAdapt || 'simplify'

  /** 按给定文本发一次请求；返回音频 Buffer 或抛出带 status 的错误 */
  const attempt = async (input: string): Promise<Buffer> => {
    const openaiBody: Record<string, unknown> = {
      input,
      voice: s.voice || undefined,
      speed: cfg.speed,
      response_format: 'wav'
    }
    if (!s.voice) delete openaiBody.voice
    // style 是可选扩展字段：只在填了才发，避免严格实现因未知字段报错
    if (s.style) openaiBody.style = s.style

    const url = style === 'legacy' ? `${base}/tts` : `${base}/v1/audio/speech`
    const body: Record<string, unknown> =
      style === 'legacy' ? { text: input, lang: cfg.lang, speed: cfg.speed } : openaiBody

    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (s.token) headers.Authorization = `Bearer ${s.token}`

    const timeoutMs = s.timeoutMs && s.timeoutMs > 0 ? s.timeoutMs : 120000
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), timeoutMs)

    console.log(
      `[tts] server(${style}) POST ${url} len=${input.length}` +
        `${s.style ? ` style=${s.style}` : ''}${targetLang ? ` targetLang=${targetLang}` : ''}`
    )

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: ctrl.signal
      })

      if (!res.ok) {
        const err = await res.text().catch(() => '')
        const e = new Error(
          `语音服务返回 ${res.status}：${err.slice(0, 300)}（${url}，接口风格=${style}）`
        ) as Error & { status?: number; body?: string }
        e.status = res.status
        e.body = err
        throw e
      }

      const buf = Buffer.from(await res.arrayBuffer())
      if (buf.length < 200) {
        throw new Error(
          `语音服务只返回了 ${buf.length} 字节，疑似空音频。请检查服务端模型/参数。`
        )
      }
      return buf
    } catch (e) {
      if (e instanceof Error && e.name === 'AbortError') {
        throw new Error(`语音服务超时（timeoutMs）`)
      }
      throw e
    } finally {
      clearTimeout(timer)
    }
  }

  const first = adaptForTts(text, targetLang, adaptMode)

  try {
    const buf = await attempt(first)
    const mime = sniffMime(buf)
    console.log(`[tts] server 返回 ${buf.length} bytes, mime=${mime}`)
    return { mime, base64: buf.toString('base64') }
  } catch (e) {
    const err = e as Error & { status?: number; body?: string }
    // 语言类错误 + 允许自动重试 + 首次没适配过 → 用「字形简化」再试一次
    const canRetry =
      s.autoRetryOnLangError !== false &&
      err.status !== undefined &&
      isLangError(err.status, err.body ?? '') &&
      first === text

    if (!canRetry) throw err
    const second = adaptForTts(text, targetLang || 'jp', 'simplify')
    if (second === text) throw err // 适配后没变化，重试也没意义
    console.warn('[tts] 服务端报告语言不支持，已自动适配后重试一次')
    const buf = await attempt(second)
    const mime = sniffMime(buf)
    console.log(`[tts] server 重试成功 ${buf.length} bytes, mime=${mime}`)
    return { mime, base64: buf.toString('base64') }
  }
}

/** 探测语音服务可用性（设置面板「测试连接」用）：GET {base}/health */
export async function probeServer(
  cfg: TtsConfig
): Promise<{ ok: boolean; device?: string; styles?: string[]; error?: string }> {
  const base = (cfg.server.baseUrl || '').replace(/\/+$/, '')
  if (!base) return { ok: false, error: '未填写服务地址' }
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 10000)
  try {
    const res = await fetch(`${base}/health`, { signal: ctrl.signal })
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` }
    const j = (await res.json()) as { ok?: boolean; device?: string; styles?: string[] }
    return { ok: j.ok !== false, device: j.device, styles: j.styles }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  } finally {
    clearTimeout(timer)
  }
}
