import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    // اختبارات القاعدة تشترك في مخطط واحد، فتُشغَّل بالتسلسل لا بالتوازي
    fileParallelism: false,
    hookTimeout: 60_000,
    testTimeout: 30_000,
  },
})
