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
    external: ['typescript'],
  },
  {
    entry: [
      'src/index.ts',
    ],
    platform: 'node',
    clean: true,
    dts: true,
    external: ['typescript'],
  },
]);
