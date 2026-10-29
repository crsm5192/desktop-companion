import { useEffect, useRef, useState } from 'react'
import { live2dActionRef } from './Live2DPet'
import type { ModelAction } from '@shared/types'

interface Props {
  expressions: ModelAction[]
  motions: ModelAction[]
}

/**
 * 模型自带的「按键」（表情 / 动作）。
 *
 * 交互：平时屏幕上只有一个主按钮 🎭，**默认不展开**，点一下才弹出面板，
 * 再点一下（或点面板外）收起。这样按钮不会一直占着桌面。
 *
 * 不同模型差异由主进程探测抹平（未声明的 exp3/motion3 会补进内存声明），
 * 这里只负责展示。模型两种按键都没有时整个控件不渲染。
 */
export default function ModelActionBar({ expressions, motions }: Props): JSX.Element | null {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  // 点面板外部 / 按 Esc 收起
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
    <div className={`model-actions ${open ? 'is-open' : ''}`} ref={rootRef}>
      <button
        className="model-actions-toggle"
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
