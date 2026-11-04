const fs = require('node:fs')
const path = require('node:path')
const { spawn } = require('node:child_process')
const root = path.resolve(__dirname, '..')
const profile = path.join(root, '.control-demo-data')
const installed = path.join(process.env.APPDATA || '', 'desktop-companion')
const modelsDirectory = process.env.DESKTOP_COMPANION_MODELS_DIR || path.join(installed, 'models')
const deepseek = path.join(modelsDirectory, 'DeepSeek')
if (!fs.existsSync(path.join(root, 'out/main/index.js'))) { console.error('请先运行 npm run build。'); process.exit(1) }
if (!fs.existsSync(deepseek)) { console.error('没有找到 DeepSeek 模型。可设置 DESKTOP_COMPANION_MODELS_DIR 指向模型总目录。'); process.exit(1) }
const file = fs.readdirSync(deepseek).find(name => name.endsWith('.model3.json'))
if (!file) { console.error('DeepSeek 目录没有 model3.json 文件。'); process.exit(1) }
fs.mkdirSync(profile, { recursive: true })
const configFile = path.join(profile, 'config.json')
if (!fs.existsSync(configFile)) {
  let config = {}
  try { config = JSON.parse(fs.readFileSync(path.join(installed, 'config.json'), 'utf8')) } catch { /* starts with application defaults */ }
  config.pet = { ...config.pet, modelPath: `models/DeepSeek/${file}`, clickThrough: false, locked: false }
  config.controlApi = { enabled: true, endpoint: 'ws://127.0.0.1:18790', listenHost: '127.0.0.1', port: 18790, token: '' }
  config.chat = { ...config.chat, performanceEnabled: true }
  fs.writeFileSync(configFile, JSON.stringify(config, null, 2))
}
const environment = { ...process.env, DESKTOP_COMPANION_DATA_DIR: profile, DESKTOP_COMPANION_MODELS_DIR: modelsDirectory }
delete environment.ELECTRON_RUN_AS_NODE
const child = spawn(require('electron'), [root], { cwd: root, env: environment, windowsHide: true, stdio: 'inherit' })
child.on('error', error => { console.error(error.message); process.exitCode = 1 })
child.on('exit', code => { process.exitCode = code || 0 })
