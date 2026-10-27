import { useCallback, useEffect, useRef, useState } from 'react'
import type { ChatMessage } from '@shared/types'
import { parseAssistantReply } from '../lib/parseReply'

const LEGACY_KEY = 'awa-subaru-chat-history'

interface SendOptions {
  /** 收到「语音文本」（日语优先）时回调，用于自动朗读 */
  onComplete?: (speakText: string) => void
}

export function useLlmChat(): {
  messages: ChatMessage[]
  streaming: boolean
  error: string | null
  send: (text: string, opts?: SendOptions) => void
  clear: () => void
} {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [streaming, setStreaming] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const bufferRef = useRef('')
  const onCompleteRef = useRef<SendOptions['onComplete'] | null>(null)
  const personaRef = useRef('')
  const voiceRuleRef = useRef('')
  const historyLimitRef = useRef(30)

  // 加载人设 + 历史（SQLite）
  useEffect(() => {
    void window.api.getConfig().then((cfg) => {
      personaRef.current = cfg.chat.persona
      voiceRuleRef.current = cfg.chat.voiceRule || ''
      historyLimitRef.current = cfg.chat.historyLimit
    })

    void (async () => {
      // 一次性迁移老 localStorage → DB
      try {
        const old = JSON.parse(localStorage.getItem(LEGACY_KEY) || '[]') as ChatMessage[]
        if (Array.isArray(old) && old.length) {
          await window.api.chat.history.add(old)
          localStorage.removeItem(LEGACY_KEY)
        }
      } catch {
        /* ignore */
      }
      const saved = await window.api.chat.history.get()
      if (Array.isArray(saved) && saved.length) setMessages(saved)
    })()
  }, [])

  // 流式监听
  useEffect(() => {
    const offChunk = window.api.chat.onChunk((delta) => {
      bufferRef.current += delta
      setMessages((prev) => {
        const copy = [...prev]
        const last = copy[copy.length - 1]
        if (last && last.role === 'assistant') {
          copy[copy.length - 1] = { ...last, content: last.content + delta }
        } else {
          copy.push({ role: 'assistant', content: delta })
        }
        return copy
      })
    })
    const offDone = window.api.chat.onDone(() => {
      const full = bufferRef.current
      bufferRef.current = ''
      const { display, speak } = parseAssistantReply(full)
      const assistantMsg: ChatMessage = { role: 'assistant', content: display, speakText: speak }
      setMessages((prev) => {
        const copy = [...prev]
        const last = copy[copy.length - 1]
        if (last && last.role === 'assistant') {
          copy[copy.length - 1] = assistantMsg
        }
        return copy
      })
      void window.api.chat.history.add([assistantMsg]) // 持久化助手回复
      setStreaming(false)
      const cb = onCompleteRef.current
      onCompleteRef.current = null
      if (speak) cb?.(speak)
    })
    const offError = window.api.chat.onError((err) => {
      bufferRef.current = ''
      setStreaming(false)
      setError(err)
      onCompleteRef.current = null
    })
    return () => {
      offChunk()
      offDone()
      offError()
    }
  }, [])

  const send = useCallback(
    (text: string, opts?: SendOptions) => {
      const userMsg: ChatMessage = { role: 'user', content: text }
      setMessages((prev) => [...prev, userMsg])
      void window.api.chat.history.add([userMsg]) // 持久化用户消息
      setStreaming(true)
      setError(null)
      onCompleteRef.current = opts?.onComplete ?? null

      const history: ChatMessage[] = []
      const sys = [personaRef.current, voiceRuleRef.current].filter(Boolean).join('\n\n')
      if (sys) history.push({ role: 'system', content: sys })
      const tail = messages.slice(-historyLimitRef.current).map((m) => ({ role: m.role, content: m.content }))
      history.push(...tail, { role: 'user', content: text })
      window.api.chat.send(history)
    },
    [messages]
  )

  const clear = useCallback(() => {
    setMessages([])
    void window.api.chat.history.clear()
  }, [])

  return { messages, streaming, error, send, clear }
}