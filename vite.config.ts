import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    watch: {
      // Don't let Vite's file watcher lock Amplify's build artifacts or the
      // worker's temp files — that causes EPERM/EBUSY during sandbox deploys.
      ignored: ['**/.amplify/**', '**/worker/**', '**/temp_*.wav'],
    },
  },
})
