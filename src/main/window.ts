import { app, BrowserWindow, shell, protocol, net, screen, type Rectangle } from 'electron'
import { join, normalize, extname, resolve } from 'node:path'
import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { getConfig, setConfig } from './config'
import { externalModelsDir, externalMusicDir } from './paths'
import { bindChatWindow, destroyChatWindow } from './chatWindow'
import { snapWindowPosition } from './windowPlacement'

// 让 app:// 协议支持 fetch（打包后渲染层用 fetch 加载模型/贴图必需），必须在 app ready 前声明
protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } }
])

let mainWindow: BrowserWindow | null = null
let quitting = false
let screenBound = false

const WIN_WIDTH = 420
const WIN_HEIGHT = 520
let appProtocolRegistered = false

function frameSize(scale: number, workArea: Rectangle): { width: number; height: number } {
  return {
    width: Math.min(Math.round(WIN_WIDTH * scale), workArea.width),
    height: Math.min(Math.round(WIN_HEIGHT * scale), workArea.height)
  }
}

/** 模型目录：打包后 exe 旁，开发用 public */
function modelsDir(): string {
  if (process.env.DESKTOP_COMPANION_MODELS_DIR) return resolve(process.env.DESKTOP_COMPANION_MODELS_DIR)
  return app.isPackaged
    ? externalModelsDir()
    : join(app.getAppPath(), 'src', 'renderer', 'public', 'models')
}

/** 音乐目录：打包后 exe 旁，开发用 public */
function musicDir(): string {
  return app.isPackaged
    ? externalMusicDir()
    : join(app.getAppPath(), 'src', 'renderer', 'public', 'music')
}

const MIME: Record<string, string> = {
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.flac': 'audio/flac',
  '.ogg': 'audio/ogg',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.json': 'application/json',
  '.moc3': 'application/octet-stream',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.css': 'text/css',
  '.html': 'text/html',
  '.wasm': 'application/wasm'
}

function mimeFor(p: string): string {
  return MIME[extname(p).toLowerCase()] || 'application/octet-stream'
}

/** 注册 app:// 协议（dev + prod 都注册），直接读磁盘 + 正确 MIME + Range 支持，不依赖 Vite */
function registerAppProtocol(): void {
  if (appProtocolRegistered) return
  appProtocolRegistered = true
  protocol.handle('app', (request) => {
    const url = new URL(request.url)
    let p = decodeURIComponent(url.pathname)
    if (p === '/' || p === '') p = '/index.html'
    let full: string
    if (p.startsWith('/models/')) {
      full = normalize(join(modelsDir(), p.slice('/models/'.length)))
    } else if (p.startsWith('/music/')) {
      full = normalize(join(musicDir(), p.slice('/music/'.length)))
    } else {
      full = normalize(join(__dirname, '../renderer', p))
    }
    try {
      const buf = readFileSync(full)
      const range = request.headers.get('Range')
      if (range) {
        const m = /bytes=(\d+)-(\d*)/.exec(range)
        if (m) {
          const start = parseInt(m[1], 10)
          const end = m[2] ? Math.min(parseInt(m[2], 10), buf.length - 1) : buf.length - 1
          const slice = buf.subarray(start, end + 1)
          return new Response(slice, {
            status: 206,
            headers: {
              'Content-Type': mimeFor(full),
              'Content-Range': `bytes ${start}-${end}/${buf.length}`,
              'Content-Length': String(slice.length),
              'Accept-Ranges': 'bytes'
            }
          })
        }
      }
      return new Response(buf, {
        headers: {
          'Content-Type': mimeFor(full),
          'Content-Length': String(buf.length),
          'Accept-Ranges': 'bytes'
        }
      })
    } catch {
      return new Response('Not Found', { status: 404, headers: { 'Content-Type': 'text/plain' } })
    }
  })
}

app.on('before-quit', () => {
  quitting = true
  destroyChatWindow()
})

export function createMainWindow(): BrowserWindow {
  const cfg = getConfig()
  const fs = cfg.pet.frameScale ?? 1
  mainWindow = new BrowserWindow({
    width: Math.round(WIN_WIDTH * fs),
    height: Math.round(WIN_HEIGHT * fs),
    frame: false, // 无边框
    transparent: true, // 透明背景（桌面宠物关键）
    alwaysOnTop: true, // 置顶
    resizable: false,
    hasShadow: false,
    backgroundColor: '#00000000', // 透明窗初始底色，避免白/黑闪
    skipTaskbar: true, // 不占任务栏，常驻托盘（桌宠）
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      autoplayPolicy: 'no-user-gesture-required' // 允许无手势自动播放语音
    }
  })

  mainWindow.setAlwaysOnTop(true, 'screen-saver')
  bindChatWindow(mainWindow)

  // 恢复上次保存的位置；仅将越出屏幕的部分移回工作区。
  if (cfg.pet.winX !== null && cfg.pet.winY !== null) {
    mainWindow.setPosition(cfg.pet.winX, cfg.pet.winY)
  }
  clampWindowPosition(mainWindow)

  // 屏幕分辨率/显示器变化时重新钳制，防止窗口跑到屏幕外
  if (!screenBound) {
    screenBound = true
    const onScreenChange = (): void => {
      if (mainWindow) clampWindowPosition(mainWindow)
    }
    screen.on('display-metrics-changed', onScreenChange)
    screen.on('display-removed', onScreenChange)
    screen.on('display-added', onScreenChange)
  }

  // 点关闭 = 隐藏到托盘，不真正退出
  mainWindow.on('close', (e) => {
    if (!quitting && mainWindow) {
      e.preventDefault()
      mainWindow.hide()
    }
  })

  // 外部链接用系统浏览器打开
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  // 注册 app:// 协议（dev + prod），服务 models/ + music/ 静态资源
  registerAppProtocol()

  // 开发模式加载 dev server，生产模式用 app:// 协议加载打包产物
  if (process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadURL('app://bundle/index.html')
  }

  return mainWindow
}

export function getMainWindow(): BrowserWindow | null {
  return mainWindow
}

/** 托盘找回整个框架：主屏幕下方居中，底部按钮贴任务栏上缘。 */
export function centerMainWindow(): void {
  const win = mainWindow
  if (!win || win.isDestroyed()) return
  const { workArea } = screen.getPrimaryDisplay()
  const { width, height } = frameSize(getConfig().pet.frameScale ?? 1, workArea)
  const x = Math.round(workArea.x + (workArea.width - width) / 2)
  const y = workArea.y + workArea.height - height
  win.setBounds({ x, y, width, height })
  const [winX, winY] = win.getPosition()
  setConfig({ pet: { winX, winY } })
  win.show()
  win.focus()
}

/** 自由拖动框架；吸附开启时，靠近工作区边缘立即贴边。 */
export function setWindowPosition(win: BrowserWindow, x: number, y: number): void {
  const s = getConfig().pet.frameScale ?? 1
  const [oldWidth, oldHeight] = win.getSize()
  const { workArea } = screen.getDisplayNearestPoint({ x: Math.round(x + oldWidth / 2), y: Math.round(y + oldHeight / 2) })
  const size = frameSize(s, workArea)
  const bounds = { x: Math.round(x), y: Math.round(y), ...size }
  const position = getConfig().pet.edgeSnapEnabled ? snapWindowPosition(bounds, workArea) : bounds
  win.setBounds({
    x: position.x,
    y: position.y,
    ...size
  })
}

/** 缩放以窗口中心为锚；已经贴边时保留该边的位置。 */
export function applyFrameScale(win: BrowserWindow, scale: number): void {
  const [oldW, oldH] = win.getSize()
  const [x, y] = win.getPosition()
  const { workArea } = screen.getDisplayNearestPoint({ x: x + Math.round(oldW / 2), y: y + Math.round(oldH / 2) })
  const { width: w, height: h } = frameSize(scale, workArea)
  const atBottom = Math.abs(y + oldH - workArea.y - workArea.height) <= 1
  const atTop = Math.abs(y - workArea.y) <= 1
  const atRight = Math.abs(x + oldW - workArea.x - workArea.width) <= 1
  const atLeft = Math.abs(x - workArea.x) <= 1
  win.setBounds({
    x: atRight ? workArea.x + workArea.width - w : atLeft ? workArea.x : x + Math.round((oldW - w) / 2),
    y: atBottom ? workArea.y + workArea.height - h : atTop ? workArea.y : y + Math.round((oldH - h) / 2),
    width: w,
    height: h
  })
  clampWindowPosition(win)
}

/** 保证框架可操作；普通位置保持自由，吸附由开关决定。 */
export function clampWindowPosition(win: BrowserWindow): void {
  const [w, h] = win.getSize()
  const [x, y] = win.getPosition()
  const display = screen.getDisplayNearestPoint({ x: x + Math.round(w / 2), y: y + Math.round(h / 2) })
  const { workArea } = display
  const { width, height } = frameSize(getConfig().pet.frameScale ?? 1, workArea)
  const cx = Math.min(Math.max(x, workArea.x), workArea.x + workArea.width - width)
  const cy = Math.min(Math.max(y, workArea.y), workArea.y + workArea.height - height)
  const bounds = { x: cx, y: cy, width, height }
  const position = getConfig().pet.edgeSnapEnabled ? snapWindowPosition(bounds, workArea) : bounds
  if (position.x !== x || position.y !== y || width !== w || height !== h) win.setBounds({ ...bounds, x: position.x, y: position.y })
}
