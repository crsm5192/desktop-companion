import { useState } from 'react'
import { live2dActionRef } from './Live2DPet'
import type { ModelAction } from '@shared/types'

interface Props {
  expressions: ModelAction[]
  motions: ModelAction[]
}

/**
 * 模型自带的「按键」（表情 / 动作）小按钮条。
 *
 * 不同模型差异由主进程探测抹平（未声明的 exp3/motion3 会被补进内存声明），
 * 这里只负责展示：表情用圆形小按钮，动作收进一个下拉，避免按钮堆满屏幕。
 * 模型两者都没有时整条不渲染。
 */
export default function ModelActionBar({ expressions, motions }: Props): JSX.Element | null {
  const [open, setOpen] = useState(false)
  // 默认全部展开：按钮本身很小，藏起来反而不方便（模型表情一般 4~18 个）
  const [shown, setShown] = useState(99)

  if (expressions.length === 0 && motions.length === 0) return null

  const run = (a: ModelAction): void => {
    live2dActionRef.current?.(a)
  }

  const visibleExpr = expressions.slice(0, shown)

  return (
    <div className="model-actions">
      {visibleExpr.map((a) => (
        <button key={`e-${a.name}`} className="model-action-btn" title={`表情：${a.name}`} onClick={() => run(a)}>
          {a.name.length > 4 ? a.name.slice(0, 4) : a.name}
        </button>
      ))}

      {expressions.length > shown && (
        <button className="model-action-btn more" title="更多表情" onClick={() => setShown(shown + 12)}>
          ＋
        </button>
      )}

      {motions.length > 0 && (
        <button
          className="model-action-btn more"
          title={`动作（${motions.length} 个）`}
          onClick={() => setOpen((v) => !v)}
        >
          ▾
        </button>
      )}

      {open && motions.length > 0 && (
        <div className="model-action-list">
          {motions.map((m) => (
            <button
              key={`m-${m.group}-${m.index}`}
              className="model-action-item"
              onClick={() => {
                run(m)
                setOpen(false)
              }}
            >
              {m.name}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
