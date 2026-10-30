/**
 * 超大贴图自动降采样。
 *
 * 背景：部分 Live2D 模型带 8192×8192 之类的巨幅贴图。这类纹理在部分显卡上会分配失败，
 * 导致模型"静默加载不出来"。
 *
 * 关键设计（踩过的坑）：
 *  1. **绝不能为了"检查尺寸"去解码整张图** —— 8192×8192 PNG 解码要几百毫秒到数秒，
 *     多张叠加会把界面卡死在"检查贴图尺寸…"。
 *     所以先只读 PNG 文件头（IHDR，前 24 字节）拿宽高，走 Range 请求，瞬间完成。
 *  2. **贴图优化不能阻塞模型加载** —— 任何一步失败/超时都直接跳过，按原图加载。
 *  3. 只有确认超尺寸的那几张才真正下载+解码+缩放。
 */

/** 单张纹理的边长上限（超过才降采样）。8192→4096 可省 3/4 显存 */
const MAX_TEXTURE_SIZE = 4096

/** 单张图检查/处理的超时（毫秒），超时就跳过，不拖累加载 */
const PER_TEXTURE_TIMEOUT = 8000

export interface DownscaleResult {
  /** 原始相对路径 → 降采样后的 blob URL */
  map: Map<string, string>
  /** 被处理的贴图数量 */
  downscaled: number
  /** 需要释放的 blob URL */
  revoke: () => void
}

function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`${what} 超时`)), ms))
  ])
}

/**
 * 只读 PNG 前 24 字节拿到宽高（不下载整图、不解码）。
 * PNG 结构：8 字节签名 + 4 字节长度 + 4 字节 "IHDR" + 4 字节宽 + 4 字节高（大端）
 */
async function readPngSize(url: string): Promise<{ w: number; h: number } | null> {
  const res = await fetch(url, { headers: { Range: 'bytes=0-31' } })
  if (!res.ok && res.status !== 206) return null
  const buf = new Uint8Array(await res.arrayBuffer())
  if (buf.length < 24) return null

  // 校验 PNG 签名
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
  for (let i = 0; i < 8; i++) if (buf[i] !== sig[i]) return null

  const isIhdr =
    buf[12] === 0x49 && buf[13] === 0x48 && buf[14] === 0x44 && buf[15] === 0x52
  if (!isIhdr) return null

  const w = ((buf[16] << 24) | (buf[17] << 16) | (buf[18] << 8) | buf[19]) >>> 0
  const h = ((buf[20] << 24) | (buf[21] << 16) | (buf[22] << 8) | buf[23]) >>> 0
  if (!w || !h) return null
  return { w, h }
}

/** 下载并解码成可绘制的图像 */
async function decodeImage(url: string): Promise<ImageBitmap | HTMLImageElement> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`贴图加载失败 ${res.status}`)
  const blob = await res.blob()
  if (typeof createImageBitmap === 'function') return await createImageBitmap(blob)
  const img = new Image()
  const objUrl = URL.createObjectURL(blob)
  try {
    await new Promise<void>((ok, no) => {
      img.onload = () => ok()
      img.onerror = () => no(new Error('图片解码失败'))
      img.src = objUrl
    })
    return img
  } finally {
    URL.revokeObjectURL(objUrl)
  }
}

/** 缩到目标尺寸并转成 blob URL */
async function downscaleToBlobUrl(url: string, maxSize: number): Promise<string> {
  const bmp = await decodeImage(url)
  const srcW = 'width' in bmp ? bmp.width : 0
  const srcH = 'height' in bmp ? bmp.height : 0
  if (!srcW || !srcH) throw new Error('图像尺寸无效')

  const scale = Math.min(maxSize / srcW, maxSize / srcH, 1)
  const outW = Math.max(1, Math.round(srcW * scale))
  const outH = Math.max(1, Math.round(srcH * scale))

  const canvas = document.createElement('canvas')
  canvas.width = outW
  canvas.height = outH
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('canvas 2d 不可用')
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(bmp as CanvasImageSource, 0, 0, outW, outH)
  if ('close' in bmp) (bmp as ImageBitmap).close()

  const blob = await new Promise<Blob>((ok, no) =>
    canvas.toBlob((b) => (b ? ok(b) : no(new Error('toBlob 失败'))), 'image/png')
  )
  return URL.createObjectURL(blob)
}

/**
 * 检查并降采样模型贴图。
 *
 * 行为保证：**永远不会阻塞模型加载**。任何异常/超时都被吞掉并跳过该贴图。
 *
 * @param modelJSON 含 FileReferences.Textures 的 modelJSON
 * @param prefixUrl 模型目录 URL 前缀（如 app://bundle/models/xxx/）
 * @param onProgress 进度回调（用于界面提示，可省略）
 */
export async function prepareTextures(
  modelJSON: any,
  prefixUrl: string,
  onProgress?: (done: number, total: number) => void
): Promise<DownscaleResult> {
  const map = new Map<string, string>()
  const created: string[] = []
  let downscaled = 0

  const textures: string[] = modelJSON?.FileReferences?.Textures ?? []
  if (textures.length === 0) {
    return { map, downscaled, revoke: () => {} }
  }

  // 第一步：并发读文件头拿尺寸（每个只取 32 字节，极快）
  const sizes = await Promise.all(
    textures.map(async (rel) => {
      try {
        const s = await withTimeout(readPngSize(`${prefixUrl}${rel}`), PER_TEXTURE_TIMEOUT, '读取尺寸')
        return { rel, ...(s ?? { w: 0, h: 0 }) }
      } catch {
        return { rel, w: 0, h: 0 }
      }
    })
  )

  const oversized = sizes.filter((s) => s.w > MAX_TEXTURE_SIZE || s.h > MAX_TEXTURE_SIZE)
  if (oversized.length === 0) {
    console.log('[live2d] 贴图尺寸均在限制内，无需处理')
    return { map, downscaled, revoke: () => {} }
  }

  console.log(
    `[live2d] 发现 ${oversized.length} 张超大贴图：` +
      oversized.map((s) => `${s.rel}(${s.w}x${s.h})`).join(', ')
  )

  // 第二步：只处理超尺寸的那几张
  for (let i = 0; i < oversized.length; i++) {
    const { rel } = oversized[i]
    try {
      const blobUrl = await withTimeout(
        downscaleToBlobUrl(`${prefixUrl}${rel}`, MAX_TEXTURE_SIZE),
        PER_TEXTURE_TIMEOUT * 3,
        `降采样 ${rel}`
      )
      map.set(rel, blobUrl)
      created.push(blobUrl)
      downscaled++
    } catch (e) {
      console.warn(`[live2d] 贴图 ${rel} 处理失败，将按原图加载：`, e)
    }
    onProgress?.(i + 1, oversized.length)
  }

  if (downscaled > 0) console.log(`[live2d] 已降采样 ${downscaled} 张贴图`)
  return {
    map,
    downscaled,
    revoke: () => created.forEach((u) => URL.revokeObjectURL(u))
  }
}

export { MAX_TEXTURE_SIZE }
