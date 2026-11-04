import { extractPerformance, type PerformanceCue } from '@shared/control'
export interface ParsedReply {
  performance?: PerformanceCue
  /** 页面显示的干净中文 */
  display: string
  /** 用于 TTS 的文本（日语优先） */
  speak: string
}

/**
 * 解析助手回复：
 * - 提取日语部分作为语音文本：优先找「日语：」标签行；没有标签时，
 *   自动识别含假名（ひらがな/カタカナ）的连续段落；
 * - 去掉文件路径、🎧 语音行、「翻译：」标签等元数据，得到干净的中文显示文本；
 * - 若没有任何日语，则用中文作为语音兜底。
 */
export function parseAssistantReply(raw: string): ParsedReply {
  const extracted = extractPerformance(raw)
  raw = extracted.text
  const lines = raw.split(/\r?\n/)

  // 找日语起点：优先「日语：」标签；否则从末尾往前找连续的含假名块
  let jpStart = -1
  for (let i = 0; i < lines.length; i++) {
    if (/^日语[：:]/.test(lines[i].trim())) {
      jpStart = i
      break
    }
  }
  if (jpStart < 0) {
    let i = lines.length - 1
    while (i >= 0 && lines[i].trim() === '') i-- // 跳过末尾空行
    let found = false
    while (i >= 0 && /[\u3040-\u30ff]/.test(lines[i])) {
      jpStart = i
      found = true
      i--
    }
    if (!found) jpStart = -1
  }

  const displayLines: string[] = []
  let speakLines: string[] = []

  lines.forEach((line, i) => {
    const t = line.trim()
    // 日语语音部分（从日语起点到结尾）
    if (jpStart >= 0 && i >= jpStart) {
      const jpTxt = i === jpStart && /^日语[：:]/.test(t) ? t.replace(/^日语[：:]\s*/, '') : line
      if (jpTxt.trim()) speakLines.push(jpTxt)
      return
    }
    // 中文显示部分
    if (!t) {
      displayLines.push('')
      return
    }
    if (/^[A-Za-z]:[\\/]/.test(t)) return // 盘符路径行
    if (/🎧/.test(t)) return // 🎧 语音行
    const trans = t.match(/翻译[：:]\s*[「“"](.+?)[」”"]/)
    if (trans) {
      displayLines.push(trans[1])
      return
    }
    displayLines.push(line)
  })

  const display = displayLines.join('\n').replace(/\n{3,}/g, '\n\n').trim()
  const speak = speakLines.join('\n').replace(/\n{3,}/g, '\n\n').trim()

  return {
    performance: extracted.performance,
    display: display || raw.trim(),
    speak: speak || display
  }
}
