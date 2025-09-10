import { defineConfig } from 'tsdown';

export default defineConfig([
  {
    entry: [
      'src/cli.ts',
    ],
    format: ['esm'],
    platform: 'node',
    clean: true,
    dts: false,
  },
  {
    entry: [
      'src/index.ts',
    ],
    platform: 'node',
    clean: true,
    dts: true,
  },
]);
