import type { ModelAction } from '@shared/types'

interface Props {
  expressions: ModelAction[]
  motions: ModelAction[]
  open: boolean
  onToggle: () => void
}

export default function ModelActionBar({ expressions, motions, open, onToggle }: Props): JSX.Element | null {
  if (!expressions.length && !motions.length) return null
  return <button className="toolbar-button model-actions-toggle" aria-label="表情与动作" aria-expanded={open}
    title={open ? '收起表情' : `表情与动作（${expressions.length + motions.length}）`} onClick={onToggle}>表情</button>
}
