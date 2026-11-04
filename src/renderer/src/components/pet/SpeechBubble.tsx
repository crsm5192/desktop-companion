import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { useInteractionStore } from '../../store/interaction'
import { usePetStore } from '../../store/pet'
import { INTERACTIONS, INTERACTION_SPEECH_DURATION } from '../../lib/petInteraction'
import { placeSpeechBubble } from '../../lib/speechPosition'

const PHRASES = [
  '今天也要元气满满哦～',
  '陪我玩嘛～',
  '你在忙什么呀？',
  '要加油哦！',
  '肚子有点饿了…',
  '哼哼，才没有想你呢',
  '今天的天气真不错呀',
  '一起加油吧！',
  '好无聊哦，陪我聊聊天嘛～',
  '我最喜欢和你待在一起啦！',
  '偷偷看你一眼…',
  '工作辛苦啦，喝口水吧～'
]

// 两种形状 + 四种底色随机
const SHAPES = ['round', 'cloud'] as const
const COLORS = ['#ffc9dd', '#cfe6ff', '#b9e2f7', '#fff3dd'] // 粉、粉蓝、天蓝、米白

interface BubbleState {
  text: string
  shape: (typeof SHAPES)[number]
  color: string
}

/** 台词吸附头顶右上方；互动台词优先，闲聊每隔 15~45 秒出现。 */
export default function SpeechBubble(): JSX.Element | null {
  const [bubble, setBubble] = useState<BubbleState | null>(null)
  const interaction = useInteractionStore((s) => s.message)
  const anchorRef = useRef<HTMLDivElement>(null)
  const visible = interaction ? { text: interaction.text, shape: 'round', color: '#cfe6ff' } : bubble

  useLayoutEffect(() => {
    const anchor = anchorRef.current
    if (!anchor) return
    const position = (): void => {
      const { headX, headY, modelReady } = usePetStore.getState()
      // Fit the available right-hand space before measuring, rather than covering the face.
      const head = modelReady ? { x: headX, y: headY } : { x: window.innerWidth / 2, y: window.innerHeight / 3 }
      anchor.style.maxWidth = `${Math.min(260, window.innerWidth - 16, Math.max(160, window.innerWidth - head.x + 16))}px`
      const placement = placeSpeechBubble(
        head,
        { width: anchor.offsetWidth, height: anchor.offsetHeight },
        { width: window.innerWidth, height: window.innerHeight }
      )
      anchor.style.left = `${placement.left}px`
      anchor.style.top = `${placement.top}px`
      anchor.style.setProperty('--bubble-tail-x', `${placement.tailX}px`)
    }
    position()
    const unsubscribe = usePetStore.subscribe((state, prev) => {
      if (state.headX !== prev.headX || state.headY !== prev.headY || state.modelReady !== prev.modelReady) position()
    })
    const observer = new ResizeObserver(position)
    observer.observe(anchor)
    window.addEventListener('resize', position)
    return () => { unsubscribe(); observer.disconnect(); window.removeEventListener('resize', position) }
  }, [visible?.text, interaction?.id])

  useEffect(() => {
    if (!interaction) return
    setBubble(null)
    const timer = window.setTimeout(() => useInteractionStore.getState().clear(interaction.id), INTERACTION_SPEECH_DURATION)
    return () => window.clearTimeout(timer)
  }, [interaction])

  useEffect(() => {
    let showTimer = 0
    let hideTimer = 0
    let cancelled = false

    const schedule = (): void => {
      const delay = 15000 + Math.random() * 30000
      showTimer = window.setTimeout(() => {
        if (cancelled) return
        if (useInteractionStore.getState().message) { schedule(); return }
        setBubble({
          text: PHRASES[Math.floor(Math.random() * PHRASES.length)],
          shape: SHAPES[Math.floor(Math.random() * SHAPES.length)],
          color: COLORS[Math.floor(Math.random() * COLORS.length)]
        })
        hideTimer = window.setTimeout(() => {
          if (!cancelled) setBubble(null)
        }, 4000)
        schedule()
      }, delay)
    }
    schedule()

    return () => {
      cancelled = true
      window.clearTimeout(showTimer)
      window.clearTimeout(hideTimer)
    }
  }, [])

  if (!visible) return null
  const shapeClass = visible.shape === 'cloud' ? 'bubble-cloud' : 'bubble-round'
  return (
    <div className="speech-anchor" ref={anchorRef}>
      <div
        key={interaction?.id ?? visible.text}
        className={`speech-bubble ${shapeClass}`}
        role="status"
        aria-live="polite"
        data-interaction-region={interaction?.region}
        style={{ '--bubble-color': visible.color } as CSSProperties}
      >
        {interaction?.region && (
          <span className="interaction-caption">
            {INTERACTIONS[interaction.region].label} · {interaction.actionLabel ?? INTERACTIONS[interaction.region].actionLabel}
          </span>
        )}
        {visible.text}
      </div>
    </div>
  )
}
