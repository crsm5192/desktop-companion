import { create } from 'zustand'
import { bubblePageAt, splitBubbleText } from '@shared/chatContent'
import type { ChatPresentation } from '@shared/types'

interface ReplyBubble {
  id: string
  pages: string[]
  page: number
  speaking: boolean
  startedAt: number
  durationMs: number
  expiresAt: number
}
interface ReplyBubbleState {
  message: ReplyBubble | null
  receive: (payload: ChatPresentation) => void
  tick: () => void
}

export const useReplyBubbleStore = create<ReplyBubbleState>((set) => ({
  message: null,
  receive: payload => set(state => {
    if (payload.type === 'clear') return { message: null }
    if (payload.type === 'start') {
      const pages = splitBubbleText(payload.text)
      if (!pages.length) return { message: null }
      const durationMs = Math.max(6000, payload.durationMs, pages.length * 4500)
      return { message: { id: payload.id, pages, page: 0, speaking: payload.speaking, startedAt: Date.now(), durationMs, expiresAt: payload.speaking ? Infinity : Date.now() + durationMs + 3000 } }
    }
    const message = state.message
    if (!message || message.id !== payload.id) return {}
    if (payload.type === 'progress') {
      const page = bubblePageAt(message.pages, payload.progress)
      return page === message.page ? {} : { message: { ...message, page } }
    }
    return { message: { ...message, speaking: false, page: message.pages.length - 1, startedAt: Date.now(), durationMs: 0, expiresAt: Date.now() + 5000 } }
  }),
  tick: () => set(state => {
    const message = state.message
    if (!message || message.speaking) return {}
    if (Date.now() >= message.expiresAt) return { message: null }
    if (!message.durationMs) return {}
    const page = bubblePageAt(message.pages, (Date.now() - message.startedAt) / message.durationMs)
    return page === message.page ? {} : { message: { ...message, page } }
  })
}))
