import { defineConfig } from 'tsdown';

const external = [
  '@vue/compiler-sfc',
  '@vue/compiler-dom',
  'chalk',
  'commander',
  'commondir',
  'debug',
  'ora',
  'pluralize',
  'pretty-ms',
  'rc',
  'stream-to-array',
  'ts-graphviz',
  'walkdir',
];

const noExternal = [
  'dependency-tree',
];

export default defineConfig([
  {
    entry: [
      'src/cli.ts',
    ],
    format: ['cjs'],
    platform: 'node',
    clean: true,
    dts: false,
    external,
    noExternal,
  },
  {
    entry: [
      'src/index.ts',
    ],
    platform: 'node',
    clean: true,
    external,
    noExternal,
  },
]);
