import { useEffect, useState } from 'react'
import Live2DPet from './Live2DPet'
import ModelActionBar from './ModelActionBar'
import { usePetStore } from '../../store/pet'
import type { ModelAction } from '@shared/types'

/**
 * 桌面宠物渲染容器。
 * - pet.modelPath 配了 Live2D 模型 → 用 Live2DPet 渲染 .moc3
 * - 没配 → 用 CSS 占位小人兜底
 * - 模型切换：设置面板保存时写 usePetStore，这里订阅后即时重载
 * - 模型自带的表情/动作 → 底部一排小按钮（不同模型自动适配）
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

  const [expressions, setExpressions] = useState<ModelAction[]>([])
  const [motions, setMotions] = useState<ModelAction[]>([])

  useEffect(() => {
    void window.api.getConfig().then((cfg) => {
      setModel(cfg.pet.modelPath, cfg.pet.scale)
      setLocked(cfg.pet.locked)
      setOffset(cfg.pet.offsetX, cfg.pet.offsetY)
      setEyeTracking(cfg.pet.eyeTracking)
      setEyeTrackingStrength(cfg.pet.eyeTrackingStrength)
      setOpacity(cfg.pet.opacity ?? 1)
    })
  }, [setModel, setLocked, setOffset, setEyeTracking, setEyeTrackingStrength, setOpacity])

  // 切换模型后重新探测可用按键（不同模型快捷键/表情各不相同）
  useEffect(() => {
    if (!modelPath) {
      setExpressions([])
      setMotions([])
      return
    }
    let alive = true
    void window.api.models
      .actions(modelPath)
      .then((info) => {
        if (!alive) return
        setExpressions(info.expressions)
        setMotions(info.motions)
      })
      .catch(() => {
        if (!alive) return
        setExpressions([])
        setMotions([])
      })
    return () => {
      alive = false
    }
  }, [modelPath])

  if (modelPath) {
    return (
      <>
        <Live2DPet
          modelPath={modelPath}
          opacity={opacity}
          actions={{ expressions, motions }}
        />
        <ModelActionBar expressions={expressions} motions={motions} />
      </>
    )
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