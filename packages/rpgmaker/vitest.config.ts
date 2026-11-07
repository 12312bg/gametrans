import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: { '@gametrans/shared': resolve(__dirname, '../shared/src/index.ts') },
  },
  test: { include: ['test/**/*.test.ts'] },
});
