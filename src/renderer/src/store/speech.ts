import { create } from 'zustand'

/**
 * 说话状态共享 store：TTS 朗读时驱动 mouthLevel（0..1），
 * Live2DPet 每帧把它写进 ParamMouthOpenY，实现口型联动。
 */
let raf = 0
let t = 0

interface SpeechState {
  speaking: boolean
  mouthLevel: number
  startSpeaking: () => void
  stopSpeaking: () => void
}

export const useSpeechStore = create<SpeechState>((set) => ({
  speaking: false,
  mouthLevel: 0,
  startSpeaking: () => {
    const loop = (): void => {
      t += 0.045
      // 几路不同频率的正弦叠加出自然的口型起伏（放慢，最高约 3Hz，避免嘴动太快）
      const lv = 0.3 + 0.35 * Math.sin(t * 2.0) + 0.2 * Math.sin(t * 4.0) + 0.1 * Math.sin(t * 7.0)
      set({ speaking: true, mouthLevel: Math.max(0, Math.min(1, lv)) })
      raf = requestAnimationFrame(loop)
    }
    cancelAnimationFrame(raf)
    t = 0
    loop()
  },
  stopSpeaking: () => {
    cancelAnimationFrame(raf)
    set({ speaking: false, mouthLevel: 0 })
  }
}))
