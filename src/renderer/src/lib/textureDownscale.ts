/**
 * 超大贴图自动降采样。
 *
 * 背景：部分 Live2D 模型带 8192×8192 之类的巨幅贴图（5 张合计可达 600MB 显存）。
 * 这类纹理在部分显卡上会分配失败；另外解码它们也极慢，容易把界面卡住。
 *
 * 关键经验（都踩过）：
 *  1. **尺寸查询必须走主进程 fs 读 PNG 文件头**。
 *     `app://` 自定义协议下 `fetch` 会直接 `TypeError: Failed to fetch`，
 *     所以浏览器里根本无法用 Range/fetch 探测尺寸；而主进程 openSync 只读 32 字节，
 *     又快又准。
 *  2. **绝不能为了"检查尺寸"去解码整张图**，否则卡死在"检查贴图尺寸…"。
 *  3. **贴图优化不能阻塞模型加载**：任何失败/超时都跳过，按原图继续。
 */

/** 单张纹理的边长上限（超过才降采样）。8192→4096 可省 3/4 显存 */
const MAX_TEXTURE_SIZE = 4096

/** 单张图处理超时（毫秒） */
const PER_TEXTURE_TIMEOUT = 20000

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

/** 通过 app:// URL 下载图片并解码（app:// 不支持 fetch，用 Image 更可靠） */
function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('图片加载/解码失败'))
    img.src = url
  })
}

/** 缩到目标尺寸并转成 blob URL */
async function downscaleToBlobUrl(url: string, maxSize: number): Promise<string> {
  const img = await loadImage(url)
  const srcW = img.naturalWidth
  const srcH = img.naturalHeight
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
  ctx.drawImage(img, 0, 0, outW, outH)

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
 * @param modelPath  model3.json 的相对路径（models/xxx/yyy.model3.json）
 * @param modelJSON  含 FileReferences.Textures 的 modelJSON
 * @param prefixUrl  模型目录 URL 前缀（如 app://bundle/models/xxx/）
 */
export async function prepareTextures(
  modelPath: string,
  modelJSON: any,
  prefixUrl: string
): Promise<DownscaleResult> {
  const map = new Map<string, string>()
  const created: string[] = []
  let downscaled = 0

  const textures: string[] = modelJSON?.FileReferences?.Textures ?? []
  if (textures.length === 0) return { map, downscaled, revoke: () => {} }

  // 尺寸由主进程读文件头得到（app:// 下浏览器 fetch 不可用）
  let sizes: { file: string; width: number; height: number; known: boolean }[] = []
  try {
    sizes = await withTimeout(
      window.api.models.textureSizes(modelPath),
      10000,
      '查询贴图尺寸'
    )
  } catch (e) {
    console.warn('[live2d] 查询贴图尺寸失败，按原图加载：', e)
    return { map, downscaled, revoke: () => {} }
  }

  const oversized = sizes.filter(
    (s) => s.known && (s.width > MAX_TEXTURE_SIZE || s.height > MAX_TEXTURE_SIZE)
  )

  console.log(
    `[live2d] 贴图检查：共 ${sizes.length} 张，` +
      `超尺寸 ${oversized.length} 张` +
      (oversized.length
        ? `（${oversized.map((s) => `${s.file} ${s.width}x${s.height}`).join(', ')}）`
        : '')
  )

  if (oversized.length === 0) return { map, downscaled, revoke: () => {} }

  // 只处理超尺寸的那几张
  for (const t of oversized) {
    try {
      const blobUrl = await withTimeout(
        downscaleToBlobUrl(`${prefixUrl}${t.file}`, MAX_TEXTURE_SIZE),
        PER_TEXTURE_TIMEOUT,
        `降采样 ${t.file}`
      )
      map.set(t.file, blobUrl)
      created.push(blobUrl)
      downscaled++
      console.log(`[live2d] 已降采样 ${t.file}`)
    } catch (e) {
      console.warn(`[live2d] 贴图 ${t.file} 降采样失败，按原图加载：`, e)
    }
  }

  return {
    map,
    downscaled,
    revoke: () => created.forEach((u) => URL.revokeObjectURL(u))
  }
}

export { MAX_TEXTURE_SIZE }
