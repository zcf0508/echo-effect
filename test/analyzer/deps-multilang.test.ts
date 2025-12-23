import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildReverseDependencyGraph } from '../../src/core';

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

describe('多语言依赖扫描', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('python 相对导入依赖', async () => {
    const root = path.join(__dirname, '../fixtures/multi-lang-project/python');
    mockCwd.mockImplementation(() => root);
    // create b.py that imports from .a import foo
    const entry = path.join(root, 'b.py');
    const fs = await import('node:fs');
    fs.writeFileSync(entry, 'from .a import foo\n', 'utf-8');
    const graph = await buildReverseDependencyGraph('b.py');
    const aAbs = path.resolve(root, 'a.py');
    const bAbs = path.resolve(root, 'b.py');
    const dependents = graph.get(aAbs) || new Set();
    expect(dependents.has(bAbs)).toBe(true);
    fs.rmSync(entry);
    mockCwd.mockReset();
  });

  it('java import 依赖', async () => {
    const root = path.join(__dirname, '../fixtures/multi-lang-project/java');
    mockCwd.mockImplementation(() => root);
    const fs = await import('node:fs');
    const pkgDir = path.join(root, 'pkg');
    if (!fs.existsSync(pkgDir)) {
      fs.mkdirSync(pkgDir);
    }
    fs.writeFileSync(path.join(pkgDir, 'A.java'), 'package pkg; public class A {}', 'utf-8');
    fs.writeFileSync(path.join(pkgDir, 'B.java'), 'package pkg; import pkg.A; public class B { A a; }', 'utf-8');
    const graph = await buildReverseDependencyGraph('pkg/B.java');
    const aAbs = path.resolve(pkgDir, 'A.java');
    const bAbs = path.resolve(pkgDir, 'B.java');
    const dependents = graph.get(aAbs) || new Set();
    expect(dependents.has(bAbs)).toBe(true);
    fs.rmSync(path.join(pkgDir, 'A.java'));
    fs.rmSync(path.join(pkgDir, 'B.java'));
    mockCwd.mockReset();
  });

  it('go 相对导入依赖', async () => {
    const root = path.join(__dirname, '../fixtures/multi-lang-project/go');
    mockCwd.mockImplementation(() => root);
    const fs = await import('node:fs');
    const pkgDir = path.join(root, 'pkg');
    if (!fs.existsSync(pkgDir)) {
      fs.mkdirSync(pkgDir);
    }
    fs.writeFileSync(path.join(pkgDir, 'util.go'), 'package pkg; func U() {}', 'utf-8');
    fs.writeFileSync(path.join(root, 'main.go'), 'package main\nimport "./pkg"\nfunc main(){ pkg.U() }', 'utf-8');
    const graph = await buildReverseDependencyGraph('main.go');
    const utilAbs = path.resolve(pkgDir, 'util.go');
    const mainAbs = path.resolve(root, 'main.go');
    const dependents = graph.get(utilAbs) || new Set();
    expect(dependents.has(mainAbs)).toBe(true);
    fs.rmSync(path.join(pkgDir, 'util.go'));
    fs.rmSync(path.join(root, 'main.go'));
    mockCwd.mockReset();
  });

  it('c++ include 依赖', async () => {
    const root = path.join(__dirname, '../fixtures/multi-lang-project/cpp');
    mockCwd.mockImplementation(() => root);
    const fs = await import('node:fs');
    fs.writeFileSync(path.join(root, 'a.hpp'), 'int foo();', 'utf-8');
    fs.writeFileSync(path.join(root, 'main.cpp'), '#include "a.hpp"\nint main(){return 0;}', 'utf-8');
    const graph = await buildReverseDependencyGraph('main.cpp');
    const aAbs = path.resolve(root, 'a.hpp');
    const mainAbs = path.resolve(root, 'main.cpp');
    const dependents = graph.get(aAbs) || new Set();
    expect(dependents.has(mainAbs)).toBe(true);
    fs.rmSync(path.join(root, 'a.hpp'));
    fs.rmSync(path.join(root, 'main.cpp'));
    mockCwd.mockReset();
  });
});
