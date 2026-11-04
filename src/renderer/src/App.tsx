import { useEffect, useRef, useState } from 'react'
import { useUIStore } from './store/ui'
import { usePetStore } from './store/pet'
import { useMusicStore } from './store/music'
import { useModelActionsStore } from './store/modelActions'
import { useInteractionStore } from './store/interaction'
import { useSpeechStore } from './store/speech'
import { useReplyBubbleStore } from './store/replyBubble'
import { usePetControl } from './hooks/usePetControl'
import { CLICK_DISTANCE, petInteractionRef } from './lib/petInteraction'
import PetStage from './components/pet/PetStage'
import ModelActionBar from './components/pet/ModelActionBar'
import SpeechBubble from './components/pet/SpeechBubble'
import MusicPanel from './components/music/MusicPanel'
import PomodoroPanel from './components/pomodoro/PomodoroPanel'
import TodoPanel from './components/todo/TodoPanel'
import DiaryPanel from './components/diary/DiaryPanel'
import SettingsPanel from './components/settings/SettingsPanel'

export default function App(): JSX.Element {
  usePetControl()
  const panel = useUIStore((s) => s.panel)
  const setPanel = useUIStore((s) => s.setPanel)
  const locked = usePetStore((s) => s.locked)
  const interactionEnabled = usePetStore((s) => s.interactionEnabled)
  const modelReady = usePetStore((s) => s.modelReady)
  const scale = usePetStore((s) => s.scale)
  const setScale = usePetStore((s) => s.setScale)
  const musicPlaying = useMusicStore((s) => s.playing)
  const musicIndex = useMusicStore((s) => s.index)
  const musicSongs = useMusicStore((s) => s.songs)
  const loadMusic = useMusicStore((s) => s.loadSongs)
  const modelExpressions = useModelActionsStore((s) => s.expressions)
  const modelMotions = useModelActionsStore((s) => s.motions)
  const [resetFlash, setResetFlash] = useState(false)
  const [chatOpen, setChatOpen] = useState(false)
  const resetTimer = useRef(0)
  useEffect(() => () => window.clearTimeout(resetTimer.current), [])

  useEffect(() => {
    const offState = window.api.chatWindow.onState(setChatOpen)
    void window.api.chatWindow.getOpen().then(setChatOpen)
    const offSpeaking = window.api.chatWindow.onSpeaking(speaking => {
      const speech = useSpeechStore.getState()
      if (speaking) speech.startSpeaking()
      else speech.stopSpeaking()
    })
    const offLevel = window.api.control.onSpeechLevel(({ speaking, level }) => {
      if (speaking) useSpeechStore.getState().setLevel(level)
      else useSpeechStore.getState().stopSpeaking()
    })
    const offPresentation = window.api.chat.onPresentation(payload => useReplyBubbleStore.getState().receive(payload))
    return () => { offState(); offSpeaking(); offLevel(); offPresentation(); useSpeechStore.getState().stopSpeaking() }
  }, [])

  const toggle = (p: NonNullable<typeof panel>): void => setPanel(panel === p ? null : p)

  /** 模型复位：停止互动，平移归零（回窗口正中）+ 缩放回 1×。 */
  const applyModelReset = (): void => {
    window.clearTimeout(resetTimer.current)
    setResetFlash(true)
    resetTimer.current = window.setTimeout(() => setResetFlash(false), 700)
    petInteractionRef.current?.cancel()
    useInteractionStore.getState().clear()
    const s = usePetStore.getState()
    s.setScale(1)
    s.setOffset(0, 0)
  }

  useEffect(() => window.api.onModelReset(applyModelReset), [])

  const resetModel = (): void => {
    applyModelReset()
    void window.api.setConfig({ pet: { scale: 1, offsetX: 0, offsetY: 0 } })
  }

  const toggleInteraction = (): void => {
    const enabled = !usePetStore.getState().interactionEnabled
    usePetStore.getState().setInteractionEnabled(enabled)
    if (enabled) useInteractionStore.getState().show('互动已开启，试着点点我的头、脸或手吧～')
    else useInteractionStore.getState().clear()
    void window.api.setConfig({ pet: { interactionEnabled: enabled } }).catch(() => {
      useInteractionStore.getState().show('开关已生效，但没能保存，下次打开时请重新设置。')
    })
  }

  // 全局加载音乐（关闭面板也继续播）
  useEffect(() => {
    void loadMusic()
  }, [loadMusic])

  // 工具栏/面板始终可点；开启互动后，模型可见部分也接收点击。
  useEffect(() => {
    if (locked) {
      void window.api.setClickThrough(false)
      return
    }
    let lastClickable: boolean | null = null
    let frame = 0
    void window.api.setClickThrough(!document.querySelector('.toolbar:hover, .panel:hover, .zoom-control:hover'))
    const onMove = (e: MouseEvent): void => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        const el = document.elementFromPoint(e.clientX, e.clientY)
        const clickable = !!el?.closest?.('.toolbar, .panel, .zoom-control') ||
          (interactionEnabled && !!petInteractionRef.current?.hitAt(e.clientX, e.clientY))
        if (clickable !== lastClickable) {
          lastClickable = clickable
          void window.api.setClickThrough(!clickable)
        }
      })
    }
    window.addEventListener('mousemove', onMove)
    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener('mousemove', onMove)
    }
  }, [locked, interactionEnabled, modelReady])

  // 锁定模式下：左键拖动 → 移动整个窗口（工具栏/面板/缩放条除外）
  useEffect(() => {
    if (!locked) return
    let cleanupDrag: (() => void) | undefined
    const onDown = (e: MouseEvent): void => {
      if (e.button !== 0) return
      const target = e.target as HTMLElement | null
      if (target?.closest?.('.toolbar, .panel, .zoom-control, button, input, select, textarea')) return
      const sx = e.screenX
      const sy = e.screenY
      cleanupDrag?.()
      let active = true
      let moved = false
      let position: number[] | null = null
      const onMove = (ev: MouseEvent): void => {
        if (!position || Math.hypot(ev.screenX - sx, ev.screenY - sy) < CLICK_DISTANCE && !moved) return
        moved = true
        void window.api.setPetPosition(position[0] + ev.screenX - sx, position[1] + ev.screenY - sy)
      }
      const cleanup = (): void => {
        active = false
        window.removeEventListener('mousemove', onMove)
        window.removeEventListener('mouseup', onUp)
        window.removeEventListener('blur', cleanup)
      }
      const onUp = (): void => {
        cleanup()
        if (!moved) return
        void window.api.clampPosition().then(() =>
          window.api.getPetPosition().then(([x, y]) =>
            window.api.setConfig({ pet: { winX: x, winY: y } })
          )
        )
      }
      cleanupDrag = cleanup
      window.addEventListener('mousemove', onMove)
      window.addEventListener('mouseup', onUp)
      window.addEventListener('blur', cleanup)
      void window.api.getPetPosition().then(([wx, wy]) => {
        if (active) position = [wx, wy]
      })
    }
    window.addEventListener('mousedown', onDown)
    return () => {
      cleanupDrag?.()
      window.removeEventListener('mousedown', onDown)
    }
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
        <button className="toolbar-button" aria-pressed={chatOpen} title="对话" onClick={() => {
          void window.api.chatWindow.setOpen(!chatOpen).then(setChatOpen)
        }}>对话</button>
        <button className="toolbar-button" aria-pressed={panel === 'music'} title="音乐" onClick={() => toggle('music')}>音乐</button>
        <button className="toolbar-button" aria-pressed={panel === 'pomodoro'} title="番茄钟" onClick={() => toggle('pomodoro')}>番茄</button>
        <button className="toolbar-button" aria-pressed={panel === 'todo'} title="待办" onClick={() => toggle('todo')}>待办</button>
        <button className="toolbar-button" aria-pressed={panel === 'diary'} title="日记" onClick={() => toggle('diary')}>日记</button>
        <button
          className="toolbar-button interaction-toggle"
          role="switch"
          aria-label="互动"
          aria-checked={interactionEnabled}
          disabled={!modelReady}
          title={!modelReady ? '请先加载 Live2D 模型' : interactionEnabled ? '关闭互动' : '开启互动：点击模型不同部位'}
          onClick={toggleInteraction}
        >
          互动
        </button>
        {/* 模型表情/动作：与其它按钮同级，随时可用（不再依赖锁定模式） */}
        <ModelActionBar expressions={modelExpressions} motions={modelMotions} />
        <button className="toolbar-button" aria-pressed={panel === 'settings'} title="设置" onClick={() => toggle('settings')}>设置</button>
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
          <button className="zoom-reset" data-flash={resetFlash} title="复位：回到中心 + 缩放 1×" onClick={resetModel}>
            ⟲
          </button>
        </div>
      )}

      {panel === 'music' && <MusicPanel />}
      {panel === 'pomodoro' && <PomodoroPanel />}
      {panel === 'todo' && <TodoPanel />}
      {panel === 'diary' && <DiaryPanel />}
      {panel === 'settings' && <SettingsPanel />}
    </div>
  )
}
