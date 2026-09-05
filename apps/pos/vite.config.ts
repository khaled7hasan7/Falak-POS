import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      // الواجهة تتحدث مع الوكيل المحلي فقط (docs/adr/ADR-001)
      '/api': {
        target: process.env.VITE_AGENT_URL ?? 'http://localhost:5111',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
})
