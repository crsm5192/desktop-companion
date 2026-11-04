import { BrowserWindow } from 'electron'
import { IPC } from '../shared/constants'
import type { DeepPartial, PetConfig } from '../shared/types'
import { setConfig } from './config'
import { applyFrameScale, clampWindowPosition, getMainWindow } from './window'

/** Apply saved pet settings to the native window from either IPC or the tray. */
export function applyPetWindowSettings(patch?: DeepPartial<PetConfig>): void {
  const win = getMainWindow()
  if (!win) return
  if (typeof patch?.frameScale === 'number') applyFrameScale(win, patch.frameScale)
  if (patch?.edgeSnapEnabled === true) {
    clampWindowPosition(win)
    const [winX, winY] = win.getPosition()
    setConfig({ pet: { winX, winY } })
  }
}

export function broadcastConfigChanged(): void {
  // Signal only; each window fetches its config without broadcasting credentials.
  for (const win of BrowserWindow.getAllWindows()) win.webContents.send(IPC.ConfigChanged)
}
