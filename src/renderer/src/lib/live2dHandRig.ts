const raisedHandIds = ['Movement2', 'Param56', 'Param57', 'Param62', 'Param59', 'Param60', 'Param61']

export function hasRaisedHandRig(ids: ReadonlySet<string>): boolean {
  return raisedHandIds.every(id => ids.has(id))
}

/** DeepSeek's raised-hand deformers are separate from its resting-arm physics. */
export function adaptHandChannels(channels: Record<string, number>, raisedHandRig: boolean): Record<string, number> {
  if (!raisedHandRig) return channels
  const adjusted = { ...channels }
  const lift = Math.max(0, Math.min(1, channels.Movement2 ?? 0))
  const elbow = Math.max(0, Math.min(1, channels.Param60 ?? 0))
  // Leave the hand-pose switch intact. Fade out resting-arm gestures as the raised
  // arm appears, so two deformation chains cannot pull the same joints apart.
  for (const [id, strength] of Object.entries({ LArm: 0.12, LForearm: 0.1, LWrist: 0.07, RArm: 0.12 })) {
    if (id in channels) adjusted[id] = channels[id] * strength * (id === 'RArm' ? 1 : 1 - lift)
  }
  if ('ShoulderY' in channels) adjusted.ShoulderY *= 0.35
  if ('ShoulderZ' in channels) adjusted.ShoulderZ *= 0.4
  // Authored raising-hand motion uses ~0.03 upper-arm rotation and <=0.2 wrist
  // rotation on a -1..1 rig. Full-range values fold the elbow/wrist unnaturally.
  if ('Param62' in channels) adjusted.Param62 *= 0.06
  if ('Param59' in channels) adjusted.Param59 = lift * 0.4
  if ('Param60' in channels) adjusted.Param60 = elbow * lift * 0.72
  if ('Param61' in channels) adjusted.Param61 *= lift * elbow * 0.16
  // These IDs are tail lighting, not hand joints, in this rig.
  delete adjusted.Param56
  delete adjusted.Param57
  return adjusted
}
