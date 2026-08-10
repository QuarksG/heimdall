import { defineConfig, mergeConfig } from 'vitest/config'
import viteConfig from './vite.config'

// Reuse the existing Vite toolchain (plugins, resolution) for tests.
// The jsdom environment provides DOMParser for later OOXML structural tests.
export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      environment: 'jsdom',
      globals: true,
      include: ['src/**/*.{test,spec}.{ts,tsx}'],
      // No tests exist yet; later tasks add them. Keeps `npm run test` green.
      passWithNoTests: true,
    },
  }),
)
