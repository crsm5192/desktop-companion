const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { EventEmitter } = require('node:events')
const ts = require('typescript')
const root = path.resolve(__dirname, '..')
const windows = []
class Window extends EventEmitter {
  constructor(options) {
    super()
    this.visible = options.show !== false
    this.ignoreNextShow = options.show === false
    this.destroyed = false
    this.bounds = { x: 60, y: 60, width: options.width, height: options.height }
    this.webContents = new EventEmitter()
    this.messages = []
    this.webContents.send = (type, value) => this.messages.push({ type, value })
    this.webContents.setWindowOpenHandler = () => {}
    windows.push(this)
  }
  isDestroyed() { return this.destroyed }
  isVisible() { return this.visible }
  getBounds() { return this.bounds }
  setBounds(bounds) { this.bounds = bounds }
  setAlwaysOnTop() {}
  loadURL() { return Promise.resolve() }
  show() {
    if (this.ignoreNextShow) { this.ignoreNextShow = false; return }
    this.visible = true
    this.emit('show')
  }
  showInactive() { this.show() }
  hide() { this.visible = false; this.emit('hide') }
  destroy() { this.destroyed = true; this.visible = false; this.emit('closed') }
}
const screen = new EventEmitter()
screen.getDisplayMatching = () => ({ workArea: { x: 0, y: 0, width: 1920, height: 1080 } })
const cache = new Map()
function load(file) {
  const filename = path.resolve(root, file)
  if (cache.has(filename)) return cache.get(filename).exports
  const module = { exports: {} }; cache.set(filename, module)
  const source = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  new Function('require', 'module', 'exports', '__dirname', source)(name => name === 'electron' ? { BrowserWindow: Window, screen, shell: { openExternal: async () => {} } }
    : name.startsWith('.') ? load(path.relative(root, path.resolve(path.dirname(filename), name + '.ts'))) : require(name), module, module.exports, path.dirname(filename))
  return module.exports
}
const { bindChatWindow, getChatWindow, isChatOpen, setChatOpen } = load('src/main/chatWindow.ts')
const pet = new Window({ width: 420, height: 520, show: true })
bindChatWindow(pet)
assert.equal(setChatOpen(true), true)
const chat = getChatWindow()
assert.equal(chat.isVisible(), true, 'one click must display chat even when the first native show is ignored and renderer paint is delayed')
assert.equal(isChatOpen(), true)
console.log('PASS first click displays chat when first native show is ignored and renderer paint is delayed')
setChatOpen(false)
chat.emit('ready-to-show'); chat.webContents.emit('did-finish-load')
assert.equal(chat.isVisible(), false)
assert.equal(isChatOpen(), false)
console.log('PASS closing during load stays closed when late renderer events arrive')
setChatOpen(true)
assert.equal(chat.isVisible(), true)
assert.equal(getChatWindow(), chat)
assert.equal(windows.length, 2)
const close = { prevented: false, preventDefault() { this.prevented = true } }
chat.emit('close', close)
assert(close.prevented && !chat.isVisible() && !isChatOpen())
setChatOpen(true)
assert(chat.isVisible())
console.log('PASS close and reopen preserve the existing chat window and its draft state')
pet.hide()
assert(!chat.isVisible() && isChatOpen())
pet.show()
assert(chat.isVisible() && isChatOpen())
console.log('PASS tray hide and restore display chat without waiting for another paint event')
chat.destroy()
assert.equal(isChatOpen(), false)
setChatOpen(true)
assert.notEqual(getChatWindow(), chat)
assert(getChatWindow().isVisible())
pet.destroy()
assert.equal(getChatWindow(), null)
assert.equal(isChatOpen(), false)
console.log('PASS destroyed chat recreates on one click and parent shutdown resets its state')
