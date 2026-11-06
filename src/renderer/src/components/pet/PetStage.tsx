import { useEffect } from 'react'
import Live2DPet from './Live2DPet'
import { usePetStore } from '../../store/pet'
import { useModelActionsStore } from '../../store/modelActions'
import { useInteractionStore } from '../../store/interaction'

/**
 * 桌面宠物渲染容器。
 * - pet.modelPath 配了 Live2D 模型 → 用 Live2DPet 渲染 .moc3
 * - 没配 → 用 CSS 占位小人兜底
 * - 模型切换：设置窗口保存配置后，主进程通知这里即时重载
 * - 模型自带的表情/动作探测后写入 useModelActionsStore，由工具栏那一排渲染按钮
 */
export default function PetStage(): JSX.Element {
  const modelPath = usePetStore((s) => s.modelPath)
  const opacity = usePetStore((s) => s.opacity)
  const setModel = usePetStore((s) => s.setModel)
  const setLocked = usePetStore((s) => s.setLocked)
  const setOffset = usePetStore((s) => s.setOffset)
  const setEyeTracking = usePetStore((s) => s.setEyeTracking)
  const setEyeTrackingStrength = usePetStore((s) => s.setEyeTrackingStrength)
  const setOpacity = usePetStore((s) => s.setOpacity)
  const setActions = useModelActionsStore((s) => s.setActions)
  const clearActions = useModelActionsStore((s) => s.clear)

  useEffect(() => {
    const hydrate = (): void => {
      void window.api.getConfig().then((cfg) => {
        setModel(cfg.pet.modelPath, cfg.pet.scale)
        setLocked(cfg.pet.locked)
        setOffset(cfg.pet.offsetX, cfg.pet.offsetY)
        setEyeTracking(cfg.pet.eyeTracking)
        setEyeTrackingStrength(cfg.pet.eyeTrackingStrength)
        setOpacity(cfg.pet.opacity ?? 1)
        usePetStore.getState().setAntialiasing(cfg.pet.antialiasing, cfg.pet.antialiasingSamples)
        usePetStore.getState().setInteractionEnabled(cfg.pet.interactionEnabled ?? false)
        usePetStore.getState().setEdgeSnapEnabled(cfg.pet.edgeSnapEnabled ?? false)
      })
    }
    hydrate()
    return window.api.onConfigChanged(hydrate)
  }, [setModel, setLocked, setOffset, setEyeTracking, setEyeTrackingStrength, setOpacity])

  // 切换模型后重新探测可用按键（不同模型表情/动作各不相同）
  useEffect(() => {
    clearActions()
    useInteractionStore.getState().clear()
    if (!modelPath) {
      return
    }
    let alive = true
    void window.api.models
      .actions(modelPath)
      .then((info) => {
        if (!alive) return
        setActions(info.expressions, info.motions)
      })
      .catch(() => {
        if (!alive) return
        clearActions()
      })
    return () => {
      alive = false
    }
  }, [modelPath, setActions, clearActions])

  if (modelPath) {
    return <Live2DPet modelPath={modelPath} opacity={opacity} />
  }

  return (
    <div className="pet-stage" style={{ opacity }}>
      <div className="chibi">
        <div className="chibi-hair-back" />
        <div className="chibi-head">
          <div className="chibi-hair-front" />
          <div className="chibi-eyes">
            <span className="chibi-eye" />
            <span className="chibi-eye" />
          </div>
          <div className="chibi-mouth" />
        </div>
      </div>
    </div>
  )
}
