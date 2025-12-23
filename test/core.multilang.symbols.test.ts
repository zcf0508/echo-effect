import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
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

describe('core 多语言符号与引用', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('python: 提取函数符号与调用引用', async () => {
    const projectRoot = path.join(__dirname, './fixtures/multi-lang-project/python');
    mockCwd.mockImplementation(() => projectRoot);
    const { symbolMap, references } = await buildReverseDependencyGraphWithSymbols('a.py', { analyzer: 'tree-sitter' });
    const syms = symbolMap.get(path.resolve(projectRoot, 'a.py')) || [];
    const names = syms.map(s => `${s.type}:${s.name}`).sort();
    expect(names).toContain('function:foo');
    expect(references.some(r => r.symbol.name === 'foo')).toBe(true);
    mockCwd.mockReset();
  });

  it('java: 提取类/方法符号与调用引用', async () => {
    const projectRoot = path.join(__dirname, './fixtures/multi-lang-project/java');
    mockCwd.mockImplementation(() => projectRoot);
    const { symbolMap, references } = await buildReverseDependencyGraphWithSymbols('A.java', { analyzer: 'tree-sitter' });
    const syms = symbolMap.get(path.resolve(projectRoot, 'A.java')) || [];
    const names = syms.map(s => `${s.type}:${s.name}`).sort();
    expect(names).toContain('class:A');
    expect(names).toContain('class:B');
    expect(names).toContain('method:m');
    expect(references.some(r => r.symbol.name === 'm')).toBe(true);
    mockCwd.mockReset();
  });

  it('go: 提取函数符号与调用引用', async () => {
    const projectRoot = path.join(__dirname, './fixtures/multi-lang-project/go');
    mockCwd.mockImplementation(() => projectRoot);
    const { symbolMap, references } = await buildReverseDependencyGraphWithSymbols('a.go', { analyzer: 'tree-sitter' });
    const syms = symbolMap.get(path.resolve(projectRoot, 'a.go')) || [];
    const names = syms.map(s => `${s.type}:${s.name}`).sort();
    expect(names).toContain('function:Foo');
    expect(references.some(r => r.symbol.name === 'Foo')).toBe(true);
    mockCwd.mockReset();
  });

  it('c++: 提取函数符号与调用引用', async () => {
    const projectRoot = path.join(__dirname, './fixtures/multi-lang-project/cpp');
    mockCwd.mockImplementation(() => projectRoot);
    const { symbolMap, references } = await buildReverseDependencyGraphWithSymbols('a.cpp', { analyzer: 'tree-sitter' });
    const syms = symbolMap.get(path.resolve(projectRoot, 'a.cpp')) || [];
    const names = syms.map(s => `${s.type}:${s.name}`).sort();
    expect(names).toContain('function:foo');
    expect(references.some(r => r.symbol.name === 'foo')).toBe(true);
    mockCwd.mockReset();
  });
});
