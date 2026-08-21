import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'jsdom',
    include: ['packages/*/bench/**/*.bench.ts'],
    testTimeout: 900000,
    hookTimeout: 900000,
    fileParallelism: false,
  },
})
