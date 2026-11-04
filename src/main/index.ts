import { app, BrowserWindow } from 'electron'
import { createMainWindow, getMainWindow } from './window'
import { createTray } from './tray'
import { registerIpc } from './ipc'
import { getConfig } from './config'
import { writeDiagnostic } from './services/diagnostic'
import { mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { bindControlWindow, configureControlApi, registerControlIpc } from './services/control'

// Allows a separate development/test profile without touching the user's installed app.
if (process.env.DESKTOP_COMPANION_DATA_DIR) {
  const dataDirectory = resolve(process.env.DESKTOP_COMPANION_DATA_DIR)
  mkdirSync(dataDirectory, { recursive: true })
  app.setPath('userData', dataDirectory)
}

// 单实例锁：桌面宠物只需要一个进程
const gotLock = app.requestSingleInstanceLock()

if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    const win = getMainWindow()
    if (win) {
      win.show()
      win.focus()
    }
  })

  app.whenReady().then(() => {
    // 先加载配置，后面 IPC 处理器都依赖它
    getConfig()
    registerIpc()
    registerControlIpc()

    const win = createMainWindow()
    bindControlWindow()
    void configureControlApi()
    createTray()

    // 写诊断日志（exe 旁 diagnostic.log），排查模型/音乐路径问题
    writeDiagnostic()

    // 根据配置应用点击穿透
    if (getConfig().pet.clickThrough) {
      win.setIgnoreMouseEvents(true, { forward: true })
    }

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createMainWindow()
    })
  })
}

// 桌面宠物常驻：关闭窗口默认隐藏而非退出，从托盘「退出」才真正退出
app.on('window-all-closed', () => {
  // 故意留空 —— 不调用 app.quit()
})
