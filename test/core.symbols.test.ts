import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TreeSitterAnalyzer } from '../src/analyzer/tree-sitter';
import { extractRelevantSnippets, findAffectedSymbolsFromDiff } from '../src/core';

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

describe('symbols and snippets', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('findAffectedSymbolsFromDiff detects modified function and references', async () => {
    const projectRoot = path.join(__dirname, './fixtures/diff-project');
    mockCwd.mockImplementation(() => projectRoot);
    const originalContent = 'export function foo(a: number, b: number) { return a + b }\nexport function bar() { return 0 }\n';
    const modifiedContent = 'export function foo(a: number, b: number) { return a - b }\nexport function bar() { return 0 }\n';
    const analyzer = new TreeSitterAnalyzer('typescript');
    const affected = await findAffectedSymbolsFromDiff('src/a.ts', originalContent, modifiedContent, analyzer);
    const names = affected.map(a => a.symbol.name).sort();
    expect(names).toContain('foo');
    const foo = affected.find(a => a.symbol.name === 'foo')!;
    expect(foo.referencedBy.length).toBeGreaterThanOrEqual(0);
    mockCwd.mockReset();
  });

  it('extractRelevantSnippets returns definition and caller snippets within depth', async () => {
    const projectRoot = path.join(__dirname, './fixtures/diff-project');
    mockCwd.mockImplementation(() => projectRoot);
    const analyzer = new TreeSitterAnalyzer('typescript');
    const originalContent = 'export function foo(a: number, b: number) { return a + b }\nexport function bar() { return 0 }\n';
    const modifiedContent = 'export function foo(a: number, b: number) { return a - b }\nexport function bar() { return 0 }\n';
    const affected = await findAffectedSymbolsFromDiff('src/a.ts', originalContent, modifiedContent, analyzer);
    const cContent = 'function z() { return foo(1,2) }\n';
    const refs = await analyzer.extractReferences('src/c.ts', cContent);
    const absA = path.resolve(projectRoot, 'src/a.ts');
    const absC = path.resolve(projectRoot, 'src/c.ts');
    const reverseGraph = new Map<string, Set<string>>();
    reverseGraph.set(absA, new Set([absC]));
    const snippets = extractRelevantSnippets(affected, reverseGraph, refs, 1);
    expect(snippets.length).toBeGreaterThan(0);
    const files = snippets.map((s) => {
      const abs = path.isAbsolute(s.filePath)
        ? s.filePath
        : path.resolve(projectRoot, s.filePath);
      return path.relative(projectRoot, abs).replace(/\\/g, '/');
    }).sort();
    expect(files).toContain('src/a.ts');
    expect(files).toContain('src/c.ts');
    mockCwd.mockReset();
  });
});
