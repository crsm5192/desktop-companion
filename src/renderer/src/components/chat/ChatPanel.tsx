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
  const messagesEndRef = useRef<HTMLDivElement>(null)

  // 打开/新消息时自动滚到最底部
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView()
  }, [messages, streaming])

  const submit = (): void => {
    const text = input.trim()
    if (!text || streaming) return
    setInput('')
    // onComplete 收到的是「语音文本」（日语优先），见 useLlmChat
    send(text, { onComplete: voiceOn ? (s) => void speak(s) : undefined })
  }

  return (
    <div className="panel chat-panel">
      <div className="panel-header">
        <span>与{ch.shortName}对话</span>
        <span className="panel-header-actions">
          <label>
            <input
              type="checkbox"
              checked={voiceOn}
              onChange={(e) => setVoiceOn(e.target.checked)}
            />
            {' 语音'}
          </label>
          <button className="clear-btn" onClick={() => clear()} title="清空对话">
            🗑
          </button>
        </span>
      </div>

      <div className="messages">
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
        <div ref={messagesEndRef} />
      </div>

      <div className="chat-input">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && submit()}
          placeholder={`和${ch.shortName}说点什么…`}
        />
        <button onClick={submit} disabled={streaming}>
          发送
        </button>
      </div>
    </div>
  )
}
