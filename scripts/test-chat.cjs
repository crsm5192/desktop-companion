const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const ts = require('typescript')
const root = path.resolve(__dirname, '..')
const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'companion-chat-'))
const cache = new Map()
let hooks
let clock = 0
const timers = new Map()
let nextTimer = 0
const electron = { app: { isPackaged: false, getPath: () => fixture, getAppPath: () => root } }
const react = {
  useState: value => hooks.useState(value), useRef: value => hooks.useRef(value),
  useEffect: callback => hooks.useEffect(callback), useCallback: callback => callback
}
function load(file) {
  const filename = path.resolve(root, file)
  if (cache.has(filename)) return cache.get(filename).exports
  const module = { exports: {} }; cache.set(filename, module)
  const source = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  const requireLocal = name => name === 'electron' ? electron : name === 'react' ? react : name === 'easy-live2d' ? { Priority: { Force: 3 } }
    : name.startsWith('@shared/') ? load('src/shared/' + name.slice(8) + '.ts')
    : name.startsWith('.') ? load(path.relative(root, path.resolve(path.dirname(filename), name + '.ts'))) : require(name)
  new Function('require', 'module', 'exports', 'performance', source)(requireLocal, module, module.exports, { now: () => clock })
  return module.exports
}
const image = { id: 'picture-1', name: 'screen.png', dataUrl: 'data:image/png;base64,aGVsbG8=', width: 1, height: 1 }
const { toLlmMessages, validateChatImages, splitBubbleText, bubblePageAt } = load('src/shared/chatContent.ts')
const { performanceChannels } = load('src/renderer/src/lib/performanceChoreography.ts')
async function main() {
  assert.deepEqual(toLlmMessages([{ role: 'user', content: '看看图片', images: [image] }])[0].content, [{ type: 'text', text: '看看图片' }, { type: 'image_url', image_url: { url: image.dataUrl } }])
  assert.deepEqual(toLlmMessages([{ role: 'user', content: '纯文字', speakText: 'omit', performance: { emotion: 'happy' } }]), [{ role: 'user', content: '纯文字' }])
  assert.throws(() => validateChatImages([{ ...image, dataUrl: 'file:///private/image.png' }]))
  assert.throws(() => validateChatImages(Array(5).fill(image)))
  const pages = splitBubbleText('你好！这是需要完整显示的内容。'.repeat(25))
  assert(pages.length > 2 && pages.every(page => Array.from(page).length <= 64))
  assert.equal(pages.join(''), '你好！这是需要完整显示的内容。'.repeat(25))
  assert.equal(bubblePageAt(pages, 0), 0); assert.equal(bubblePageAt(pages, 1), pages.length - 1)
  console.log('PASS image payloads, input validation and complete paginated bubble text')

  const { streamChat } = load('src/main/services/llm.ts')
  const realFetch = global.fetch
  let posted
  try {
    global.fetch = async (_url, options) => {
      posted = JSON.parse(options.body)
      return new Response('data: {"choices":[{"delta":{"content":"看到了"}}]}\n\ndata: [DONE]\n\n', { status: 200 })
    }
    let answer = ''
    await streamChat({ baseUrl: 'http://fixture/v1', model: 'vision', apiKey: '' }, [{ role: 'user', content: '看图', images: [image] }], delta => { answer += delta })
    assert.equal(answer, '看到了'); assert.equal(posted.messages[0].content[1].type, 'image_url')
    assert(!JSON.stringify(posted).includes('screen.png'))
    global.fetch = async () => new Response('image input unsupported', { status: 400 })
    await assert.rejects(() => streamChat({ baseUrl: 'http://fixture', model: 'text', apiKey: '' }, [{ role: 'user', content: '', images: [image] }], () => {}), /模型支持图片/)
  } finally { global.fetch = realFetch }
  console.log('PASS actual request serialization, streamed reply and unsupported-image error')

  const SQL = await require('sql.js')()
  const old = new SQL.Database()
  old.run('CREATE TABLE chat_messages(id INTEGER PRIMARY KEY AUTOINCREMENT, role TEXT NOT NULL, content TEXT NOT NULL, speak_text TEXT, created_at INTEGER NOT NULL)')
  old.run("INSERT INTO chat_messages(role,content,created_at) VALUES ('assistant','旧聊天保留',1)")
  fs.writeFileSync(path.join(fixture, 'data.db'), Buffer.from(old.export())); old.close()
  const db = load('src/main/services/db.ts')
  await Promise.all([
    db.dbAddChat([{ role: 'user', content: '图片消息', images: [image] }]),
    db.dbAddChat([{ role: 'assistant', content: '同步回复', speakText: 'こんにちは', performance: { emotion: 'shy' } }])
  ])
  const saved = await db.dbListChat()
  assert.equal(saved.length, 3); assert.equal(saved[0].content, '旧聊天保留')
  assert.deepEqual(saved.find(message => message.role === 'user').images, [image])
  assert.equal(saved.at(-1).performance.emotion, 'shy')
  cache.delete(path.join(root, 'src/main/services/db.ts'))
  assert.deepEqual(await load('src/main/services/db.ts').dbListChat(), saved)
  console.log('PASS old SQLite migration, concurrent saves and image/expression persistence after reload')

  const states = [], refs = [], effects = [], listeners = {}, sent = []
  let stateIndex = 0, refIndex = 0, initial = true
  hooks = {
    useState(value) { const index = stateIndex++; if (initial) states[index] = value; return [states[index], update => { states[index] = typeof update === 'function' ? update(states[index]) : update }] },
    useRef(value) { const index = refIndex++; if (initial) refs[index] = { current: value }; return refs[index] },
    useEffect(callback) { if (initial) effects.push(callback) }
  }
  global.localStorage = { getItem: () => null }
  global.window = { api: {
    getConfig: async () => ({ chat: { performanceEnabled: true, historyLimit: 30 } }), onConfigChanged: () => () => {},
    control: { execute: async () => {} }, chat: {
      history: { get: async () => [], add: async () => {}, clear: async () => {} },
      send: messages => sent.push(messages),
      onChunk: callback => { listeners.chunk = callback; return () => {} },
      onDone: callback => { listeners.done = callback; return () => {} },
      onError: callback => { listeners.error = callback; return () => {} }
    }
  } }
  const { useLlmChat } = load('src/renderer/src/hooks/useLlmChat.ts')
  const render = () => { stateIndex = 0; refIndex = 0; const value = useLlmChat(); initial = false; return value }
  render(); effects.forEach(effect => effect()); await new Promise(resolve => setImmediate(resolve))
  let reveal, finish
  render().send('带图同步', { images: [image], synchronize: true, onComplete: (_reply, show) => { reveal = show; return new Promise(resolve => { finish = resolve }) } })
  listeners.chunk('中文回复。\n日语：こんにちは\n<performance>{"emotion":"shy"}</performance>')
  assert.equal(render().messages.at(-1).content, '')
  listeners.done()
  assert.equal(render().preparingSpeech, true); assert.equal(render().streaming, true)
  assert.equal(render().messages.at(-1).content, '')
  reveal(); finish(); await new Promise(resolve => setImmediate(resolve))
  assert.equal(render().messages.at(-1).content, '中文回复。'); assert.equal(render().streaming, false)
  render().send('下一条', { synchronize: false })
  assert.deepEqual(sent.at(-1)[0].images, [image])
  listeners.chunk('无需语音'); assert.equal(render().messages.at(-1).content, '无需语音')
  listeners.done(); await new Promise(resolve => setImmediate(resolve))
  render().send('语音失败', { synchronize: true, onComplete: async () => { throw new Error('fixture speech failure') } })
  listeners.chunk('失败仍显示文字'); listeners.done(); await new Promise(resolve => setImmediate(resolve))
  assert.equal(render().messages.at(-1).content, '失败仍显示文字'); assert.equal(render().streaming, false)
  render().send('不能复活旧回复', { synchronize: true, onComplete: (_reply, show) => { reveal = show; return new Promise(resolve => { finish = resolve }) } })
  listeners.chunk('旧回复'); listeners.done(); render().clear(); reveal(); finish()
  await new Promise(resolve => setImmediate(resolve)); assert.equal(render().messages.length, 0)
  console.log('PASS buffered text waits for playback, text-only streaming, failure fallback and stale-reply cancellation')

  for (const emotion of ['happy', 'sad', 'shy', 'surprised', 'thinking', 'angry', 'neutral']) {
    for (let variant = 0; variant < 3; variant++) {
      for (let step = 0; step <= 100; step++) {
        const channels = performanceChannels({ emotion, gesture: 'nod' }, variant, step / 100)
        assert(Object.values(channels).every(value => Number.isFinite(value) && Math.abs(value) <= 1))
        if (step === 0 || step === 100) assert(Object.values(channels).every(value => Math.abs(value) < 1e-6))
      }
    }
  }
  const traces = [0, 1, 2].map(variant => Array.from({ length: 10 }, (_, i) => performanceChannels({ emotion: 'happy', gesture: 'nod' }, variant, i / 10)))
  assert.notDeepEqual(traces[0], traces[1]); assert.notDeepEqual(traces[1], traces[2])
  assert(Math.max(...traces[0].map(channels => Math.abs(channels.ParamAngleY))) > 0.65)
  assert(Object.values(performanceChannels({ emotion: 'happy', intensity: 0 }, 0, 0.5)).every(value => value === 0))
  console.log('PASS seven emotions, varied body motion, larger peaks, bounded curves and zero-intensity handling')

  global.window = {
    api: { control: { emit: () => {} } },
    setTimeout: callback => { const id = ++nextTimer; timers.set(id, callback); return id }, clearTimeout: id => timers.delete(id),
    setInterval: () => ++nextTimer, clearInterval: () => {}
  }
  const ids = ['ParamAngleX', 'ParamAngleY', 'ParamAngleZ', 'ParamBodyAngleX', 'ParamBodyAngleY', 'ShoulderY', 'LArm', 'LWrist', 'ParamEyeLOpen', 'ParamEyeROpen', 'ParamMouthOpenY']
  const parameters = { ids, values: new Float32Array(ids.length), defaultValues: new Float32Array(ids.length), minimumValues: new Float32Array(ids.length).fill(-10), maximumValues: new Float32Array(ids.length).fill(20) }
  parameters.values[8] = parameters.values[9] = 1
  const overrides = new Map()
  const sprite = { setParameterValueById(id, value, weight) { if (weight === 0) overrides.delete(id); else { overrides.set(id, value); parameters.values[ids.indexOf(id)] = value } }, _model: {
    getModel: () => ({ getModel: () => ({ parameters }), saveParameters: () => {}, _savedParameters: { getSize: () => 0 } }),
    _motionManager: { stopAllMotions: () => {}, setReservePriority: () => {} }
  } }
  const { createLive2DController } = load('src/renderer/src/lib/live2dControl.ts')
  const controller = createLive2DController(sprite, 'fixture.model3.json', { expressions: [], motions: [] }, { cancelInteraction: () => {}, getExpression: () => undefined, setExpression: () => {} })
  assert(controller.capabilities().gestures.includes('wave'))
  let genericArmPeak = 0
  await controller.execute({ type: 'performance.play', data: { emotion: 'happy', gesture: 'wave', durationMs: 1800 } })
  for (clock = 0; clock < 1800; clock += 20) {
    controller.apply({ ParamMouthOpenY: 0.45, __speaking: 1 })
    assert([...overrides.values()].every(value => value >= -10 && value <= 20))
    assert.equal(overrides.get('ParamMouthOpenY'), 0.45)
    genericArmPeak = Math.max(genericArmPeak, Math.abs(overrides.get('LArm')))
  }
  assert(overrides.has('LArm') && overrides.has('ParamBodyAngleX'))
  assert(genericArmPeak > 8, 'other models retain their existing arm choreography')
  controller.reset(); clock += 400; controller.apply({})
  assert.equal(overrides.size, 0); controller.destroy()
  console.log('PASS real controller adapts hand/body motion, preserves speech mouth ownership and releases overrides')

  const raisedIds = ['Movement2', 'Param56', 'Param57', 'Param62', 'Param59', 'Param60', 'Param61', 'LArm', 'LForearm', 'LWrist', 'RArm', 'ShoulderY', 'ShoulderZ', 'ParamAngleY', 'ParamBodyAngleX']
  const raisedParameters = {
    ids: raisedIds, values: new Float32Array(raisedIds.length), defaultValues: new Float32Array(raisedIds.length),
    minimumValues: new Float32Array(raisedIds.map(id => /Movement2|Param56|Param57/.test(id) ? 0 : /Shoulder|ParamAngleY/.test(id) ? -30 : -1)),
    maximumValues: new Float32Array(raisedIds.map(id => /Shoulder|ParamAngleY/.test(id) ? 30 : 1))
  }
  raisedParameters.values[1] = 0.44; raisedParameters.values[2] = 0.26
  const raisedOverrides = new Map()
  const raisedSprite = { ...sprite, setParameterValueById(id, value, weight) {
    if (weight === 0) raisedOverrides.delete(id)
    else { raisedOverrides.set(id, value); raisedParameters.values[raisedIds.indexOf(id)] = value }
  }, _model: { ...sprite._model, getModel: () => ({ getModel: () => ({ parameters: raisedParameters }), saveParameters: () => {}, _savedParameters: { getSize: () => 0 } }) } }
  const raised = createLive2DController(raisedSprite, 'DeepSeek.model3.json', { expressions: [], motions: [] }, { cancelInteraction: () => {}, getExpression: () => undefined, setExpression: () => {} })
  for (let variant = 0; variant < 3; variant++) {
    raisedParameters.values.fill(0); raisedParameters.values[1] = 0.44; raisedParameters.values[2] = 0.26
    const began = clock
    await raised.execute({ type: 'performance.play', data: { emotion: 'happy', gesture: 'wave', durationMs: 4000 } })
    let elbowPeak = 0, liftPeak = 0, previousWrist = 0
    for (clock = began; clock <= began + 4000; clock += 20) {
      raised.apply({})
      assert(Math.abs(raisedOverrides.get('Param62')) < 0.07, 'raised upper arm stays near the authored rotation')
      assert(Math.abs(raisedOverrides.get('Param61')) < 0.18, 'raised wrist avoids full-range twisting')
      assert(Math.abs(raisedOverrides.get('Param61') - previousWrist) < 0.04, 'raised wrist turns smoothly')
      for (const id of ['LArm', 'LForearm', 'LWrist', 'RArm']) assert(Math.abs(raisedOverrides.get(id)) < 0.15)
      assert(!raisedOverrides.has('Param56') && !raisedOverrides.has('Param57'))
      elbowPeak = Math.max(elbowPeak, raisedOverrides.get('Param60'))
      liftPeak = Math.max(liftPeak, raisedOverrides.get('Movement2'))
      previousWrist = raisedOverrides.get('Param61')
    }
    assert(elbowPeak > 0.5 && elbowPeak < 0.75 && liftPeak > 0.95, 'limited joints still perform a visible raised-hand gesture')
    raised.reset(); clock += 400; raised.apply({}); assert.equal(raisedOverrides.size, 0)
  }
  await raised.execute({ type: 'performance.play', data: { gesture: 'wave', durationMs: 4000 } })
  clock += 1500; raised.apply({})
  const beforeReplacement = [...raisedParameters.values]
  await raised.execute({ type: 'performance.play', data: { gesture: 'wave', durationMs: 4000 } })
  raised.apply({}); assert.deepEqual([...raisedParameters.values], beforeReplacement, 'replacing a wave preserves the displayed joints at the transition')
  raised.reset(); clock += 400; raised.apply({})
  await raised.execute({ type: 'parameters.set', data: { values: [{ id: 'Param61', value: 0.8 }], durationMs: 1000 } })
  clock += 300; raised.apply({}); assert(Math.abs(raisedOverrides.get('Param61') - 0.8) < 1e-6, 'explicit parameter control retains its model range')
  raised.destroy()
  console.log('PASS all raised-hand variants limit joint rotation, preserve visible gestures, blend replacement and retain manual control')
}
main().catch(error => { console.error(error); process.exitCode = 1 }).finally(() => {
  if (!fixture.startsWith(path.join(os.tmpdir(), 'companion-chat-'))) throw new Error('Unexpected fixture path')
  fs.rmSync(fixture, { recursive: true, force: true })
})
