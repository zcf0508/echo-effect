import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { scanFile } from '../src/core';
import * as resolversModule from '../src/resolvers';
import * as vueModule from '../src/vue';
import { normalizeDependencyPaths } from './test-utils';

vi.mock('local-pkg', () => ({
  isPackageExists: vi.fn(pkg => pkg === 'vue'),
}));

vi.mock('../src/utils', async (importOriginal) => {
  const actual = await importOriginal() as any;
  return {
    ...actual,
    ensurePackages: vi.fn(),
  };
});

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

describe('scanFile', () => {
  const mockResolveComponent = vi.fn((componentPath: string): (string | null) => componentPath);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('基础功能测试', () => {
    it('单文件扫描测试', async () => {
      mockCwd.mockImplementation(() => path.join(__dirname, './fixtures/basic-project'));
      const result = await scanFile(
        ['test/fixtures/basic-project/src'],
        mockResolveComponent,
      );

      expect(normalizeDependencyPaths(result)).toMatchInlineSnapshot(`
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
      expect(typeof result).toBe('object');

      mockCwd.mockReset();
    });

    it('多文件扫描测试', async () => {
      mockCwd.mockImplementation(() => path.join(__dirname, './fixtures/basic-project'));
      const files = [
        'test/fixtures/basic-project/src/main.ts',
        'test/fixtures/basic-project/src/utils/math.ts',
      ];

      const result = await scanFile(files, mockResolveComponent);

      expect(normalizeDependencyPaths(result)).toMatchInlineSnapshot(`
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
          "src/utils/math.ts": [],
        }
      `);
      expect(Object.keys(result).length).toBeGreaterThan(0);

      mockCwd.mockReset();
    });

    it('完整文件后缀测试', async () => {
      mockCwd.mockImplementation(() => path.join(__dirname, './fixtures/basic-project'));
      const result = await scanFile(
        ['test/fixtures/basic-project/src'],
        mockResolveComponent,
      );

      expect(normalizeDependencyPaths(result)).toMatchInlineSnapshot(`
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
  });

  describe('边界条件测试', () => {
    it('不存在的文件测试', async () => {
      mockCwd.mockImplementation(() => path.join(__dirname, './fixtures/basic-project'));

      const result = await scanFile(
        ['test/fixtures/non-existent-folder'],
        mockResolveComponent,
      );

      expect(normalizeDependencyPaths(result)).toMatchInlineSnapshot('{}');

      mockCwd.mockReset();
    });

    it('空依赖文件测试', async () => {
      mockCwd.mockImplementation(() => path.join(__dirname, './fixtures/basic-project'));
      const result = await scanFile(
        ['test/fixtures/basic-project/src/no-deps.ts'],
        mockResolveComponent,
      );

      expect(normalizeDependencyPaths(result)).toMatchInlineSnapshot(`
        {
          "src/no-deps.ts": [],
        }
      `);
      const deps = result['src/no-deps.ts'] || [];
      expect(deps.length).toBe(0);

      mockCwd.mockReset();
    });

    it('node_modules 过滤测试', async () => {
      mockCwd.mockImplementation(() => path.join(__dirname, './fixtures/basic-project'));
      const result = await scanFile(
        ['test/fixtures/basic-project/src'],
        mockResolveComponent,
      );

      expect(normalizeDependencyPaths(result)).toMatchInlineSnapshot(`
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
      Object.values(result).forEach((dependencies) => {
        dependencies.forEach((dep) => {
          expect(dep).not.toContain('node_modules');
        });
      });

      mockCwd.mockReset();
    });
  });

  describe('vue 组件测试', () => {
    it('vue SFC 组件解析测试', async () => {
      const projectRoot = path.join(__dirname, './fixtures/vue-project');
      mockCwd.mockImplementation(() => projectRoot);
      const result = await scanFile(
        [path.join(projectRoot, 'src/main.ts')],
        vueModule.createComponentResolver(),
      );

      expect(normalizeDependencyPaths(result)).toMatchInlineSnapshot(`
        {
          "src/App.vue": [
            "src/RegularComponent.vue",
            "src/components/AppButton.vue",
          ],
          "src/RegularComponent.vue": [],
          "src/TestComponent.vue": [],
          "src/components/AppButton.vue": [
            "src/TestComponent.vue",
            "src/components/BaseButton.vue",
          ],
          "src/components/BaseButton.vue": [],
          "src/composables/useFoo.ts": [],
          "src/main.ts": [
            "src/App.vue",
            "src/composables/useFoo.ts",
          ],
        }
      `);

      mockCwd.mockReset();
    });

    it('vue 入口为 .vue 的场景', async () => {
      const projectRoot = path.join(__dirname, './fixtures/vue-project');
      mockCwd.mockImplementation(() => projectRoot);
      const result = await scanFile(
        [path.join(projectRoot, 'src/App.vue')],
        vueModule.createComponentResolver(),
      );

      expect(normalizeDependencyPaths(result)).toMatchInlineSnapshot(`
        {
          "src/App.vue": [
            "src/RegularComponent.vue",
            "src/components/AppButton.vue",
          ],
          "src/RegularComponent.vue": [],
          "src/TestComponent.vue": [],
          "src/components/AppButton.vue": [
            "src/TestComponent.vue",
            "src/components/BaseButton.vue",
          ],
          "src/components/BaseButton.vue": [],
        }
      `);

      mockCwd.mockReset();
    });

    it('组件重复引用测试', async () => {
      const projectRoot = path.join(__dirname, './fixtures/vue-project');
      mockCwd.mockImplementation(() => projectRoot);
      const files = [
        path.join(projectRoot, 'src/main.ts'),
        path.join(projectRoot, 'src/App.vue'),
      ];

      const result = await scanFile(files, vueModule.createComponentResolver());

      expect(normalizeDependencyPaths(result)).toMatchInlineSnapshot(`
        {
          "src/App.vue": [
            "src/RegularComponent.vue",
            "src/components/AppButton.vue",
          ],
          "src/RegularComponent.vue": [],
          "src/TestComponent.vue": [],
          "src/components/AppButton.vue": [
            "src/TestComponent.vue",
            "src/components/BaseButton.vue",
          ],
          "src/components/BaseButton.vue": [],
          "src/composables/useFoo.ts": [],
          "src/main.ts": [
            "src/App.vue",
            "src/composables/useFoo.ts",
          ],
        }
      `);

      mockCwd.mockReset();
    });

    it('auto import function test', async () => {
      const projectRoot = path.join(__dirname, './fixtures/vue-project');
      mockCwd.mockImplementation(() => projectRoot);

      const result = await scanFile(
        [path.join(projectRoot, 'src/main.ts')],
        vueModule.createComponentResolver(),
      );

      expect(normalizeDependencyPaths(result)).toMatchInlineSnapshot(`
        {
          "src/App.vue": [
            "src/RegularComponent.vue",
            "src/components/AppButton.vue",
          ],
          "src/RegularComponent.vue": [],
          "src/TestComponent.vue": [],
          "src/components/AppButton.vue": [
            "src/TestComponent.vue",
            "src/components/BaseButton.vue",
          ],
          "src/components/BaseButton.vue": [],
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

  describe('路径处理测试', () => {
    it('路径别名解析测试', async () => {
      mockCwd.mockImplementation(() => path.join(__dirname, './fixtures/basic-project'));
      const result = await scanFile(
        ['test/fixtures/basic-project/src'],
        mockResolveComponent,
      );

      expect(normalizeDependencyPaths(result)).toMatchInlineSnapshot(`
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

    it('相对路径处理测试', async () => {
      mockCwd.mockImplementation(() => path.join(__dirname, './fixtures/basic-project'));
      const result = await scanFile(
        ['test/fixtures/basic-project/src/components/Header.ts'],
        mockResolveComponent,
      );

      expect(normalizeDependencyPaths(result)).toMatchInlineSnapshot(`
        {
          "src/components/Button.ts": [
            "src/utils/math.ts",
          ],
          "src/components/Header.ts": [
            "src/components/Button.ts",
          ],
          "src/utils/math.ts": [],
        }
      `);

      mockCwd.mockReset();
    });
  });
});
