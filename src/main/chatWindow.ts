import { BrowserWindow, screen, shell } from 'electron'
import { join } from 'node:path'
import { IPC } from '../shared/constants'
import { placeChatWindow } from './chatPlacement'

let petWindow: BrowserWindow | null = null
let chatWindow: BrowserWindow | null = null
let opened = false
let docked = true
let ready = false
let moving = false

function announce(): void {
  if (petWindow && !petWindow.isDestroyed()) petWindow.webContents.send(IPC.ChatWindowState, opened)
}

export function isChatOpen(): boolean { return opened }
export function getChatWindow(): BrowserWindow | null { return chatWindow }

export function dockChatWindow(): void {
  if (!chatWindow || !petWindow || chatWindow.isDestroyed() || petWindow.isDestroyed()) return
  docked = true
  const pet = petWindow.getBounds()
  const work = screen.getDisplayMatching(pet).workArea
  const bounds = placeChatWindow(pet, work, chatWindow.getBounds())
  moving = true
  chatWindow.setBounds({ x: Math.round(bounds.x), y: Math.round(bounds.y), width: Math.round(bounds.width), height: Math.round(bounds.height) })
  moving = false
}

export function bindChatWindow(pet: BrowserWindow): void {
  petWindow = pet
  const follow = (): void => { if (opened && docked) dockChatWindow() }
  const onDisplayChange = (): void => { dockChatWindow() }
  pet.on('move', follow)
  pet.on('resize', follow)
  pet.on('hide', () => chatWindow?.hide())
  pet.on('show', () => { if (opened && ready) { follow(); chatWindow?.showInactive() } })
  pet.webContents.on('did-finish-load', announce)
  pet.on('closed', () => {
    petWindow = null
    chatWindow?.destroy()
    screen.removeListener('display-metrics-changed', onDisplayChange)
    screen.removeListener('display-removed', onDisplayChange)
    screen.removeListener('display-added', onDisplayChange)
  })
  screen.on('display-metrics-changed', onDisplayChange)
  screen.on('display-removed', onDisplayChange)
  screen.on('display-added', onDisplayChange)
}

export function setChatOpen(value: boolean): boolean {
  opened = value
  if (!opened) {
    chatWindow?.hide()
    announce()
    return false
  }
  if (!chatWindow || chatWindow.isDestroyed()) {
    ready = false
    docked = true
    const win = new BrowserWindow({
      width: 360, height: 520, minWidth: 280, minHeight: 260,
      frame: false, show: false, resizable: true, maximizable: false,
      skipTaskbar: true, alwaysOnTop: true, backgroundColor: '#fcfaff',
      title: '桌面宠物 · 对话',
      webPreferences: {
        preload: join(__dirname, '../preload/index.js'),
        contextIsolation: true, nodeIntegration: false, sandbox: false,
        backgroundThrottling: false, autoplayPolicy: 'no-user-gesture-required'
      }
    })
    chatWindow = win
    // Below the pet's screen-saver level, so even on a tiny display the pet stays visible.
    win.setAlwaysOnTop(true, 'floating')
    win.on('will-move', () => { if (!moving) docked = false })
    win.on('will-resize', () => { if (!moving) docked = false })
    win.on('close', (event) => { event.preventDefault(); setChatOpen(false) })
    win.on('closed', () => {
      chatWindow = null
      ready = false
      opened = false
      if (petWindow && !petWindow.isDestroyed()) petWindow.webContents.send(IPC.PetSpeaking, false)
      announce()
    })
    win.once('ready-to-show', () => {
      ready = true
      if (opened && petWindow?.isVisible()) { dockChatWindow(); win.show() }
    })
    win.webContents.setWindowOpenHandler(({ url }) => { void shell.openExternal(url); return { action: 'deny' } })
    void win.loadURL(`${process.env['ELECTRON_RENDERER_URL'] || 'app://bundle/index.html'}#chat`)
  }
  if (docked) dockChatWindow()
  if (ready && petWindow?.isVisible()) chatWindow.show()
  announce()
  return opened
}

export function destroyChatWindow(): void { chatWindow?.destroy() }
