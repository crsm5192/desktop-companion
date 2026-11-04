import { create } from 'zustand'

/**
 * 说话状态共享 store：TTS 朗读时驱动 mouthLevel（0..1），
 * Live2DPet 每帧把它写进 ParamMouthOpenY，实现口型联动。
 */

interface SpeechState {
  speaking: boolean
  mouthLevel: number
  setLevel: (level: number) => void
  startSpeaking: () => void
  stopSpeaking: () => void
}

export const useSpeechStore = create<SpeechState>((set) => ({
  speaking: false,
  mouthLevel: 0,
  startSpeaking: () => {
    set({ speaking: true, mouthLevel: 0 })
  },
  setLevel: level => set({ speaking: true, mouthLevel: Math.max(0, Math.min(1, level)) }),
  stopSpeaking: () => {
    set({ speaking: false, mouthLevel: 0 })
  }
}))
