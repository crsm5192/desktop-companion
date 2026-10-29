import { useEffect, useRef, useState } from 'react'
import { live2dActionRef } from './Live2DPet'
import type { ModelAction } from '@shared/types'

interface Props {
  expressions: ModelAction[]
  motions: ModelAction[]
}

/**
 * 模型自带的「按键」（表情 / 动作）—— 与工具栏其他按钮同级的一个按钮 🎭。
 *
 * 点击后在按钮上方弹出面板；默认收起，点面板外或 Esc 收起。
 * 模型没有任何表情/动作时整个按钮不渲染。
 */
export default function ModelActionBar({ expressions, motions }: Props): JSX.Element | null {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent): void => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  if (expressions.length === 0 && motions.length === 0) return null

  const run = (a: ModelAction): void => {
    live2dActionRef.current?.(a)
  }

  return (
    <div className="model-actions" ref={rootRef}>
      <button
        className={`model-actions-toggle ${open ? 'active' : ''}`}
        title={open ? '收起表情' : `表情与动作（${expressions.length + motions.length}）`}
        onClick={() => setOpen((v) => !v)}
      >
        🎭
      </button>

      {open && (
        <div className="model-actions-panel">
          {expressions.length > 0 && (
            <>
              <div className="model-actions-title">表情</div>
              <div className="model-actions-grid">
                {expressions.map((a) => (
                  <button
                    key={`e-${a.name}`}
                    className="model-action-btn"
                    title={`表情：${a.name}`}
                    onClick={() => run(a)}
                  >
                    {a.name.length > 5 ? a.name.slice(0, 5) : a.name}
                  </button>
                ))}
              </div>
            </>
          )}

          {motions.length > 0 && (
            <>
              <div className="model-actions-title">动作</div>
              <div className="model-actions-grid">
                {motions.map((m) => (
                  <button
                    key={`m-${m.group}-${m.index}`}
                    className="model-action-btn"
                    title={`动作：${m.name}`}
                    onClick={() => run(m)}
                  >
                    {m.name.length > 5 ? m.name.slice(0, 5) : m.name}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}
