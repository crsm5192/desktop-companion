import { useEffect, useRef, useState } from 'react'
import type { ModelAction } from '@shared/types'
import type { ModelCapabilities } from '@shared/control'

export default function ModelActionsPanel(): JSX.Element {
  const [expressions, setExpressions] = useState<ModelAction[]>([])
  const [motions, setMotions] = useState<ModelAction[]>([])
  const [category, setCategory] = useState<'expression' | 'motion'>('expression')
  const [query, setQuery] = useState('')
  const [recent, setRecent] = useState<ModelAction | null>(null)
  const [error, setError] = useState('')
  const searchRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    let alive = true
    let generation = 0
    const reload = (): void => {
      const request = ++generation
      void window.api.control.execute({ type: 'model.get', data: {} }).then(result => {
        if (!alive || request !== generation) return
        const model = result as ModelCapabilities
        setExpressions(model.expressions)
        setMotions(model.motions)
        setRecent(null)
        setError('')
      }).catch(err => {
        if (!alive || request !== generation) return
        setExpressions([]); setMotions([]); setRecent(null); setError(String(err))
      })
    }
    reload()
    searchRef.current?.focus()
    const off = window.api.onConfigChanged(reload)
    return () => { alive = false; off() }
  }, [])
  useEffect(() => {
    if (!recent) return
    const timer = window.setTimeout(() => setRecent(null), 1600)
    return () => window.clearTimeout(timer)
  }, [recent])
  useEffect(() => { listRef.current?.scrollTo(0, 0) }, [category, query])

  const activeCategory = expressions.length === 0 ? 'motion' : motions.length === 0 ? 'expression' : category
  const actions = activeCategory === 'expression' ? expressions : motions
  const filtered = actions.filter(action => action.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))
  const run = async (action: ModelAction): Promise<void> => {
    try {
      await window.api.models.runAction(action)
      setRecent(action)
      setError('')
    } catch (err) { setError(String(err)) }
  }
  return <div id="model-actions-drawer" className="model-actions-panel" aria-label="表情与动作">
    <div className="model-actions-categories" role="group" aria-label="选择分类">
      <button aria-pressed={activeCategory === 'expression'} disabled={!expressions.length}
        onClick={() => { setCategory('expression'); setQuery('') }}>表情 <span>{expressions.length}</span></button>
      <button aria-pressed={activeCategory === 'motion'} disabled={!motions.length}
        onClick={() => { setCategory('motion'); setQuery('') }}>动作 <span>{motions.length}</span></button>
    </div>
    <input ref={searchRef} className="model-actions-search" type="search" aria-label="搜索当前分类"
      placeholder={activeCategory === 'expression' ? '搜索表情名称' : '搜索动作名称'}
      value={query} onChange={event => setQuery(event.target.value)} />
    <div className="model-actions-list" ref={listRef} aria-label={activeCategory === 'expression' ? '表情列表' : '动作列表'}>
      {filtered.map((action, index) => <button
        key={`${activeCategory}-${action.file ?? action.name}-${action.group}-${action.index}-${index}`}
        className="model-action-btn" data-recent={recent === action} title={action.name} onClick={() => void run(action)}>
        <span className="model-action-name">{action.name}</span>
        <span className="model-action-indicator" aria-hidden="true">{recent === action ? '✓' : '›'}</span>
      </button>)}
      {!filtered.length && <p className="model-actions-empty">没有找到匹配的名称</p>}
    </div>
    <div className="model-actions-status" role="status">
      {error || (recent ? `已触发：${recent.name}` : `共 ${filtered.length} 项 · 点击即可使用`)}
    </div>
  </div>
}
