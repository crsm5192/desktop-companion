import { app } from 'electron'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { loadMusicMetadata } from 'music-metadata'
import type { MusicInfo } from '../../shared/types'
import { externalMusicDir } from '../paths'

const AUDIO_EXT = /\.(mp3|wav|flac|ogg|m4a|aac)$/i

/** 清洗标题：控制符占比过高/替换符/mojibake 时返回 undefined（回退文件名） */
function cleanTitle(t: string | undefined): string | undefined {
  if (!t) return undefined
  // 控制符占比过高 → 二进制垃圾（WAV RIFF INFO 被误读成文本）
  let control = 0
  for (const ch of t) {
    const code = ch.codePointAt(0) as number
    if (code < 0x20 || code === 0x7f) control++
  }
  if (control > 0 && control / t.length > 0.2) return undefined

  const c = t.replace(/[\uFFFD\u0000-\u001F\uFFFE\uFFFF]/g, '').trim()
  if (!c) return undefined
  // Latin-1 补充区字符（如 ã Ã ½ 等）占比过高 → 很可能是 Shift-JIS/GBK 被当 UTF-8 误读
  let weird = 0
  for (const ch of c) {
    const code = ch.codePointAt(0) as number
    if (code >= 0x00c0 && code <= 0x00ff) weird++
  }
  if (weird > 0 && weird / c.length > 0.25) return undefined
  return c
}

/** 音乐目录：打包后再数据目录，开发时在 public/music */
export function musicDir(): string {
  return app.isPackaged
    ? externalMusicDir()
    : join(app.getAppPath(), 'src', 'renderer', 'public', 'music')
}

/** 扫描音乐目录，读取音频元数据标题（没有则回退文件名） */
export async function listMusic(): Promise<MusicInfo[]> {
  const dir = musicDir()
  if (!existsSync(dir)) return []

  const files = readdirSync(dir).filter((f) => AUDIO_EXT.test(f))
  // music-metadata v10 的 CJS 入口是 lazy loader，先加载实际模块
  const mm = await loadMusicMetadata()

  const result = await Promise.all(
    files.map(async (f) => {
      let title = f.replace(AUDIO_EXT, '')
      let artist: string | undefined
      try {
        const buf = readFileSync(join(dir, f))
        const meta = await mm.parseBuffer(buf, join(dir, f))
        const t = cleanTitle(meta.common.title)
        if (t) title = t
        const a = cleanTitle(meta.common.artist)
        if (a) artist = a
      } catch (e) {
        console.log('[music] 元数据读取失败', f, String(e))
      }
      return { name: title, artist, path: `music/${f}` }
    })
  )
  return result.sort((a, b) => a.name.localeCompare(b.name))
}