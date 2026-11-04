import type { ChatImage, ChatMessage } from './types'

export const MAX_CHAT_IMAGES = 4
export const MAX_IMAGE_DATA_LENGTH = 4 * 1024 * 1024

export function validateChatImages(images: unknown): ChatImage[] {
  if (images === undefined) return []
  if (!Array.isArray(images) || images.length > MAX_CHAT_IMAGES) throw new Error('每条消息最多发送 4 张图片')
  return images.map(image => {
    if (!image || typeof image !== 'object' || typeof image.dataUrl !== 'string' ||
      image.dataUrl.length > MAX_IMAGE_DATA_LENGTH || !/^data:image\/(?:jpeg|png|webp|gif);base64,[A-Za-z0-9+/]+={0,2}$/.test(image.dataUrl)) {
      throw new Error('图片格式无效或图片过大，请重新选择图片')
    }
    if (typeof image.id !== 'string' || typeof image.name !== 'string' || !Number.isFinite(image.width) || !Number.isFinite(image.height) || image.width <= 0 || image.height <= 0) {
      throw new Error('图片信息无效')
    }
    return { id: image.id.slice(0, 128), name: image.name.slice(0, 256), dataUrl: image.dataUrl, width: image.width, height: image.height }
  })
}

/** Keep persisted/UI messages separate from the provider's multimodal payload. */
export function toLlmMessages(messages: ChatMessage[]) {
  return messages.map(message => {
    const images = message.role === 'user' ? validateChatImages(message.images) : []
    return {
      role: message.role,
      content: images.length
        ? [
          ...(message.content ? [{ type: 'text' as const, text: message.content }] : []),
          ...images.map(image => ({ type: 'image_url' as const, image_url: { url: image.dataUrl } }))
        ]
        : message.content
    }
  })
}

/** Split long replies at punctuation so every part can fit beside the pet. */
export function splitBubbleText(text: string, limit = 64): string[] {
  const characters = Array.from(text.trim())
  const pages: string[] = []
  let start = 0
  while (start < characters.length) {
    let end = Math.min(start + limit, characters.length)
    if (end < characters.length) {
      for (let i = end - 1; i >= start + Math.floor(limit / 2); i--) {
        if (/[。！？!?；;，,\n]/.test(characters[i])) { end = i + 1; break }
      }
    }
    const page = characters.slice(start, end).join('').trim()
    if (page) pages.push(page)
    start = end
  }
  return pages
}

export function bubblePageAt(pages: string[], progress: number): number {
  const total = pages.reduce((length, page) => length + Array.from(page).length, 0)
  const position = Math.max(0, Math.min(1, progress)) * total
  let end = 0
  for (let i = 0; i < pages.length - 1; i++) {
    end += Array.from(pages[i]).length
    if (position < end) return i
  }
  return Math.max(0, pages.length - 1)
}
