import { Priority, type Live2DSprite } from 'easy-live2d'
import type { ModelActionsInfo } from '@shared/types'
import { usePetStore } from '../store/pet'
import { useInteractionStore } from '../store/interaction'
import { adaptHandChannels, hasRaisedHandRig } from './live2dHandRig'
import {
  CLICK_DISTANCE, INTERACTION_COOLDOWN, INTERACTION_DURATION, chooseInteractionActions,
  interactionPose, petInteractionRef, pointInTriangle, regionFromName, regionFromPosition, smoothStep,
  type InteractionPose, type InteractionRegion
} from './petInteraction'

interface CubismVector<T> { getSize(): number; at(index: number): T; clear(): void }
interface CubismModel {
  getModel(): { parameters: { ids: string[]; values: Float32Array; minimumValues: Float32Array; maximumValues: Float32Array }; parts: { ids: string[]; parentIndices?: Int32Array; opacities: Float32Array } }
  _savedParameters: CubismVector<number>
  saveParameters(): void
  getDrawableCount(): number
  getDrawableVertices(index: number): Float32Array
  getDrawableVertexIndices(index: number): Uint16Array
  getDrawableVertexUvs(index: number): Float32Array
  getDrawableTextureIndex(index: number): number
  getDrawableOpacity(index: number): number
  getDrawableDynamicFlagIsVisible(index: number): boolean
  getDrawableRenderOrders(): Int32Array
  getDrawableParentPartIndex(index: number): number
  getDrawableId(index: number): { getString(): { s: string } }
}
interface MotionManager { stopAllMotions(): void; _currentPriority: number; setReservePriority(value: number): void }
/** easy-live2d 0.4.x has no public mesh picking / expression reset API. Keep that adapter here. */
interface InteractionSprite {
  _pointerHandler?: { detach(): void }
  _textureLoader?: { _textures: Array<{ id: WebGLTexture; img: HTMLImageElement }> }
  _model: {
    getModel(): CubismModel
    getRenderer(): {
      getMvpMatrix(): { getArray(): Float32Array }
      getBindedTextures(): { getValue(index: number): WebGLTexture }
    }
    _motionManager: MotionManager
    _expressionManager: { stopAllMotions(): void; _expressionParameterValues: CubismVector<unknown>; _fadeWeights: CubismVector<number> }
    motionCtrl: { motions: { getValue(key: string): unknown } }
    _physics?: { evaluate(model: CubismModel, delta: number): void }
    _applyParameterOverrides(): void
  }
  getRenderViewport(): { x: number; y: number; width: number; height: number } | null
}

export function attachPetInteraction(sprite: Live2DSprite, canvas: HTMLCanvasElement, info: ModelActionsInfo) {
  const internal = sprite as unknown as InteractionSprite
  // The library's global tap handler ignores controls and also runs when our switch is off.
  // Window/model dragging and eye tracking are already handled by Live2DPet/App.
  internal._pointerHandler?.detach()
  const model = internal._model.getModel()
  const core = model.getModel()
  const gl = canvas.getContext('webgl2') ?? canvas.getContext('webgl')
  const pixel = new Uint8Array(4)
  // A visible pixel can still lie in a transparent triangle of an overlaid hair/skirt mesh.
  // Reuse the loaded images to make small alpha maps for choosing the actual visible part.
  const masks = new Map<WebGLTexture, { alpha: Uint8Array; width: number; height: number }>()
  for (const texture of internal._textureLoader?._textures ?? []) {
    try {
      const surface = document.createElement('canvas')
      surface.width = Math.min(1024, texture.img.naturalWidth)
      surface.height = Math.min(1024, texture.img.naturalHeight)
      const context = surface.getContext('2d', { willReadFrequently: true })
      if (!context) continue
      context.drawImage(texture.img, 0, 0, surface.width, surface.height)
      const rgba = context.getImageData(0, 0, surface.width, surface.height).data
      const alpha = new Uint8Array(surface.width * surface.height)
      for (let i = 0; i < alpha.length; i++) alpha[i] = rgba[i * 4 + 3]
      masks.set(texture.id, { alpha, width: surface.width, height: surface.height })
    } catch {
      // Cross-origin textures may not allow CPU sampling; composited alpha still filters the background.
    }
  }
  const declared = new Map<string, InteractionRegion>()
  const json = info.modelJSON as { HitAreas?: Array<{ Id: string; Name: string }> } | null
  for (const area of json?.HitAreas ?? []) {
    const region = regionFromName(area.Name)
    if (region) declared.set(area.Id, region)
  }
  const genericHead: boolean[] = []
  const regions = Array.from({ length: model.getDrawableCount() }, (_, i) => {
    const explicit = declared.get(model.getDrawableId(i).getString().s)
    if (explicit) { genericHead[i] = explicit === 'head'; return explicit }
    let part = model.getDrawableParentPartIndex(i)
    // Some exporters put art meshes in unnamed groups below the named body part.
    for (let depth = 0; part >= 0 && depth < core.parts.ids.length; depth++) {
      const id = core.parts.ids[part]
      const name = info.partNames?.[id] ?? id ?? ''
      const region = regionFromName(name)
      if (region) { genericHead[i] = /^(头|头部|head)$/i.test(name); return region }
      part = core.parts.parentIndices?.[part] ?? -1
    }
    return null
  })

  const hitAt = (clientX: number, clientY: number): InteractionRegion | null => {
    const rect = canvas.getBoundingClientRect()
    if (!gl || !rect.width || !rect.height || gl.isContextLost()) return null
    const px = (clientX - rect.left) * canvas.width / rect.width
    const py = (clientY - rect.top) * canvas.height / rect.height
    if (px < 0 || py < 0 || px >= canvas.width || py >= canvas.height) return null
    // Sample the composited alpha, including texture transparency and Cubism clipping masks.
    const framebuffer = gl.getParameter(gl.FRAMEBUFFER_BINDING)
    try {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null)
      gl.readPixels(Math.floor(px), canvas.height - 1 - Math.floor(py), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel)
    } finally {
      gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer)
    }
    if (pixel[3] < 20) return null
    const viewport = internal.getRenderViewport()
    if (!viewport?.width || !viewport.height) return null
    const matrix = internal._model.getRenderer().getMvpMatrix().getArray()
    const nx = 2 * (px - viewport.x) / viewport.width - 1 - matrix[12]
    const ny = 1 - 2 * (py - viewport.y) / viewport.height - matrix[13]
    const determinant = matrix[0] * matrix[5] - matrix[4] * matrix[1]
    if (Math.abs(determinant) < 1e-10) return null
    const x = (nx * matrix[5] - ny * matrix[4]) / determinant
    const y = (ny * matrix[0] - nx * matrix[1]) / determinant
    const orders = model.getDrawableRenderOrders()
    let topOrder = -Infinity
    let region: InteractionRegion | null = null
    let found = false
    let faceHit = false, topIsGenericHead = false
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
    for (let i = 0; i < regions.length; i++) {
      if (!model.getDrawableDynamicFlagIsVisible(i) || model.getDrawableOpacity(i) < 0.05) continue
      const vertices = model.getDrawableVertices(i)
      for (let v = 0; v < vertices.length; v += 2) {
        minX = Math.min(minX, vertices[v]); maxX = Math.max(maxX, vertices[v])
        minY = Math.min(minY, vertices[v + 1]); maxY = Math.max(maxY, vertices[v + 1])
      }
      if (orders[i] < topOrder && regions[i] !== 'face') continue
      const indices = model.getDrawableVertexIndices(i)
      const texture = masks.size ? internal._model.getRenderer().getBindedTextures().getValue(model.getDrawableTextureIndex(i)) : null
      const mask = texture ? masks.get(texture) : undefined
      for (let j = 0; j < indices.length; j += 3) {
        const a = indices[j] * 2, b = indices[j + 1] * 2, c = indices[j + 2] * 2
        if (!pointInTriangle(x, y, vertices[a], vertices[a + 1], vertices[b], vertices[b + 1], vertices[c], vertices[c + 1])) continue
        if (mask) {
          const area = (vertices[b] - vertices[a]) * (vertices[c + 1] - vertices[a + 1]) -
            (vertices[b + 1] - vertices[a + 1]) * (vertices[c] - vertices[a])
          const wa = ((vertices[b] - x) * (vertices[c + 1] - y) - (vertices[b + 1] - y) * (vertices[c] - x)) / area
          const wb = ((vertices[c] - x) * (vertices[a + 1] - y) - (vertices[c + 1] - y) * (vertices[a] - x)) / area
          const wc = 1 - wa - wb
          const uv = model.getDrawableVertexUvs(i)
          const u = wa * uv[a] + wb * uv[b] + wc * uv[c]
          const v = 1 - (wa * uv[a + 1] + wb * uv[b + 1] + wc * uv[c + 1])
          const tx = Math.max(0, Math.min(mask.width - 1, Math.floor(u * mask.width)))
          const ty = Math.max(0, Math.min(mask.height - 1, Math.floor(v * mask.height)))
          if (mask.alpha[ty * mask.width + tx] < 20) continue
        }
        found = true
        if (regions[i] === 'face') faceHit = true
        if (orders[i] >= topOrder) {
          topOrder = orders[i]
          region = regions[i]
          topIsGenericHead = genericHead[i]
        }
        break
      }
    }
    if (faceHit && region === 'head' && topIsGenericHead) return 'face'
    return found ? region ?? regionFromPosition((x - minX) / (maxX - minX), (maxY - y) / (maxY - minY)) : null
  }

  // Project the deformed meshes after rendering, so scale, pan and head turns share one anchor.
  const headPosition = (): { x: number; y: number } | null => {
    const viewport = internal.getRenderViewport()
    const rect = canvas.getBoundingClientRect()
    if (!viewport || !rect.width || !rect.height) return null
    const matrix = internal._model.getRenderer().getMvpMatrix().getArray()
    const bounds = [
      { minX: Infinity, maxX: -Infinity, minY: Infinity },
      { minX: Infinity, maxX: -Infinity, minY: Infinity },
      { minX: Infinity, maxX: -Infinity, minY: Infinity }
    ]
    for (let i = 0; i < regions.length; i++) {
      if (!model.getDrawableDynamicFlagIsVisible(i) || model.getDrawableOpacity(i) < 0.05) continue
      const group = regions[i] === 'face' ? 2 : regions[i] === 'head' ? 1 : 0
      const vertices = model.getDrawableVertices(i)
      const b = bounds[group]
      for (let v = 0; v < vertices.length; v += 2) {
        const nx = matrix[0] * vertices[v] + matrix[4] * vertices[v + 1] + matrix[12]
        const ny = matrix[1] * vertices[v] + matrix[5] * vertices[v + 1] + matrix[13]
        const x = rect.left + (viewport.x + (nx + 1) * viewport.width / 2) * rect.width / canvas.width
        const y = rect.top + (viewport.y + (1 - ny) * viewport.height / 2) * rect.height / canvas.height
        b.minX = Math.min(b.minX, x); b.maxX = Math.max(b.maxX, x); b.minY = Math.min(b.minY, y)
      }
    }
    const face = bounds[2], head = bounds[1], fallback = bounds[0]
    const center = Number.isFinite(face.minX) ? face : Number.isFinite(head.minX) ? head : fallback
    const crown = Math.min(head.minY, face.minY)
    const x = (center.minX + center.maxX) / 2
    const y = Number.isFinite(crown) ? crown : fallback.minY
    return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null
  }

  const parameterIndex = new Map(core.parameters.ids.map((id, i) => [id, i]))
  const raisedHandRig = hasRaisedHandRig(new Set(core.parameters.ids))
  const hasJointRig = parameterIndex.has('ParamBodyAngleX')
  const hasFaceRig = parameterIndex.has('ParamMouthForm') || parameterIndex.has('EyeSmile')
  const overridden = new Set<string>()
  let reaction: { region: InteractionRegion; variant: number; started: number; values: Float32Array; parts: Float32Array; from: InteractionPose | null } | null = null
  const currentPose = (now: number): InteractionPose | null => {
    if (!reaction) return null
    const elapsed = now - reaction.started
    const pose = interactionPose(reaction.region, elapsed, reaction.variant)
    if (reaction.from && elapsed < 320) {
      const blend = smoothStep(elapsed / 320)
      for (const key of Object.keys(pose) as Array<keyof InteractionPose>) {
        pose[key] = reaction.from[key] * (1 - blend) + pose[key] * blend
      }
    }
    return pose
  }
  const applyJoints = (pose: InteractionPose): void => {
    if (!reaction) return
    const drive = (id: string, amount: number, target?: number): void => {
      const index = parameterIndex.get(id)
      if (index === undefined) return
      const base = reaction!.values[index]
      const min = core.parameters.minimumValues[index], max = core.parameters.maximumValues[index]
      const destination = target ?? (amount < 0 ? min : max)
      const value = base + (destination - base) * Math.min(1, Math.abs(amount))
      sprite.setParameterValueById(id, Math.max(min, Math.min(max, value)))
      overridden.add(id)
    }
    drive('ParamBodyAngleX', pose.bodyX); drive('ParamBodyAngleY', pose.bodyY); drive('ParamBodyAngleZ', pose.bodyZ)
    drive('HipAngleZ', pose.hip); drive('HipAngleX', -pose.bodyX * 0.3); drive('LEGAngleZ2', pose.legs)
    const handChannels: Record<string, number> = {
      ShoulderY: pose.shoulder, ShoulderZ: pose.bodyZ * 0.5,
      LArm: -pose.arm, LForearm: pose.forearm, LWrist: pose.wrist, RArm: pose.rightArm
    }
    if (raisedHandRig) Object.assign(handChannels, {
      Movement2: pose.handPose, Param62: pose.arm, Param59: pose.handPose * 0.55,
      Param60: pose.forearm, Param61: pose.wrist
    })
    for (const [id, amount] of Object.entries(adaptHandChannels(handChannels, raisedHandRig))) drive(id, amount)
    drive('ParamMouthForm', pose.smile); drive('EyeSmile', pose.smile * 0.6)
    drive('ParamEyeLOpen', Math.max(pose.blink, pose.blinkLeft), 0)
    drive('ParamEyeROpen', Math.max(pose.blink, pose.blinkRight), 0)
    if (raisedHandRig) {
      // This rig uses tracking inputs upstream of its physics chains. Feed those too,
      // so hair, clothes and the rest of the body follow the authored joint motion.
      drive('AngleX', pose.angleX / 30); drive('AngleY', pose.angleY / 30); drive('AngleZ', pose.angleZ / 30)
      drive('PositionX', pose.bodyX); drive('PositionY', pose.bodyY); drive('PositionZ', pose.bodyZ)
    }
  }
  const physics = internal._model._physics
  const evaluatePhysics = physics?.evaluate
  if (physics && evaluatePhysics) {
    physics.evaluate = function (physicsModel, delta): void {
      // easy-live2d restores base parameters before physics and normally applies overrides
      // only afterwards. Apply them here as well so secondary motion sees the gesture.
      if (reaction) internal._model._applyParameterOverrides()
      evaluatePhysics.call(this, physicsModel, delta)
    }
  }
  let lastClick = -Infinity
  let manualExpression: string | undefined
  let timer = 0
  let pointer: { id: number; x: number; y: number; region: InteractionRegion; moved: boolean } | null = null
  const stopMotions = (): void => {
    const manager = internal._model._motionManager
    manager.stopAllMotions()
    manager._currentPriority = 0
    manager.setReservePriority(0)
  }
  const clearExpressions = (): void => {
    const manager = internal._model._expressionManager
    manager.stopAllMotions()
    manager._expressionParameterValues.clear()
    manager._fadeWeights.clear()
  }
  const cancel = (): void => {
    window.clearTimeout(timer)
    pointer = null
    if (!reaction) return
    stopMotions()
    clearExpressions()
    core.parameters.values.set(reaction.values)
    core.parts.opacities.set(reaction.parts)
    for (const id of overridden) sprite.setParameterValueById(id, 0, 0)
    overridden.clear()
    model.saveParameters()
    reaction = null
    // Release our temporary override instead of fixing the model's angle at zero forever.
    sprite.setParameterValueById('ParamAngleZ', 0, 0)
    if (manualExpression) sprite.setExpression({ expressionId: manualExpression })
  }
  const react = (region: InteractionRegion): void => {
    const now = performance.now()
    if (now - lastClick < INTERACTION_COOLDOWN) return
    lastClick = now
    const from = currentPose(now)
    const previous = reaction
    window.clearTimeout(timer)
    // Saved parameters exclude expression/physics overlays; restoring them avoids double-applying a manual expression.
    const saved = model._savedParameters
    const values = previous?.values ?? new Float32Array(core.parameters.values)
    if (!previous) for (let i = 0; i < Math.min(values.length, saved.getSize()); i++) values[i] = saved.at(i)
    const variant = useInteractionStore.getState().react(region)
    reaction = { region, variant, started: now, values, parts: previous?.parts ?? new Float32Array(core.parts.opacities), from }
    const selected = chooseInteractionActions(region, info.expressions, info.motions)
    try {
      stopMotions()
      clearExpressions()
      if (!hasFaceRig && selected.expression) sprite.setExpression({ expressionId: selected.expression.name })
      const motion = selected.motion
      // Only use assets already loaded by the model, so a cancelled reaction cannot start later after a fetch.
      if (!hasJointRig && !raisedHandRig && motion?.group !== undefined && motion.index !== undefined &&
          internal._model.motionCtrl.motions.getValue(`${motion.group}_${motion.index}`)) {
        void sprite.startMotion({ group: motion.group, no: motion.index, priority: Priority.Force })
          .catch(() => { /* The distinct pose below remains available. */ })
      }
    } catch {
      // Unsupported animation metadata must not stop offline dialogue or the fallback pose.
    }
    timer = window.setTimeout(cancel, INTERACTION_DURATION)
  }
  const onDown = (event: PointerEvent): void => {
    if (event.button !== 0 || !event.isPrimary || !usePetStore.getState().interactionEnabled) return
    const region = hitAt(event.clientX, event.clientY)
    if (!region) return
    pointer = { id: event.pointerId, x: event.clientX, y: event.clientY, region, moved: false }
  }
  const onMove = (event: PointerEvent): void => {
    if (pointer?.id === event.pointerId && Math.hypot(event.clientX - pointer.x, event.clientY - pointer.y) >= CLICK_DISTANCE) {
      pointer.moved = true
    }
    if (event.target === canvas) {
      canvas.style.cursor = usePetStore.getState().interactionEnabled && hitAt(event.clientX, event.clientY) ? 'pointer' : ''
    }
  }
  const onUp = (event: PointerEvent): void => {
    const down = pointer
    pointer = null
    if (!down || down.id !== event.pointerId || event.button !== 0 || down.moved ||
        !usePetStore.getState().interactionEnabled || event.target !== canvas ||
        Math.hypot(event.clientX - down.x, event.clientY - down.y) >= CLICK_DISTANCE) return
    if (hitAt(event.clientX, event.clientY) === down.region) react(down.region)
  }
  const onCancel = (): void => { pointer = null }
  const onBlur = (): void => { cancel(); useInteractionStore.getState().clear() }
  const unsubscribe = usePetStore.subscribe((state, previous) => {
    if (state.interactionEnabled !== previous.interactionEnabled || state.scale !== previous.scale ||
        state.offsetX !== previous.offsetX || state.offsetY !== previous.offsetY || state.locked !== previous.locked) {
      cancel()
      canvas.style.cursor = ''
      useInteractionStore.getState().clear()
    }
  })
  canvas.addEventListener('pointerdown', onDown)
  window.addEventListener('pointermove', onMove)
  window.addEventListener('pointerup', onUp)
  window.addEventListener('pointercancel', onCancel)
  window.addEventListener('blur', onBlur)
  const entry = { hitAt, cancel }
  petInteractionRef.current = entry
  return {
    cancel,
    headPosition,
    applyJoints,
    setManualExpression: (name?: string): void => { manualExpression = name },
    getManualExpression: (): string | undefined => manualExpression,
    resetExpressions: (): void => { manualExpression = undefined; clearExpressions() },
    pose: () => {
      if (reaction && performance.now() - reaction.started >= INTERACTION_DURATION) cancel()
      return currentPose(performance.now())
    },
    destroy: (): void => {
      cancel()
      if (physics && evaluatePhysics) physics.evaluate = evaluatePhysics
      unsubscribe()
      canvas.removeEventListener('pointerdown', onDown)
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onCancel)
      window.removeEventListener('blur', onBlur)
      if (petInteractionRef.current === entry) petInteractionRef.current = null
      useInteractionStore.getState().clear()
    }
  }
}
