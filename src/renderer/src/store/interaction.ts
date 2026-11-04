import { create } from 'zustand'
import type { InteractionRegion } from '../lib/petInteraction'
import { CHOREOGRAPHIES, createChoreographySelector } from '../lib/interactionChoreography'

interface InteractionMessage {
  id: number
  text: string
  region?: InteractionRegion
  variant?: number
  actionLabel?: string
}

interface InteractionState {
  message: InteractionMessage | null
  show: (text: string, region?: InteractionRegion) => void
  react: (region: InteractionRegion) => number
  clear: (id?: number) => void
}

let nextId = 0
const nextVariant = createChoreographySelector()

export const useInteractionStore = create<InteractionState>((set) => ({
  message: null,
  show: (text, region) => set({ message: { id: ++nextId, text, region } }),
  react: (region) => {
    const variant = nextVariant(region)
    const selected = CHOREOGRAPHIES[region][variant]
    set({ message: { id: ++nextId, text: selected.phrase, region, variant, actionLabel: selected.label } })
    return variant
  },
  clear: (id) => set((state) => id === undefined || state.message?.id === id ? { message: null } : {})
}))
