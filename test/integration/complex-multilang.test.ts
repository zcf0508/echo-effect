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

describe('复杂多语言项目结构依赖分析', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('python 包与子包的相对/绝对导入', async () => {
    const root = path.join(__dirname, '../fixtures/complex-python');
    mockCwd.mockImplementation(() => root);
    const graph = await buildReverseDependencyGraph('app/main.py');
    const utilAbs = path.resolve(root, 'pkg/util.py');
    const featureAbs = path.resolve(root, 'pkg/sub/feature.py');
    const mainAbs = path.resolve(root, 'app/main.py');
    const dependentsUtil = graph.get(utilAbs) || new Set();
    const dependentsFeature = graph.get(featureAbs) || new Set();
    expect(dependentsUtil.has(featureAbs)).toBe(true);
    expect(dependentsFeature.has(mainAbs)).toBe(true);
    mockCwd.mockReset();
  });

  it('java src/main/java 源根的包导入', async () => {
    const root = path.join(__dirname, '../fixtures/complex-java');
    mockCwd.mockImplementation(() => root);
    const graph = await buildReverseDependencyGraph('src/main/java/com/example/app/Main.java');
    const aAbs = path.resolve(root, 'src/main/java/com/example/util/A.java');
    const mainAbs = path.resolve(root, 'src/main/java/com/example/app/Main.java');
    const dependents = graph.get(aAbs) || new Set();
    expect(dependents.has(mainAbs)).toBe(true);
    mockCwd.mockReset();
  });

  it('java 多项目源根导入', async () => {
    const root = path.join(__dirname, '../fixtures/java-multi-project');
    mockCwd.mockImplementation(() => root);
    const graph = await buildReverseDependencyGraph('module-b/src/main/java/com/example/app/Main.java');
    const aAbs = path.resolve(root, 'module-a/src/main/java/com/example/lib/A.java');
    const mainAbs = path.resolve(root, 'module-b/src/main/java/com/example/app/Main.java');
    const dependents = graph.get(aAbs) || new Set();
    expect(dependents.has(mainAbs)).toBe(true);
    mockCwd.mockReset();
  });

  it('go 基于 go.mod 的模块路径导入', async () => {
    const root = path.join(__dirname, '../fixtures/complex-go');
    mockCwd.mockImplementation(() => root);
    const graph = await buildReverseDependencyGraph('app/main.go');
    const utilAbs = path.resolve(root, 'pkg/utils/util.go');
    const mainAbs = path.resolve(root, 'app/main.go');
    const dependents = graph.get(utilAbs) || new Set();
    expect(dependents.has(mainAbs)).toBe(true);
    mockCwd.mockReset();
  });

  it('c++ 头文件 include 的本地依赖', async () => {
    const root = path.join(__dirname, '../fixtures/complex-cpp');
    mockCwd.mockImplementation(() => root);
    const graph = await buildReverseDependencyGraph('src/main.cpp');
    const hAbs = path.resolve(root, 'include/utils/a.hpp');
    const mainAbs = path.resolve(root, 'src/main.cpp');
    const dependents = graph.get(hAbs) || new Set();
    expect(dependents.has(mainAbs)).toBe(true);
    mockCwd.mockReset();
  });
});
