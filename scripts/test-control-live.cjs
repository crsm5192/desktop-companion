// Builds must already exist. Uses an isolated profile and local LLM/TTS fixtures.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const http = require('node:http')
const net = require('node:net')
const os = require('node:os')
const { spawn } = require('node:child_process')
const { WebSocket } = require('ws')
const root = path.resolve(__dirname, '..')
const argument = name => { const index = process.argv.indexOf(name); return index < 0 ? undefined : process.argv[index + 1] }
const modelsDirectory = argument('--models-dir') || path.join(root, 'src/renderer/public/models')
const modelPath = argument('--model') || 'models/DeepSeek/大肥鱼.model3.json'
const artifacts = path.join(root, 'test-artifacts')
const profile = path.join(root, '.control-test-data', String(Date.now()))
const pause = ms => new Promise(resolve => setTimeout(resolve, ms))
async function waitFor(action, timeout = 15000) {
  const until = Date.now() + timeout; let error
  while (Date.now() < until) {
    try { const result = await action(); if (result) return result } catch (err) { error = err }
    await pause(150)
  }
  throw error || new Error('Timed out')
}
async function freePort() {
  const server = net.createServer()
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const port = server.address().port
  await new Promise(resolve => server.close(resolve))
  return port
}
function connect(url) {
  const socket = new WebSocket(url); const pending = new Map(); const events = []; let sequence = 0
  socket.on('message', data => { const message = JSON.parse(data.toString()); if (message.event) events.push({ ...message, receivedAt: Date.now() }); const handler = pending.get(message.id); if (handler) { pending.delete(message.id); handler(message) } })
  socket.on('error', () => {})
  return {
    socket, events,
    ready: new Promise((resolve, reject) => { socket.once('open', resolve); socket.once('error', reject) }),
    request(type, data = {}) { const id = String(++sequence); return new Promise(resolve => { pending.set(id, resolve); socket.send(JSON.stringify({ id, type, data })) }) }
  }
}
async function cdp(url) {
  const client = connect(url); await client.ready
  const pending = new Map(); let sequence = 0
  client.socket.removeAllListeners('message')
  client.socket.on('message', data => { const reply = JSON.parse(data.toString()); const handler = pending.get(reply.id); if (handler) { pending.delete(reply.id); handler(reply) } })
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++sequence
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout: ${method}`)) }, 15000)
    pending.set(id, reply => { clearTimeout(timer); reply.error ? reject(new Error(reply.error.message)) : resolve(reply.result) })
    client.socket.send(JSON.stringify({ id, method, params }))
  })
  return { socket: client.socket, send, async evaluate(expression) {
    const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text + ': ' + result.exceptionDetails.exception?.description)
    return result.result?.value
  } }
}
function audioFixture() {
  const rate = 24000, seconds = 3.4, count = Math.floor(rate * seconds)
  const result = Buffer.alloc(44 + count * 2)
  result.write('RIFF'); result.writeUInt32LE(result.length - 8, 4); result.write('WAVEfmt ', 8)
  result.writeUInt32LE(16, 16); result.writeUInt16LE(1, 20); result.writeUInt16LE(1, 22)
  result.writeUInt32LE(rate, 24); result.writeUInt32LE(rate * 2, 28); result.writeUInt16LE(2, 32); result.writeUInt16LE(16, 34)
  result.write('data', 36); result.writeUInt32LE(count * 2, 40)
  for (let i = 0; i < count; i++) {
    const time = i / rate
    const amplitude = Math.floor(time / 0.55) % 2 ? 0.24 : 0
    result.writeInt16LE(Math.round(Math.sin(time * 2 * Math.PI * 220) * amplitude * 32767), 44 + i * 2)
  }
  return result
}
async function main() {
  fs.mkdirSync(artifacts, { recursive: true }); fs.mkdirSync(profile, { recursive: true })
  const report = { model: modelPath, checks: [], llmCalls: 0, ttsCalls: 0, screenshots: [] }
  const pass = name => { report.checks.push(name); console.log('PASS', name) }
  const wav = audioFixture()
  let expectedControlAddress = ''
  let failSpeech = false
  const fixture = http.createServer(async (request, response) => {
    let body = ''; for await (const part of request) body += part
    if (request.url === '/v1/audio/speech') {
      report.ttsCalls++
      await pause(1200)
      if (failSpeech) { response.writeHead(503); response.end('fixture speech unavailable'); return }
      response.writeHead(200, { 'Content-Type': 'audio/wav' }); response.end(wav); return
    }
    if (request.url === '/v1/chat/completions') {
      report.llmCalls++
      const payload = JSON.parse(body)
      const systems = payload.messages.filter(message => message.role === 'system')
      assert.equal(systems.length, 1)
      assert.equal(payload.messages[0].role, 'system')
      assert.ok(systems[0].content.includes('<performance>') && systems[0].content.includes(expectedControlAddress))
      assert.ok(systems[0].content.includes('authenticate') && systems[0].content.includes('parameters.set') && systems[0].content.includes('脸红'))
      assert.ok(!systems[0].content.includes('isolated-test-token-123456789'))
      const images = payload.messages.at(-1).content
      const hasImages = Array.isArray(images)
      if (hasImages) {
        assert.equal(images.filter(part => part.type === 'image_url').length, 3)
        assert.ok(images.filter(part => part.type === 'image_url').every(part => part.image_url.url.startsWith('data:image/jpeg;base64,')))
        report.imagePayloadVerified = true
      }
      response.writeHead(200, { 'Content-Type': 'text/event-stream' })
      const reply = (hasImages ? '看到了你发来的三张图片！\n日语：三枚の画像が見えました！' : failSpeech ? '语音失败，文字仍然显示。\n日语：音声の失敗テストです。' : '你好，很高兴见到你！\n日语：こんにちは！') + '\n<performance>{"emotion":"shy","gesture":"nod","gaze":{"x":0,"y":0},"durationMs":1600}</performance>'
      for (let i = 0; i < reply.length; i += 7) { response.write('data: ' + JSON.stringify({ choices: [{ delta: { content: reply.slice(i, i + 7) } }] }) + '\n\n'); await pause(8) }
      response.end('data: [DONE]\n\n'); return
    }
    response.writeHead(404); response.end()
  })
  await new Promise(resolve => fixture.listen(0, '127.0.0.1', resolve))
  const apiPort = await freePort(), debugPort = await freePort(), mainDebugPort = await freePort()
  expectedControlAddress = `ws://127.0.0.1:${apiPort}`
  const token = 'isolated-test-token-123456789'
  fs.writeFileSync(path.join(profile, 'config.json'), JSON.stringify({
    pet: { modelPath, eyeTracking: true, interactionEnabled: false, locked: true, scale: 1, winX: 80, winY: 80 },
    controlApi: { enabled: true, port: apiPort, token },
    llm: { baseUrl: `http://127.0.0.1:${fixture.address().port}`, apiKey: '', model: 'fixture' },
    tts: { server: { baseUrl: `http://127.0.0.1:${fixture.address().port}`, voice: 'fixture', lang: '', langAdapt: 'off' } },
    chat: { performanceEnabled: true }
  }))
  const environment = { ...process.env, DESKTOP_COMPANION_DATA_DIR: profile, DESKTOP_COMPANION_MODELS_DIR: path.resolve(modelsDirectory) }
  delete environment.ELECTRON_RUN_AS_NODE
  let executable = argument('--executable')
  if (executable && process.argv.includes('--portable')) {
    const isolatedExecutable = path.join(profile, path.basename(executable))
    fs.copyFileSync(path.resolve(executable), isolatedExecutable)
    executable = isolatedExecutable
  }
  const launchArguments = [`--remote-debugging-port=${debugPort}`, `--inspect=127.0.0.1:${mainDebugPort}`, '--mute-audio']
  if (!executable) launchArguments.unshift(root)
  const child = spawn(executable ? path.resolve(executable) : require('electron'), launchArguments, { cwd: root, env: environment, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
  let logs = ''; child.stdout.on('data', data => { logs += data }); child.stderr.on('data', data => { logs += data })
  let api, pet, chat, mainInspector
  const pages = async () => (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json()
  const request = async (type, data = {}) => { const reply = await api.request(type, data); assert.equal(reply.ok, true, JSON.stringify(reply)); return reply.data }
  const snapshot = () => request('model.get')
  const value = (model, id) => model.parameters.find(parameter => parameter.id === id)?.value
  try {
    // Portable launchers unpack the application before starting Electron.
    await waitFor(() => fetch(`http://127.0.0.1:${debugPort}/json/list`).then(response => response.ok), process.argv.includes('--portable') ? 120000 : 20000)
    const mainTarget = await waitFor(async () => (await (await fetch(`http://127.0.0.1:${mainDebugPort}/json/list`)).json())[0])
    mainInspector = await cdp(mainTarget.webSocketDebuggerUrl)
    const chatVisible = () => mainInspector.evaluate(`process.getBuiltinModule('module').createRequire(process.cwd() + '/package.json')('electron').BrowserWindow.getAllWindows().some(window => window.webContents.getURL().endsWith('#chat') && window.isVisible())`)
    assert.equal(await chatVisible(), false)
    const target = await waitFor(async () => (await pages()).find(page => page.type === 'page' && !page.url.includes('#chat')))
    pet = await cdp(target.webSocketDebuggerUrl)
    api = connect(`ws://127.0.0.1:${apiPort}`); await api.ready
    assert.equal((await api.request('model.get')).error.code, 'UNAUTHORIZED')
    await request('authenticate', { token })
    await waitFor(async () => (await request('status.get')).modelReady, 120000)
    assert.equal(await pet.evaluate('window.api.chat.history.get().then(messages=>messages.length)'), 0, 'independent test profile imported user chat history')
    const model = await snapshot()
    assert.ok(model.expressions.length >= 20); assert.ok(model.motions.length >= 8)
    assert.ok(model.parameters.some(parameter => parameter.id === 'ParamEyeBallX'))
    report.expressions = model.expressions.length; report.motions = model.motions.length; report.parameters = model.parameters.length
    pass('DeepSeek model loaded with real parameter/expression/motion discovery')
    const screenshot = async name => {
      const image = await pet.send('Page.captureScreenshot', { format: 'png' })
      fs.writeFileSync(path.join(artifacts, name + '.png'), Buffer.from(image.data, 'base64'))
      report.screenshots.push(name + '.png')
    }
    const verifyHandMotion = async () => {
      const ids = ['Movement2', 'Param62', 'Param59', 'Param60', 'Param61', 'LArm', 'LForearm', 'LWrist', 'RArm', 'ShoulderY', 'ShoulderZ']
      report.handParameters = model.parameters.filter(parameter => ids.includes(parameter.id))
      report.handTraces = []
      for (let variant = 0; variant < 3; variant++) {
        await request('control.reset'); await pause(600)
        await request('performance.play', { emotion: 'happy', gesture: 'wave', durationMs: 4000, intensity: 0.9 })
        const samples = []
        for (let frame = 0; frame < 40; frame++) {
          const current = await snapshot()
          samples.push(Object.fromEntries(ids.map(id => [id, value(current, id)])))
          for (const id of ['LArm', 'LForearm', 'LWrist', 'RArm']) assert.ok(Math.abs(value(current, id)) < 0.2, `resting joint ${id} is overdriven`)
          assert.ok(Math.abs(value(current, 'Param62')) < 0.08, 'upper arm rotates past its authored gesture range')
          assert.ok(Math.abs(value(current, 'Param61')) < 0.2, 'wrist rotation is excessive')
          assert.ok(value(current, 'Param60') >= -0.02 && value(current, 'Param60') < 0.75, 'elbow folds beyond the intended bend')
          assert.ok(Math.abs(value(current, 'ShoulderY')) < 9, 'shoulder raise is excessive')
          if (frame === 16) await screenshot('deepseek-hand-' + variant)
          if (frame === 20) await screenshot('deepseek-hand-reverse-' + variant)
          await pause(100)
        }
        report.handTraces.push(samples)
        assert.ok(Math.max(...samples.map(sample => sample.Movement2)) > 0.95, 'hand switch no longer fully raises the hand')
        assert.ok(Math.max(...samples.map(sample => sample.Param60)) > 0.5, 'elbow gesture is no longer visible')
      }
      await request('control.reset'); await pause(600)
      const restored = await snapshot()
      for (const id of ['Movement2', 'Param62', 'Param59', 'Param60', 'Param61']) assert.ok(Math.abs(value(restored, id)) < 0.02, `reset leaves ${id} displaced`)
      report.handRanges = report.handTraces.map(trace => Object.fromEntries(ids.map(id => [id, [Math.min(...trace.map(sample => sample[id])), Math.max(...trace.map(sample => sample[id]))]])))
      pass('all three real-model waves limit shoulder, arm, elbow and wrist excursions and restore the resting pose')
    }
    if (process.argv.includes('--hand-motion-only')) {
      await verifyHandMotion()
      report.success = true; return
    }
    if (!process.argv.includes('--chat-window-only')) {
    await screenshot('deepseek-neutral')
    await request('expression.set', { name: '脸红', durationMs: 2200 }); await pause(1000)
    assert.ok(value(await snapshot(), 'key7') > 0.7, `blush parameter ${value(await snapshot(), 'key7')}`)
    await screenshot('deepseek-shy')
    pass('expression API visibly activates the model blush parameter')
    await request('gaze.set', { x: -0.8, y: 0.6, durationMs: 1400 }); await pause(350)
    const gaze = await snapshot(); assert.ok(Math.abs(value(gaze, 'ParamEyeBallX') + 0.8) < 0.15)
    await screenshot('deepseek-gaze')
    pass('AI gaze overrides active mouse tracking')
    await request('parameters.set', { values: [{ id: 'ParamAngleX', value: 99999 }], durationMs: 1000 }); await pause(350)
    const clamped = (await snapshot()).parameters.find(parameter => parameter.id === 'ParamAngleX')
    assert.ok(Math.abs(clamped.value - clamped.maximum) < 0.1)
    assert.equal((await api.request('expression.set', { name: 'missing' })).error.code, 'UNKNOWN_EXPRESSION')
    assert.equal((await api.request('parameters.set', { values: [{ id: 'missing', value: 1 }] })).error.code, 'UNKNOWN_PARAMETER')
    pass('parameters respect model limits and unknown controls fail clearly')
    await request('control.reset'); await pause(600)
    assert.ok(value(await snapshot(), 'key7') < 0.1)
    assert.ok(Math.abs(value(await snapshot(), 'ParamAngleX') - clamped.maximum) > 1)
    pass('reset restores expression and releases gaze/parameter ownership')
    const beforeMotion = await snapshot()
    await request('motion.play', { name: '默认手切举手' }); await pause(900)
    const afterMotion = await snapshot()
    assert.ok(['Movement2', 'Param56', 'Param57', 'Param62'].some(id => Math.abs(value(afterMotion, id) - value(beforeMotion, id)) > 0.1))
    await screenshot('deepseek-wave')
    assert.ok(api.events.some(event => event.event === 'motion.started'))
    pass('authored raising-hand motion runs through the API')
    await request('control.reset')
    await request('speech.play', { text: '本地测试', performance: { emotion: 'happy', durationMs: 1800 } })
    const levels = []
    for (let i = 0; i < 28; i++) { levels.push(value(await snapshot(), 'ParamMouthOpenY')); await pause(100) }
    assert.ok(Math.max(...levels) > 0.4, `mouth maximum ${Math.max(...levels)}`)
    assert.ok(Math.min(...levels) < 0.05, `mouth minimum ${Math.min(...levels)}`)
    await waitFor(() => api.events.some(event => event.event === 'speech.finished'))
    report.mouthRange = [Math.min(...levels), Math.max(...levels)]
    pass('real audio analysis closes mouth in silence and opens with audio amplitude')
    }
    await mainInspector.evaluate(`process.getBuiltinModule('module').createRequire(process.cwd() + '/package.json')('electron').BrowserWindow.getAllWindows().find(window => !window.webContents.getURL().includes('#chat')).show()`)
    const checkToolbarPlacement = async (docked = false) => {
      const native = await mainInspector.evaluate(`(() => { const {BrowserWindow,screen}=process.getBuiltinModule('module').createRequire(process.cwd() + '/package.json')('electron'); const bounds=BrowserWindow.getAllWindows().find(window => !window.webContents.getURL().includes('#chat')).getBounds(); return {bounds,work:screen.getDisplayMatching(bounds).workArea}; })()`)
      const buttons = await pet.evaluate(`(() => { const toolbar=document.querySelector('.toolbar').getBoundingClientRect(); return {bottom:toolbar.bottom,height:innerHeight,buttons:[...document.querySelectorAll('.toolbar-button')].map(button=>{const r=button.getBoundingClientRect();return {text:button.textContent.trim(),visible:r.left>=0&&r.top>=0&&r.right<=innerWidth&&r.bottom<=innerHeight,clickable:document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)?.closest('button')===button};})}; })()`)
      assert.ok(native.bounds.x >= native.work.x && native.bounds.y >= native.work.y && native.bounds.x + native.bounds.width <= native.work.x + native.work.width && native.bounds.y + native.bounds.height <= native.work.y + native.work.height, 'frame extends outside the work area')
      if (docked) assert.ok(Math.abs(native.bounds.y + native.bounds.height - native.work.y - native.work.height) <= 1, 'recovered toolbar misses taskbar top')
      assert.equal(buttons.bottom, buttons.height, 'toolbar has a gap above taskbar top')
      assert.ok(buttons.buttons.every(button => button.visible && button.clickable), JSON.stringify(buttons.buttons))
      return { ...native, buttons }
    }
    report.toolbarPlacement = [await checkToolbarPlacement()]
    for (const frameScale of [0.5, 1.4, 3]) {
      await pet.evaluate(`window.api.setConfig({pet:{frameScale:${frameScale}}})`)
      await pause(250)
      report.toolbarPlacement.push(await checkToolbarPlacement())
    }
    await pet.evaluate('window.api.setConfig({pet:{frameScale:1}})'); await pause(250)
    await checkToolbarPlacement()
    pass('every real toolbar button remains visible and clickable across frame scales')
    assert.equal(await pet.evaluate(`Array.from(document.querySelectorAll('.toolbar button')).some(button => ['复位', '吸附'].includes(button.textContent.trim()))`), false, 'tray controls still appear in the main toolbar')
    // Exercise the same renderer notification sent by the tray, including while hidden.
    await pet.evaluate(`(() => { const input=document.querySelector('.zoom-control input'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'2'); input.dispatchEvent(new Event('input',{bubbles:true})); })()`)
    await waitFor(() => pet.evaluate(`document.querySelector('.zoom-val').textContent === '2.00×'`))
    await pet.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: 150, y: 200, button: 'right', clickCount: 1 })
    await pet.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 185, y: 225, button: 'right', buttons: 2 })
    await pet.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 185, y: 225, button: 'right', clickCount: 1 })
    await waitFor(() => pet.evaluate('window.api.getConfig().then(config=>config.pet.offsetX!==0 && config.pet.offsetY!==0)'))
    const modelResetPosition = await pet.evaluate('window.api.getPetPosition()')
    const mainWindowExpression = `process.getBuiltinModule('module').createRequire(process.cwd() + '/package.json')('electron').BrowserWindow.getAllWindows().find(window => !window.webContents.getURL().includes('#chat'))`
    await mainInspector.evaluate(`${mainWindowExpression}.hide()`)
    await pet.evaluate('window.api.setConfig({pet:{scale:1,offsetX:0,offsetY:0}})')
    await mainInspector.evaluate(`${mainWindowExpression}.webContents.send('pet:reset-model')`)
    await waitFor(() => pet.evaluate(`document.querySelector('.zoom-val').textContent === '1.00×'`))
    await mainInspector.evaluate(`${mainWindowExpression}.show()`)
    assert.deepEqual(await pet.evaluate('window.api.getPetPosition()'), modelResetPosition)
    // Saving a zero-distance right drag reads the actual model offset from the renderer.
    await pet.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: 150, y: 200, button: 'right', clickCount: 1 })
    await pet.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 150, y: 200, button: 'right', clickCount: 1 })
    await pause(100)
    assert.deepEqual(await pet.evaluate('window.api.getConfig().then(config=>[config.pet.scale,config.pet.offsetX,config.pet.offsetY])'), [1, 0, 0])
    pass('main toolbar omits tray controls; model reset notification restores scale and offsets while hidden')
    const nativePosition = async () => (await checkToolbarPlacement()).bounds
    assert.equal(await pet.evaluate('window.api.getConfig().then(config=>config.pet.edgeSnapEnabled)'), false)
    await pet.evaluate('window.api.setPetPosition(80,80)'); await pet.evaluate('window.api.clampPosition()')
    assert.equal((await nativePosition()).y, 80, 'drag release forces a floating frame to taskbar top')
    const beforeToggle = await checkToolbarPlacement()
    const work = beforeToggle.work
    await pet.evaluate('window.api.setConfig({pet:{edgeSnapEnabled:true}})')
    await waitFor(() => pet.evaluate(`window.api.getConfig().then(config=>config.pet.edgeSnapEnabled)`))
    for (const edge of ['left', 'right', 'top', 'bottom', 'corner']) {
      const size = await nativePosition()
      const x = edge === 'left' || edge === 'corner' ? work.x + 10 : edge === 'right' ? work.x + work.width - size.width - 10 : work.x + 80
      const y = edge === 'top' ? work.y + 10 : edge === 'bottom' || edge === 'corner' ? work.y + work.height - size.height - 10 : work.y + 80
      await pet.evaluate(`window.api.setPetPosition(${x},${y})`); await pause(100)
      const snapped = await nativePosition()
      if (edge === 'left' || edge === 'corner') assert.ok(Math.abs(snapped.x - work.x) <= 1)
      if (edge === 'right') assert.ok(Math.abs(snapped.x + snapped.width - work.x - work.width) <= 1)
      if (edge === 'top') assert.ok(Math.abs(snapped.y - work.y) <= 1)
      if (edge === 'bottom' || edge === 'corner') assert.ok(Math.abs(snapped.y + snapped.height - work.y - work.height) <= 1)
    }
    await pet.evaluate('window.api.setPetPosition(80,80)'); await pet.evaluate('window.api.clampPosition()')
    assert.equal((await nativePosition()).y, 80, 'snapped frame cannot be dragged away')
    const dragFrame = async (startY, targetY) => {
      const before = await nativePosition()
      await pet.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 20, y: startY })
      await pet.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: 20, y: startY, button: 'left', clickCount: 1 })
      await pause(100)
      await pet.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 20, y: startY + targetY - before.y, button: 'left', buttons: 1 })
      await pause(150)
      await pet.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 20, y: startY, button: 'left', clickCount: 1 })
      await pause(200)
    }
    await dragFrame(20, work.y + work.height - (await nativePosition()).height - 10)
    await checkToolbarPlacement(true)
    await dragFrame(250, 80)
    assert.ok(Math.abs((await nativePosition()).y - 80) <= 3, 'mouse dragging cannot release a snapped edge')
    pass('actual mouse drag snaps near taskbar top and dragging away releases the frame')
    await pet.evaluate('window.api.setConfig({pet:{edgeSnapEnabled:false}})')
    await waitFor(() => pet.evaluate(`window.api.getConfig().then(config=>!config.pet.edgeSnapEnabled)`))
    await pet.evaluate(`window.api.setPetPosition(${work.x+10},${work.y+10})`); await pet.evaluate('window.api.clampPosition()')
    const free = await nativePosition()
    // Windows converts between physical pixels and display-scaled window bounds.
    assert.ok(free.y > work.y && Math.abs(free.y - work.y - 10) <= 3, 'disabled snapping still forces near-edge movement')
    pass('saved snapping settings apply to the real frame; all edges and corners snap automatically, release freely, and stay free when disabled')
    const size = await nativePosition()
    await pet.evaluate(`window.api.setPetPosition(${Math.round(work.x+(work.width-size.width)/2)},${work.y+work.height-size.height})`)
    await checkToolbarPlacement(true)
    await pet.evaluate(`window.__chatClicks = 0; document.querySelector('.toolbar button[title="对话"]').addEventListener('click', () => window.__chatClicks++)`)
    const clickChat = async () => {
      const point = await pet.evaluate(`(() => { const bounds = document.querySelector('.toolbar button[title="对话"]').getBoundingClientRect(); return { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 }; })()`)
      await pet.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...point })
      await pet.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button: 'left', clickCount: 1 })
      await pet.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...point, button: 'left', clickCount: 1 })
    }
    const firstChatClick = Date.now()
    await clickChat()
    const chatTarget = await waitFor(async () => (await pages()).find(page => page.url.includes('#chat')))
    chat = await cdp(chatTarget.webSocketDebuggerUrl)
    await waitFor(() => chat.evaluate('!!document.querySelector("textarea")'))
    assert.equal(await chatVisible(), true, JSON.stringify(await mainInspector.evaluate(`process.getBuiltinModule('module').createRequire(process.cwd() + '/package.json')('electron').BrowserWindow.getAllWindows().map(window => ({url:window.webContents.getURL(),visible:window.isVisible()}))`)))
    assert.equal(await pet.evaluate('window.__chatClicks'), 1)
    assert.equal(await pet.evaluate(`document.querySelector('.toolbar button[title="对话"]').getAttribute('aria-pressed')`), 'true')
    report.firstChatOpenMs = Date.now() - firstChatClick
    pass('first actual toolbar click creates and visibly opens the chat window')
    await chat.evaluate(`document.querySelector('.chat-window-close').click()`)
    await waitFor(async () => !await pet.evaluate('window.api.chatWindow.getOpen()'))
    await waitFor(async () => !await chatVisible())
    await clickChat()
    await waitFor(chatVisible)
    assert.equal(await pet.evaluate('window.__chatClicks'), 2)
    assert.equal((await pages()).find(page => page.url.includes('#chat')).id, chatTarget.id)
    pass('closing and clicking once reopens the same chat window')
    if (process.argv.includes('--chat-window-only')) { await screenshot('taskbar-toolbar'); report.success = true; return }
    await chat.evaluate(`(() => { const checkbox = document.querySelector('.chat-window-options input[type="checkbox"]'); if (checkbox.checked) checkbox.click(); const input = document.querySelector('textarea'); Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(input,'你好'); input.dispatchEvent(new Event('input',{bubbles:true})); })()`)
    await waitFor(() => chat.evaluate(`Array.from(document.querySelectorAll('button')).some(button => button.textContent.trim() === '发送' && !button.disabled)`))
    await chat.evaluate(`Array.from(document.querySelectorAll('button')).find(button => button.textContent.trim() === '发送').click()`)
    await waitFor(() => chat.evaluate(`document.body.innerText.includes('你好，很高兴见到你！') && !document.querySelector('.typing')`))
    assert.ok(!await chat.evaluate(`document.body.innerText.includes('<performance>')`))
    await waitFor(async () => value(await snapshot(), 'key7') > 0.7)
    assert.equal(report.llmCalls, 1)
    assert.equal(await pet.evaluate(`document.querySelector('.speech-bubble[data-chat-reply]')?.textContent`), '你好，很高兴见到你！')
    pass('streamed chat parses hidden emotion cues and drives the pet from the separate chat window')
    await request('control.reset')
    const speechEventsBefore = api.events.filter(event => event.event === 'speech.started').length
    const performanceEventsBefore = api.events.filter(event => event.event === 'performance.started').length
    await chat.evaluate(`window.__replyShownAt = 0; new MutationObserver(() => { if (!window.__replyShownAt && document.querySelectorAll('.bubble-assistant').length === 2) window.__replyShownAt = Date.now(); }).observe(document.body, {childList:true,subtree:true,characterData:true})`)
    await pet.evaluate(`window.__replyBubbleAt = 0; new MutationObserver(() => { if (!window.__replyBubbleAt && document.querySelector('.speech-bubble[data-chat-reply]')) window.__replyBubbleAt = Date.now(); }).observe(document.body, {childList:true,subtree:true,characterData:true})`)
    await chat.evaluate(`(() => { const checkbox = document.querySelector('.chat-window-options input[type="checkbox"]'); if (!checkbox.checked) checkbox.click(); const input = document.querySelector('textarea'); Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(input,'再说一句'); input.dispatchEvent(new Event('input',{bubbles:true})); })()`)
    await waitFor(() => chat.evaluate(`Array.from(document.querySelectorAll('button')).some(button => button.textContent.trim() === '发送' && !button.disabled)`))
    await chat.evaluate(`Array.from(document.querySelectorAll('button')).find(button => button.textContent.trim() === '发送').click()`)
    await waitFor(() => report.ttsCalls === 2)
    assert.equal(await chat.evaluate(`document.querySelectorAll('.bubble-assistant').length`), 1)
    assert.ok(await chat.evaluate(`document.querySelector('.typing')?.textContent.includes('准备语音')`))
    assert.ok(!await pet.evaluate(`!!document.querySelector('.speech-bubble[data-chat-reply]')`))
    assert.equal(api.events.filter(event => event.event === 'performance.started').length, performanceEventsBefore)
    await waitFor(() => api.events.filter(event => event.event === 'speech.started').length > speechEventsBefore)
    await waitFor(() => chat.evaluate(`window.__replyShownAt > 0`))
    await waitFor(() => pet.evaluate(`window.__replyBubbleAt > 0`))
    const speechStart = api.events.filter(event => event.event === 'speech.started').at(-1).receivedAt
    const replyShownAt = await chat.evaluate('window.__replyShownAt')
    const replyBubbleAt = await pet.evaluate('window.__replyBubbleAt')
    assert.ok(Math.abs(replyShownAt - speechStart) < 250)
    assert.ok(Math.abs(replyBubbleAt - speechStart) < 250)
    report.replySyncMs = { text: replyShownAt - speechStart, bubble: replyBubbleAt - speechStart }
    pass('text, pet bubble and expression wait for delayed speech and begin together with actual playback')
    const chatLevels = []
    for (let i = 0; i < 28; i++) { chatLevels.push(value(await snapshot(), 'ParamMouthOpenY')); await pause(100) }
    assert.ok(Math.max(...chatLevels) > 0.4 && Math.min(...chatLevels) < 0.05)
    assert.equal(report.llmCalls, 2)
    pass('chat-window audio amplitude is forwarded to the pet and expression begins with playback')
    const updatedPort = await freePort()
    const previousAddress = expectedControlAddress
    expectedControlAddress = `ws://127.0.0.1:${updatedPort}`
    await pet.evaluate(`window.api.setConfig({controlApi:{endpoint:${JSON.stringify(expectedControlAddress)},port:${updatedPort}}})`)
    await waitFor(() => api.socket.readyState === WebSocket.CLOSED)
    api = connect(expectedControlAddress); await api.ready; await request('authenticate', { token })
    assert.equal((await request('status.get')).endpoint, expectedControlAddress)
    const prompt = await pet.evaluate('window.api.chat.prompt()')
    assert.ok(prompt.includes(expectedControlAddress) && !prompt.includes(previousAddress) && !prompt.includes(token))
    await chat.evaluate(`(() => { const checkbox = document.querySelector('.chat-window-options input[type="checkbox"]'); if (checkbox.checked) checkbox.click(); const input = document.querySelector('textarea'); Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(input,'换端口后再聊一句'); input.dispatchEvent(new Event('input',{bubbles:true})); })()`)
    await waitFor(() => chat.evaluate(`Array.from(document.querySelectorAll('button')).some(button => button.textContent.trim() === '发送' && !button.disabled)`))
    await chat.evaluate(`Array.from(document.querySelectorAll('button')).find(button => button.textContent.trim() === '发送').click()`)
    await waitFor(() => report.llmCalls === 3)
    await waitFor(() => chat.evaluate(`!document.querySelector('.typing')`))
    pass('saved endpoint changes restart the API and update preview plus the next actual AI system prompt')
    report.controlPromptVerified = true
    const networkHost = Object.values(os.networkInterfaces()).flat().find(address => address && address.family === 'IPv4' && !address.internal)?.address
    expectedControlAddress = 'wss://pet.example.com/agent'
    await pet.evaluate(`window.api.setConfig({controlApi:{listenHost:'0.0.0.0',endpoint:${JSON.stringify(expectedControlAddress)}}})`)
    await waitFor(() => api.socket.readyState === WebSocket.CLOSED)
    api = connect(`ws://${networkHost || '127.0.0.1'}:${updatedPort}/agent`); await api.ready
    assert.equal((await api.request('gaze.set', { x: 0.7, y: -0.4 })).error.code, 'UNAUTHORIZED')
    assert.equal((await api.request('authenticate', { token: 'wrong-remote-token' })).error.code, 'UNAUTHORIZED')
    await request('authenticate', { token })
    const remoteStatus = await request('status.get')
    assert.equal(remoteStatus.host, '0.0.0.0'); assert.equal(remoteStatus.port, updatedPort)
    assert.equal(remoteStatus.endpoint, expectedControlAddress)
    await request('gaze.set', { x: 0.7, y: -0.4, durationMs: 2000 }); await pause(350)
    assert.ok(Math.abs(value(await snapshot(), 'ParamEyeBallX') - 0.7) < 0.15)
    const remotePrompt = await pet.evaluate('window.api.chat.prompt()')
    assert.ok(remotePrompt.includes(expectedControlAddress) && !remotePrompt.includes('ws://0.0.0.0') && !remotePrompt.includes(token))
    const agentPrompt = await pet.evaluate("window.api.chat.prompt('agent')")
    assert.ok(agentPrompt.includes(expectedControlAddress) && agentPrompt.includes('先 authenticate，再 model.get') && agentPrompt.includes('脸红'))
    assert.ok(!agentPrompt.includes(token) && !agentPrompt.includes('<performance>JSON</performance>'))
    report.networkInterface = networkHost || 'loopback fallback'
    pass('network listener authenticates Agent gaze control of the real model while prompts advertise a separate WSS address')
    await chat.evaluate(`(() => { const input = document.querySelector('textarea'); Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(input,'远程地址配置后再聊一句'); input.dispatchEvent(new Event('input',{bubbles:true})); })()`)
    await waitFor(() => chat.evaluate(`Array.from(document.querySelectorAll('button')).some(button => button.textContent.trim() === '发送' && !button.disabled)`))
    await chat.evaluate(`Array.from(document.querySelectorAll('button')).find(button => button.textContent.trim() === '发送').click()`)
    await waitFor(() => report.llmCalls === 4)
    await waitFor(() => chat.evaluate(`!document.querySelector('.typing')`))
    pass('next actual AI request receives the configured remote Agent URL without exposing its token')
    await request('control.reset')
    const attachmentData = await chat.evaluate(`(() => { const canvas = document.createElement('canvas'); canvas.width=120; canvas.height=80; const context=canvas.getContext('2d'); context.fillStyle='#f2d8e7'; context.fillRect(0,0,120,80); context.fillStyle='#75508f'; context.fillRect(25,20,70,40); return canvas.toDataURL('image/png'); })()`)
    const attachmentFile = path.join(profile, 'test-picture.png')
    fs.writeFileSync(attachmentFile, Buffer.from(attachmentData.split(',')[1], 'base64'))
    const document = await chat.send('DOM.getDocument')
    const inputNode = await chat.send('DOM.querySelector', { nodeId: document.root.nodeId, selector: '.chat-file-input' })
    await chat.send('DOM.setFileInputFiles', { nodeId: inputNode.nodeId, files: [attachmentFile] })
    await waitFor(() => chat.evaluate(`document.querySelectorAll('.chat-attachment').length === 1`))
    const transfer = `const data = new DataTransfer(); data.items.add(new File([Uint8Array.from(atob(${JSON.stringify(attachmentData.split(',')[1])}), character => character.charCodeAt(0))], 'paste-picture.png', {type:'image/png'}));`
    await chat.evaluate(`(() => { ${transfer} document.querySelector('textarea').dispatchEvent(new ClipboardEvent('paste',{bubbles:true,cancelable:true,clipboardData:data})); })()`)
    await waitFor(() => chat.evaluate(`document.querySelectorAll('.chat-attachment').length === 2`))
    await chat.evaluate(`(() => { ${transfer} document.querySelector('.chat-window').dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:data})); })()`)
    await waitFor(() => chat.evaluate(`document.querySelectorAll('.chat-attachment').length === 3`))
    await chat.evaluate(`(() => { ${transfer} document.querySelector('textarea').dispatchEvent(new ClipboardEvent('paste',{bubbles:true,cancelable:true,clipboardData:data})); })()`)
    await waitFor(() => chat.evaluate(`document.querySelectorAll('.chat-attachment').length === 4`))
    await chat.evaluate(`(() => { ${transfer} document.querySelector('textarea').dispatchEvent(new ClipboardEvent('paste',{bubbles:true,cancelable:true,clipboardData:data})); })()`)
    await waitFor(() => chat.evaluate(`document.body.innerText.includes('每条消息最多发送 4 张图片')`))
    assert.equal(await chat.evaluate(`document.querySelectorAll('.chat-attachment').length`), 4)
    await chat.evaluate(`document.querySelector('.chat-attachment button').click()`)
    await waitFor(() => chat.evaluate(`document.querySelectorAll('.chat-attachment').length === 3`))
    await chat.evaluate(`Array.from(document.querySelectorAll('button')).find(button => button.textContent.trim() === '发送').click()`)
    await waitFor(() => report.imagePayloadVerified)
    await waitFor(() => chat.evaluate(`document.body.innerText.includes('看到了你发来的三张图片！') && !document.querySelector('.typing')`))
    const history = await chat.evaluate('window.api.chat.history.get()')
    assert.equal(history.find(message => message.images?.length).images.length, 3)
    const chatImage = await chat.send('Page.captureScreenshot', { format: 'png' })
    fs.writeFileSync(path.join(artifacts, 'chat-images.png'), Buffer.from(chatImage.data, 'base64'))
    report.screenshots.push('chat-images.png')
    await screenshot('pet-chat-reply')
    pass('file chooser, clipboard paste, drag/drop, four-image limit, removal and actual multimodal request with saved history')
    await request('performance.play', { emotion: 'happy', gesture: 'nod', intensity: 0.9, durationMs: 2200 })
    const poseSamples = []
    for (let i = 0; i < 36; i++) { poseSamples.push(await snapshot()); await pause(50) }
    const headPeak = Math.max(...poseSamples.map(model => Math.abs(value(model, 'ParamAngleY'))))
    const bodyValues = poseSamples.map(model => value(model, 'ParamBodyAngleY'))
    assert.ok(headPeak > 15, `head peak ${headPeak}`)
    assert.ok(Math.max(...bodyValues) - Math.min(...bodyValues) > 0.2)
    report.performanceRange = { headPeak, body: [Math.min(...bodyValues), Math.max(...bodyValues)] }
    pass('stronger nod continues to drive head and body together')
    await verifyHandMotion()
    await chat.evaluate(`document.querySelector('.chat-window-options input[type="checkbox"]').click()`)
    await waitFor(() => chat.evaluate(`document.querySelectorAll('.bubble-assistant .bubble-speak').length > 0`))
    const replayCallsBefore = report.ttsCalls
    await chat.evaluate(`Array.from(document.querySelectorAll('.bubble-assistant .bubble-speak')).at(-1).click()`)
    await waitFor(() => report.ttsCalls > replayCallsBefore)
    await chat.evaluate(`(() => { const input = document.querySelector('textarea'); Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(input,'取消上一条重播，开始新回复'); input.dispatchEvent(new Event('input',{bubbles:true})); })()`)
    await waitFor(() => chat.evaluate(`Array.from(document.querySelectorAll('button')).some(button => button.textContent.trim() === '发送' && !button.disabled)`))
    await chat.evaluate(`Array.from(document.querySelectorAll('button')).find(button => button.textContent.trim() === '发送').click()`)
    await waitFor(() => chat.evaluate(`!document.querySelector('.typing')`))
    await pause(1400)
    assert.ok(await pet.evaluate(`document.querySelector('.speech-bubble[data-chat-reply]')?.textContent.includes('你好，很高兴见到你！')`))
    pass('canceled slow replay cannot replace a newer reply bubble or restart its expression')
    failSpeech = true
    await chat.evaluate(`(() => { const checkbox = document.querySelector('.chat-window-options input[type="checkbox"]'); if (!checkbox.checked) checkbox.click(); const input = document.querySelector('textarea'); Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(input,'测试语音失败'); input.dispatchEvent(new Event('input',{bubbles:true})); })()`)
    await waitFor(() => chat.evaluate(`Array.from(document.querySelectorAll('button')).some(button => button.textContent.trim() === '发送' && !button.disabled)`))
    await chat.evaluate(`Array.from(document.querySelectorAll('button')).find(button => button.textContent.trim() === '发送').click()`)
    await waitFor(() => chat.evaluate(`document.body.innerText.includes('语音失败，文字仍然显示。') && !document.querySelector('.typing')`))
    await waitFor(() => pet.evaluate(`document.querySelector('.speech-bubble[data-chat-reply]')?.textContent.includes('语音失败，文字仍然显示。')`))
    assert.ok(await chat.evaluate(`document.body.innerText.includes('语音：')`))
    pass('speech service failure still reveals the complete reply in chat and the pet bubble')
    await request('control.reset')
    await pet.evaluate('window.api.setConfig({controlApi:{enabled:false}})')
    await waitFor(() => api.socket.readyState === WebSocket.CLOSED)
    await pet.evaluate('window.api.setConfig({controlApi:{enabled:true}})')
    await waitFor(async () => (await pet.evaluate('window.api.control.status()')).listening)
    pass('API can be disabled and re-enabled without restarting the app')
    report.success = true
  } finally {
    // A portable launcher is a parent wrapper; quit Electron before stopping it.
    if (mainInspector) await mainInspector.evaluate(`setTimeout(() => process.getBuiltinModule('module').createRequire(process.cwd() + '/package.json')('electron').app.quit(), 50); true`).catch(() => {})
    api?.socket.terminate(); pet?.socket.terminate(); chat?.socket.terminate(); mainInspector?.socket.terminate()
    child.kill()
    await Promise.race([new Promise(resolve => child.once('exit', resolve)), pause(5000)])
    fixture.closeAllConnections(); await new Promise(resolve => fixture.close(resolve))
    fs.writeFileSync(path.join(artifacts, 'live-test-report.json'), JSON.stringify(report, null, 2))
    fs.writeFileSync(path.join(artifacts, 'electron-test.log'), logs)
  }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
