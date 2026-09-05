import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    // Emit dist/.vite/manifest.json (module-to-chunk mapping) for the
    // build verification script (scripts/verify-bundle-split.mjs)
    manifest: true,
  },
})
