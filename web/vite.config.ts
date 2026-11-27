import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// In development (npm run dev) the API and gun folders come from the Python server on :8080.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://127.0.0.1:8080',
      '/guns': 'http://127.0.0.1:8080',
    },
  },
  build: {
    outDir: 'dist',
    chunkSizeWarningLimit: 1500,
  },
})
