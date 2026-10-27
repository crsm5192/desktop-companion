import { app } from 'electron'
import { existsSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { appRootDir, externalModelsDir, externalMusicDir } from '../paths'

const AUDIO_EXT = /\.(mp3|wav|flac|ogg|m4a|aac)$/i

/** 写一份诊断日志到 exe 旁（排查换电脑后模型/音乐找不到的问题） */
export function writeDiagnostic(): void {
  try {
    const root = appRootDir()
    const md = externalModelsDir()
    const mud = externalMusicDir()

    const modelNames: string[] = []
    if (existsSync(md)) {
      for (const e of readdirSync(md)) {
        try {
          if (statSync(join(md, e)).isDirectory()) modelNames.push(e)
        } catch {
          /* ignore */
        }
      }
    }

    const musicNames: string[] = []
    if (existsSync(mud)) {
      musicNames.push(...readdirSync(mud).filter((f) => AUDIO_EXT.test(f)))
    }

    const lines = [
      '===== 桌面伴侣 诊断日志 =====',
      `时间 = ${new Date().toISOString()}`,
      `isPackaged = ${app.isPackaged}`,
      `PORTABLE_EXECUTABLE_DIR = ${process.env.PORTABLE_EXECUTABLE_DIR ?? '(未设置)'}`,
      `appRootDir = ${root}`,
      `modelsDir = ${md}  → 存在: ${existsSync(md)}`,
      `模型数量 = ${modelNames.length}`,
      ...modelNames.map((n) => `  - ${n}`),
      `musicDir = ${mud}  → 存在: ${existsSync(mud)}`,
      `音乐数量 = ${musicNames.length}`,
      ...musicNames.map((n) => `  - ${n}`),
      ''
    ]
    writeFileSync(join(root, 'diagnostic.log'), lines.join('\n'), 'utf-8')
    console.log('[diag] 诊断日志已写入:', join(root, 'diagnostic.log'))
  } catch (e) {
    console.error('[diag] 诊断日志写入失败:', e)
  }
}
