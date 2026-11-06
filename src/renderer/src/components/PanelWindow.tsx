import { useEffect } from 'react'
import type { PanelWindowName } from '@shared/panelWindows'
import { bindMusicPlayback } from '../store/music'
import MusicPanel from './music/MusicPanel'
import PomodoroPanel from './pomodoro/PomodoroPanel'
import TodoPanel from './todo/TodoPanel'
import DiaryPanel from './diary/DiaryPanel'
import SettingsPanel from './settings/SettingsPanel'
import ModelActionsPanel from './pet/ModelActionsPanel'

const titles = { chat: '对话', music: '音乐', pomodoro: '番茄钟', todo: '待办', diary: '日记', actions: '表情与动作', settings: '设置' }
export default function PanelWindow({ name }: { name: Exclude<PanelWindowName, 'chat'> }): JSX.Element {
  useEffect(() => {
    const offMusic = name === 'music' ? bindMusicPlayback() : undefined
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') void window.api.panelWindow.setOpen(name, false)
    }
    window.addEventListener('keydown', onKey)
    return () => { offMusic?.(); window.removeEventListener('keydown', onKey) }
  }, [name])
  return <div className="panel-window" role="dialog" aria-label={titles[name]}>
    <div className="chat-window-header">
      <div className="chat-window-title"><strong>{titles[name]}</strong><span>拖动这里调整位置</span></div>
      <button className="chat-window-tool" title="重新贴靠模型" onClick={() => void window.api.panelWindow.dock(name)}>贴靠</button>
      <button className="chat-window-close" aria-label={`收起${titles[name]}`} title="收起窗口（保留当前内容）"
        onClick={() => void window.api.panelWindow.setOpen(name, false)}>×</button>
    </div>
    {name === 'music' && <MusicPanel />}
    {name === 'pomodoro' && <PomodoroPanel />}
    {name === 'todo' && <TodoPanel />}
    {name === 'diary' && <DiaryPanel />}
    {name === 'actions' && <ModelActionsPanel />}
    {name === 'settings' && <SettingsPanel />}
  </div>
}
