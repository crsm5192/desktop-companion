/**
 * 修补 easy-live2d，让「遮罩数超限」的模型也能正常显示。
 *
 * 问题一：new 一个箭头函数
 * ------------------------
 * easy-live2d 把日志函数定义成箭头函数：
 *     CubismLogError = (fmt, ...args) => { ... }
 * 但内部 20 处沿用 Cubism 官方示例写成 `new CubismLogError("...")`。
 * 箭头函数没有 [[Construct]]，`new` 必然抛：
 *     TypeError: CubismLogError is not a constructor
 *
 * 危害：这些调用点本意都是「报警后继续降级」。典型如 setupLayoutBounds：
 *     if (usingClipCount > max) { new CubismLogError(...) }   // 想报警
 *     for (...) { ...把遮罩降级成全屏... }                     // 然后降级
 * TypeError 在第一步就抛出 → 降级代码永远跑不到 → 遮罩布局没初始化 →
 * 模型"加载成功"但画面一片空白。
 *
 * 问题二：单渲染纹理的遮罩上限太小
 * --------------------------------
 *     useClippingMaskMaxCount = _renderTextureCount <= 1
 *       ? 36                                      // 单纹理：最多 36 个遮罩
 *       : 32 * _renderTextureCount                // 多纹理：每张 32 个
 * 有些模型（如带大量 VTS 特效的）会用 40~60 个遮罩，单纹理下必然超限。
 * 提高渲染纹理数量即可抬高上限（2 张 → 64 个）。
 *
 * 修复内容
 * --------
 *  1. `new CubismLogXxx(` → `CubismLogXxx(`   —— 让报警不再打断降级
 *  2. `initialize(model, maskBufferCount = 1)` → `= 2`  —— 遮罩上限 36 → 64
 *
 * 该脚本在 postinstall / dev / build 前自动执行；幂等，可重复运行。
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const distDir = join(here, '..', 'node_modules', 'easy-live2d', 'dist')

/** 遮罩渲染纹理数量：2 张 → 上限 32*2 = 64 个遮罩（覆盖绝大多数模型） */
const RENDER_TEXTURE_COUNT = 2

const LOG_RE = /new\s+(CubismLog(?:Error|Warning|Info|Debug))\s*\(/g

/**
 * 遮罩渲染纹理数量的真正入口是 `createRenderer(maskBufferCount = 1)`，
 * 它一路传给 CubismClippingManager.initialize(model, renderTextureCount)。
 * 同时兼容其它可能带默认值的 initialize 重载。
 */
const MASK_COUNT_PATTERNS = [
  /createRenderer\(\s*maskBufferCount\s*=\s*\d+\s*\)/g,
  /initialize\(\s*model\s*,\s*maskBufferCount\s*=\s*\d+\s*\)/g
]

const files = ['index.js', 'index.cjs']
let totalLog = 0
let totalInit = 0

for (const f of files) {
  const p = join(distDir, f)
  if (!existsSync(p)) continue

  let src = readFileSync(p, 'utf8')
  let changed = false

  // ---- 修复一：new CubismLogXxx → CubismLogXxx ----
  const logMatches = src.match(LOG_RE)
  if (logMatches && logMatches.length > 0) {
    LOG_RE.lastIndex = 0
    src = src.replace(LOG_RE, (_m, fn) => `${fn}(`)
    totalLog += logMatches.length
    changed = true
  }

  // ---- 修复二：提高遮罩渲染纹理数量 ----
  let initFixed = 0
  for (const re of MASK_COUNT_PATTERNS) {
    const ms = src.match(re)
    if (!ms || ms.length === 0) continue
    re.lastIndex = 0
    src = src.replace(re, (full) => full.replace(/=\s*\d+\s*\)$/, `= ${RENDER_TEXTURE_COUNT})`))
    initFixed += ms.length
    changed = true
  }
  totalInit += initFixed

  if (changed) {
    writeFileSync(p, src, 'utf8')
    const parts = []
    if (logMatches?.length) parts.push(`${logMatches.length} 处 new CubismLog*`)
    if (initFixed > 0) parts.push(`遮罩纹理数→${RENDER_TEXTURE_COUNT}（${initFixed} 处）`)
    console.log(`[patch-live2d] ${f}: ${parts.join('，')}`)
  } else {
    console.log(`[patch-live2d] ${f}: 已是修补后状态，跳过`)
  }
}

if (totalLog + totalInit > 0) {
  console.log(
    `[patch-live2d] 完成：修正 ${totalLog} 处日志调用，遮罩纹理数 ${totalInit} 处。` +
      `超出 36 个遮罩的模型现在可正常渲染（上限提升到 ${32 * RENDER_TEXTURE_COUNT}）。`
  )
} else {
  console.log('[patch-live2d] 全部已修补，无操作。')
}
