import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    // `vercel dev` (run at the repo root) serves /api on :3000.
    proxy: {
      '/api': 'http://localhost:3000',
    },
  },
})
