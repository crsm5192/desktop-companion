import { useCallback, useEffect, useRef, useState } from 'react'
import { useSpeechStore } from '../store/speech'

interface CachedAudio {
  mime: string
  base64: string
}

/** 去掉回复里混入的"发语音提示 + 文件路径"等元数据，只留真正要说的内容 */
function sanitizeForTts(text: string): string {
  let t = text
  // 1) 文件路径（盘符 + 媒体扩展名）
  t = t.replace(/[A-Za-z]:[\\/][^\s]*\.(mp3|wav|flac|ogg|m4a|aac|mp4)/gi, '')
  // 2) "喏，给你发了条语音，听一下嘛：" 之类提示语
  t = t.replace(/喏?[，,、]?\s*(?:给?你?)?发(?:了条)?语音[，,、]?\s*听一下嘛[：:！!~～。]*/g, '')
  // 3) 清理行尾空格 / 空行 / 结尾标点
  t = t.replace(/[ \t]+$/gm, '').replace(/\n{3,}/g, '\n\n').replace(/[。…·\s]+$/g, '')
  return t.trim()
}

export function useTTS(): {
  speak: (text: string) => Promise<boolean>
  stop: () => void
  error: string | null
} {
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const cacheRef = useRef<Map<string, CachedAudio>>(new Map())
  const [error, setError] = useState<string | null>(null)
  const notifySpeaking = (speaking: boolean): void => {
    if (window.location.hash === '#chat') window.api.chatWindow.setSpeaking(speaking)
  }

  useEffect(() => () => {
    audioRef.current?.pause()
    useSpeechStore.getState().stopSpeaking()
    notifySpeaking(false)
  }, [])

  const speak = useCallback(async (text: string): Promise<boolean> => {
    const clean = sanitizeForTts(text)
    if (!clean) return false
    try {
      setError(null)
      // 同一句缓存：第一次合成，之后点小喇叭直接重播，不再重新生成
      let cached = cacheRef.current.get(clean)
      if (!cached) {
        cached = await window.api.tts.speak(clean)
        if (cacheRef.current.size > 30) cacheRef.current.clear()
        cacheRef.current.set(clean, cached)
      }
      const audio = new Audio(`data:${cached.mime};base64,${cached.base64}`)
      audioRef.current?.pause()
      audioRef.current = audio
      // 口型联动：开播驱动，播完停止
      const speech = useSpeechStore.getState()
      speech.startSpeaking()
      notifySpeaking(true)
      audio.onended = () => { speech.stopSpeaking(); notifySpeaking(false) }
      audio.onerror = () => { speech.stopSpeaking(); notifySpeaking(false) }
      await audio.play()
      return true
    } catch (e) {
      useSpeechStore.getState().stopSpeaking()
      notifySpeaking(false)
      const msg = e instanceof Error ? e.message : String(e)
      setError(msg)
      console.error('[tts] 播放/合成失败：', msg)
      return false
    }
  }, [])

  const stop = useCallback(() => {
    audioRef.current?.pause()
    audioRef.current = null
    useSpeechStore.getState().stopSpeaking()
    notifySpeaking(false)
  }, [])

  return { speak, stop, error }
}
