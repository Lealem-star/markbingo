import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    allowedHosts: [
      'localhost',
      '127.0.0.1'
    ]
  },
  define: {
    'import.meta.env.VITE_API_URL': JSON.stringify(process.env.VITE_API_URL || 'https://fikirbingo.com'),
    'import.meta.env.VITE_WS_URL': JSON.stringify(process.env.VITE_WS_URL || 'wss://fikirbingo.com/ws'),
  }
})
