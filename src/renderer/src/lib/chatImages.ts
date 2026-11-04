import { MAX_CHAT_IMAGES, MAX_IMAGE_DATA_LENGTH } from '@shared/chatContent'
import type { ChatImage } from '@shared/types'

export async function prepareChatImages(files: File[], available = MAX_CHAT_IMAGES): Promise<ChatImage[]> {
  if (files.length > available) throw new Error('每条消息最多发送 4 张图片，请先移除多余图片')
  return Promise.all(files.map(async file => {
    if (!/^image\/(jpeg|png|webp|gif)$/.test(file.type)) throw new Error('请选择 JPG、PNG、WebP 或 GIF 图片')
    if (file.size > 10 * 1024 * 1024) throw new Error(`「${file.name}」超过 10 MB，请选择较小的图片`)
    const url = URL.createObjectURL(file)
    try {
      const image = new Image()
      image.src = url
      await image.decode()
      const scale = Math.min(1, 1600 / Math.max(image.naturalWidth, image.naturalHeight))
      const canvas = document.createElement('canvas')
      canvas.width = Math.max(1, Math.round(image.naturalWidth * scale))
      canvas.height = Math.max(1, Math.round(image.naturalHeight * scale))
      const context = canvas.getContext('2d')
      if (!context) throw new Error('无法读取图片，请重新选择')
      context.fillStyle = '#ffffff'
      context.fillRect(0, 0, canvas.width, canvas.height)
      context.drawImage(image, 0, 0, canvas.width, canvas.height)
      const dataUrl = canvas.toDataURL('image/jpeg', 0.88)
      if (dataUrl.length > MAX_IMAGE_DATA_LENGTH) throw new Error(`「${file.name}」处理后仍然过大，请选择较小的图片`)
      return { id: crypto.randomUUID(), name: file.name, dataUrl, width: canvas.width, height: canvas.height }
    } finally { URL.revokeObjectURL(url) }
  }))
}
