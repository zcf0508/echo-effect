import { defineConfig } from 'tsdown';

export default defineConfig([
  {
    entry: [
      'src/cli.ts',
    ],
    format: ['cjs'],
    platform: 'node',
    clean: true,
    dts: false,
  },
  {
    entry: [
      'src/index.ts',
    ],
    format: ['cjs', 'esm'],
    platform: 'node',
    clean: true,
    dts: true,
  },
]);
