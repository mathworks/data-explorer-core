import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      // Measure the shipped source only — not the test harness or generated dist.
      include: ['src/**/*.ts'],
      reporter: ['text', 'json-summary'],
      reportsDirectory: './coverage',
    },
  },
});
