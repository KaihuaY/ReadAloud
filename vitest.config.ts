import { defineConfig } from 'vitest/config'

export default defineConfig({
  // Mirrors vite.config.ts's `define` so src/buildInfo.ts's __APP_BUILD__
  // reference resolves the same way under test as it does in a real build.
  define: {
    __APP_BUILD__: JSON.stringify('test-build'),
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})
