import type { ChatMessage } from '@shared/types'
import { useCharacter } from '../../hooks/useCharacter'

interface Props {
  message: ChatMessage
  onSpeak?: () => void
}

export default function ChatBubble({ message, onSpeak }: Props): JSX.Element | null {
  const ch = useCharacter()
  if (message.role === 'system') return null
  const isUser = message.role === 'user'
  return (
    <div className={`bubble ${isUser ? 'bubble-user' : 'bubble-assistant'}`}>
      <div className="bubble-role">{isUser ? ch.userName : ch.shortName}</div>
      <div className="bubble-text">{message.content}</div>
      {!isUser && onSpeak && (
        <button className="bubble-speak" onClick={onSpeak} title="朗读">
          🔊
        </button>
      )}
    </div>
  )
}
