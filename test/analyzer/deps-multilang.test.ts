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

  it('java import 解析 src/main/java 源根', async () => {
    const root = path.join(__dirname, '../fixtures');
    const proj = path.join(root, 'java-root-project');
    const fs = await import('node:fs');
    if (!fs.existsSync(proj)) {
      fs.mkdirSync(proj);
    }
    const srcMainJava = path.join(proj, 'src', 'main', 'java', 'pkg');
    fs.mkdirSync(srcMainJava, { recursive: true });
    fs.writeFileSync(path.join(srcMainJava, 'A.java'), 'package pkg; public class A {}', 'utf-8');
    fs.writeFileSync(path.join(proj, 'B.java'), 'import pkg.A; public class B { A a; }', 'utf-8');
    mockCwd.mockImplementation(() => proj);
    const graph = await buildReverseDependencyGraph('B.java');
    const aAbs = path.resolve(srcMainJava, 'A.java');
    const bAbs = path.resolve(proj, 'B.java');
    const dependents = graph.get(aAbs) || new Set();
    expect(dependents.has(bAbs)).toBe(true);
    fs.rmSync(path.join(srcMainJava, 'A.java'));
    fs.rmSync(path.join(proj, 'B.java'));
  });

  it('java import 通配符依赖（pkg.*）', async () => {
    const root = path.join(__dirname, '../fixtures');
    const proj = path.join(root, 'java-root-project');
    const fs = await import('node:fs');
    if (!fs.existsSync(proj)) {
      fs.mkdirSync(proj);
    }
    const srcMainJava = path.join(proj, 'src', 'main', 'java', 'pkg');
    fs.mkdirSync(srcMainJava, { recursive: true });
    fs.writeFileSync(path.join(srcMainJava, 'A.java'), 'package pkg; public class A {}', 'utf-8');
    fs.writeFileSync(path.join(srcMainJava, 'C.java'), 'package pkg; public class C {}', 'utf-8');
    fs.writeFileSync(path.join(proj, 'B2.java'), 'import pkg.*; public class B2 { A a; C c; }', 'utf-8');
    mockCwd.mockImplementation(() => proj);
    const graph = await buildReverseDependencyGraph('B2.java');
    const aAbs = path.resolve(srcMainJava, 'A.java');
    const cAbs = path.resolve(srcMainJava, 'C.java');
    const b2Abs = path.resolve(proj, 'B2.java');
    const depA = graph.get(aAbs) || new Set();
    const depC = graph.get(cAbs) || new Set();
    expect(depA.has(b2Abs)).toBe(true);
    expect(depC.has(b2Abs)).toBe(true);
    fs.rmSync(path.join(srcMainJava, 'A.java'));
    fs.rmSync(path.join(srcMainJava, 'C.java'));
    fs.rmSync(path.join(proj, 'B2.java'));
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

  it('go 模块 import 依赖（基于 go.mod）', async () => {
    const root = path.join(__dirname, '../fixtures/go-mod-project');
    const fs = await import('node:fs');
    if (!fs.existsSync(root)) {
      fs.mkdirSync(root);
    }
    fs.writeFileSync(path.join(root, 'go.mod'), 'module example.com/mod\n', 'utf-8');
    const pkgDir = path.join(root, 'pkg');
    if (!fs.existsSync(pkgDir)) {
      fs.mkdirSync(pkgDir);
    }
    fs.writeFileSync(path.join(pkgDir, 'util.go'), 'package pkg; func U() {}', 'utf-8');
    fs.writeFileSync(path.join(root, 'main.go'), 'package main\nimport "example.com/mod/pkg"\nfunc main(){ pkg.U() }', 'utf-8');
    mockCwd.mockImplementation(() => root);
    const graph = await buildReverseDependencyGraph('main.go');
    const utilAbs = path.resolve(pkgDir, 'util.go');
    const mainAbs = path.resolve(root, 'main.go');
    const dependents = graph.get(utilAbs) || new Set();
    expect(dependents.has(mainAbs)).toBe(true);
    fs.rmSync(path.join(root, 'go.mod'));
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
