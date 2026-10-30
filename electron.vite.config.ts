import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: {
        '@shared': resolve('src/shared')
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: {
        '@shared': resolve('src/shared')
      }
    }
  },
  renderer: {
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src'),
        '@shared': resolve('src/shared')
      }
    },
    plugins: [react()],
    optimizeDeps: {
      // 不要把 easy-live2d 预构建进缓存。
      // 原因：scripts/patch-easy-live2d.mjs 会修补它的 CubismLogError 调用，
      // 但 vite 的依赖预构建缓存会保留"打补丁之前"的副本，导致 dev 下补丁失效
      // （表现为 new CubismLogError → TypeError → 遮罩超限的模型白屏）。
      // 排除后由 vite 直接按源码模块处理，补丁立即生效。
      exclude: ['easy-live2d']
    },
    server: {
      watch: {
        // 不监听 models/music 这类大体积静态资源，避免拷贝时 EBUSY 导致 dev 崩溃
        ignored: ['**/public/models/**', '**/public/music/**']
      }
    }
  }
})
