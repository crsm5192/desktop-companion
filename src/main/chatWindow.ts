import type { BrowserWindow } from 'electron'
import { bindPanelWindows, destroyPanelWindows, dockPanelWindow, getPanelWindow, isPanelOpen, setPanelOpen } from './panelWindows'

export const bindChatWindow = bindPanelWindows
export const destroyChatWindow = destroyPanelWindows
export function getChatWindow(): BrowserWindow | null { return getPanelWindow('chat') }
export function isChatOpen(): boolean { return isPanelOpen('chat') }
export function dockChatWindow(): void { dockPanelWindow('chat') }
export function setChatOpen(open: boolean): boolean { return setPanelOpen('chat', open) }
