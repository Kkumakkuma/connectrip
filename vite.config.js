import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    host: true,
    allowedHosts: true
  },
  preview: {
    host: true,
    allowedHosts: true
  },
  appType: 'spa'
})
