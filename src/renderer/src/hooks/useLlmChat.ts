import { useCallback, useEffect, useRef, useState } from 'react'
import type { ChatImage, ChatMessage } from '@shared/types'
import { parseAssistantReply } from '../lib/parseReply'
import { extractPerformance } from '@shared/control'

const LEGACY_KEY = 'awa-subaru-chat-history'

interface SendOptions {
  images?: ChatImage[]
  synchronize?: boolean
  /** Show the buffered reply when playback actually starts. */
  onComplete?: (reply: ChatMessage, show: () => void) => void | Promise<void>
}

export function useLlmChat(): {
  messages: ChatMessage[]
  streaming: boolean
  preparingSpeech: boolean
  error: string | null
  send: (text: string, opts?: SendOptions) => void
  clear: () => void
} {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [streaming, setStreaming] = useState(false)
  const [preparingSpeech, setPreparingSpeech] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const bufferRef = useRef('')
  const onCompleteRef = useRef<SendOptions['onComplete'] | null>(null)
  const performanceEnabledRef = useRef(true)
  const historyLimitRef = useRef(30)
  const synchronizeRef = useRef(false)
  const busyRef = useRef(false)
  const requestRef = useRef(0)

  // 加载人设 + 历史（SQLite）
  useEffect(() => {
    const refresh = (): void => {
      void window.api.getConfig().then((cfg) => {
        performanceEnabledRef.current = cfg.chat.performanceEnabled
        historyLimitRef.current = cfg.chat.historyLimit
      })
    }
    refresh()
    const unsubscribe = window.api.onConfigChanged(refresh)

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
    return unsubscribe
  }, [])

  // 流式监听
  useEffect(() => {
    const offChunk = window.api.chat.onChunk((delta) => {
      if (!busyRef.current) return
      bufferRef.current += delta
      if (synchronizeRef.current) return
      setMessages((prev) => {
        const copy = [...prev]
        const last = copy[copy.length - 1]
        if (last && last.role === 'assistant') {
          copy[copy.length - 1] = { ...last, content: extractPerformance(bufferRef.current).text }
        } else {
          copy.push({ role: 'assistant', content: extractPerformance(bufferRef.current).text })
        }
        return copy
      })
    })
    const offDone = window.api.chat.onDone(() => {
      if (!busyRef.current) return
      const request = requestRef.current
      const full = bufferRef.current
      bufferRef.current = ''
      const { display, speak, performance } = parseAssistantReply(full)
      const cue = performanceEnabledRef.current ? performance : undefined
      const assistantMsg: ChatMessage = { role: 'assistant', content: display, speakText: speak, performance: cue }
      const cb = onCompleteRef.current
      onCompleteRef.current = null
      let shown = false
      const show = (): void => {
        if (shown || request !== requestRef.current) return
        shown = true
        setMessages(prev => [...prev.slice(0, -1), assistantMsg])
        void window.api.chat.history.add([assistantMsg]).catch(err => setError(`保存回复失败：${String(err)}`))
        busyRef.current = false
        setStreaming(false)
        setPreparingSpeech(false)
      }
      if (synchronizeRef.current && cb) setPreparingSpeech(true)
      else show()
      void (async () => {
        try {
          if (cb) await cb(assistantMsg, show)
          else if (cue) void window.api.control.execute({ type: 'performance.play', data: cue }).catch(() => {})
        } finally { show() }
      })().catch(err => { if (request === requestRef.current) setError(String(err)) })
    })
    const offError = window.api.chat.onError((err) => {
      bufferRef.current = ''
      setStreaming(false)
      setPreparingSpeech(false)
      busyRef.current = false
      setMessages(prev => prev.at(-1)?.role === 'assistant' && !prev.at(-1)?.content ? prev.slice(0, -1) : prev)
      setError(err)
      onCompleteRef.current = null
    })
    return () => {
      requestRef.current++
      busyRef.current = false
      offChunk()
      offDone()
      offError()
    }
  }, [])

  const send = useCallback(
    (text: string, opts?: SendOptions) => {
      if (busyRef.current || (!text.trim() && !opts?.images?.length)) return
      requestRef.current++
      busyRef.current = true
      synchronizeRef.current = opts?.synchronize ?? false
      bufferRef.current = ''
      const userMsg: ChatMessage = { role: 'user', content: text, images: opts?.images }
      setMessages((prev) => [...prev, userMsg, { role: 'assistant', content: '' }])
      void window.api.chat.history.add([userMsg]).catch(err => setError(`保存消息失败：${String(err)}`))
      setStreaming(true)
      setError(null)
      onCompleteRef.current = opts?.onComplete ?? null

      const history: ChatMessage[] = []
      // The main process adds the current persona, voice rules and control documentation.
      const tail = (historyLimitRef.current > 0 ? messages.slice(-historyLimitRef.current) : []).map(m => ({ role: m.role, content: m.content, images: m.images }))
      history.push(...tail, userMsg)
      window.api.chat.send(history)
    },
    [messages]
  )

  const clear = useCallback(() => {
    requestRef.current++
    busyRef.current = false
    bufferRef.current = ''
    onCompleteRef.current = null
    setMessages([])
    void window.api.chat.history.clear()
  }, [])

  return { messages, streaming, preparingSpeech, error, send, clear }
}
