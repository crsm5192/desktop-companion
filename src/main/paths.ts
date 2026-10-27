import { app } from 'electron'
import { join } from 'node:path'
import { cpSync, existsSync, mkdirSync, readdirSync, statSync } from 'node:fs'

/** 旧版（安和昴陪伴）的 userData 目录名，用于升级时自动迁移数据 */
const LEGACY_DIR_NAME = 'awa-subaru-companion'

/**
 * 一次性迁移：产品改名后 userData 目录会变（awa-subaru-companion → DesktopCompanion），
 * 首次启动时把旧目录里的 config.json / data.db / models / music 搬过来，避免用户以为数据丢了。
 */
function migrateLegacyData(): void {
  try {
    if (app.isPackaged === false) return // 开发环境不折腾
    const current = app.getPath('userData')
    const legacy = join(app.getPath('appData'), LEGACY_DIR_NAME)
    if (current === legacy) return
    if (!existsSync(legacy)) return
    mkdirSync(current, { recursive: true })
    for (const name of readdirSync(legacy)) {
      const src = join(legacy, name)
      const dst = join(current, name)
      if (existsSync(dst)) continue // 已有就不覆盖
      try {
        if (statSync(src).isDirectory()) cpSync(src, dst, { recursive: true })
        else cpSync(src, dst)
      } catch {
        /* 单项失败不影响其它 */
      }
    }
  } catch {
    /* 迁移是尽力而为，失败就算了 */
  }
}

/**
 * 应用数据根目录。
 * - 便携版（PORTABLE_EXECUTABLE_DIR 已设）：数据放 exe 旁边，随 exe 携带；
 * - 安装版（NSIS）：数据放 userData（%APPDATA%），覆盖安装/卸载不会被清空。
 */
export function appRootDir(): string {
  migrateLegacyData()
  return process.env.PORTABLE_EXECUTABLE_DIR || app.getPath('userData')
}

/** exe 旁边的 models 目录（便携外部模型） */
export function externalModelsDir(): string {
  return join(appRootDir(), 'models')
}

/** exe 旁边的 config.json（便携外部配置） */
export function externalConfigFile(): string {
  return join(appRootDir(), 'config.json')
}

/** exe 旁边的 music 目录（便携外部音乐） */
export function externalMusicDir(): string {
  return join(appRootDir(), 'music')
}