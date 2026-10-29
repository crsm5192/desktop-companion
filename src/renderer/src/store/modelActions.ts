import { create } from 'zustand'
import type { ModelAction } from '@shared/types'

interface ModelActionsState {
  expressions: ModelAction[]
  motions: ModelAction[]
  /** 模型切换后由 PetStage 写入 */
  setActions: (expressions: ModelAction[], motions: ModelAction[]) => void
  clear: () => void
}

/**
 * 模型自带按键（表情 / 动作）的共享状态。
 * 探测在 PetStage 里做（它知道当前 modelPath），但按钮要渲染在工具栏那一排，
 * 所以用 store 中转，避免把状态层层透传。
 */
export const useModelActionsStore = create<ModelActionsState>((set) => ({
  expressions: [],
  motions: [],
  setActions: (expressions, motions) => set({ expressions, motions }),
  clear: () => set({ expressions: [], motions: [] })
}))
