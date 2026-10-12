import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  // Parallel E2E shards each run their own dev server; sharing one dep cache would
  // let them race on the first optimise (see scripts/e2e.sh --parallel).
  cacheDir: process.env.VITE_CACHE_DIR || undefined,
  build: {
    chunkSizeWarningLimit: 1400,
  },
  server: {
    // Overridable so the E2E runner can point a throwaway dev server at its own
    // isolated backend instead of the developer's (see scripts/e2e.sh).
    port: Number(process.env.VITE_PORT) || 5173,
    proxy: {
      '/api': {
        target: process.env.VITE_API_TARGET || 'http://localhost:8000',
        changeOrigin: true,
      },
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test-setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      // The app, not its build config; main.tsx only mounts <App /> and is
      // what the E2E suite's smoke spec is for.
      include: ['src/**'],
      exclude: ['src/main.tsx', 'src/**/__tests__/**', 'src/test-setup.ts', 'src/**/*.d.ts'],
      // Floors a few points under today's figures — raise them as coverage
      // rises. The globs hold the code every request passes through (the api
      // interceptor, auth state, the edit lock, the password policy) to its own
      // floor, so a gap there can't hide inside the total.
      thresholds: {
        statements: 94,
        branches: 85,
        functions: 80,
        lines: 94,
        'src/services/api.ts': { statements: 95, branches: 90, functions: 95, lines: 95 },
        'src/stores/authStore.ts': { statements: 95, branches: 80, functions: 95, lines: 95 },
        'src/hooks/useEditLock.ts': { statements: 95, branches: 90, functions: 95, lines: 95 },
        'src/utils/passwordPolicy.ts': { statements: 95, branches: 90, functions: 95, lines: 95 },
      },
    },
  },
})
