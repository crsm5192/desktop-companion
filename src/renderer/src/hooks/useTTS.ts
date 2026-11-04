import { useCallback, useEffect, useRef, useState } from 'react'
import { useSpeechStore } from '../store/speech'
import { extractPerformance, type PerformanceCue } from '@shared/control'

export interface SpeakOptions {
  performance?: PerformanceCue
  onStart?: (durationMs: number) => void
  onProgress?: (progress: number) => void
  onEnd?: () => void
}

interface CachedAudio {
  mime: string
  base64: string
}

/** 去掉回复里混入的"发语音提示 + 文件路径"等元数据，只留真正要说的内容 */
function sanitizeForTts(text: string): string {
  let t = extractPerformance(text).text
  // 1) 文件路径（盘符 + 媒体扩展名）
  t = t.replace(/[A-Za-z]:[\\/][^\s]*\.(mp3|wav|flac|ogg|m4a|aac|mp4)/gi, '')
  // 2) "喏，给你发了条语音，听一下嘛：" 之类提示语
  t = t.replace(/喏?[，,、]?\s*(?:给?你?)?发(?:了条)?语音[，,、]?\s*听一下嘛[：:！!~～。]*/g, '')
  // 3) 清理行尾空格 / 空行 / 结尾标点
  t = t.replace(/[ \t]+$/gm, '').replace(/\n{3,}/g, '\n\n').replace(/[。…·\s]+$/g, '')
  return t.trim()
}

export function useTTS(): {
  speak: (text: string, options?: SpeakOptions) => Promise<boolean>
  stop: () => void
  error: string | null
} {
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const cacheRef = useRef<Map<string, CachedAudio>>(new Map())
  const contextRef = useRef<AudioContext | null>(null)
  const cleanupRef = useRef<(() => void) | null>(null)
  const generationRef = useRef(0)
  const [error, setError] = useState<string | null>(null)
  const publish = useCallback((speaking: boolean, level: number): void => {
    if (speaking) useSpeechStore.getState().setLevel(level)
    else useSpeechStore.getState().stopSpeaking()
    if (window.location.hash === '#chat') window.api.control.speechLevel(speaking, level)
  }, [])

  const stop = useCallback(() => {
    generationRef.current++
    audioRef.current?.pause()
    audioRef.current = null
    cleanupRef.current?.()
    cleanupRef.current = null
    publish(false, 0)
  }, [publish])

  useEffect(() => () => { stop(); void contextRef.current?.close() }, [stop])

  const speak = useCallback(async (text: string, options?: SpeakOptions): Promise<boolean> => {
    const clean = sanitizeForTts(text)
    if (!clean) return false
    stop()
    const generation = generationRef.current
    try {
      setError(null)
      // 同一句缓存：第一次合成，之后点小喇叭直接重播，不再重新生成
      let cached = cacheRef.current.get(clean)
      if (!cached) {
        cached = await window.api.tts.speak(clean)
        if (cacheRef.current.size > 30) cacheRef.current.clear()
        cacheRef.current.set(clean, cached)
      }
      if (generation !== generationRef.current) return false
      const audio = new Audio(`data:${cached.mime};base64,${cached.base64}`)
      audioRef.current = audio
      const context = contextRef.current ?? new AudioContext()
      contextRef.current = context
      await context.resume()
      if (generation !== generationRef.current) return false
      const source = context.createMediaElementSource(audio)
      const analyser = context.createAnalyser()
      analyser.fftSize = 1024
      source.connect(analyser); analyser.connect(context.destination)
      const samples = new Float32Array(analyser.fftSize)
      let frame = 0
      let level = 0
      let lastPublish = 0
      let started = false
      let finished = false
      const cleanup = (): void => {
        if (finished) return
        finished = true
        cancelAnimationFrame(frame)
        source.disconnect(); analyser.disconnect()
        audio.onended = null; audio.onerror = null
        if (generation === generationRef.current) publish(false, 0)
        if (started) { window.api.control.emit('speech.finished', {}); options?.onEnd?.() }
      }
      cleanupRef.current = cleanup
      audio.onended = cleanup
      audio.onerror = cleanup
      await audio.play()
      if (generation !== generationRef.current) { audio.pause(); cleanup(); return false }
      started = true
      publish(true, 0)
      const durationMs = Number.isFinite(audio.duration) ? audio.duration * 1000 : 0
      options?.onStart?.(durationMs)
      window.api.control.emit('speech.started', { duration: Number.isFinite(audio.duration) ? audio.duration : null })
      let nextPerformanceAt = 0
      const perform = (): void => {
        if (!options?.performance) return
        const remaining = durationMs > 0 ? durationMs - audio.currentTime * 1000 : options.performance.durationMs ?? 3500
        const segment = Math.max(600, Math.min(10000, remaining))
        void window.api.control.execute({ type: 'performance.play', data: { ...options.performance, durationMs: segment } }).catch(err => console.warn('[performance]', err))
        nextPerformanceAt = audio.currentTime + segment / 1000
      }
      perform()
      let lastProgress = 0
      const sample = (now: number): void => {
        if (finished) return
        analyser.getFloatTimeDomainData(samples)
        const rms = Math.sqrt(samples.reduce((sum, value) => sum + value * value, 0) / samples.length)
        const target = Math.max(0, Math.min(1, (rms - 0.008) * 7))
        level += (target - level) * (target > level ? 0.65 : 0.25)
        if (now - lastPublish >= 30) { publish(true, level); lastPublish = now }
        if (now - lastProgress >= 100) {
          if (durationMs > 0) options?.onProgress?.(Math.min(1, audio.currentTime * 1000 / durationMs))
          if (options?.performance && audio.currentTime >= nextPerformanceAt && (durationMs === 0 || durationMs - audio.currentTime * 1000 > 350)) perform()
          lastProgress = now
        }
        frame = requestAnimationFrame(sample)
      }
      frame = requestAnimationFrame(sample)
      return true
    } catch (e) {
      if (generation !== generationRef.current) return false
      stop()
      const msg = e instanceof Error ? e.message : String(e)
      setError(msg)
      console.error('[tts] 播放/合成失败：', msg)
      return false
    }
  }, [publish, stop])

  return { speak, stop, error }
}
