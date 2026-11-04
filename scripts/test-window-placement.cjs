const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { EventEmitter } = require('node:events')
const ts = require('typescript')
const root = path.resolve(__dirname, '..')
let config = { pet: { frameScale: 1, winX: 750, winY: 20, edgeSnapEnabled: false } }
let menu
const windows = []
const handlers = new Map()
const display = { workArea: { x: 0, y: 0, width: 1920, height: 1040 } }
const screen = new EventEmitter()
screen.getPrimaryDisplay = () => display
screen.getDisplayNearestPoint = () => display
screen.getDisplayMatching = () => display
class Window extends EventEmitter {
  constructor(options) {
    super()
    this.bounds = { x: 60, y: 60, width: options.width, height: options.height }
    this.visible = true
    windows.push(this)
    this.messages = []
    this.webContents = new EventEmitter()
    this.webContents.send = (...message) => this.messages.push(message)
    this.webContents.setWindowOpenHandler = () => {}
  }
  isDestroyed() { return false }
  isVisible() { return this.visible }
  getBounds() { return { ...this.bounds } }
  getSize() { return [this.bounds.width, this.bounds.height] }
  getPosition() { return [this.bounds.x, this.bounds.y] }
  setPosition(x, y) { Object.assign(this.bounds, { x, y }); this.emit('move') }
  setBounds(bounds) { Object.assign(this.bounds, bounds); this.emit('resize'); this.emit('move') }
  setAlwaysOnTop() {}
  loadURL() { return Promise.resolve() }
  show() { this.visible = true; this.emit('show') }
  showInactive() { this.show() }
  hide() { this.visible = false; this.emit('hide') }
  focus() { this.focused = true }
}
Window.getAllWindows = () => windows
const electron = {
  screen, BrowserWindow: Window, app: { isPackaged: false, on() {} },
  ipcMain: { handle: (channel, handler) => handlers.set(channel, handler), on() {} },
  protocol: { registerSchemesAsPrivileged() {}, handle() {} }, shell: { openExternal() {} },
  nativeImage: { createFromPath: () => ({}) },
  Tray: class { setToolTip() {} setContextMenu(value) { menu = value } on() {} },
  Menu: { buildFromTemplate: template => template }
}
const cache = new Map()
function load(file) {
  const filename = path.resolve(root, file)
  if (cache.has(filename)) return cache.get(filename).exports
  const module = { exports: {} }; cache.set(filename, module)
  const source = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  new Function('require', 'module', 'exports', '__dirname', source)(name => name === 'electron' ? electron
    : name.endsWith('/config') ? { getConfig: () => config, setConfig: patch => { config.pet = { ...config.pet, ...patch.pet }; return config } }
    : name.endsWith('/paths') || name.startsWith('../services/') ? {}
    : name.startsWith('.') ? load(path.resolve(path.dirname(filename), name + '.ts')) : require(name), module, module.exports, path.dirname(filename))
  return module.exports
}
const placement = load('src/main/window.ts')
const tray = load('src/main/tray.ts')
const { IPC } = load('src/shared/constants.ts')
tray.createTray()
const snapItem = () => menu.find(item => item.label === '吸附')
const reset = menu.find(item => item.label === '复位')
assert(reset, 'tray includes model reset')
assert.equal(snapItem().type, 'checkbox', 'snapping uses the native tray check mark')
assert.equal(snapItem().checked, false, 'saved disabled state starts unchecked')
const center = menu.find(item => item.click === placement.centerMainWindow)
assert(center, 'tray includes the recovery action')
const pet = placement.createMainWindow()
assert.deepEqual(pet.getBounds(), { x: 750, y: 20, width: 420, height: 520 }, 'saved floating positions stay free when snapping is off')
placement.setWindowPosition(pet, 300, 200); placement.clampWindowPosition(pet)
assert.deepEqual(pet.getPosition(), [300, 200], 'drag release keeps an interior position')
config.pet.frameScale = 0.5; placement.applyFrameScale(pet, 0.5)
assert.deepEqual(pet.getBounds(), { x: 405, y: 330, width: 210, height: 260 }, 'floating resize preserves the window center')
config.pet.frameScale = 1; placement.applyFrameScale(pet, 1)
load('src/main/chatWindow.ts').setChatOpen(true)
pet.hide(); pet.setPosition(6000, -3000); center.click()
assert(pet.isVisible() && pet.focused)
assert(load('src/main/chatWindow.ts').getChatWindow().isVisible(), 'docked chat follows tray recovery')
assert.deepEqual([config.pet.winX, config.pet.winY], [750, 520])
console.log('PASS free placement and resizing, independent tray recovery, persistence and docked chat restoration')
Object.assign(display.workArea, { x: -1280, y: 40, width: 1280, height: 720 })
for (const scale of [0.5, 1, 1.4, 3, 5]) {
  config.pet.frameScale = scale
  placement.applyFrameScale(pet, scale)
  center.click()
  const bounds = pet.getBounds(), area = display.workArea
  assert.equal(bounds.y + bounds.height, 760, 'frame bottom must touch taskbar top')
  assert(bounds.x >= area.x && bounds.y >= area.y && bounds.x + bounds.width <= 0)
  assert.equal(bounds.x + bounds.width / 2, -640, 'recovery centers horizontally on the primary display')
  assert.equal(config.pet.frameScale, scale, 'display limits preserve the requested frame scale')
  placement.setWindowPosition(pet, 4000, 3000); placement.clampWindowPosition(pet)
  assert.equal(pet.getBounds().y + pet.getBounds().height, 760, 'offscreen positions are brought into the work area')
}
console.log('PASS scaled and oversized frames and negative monitor coordinates')
config.pet.frameScale = 0.5
placement.applyFrameScale(pet, 0.5)
config.pet.edgeSnapEnabled = true
for (const { from, to } of [
  { from: [-1270, 200], to: [-1280, 200] },
  { from: [-220, 200], to: [-210, 200] },
  { from: [-700, 50], to: [-700, 40] },
  { from: [-700, 490], to: [-700, 500] },
  { from: [-1270, 490], to: [-1280, 500] },
  { from: [-1000, 200], to: [-1000, 200] },
  { from: [-1256, 200], to: [-1280, 200] },
  { from: [-1255, 200], to: [-1255, 200] }
]) {
  placement.setWindowPosition(pet, ...from)
  assert.deepEqual(pet.getPosition(), to, 'nearby edges snap during dragging; interior positions stay free')
  placement.clampWindowPosition(pet)
  assert.deepEqual(pet.getPosition(), to)
}
placement.setWindowPosition(pet, -1220, 200)
assert.deepEqual(pet.getPosition(), [-1220, 200], 'dragging away releases a snapped edge')
config.pet.edgeSnapEnabled = false
placement.setWindowPosition(pet, -1270, 490); placement.clampWindowPosition(pet)
assert.deepEqual(pet.getPosition(), [-1270, 490], 'disabling snapping allows near-edge placement')
center.click()
assert.equal(pet.getBounds().y + pet.getBounds().height, 760, 'tray recovery aligns the toolbar even when snapping is off')
console.log('PASS optional automatic snapping at all four edges, corners, threshold, release and disabled behavior')

// Run both real menu actions and the real config handler against the same window.
placement.setWindowPosition(pet, -1270, 490)
const messageCount = pet.messages.length
snapItem().click()
assert.equal(config.pet.edgeSnapEnabled, true)
assert.equal(snapItem().checked, true)
assert.deepEqual(pet.getPosition(), [-1280, 500], 'enabling snapping also aligns an already nearby edge')
assert.deepEqual([config.pet.winX, config.pet.winY], pet.getPosition(), 'tray snapping saves the resulting position')
assert.deepEqual(pet.messages.slice(messageCount), [[IPC.ConfigChanged]], 'notify the renderer without sending config credentials')
assert(windows.every(win => win.messages.some(message => message[0] === IPC.ConfigChanged)))
snapItem().click()
assert.equal(config.pet.edgeSnapEnabled, false)
assert.equal(snapItem().checked, false)
placement.setWindowPosition(pet, -1270, 490)
assert.deepEqual(pet.getPosition(), [-1270, 490])
config.pet.edgeSnapEnabled = true
tray.createTray()
assert.equal(snapItem().checked, true, 'recreated tray reads the saved enabled state')
snapItem().click()
assert.equal(config.pet.edgeSnapEnabled, false)
Object.assign(config.pet, { scale: 2.5, offsetX: 130, offsetY: -80 })
pet.hide()
const resetPosition = pet.getPosition()
reset.click()
assert.deepEqual([config.pet.scale, config.pet.offsetX, config.pet.offsetY], [1, 0, 0])
assert.deepEqual(pet.getPosition(), resetPosition, 'model reset keeps the frame position')
assert.equal(pet.isVisible(), false, 'model reset works while the pet is hidden')
assert(pet.messages.some(message => message[0] === IPC.PetResetModel), 'reset reaches the renderer immediately')
console.log('PASS tray model reset, native snap checkbox, saved state and renderer notifications')

load('src/main/ipc/index.ts').registerIpc()
;(async () => {
  await handlers.get(IPC.ConfigSet)({}, { pet: { edgeSnapEnabled: true } })
  assert.equal(snapItem().checked, true, 'config updates refresh the tray check mark')
  assert.deepEqual(pet.getPosition(), [-1280, 500], 'IPC and tray apply identical snapping')
  await handlers.get(IPC.ConfigSet)({}, { pet: { edgeSnapEnabled: false } })
  assert.equal(snapItem().checked, false)
  console.log('PASS tray checkbox stays synchronized with settings and IPC updates')
})().catch(error => { console.error(error); process.exitCode = 1 })
