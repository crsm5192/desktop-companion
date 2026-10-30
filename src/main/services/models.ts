import { app } from 'electron'
import { closeSync, existsSync, openSync, readdirSync, readFileSync, readSync, statSync } from 'node:fs'
import { dirname, join, relative, sep } from 'node:path'
import type { ModelAction, ModelActionsInfo, ModelInfo, TextureSizeInfo } from '../../shared/types'
import { externalModelsDir } from '../paths'

export function modelsDir(): string {
  // 打包后：exe 旁边的 models 目录（便携）；开发：src/renderer/public/models
  return app.isPackaged
    ? externalModelsDir()
    : join(app.getAppPath(), 'src', 'renderer', 'public', 'models')
}

/**
 * 读取 PNG 文件头拿到宽高（只读前 32 字节，不解码整图）。
 * PNG：8 字节签名 + 4 字节长度 + "IHDR" + 4 字节宽 + 4 字节高（大端）
 */
function readPngSize(absPath: string): { w: number; h: number } | null {
  let fd: number | null = null
  try {
    fd = openSync(absPath, 'r')
    const b = Buffer.alloc(32)
    const n = readSync(fd, b, 0, 32, 0)
    if (n < 24) return null
    const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
    for (let i = 0; i < 8; i++) if (b[i] !== sig[i]) return null
    if (!(b[12] === 0x49 && b[13] === 0x48 && b[14] === 0x44 && b[15] === 0x52)) return null
    const w = b.readUInt32BE(16)
    const h = b.readUInt32BE(20)
    if (!w || !h) return null
    return { w, h }
  } catch {
    return null
  } finally {
    if (fd !== null) {
      try {
        closeSync(fd)
      } catch {
        /* ignore */
      }
    }
  }
}

/**
 * 查询模型各张贴图的尺寸（供渲染层判断是否需要降采样）。
 *
 * 为什么放在主进程：`app://` 自定义协议不支持 `fetch`（浏览器层会 TypeError），
 * 但主进程能直接 `fs` 读文件头，既准确又快（每张只读 32 字节）。
 */
export function getModelTextureSizes(model3Path: string): TextureSizeInfo[] {
  const rel = model3Path.replace(/^models\//, '').replace(/^\.\//, '')
  const abs = join(modelsDir(), rel)
  const dir = dirname(abs)
  const out: TextureSizeInfo[] = []

  let json: { FileReferences?: { Textures?: string[] } } | null = null
  try {
    json = JSON.parse(readFileSync(abs, 'utf8'))
  } catch {
    return out
  }

  const textures = json?.FileReferences?.Textures ?? []
  for (const t of textures) {
    const clean = t.replace(/^\.\//, '')
    const p = join(dir, clean)
    const size = existsSync(p) ? readPngSize(p) : null
    out.push({
      file: clean,
      width: size?.w ?? 0,
      height: size?.h ?? 0,
      known: !!size
    })
  }
  return out
}

/** 扫描模型目录，返回每个子目录下的 model3.json（渲染层用相对路径加载） */
export function listModels(): ModelInfo[] {
  const dir = modelsDir()
  const result: ModelInfo[] = []
  if (!existsSync(dir)) return result

  for (const entry of readdirSync(dir)) {
    const sub = join(dir, entry)
    try {
      if (!statSync(sub).isDirectory()) continue
      const files = readdirSync(sub).filter((f) => f.endsWith('.model3.json'))
      for (const f of files) {
        result.push({ name: entry, model3Path: `models/${entry}/${f}` })
      }
    } catch {
      continue
    }
  }
  return result.sort((a, b) => a.name.localeCompare(b.name))
}

/** 递归收集某目录下指定后缀的文件（返回相对模型目录、以 / 分隔的路径） */
function walkFiles(root: string, suffix: string, cur = root, out: string[] = []): string[] {
  let entries: string[]
  try {
    entries = readdirSync(cur)
  } catch {
    return out
  }
  for (const name of entries) {
    const full = join(cur, name)
    let st
    try {
      st = statSync(full)
    } catch {
      continue
    }
    if (st.isDirectory()) {
      walkFiles(root, suffix, full, out)
    } else if (name.toLowerCase().endsWith(suffix)) {
      out.push(relative(root, full).split(sep).join('/'))
    }
  }
  return out
}

function fileStem(p: string): string {
  const base = p.split('/').pop() ?? p
  return base
    .replace(/\.exp3\.json$/i, '')
    .replace(/\.motion3\.json$/i, '')
    .replace(/\.json$/i, '')
    .trim()
}

/**
 * 探测某个模型可用的「按键」（表情 / 动作），并把未声明的项补进 modelJSON。
 *
 * 关键点：很多模型（VTS 导出）目录里放了一堆 exp3.json / motion3.json，但 model3.json
 * 里根本没声明 Expressions / Motions，所以通用播放器里按键不可用。这里扫描磁盘补声明，
 * 返回补全后的 modelJSON 供渲染层直接构造 CubismSetting（不改磁盘模型文件）。
 */
export function discoverModelActions(model3Path: string): ModelActionsInfo {
  const empty: ModelActionsInfo = { modelJSON: null, expressions: [], motions: [] }
  // model3Path 形如 models/<dir>/<file>.model3.json
  const rel = model3Path.replace(/^\/+/, '')
  if (!rel.startsWith('models/')) return empty
  const abs = join(modelsDir(), rel.slice('models/'.length))
  if (!existsSync(abs)) return empty

  const modelDir = dirname(abs)
  let raw: any
  try {
    raw = JSON.parse(readFileSync(abs, 'utf8'))
  } catch {
    return empty
  }

  const fileRefs = (raw.FileReferences ??= {})
  const declaredExpr: Array<{ Name?: string; File: string }> = Array.isArray(fileRefs.Expressions)
    ? fileRefs.Expressions.slice()
    : []
  const declaredMotions: Record<string, Array<{ File: string; Sound?: string }>> =
    fileRefs.Motions && typeof fileRefs.Motions === 'object' ? fileRefs.Motions : {}

  const norm = (p: string): string => p.replace(/^\.\//, '').replace(/^\/+/, '')
  const declaredExprFiles = new Set(declaredExpr.map((e) => norm(e.File)))
  const declaredMotionFiles = new Set<string>()
  for (const list of Object.values(declaredMotions)) {
    for (const m of list ?? []) declaredMotionFiles.add(norm(m.File))
  }

  // 磁盘上实际存在的
  const diskExpr = walkFiles(modelDir, '.exp3.json')
  const diskMotion = walkFiles(modelDir, '.motion3.json')

  // 补表情声明
  const addedExpr: Array<{ Name: string; File: string }> = []
  for (const f of diskExpr) {
    if (declaredExprFiles.has(f)) continue
    addedExpr.push({ Name: fileStem(f), File: f })
    declaredExprFiles.add(f)
  }
  if (addedExpr.length) fileRefs.Expressions = [...declaredExpr, ...addedExpr]

  // 补动作声明：未声明的动作文件统一归到 "Extra" 分组（不影响原有分组）
  const addedMotion: Array<{ File: string }> = []
  for (const f of diskMotion) {
    if (declaredMotionFiles.has(f)) continue
    addedMotion.push({ File: f })
    declaredMotionFiles.add(f)
  }
  if (addedMotion.length) {
    fileRefs.Motions = { ...declaredMotions, Extra: [...(declaredMotions.Extra ?? []), ...addedMotion] }
  }

  // 生成按钮列表
  const expressions: ModelAction[] = (fileRefs.Expressions ?? []).map(
    (e: any): ModelAction => ({
      name: e.Name || fileStem(e.File),
      kind: 'expression',
      file: norm(e.File)
    })
  )

  const motions: ModelAction[] = []
  const allMotions: Record<string, Array<{ File: string }>> = fileRefs.Motions ?? {}
  for (const [group, list] of Object.entries(allMotions)) {
    if (list.length === 0) continue
    list.forEach((m, i) => {
      // 只有一个动作时直接显示组名；多个才加序号，避免「Extra 1」这种没信息量的名字
      const label = list.length === 1 ? group : `${group} ${i + 1}`
      motions.push({
        name: label,
        kind: 'motion',
        group,
        index: i
      })
    })
  }

  return { modelJSON: raw, expressions, motions }
}
