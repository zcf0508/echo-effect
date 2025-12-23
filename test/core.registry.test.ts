import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { analyzerRegistry } from '../src';
import { buildReverseDependencyGraphWithSymbols } from '../src/core';

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

describe('analyzerRegistry 接入', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('在核心扫描流程中自动注册语言分析器', async () => {
    const projectRoot = path.join(__dirname, './fixtures/basic-project');
    mockCwd.mockImplementation(() => projectRoot);
    await buildReverseDependencyGraphWithSymbols('src/main.ts', { analyzer: 'tree-sitter' });
    const tsAnalyzer = analyzerRegistry.getAnalyzer('typescript');
    const jsAnalyzer = analyzerRegistry.getAnalyzer('javascript');
    expect(tsAnalyzer || jsAnalyzer).not.toBeNull();
    mockCwd.mockReset();
  });
});
