import { Priority, type Live2DSprite } from 'easy-live2d'
import { ControlError, EMOTIONS, GESTURES, type ControlCommand, type ModelCapabilities, type PerformanceCue } from '@shared/control'
import type { ModelActionsInfo } from '@shared/types'
import { performanceChannels } from './performanceChoreography'
import { adaptHandChannels, hasRaisedHandRig } from './live2dHandRig'

interface ParameterData { ids: string[]; values: Float32Array; minimumValues: Float32Array; maximumValues: Float32Array; defaultValues: Float32Array }
interface ModelInternals {
  _model: { getModel(): { getModel(): { parameters: ParameterData }; saveParameters(): void; _savedParameters: { getSize(): number; at(index: number): number } }; _motionManager: { stopAllMotions(): void; _currentPriority: number; setReservePriority(n: number): void } }
}
interface Track { from: number; target: number; baseline: number; start: number; end: number; gesture?: (progress: number) => number; performance?: boolean }
interface Adapter { cancelInteraction(): void; getExpression(): string | undefined; setExpression(name?: string): void }
export interface Live2DController {
  execute(command: ControlCommand): Promise<unknown>
  apply(natural: Record<string, number>): void
  capabilities(): ModelCapabilities
  reset(): void
  destroy(): void
}
export const live2dControllerRef: { current: Live2DController | null } = { current: null }
const ease = (t: number): number => { const v = Math.max(0, Math.min(1, t)); return v * v * (3 - 2 * v) }
const emotionExpressions: Record<string, RegExp> = {
  happy: /微笑|开心|爱心眼|smile|happy|heart/i,
  sad: /流泪|落泪|伤心|sad|cry/i,
  shy: /脸红|害羞|blush|shy/i,
  surprised: /圈圈眼|惊讶|＞＜|surpris/i,
  thinking: /加载|思考|流冷汗|think/i,
  angry: /黑脸|生气|angry/i
}
export function createLive2DController(sprite: Live2DSprite, modelPath: string, info: ModelActionsInfo, adapter: Adapter): Live2DController {
  const internal = sprite as unknown as ModelInternals
  const parameters = internal._model.getModel().getModel().parameters
  const indices = new Map(parameters.ids.map((id, index) => [id, index]))
  const tracks = new Map<string, Track>()
  let expressionTimer = 0
  let previousExpression: string | undefined
  let temporaryExpression = false
  let performanceTimer = 0
  let activePerformance = false
  let motionPoll = 0
  let activeMotion: string | null = null
  let motionBaseline: Float32Array | null = null
  let destroyed = false
  const variants = new Map<string, number>()
  const raisedHandRig = hasRaisedHandRig(new Set(parameters.ids))
  const hasHandRig = ['LArm', 'RArm'].some(id => indices.has(id)) || raisedHandRig
  const waveMotion = info.motions.find(m => /挥手|招手|举手|wave|hello/i.test(m.name))
  const emit = (type: string, data: unknown): void => window.api.control.emit(type, data)
  const clamp = (id: string, value: number): number => {
    const index = indices.get(id)!
    return Math.max(parameters.minimumValues[index], Math.min(parameters.maximumValues[index], value))
  }
  const drive = (id: string, target: number, durationMs: number, gesture?: Track['gesture']): boolean => {
    const index = indices.get(id)
    if (index === undefined) return false
    const from = parameters.values[index]
    const now = performance.now()
    tracks.set(id, { from, target: clamp(id, target), baseline: tracks.get(id)?.baseline ?? from, start: now, end: now + durationMs, gesture })
    return true
  }
  const restoreExpression = (): void => {
    window.clearTimeout(expressionTimer)
    if (temporaryExpression) adapter.setExpression(previousExpression)
    temporaryExpression = false
  }
  const setExpression = (name: string, durationMs: number): void => {
    if (!info.expressions.some(expression => expression.name === name)) throw new ControlError('UNKNOWN_EXPRESSION', `模型没有表情：${name}`)
    window.clearTimeout(expressionTimer)
    if (!temporaryExpression) previousExpression = adapter.getExpression()
    temporaryExpression = true
    adapter.setExpression(name)
    emit('expression.started', { name, durationMs })
    expressionTimer = window.setTimeout(() => { restoreExpression(); emit('expression.finished', { name }) }, durationMs)
  }
  const stopMotion = (reason: string): void => {
    window.clearInterval(motionPoll)
    const manager = internal._model._motionManager
    manager.stopAllMotions(); manager._currentPriority = 0; manager.setReservePriority(0)
    if (motionBaseline) {
      parameters.values.set(motionBaseline)
      internal._model.getModel().saveParameters()
      motionBaseline = null
    }
    if (activeMotion) emit('motion.finished', { name: activeMotion, reason })
    activeMotion = null
  }
  const playMotion = async (name: string, durationMs = 3500): Promise<void> => {
    const motion = info.motions.find(action => action.name === name)
    if (!motion || motion.group === undefined || motion.index === undefined) throw new ControlError('UNKNOWN_MOTION', `模型没有动作：${name}`)
    stopMotion('replaced')
    const saved = internal._model.getModel()._savedParameters
    motionBaseline = new Float32Array(parameters.values)
    for (let i = 0; i < Math.min(saved.getSize(), motionBaseline.length); i++) motionBaseline[i] = saved.at(i)
    const started = await sprite.startMotion({ group: motion.group, no: motion.index, priority: Priority.Force })
    if (destroyed) return
    if (started === false || started === -1) { motionBaseline = null; throw new ControlError('EXECUTION_FAILED', '动作未能开始') }
    activeMotion = name
    emit('motion.started', { name, durationMs })
    const began = performance.now()
    motionPoll = window.setInterval(() => {
      if (internal._model._motionManager._currentPriority === 0 || performance.now() - began >= durationMs) stopMotion('completed')
    }, 100)
  }
  const perform = async (cue: PerformanceCue): Promise<unknown> => {
    const durationMs = cue.durationMs ?? 3500
    const intensity = cue.intensity ?? 0.85
    if (cue.gesture === 'wave' && !hasHandRig && !waveMotion) throw new ControlError('UNSUPPORTED_GESTURE', '模型没有可用的手臂参数或举手动作')
    const now = performance.now()
    for (const [id, track] of tracks) if (track.performance) {
      track.from = parameters.values[indices.get(id)!]
      track.target = track.from
      track.gesture = undefined
      track.start = now - 220
      track.end = now
    }
    if (cue.emotion) {
      restoreExpression()
      const name = info.expressions.find(e => emotionExpressions[cue.emotion!]?.test(e.name))?.name
      if (name && intensity > 0) setExpression(name, durationMs)
    }
    if (cue.gaze && !cue.emotion && !cue.gesture) {
      drive('ParamEyeBallX', cue.gaze.x, durationMs)
      drive('ParamEyeBallY', cue.gaze.y, durationMs)
      drive('ParamAngleX', cue.gaze.x * 12, durationMs)
      drive('ParamAngleY', cue.gaze.y * 8, durationMs)
    }
    if (cue.emotion || cue.gesture) {
      if (cue.gesture === 'wave' && !hasHandRig && waveMotion) await playMotion(waveMotion.name, durationMs)
      const key = `${cue.emotion ?? 'neutral'}:${cue.gesture ?? 'pose'}`
      const variant = variants.get(key) ?? 0
      variants.set(key, variant + 1)
      const channels = adaptHandChannels(performanceChannels(cue, variant, 0.5), raisedHandRig)
      let sampledAt = -1
      let sampledChannels = channels
      const sample = (progress: number): Record<string, number> => {
        if (sampledAt !== progress) { sampledAt = progress; sampledChannels = adaptHandChannels(performanceChannels(cue, variant, progress), raisedHandRig) }
        return sampledChannels
      }
      for (const id of Object.keys(channels)) {
        const index = indices.get(id)
        if (index === undefined || (!raisedHandRig && /^(Movement2|Param(56|57|62|59|60|61))$/.test(id))) continue
        const baseline = tracks.get(id)?.baseline ?? parameters.values[index]
        drive(id, baseline, durationMs, progress => {
          const amount = sample(progress)[id] ?? 0
          const destination = amount < 0 ? parameters.minimumValues[index] : parameters.maximumValues[index]
          return baseline + (destination - baseline) * Math.abs(amount)
        })
        const track = tracks.get(id)!
        track.performance = true
        track.start = now
        track.end = now + durationMs
      }
    }
    window.clearTimeout(performanceTimer)
    if (activePerformance) emit('performance.finished', { reason: 'replaced' })
    activePerformance = true
    emit('performance.started', cue)
    performanceTimer = window.setTimeout(() => { activePerformance = false; emit('performance.finished', { reason: 'completed' }) }, durationMs + 350)
    return { applied: cue, durationMs }
  }
  const reset = (): void => {
    adapter.cancelInteraction()
    stopMotion('reset')
    restoreExpression()
    window.clearTimeout(performanceTimer)
    if (activePerformance) emit('performance.finished', { reason: 'reset' })
    activePerformance = false
    const now = performance.now()
    for (const [id, track] of tracks) {
      track.from = parameters.values[indices.get(id)!]
      track.target = track.from
      track.gesture = undefined
      track.start = now - 250
      track.end = now
    }
  }
  const capabilities = (): ModelCapabilities => ({
    modelPath, expressions: info.expressions, motions: info.motions,
    parameters: parameters.ids.map((id, index) => ({ id, minimum: parameters.minimumValues[index], maximum: parameters.maximumValues[index], default: parameters.defaultValues[index], value: parameters.values[index] })),
    emotions: EMOTIONS,
    gestures: GESTURES.filter(gesture => gesture !== 'wave' || hasHandRig || !!waveMotion)
  })
  return {
    capabilities, reset,
    execute: async command => {
      if (command.type === 'model.get') return capabilities()
      if (command.type === 'parameters.set') {
        for (const parameter of command.data.values) if (!indices.has(parameter.id)) throw new ControlError('UNKNOWN_PARAMETER', `模型没有参数：${parameter.id}`)
      }
      adapter.cancelInteraction()
      switch (command.type) {
        case 'expression.set': setExpression(command.data.name, command.data.durationMs ?? 3500); return { name: command.data.name }
        case 'motion.play': await playMotion(command.data.name, command.data.durationMs); return { name: command.data.name, durationMs: command.data.durationMs ?? 3500 }
        case 'gaze.set': return perform({ gaze: command.data, durationMs: command.data.durationMs })
        case 'performance.play': return perform(command.data)
        case 'parameters.set': {
          const values = command.data.values.map(v => ({ id: v.id, value: clamp(v.id, v.value) }))
          for (const parameter of values) drive(parameter.id, parameter.value, command.data.durationMs ?? 3500)
          return { values }
        }
        case 'control.reset': reset(); return { reset: true }
        default: throw new ControlError('UNKNOWN_COMMAND', '控制器不支持该命令')
      }
    },
    apply: natural => {
      const now = performance.now()
      for (const [id, track] of tracks) {
        const index = indices.get(id)!
        const elapsed = now - track.start
        let value = track.gesture ? track.gesture(Math.max(0, Math.min(1, elapsed / (track.end - track.start)))) : track.target
        value = track.from + (value - track.from) * ease(elapsed / 220)
        if (now >= track.end) {
          const target = natural[id] ?? track.baseline
          value += (target - value) * ease((now - track.end) / 350)
          if (now - track.end >= 350) {
            sprite.setParameterValueById(id, 0, 0)
            tracks.delete(id)
            continue
          }
        }
        // Speech has exclusive ownership of mouth opening while audio is playing.
        if (id === 'ParamMouthOpenY' && natural.__speaking === 1) value = natural.ParamMouthOpenY
        sprite.setParameterValueById(id, clamp(id, value))
      }
    },
    destroy: () => {
      reset(); destroyed = true
      for (const id of tracks.keys()) sprite.setParameterValueById(id, 0, 0)
      tracks.clear()
    }
  }
}
