import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig(({ mode }) => ({
  base: './',
  plugins: [react()],
  // QA demo capability is derived from the explicit build mode, not an .env
  // file. This keeps credential-shaped files out of the repository while the
  // normal production build remains demo-disabled.
  define: {
    'import.meta.env.VITE_ALLOW_DEMO': JSON.stringify(mode === 'qa' ? 'true' : '')
  },
  server: {
    host: '127.0.0.1',
    port: 5173
  },
  build: {
    outDir: 'dist',
    sourcemap: true
  }
}))
