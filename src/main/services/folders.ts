import { app, shell } from 'electron'
import { existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

/**
 * 打开应用的数据目录（模型 / 音乐 / 配置所在处）。
 * 目录不存在时先创建，避免「打开失败」让用户困惑。
 */

function ensureDir(p: string): string {
  if (!existsSync(p)) {
    try {
      mkdirSync(p, { recursive: true })
    } catch {
      /* 创建失败就让 shell 去报错 */
    }
  }
  return p
}

/** 模型目录：开发时在 src/renderer/public/models，打包后在数据目录/models */
export function openModelsDir(modelsDir: string): { ok: boolean; path: string; error?: string } {
  try {
    const p = ensureDir(modelsDir)
    void shell.openPath(p)
    return { ok: true, path: p }
  } catch (e) {
    return { ok: false, path: modelsDir, error: e instanceof Error ? e.message : String(e) }
  }
}

/** 音乐目录 */
export function openMusicDir(musicDir: string): { ok: boolean; path: string; error?: string } {
  try {
    const p = ensureDir(musicDir)
    void shell.openPath(p)
    return { ok: true, path: p }
  } catch (e) {
    return { ok: false, path: musicDir, error: e instanceof Error ? e.message : String(e) }
  }
}

/** 配置文件所在目录（config.json / data.db 旁边） */
export function openDataDir(rootDir: string): { ok: boolean; path: string; error?: string } {
  try {
    const p = ensureDir(rootDir)
    void shell.openPath(p)
    return { ok: true, path: p }
  } catch (e) {
    return { ok: false, path: rootDir, error: e instanceof Error ? e.message : String(e) }
  }
}
