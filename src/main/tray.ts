import { app, Menu, Tray, nativeImage } from 'electron'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { centerMainWindow, getMainWindow } from './window'
import { getConfig, setConfig } from './config'
import { applyPetWindowSettings, broadcastConfigChanged } from './petSettings'
import { IPC } from '../shared/constants'

let tray: Tray | null = null
let clickThrough = false

export function createTray(): void {
  const iconPath = app.isPackaged
    ? join(process.resourcesPath, 'tray.png') // 打包后：extraResources 拷到 resources 根
    : join(__dirname, '../../resources/tray.png') // 开发：项目 resources 目录
  if (!existsSync(iconPath)) {
    console.warn('[tray] 未找到 resources/tray.png，跳过托盘。放一张 16x16/32x32 的 png 后自动启用。')
    return
  }

  const icon = nativeImage.createFromPath(iconPath)
  tray = new Tray(icon)
  tray.setToolTip('桌面宠物')

  refreshTrayMenu()
  tray.on('click', toggleWindow)
}

export function refreshTrayMenu(): void {
  if (!tray) return
  const menu = Menu.buildFromTemplate([
    { label: '显示 / 隐藏', click: toggleWindow },
    { label: '复位', toolTip: '模型回到框架中心，缩放恢复 1×', click: resetModel },
    { label: '吸附', type: 'checkbox', checked: getConfig().pet.edgeSnapEnabled === true, click: toggleEdgeSnap },
    { label: '框架回到屏幕下方正中', click: centerMainWindow },
    { label: '切换点击穿透', click: toggleClickThrough },
    { type: 'separator' },
    { label: '退出', click: () => app.quit() }
  ])
  tray.setContextMenu(menu)
}

function resetModel(): void {
  setConfig({ pet: { scale: 1, offsetX: 0, offsetY: 0 } })
  getMainWindow()?.webContents.send(IPC.PetResetModel)
  broadcastConfigChanged()
}

function toggleEdgeSnap(): void {
  const patch = { edgeSnapEnabled: !getConfig().pet.edgeSnapEnabled }
  setConfig({ pet: patch })
  applyPetWindowSettings(patch)
  refreshTrayMenu()
  broadcastConfigChanged()
}

function toggleWindow(): void {
  const win = getMainWindow()
  if (!win) return
  if (win.isVisible()) win.hide()
  else win.show()
}

function toggleClickThrough(): void {
  const win = getMainWindow()
  if (!win) return
  clickThrough = !clickThrough
  // forward: true —— 穿透时仍接收 mousemove，便于恢复交互（Windows）
  win.setIgnoreMouseEvents(clickThrough, { forward: true })
}
