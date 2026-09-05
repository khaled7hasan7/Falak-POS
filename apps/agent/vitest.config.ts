import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    // اختبارات الوكيل تشترك في قاعدة واحدة، فتُشغَّل بالتسلسل
    fileParallelism: false,
    hookTimeout: 180_000,
    testTimeout: 60_000,
  },
})
