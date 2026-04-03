import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

function getPackageChunkName(id: string) {
  if (!id.includes('node_modules')) {
    return undefined
  }

  const reactPackages = [
    '/react/',
    '/react-dom/',
    '/scheduler/',
    '/react-is/',
    '/use-sync-external-store/',
    '/react-redux/',
    '/redux/',
    '/redux-thunk/',
    '/reselect/',
    '/@reduxjs/toolkit/',
  ]

  if (reactPackages.some(packageName => id.includes(packageName))) {
    return 'framework'
  }

  if (id.includes('/recharts/') || id.includes('/victory-vendor/') || id.includes('/d3-')) {
    return 'charts'
  }

  if (id.includes('@fluentui')) {
    return 'fluent'
  }

  if (id.includes('@heroicons')) {
    return 'icons'
  }

  return 'framework'
}

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'static',
    emptyOutDir: true,
    chunkSizeWarningLimit: 650,
    rollupOptions: {
      input: 'index.html',
      output: {
        manualChunks: getPackageChunkName,
        entryFileNames: 'js/index.js',
        chunkFileNames: 'js/[name]-[hash].js',
        assetFileNames: (assetInfo) => {
          if (assetInfo.name?.endsWith('.css')) {
            return 'assets/index.css'
          }
          return 'assets/[name]-[hash].[ext]'
        }
      }
    }
  },
  server: {
    proxy: {
      '/api': 'http://localhost:8000',
      '/ws': {
        target: 'ws://localhost:8000',
        ws: true
      }
    }
  }
})
