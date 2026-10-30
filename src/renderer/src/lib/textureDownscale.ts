/**
 * 超大贴图自动降采样。
 *
 * 问题：部分 Live2D 模型带 8192×8192 之类的巨幅贴图，5 张合计显存可达 600MB+。
 * 某些显卡/驱动在分配这种纹理时会直接失败，而 Cubism Core 的错误路径在压缩版里
 * 表现为 `CubismLogError is not a constructor`，导致模型"静默加载失败"（画面空白）。
 *
 * 做法：加载前检查每张贴图尺寸，超过阈值就在**内存里**降采样到安全尺寸，
 * 再用 `CubismSetting.redirectPath()` 指向降采样结果。原始文件不动。
 */

/** 单张纹理的边长上限（超过就降采样）。8192→4096 可省 3/4 显存 */
const MAX_TEXTURE_SIZE = 4096

export interface DownscaleResult {
  /** 原始 URL → 降采样后的 blob URL */
  map: Map<string, string>
  /** 被处理的贴图数量 */
  downscaled: number
  /** 需要释放的 blob URL */
  revoke: () => void
}

/** 把 URL 加载成 ImageBitmap（走浏览器缓存，不重复下载） */
async function loadBitmap(url: string): Promise<ImageBitmap | HTMLImageElement> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`贴图加载失败 ${res.status}: ${url}`)
  const blob = await res.blob()
  // 优先 ImageBitmap（更快），不支持则退回 Image
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

/** 降采样并转成 blob URL */
async function downscaleToBlobUrl(src: string, w: number, h: number): Promise<string> {
  const bmp = await loadBitmap(src)
  const srcW = 'width' in bmp ? bmp.width : 0
  const srcH = 'height' in bmp ? bmp.height : 0
  const scale = Math.min(w / srcW, h / srcH, 1)
  const outW = Math.max(1, Math.round(srcW * scale))
  const outH = Math.max(1, Math.round(srcH * scale))

  const canvas = document.createElement('canvas')
  canvas.width = outW
  canvas.height = outH
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('canvas 2d 上下文不可用')
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
 * 检查并降采样模型的贴图。
 * @param modelJSON  已补全声明的 modelJSON（含 FileReferences.Textures）
 * @param prefixUrl  模型目录的 URL 前缀（如 app://bundle/models/xxx/）
 */
export async function prepareTextures(
  modelJSON: any,
  prefixUrl: string
): Promise<DownscaleResult> {
  const map = new Map<string, string>()
  const created: string[] = []
  let downscaled = 0

  const textures: string[] = modelJSON?.FileReferences?.Textures ?? []

  for (const rel of textures) {
    const url = `${prefixUrl}${rel}`
    try {
      const bmp = await loadBitmap(url)
      const w = 'width' in bmp ? bmp.width : 0
      const h = 'height' in bmp ? bmp.height : 0
      if ('close' in bmp) (bmp as ImageBitmap).close()

      if (w <= MAX_TEXTURE_SIZE && h <= MAX_TEXTURE_SIZE) continue

      console.log(`[live2d] 贴图过大 ${rel} (${w}x${h})，降采样到 ${MAX_TEXTURE_SIZE}`)
      const blobUrl = await downscaleToBlobUrl(url, MAX_TEXTURE_SIZE, MAX_TEXTURE_SIZE)
      map.set(rel, blobUrl)
      created.push(blobUrl)
      downscaled++
    } catch (e) {
      console.warn(`[live2d] 贴图检查失败 ${rel}:`, e)
    }
  }

  return {
    map,
    downscaled,
    revoke: () => created.forEach((u) => URL.revokeObjectURL(u))
  }
}

export { MAX_TEXTURE_SIZE }
