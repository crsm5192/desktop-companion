export const PANEL_NAMES = ['chat', 'music', 'pomodoro', 'todo', 'diary', 'actions', 'settings'] as const
export type PanelWindowName = typeof PANEL_NAMES[number]
export type PanelWindowState = Partial<Record<PanelWindowName, boolean>>
export function isPanelWindowName(value: unknown): value is PanelWindowName {
  return PANEL_NAMES.includes(value as PanelWindowName)
}
