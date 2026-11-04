const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const ts = require('typescript')
const { WebSocket } = require('ws')
const root = path.resolve(__dirname, '..')
const cache = new Map()
function load(file) {
  const filename = path.resolve(root, file)
  if (cache.has(filename)) return cache.get(filename).exports
  const module = { exports: {} }; cache.set(filename, module)
  const source = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  new Function('require', 'module', 'exports', source)(name => name.startsWith('@shared/') ? load('src/shared/' + name.slice(8) + '.ts') : name.startsWith('.') ? load(path.relative(root, path.resolve(path.dirname(filename), name + '.ts'))) : require(name), module, module.exports)
  return module.exports
}
const { validateControlCommand, extractPerformance, validatePerformance, mergeControlApi, parseControlEndpoint, controlListenAddress } = load('src/shared/control.ts')
const { buildChatSystemPrompt, prepareChatMessages } = load('src/main/services/chatPrompt.ts')
const { parseAssistantReply } = load('src/renderer/src/lib/parseReply.ts')
const { createControlServer } = load('src/main/services/controlServer.ts')
function client(address, options) {
  const ws = new WebSocket(typeof address === 'number' ? `ws://127.0.0.1:${address}` : address, options)
  const waiting = new Map(); let sequence = 0
  ws.on('message', buffer => { const message = JSON.parse(buffer.toString()); const resolve = waiting.get(message.id); if (resolve) { waiting.delete(message.id); resolve(message) } })
  ws.on('error', () => {})
  return {
    ws,
    ready: new Promise((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject) }),
    request(type, data = {}) {
      const id = String(++sequence)
      return new Promise(resolve => { waiting.set(id, resolve); ws.send(JSON.stringify({ id, type, data })) })
    }
  }
}
async function main() {
  assert.throws(() => validateControlCommand('gaze.set', { x: Infinity, y: 0 }))
  assert.throws(() => validateControlCommand('parameters.set', { values: [] }))
  assert.throws(() => validatePerformance({ emotion: 'invented' }))
  assert.throws(() => validateControlCommand('shell.exec', { command: 'anything' }))
  assert.equal(validateControlCommand('gaze.set', { x: -1, y: 1 }).data.x, -1)
  const cue = '<performance>{"emotion":"shy","gesture":"nod","durationMs":1200}</performance>'
  const reply = parseAssistantReply('你好！\n日语：こんにちは！\n' + cue)
  assert.equal(reply.display, '你好！'); assert.equal(reply.speak, 'こんにちは！'); assert.equal(reply.performance.emotion, 'shy')
  for (let i = 1; i < cue.length; i++) assert.ok(!extractPerformance('你好！' + cue.slice(0, i)).text.includes('<'), `partial cue ${i} leaked`)
  assert.equal(extractPerformance('你好<performance>{bad}</performance>').text, '你好')
  console.log('PASS validated commands and hidden streaming performance cues')
  const defaults = { enabled: true, port: 18790, endpoint: 'ws://127.0.0.1:18790', token: 'never-send-this-secret' }
  const migrated = mergeControlApi(defaults, { port: 19234 })
  assert.equal(migrated.endpoint, 'ws://127.0.0.1:19234')
  assert.equal(migrated.listenHost, '127.0.0.1')
  const legacyEndpoint = mergeControlApi(defaults, { endpoint: 'ws://localhost:19235' })
  assert.equal(legacyEndpoint.port, 19235)
  assert.equal(legacyEndpoint.listenHost, 'localhost')
  const changed = mergeControlApi(migrated, { endpoint: 'wss://pet.example.com/control', listenHost: '0.0.0.0' })
  assert.equal(changed.port, 19234)
  assert.deepEqual(controlListenAddress(changed), { host: '0.0.0.0', port: 19234 })
  assert.equal(parseControlEndpoint(changed.endpoint).port, 443)
  assert.equal(mergeControlApi(changed, { port: 19236 }).endpoint, changed.endpoint)
  assert.equal(mergeControlApi(changed, { enabled: false }).listenHost, '0.0.0.0')
  const lan = mergeControlApi(changed, { endpoint: 'ws://192.168.1.20:30000' })
  assert.equal(lan.port, 19234)
  assert.equal(parseControlEndpoint('ws://[2001:db8::1]:18790/pet').host, '2001:db8::1')
  assert.throws(() => mergeControlApi(defaults, { endpoint: 'https://pet.example.com' }))
  assert.throws(() => mergeControlApi(defaults, { endpoint: 'ws://0.0.0.0:18790' }))
  assert.throws(() => mergeControlApi(defaults, { endpoint: 'ws://[::]:18790' }))
  assert.throws(() => mergeControlApi(defaults, { endpoint: 'wss://user:secret@pet.example.com/control' }))
  assert.throws(() => mergeControlApi(defaults, { endpoint: 'wss://pet.example.com/control?token=secret' }))
  assert.throws(() => mergeControlApi(changed, { listenHost: 'pet.example.com' }))
  assert.throws(() => mergeControlApi(defaults, { port: NaN }))
  const configuration = { controlApi: changed, chat: { persona: '测试角色设定', voiceRule: '测试语音规则', performanceEnabled: true, historyLimit: 30 } }
  const capabilities = { modelPath: 'models/test.model3.json', expressions: [{ name: '模型独有害羞表情' }], motions: [{ name: '模型独有举手动作' }], emotions: ['shy'], gestures: ['nod'], parameters: [] }
  const prompt = buildChatSystemPrompt(configuration, capabilities)
  assert.ok(prompt.includes(changed.endpoint) && prompt.includes('authenticate') && prompt.includes('parameters.set'))
  assert.ok(prompt.includes('模型独有害羞表情') && prompt.includes('模型独有举手动作'))
  assert.ok(!prompt.includes(defaults.token) && !prompt.includes(defaults.endpoint))
  const prepared = prepareChatMessages([{ role: 'system', content: defaults.endpoint }, { role: 'user', content: '你好' }], configuration, capabilities)
  assert.equal(prepared.filter(message => message.role === 'system').length, 1)
  assert.equal(prepared[0].content, prompt); assert.equal(prepared[1].content, '你好')
  const disabled = buildChatSystemPrompt({ ...configuration, chat: { ...configuration.chat, performanceEnabled: false } }, capabilities)
  assert.equal(disabled, '测试角色设定\n\n测试语音规则')
  const agentPrompt = buildChatSystemPrompt({ ...configuration, chat: { ...configuration.chat, performanceEnabled: false } }, capabilities, 'agent')
  assert.ok(agentPrompt.includes(changed.endpoint) && agentPrompt.includes('WebSocket 执行工具') && agentPrompt.includes('先 authenticate，再 model.get'))
  assert.ok(agentPrompt.includes('模型独有害羞表情') && !agentPrompt.includes(defaults.token) && !agentPrompt.includes('<performance>JSON</performance>'))
  assert.ok(!agentPrompt.includes('测试角色设定') && !agentPrompt.includes('测试语音规则'))
  console.log('PASS legacy migration, independent listener/public URL, IPv4/IPv6/WSS and fresh prompts without credentials')
  const token = 'test-token-123456789'
  const executed = []
  const server = await createControlServer({ config: { port: 0, token, enabled: true }, execute: async command => { executed.push(command); return { applied: command.type } }, status: () => ({ modelReady: true }) })
  const connection = client(server.port)
  try {
    await connection.ready
    assert.equal((await connection.request('model.get')).error.code, 'UNAUTHORIZED')
    assert.equal((await connection.request('authenticate', { token: 'incorrect' })).error.code, 'UNAUTHORIZED')
    assert.equal((await connection.request('authenticate', { token })).ok, true)
    assert.equal((await connection.request('status.get')).data.modelReady, true)
    assert.equal((await connection.request('gaze.set', { x: 2, y: 0 })).error.code, 'INVALID_REQUEST')
    assert.equal((await connection.request('performance.play', { emotion: 'happy' })).ok, true)
    assert.equal(executed.length, 1)
    const event = new Promise(resolve => connection.ws.once('message', data => resolve(JSON.parse(data.toString()))))
    server.emit('performance.finished', { reason: 'completed' })
    assert.equal((await event).event, 'performance.finished')
    const browser = client(server.port, { origin: 'https://example.com' })
    await browser.ready
    assert.equal(await new Promise(resolve => browser.ws.once('close', code => resolve(code))), 1008)
    console.log('PASS real WebSocket authentication, command dispatch, validation, events and browser-origin rejection')
  } finally { connection.ws.terminate(); await server.close() }
  const networkHost = Object.values(os.networkInterfaces()).flat().find(address => address && address.family === 'IPv4' && !address.internal)?.address
  const remoteServer = await createControlServer({ config: { enabled: true, listenHost: '0.0.0.0', port: 0, endpoint: 'wss://pet.example.com/agent', token }, execute: async command => ({ applied: command.type }), status: () => ({ modelReady: true }) })
  const remote = client(`ws://${networkHost || '127.0.0.1'}:${remoteServer.port}/agent`)
  try {
    await remote.ready
    assert.equal(remoteServer.host, '0.0.0.0')
    assert.equal((await remote.request('performance.play', { emotion: 'shy' })).error.code, 'UNAUTHORIZED')
    assert.equal((await remote.request('authenticate', { token: 'wrong-remote-token' })).error.code, 'UNAUTHORIZED')
    assert.equal((await remote.request('authenticate', { token })).ok, true)
    assert.equal((await remote.request('performance.play', { emotion: 'shy' })).data.applied, 'performance.play')
    console.log(`PASS network listener accepts authenticated native Agent commands at ${networkHost || 'loopback fallback'} independently of advertised WSS URL`)
  } finally { remote.ws.terminate(); await remoteServer.close() }
}
const deadline = setTimeout(() => { console.error('Control test timed out'); process.exit(1) }, 20000)
main().catch(error => { console.error(error); process.exitCode = 1 }).finally(() => clearTimeout(deadline))
