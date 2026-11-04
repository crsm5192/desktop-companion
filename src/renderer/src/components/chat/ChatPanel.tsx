import { useEffect, useRef, useState } from 'react'
import { useLlmChat } from '../../hooks/useLlmChat'
import { useTTS } from '../../hooks/useTTS'
import { useCharacter } from '../../hooks/useCharacter'
import type { ChatImage, ChatMessage } from '@shared/types'
import { MAX_CHAT_IMAGES, splitBubbleText } from '@shared/chatContent'
import { prepareChatImages } from '../../lib/chatImages'
import ChatBubble from './ChatBubble'

export default function ChatPanel(): JSX.Element {
  const { messages, streaming, preparingSpeech, error, send, clear } = useLlmChat()
  const { speak, stop, error: ttsError } = useTTS()
  const ch = useCharacter()
  const [input, setInput] = useState('')
  const [voiceOn, setVoiceOn] = useState(true)
  const [readingHistory, setReadingHistory] = useState(false)
  const [images, setImages] = useState<ChatImage[]>([])
  const [imageError, setImageError] = useState<string | null>(null)
  const [loadingImages, setLoadingImages] = useState(false)
  const imageBusy = useRef(false)
  const imageInput = useRef<HTMLInputElement>(null)
  const presentationGeneration = useRef(0)
  const messagesRef = useRef<HTMLDivElement>(null)
  const followLatest = useRef(true)

  // Keep the input visible; don't pull the reader away from older messages.
  useEffect(() => {
    const list = messagesRef.current
    if (list && followLatest.current) list.scrollTop = list.scrollHeight
  }, [messages, streaming, preparingSpeech])

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') void window.api.chatWindow.setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => { presentationGeneration.current++; window.removeEventListener('keydown', onKey) }
  }, [])

  const addImages = async (files: File[]): Promise<void> => {
    if (!files.length || streaming || imageBusy.current) return
    imageBusy.current = true
    setLoadingImages(true)
    setImageError(null)
    try {
      const prepared = await prepareChatImages(files, MAX_CHAT_IMAGES - images.length)
      setImages(previous => [...previous, ...prepared])
    } catch (err) { setImageError(err instanceof Error ? err.message : String(err)) }
    finally { imageBusy.current = false; setLoadingImages(false) }
  }

  const presentReply = async (reply: ChatMessage, show = (): void => {}): Promise<void> => {
    const generation = ++presentationGeneration.current
    const id = crypto.randomUUID()
    const present = (speaking: boolean, durationMs: number): void => {
      if (generation !== presentationGeneration.current) return
      show()
      window.api.chat.present({ type: 'start', id, text: reply.content, speaking, durationMs })
    }
    if (voiceOn && (reply.speakText || reply.content)) {
      const ok = await speak(reply.speakText || reply.content, {
        performance: reply.performance,
        onStart: durationMs => present(true, durationMs),
        onProgress: progress => { if (generation === presentationGeneration.current) window.api.chat.present({ type: 'progress', id, progress }) },
        onEnd: () => window.api.chat.present({ type: 'end', id })
      })
      if (ok || generation !== presentationGeneration.current) return
    }
    present(false, Math.max(6000, splitBubbleText(reply.content).length * 4500))
    if (reply.performance) void window.api.control.execute({ type: 'performance.play', data: reply.performance }).catch(() => {})
  }

  const submit = (): void => {
    const text = input.trim()
    if ((!text && !images.length) || streaming || imageBusy.current) return
    presentationGeneration.current++
    stop()
    window.api.chat.present({ type: 'clear' })
    void window.api.control.execute({ type: 'control.reset', data: {} }).catch(() => {})
    followLatest.current = true
    setReadingHistory(false)
    setInput('')
    setImages([])
    setImageError(null)
    send(text || '请看看这些图片。', { images, synchronize: voiceOn, onComplete: presentReply })
  }

  return (
    <div className="chat-window" onDragOver={event => {
      if (event.dataTransfer.types.includes('Files')) event.preventDefault()
    }} onDrop={event => {
      event.preventDefault()
      void addImages(Array.from(event.dataTransfer.files))
    }}>
      <div className="chat-window-header">
        <div className="chat-window-title"><strong>与{ch.shortName}对话</strong><span>拖动这里调整位置</span></div>
        <button className="chat-window-tool" onClick={() => void window.api.chatWindow.dock()} title="重新贴靠模型">贴靠</button>
        <button className="chat-window-close" onClick={() => void window.api.chatWindow.setOpen(false)} aria-label="收起对话" title="收起对话（保留草稿）">×</button>
      </div>
      <div className="chat-window-options">
        <span>聊天记录</span>
        <span className="panel-header-actions">
          <label>
            <input
              type="checkbox"
              checked={voiceOn}
              disabled={streaming}
              onChange={(e) => setVoiceOn(e.target.checked)}
            />
            {' 语音'}
          </label>
          <button className="chat-window-tool" onClick={() => {
            presentationGeneration.current++
            stop()
            window.api.chat.present({ type: 'clear' })
            void window.api.control.execute({ type: 'control.reset', data: {} }).catch(() => {})
            clear()
          }} disabled={streaming} title="清空对话">
            清空
          </button>
        </span>
      </div>

      <div className="messages" ref={messagesRef} onScroll={() => {
        const list = messagesRef.current
        if (!list) return
        followLatest.current = list.scrollHeight - list.scrollTop - list.clientHeight < 48
        setReadingHistory(!followLatest.current)
      }}>
        {messages.length === 0 && <div className="chat-empty">我在旁边陪着你。<br />想聊什么，就在下面告诉我吧。</div>}
        {messages.map((m, i) => (
          <ChatBubble
            key={i}
            message={m}
            onSpeak={voiceOn && !streaming ? () => void presentReply(m) : undefined}
          />
        ))}
        {streaming && <div className="typing" role="status">{preparingSpeech ? '正在准备语音，马上一起说给你听…' : `${ch.shortName}正在思考…`}</div>}
        {error && <div className="error">{error}</div>}
        {ttsError && <div className="error">语音：{ttsError}</div>}
      </div>

      {readingHistory && <button className="chat-latest" onClick={() => {
        followLatest.current = true
        setReadingHistory(false)
        const list = messagesRef.current
        if (list) list.scrollTop = list.scrollHeight
      }}>回到最新消息 ↓</button>}

      {images.length > 0 && <div className="chat-attachments" aria-label="待发送的图片">
        {images.map(image => <div className="chat-attachment" key={image.id}>
          <img src={image.dataUrl} alt={image.name} title={image.name} />
          <button aria-label={`移除图片 ${image.name}`} onClick={() => setImages(previous => previous.filter(item => item.id !== image.id))} disabled={loadingImages}>×</button>
        </div>)}
      </div>}
      {imageError && <div className="error" role="alert">{imageError}</div>}
      <div className="chat-input">
        <input ref={imageInput} className="chat-file-input" type="file" aria-label="选择图片" accept="image/jpeg,image/png,image/webp,image/gif" multiple onChange={event => {
          void addImages(Array.from(event.target.files ?? []))
          event.target.value = ''
        }} />
        <button className="chat-image-button" title="选择图片（也可以粘贴或拖入）" onClick={() => imageInput.current?.click()} disabled={streaming || loadingImages || images.length >= MAX_CHAT_IMAGES}>{loadingImages ? '处理中' : '图片'}</button>
        <textarea
          rows={2}
          aria-label="聊天内容"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onPaste={event => {
            const files = Array.from(event.clipboardData.items).filter(item => item.kind === 'file' && item.type.startsWith('image/')).map(item => item.getAsFile()).filter((file): file is File => file !== null)
            if (files.length) { event.preventDefault(); void addImages(files) }
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing && e.keyCode !== 229) {
              e.preventDefault()
              submit()
            }
          }}
          placeholder={`和${ch.shortName}说点什么…`}
        />
        <button onClick={submit} disabled={streaming || loadingImages || (!input.trim() && !images.length)}>
          发送
        </button>
      </div>
      <div className="chat-input-hint">Enter 发送 · Shift + Enter 换行<br />图片可选择、粘贴或拖入 · 需使用支持图片的模型</div>
    </div>
  )
}
