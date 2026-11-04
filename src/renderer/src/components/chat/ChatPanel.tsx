import { useEffect, useRef, useState } from 'react'
import { useLlmChat } from '../../hooks/useLlmChat'
import { useTTS } from '../../hooks/useTTS'
import { useCharacter } from '../../hooks/useCharacter'
import ChatBubble from './ChatBubble'

export default function ChatPanel(): JSX.Element {
  const { messages, streaming, error, send, clear } = useLlmChat()
  const { speak, error: ttsError } = useTTS()
  const ch = useCharacter()
  const [input, setInput] = useState('')
  const [voiceOn, setVoiceOn] = useState(true)
  const [readingHistory, setReadingHistory] = useState(false)
  const messagesRef = useRef<HTMLDivElement>(null)
  const followLatest = useRef(true)

  // Keep the input visible; don't pull the reader away from older messages.
  useEffect(() => {
    const list = messagesRef.current
    if (list && followLatest.current) list.scrollTop = list.scrollHeight
  }, [messages, streaming])

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') void window.api.chatWindow.setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const submit = (): void => {
    const text = input.trim()
    if (!text || streaming) return
    followLatest.current = true
    setReadingHistory(false)
    setInput('')
    // onComplete 收到的是「语音文本」（日语优先），见 useLlmChat
    send(text, { onComplete: voiceOn ? (s) => void speak(s) : undefined })
  }

  return (
    <div className="chat-window">
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
              onChange={(e) => setVoiceOn(e.target.checked)}
            />
            {' 语音'}
          </label>
          <button className="chat-window-tool" onClick={() => clear()} disabled={streaming} title="清空对话">
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
            onSpeak={voiceOn ? () => void speak(m.speakText || m.content) : undefined}
          />
        ))}
        {streaming && <div className="typing">{ch.shortName}正在输入…</div>}
        {error && <div className="error">{error}</div>}
        {ttsError && <div className="error">语音：{ttsError}</div>}
      </div>

      {readingHistory && <button className="chat-latest" onClick={() => {
        followLatest.current = true
        setReadingHistory(false)
        const list = messagesRef.current
        if (list) list.scrollTop = list.scrollHeight
      }}>回到最新消息 ↓</button>}

      <div className="chat-input">
        <textarea
          rows={2}
          aria-label="聊天内容"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing && e.keyCode !== 229) {
              e.preventDefault()
              submit()
            }
          }}
          placeholder={`和${ch.shortName}说点什么…`}
        />
        <button onClick={submit} disabled={streaming || !input.trim()}>
          发送
        </button>
      </div>
      <div className="chat-input-hint">Enter 发送 · Shift + Enter 换行</div>
    </div>
  )
}
