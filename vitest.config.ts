import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    root: '.',
    include: [
      'src/cli/**/*.test.ts',
      'src/formatters/**/*.test.ts',
      'src/generators/**/*.test.ts',
      'src/downloader/**/*.test.ts',
      'src/transformer/**/*.test.ts',
      'src/utils/**/*.test.ts',
      'src/scrapy/**/*.test.ts',
      'src/sanitizers/**/*.test.ts',
      'src/server/**/*.test.ts',
      'packages/dashboard/src/**/*.test.ts',
    ],
    exclude: ['src/scrapy/runner.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['formatters/**/*.ts'],
      exclude: ['**/*.test.ts', '**/__fixtures__/**', '**/__tests__/**'],
      reporter: ['text', 'html'],
    },
    testTimeout: 15000,
  },
});
