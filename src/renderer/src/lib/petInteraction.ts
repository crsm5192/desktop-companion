import type { ModelAction } from '@shared/types'
import { CHOREOGRAPHIES } from './interactionChoreography'

export type InteractionRegion = 'head' | 'face' | 'hand' | 'body' | 'feet'

export const INTERACTION_DURATION = 6800
export const INTERACTION_SPEECH_DURATION = 8000
export const INTERACTION_COOLDOWN = 650
export const CLICK_DISTANCE = 6

/** 当前模型的点击入口；模型卸载后清空，不保留旧画布。 */
export const petInteractionRef: {
  current: { hitAt: (x: number, y: number) => InteractionRegion | null; cancel: () => void } | null
} = { current: null }

interface InteractionPreset {
  label: string
  actionLabel: string
  phrases: readonly string[]
  expressions: RegExp[]
  motions: RegExp[]
}

export const INTERACTIONS: Record<InteractionRegion, InteractionPreset> = {
  head: {
    label: '头部',
    actionLabel: '轻轻点头',
    phrases: ['摸摸头，今天也辛苦啦～', '嘿嘿，头发要被揉乱啦！', '再摸一下，就充满元气啦～'],
    expressions: [/脸红|blush/i, /微笑|开心|smile|happy/i],
    motions: [/摸头|点头|taphead|nod/i]
  },
  face: {
    label: '脸部',
    actionLabel: '害羞侧头',
    phrases: ['被你发现我在偷偷看你啦～', '轻轻戳就好，有点害羞呢。', '看着你，就忍不住笑起来啦！'],
    expressions: [/爱心眼|heart/i, /微笑|smile/i],
    motions: [/眨眼|wink/i]
  },
  hand: {
    label: '手部',
    actionLabel: '抬手回应',
    phrases: ['来，击个掌！', '牵好手，一起加油吧～', '我在这里，随时陪你呀！'],
    expressions: [/开心|happy/i],
    motions: [/默认手切举手/, /挥手|招手|举手|wave|hello/i]
  },
  body: {
    label: '身体',
    actionLabel: '转身回应',
    phrases: ['收到你的呼叫啦！有什么想和我分享的？', '嘿嘿，有点痒～', '坐了这么久，一起伸个懒腰吧！'],
    expressions: [/屑屑眼/, /开心|happy|smile/i],
    motions: [/摇摆|伸懒腰|tapbody|sway|stretch/i]
  },
  feet: {
    label: '脚部',
    actionLabel: '缩脚躲一下',
    phrases: ['哎呀，脚边有点痒！', '蹦一下！要不要起来走走？', '休息一下，活动活动吧～'],
    expressions: [/＞＜|><|惊讶|surpris/i],
    motions: [/跳跃|蹦|jump/i]
  }
}

/** Prefer semantic asset names; never randomly trigger outfit/accessory switches. */
export function chooseInteractionActions(
  region: InteractionRegion,
  expressions: ModelAction[],
  motions: ModelAction[]
): { expression?: ModelAction; motion?: ModelAction } {
  const preset = INTERACTIONS[region]
  const choose = (items: ModelAction[], patterns: RegExp[]): ModelAction | undefined => {
    for (const pattern of patterns) {
      const match = items.find((item) => {
        const name = `${item.name} ${item.file ?? ''}`
        return !/切回|切默认|回默认|关闭|脱|return|reset|idle/i.test(name) && pattern.test(name)
      })
      if (match) return match
    }
    return undefined
  }
  return { expression: choose(expressions, preset.expressions), motion: choose(motions, preset.motions) }
}

export function regionFromName(name: string): InteractionRegion | null {
  if (/手|臂|指|hand|arm|finger/i.test(name)) return 'hand'
  if (/脚|足|腿|鞋|foot|feet|leg|shoe/i.test(name)) return 'feet'
  if (/脸|眼|鼻|嘴|口|眉|五官|face|eye|nose|mouth|cheek/i.test(name)) return 'face'
  if (/头|发|耳|呆毛|脑|head|hair|ear/i.test(name)) return 'head'
  if (/身|胸|腰|肚|裙|领|肩|脖|body|bust|torso|neck|dress/i.test(name)) return 'body'
  return null
}

/** Fallback for models without named parts or declared hit areas; coordinates are model-relative. */
export function regionFromPosition(x: number, y: number): InteractionRegion | null {
  if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || x > 1 || y < 0 || y > 1) return null
  if (y < 0.18) return 'head'
  if (y < 0.34) return 'face'
  if (y > 0.78) return 'feet'
  if (x < 0.28 || x > 0.72) return 'hand'
  return 'body'
}

export function pointInTriangle(
  x: number, y: number,
  ax: number, ay: number, bx: number, by: number, cx: number, cy: number
): boolean {
  const area = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax)
  if (Math.abs(area) < 1e-10) return false
  const u = ((bx - x) * (cy - y) - (by - y) * (cx - x)) / area
  const v = ((cx - x) * (ay - y) - (cy - y) * (ax - x)) / area
  const w = 1 - u - v
  return u >= -1e-6 && v >= -1e-6 && w >= -1e-6
}

export interface InteractionPose {
  x: number; y: number; angleX: number; angleY: number; angleZ: number
  bodyX: number; bodyY: number; bodyZ: number; shoulder: number
  arm: number; forearm: number; wrist: number; hip: number; legs: number
  smile: number; blink: number; handPose: number
  blinkLeft: number; blinkRight: number; rightArm: number
  gazeX: number; gazeY: number; gazeWeight: number; mouthOpen: number
}

/** Quintic easing gives every gesture a soft start and a zero-velocity finish. */
export function smoothStep(value: number): number {
  const t = Math.min(1, Math.max(0, value))
  return t * t * t * (t * (t * 6 - 15) + 10)
}

function track(t: number, points: Array<[number, number]>): number {
  for (let i = 1; i < points.length; i++) {
    if (t <= points[i][0]) {
      const [start, from] = points[i - 1]
      const [end, to] = points[i]
      return from + (to - from) * smoothStep((t - start) / (end - start))
    }
  }
  return points[points.length - 1][1]
}

/** Sample the selected performance; supporting joints lag behind its leading movement. */
export function interactionPose(region: InteractionRegion, elapsedMs: number, variant = 0): InteractionPose {
  const t = Math.min(1, Math.max(0, elapsedMs / INTERACTION_DURATION))
  const pose: InteractionPose = {
    x: 0, y: 0, angleX: 0, angleY: 0, angleZ: 0, bodyX: 0, bodyY: 0, bodyZ: 0,
    shoulder: 0, arm: 0, forearm: 0, wrist: 0, hip: 0, legs: 0, smile: 0, blink: 0, handPose: 0,
    blinkLeft: 0, blinkRight: 0, rightArm: 0, gazeX: 0, gazeY: 0, gazeWeight: 0, mouthOpen: 0
  }
  const choreography = CHOREOGRAPHIES[region][variant] ?? CHOREOGRAPHIES[region][0]
  for (const key of Object.keys(choreography.tracks) as Array<keyof InteractionPose>) {
    pose[key] = track(t, choreography.tracks[key]!)
  }
  return pose
}
