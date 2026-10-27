import { useEffect, useRef, useState } from 'react'
import { Application, Ticker } from 'pixi.js'
import { CubismSetting, Live2DSprite, Priority } from 'easy-live2d'
import { useSpeechStore } from '../../store/speech'
import { usePetStore } from '../../store/pet'
import type { ModelAction } from '@shared/types'

interface Props {
  modelPath: string
  /** 整体不透明度 0.2~1（设置面板可调） */
  opacity: number
  /** 模型可用按键（由主进程探测补全），用于渲染小按钮 */
  actions?: { expressions: ModelAction[]; motions: ModelAction[] }
}

/** 供外部（按钮）触发的动作执行器，挂在 store 上避免层层传参 */
export const live2dActionRef: {
  current: ((a: ModelAction) => void) | null
} = { current: null }

function withTimeout<T>(p: Promise<T>, ms: number, msg: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error(msg)), ms))
  ])
}

function loadCubismCore(): Promise<void> {
  return new Promise((resolve, reject) => {
    const w = window as unknown as { Live2DCubismCore?: unknown }
    if (w.Live2DCubismCore) {
      resolve()
      return
    }
    const s = document.createElement('script')
    s.src = 'live2dcubismcore.min.js'
    s.onload = () => resolve()
    s.onerror = () => reject(new Error('live2dcubismcore.min.js 加载失败（需要 Cubism 5 core）'))
    document.head.appendChild(s)
  })
}

/** 打印 WebGL / GPU 信息，排查"模型加载了但显示不出来"的问题 */
function logWebGLInfo(): void {
  try {
    const c = document.createElement('canvas')
    const gl = c.getContext('webgl2') || c.getContext('webgl')
    if (!gl) {
      console.error('[webgl] WebGL 不可用（显卡驱动/硬件加速问题）')
      return
    }
    const ext = gl.getExtension('WEBGL_debug_renderer_info')
    const renderer = ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : '(未公开)'
    const vendor = ext ? String(gl.getParameter(ext.UNMASKED_VENDOR_WEBGL)) : '(未公开)'
    console.log('[webgl] renderer =', renderer)
    console.log('[webgl] vendor =', vendor)
    console.log('[webgl] version =', gl.getParameter(gl.VERSION))
  } catch (e) {
    console.error('[webgl] 检查失败', e)
  }
}

export default function Live2DPet({ modelPath, opacity, actions }: Props): JSX.Element {
  const hostRef = useRef<HTMLDivElement>(null)
  const [status, setStatus] = useState('准备加载…')

  useEffect(() => {
    let cancelled = false
    let app: Application | null = null
    let canvas: HTMLCanvasElement | null = null
    let cleanupListeners: (() => void) | null = null
    let onResize: (() => void) | null = null
    const host = hostRef.current
    if (!host) {
      setStatus('容器缺失')
      return
    }

    ;(async () => {
      try {
        logWebGLInfo()
        setStatus('加载 Cubism Core…')
        await loadCubismCore()

        setStatus('创建画布…')
        const w = host.clientWidth || 420
        const h = host.clientHeight || 520
        canvas = document.createElement('canvas')
        host.appendChild(canvas)
        app = new Application()
        await app.init({
          canvas,
          width: w,
          height: h,
          backgroundAlpha: 0,
          antialias: false,
          autoDensity: true,
          resolution: 1
        })

        setStatus('加载模型…')
        // 用主进程探测补全后的 modelJSON 构造设置，这样磁盘上有、但 model3.json 没声明的
        // 表情/动作也能被 easy-live2d 识别（不同模型差异统一在这里抹平）
        const dir = modelPath.includes('/') ? modelPath.slice(0, modelPath.lastIndexOf('/')) : ''
        let setting: CubismSetting | undefined
        try {
          const info = await window.api.models.actions(modelPath)
          if (info.modelJSON) {
            setting = new CubismSetting({
              modelJSON: info.modelJSON as any,
              prefixPath: dir ? `${dir}/` : ''
            })
          }
        } catch {
          setting = undefined // 探测失败就退回默认解析
        }

        const sprite = new Live2DSprite(
          setting ? { modelSetting: setting, ticker: Ticker.shared } : { modelPath, ticker: Ticker.shared }
        )
        sprite.renderable = true // easy-live2d 默认 renderable=false，显式打开确保渲染
        // 关键：必须先加入舞台，渲染时才触发模型加载（renderFrame → initModel）
        app.stage.addChild(sprite)
        await withTimeout(sprite.ready, 20000, '模型加载超时（20 秒未完成）')
        if (cancelled) return

        setStatus('适配尺寸…')
        // 基础尺寸：高度适配、脚踩窗口底、水平居中；缩放(滑条)在此基础上乘倍数
        const rawH = sprite.height / Math.max(0.0001, Math.abs(sprite.scale.y))
        const fit = {
          baseFit: (h * 0.85) / rawH,
          baseX: w / 2,
          baseY: h
        }
        // 框架（窗口）尺寸变化：重设画布并重新适配（整体缩放滑条会触发）
        onResize = (): void => {
          const w2 = host.clientWidth || 420
          const h2 = host.clientHeight || 520
          try {
            app?.renderer.resize(w2, h2)
          } catch {
            /* 渲染器已销毁 */
          }
          fit.baseFit = (h2 * 0.85) / rawH
          fit.baseX = w2 / 2
          fit.baseY = h2
        }
        window.addEventListener('resize', onResize)

        // 眼睛追踪状态：目标（屏幕光标归一化 -1..1）+ 当前平滑值
        let targetNX = 0
        let targetNY = 0
        let curNX = 0
        let curNY = 0
        const cursorTimer = window.setInterval(() => {
          void window.api.getCursor().then((c) => {
            if (!c) return
            const hw = c.winW / 2 || 1
            const hh = c.winH / 2 || 1
            targetNX = Math.max(-1, Math.min(1, (c.cx - c.winX - hw) / hw))
            targetNY = Math.max(-1, Math.min(1, (c.cy - c.winY - hh) / hh))
          })
        }, 50)

        // 每帧应用：缩放（滑条值）+ 平移（右键拖动）+ 眼睛追踪 + 口型
        const applyTransform = (): void => {
          const { scale, offsetX, offsetY, eyeTracking, eyeTrackingStrength } = usePetStore.getState()
          sprite.scale.set(fit.baseFit * scale)
          sprite.anchor.set(0.5, 1)
          sprite.x = fit.baseX + offsetX
          sprite.y = fit.baseY + offsetY
          // 头部位置（模型头顶往下约 12% = 接近脸/头顶），供文字气泡定位
          const modelH = fit.baseFit * scale * rawH
          usePetStore.getState().setHead(fit.baseX + offsetX, fit.baseY + offsetY - modelH * 0.88)
          // 眼睛追踪：开 → 平滑趋近光标；关 → 回正
          if (eyeTracking) {
            curNX += (targetNX - curNX) * 0.1
            curNY += (targetNY - curNY) * 0.1
          } else {
            curNX = 0
            curNY = 0
          }
          sprite.setParameterValueById('ParamAngleX', curNX * 15 * eyeTrackingStrength)
          sprite.setParameterValueById('ParamAngleY', -curNY * 12 * eyeTrackingStrength)
          sprite.setParameterValueById('ParamEyeBallX', curNX * 1.5 * eyeTrackingStrength)
          sprite.setParameterValueById('ParamEyeBallY', -curNY * 1.5 * eyeTrackingStrength)
          sprite.setParameterValueById('ParamMouthOpenY', useSpeechStore.getState().mouthLevel)
          // 隐藏免费模型水印/广告：Paramheadxy* 参数 30=隐藏、0=显示，每帧强制覆盖（无此参数的模型是空操作）
          for (const name of ['Paramheadxy', 'Paramheadxy2', 'Paramheadxy3', 'Paramheadxy4', 'Paramheadxy5', 'Paramheadxy6', 'Paramheadxy7', 'Paramheadxy8', 'Paramheadxy9']) {
            sprite.setParameterValueById(name, 30)
          }
          // 隐藏模型自带的水印/署名（初音 miku：Param137=「水印」开关，VTS 里按小键盘 1 就是切它）。
          // 实测：Param137=1 时水印部件 Part18 的网格全部被隐藏，=0 时显示，所以这里强制置 1。
          // 模型没有该参数时是空操作。
          for (const name of ['Param137']) {
            sprite.setParameterValueById(name, 1)
          }
        }
        app.ticker.add(applyTransform)

        // 暴露动作执行器：UI 按钮点一下 → 播对应表情/动作
        live2dActionRef.current = (a: ModelAction): void => {
          try {
            if (a.kind === 'expression') {
              const list = sprite.getExpressions()
              const hit = list.find((e) => e.name === a.name)
              if (hit) {
                sprite.setExpression({ expressionId: hit.name })
                return
              }
              // 名字对不上时按序号兜底
              const idx = actions?.expressions.findIndex((x) => x.name === a.name) ?? -1
              if (idx >= 0) sprite.setExpression({ index: idx })
            } else if (a.group !== undefined && a.index !== undefined) {
              void sprite.startMotion({
                group: a.group,
                no: a.index,
                priority: Priority.Normal
              })
            }
          } catch (e) {
            console.warn('[live2d] 动作执行失败', a, e)
          }
        }

        // 调试钩子：便于排查「按钮点了没反应」这类问题（生产环境无害）
        ;(window as any).__l2dDebug = {
          get expressions(): string[] {
            try {
              return sprite.getExpressions().map((e) => e.name)
            } catch {
              return []
            }
          },
          /** 画布像素指纹：用于验证表情/动作是否真的改变了渲染结果 */
          get frameHash(): number {
            try {
              const cv = canvas
              if (!cv) return -1
              const g = cv.getContext('webgl2') ?? cv.getContext('webgl')
              if (!g) return -1
              const w = Math.min(120, cv.width)
              const h = Math.min(120, cv.height)
              const px = new Uint8Array(w * h * 4)
              g.readPixels(0, 0, w, h, g.RGBA, g.UNSIGNED_BYTE, px)
              let sum = 0
              for (let i = 0; i < px.length; i += 4) sum += px[i] * 3 + px[i + 1] * 5 + px[i + 2] * 7 + px[i + 3] * 11
              return sum
            } catch {
              return -1
            }
          }
        }

        // 锁定模式下：右键拖动 → 平移模型（调整显示哪一部分）
        let dragging = false
        let lastX = 0
        let lastY = 0
        const onDown = (ev: MouseEvent): void => {
          if (!usePetStore.getState().locked) return
          if (ev.button !== 2) return // 右键 = 平移
          dragging = true
          lastX = ev.clientX
          lastY = ev.clientY
          ev.preventDefault()
        }
        const onMove = (ev: MouseEvent): void => {
          if (!dragging) return
          const s = usePetStore.getState()
          s.setOffset(s.offsetX + (ev.clientX - lastX), s.offsetY + (ev.clientY - lastY))
          lastX = ev.clientX
          lastY = ev.clientY
        }
        const onUp = (): void => {
          dragging = false
          const s = usePetStore.getState()
          void window.api.setConfig({ pet: { offsetX: s.offsetX, offsetY: s.offsetY } })
        }
        const onCtx = (ev: MouseEvent): void => ev.preventDefault()
        canvas.addEventListener('mousedown', onDown)
        canvas.addEventListener('contextmenu', onCtx)
        window.addEventListener('mousemove', onMove)
        window.addEventListener('mouseup', onUp)
        cleanupListeners = (): void => {
          window.clearInterval(cursorTimer)
          if (onResize) window.removeEventListener('resize', onResize)
          canvas?.removeEventListener('mousedown', onDown)
          canvas?.removeEventListener('contextmenu', onCtx)
          window.removeEventListener('mousemove', onMove)
          window.removeEventListener('mouseup', onUp)
        }

        console.log('[live2d] DONE rawH=', rawH, 'baseFit=', fit.baseFit)
        setStatus('')
      } catch (e) {
        console.error('[live2d] ERROR:', e)
        setStatus('错误: ' + String((e as Error)?.message ?? e))
      }
    })()

    return () => {
      cancelled = true
      live2dActionRef.current = null
      cleanupListeners?.()
      if (app) {
        try {
          app.destroy(true)
        } catch {
          /* ignore */
        }
      }
      if (canvas && canvas.parentNode === host) {
        host.removeChild(canvas)
      }
    }
  }, [modelPath])

  const isErr = status.startsWith('错误')
  return (
    <div className="pet-wrap" style={{ opacity }}>
      {/* canvas 宿主：JSX 永远为空，React 不会动它里面手动 append 的 canvas */}
      <div className="pet-stage" ref={hostRef} />
      {status && <div className={`live2d-badge ${isErr ? 'live2d-err' : ''}`}>{status}</div>}
    </div>
  )
}