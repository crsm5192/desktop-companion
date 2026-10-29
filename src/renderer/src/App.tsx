import { useEffect } from 'react'
import { useUIStore } from './store/ui'
import { usePetStore } from './store/pet'
import { useMusicStore } from './store/music'
import { useModelActionsStore } from './store/modelActions'
import PetStage from './components/pet/PetStage'
import ModelActionBar from './components/pet/ModelActionBar'
import SpeechBubble from './components/pet/SpeechBubble'
import ChatPanel from './components/chat/ChatPanel'
import MusicPanel from './components/music/MusicPanel'
import PomodoroPanel from './components/pomodoro/PomodoroPanel'
import TodoPanel from './components/todo/TodoPanel'
import DiaryPanel from './components/diary/DiaryPanel'
import SettingsPanel from './components/settings/SettingsPanel'

export default function App(): JSX.Element {
  const panel = useUIStore((s) => s.panel)
  const setPanel = useUIStore((s) => s.setPanel)
  const locked = usePetStore((s) => s.locked)
  const scale = usePetStore((s) => s.scale)
  const setScale = usePetStore((s) => s.setScale)
  const musicPlaying = useMusicStore((s) => s.playing)
  const musicIndex = useMusicStore((s) => s.index)
  const musicSongs = useMusicStore((s) => s.songs)
  const loadMusic = useMusicStore((s) => s.loadSongs)
  const modelExpressions = useModelActionsStore((s) => s.expressions)
  const modelMotions = useModelActionsStore((s) => s.motions)

  const toggle = (p: NonNullable<typeof panel>): void => setPanel(panel === p ? null : p)

  /** 模型复位：平移归零（回窗口正中）+ 缩放回 1×，并立即持久化 */
  const resetModel = (): void => {
    const s = usePetStore.getState()
    s.setScale(1)
    s.setOffset(0, 0)
    void window.api.setConfig({ pet: { scale: 1, offsetX: 0, offsetY: 0 } })
  }

  // 全局加载音乐（关闭面板也继续播）
  useEffect(() => {
    void loadMusic()
  }, [loadMusic])

  // 锁定模式：全窗口可交互；未锁定：默认穿透，悬停工具栏/面板才可点
  useEffect(() => {
    void window.api.setClickThrough(!locked)
  }, [locked])

  useEffect(() => {
    if (locked) return
    let lastClickable: boolean | null = null
    const onMove = (e: MouseEvent): void => {
      const el = document.elementFromPoint(e.clientX, e.clientY)
      const clickable = !!el?.closest?.('.toolbar, .panel')
      if (clickable !== lastClickable) {
        lastClickable = clickable
        void window.api.setClickThrough(!clickable)
      }
    }
    window.addEventListener('mousemove', onMove)
    return () => window.removeEventListener('mousemove', onMove)
  }, [locked])

  // 锁定模式下：左键拖动 → 移动整个窗口（工具栏/面板/缩放条除外）
  useEffect(() => {
    if (!locked) return
    const onDown = (e: MouseEvent): void => {
      if (e.button !== 0) return
      const target = e.target as HTMLElement | null
      if (target?.closest?.('.toolbar, .panel, .zoom-control, button, input, select, textarea')) return
      const sx = e.screenX
      const sy = e.screenY
      void window.api.getPetPosition().then(([wx, wy]) => {
        const onMove = (ev: MouseEvent): void => {
          void window.api.setPetPosition(wx + (ev.screenX - sx), wy + (ev.screenY - sy))
        }
        const onUp = (): void => {
          window.removeEventListener('mousemove', onMove)
          window.removeEventListener('mouseup', onUp)
          // 松手后钳制一次再保存（拖动中不钳制，避免晃动）
          void window.api.clampPosition().then(() =>
            void window.api.getPetPosition().then(([x, y]) =>
              void window.api.setConfig({ pet: { winX: x, winY: y } })
            )
          )
        }
        window.addEventListener('mousemove', onMove)
        window.addEventListener('mouseup', onUp)
      })
    }
    window.addEventListener('mousedown', onDown)
    return () => window.removeEventListener('mousedown', onDown)
  }, [locked])

  return (
    <div className="app-root">
      <div className="pet-area">
        <PetStage />
      </div>

      {/* 随机文字气泡 */}
      <SpeechBubble />

      {/* 正在播放（工具栏上方） */}
      {musicPlaying && musicIndex >= 0 && musicSongs[musicIndex] && (
        <div className="now-playing">
          <span className="np-text">
            ♪ {musicSongs[musicIndex].artist ? `${musicSongs[musicIndex].artist} - ${musicSongs[musicIndex].name}` : musicSongs[musicIndex].name}
          </span>
        </div>
      )}

      <div className="toolbar">
        <button title="对话" onClick={() => toggle('chat')}>💬</button>
        <button title="音乐" onClick={() => toggle('music')}>🎵</button>
        <button title="番茄钟" onClick={() => toggle('pomodoro')}>🍅</button>
        <button title="待办" onClick={() => toggle('todo')}>✅</button>
        <button title="日记" onClick={() => toggle('diary')}>📖</button>
        {/* 模型表情/动作：与其它按钮同级，随时可用（不再依赖锁定模式） */}
        <ModelActionBar expressions={modelExpressions} motions={modelMotions} />
        <button title="复位模型（回中心 + 1×）" onClick={resetModel}>⟲</button>
        <button title="设置" onClick={() => toggle('settings')}>⚙️</button>
      </div>

      {/* 锁定模式：浮动缩放滑条（桌宠边） */}
      {locked && (
        <div className="zoom-control" title="左键拖=移动 · 右键拖=平移">
          <span>🔍</span>
          <input
            type="range"
            min={0.3}
            max={5}
            step={0.05}
            value={scale}
            onChange={(e) => setScale(Number(e.target.value))}
            onPointerUp={() => {
              void window.api.setConfig({ pet: { scale: usePetStore.getState().scale } })
            }}
          />
          <span className="zoom-val">{scale.toFixed(2)}×</span>
          <button className="zoom-reset" title="复位：回到中心 + 缩放 1×" onClick={resetModel}>
            ⟲
          </button>
        </div>
      )}

      {panel === 'chat' && <ChatPanel />}
      {panel === 'music' && <MusicPanel />}
      {panel === 'pomodoro' && <PomodoroPanel />}
      {panel === 'todo' && <TodoPanel />}
      {panel === 'diary' && <DiaryPanel />}
      {panel === 'settings' && <SettingsPanel />}
    </div>
  )
}