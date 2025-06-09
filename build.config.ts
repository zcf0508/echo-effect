import { defineBuildConfig } from 'unbuild';

const externals = [
  '@vue/compiler-sfc',
  '@vue/compiler-dom',
];

export default defineBuildConfig([
  {
    entries: [
      'src/index',
    ],
    declaration: 'node16',
    clean: true,
    externals,
  },
  {
    entries: [
      'src/cli',
    ],
    externals,
  },
]);
