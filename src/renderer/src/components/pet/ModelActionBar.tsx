import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { live2dActionRef } from './Live2DPet'
import type { ModelAction } from '@shared/types'

interface Props {
  expressions: ModelAction[]
  motions: ModelAction[]
}

/** Full names remain readable in a scrollable drawer above the main toolbar. */
export default function ModelActionBar({ expressions, motions }: Props): JSX.Element | null {
  const [open, setOpen] = useState(false)
  const [category, setCategory] = useState<'expression' | 'motion'>('expression')
  const [query, setQuery] = useState('')
  const [recent, setRecent] = useState<{ action: ModelAction; name: string } | null>(null)
  const [bottom, setBottom] = useState(48)
  const rootRef = useRef<HTMLDivElement>(null)
  const toggleRef = useRef<HTMLButtonElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!recent) return
    const timer = window.setTimeout(() => setRecent(null), 1600)
    return () => window.clearTimeout(timer)
  }, [recent])

  useLayoutEffect(() => {
    if (!open) return
    const toolbar = rootRef.current?.closest('.toolbar')
    if (!toolbar) return
    const place = (): void => setBottom(window.innerHeight - toolbar.getBoundingClientRect().top + 10)
    place()
    const observer = new ResizeObserver(place)
    observer.observe(toolbar)
    window.addEventListener('resize', place)
    return () => { observer.disconnect(); window.removeEventListener('resize', place) }
  }, [open])

  useEffect(() => {
    if (!open) return
    searchRef.current?.focus()
    const onDown = (e: MouseEvent): void => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        setOpen(false)
        toggleRef.current?.focus()
      }
    }
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  useEffect(() => { listRef.current?.scrollTo(0, 0) }, [category, query])

  if (expressions.length === 0 && motions.length === 0) return null

  const activeCategory = expressions.length === 0 ? 'motion' : motions.length === 0 ? 'expression' : category
  const actions = activeCategory === 'expression' ? expressions : motions
  const filtered = actions.filter(a => a.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))
  const run = (action: ModelAction): void => {
    if (!live2dActionRef.current) return
    live2dActionRef.current(action)
    setRecent({ action, name: action.name })
  }

  return (
    <div className="model-actions" ref={rootRef}>
      <button
        ref={toggleRef}
        className="toolbar-button model-actions-toggle"
        aria-label="表情与动作"
        aria-expanded={open}
        aria-controls="model-actions-drawer"
        title={open ? '收起表情' : `表情与动作（${expressions.length + motions.length}）`}
        onClick={() => setOpen((v) => !v)}
      >
        表情
      </button>

      {open && (
        <div
          id="model-actions-drawer"
          className="model-actions-panel"
          role="dialog"
          aria-label="表情与动作"
          style={{ bottom, maxHeight: `calc(100dvh - ${bottom + 12}px)` }}
        >
          <div className="model-actions-header">
            <strong>表情与动作</strong>
            <button className="model-actions-close" aria-label="关闭表情与动作" onClick={() => {
              setOpen(false)
              toggleRef.current?.focus()
            }}>×</button>
          </div>
          <div className="model-actions-categories" role="group" aria-label="选择分类">
            <button aria-pressed={activeCategory === 'expression'} disabled={!expressions.length}
              onClick={() => { setCategory('expression'); setQuery('') }}>
              表情 <span>{expressions.length}</span>
            </button>
            <button aria-pressed={activeCategory === 'motion'} disabled={!motions.length}
              onClick={() => { setCategory('motion'); setQuery('') }}>
              动作 <span>{motions.length}</span>
            </button>
          </div>
          <input ref={searchRef} className="model-actions-search" type="search"
            aria-label="搜索当前分类" placeholder={activeCategory === 'expression' ? '搜索表情名称' : '搜索动作名称'}
            value={query} onChange={e => setQuery(e.target.value)} />
          <div className="model-actions-list" ref={listRef} aria-label={activeCategory === 'expression' ? '表情列表' : '动作列表'}>
            {filtered.map((action, index) => (
              <button
                key={`${activeCategory}-${action.file ?? action.name}-${action.group}-${action.index}-${index}`}
                className="model-action-btn"
                data-recent={recent?.action === action}
                title={action.name}
                onClick={() => run(action)}
              >
                <span className="model-action-name">{action.name}</span>
                <span className="model-action-indicator" aria-hidden="true">{recent?.action === action ? '✓' : '›'}</span>
              </button>
            ))}
            {filtered.length === 0 && <p className="model-actions-empty">没有找到匹配的名称</p>}
          </div>
          <div className="model-actions-status" role="status">
            {recent ? `已触发：${recent.name}` : `共 ${filtered.length} 项 · 点击即可使用`}
          </div>
        </div>
      )}
    </div>
  )
}
