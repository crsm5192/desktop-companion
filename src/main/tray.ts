import { app, Menu, Tray, nativeImage } from 'electron'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { getMainWindow } from './window'
import { getConfig } from './config'

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
  tray.setToolTip(getConfig().character?.name || '桌面伴侣')

  const menu = Menu.buildFromTemplate([
    { label: '显示 / 隐藏', click: toggleWindow },
    { label: '切换点击穿透', click: toggleClickThrough },
    { type: 'separator' },
    { label: '退出', click: () => app.quit() }
  ])
  tray.setContextMenu(menu)
  tray.on('click', toggleWindow)
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
