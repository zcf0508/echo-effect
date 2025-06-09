import type { TemplateChildNode } from '@vue/compiler-dom';
import type { ComponentResolver } from './types';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { isPackageExists } from 'local-pkg';
import { ensurePackages, interopDefault } from './utils';

// https://github.com/antfu/eslint-config/blob/v4.13.0/src/factory.ts#L50
const VuePackages = ['vue', 'nuxt', 'vitepress', '@slidev/cli'];

export function isVue(): boolean {
  return VuePackages.some(i => isPackageExists(i));
}

/** Nuxt & Auto-import */
export const NUXT_AUTO_IMPORTS = [
  'useState',
  'useFetch',
  'useAsyncData',
  'useRouter',
  'useRoute',
  'definePageMeta',
  'useHead',
  'useNuxtApp',
  'ref',
  'computed',
];

export function isNuxtProject(): boolean {
  return fs.existsSync(path.resolve(process.cwd(), 'nuxt.config.ts'))
    || fs.existsSync(path.resolve(process.cwd(), 'nuxt.config.js'));
}

function getAutoImportFiles(): string[] {
  const possiblePaths = [
    '.nuxt/auto-imports.d.ts',
    '.nuxt/components.d.ts',
    'auto-imports.d.ts',
    'components.d.ts',
    'src/auto-imports.d.ts',
    'src/components.d.ts',
  ];

  return possiblePaths
    .map(p => path.resolve(process.cwd(), p))
    .filter(fs.existsSync);
}

function extractAutoImports(filePath: string): string[] {
  const content = fs.readFileSync(filePath, 'utf-8');
  const imports: string[] = [];

  const globalDeclarations = content.match(/declare\s+(const|function)\s+(\w+)/g) || [];
  globalDeclarations.forEach((decl) => {
    const name = decl.split(/\s+/)[2];
    if (name) {
      imports.push(name);
    }
  });

  return [...new Set(imports)];
}

function parseComponentsDTS(filePath: string): Map<string, string> {
  const content = fs.readFileSync(filePath, 'utf-8');
  const componentMap = new Map<string, string>();

  const componentRegex = /(\w+):\s*typeof\s+import\('([^']+)'\)\['default'\]/g;
  let match: RegExpExecArray | null;

  // eslint-disable-next-line no-cond-assign
  while ((match = componentRegex.exec(content)) !== null) {
    const componentName = match[1];
    const importPath = match[2];

    const absolutePath = path.resolve(path.dirname(filePath), importPath);
    componentMap.set(componentName, absolutePath);

    const kebabName = componentName.replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase();
    componentMap.set(kebabName, absolutePath);
  }

  return componentMap;
}

export function createComponentResolver(): ComponentResolver {
  const componentMaps: Map<string, string>[] = [];

  const componentFiles = getAutoImportFiles().filter(f =>
    f.endsWith('components.d.ts'),
  );

  componentFiles.forEach((file) => {
    const map = parseComponentsDTS(file);
    if (map.size > 0) {
      componentMaps.push(map);
    }
  });

  return (name: string) => {
    for (const map of componentMaps) {
      if (map.has(name)) {
        return map.get(name)!;
      }
    }
    return null;
  };
}

export async function parseVueTemplateForComponents(
  filePath: string,
  componentResolver: ComponentResolver,
): Promise<string[]> {
  if (!filePath.endsWith('.vue')) {
    return [];
  }

  await ensurePackages(['@vue/compiler-sfc']);

  const content = fs.readFileSync(filePath, 'utf-8');

  const { descriptor, errors } = (await interopDefault(
    import('@vue/compiler-sfc'),
  )).parse(content);

  if (errors.length > 0) {
    throw new Error(errors[0].message);
  }

  if (!descriptor.template) {
    return [];
  }

  const templateContent = descriptor.template.content;

  await ensurePackages(['@vue/compiler-dom']);

  const templateAst = (await interopDefault(
    import('@vue/compiler-dom'),
  )).parse(templateContent);

  const usedComponents = new Set<string>();

  const traverse = (node: TemplateChildNode): void => {
    if (node.type === 1) { // ElementNode
      if (node.tag.match(/[A-Z]/) || node.tag.includes('-')) {
        usedComponents.add(node.tag);
      }
      if (node.children) {
        node.children.forEach(traverse);
      }
    }
  };

  templateAst.children.forEach(traverse);

  const resolvedPaths: string[] = [];
  usedComponents.forEach((comp) => {
    const resolved = componentResolver(comp);
    if (resolved) {
      resolvedPaths.push(resolved);
    }
  });

  return resolvedPaths;
}
