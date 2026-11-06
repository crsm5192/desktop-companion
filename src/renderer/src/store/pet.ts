import { create } from 'zustand'
import type { AntialiasingSamples } from '@shared/petRendering'

interface PetState {
  modelPath: string
  scale: number
  opacity: number
  antialiasing: boolean
  antialiasingSamples: AntialiasingSamples
  locked: boolean
  interactionEnabled: boolean
  edgeSnapEnabled: boolean
  modelReady: boolean
  offsetX: number
  offsetY: number
  eyeTracking: boolean
  eyeTrackingStrength: number
  headX: number
  headY: number
  setModel: (modelPath: string, scale: number) => void
  setScale: (scale: number) => void
  setOpacity: (opacity: number) => void
  setAntialiasing: (enabled: boolean, samples: AntialiasingSamples) => void
  setLocked: (locked: boolean) => void
  setInteractionEnabled: (enabled: boolean) => void
  setEdgeSnapEnabled: (enabled: boolean) => void
  setModelReady: (ready: boolean) => void
  setOffset: (offsetX: number, offsetY: number) => void
  setEyeTracking: (eyeTracking: boolean) => void
  setEyeTrackingStrength: (eyeTrackingStrength: number) => void
  setHead: (headX: number, headY: number) => void
}

/**
 * 宠物共享状态：设置面板保存后写这里，PetStage/App 订阅后即时刷新，无需重启。
 */
export const usePetStore = create<PetState>((set) => ({
  modelPath: '',
  scale: 1,
  opacity: 1,
  antialiasing: false,
  antialiasingSamples: 2,
  locked: false,
  interactionEnabled: false,
  edgeSnapEnabled: false,
  modelReady: false,
  offsetX: 0,
  offsetY: 0,
  eyeTracking: true,
  eyeTrackingStrength: 1,
  headX: 0,
  headY: 0,
  setModel: (modelPath, scale) => set({ modelPath, scale }),
  setScale: (scale) => set({ scale }),
  setOpacity: (opacity) => set({ opacity }),
  setAntialiasing: (antialiasing, antialiasingSamples) => set({ antialiasing, antialiasingSamples }),
  setLocked: (locked) => set({ locked }),
  setInteractionEnabled: (interactionEnabled) => set({ interactionEnabled }),
  setEdgeSnapEnabled: (edgeSnapEnabled) => set({ edgeSnapEnabled }),
  setModelReady: (modelReady) => set({ modelReady }),
  setOffset: (offsetX, offsetY) => set({ offsetX, offsetY }),
  setEyeTracking: (eyeTracking) => set({ eyeTracking }),
  setEyeTrackingStrength: (eyeTrackingStrength) => set({ eyeTrackingStrength }),
  setHead: (headX, headY) => set((state) =>
    Math.abs(state.headX - headX) < 0.25 && Math.abs(state.headY - headY) < 0.25 ? state : { headX, headY })
}))
