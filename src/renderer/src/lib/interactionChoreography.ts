import type { InteractionPose, InteractionRegion } from './petInteraction'

type Track = Array<[number, number]>
type Tracks = Partial<Record<keyof InteractionPose, Track>>
interface Choreography { label: string; phrase: string; tracks: Tracks }

// Timings are normalized to one performance. Every channel returns to its baseline.
const curve = (...points: Array<[number, number]>): Track => [[0, 0], ...points, [1, 0]]
const expression: Tracks = {
  smile: curve([0.18, 0.55], [0.44, 0.8], [0.76, 0.45]),
  blink: curve([0.07, 0], [0.105, 0.9], [0.14, 0], [0.72, 0], [0.755, 0.85], [0.79, 0]),
  gazeWeight: curve([0.18, 0.85], [0.7, 0.85]),
  gazeY: curve([0.2, 0.15], [0.55, 0.1], [0.8, 0]),
  mouthOpen: curve([0.22, 0.12], [0.4, 0.22], [0.62, 0.08], [0.82, 0])
}
const head: Tracks = {
  ...expression,
  angleY: curve([0.1, 5], [0.28, -29.1], [0.43, 12], [0.61, -19], [0.78, 5]),
  angleZ: curve([0.24, 17], [0.5, -11], [0.72, 8]),
  bodyY: curve([0.13, 0.06], [0.32, -0.32], [0.49, 0.18], [0.65, -0.18], [0.83, 0.04]),
  shoulder: curve([0.22, -0.25], [0.48, 0.15], [0.72, -0.12]),
  hip: curve([0.28, -0.12], [0.56, 0.1], [0.8, -0.04])
}
const face: Tracks = {
  ...expression,
  angleX: curve([0.2, 29.1], [0.38, 24], [0.57, -9], [0.74, 16]),
  angleY: curve([0.22, -12], [0.5, 7], [0.73, -6]),
  angleZ: curve([0.24, -28.5], [0.5, -9], [0.7, 12]),
  bodyX: curve([0.28, 0.38], [0.6, -0.15], [0.8, 0.08]),
  bodyZ: curve([0.32, -0.22], [0.68, 0.18]),
  shoulder: curve([0.18, 0.35], [0.43, 0.15], [0.7, -0.08]),
  gazeX: curve([0.22, -0.7], [0.43, -0.7], [0.58, 0.45], [0.78, 0]),
  blinkLeft: curve([0.47, 0], [0.51, 0.95], [0.57, 0]),
  smile: curve([0.18, 0.3], [0.48, 0.8], [0.76, 0.5])
}
const hand: Tracks = {
  ...expression,
  angleX: curve([0.18, -15], [0.42, -22], [0.62, 10], [0.8, -6]),
  angleZ: curve([0.22, 15], [0.52, -9], [0.75, 7]),
  bodyX: curve([0.2, -0.35], [0.52, 0.2], [0.76, -0.12]),
  bodyZ: curve([0.25, -0.18], [0.6, 0.16]),
  shoulder: curve([0.14, 0.6], [0.36, 0.48], [0.64, 0.56], [0.83, 0.12]),
  arm: curve([0.1, 0], [0.27, 0.96], [0.61, 0.92], [0.76, 0.7], [0.9, 0.12]),
  forearm: curve([0.16, 0], [0.32, 0.96], [0.58, 0.9], [0.74, 0.72], [0.88, 0.1]),
  wrist: curve([0.3, 0], [0.38, 0.95], [0.48, -0.92], [0.58, 0.88], [0.68, -0.65], [0.8, 0.1]),
  handPose: curve([0.1, 0], [0.27, 1], [0.75, 1], [0.9, 0.1]),
  rightArm: curve([0.25, 0.18], [0.53, -0.12], [0.78, 0.08]),
  gazeX: curve([0.23, -0.55], [0.43, 0.35], [0.7, 0])
}
const body: Tracks = {
  ...expression,
  x: curve([0.12, -2], [0.33, 8], [0.58, -4], [0.78, 2]),
  angleX: curve([0.16, 12], [0.39, -28.5], [0.62, 19], [0.8, -7]),
  angleZ: curve([0.25, 13], [0.54, -12], [0.78, 5]),
  bodyX: curve([0.12, -0.15], [0.33, 0.96], [0.6, -0.48], [0.8, 0.2]),
  bodyZ: curve([0.18, -0.08], [0.37, 0.58], [0.64, -0.3], [0.83, 0.08]),
  hip: curve([0.18, 0.08], [0.42, -0.42], [0.68, 0.25], [0.85, -0.06]),
  legs: curve([0.23, 0.12], [0.48, -0.22], [0.72, 0.13]),
  shoulder: curve([0.2, 0.35], [0.52, -0.16], [0.75, 0.12]),
  gazeX: curve([0.19, -0.6], [0.45, 0.65], [0.7, -0.2])
}
const feet: Tracks = {
  ...expression,
  y: curve([0.12, 2], [0.29, -10], [0.5, -5], [0.68, 2], [0.84, -1]),
  angleY: curve([0.22, -28.5], [0.46, -18], [0.65, 11], [0.83, -4]),
  angleZ: curve([0.3, 19], [0.58, -14], [0.8, 6]),
  bodyY: curve([0.1, 0.1], [0.3, -0.65], [0.57, 0.22], [0.8, -0.09]),
  bodyZ: curve([0.32, -0.6], [0.6, 0.34], [0.82, -0.1]),
  hip: curve([0.12, -0.15], [0.29, 0.92], [0.58, -0.36], [0.81, 0.14]),
  legs: curve([0.15, 0.12], [0.33, -0.96], [0.61, 0.36], [0.83, -0.1]),
  shoulder: curve([0.22, 0.52], [0.55, -0.18], [0.77, 0.13]),
  arm: curve([0.25, 0.24], [0.56, -0.1], [0.8, 0.05]),
  rightArm: curve([0.28, -0.25], [0.6, 0.15]),
  gazeY: curve([0.16, -0.8], [0.42, -0.6], [0.62, 0.3], [0.8, 0]),
  mouthOpen: curve([0.17, 0.38], [0.35, 0.1], [0.65, 0.15], [0.8, 0])
}
const gesture = (label: string, phrase: string, base: Tracks, extra: Tracks = {}): Choreography =>
  ({ label, phrase, tracks: { ...base, ...extra } })

/** Each set contains a complete, distinct sequence rather than a randomized joint pose. */
export const CHOREOGRAPHIES: Record<InteractionRegion, readonly Choreography[]> = {
  head: [
    gesture('点头蹭蹭', '摸摸头，今天也辛苦啦～', head),
    gesture('歪头张望', '嗯？是在叫我吗？让我看看～', head, {
      angleX: curve([0.18, -22], [0.4, 29], [0.6, 18], [0.78, -8]),
      angleY: curve([0.22, 15], [0.46, -12], [0.68, 9]),
      angleZ: curve([0.25, -24], [0.51, 25], [0.76, -6]),
      bodyX: curve([0.3, -0.3], [0.57, 0.4], [0.8, -0.1]),
      gazeX: curve([0.12, -0.8], [0.34, 0.8], [0.63, 0.25], [0.8, 0]),
      blink: curve([0.3, 0], [0.34, 0.9], [0.38, 0], [0.68, 0], [0.72, 0.8], [0.76, 0])
    }),
    gesture('开心晃脑', '嘿嘿，再摸一下就充满元气啦！', head, {
      angleY: curve([0.2, -26], [0.36, 13], [0.53, -21], [0.69, 10], [0.84, -4]),
      angleZ: curve([0.2, 25], [0.4, -24], [0.6, 18], [0.8, -8]),
      bodyZ: curve([0.26, 0.3], [0.46, -0.28], [0.66, 0.2], [0.84, -0.07]),
      rightArm: curve([0.24, 0.25], [0.47, -0.14], [0.7, 0.1]),
      smile: curve([0.18, 0.85], [0.57, 0.95], [0.8, 0.5])
    })
  ],
  face: [
    gesture('害羞回眸', '轻轻戳就好……我又偷偷看回来了。', face),
    gesture('歪头眨眼', '看着你，就忍不住笑起来啦！', face, {
      angleX: curve([0.24, -19], [0.46, -9], [0.67, 16]),
      angleZ: curve([0.24, 28.5], [0.47, 19], [0.7, -10]),
      bodyX: curve([0.3, -0.33], [0.7, 0.18]),
      blinkLeft: curve([0.29, 0], [0.35, 1], [0.4, 1], [0.47, 0]),
      gazeX: curve([0.24, 0.45], [0.58, -0.2], [0.8, 0]),
      smile: curve([0.2, 0.7], [0.4, 0.95], [0.72, 0.6])
    }),
    gesture('躲开又探头', '哎呀，有点痒～再探头看看你！', face, {
      angleX: curve([0.2, 29], [0.42, -25], [0.63, 16], [0.82, -5]),
      angleZ: curve([0.22, -25], [0.47, 24], [0.73, -9]),
      bodyX: curve([0.26, 0.55], [0.5, -0.4], [0.75, 0.16]),
      bodyZ: curve([0.3, -0.4], [0.56, 0.3], [0.8, -0.1]),
      blinkLeft: curve([0.55, 0], [0.59, 0.8], [0.64, 0]),
      gazeX: curve([0.23, -0.8], [0.46, 0.75], [0.7, 0])
    })
  ],
  hand: [
    gesture('抬手连挥', '我在这里，挥挥手陪着你呀！', hand),
    gesture('伸手击掌', '来，击个掌！一起加油～', hand, {
      angleX: curve([0.22, -18], [0.44, 12], [0.66, -7]),
      angleY: curve([0.17, -8], [0.42, 15], [0.62, -5]),
      bodyX: curve([0.18, -0.25], [0.41, 0.58], [0.61, -0.23], [0.8, 0.08]),
      forearm: curve([0.16, 0], [0.3, 0.96], [0.43, 0.36], [0.59, 0.9], [0.78, 0.55], [0.9, 0.08]),
      wrist: curve([0.29, 0], [0.41, 0.6], [0.53, -0.65], [0.66, 0.25], [0.8, 0]),
      shoulder: curve([0.14, 0.6], [0.4, 0.78], [0.6, 0.33], [0.82, 0.1]),
      blink: curve([0.36, 0], [0.4, 0.85], [0.45, 0], [0.73, 0], [0.77, 0.8], [0.81, 0])
    }),
    gesture('招手邀约', '来这边～休息一下再继续吧！', hand, {
      angleX: curve([0.2, -24], [0.45, 8], [0.66, -13], [0.82, 3]),
      bodyX: curve([0.22, -0.4], [0.48, 0.33], [0.72, -0.16]),
      forearm: curve([0.16, 0], [0.31, 0.96], [0.45, 0.4], [0.57, 0.95], [0.7, 0.42], [0.87, 0.1]),
      wrist: curve([0.3, 0], [0.4, -0.92], [0.5, 0.78], [0.6, -0.88], [0.72, 0.6], [0.84, 0]),
      gazeX: curve([0.18, -0.75], [0.4, 0.35], [0.56, -0.5], [0.76, 0]),
      blinkLeft: curve([0.64, 0], [0.69, 0.9], [0.75, 0])
    })
  ],
  body: [
    gesture('转身回望', '收到呼叫！转过来看看你～', body),
    gesture('舒展伸腰', '坐了这么久，一起伸个懒腰吧！', body, {
      x: curve([0.25, -3], [0.51, 4], [0.78, -1]),
      angleX: curve([0.24, 18], [0.5, -23], [0.74, 7]),
      angleY: curve([0.22, 27], [0.49, 20], [0.72, -10]),
      angleZ: curve([0.27, -24], [0.54, 24], [0.8, -6]),
      bodyX: curve([0.28, -0.72], [0.54, 0.92], [0.79, -0.18]),
      bodyY: curve([0.23, 0.64], [0.51, 0.5], [0.76, -0.2]),
      shoulder: curve([0.17, 0.8], [0.46, 0.65], [0.73, -0.12]),
      arm: curve([0.21, 0.5], [0.49, 0.62], [0.78, 0.08]),
      rightArm: curve([0.25, 0.6], [0.55, 0.48], [0.8, 0.05]),
      gazeY: curve([0.2, 0.6], [0.52, 0.4], [0.76, 0]),
      blink: curve([0.19, 0], [0.26, 0.8], [0.45, 0.8], [0.56, 0])
    }),
    gesture('左右摇摆', '跟着我，左边一下、右边一下～', body, {
      x: curve([0.22, 7], [0.44, -7], [0.64, 5], [0.83, -2]),
      angleX: curve([0.17, -24], [0.38, 25], [0.61, -18], [0.8, 6]),
      angleZ: curve([0.23, 19], [0.45, -20], [0.67, 14], [0.85, -4]),
      bodyX: curve([0.24, 0.96], [0.47, -0.9], [0.69, 0.58], [0.86, -0.16]),
      bodyZ: curve([0.28, 0.56], [0.51, -0.54], [0.73, 0.32]),
      hip: curve([0.32, -0.48], [0.55, 0.48], [0.76, -0.26]),
      rightArm: curve([0.3, 0.3], [0.53, -0.25], [0.74, 0.14])
    })
  ],
  feet: [
    gesture('缩脚找平衡', '哎呀，脚边有点痒！站稳站稳～', feet),
    gesture('轻蹦两下', '蹦一下，再蹦一下！精神起来啦～', feet, {
      y: curve([0.13, 3], [0.27, -10], [0.42, 3], [0.57, -8], [0.73, 2], [0.87, -0.5]),
      angleY: curve([0.18, -20], [0.33, 12], [0.48, -24], [0.63, 12], [0.8, -4]),
      bodyY: curve([0.15, 0.42], [0.3, -0.64], [0.46, 0.38], [0.6, -0.58], [0.78, 0.13]),
      hip: curve([0.17, -0.32], [0.32, 0.86], [0.47, -0.27], [0.62, 0.78], [0.8, -0.1]),
      legs: curve([0.19, 0.25], [0.34, -0.96], [0.5, 0.24], [0.65, -0.85], [0.83, 0.08]),
      gazeY: curve([0.18, -0.45], [0.33, 0.35], [0.5, -0.4], [0.67, 0.3], [0.82, 0])
    }),
    gesture('探脚再收回', '试探一下……还是回来陪你吧！', feet, {
      x: curve([0.26, 6], [0.51, -5], [0.76, 2]),
      y: curve([0.26, -4], [0.52, -7], [0.76, 1]),
      angleX: curve([0.19, -21], [0.45, 22], [0.71, -8]),
      angleZ: curve([0.23, -22], [0.5, 23], [0.76, -7]),
      bodyZ: curve([0.28, 0.5], [0.55, -0.52], [0.8, 0.14]),
      hip: curve([0.26, -0.85], [0.52, 0.92], [0.78, -0.18]),
      legs: curve([0.31, 0.84], [0.57, -0.94], [0.81, 0.14]),
      gazeX: curve([0.16, -0.65], [0.4, 0.6], [0.72, 0]),
      rightArm: curve([0.3, 0.28], [0.6, -0.24], [0.82, 0.06])
    })
  ]
}

/** A shuffled bag shows all three sequences before recycling, without a boundary repeat. */
export function createChoreographySelector(random: () => number = Math.random): (region: InteractionRegion) => number {
  const bags = new Map<InteractionRegion, number[]>()
  const previous = new Map<InteractionRegion, number>()
  return (region) => {
    let bag = bags.get(region)
    if (!bag?.length) {
      bag = CHOREOGRAPHIES[region].map((_, i) => i)
      for (let i = bag.length - 1; i > 0; i--) {
        const j = Math.floor(random() * (i + 1))
        ;[bag[i], bag[j]] = [bag[j], bag[i]]
      }
      if (bag[bag.length - 1] === previous.get(region)) {
        ;[bag[0], bag[bag.length - 1]] = [bag[bag.length - 1], bag[0]]
      }
      bags.set(region, bag)
    }
    const chosen = bag.pop()!
    previous.set(region, chosen)
    return chosen
  }
}
