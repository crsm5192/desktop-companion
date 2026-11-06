import { BrowserWindow, screen, shell } from 'electron'
import { join } from 'node:path'
import { IPC } from '../shared/constants'
import { PANEL_NAMES, type PanelWindowName, type PanelWindowState } from '../shared/panelWindows'
import { getConfig } from './config'
import { placeChatWindow } from './chatPlacement'

const definitions = {
  chat: { title: '对话', width: 360, height: 520 },
  music: { title: '音乐', width: 360, height: 520 },
  pomodoro: { title: '番茄钟', width: 320, height: 300 },
  todo: { title: '待办', width: 360, height: 460 },
  diary: { title: '日记', width: 420, height: 560 },
  actions: { title: '表情与动作', width: 420, height: 520 },
  settings: { title: '设置', width: 460, height: 640 }
}
interface Panel { win: BrowserWindow; opened: boolean; docked: boolean; moving: boolean }
const panels = new Map<PanelWindowName, Panel>()
let petWindow: BrowserWindow | null = null

export function getPanelWindow(name: PanelWindowName): BrowserWindow | null { return panels.get(name)?.win ?? null }
export function isPanelOpen(name: PanelWindowName): boolean { return panels.get(name)?.opened ?? false }
export function getPanelWindowState(): PanelWindowState {
  return Object.fromEntries(PANEL_NAMES.map(name => [name, isPanelOpen(name)]))
}
function announce(): void {
  if (!petWindow || petWindow.isDestroyed()) return
  petWindow.webContents.send(IPC.PanelWindowState, getPanelWindowState())
  petWindow.webContents.send(IPC.ChatWindowState, isPanelOpen('chat'))
}
function show(panel: Panel, activate: boolean): void {
  if (panel.win.isDestroyed() || !petWindow?.isVisible()) return
  // Some hidden launchers ignore the first native show request.
  for (let attempt = 0; attempt < 2; attempt++) {
    if (activate) panel.win.show()
    else panel.win.showInactive()
    if (panel.win.isVisible()) break
  }
}
export function dockPanelWindow(name: PanelWindowName): void {
  const panel = panels.get(name)
  if (!panel || panel.win.isDestroyed() || !petWindow || petWindow.isDestroyed()) return
  const pet = petWindow.getBounds()
  const work = screen.getDisplayMatching(pet).workArea
  const bounds = placeChatWindow(pet, work, panel.win.getBounds())
  panel.docked = true
  panel.moving = true
  try { panel.win.setBounds(bounds) } finally { panel.moving = false }
}
function keepOnScreen(name: PanelWindowName, panel: Panel): void {
  if (panel.docked) { dockPanelWindow(name); return }
  const bounds = panel.win.getBounds()
  const work = screen.getDisplayMatching(bounds).workArea
  const width = Math.min(bounds.width, work.width), height = Math.min(bounds.height, work.height)
  panel.moving = true
  try {
    panel.win.setBounds({ width, height,
      x: Math.max(work.x, Math.min(bounds.x, work.x + work.width - width)),
      y: Math.max(work.y, Math.min(bounds.y, work.y + work.height - height)) })
  } finally { panel.moving = false }
}
export function updatePanelOpacity(): void {
  const configured = getConfig().pet.panelOpacity ?? 1
  const opacity = Number.isFinite(configured) ? Math.max(0.2, Math.min(1, configured)) : 1
  for (const panel of panels.values()) if (!panel.win.isDestroyed()) panel.win.setOpacity(opacity)
}
export function bindPanelWindows(pet: BrowserWindow): void {
  petWindow = pet
  const follow = (): void => {
    for (const [name, panel] of panels) if (panel.opened && panel.docked) dockPanelWindow(name)
  }
  const onDisplayChange = (): void => { for (const [name, panel] of panels) keepOnScreen(name, panel) }
  pet.on('move', follow)
  pet.on('resize', follow)
  pet.on('hide', () => { for (const panel of panels.values()) panel.win.hide() })
  pet.on('show', () => {
    follow()
    for (const panel of panels.values()) if (panel.opened) show(panel, false)
  })
  pet.webContents.on('did-finish-load', announce)
  pet.on('closed', () => {
    petWindow = null
    destroyPanelWindows()
    screen.removeListener('display-metrics-changed', onDisplayChange)
    screen.removeListener('display-removed', onDisplayChange)
    screen.removeListener('display-added', onDisplayChange)
  })
  screen.on('display-metrics-changed', onDisplayChange)
  screen.on('display-removed', onDisplayChange)
  screen.on('display-added', onDisplayChange)
}
export function setPanelOpen(name: PanelWindowName, opened: boolean): boolean {
  let panel = panels.get(name)
  if (!opened) {
    if (panel) { panel.opened = false; panel.win.hide() }
    announce()
    return false
  }
  if (!panel || panel.win.isDestroyed()) {
    const definition = definitions[name]
    const win = new BrowserWindow({
      width: definition.width, height: definition.height, minWidth: 280, minHeight: 260,
      frame: false, show: false, transparent: true, resizable: true, maximizable: false,
      skipTaskbar: true, alwaysOnTop: true, backgroundColor: '#00000000',
      title: `桌面宠物 · ${definition.title}`,
      webPreferences: {
        preload: join(__dirname, '../preload/index.js'),
        contextIsolation: true, nodeIntegration: false, sandbox: false,
        backgroundThrottling: false, autoplayPolicy: 'no-user-gesture-required'
      }
    })
    panel = { win, opened: true, docked: true, moving: false }
    panels.set(name, panel)
    const entry = panel
    win.setAlwaysOnTop(true, 'floating')
    win.on('will-move', () => { if (!entry.moving) entry.docked = false })
    win.on('will-resize', () => { if (!entry.moving) entry.docked = false })
    win.on('close', event => { event.preventDefault(); setPanelOpen(name, false) })
    win.on('closed', () => {
      panels.delete(name)
      if (name === 'chat' && petWindow && !petWindow.isDestroyed()) petWindow.webContents.send(IPC.PetSpeaking, false)
      announce()
    })
    win.webContents.setWindowOpenHandler(({ url }) => { void shell.openExternal(url); return { action: 'deny' } })
    updatePanelOpacity()
    const hash = name === 'chat' ? 'chat' : `panel=${name}`
    void win.loadURL(`${process.env['ELECTRON_RENDERER_URL'] || 'app://bundle/index.html'}#${hash}`)
  }
  panel.opened = true
  if (panel.docked) dockPanelWindow(name)
  show(panel, true)
  announce()
  return true
}
export function destroyPanelWindows(): void {
  for (const panel of [...panels.values()]) panel.win.destroy()
}
