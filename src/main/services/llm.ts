import type { ChatMessage, LlmConfig } from '../../shared/types'

/**
 * OpenAI 兼容的流式对话客户端（通用，不绑定任何特定服务商）。
 *
 * 支持任何实现了 `POST /v1/chat/completions` + `Authorization: Bearer <key>` +
 * SSE (`data: {...}` / `data: [DONE]`) 的服务，例如：
 *   OpenAI / DeepSeek / Moonshot / 智谱 / 本地 vLLM / LM Studio / Ollama(OpenAI 兼容层) ...
 *
 * baseUrl 兼容两种写法：
 *   http://127.0.0.1:8000      → 自动补 /v1/chat/completions
 *   http://127.0.0.1:8000/v1   → 自动补 /chat/completions
 */
export async function streamChat(
  cfg: LlmConfig,
  messages: ChatMessage[],
  onChunk: (delta: string) => void,
  signal?: AbortSignal
): Promise<void> {
  const base = cfg.baseUrl.replace(/\/+$/, '')
  const url = base.endsWith('/v1') ? `${base}/chat/completions` : `${base}/v1/chat/completions`

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(cfg.apiKey ? { Authorization: `Bearer ${cfg.apiKey}` } : {})
    },
    body: JSON.stringify({ model: cfg.model, messages, stream: true }),
    signal
  })

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`对话接口请求失败 HTTP ${res.status}: ${text.slice(0, 300)}`)
  }
  if (!res.body) throw new Error('对话接口未返回流式响应')

  const reader = res.body.getReader()
  const decoder = new TextDecoder('utf-8')
  let buf = ''

  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buf += decoder.decode(value, { stream: true })

    const lines = buf.split(/\r?\n/)
    buf = lines.pop() ?? ''

    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed.startsWith('data:')) continue
      const data = trimmed.slice(5).trim()
      if (data === '[DONE]') return
      try {
        const json = JSON.parse(data) as {
          choices?: Array<{ delta?: { content?: string }; text?: string }>
        }
        const delta = json.choices?.[0]?.delta?.content ?? json.choices?.[0]?.text ?? ''
        if (delta) onChunk(delta)
      } catch {
        // 忽略 keep-alive 等非 JSON 行
      }
    }
  }
}
