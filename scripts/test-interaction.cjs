// Run with: node scripts/test-interaction.cjs
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const ts = require('typescript')
const root = path.resolve(__dirname, '..')
const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'companion-interaction-'))
const cache = new Map()
function load(relativePath) {
  const filename = path.resolve(root, relativePath)
  if (cache.has(filename)) return cache.get(filename).exports
  const module = { exports: {} }
  cache.set(filename, module)
  const source = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }
  }).outputText
  const localRequire = (name) => {
    if (name === 'electron') return { app: { isPackaged: false, getAppPath: () => fixture } }
    if (name === 'easy-live2d') return { Priority: { Force: 3 } }
    if (name.startsWith('.')) return load(path.resolve(path.dirname(filename), name + '.ts'))
    return require(name)
  }
  new Function('require', 'module', 'exports', source)(localRequire, module, module.exports)
  return module.exports
}
let checks = 0
function test(name, run) { run(); checks++; console.log(`PASS ${name}`) }
try {
  const presets = load('src/renderer/src/lib/petInteraction.ts')
  const { CHOREOGRAPHIES, createChoreographySelector } = load('src/renderer/src/lib/interactionChoreography.ts')
  test('fifteen performances have continuous bounded channels and distinct full-body timing', () => {
    let count = 0
    for (const [region, variants] of Object.entries(CHOREOGRAPHIES)) {
      assert.equal(variants.length, 3)
      const traces = []
      for (const [variant, performance] of variants.entries()) {
        count++
        for (const points of Object.values(performance.tracks)) {
          assert.deepEqual(points[0], [0, 0])
          assert.deepEqual(points.at(-1), [1, 0])
          for (let i = 1; i < points.length; i++) assert(points[i][0] > points[i - 1][0])
        }
        let previous = presets.interactionPose(region, 0, variant)
        const trace = []
        for (let ms = 10; ms <= presets.INTERACTION_DURATION; ms += 10) {
          const pose = presets.interactionPose(region, ms, variant)
          for (const [key, value] of Object.entries(pose)) {
            const limit = key === 'x' || key === 'y' ? 10 : key.startsWith('angle') ? 30 : 1
            assert(Number.isFinite(value) && Math.abs(value) <= limit, `${region}/${variant} ${key} bounds`)
            assert(Math.abs(value - previous[key]) < 1.1, `${region}/${variant} ${key} discontinuity`)
            if (/blink|smile|Weight|mouthOpen|handPose/.test(key)) assert(value >= 0)
          }
          if (ms % 500 === 0) trace.push([pose.angleX, pose.angleY, pose.bodyX, pose.hip, pose.wrist])
          previous = pose
        }
        assert(Object.values(previous).every(value => Math.abs(value) < 1e-10))
        for (const ms of [1, presets.INTERACTION_DURATION - 1]) {
          assert(Object.values(presets.interactionPose(region, ms, variant)).every(value => Math.abs(value) < 0.00001))
        }
        traces.push(JSON.stringify(trace))
      }
      assert.equal(new Set(traces).size, 3, `${region} variants must change the movement sequence`)
    }
    assert.equal(count, 15)
  })
  test('shuffle bags cover each region before recycling and never repeat across bag boundaries', () => {
    for (const random of [() => 0, () => 0.999, () => 0.5, Math.random]) {
      const select = createChoreographySelector(random)
      for (const region of Object.keys(CHOREOGRAPHIES)) {
        const sequence = Array.from({ length: 30 }, () => select(region))
        for (let i = 0; i < sequence.length; i += 3) assert.equal(new Set(sequence.slice(i, i + 3)).size, 3)
        assert(sequence.every((value, i) => i === 0 || value !== sequence[i - 1]))
      }
    }
  })
  test('wink, double bounce and beckoning are timed gestures with independent facial channels', () => {
    const wink = presets.interactionPose('face', presets.INTERACTION_DURATION * 0.37, 1)
    assert(wink.blinkLeft === 1 && wink.blink === 0 && wink.blinkRight === 0)
    assert(wink.smile > 0.8 && wink.gazeWeight > 0.8)
    const bounce = t => presets.interactionPose('feet', presets.INTERACTION_DURATION * t, 1).y
    assert(bounce(0.27) === -10 && bounce(0.42) === 3 && bounce(0.57) === -8)
    const beckon = t => presets.interactionPose('hand', presets.INTERACTION_DURATION * t, 2).wrist
    assert(beckon(0.4) < -0.9 && beckon(0.5) > 0.7 && beckon(0.6) < -0.8)
  })
  test('mesh triangles accept either winding, reject empty space and degeneracy', () => {
    assert(presets.pointInTriangle(0.2, 0.2, 0, 0, 1, 0, 0, 1))
    assert(presets.pointInTriangle(0.2, 0.2, 0, 1, 1, 0, 0, 0))
    assert(!presets.pointInTriangle(0.8, 0.8, 0, 0, 1, 0, 0, 1))
    assert(!presets.pointInTriangle(0, 0, 0, 0, 1, 1, 2, 2))
  })
  test('regional presets choose semantic animations, excluding return / outfit actions', () => {
    const motions = ['举手切默认手', '脱衣挥手', '默认手切举手'].map(file => ({ kind: 'motion', name: 'Extra', file }))
    assert.equal(presets.chooseInteractionActions('hand', [], motions).motion.file, '默认手切举手')
    assert.equal(presets.chooseInteractionActions('hand', [], motions.slice(0, 2)).motion, undefined)
    assert.equal(presets.regionFromName('右手'), 'hand')
    assert.equal(presets.regionFromName('LeftEye'), 'face')
    assert.equal(presets.regionFromName('前发'), 'head')
    assert.equal(presets.regionFromName('左腿'), 'feet')
    const poses = Object.keys(presets.INTERACTIONS).map(region => {
      for (const n of Object.values(presets.interactionPose(region, presets.INTERACTION_DURATION))) assert(Math.abs(n) < 1e-10)
      return JSON.stringify(presets.interactionPose(region, 700))
    })
    assert.equal(new Set(poses).size, 5)
  })

  test('long gestures stay continuous, start and finish gently, and lead with the shoulder', () => {
    assert(presets.INTERACTION_DURATION >= 5000)
    for (const region of Object.keys(presets.INTERACTIONS)) {
      let previous = presets.interactionPose(region, 0)
      assert(Object.values(previous).every(value => value === 0))
      for (let ms = 10; ms <= presets.INTERACTION_DURATION; ms += 10) {
        const pose = presets.interactionPose(region, ms)
        for (const key of Object.keys(pose)) {
          assert(Number.isFinite(pose[key]))
          assert(Math.abs(pose[key] - previous[key]) < 1.1, `${region} ${key} jumps at ${ms}ms`)
        }
        previous = pose
      }
      const start = presets.interactionPose(region, 1)
      const end = presets.interactionPose(region, presets.INTERACTION_DURATION - 1)
      assert([...Object.values(start), ...Object.values(end)].every(value => Math.abs(value) < 0.00001))
    }
    const earlyHand = presets.interactionPose('hand', 500)
    assert(earlyHand.shoulder > 0 && earlyHand.handPose === 0)
    assert(presets.interactionPose('hand', 2200).handPose > 0.9)
  })
  test('speech stays above the crown and clamps long text at window edges', () => {
    const { placeSpeechBubble } = load('src/renderer/src/lib/speechPosition.ts')
    const bubble = { width: 200, height: 60 }, viewport = { width: 420, height: 520 }
    assert.deepEqual(placeSpeechBubble({ x: 210, y: 200 }, bubble, viewport), { left: 186, top: 126, tailX: 24 })
    assert.deepEqual(placeSpeechBubble({ x: -40, y: -20 }, bubble, viewport), { left: 8, top: 8, tailX: 18 })
    assert.deepEqual(placeSpeechBubble({ x: 470, y: 600 }, bubble, viewport), { left: 212, top: 452, tailX: 182 })
  })

  test('chat docks beside the pet, switches sides near screen edges and fits multi-monitor work areas', () => {
    const { placeChatWindow } = load('src/main/chatPlacement.ts')
    const work = { x: 0, y: 0, width: 1440, height: 900 }
    const overlaps = (a, b) => a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y
    for (const pet of [{ x: 100, y: 250, width: 420, height: 520 }, { x: 1000, y: 380, width: 420, height: 520 }]) {
      const chat = placeChatWindow(pet, work)
      assert(!overlaps(chat, pet))
      assert(chat.x >= 8 && chat.x + chat.width <= 1432 && chat.y >= 8 && chat.y + chat.height <= 892)
      assert.equal(chat.width, 360)
    }
    const pet = { x: -500, y: 100, width: 420, height: 520 }
    const chat = placeChatWindow(pet, { x: -1440, y: 0, width: 1440, height: 900 })
    assert(!overlaps(chat, pet) && chat.x < pet.x && chat.x >= -1432)
    const above = placeChatWindow({ x: 20, y: 600, width: 420, height: 520 }, { x: 0, y: 0, width: 480, height: 1200 })
    assert(above.y + above.height < 600 && above.x >= 8 && above.x + above.width <= 472)
  })

  test('each region reaches a distinct near-limit peak without exceeding its normalized range', () => {
    const dominant = { head: ['angleY', 30], face: ['angleZ', 30], hand: ['arm', 1], body: ['bodyX', 1], feet: ['legs', 1] }
    for (const [region, [joint, limit]] of Object.entries(dominant)) {
      let peak = 0
      for (let ms = 0; ms <= presets.INTERACTION_DURATION; ms += 5) {
        const pose = presets.interactionPose(region, ms)
        peak = Math.max(peak, Math.abs(pose[joint]) / limit)
        for (const [key, value] of Object.entries(pose)) {
          if (key === 'x' || key === 'y') continue
          assert(Math.abs(value) <= (key.startsWith('angle') ? 30 : 1), `${region} exceeds ${key} range`)
        }
      }
      assert(peak >= 0.94 && peak < 1, `${region} should approach its limit with a little headroom`)
    }
    const raising = presets.interactionPose('hand', 1400)
    assert(raising.shoulder > 0 && raising.arm > raising.forearm && raising.wrist === 0)
  })

  const modelDir = path.join(fixture, 'src/renderer/public/models/Test')
  fs.mkdirSync(path.join(modelDir, 'Animation'), { recursive: true })
  const write = (file, data) => fs.writeFileSync(path.join(modelDir, file), JSON.stringify(data))
  write('test.model3.json', { FileReferences: { DisplayInfo: 'test.cdi3.json' } })
  write('test.cdi3.json', { Parts: [{ Id: 'Part1', Name: '头' }, { Id: 'Part2', Name: '右手' }] })
  write('脸红.exp3.json', {})
  write('Animation/默认手切举手.motion3.json', {})
  const { discoverModelActions } = load('src/main/services/models.ts')
  const info = discoverModelActions('models/Test/test.model3.json')
  test('discover undeclared model actions and optional part names without modifying assets', () => {
    assert.equal(info.partNames.Part2, '右手')
    assert.equal(info.motions[0].file, 'Animation/默认手切举手.motion3.json')
    assert.equal(info.expressions[0].name, '脸红')
    assert.equal(JSON.parse(fs.readFileSync(path.join(modelDir, 'test.model3.json'))).FileReferences.Motions, undefined)
    write('test.model3.json', { FileReferences: { DisplayInfo: '../outside.cdi3.json' } })
    fs.writeFileSync(path.join(modelDir, '../outside.cdi3.json'), JSON.stringify({ Parts: [{ Id: 'Outside', Name: 'outside' }] }))
    assert.deepEqual(Object.keys(discoverModelActions('models/Test/test.model3.json').partNames), [])
  })

  function eventHub() {
    const listeners = new Map()
    return {
      addEventListener(name, fn) { if (!listeners.has(name)) listeners.set(name, new Set()); listeners.get(name).add(fn) },
      removeEventListener(name, fn) { listeners.get(name)?.delete(fn) },
      emit(name, event) { for (const fn of listeners.get(name) ?? []) fn(event) }
    }
  }
  let now = 0, nextTimer = 0
  const timers = new Map()
  global.window = { ...eventHub(), setTimeout: fn => { timers.set(++nextTimer, fn); return nextTimer }, clearTimeout: id => timers.delete(id) }
  Object.defineProperty(global, 'performance', { configurable: true, value: { now: () => now } })
  const pet = load('src/renderer/src/store/pet.ts').usePetStore
  const messages = load('src/renderer/src/store/interaction.ts').useInteractionStore
  let alpha = 255
  const gl = { FRAMEBUFFER_BINDING: 1, FRAMEBUFFER: 2, RGBA: 3, UNSIGNED_BYTE: 4,
    isContextLost: () => false, getParameter: () => null, bindFramebuffer() {}, readPixels: (...args) => { args.at(-1)[3] = alpha } }
  const canvas = { ...eventHub(), style: {}, width: 200, height: 200,
    getContext: () => gl, getBoundingClientRect: () => ({ left: 0, top: 0, width: 200, height: 200 }) }
  const vector = values => ({ getSize: () => values.length, at: i => values[i], clear() { values.length = 0 } })
  const baseValues = [10, 20, 0, 0, 1]
  let saved = [...baseValues], viewport = { x: 0, y: 0, width: 200, height: 200 }
  const core = { parameters: {
    ids: ['TestExpression', 'TestMotion', 'ParamBodyAngleZ', 'ShoulderY', 'ParamEyeLOpen'],
    values: new Float32Array(saved), minimumValues: new Float32Array([-100, -100, -30, -30, 0]),
    maximumValues: new Float32Array([100, 100, 30, 30, 1])
  }, parts: { ids: ['Part1'], opacities: new Float32Array([1]) } }
  const model = {
    getModel: () => core, get _savedParameters() { return vector(saved) }, saveParameters() { saved = [...core.parameters.values] },
    getDrawableCount: () => 1, getDrawableVertices: () => new Float32Array([-1, -1, 1, -1, 1, 1, -1, 1]),
    getDrawableVertexIndices: () => new Uint16Array([0, 1, 2, 0, 2, 3]), getDrawableOpacity: () => 1,
    getDrawableDynamicFlagIsVisible: () => true, getDrawableRenderOrders: () => [1],
    getDrawableParentPartIndex: () => 0, getDrawableId: () => ({ getString: () => ({ s: 'ArtMesh1' }) })
  }
  let stopCount = 0, detached = false
  const overrides = new Map()
  let physicsShoulder = null
  const originalPhysics = () => { physicsShoulder = core.parameters.values[3] }
  const sprite = {
    _pointerHandler: { detach() { detached = true } }, getRenderViewport: () => viewport,
    _model: { getModel: () => model, getRenderer: () => ({ getMvpMatrix: () => ({ getArray: () => [1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1] }) }),
      _motionManager: { stopAllMotions() { stopCount++ }, _currentPriority: 0, setReservePriority() {} },
      _expressionManager: { stopAllMotions() {}, _expressionParameterValues: vector([]), _fadeWeights: vector([]) },
      motionCtrl: { motions: { getValue: () => ({}) } },
      _physics: { evaluate: originalPhysics },
      _applyParameterOverrides() {
        for (const [id, { value, weight }] of overrides) {
          const index = core.parameters.ids.indexOf(id)
          if (index >= 0 && weight !== 0) core.parameters.values[index] = value
        }
      }
    },
    setExpression() { core.parameters.values[0] = 99 },
    setParameterValueById(id, value, weight) { overrides.set(id, { value, weight }) },
    startMotion() { core.parameters.values[1] = 88; return Promise.resolve() }
  }
  const adapter = load('src/renderer/src/lib/live2dInteraction.ts').attachPetInteraction(sprite, canvas, info)
  function event(x = 100, y = 100, button = 0) { return { clientX: x, clientY: y, button, isPrimary: true, pointerId: 1, target: canvas } }
  function click() { canvas.emit('pointerdown', event()); window.emit('pointerup', event()) }
  test('visible mesh picking follows model viewport scaling and panning; alpha rejects blank pixels', () => {
    assert(detached)
    assert.equal(adapter.pose(), null)
    assert.equal(presets.petInteractionRef.current.hitAt(100, 100), 'head')
    assert.deepEqual(adapter.headPosition(), { x: 100, y: 0 })
    alpha = 0
    assert.equal(presets.petInteractionRef.current.hitAt(100, 100), null)
    alpha = 255
    viewport = { x: 50, y: 50, width: 100, height: 100 }
    assert.equal(presets.petInteractionRef.current.hitAt(20, 20), null)
    assert.equal(presets.petInteractionRef.current.hitAt(100, 100), 'head')
    assert.deepEqual(adapter.headPosition(), { x: 100, y: 50 })
    viewport = { x: 0, y: 0, width: 200, height: 200 }
  })
  test('off / right click / moved-out-and-back gesture do not speak; enabled click responds instantly', () => {
    click(); assert.equal(messages.getState().message, null)
    pet.getState().setInteractionEnabled(true)
    canvas.emit('pointerdown', event(100, 100, 2)); window.emit('pointerup', event(100, 100, 2))
    assert.equal(messages.getState().message, null)
    canvas.emit('pointerdown', event()); window.emit('pointermove', event(120, 100)); window.emit('pointerup', event())
    assert.equal(messages.getState().message, null)
    click()
    assert.equal(messages.getState().message.region, 'head')
    const first = messages.getState().message.id
    click(); assert.equal(messages.getState().message.id, first)
  })
  test('reactions restore base parameters, clear only the matching message and respect cancellation', () => {
    assert.equal(core.parameters.values[0], 99)
    now = 800
    assert.notEqual(adapter.pose().angleZ, 0)
    adapter.applyJoints(adapter.pose())
    assert(overrides.get('ShoulderY').value < 0)
    assert(overrides.get('ParamEyeLOpen').value >= 0 && overrides.get('ParamEyeLOpen').value <= 1)
    sprite._model._physics.evaluate(model, 1 / 60)
    assert(physicsShoulder < 0, 'secondary physics receives the gesture before evaluation')
    const oldId = messages.getState().message.id
    const beforeRetarget = adapter.pose()
    const previousVariant = messages.getState().message.variant
    click()
    const message = messages.getState().message
    assert.notEqual(message.variant, previousVariant)
    assert.equal(message.actionLabel, CHOREOGRAPHIES.head[message.variant].label)
    assert.equal(message.text, CHOREOGRAPHIES.head[message.variant].phrase)
    assert.deepEqual(adapter.pose(), beforeRetarget, 'rapid clicks keep the displayed pose at the transition')
    now += 1
    assert(Math.abs(adapter.pose().angleZ - beforeRetarget.angleZ) < 0.001)
    messages.getState().clear(oldId)
    assert(messages.getState().message)
    pet.getState().setInteractionEnabled(false)
    assert.equal(adapter.pose(), null)
    assert.deepEqual([...core.parameters.values], baseValues)
    assert.equal(overrides.get('ParamAngleZ').weight, 0)
    assert.equal(overrides.get('ShoulderY').weight, 0)
    assert.equal(overrides.get('ParamEyeLOpen').weight, 0)
    assert.equal(messages.getState().message, null)
    assert(stopCount > 0)
    pet.getState().setInteractionEnabled(true)
    now = 1600; click()
    for (const callback of [...timers.values()]) callback()
    assert.equal(adapter.pose(), null)
    assert.deepEqual([...core.parameters.values], baseValues)
    adapter.destroy()
    assert.equal(sprite._model._physics.evaluate, originalPhysics)
    assert.equal(presets.petInteractionRef.current, null)
    now = 3000; click(); assert.equal(messages.getState().message, null)
  })
  test('face skin remains clickable below a generic head overlay, while hair stays a head target', () => {
    core.parts.ids = ['Face', 'Overlay']
    core.parts.opacities = new Float32Array([1, 1])
    model.getDrawableCount = () => 2
    model.getDrawableParentPartIndex = i => i
    model.getDrawableRenderOrders = () => [1, 2]
    const attach = load('src/renderer/src/lib/live2dInteraction.ts').attachPetInteraction
    const headOverlay = attach(sprite, canvas, { ...info, partNames: { Face: '脸底', Overlay: '头' } })
    assert.equal(presets.petInteractionRef.current.hitAt(100, 100), 'face')
    headOverlay.destroy()
    const hairOverlay = attach(sprite, canvas, { ...info, partNames: { Face: '脸底', Overlay: '前发' } })
    assert.equal(presets.petInteractionRef.current.hitAt(100, 100), 'head')
    hairOverlay.destroy()
  })
  test('switching from hand to body blends every joint and restores the original base', () => {
    model.getDrawableCount = () => 1
    core.parts.ids = ['Unnamed']
    const blend = load('src/renderer/src/lib/live2dInteraction.ts').attachPetInteraction(sprite, canvas, { modelJSON: null, expressions: [], motions: [] })
    now = 4000
    canvas.emit('pointerdown', event(20, 100)); window.emit('pointerup', event(20, 100))
    assert.equal(messages.getState().message.region, 'hand')
    now += 1800
    const handPose = blend.pose()
    blend.applyJoints(handPose)
    assert(handPose.handPose > 0.9)
    canvas.emit('pointerdown', event()); window.emit('pointerup', event())
    assert.equal(messages.getState().message.region, 'body')
    assert.deepEqual(blend.pose(), handPose)
    now += 1
    assert(Math.abs(blend.pose().arm - handPose.arm) < 0.001)
    now += 320
    assert.equal(blend.pose().handPose, 0)
    blend.cancel()
    assert.deepEqual([...core.parameters.values], baseValues)
    blend.destroy()
  })
  test('near-limit poses clamp to actual rig bounds and release all temporary overrides', () => {
    const ids = ['ParamBodyAngleX', 'ParamBodyAngleY', 'ParamBodyAngleZ', 'ShoulderY', 'ShoulderZ',
      'HipAngleX', 'HipAngleZ', 'LEGAngleZ2', 'LArm', 'LForearm', 'LWrist', 'RArm', 'ParamMouthForm',
      'EyeSmile', 'ParamEyeLOpen', 'ParamEyeROpen', 'AngleX', 'AngleY', 'AngleZ', 'PositionX', 'PositionY',
      'PositionZ', 'Movement2', 'Param56', 'Param57', 'Param62', 'Param59', 'Param60', 'Param61']
    core.parameters.ids = ids
    const min = ids.map(id => /Open|Movement2|Param56|Param57/.test(id) ? 0 : /Angle|Shoulder|Position/.test(id) ? -12 : -1)
    const max = ids.map(id => /Angle|Shoulder|Position/.test(id) ? 18 : 1)
    core.parameters.minimumValues = new Float32Array(min)
    core.parameters.maximumValues = new Float32Array(max)
    saved = ids.map((_, i) => min[i] + (max[i] - min[i]) * 0.4)
    core.parameters.values = new Float32Array(saved)
    const baseline = [...core.parameters.values]
    overrides.clear()
    const rig = load('src/renderer/src/lib/live2dInteraction.ts').attachPetInteraction(sprite, canvas, { modelJSON: null, expressions: [], motions: [] })
    now += 1000
    click()
    for (const region of Object.keys(presets.INTERACTIONS)) {
      for (let variant = 0; variant < CHOREOGRAPHIES[region].length; variant++) {
      for (let ms = 0; ms <= presets.INTERACTION_DURATION; ms += 20) {
        rig.applyJoints(presets.interactionPose(region, ms, variant))
        for (const [id, { value }] of overrides) {
          const i = ids.indexOf(id)
          assert(Number.isFinite(value) && value >= min[i] && value <= max[i], `${region} exceeds actual ${id} bounds`)
        }
      }
      }
    }
    rig.applyJoints(presets.interactionPose('hand', 2200))
    assert(overrides.get('Param62').value > 0.9 && overrides.get('Param60').value > 0.9)
    rig.cancel()
    assert.deepEqual([...core.parameters.values], baseline)
    for (const { weight } of overrides.values()) assert.equal(weight, 0)
    rig.destroy()
  })
  console.log(`${checks} interaction checks passed`)
} finally {
  assert.equal(path.dirname(path.resolve(fixture)), path.resolve(os.tmpdir()))
  assert(path.basename(fixture).startsWith('companion-interaction-'))
  fs.rmSync(fixture, { recursive: true, force: true })
}
