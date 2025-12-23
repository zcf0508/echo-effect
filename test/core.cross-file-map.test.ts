import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildCrossFileSymbolReferenceMap, buildReverseDependencyGraphWithSymbols } from '../src/core';

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

describe('跨文件符号引用映射', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('basic-project ts 跨文件引用映射', async () => {
    const projectRoot = path.join(__dirname, './fixtures/basic-project');
    mockCwd.mockImplementation(() => projectRoot);
    const { dependencyGraph, symbolMap, references } = await buildReverseDependencyGraphWithSymbols('src/main.ts', { analyzer: 'tree-sitter' });
    const refMap = buildCrossFileSymbolReferenceMap(dependencyGraph, symbolMap, references);
    const addKey = `${path.resolve(projectRoot, 'src/utils/math.ts')}::add`;
    const headerKey = `${path.resolve(projectRoot, 'src/components/Header.ts')}::Header`;
    const multiplyKey = `${path.resolve(projectRoot, 'src/utils/math.ts')}::multiply`;
    expect(refMap.has(addKey)).toBe(true);
    expect(refMap.get(addKey)!.some(r => r.referrer.filePath.endsWith('src/components/Button.ts'))).toBe(true);
    expect(refMap.has(headerKey)).toBe(true);
    expect(refMap.get(headerKey)!.some(r => r.referrer.filePath.endsWith('src/main.ts'))).toBe(true);
    expect(refMap.has(multiplyKey)).toBe(true);
    expect(refMap.get(multiplyKey)!.some(r => r.referrer.filePath.endsWith('src/main.ts'))).toBe(true);
    mockCwd.mockReset();
  });
});
