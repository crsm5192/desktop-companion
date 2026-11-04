import type { PerformanceCue } from '@shared/control'
import { INTERACTION_DURATION, interactionPose, type InteractionRegion } from './petInteraction'

const profiles: Record<string, Array<[InteractionRegion, number]>> = {
  happy: [['head', 2], ['body', 2], ['hand', 0]],
  shy: [['face', 0], ['face', 2], ['head', 1]],
  sad: [['head', 0], ['body', 0], ['face', 0]],
  surprised: [['feet', 0], ['face', 2], ['head', 2]],
  thinking: [['head', 1], ['face', 1], ['body', 0]],
  angry: [['body', 0], ['face', 1], ['head', 1]],
  neutral: [['body', 2], ['head', 0], ['face', 1]]
}

/** Normalized channels are adapted to each model's actual parameter ranges. */
export function performanceChannels(cue: PerformanceCue, variant: number, progress: number): Record<string, number> {
  const p = Math.max(0, Math.min(1, progress))
  const emotion = cue.emotion ?? 'neutral'
  const choices = cue.gesture === 'wave' ? [['hand', variant % 3] as [InteractionRegion, number]] : profiles[emotion]
  const [region, choreography] = choices[variant % choices.length]
  const pose = interactionPose(region, p * INTERACTION_DURATION, choreography)
  const requested = cue.intensity ?? 0.85
  const strength = requested <= 0 ? 0 : Math.min(1, requested * 1.35)
  const envelope = p <= 0 || p >= 1 ? 0 : Math.pow(Math.sin(p * Math.PI), 0.7)
  const direction = variant % 2 ? -1 : 1
  if (cue.gesture === 'nod') {
    pose.angleY = Math.sin(p * Math.PI * (variant % 2 ? 6 : 4)) * envelope * 29
    pose.bodyY += Math.sin(p * Math.PI * 4 - 0.25) * envelope * 0.35
    pose.shoulder += Math.sin(p * Math.PI * 4 - 0.5) * envelope * 0.25
  } else if (cue.gesture === 'shake') {
    pose.angleX = Math.sin(p * Math.PI * (variant % 2 ? 6 : 4)) * envelope * 29
    pose.angleZ = Math.sin(p * Math.PI * 4 - 0.4) * envelope * 16
    pose.bodyX = Math.sin(p * Math.PI * 4 - 0.6) * envelope * 0.5
  }
  if (emotion === 'sad') { pose.angleY -= envelope * 12; pose.shoulder -= envelope * 0.45 }
  if (emotion === 'thinking') { pose.angleZ += direction * envelope * 15; pose.gazeX = direction * envelope * 0.6 }
  if (emotion === 'surprised') { pose.angleY += envelope * 12; pose.bodyY += envelope * 0.4 }
  const smile = emotion === 'happy' || emotion === 'shy' ? envelope * 0.95
    : emotion === 'sad' || emotion === 'angry' ? -envelope * 0.75 : 0
  const channels: Record<string, number> = {
    ParamAngleX: pose.angleX / 30, ParamAngleY: pose.angleY / 30, ParamAngleZ: pose.angleZ / 30,
    ParamBodyAngleX: pose.bodyX, ParamBodyAngleY: pose.bodyY, ParamBodyAngleZ: pose.bodyZ,
    ShoulderY: pose.shoulder, ShoulderZ: pose.bodyZ * 0.55,
    HipAngleX: -pose.bodyX * 0.35, HipAngleZ: pose.hip, LEGAngleZ2: pose.legs,
    LArm: -pose.arm, LForearm: pose.forearm, LWrist: pose.wrist, RArm: pose.rightArm,
    ParamMouthForm: smile, EyeSmile: Math.max(0, smile) * 0.7,
    ParamEyeLOpen: -Math.max(pose.blink, pose.blinkLeft), ParamEyeROpen: -Math.max(pose.blink, pose.blinkRight),
    ParamEyeBallX: cue.gaze ? cue.gaze.x * envelope : pose.gazeX * pose.gazeWeight,
    ParamEyeBallY: cue.gaze ? cue.gaze.y * envelope : pose.gazeY * pose.gazeWeight,
    ParamMouthOpenY: pose.mouthOpen,
    ParamBrowLY: (emotion === 'angry' ? -0.65 : emotion === 'surprised' ? 0.8 : 0.2) * envelope,
    ParamBrowRY: (emotion === 'angry' ? -0.65 : emotion === 'surprised' ? 0.8 : 0.2) * envelope
  }
  if (cue.gaze) {
    channels.ParamAngleX += cue.gaze.x * envelope * 0.35
    channels.ParamAngleY += cue.gaze.y * envelope * 0.25
  }
  for (const id of Object.keys(channels)) channels[id] = Math.max(-1, Math.min(1, channels[id] * strength))
  // Keep upstream tracking inputs available for rigs with authored physics chains.
  channels.AngleX = channels.ParamAngleX; channels.AngleY = channels.ParamAngleY; channels.AngleZ = channels.ParamAngleZ
  channels.PositionX = channels.ParamBodyAngleX; channels.PositionY = channels.ParamBodyAngleY; channels.PositionZ = channels.ParamBodyAngleZ
  if (cue.gesture === 'wave' || region === 'hand') {
    channels.Movement2 = pose.handPose * strength
    channels.Param56 = pose.handPose * strength
    channels.Param57 = -pose.handPose * strength
    channels.Param62 = pose.arm * strength
    channels.Param59 = pose.handPose * 0.55 * strength
    channels.Param60 = pose.forearm * strength
    channels.Param61 = pose.wrist * strength
  }
  return channels
}
