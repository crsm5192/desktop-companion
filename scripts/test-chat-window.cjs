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
    this.options = options
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
  setOpacity(value) { this.opacity = value }
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
const config = { pet: { opacity: 0.9, panelOpacity: 0.65 } }
function load(file) {
  const filename = path.resolve(root, file)
  if (cache.has(filename)) return cache.get(filename).exports
  const module = { exports: {} }; cache.set(filename, module)
  const source = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  new Function('require', 'module', 'exports', '__dirname', source)(name => name === 'electron' ? { BrowserWindow: Window, screen, shell: { openExternal: async () => {} } }
    : name.endsWith('/config') ? { getConfig: () => config }
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

const manager = load('src/main/panelWindows.ts')
const parent = new Window({ width: 420, height: 520, show: true })
manager.bindPanelWindows(parent)
for (const name of ['chat', 'music', 'pomodoro', 'todo', 'diary', 'actions', 'settings']) {
  assert(manager.setPanelOpen(name, true))
  const win = manager.getPanelWindow(name)
  assert(win.isVisible(), `${name} must open on the first click`)
  assert.equal(win.options.transparent, true)
  assert.equal(win.options.backgroundColor, '#00000000')
  assert.equal(win.options.webPreferences.backgroundThrottling, false)
  assert.equal(win.opacity, 0.65, 'new windows use the saved opacity')
  win.emit('will-move')
  win.setBounds({ x: 240, y: 180, width: 320, height: 400 })
  parent.bounds.x += 50; parent.emit('move')
  assert.equal(win.getBounds().x, 240, 'manually moved windows stop following the pet')
  manager.setPanelOpen(name, false)
  assert(!win.isVisible() && !win.isDestroyed())
  manager.setPanelOpen(name, true)
  assert.equal(manager.getPanelWindow(name), win, 'reopening preserves renderer state')
  assert.equal(win.getBounds().x, 240, 'reopening retains the manual position')
  manager.dockPanelWindow(name)
  const before = win.getBounds().x
  parent.bounds.x += 50; parent.emit('move')
  assert.notEqual(win.getBounds().x, before, 'docking restores following')
}
config.pet.opacity = 0.3
manager.updatePanelOpacity()
for (const name of Object.keys(manager.getPanelWindowState())) {
  assert.equal(manager.getPanelWindow(name).opacity, 0.65, 'changing the pet opacity must not change popup windows')
}
config.pet.panelOpacity = 0.4
manager.updatePanelOpacity()
parent.hide()
for (const name of Object.keys(manager.getPanelWindowState())) {
  assert.equal(manager.getPanelWindow(name).opacity, 0.4, 'all windows update opacity, including hidden ones')
  assert(!manager.getPanelWindow(name).isVisible())
}
manager.setPanelOpen('todo', false)
parent.show()
assert(!manager.getPanelWindow('todo').isVisible(), 'tray restoration leaves explicitly closed panels hidden')
assert(manager.getPanelWindow('music').isVisible())
screen.emit('display-removed')
parent.destroy()
assert(Object.values(manager.getPanelWindowState()).every(open => !open))
console.log('PASS all seven translucent windows share first-click opening, manual movement, docking, opacity, hide/restore and shutdown behavior')
