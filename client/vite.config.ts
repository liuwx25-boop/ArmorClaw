import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import electron from 'vite-plugin-electron'
import renderer from 'vite-plugin-electron-renderer'
import path from 'path'
import fs from 'fs'

// 从统一配置文件读取服务端地址
const defaultConfig = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, 'default-config.json'), 'utf-8')
)

export default defineConfig({
  plugins: [
    react(),
    electron([
      {
        entry: 'electron/main.ts',
        onstart(options) {
          options.startup()
        },
        vite: {
          build: {
            outDir: 'dist-electron',
            rollupOptions: {
              external: ['electron', 'node-pty']
            }
          }
        }
      },
      {
        entry: 'electron/preload.ts',
        onstart(options) {
          options.reload()
        },
        vite: {
          build: {
            outDir: 'dist-electron'
          }
        }
      }
    ]),
    renderer()
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src')
    }
  },
  define: {
    'import.meta.env.VITE_API_BASE_URL': JSON.stringify(defaultConfig.serverApiBaseUrl),
    'import.meta.env.VITE_DOC_URL': JSON.stringify(defaultConfig.docUrl),
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true
  }
})
