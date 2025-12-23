import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildEnhancedEffectFromChanges } from '../src/core';

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

describe('enhanced effect from changes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('produces affected symbols and snippets across files', async () => {
    const projectRoot = path.join(__dirname, './fixtures/diff-project');
    mockCwd.mockImplementation(() => projectRoot);
    const original = 'export function foo(a: number, b: number) { return a + b }\nexport function bar() { return 0 }\n';
    const modified = 'export function foo(a: number, b: number) { return a - b }\nexport function bar() { return 0 }\n';
    const { affectedSymbols, snippets } = await buildEnhancedEffectFromChanges(
      'src',
      [{ filePath: 'src/a.ts', original, modified }],
      { snippetDepth: 1 },
    );
    const names = affectedSymbols.map(a => a.symbol.name).sort();
    expect(names).toContain('foo');
    const files = snippets.map(s => path.relative(projectRoot, path.isAbsolute(s.filePath)
      ? s.filePath
      : path.resolve(projectRoot, s.filePath))).sort();
    expect(files).toContain('src/a.ts');
    expect(files).toContain('src/c.ts');
    mockCwd.mockReset();
  });
});
