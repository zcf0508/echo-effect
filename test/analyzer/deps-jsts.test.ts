import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { scanDependenciesJsTs } from '../../src/analyzer/tree-sitter/deps';
import { normalizeDependencyPaths } from '../test-utils';

const mockCwd = vi.hoisted(() => vi.fn());

vi.mock('node:process', async (importOriginal) => {
  const actual = await importOriginal() as object;
  return {
    ...actual,
    cwd: mockCwd,
    default: {
      ...actual,
      cwd: mockCwd,
    },
  };
});

describe('treeSitter deps (JS/TS)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('resolves path aliases and relative imports', async () => {
    mockCwd.mockImplementation(() => path.join(__dirname, '../fixtures/basic-project'));
    const deps = await scanDependenciesJsTs(['src']);
    expect(normalizeDependencyPaths(deps)).toMatchInlineSnapshot(`
      {
        "src/components/Button.ts": [
          "src/utils/math.ts",
        ],
        "src/components/Header.ts": [
          "src/components/Button.ts",
        ],
        "src/main.ts": [
          "src/components/Header.ts",
          "src/utils/math.ts",
        ],
        "src/no-deps.ts": [],
        "src/utils/math.ts": [],
      }
    `);
    mockCwd.mockReset();
  });

  it('detects auto-import identifiers in TS files', async () => {
    const projectRoot = path.join(__dirname, '../fixtures/vue-project');
    mockCwd.mockImplementation(() => projectRoot);
    const deps = await scanDependenciesJsTs(['src/main.ts']);
    expect(normalizeDependencyPaths(deps)).toMatchInlineSnapshot(`
      {
        "src/App.vue": [],
        "src/composables/useFoo.ts": [],
        "src/main.ts": [
          "src/App.vue",
          "src/composables/useFoo.ts",
        ],
      }
    `);
    mockCwd.mockReset();
  });
});
