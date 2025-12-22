import type { TemplateChildNode } from '@vue/compiler-dom';
import type { ComponentResolver } from './types';
import fs from 'node:fs';
import path, { join } from 'node:path';
import process from 'node:process';
import { isPackageExists } from 'local-pkg';
import Parser from 'tree-sitter';
import JavaScript from 'tree-sitter-javascript';
import { getAutoImportFiles } from './resolvers';
import { consola, interopDefault } from './utils';

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

export async function parseVueTemplateForComponents(
  /** relation path */
  filePath: string,
  componentResolver: ComponentResolver,
): Promise<string[]> {
  if (!filePath.endsWith('.vue')) {
    return [];
  }

  const content = fs.readFileSync(join(process.cwd(), filePath), 'utf-8');

  const { descriptor, errors } = (await interopDefault(
    import('@vue/compiler-sfc'),
  )).parse(content);

  if (errors.length > 0) {
    consola.debug(join(process.cwd(), filePath), errors[0].message);
    return [];
  }

  if (!descriptor.template) {
    return [];
  }

  const templateContent = descriptor.template.content;

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

  return resolvedPaths.filter(fs.existsSync);
}

export function parseComponentsDTS(filePath: string): Map<string, string> {
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

export async function parseVueScriptForImports(
  filePath: string,
): Promise<string[]> {
  if (!filePath.endsWith('.vue')) {
    return [];
  }

  const content = fs.readFileSync(join(process.cwd(), filePath), 'utf-8');

  const { descriptor } = (await interopDefault(
    import('@vue/compiler-sfc'),
  )).parse(content);

  const scriptContent = `${descriptor.script?.content || ''}\n${descriptor.scriptSetup?.content || ''}`;

  if (!scriptContent.trim()) {
    return [];
  }

  const isTs = (descriptor.script?.lang === 'ts') || (descriptor.scriptSetup?.lang === 'ts');
  const parser = new Parser();
  parser.setLanguage(JavaScript as unknown as Parser.Language);
  if (isTs) {
    const mod = await import('tree-sitter-typescript') as any;
    const lang = (mod.typescript || mod.default?.typescript) as Parser.Language;
    if (lang) {
      parser.setLanguage(lang);
    }
  }

  const tree = parser.parse(scriptContent);
  const imports: string[] = [];
  const stack: Parser.SyntaxNode[] = [tree.rootNode];

  const stripQuotes = (s: string): string => s.replace(/^['"`]/, '').replace(/['"`]$/, '');

  while (stack.length) {
    const node = stack.pop()!;
    if (node.type === 'import_statement') {
      const src = node.childForFieldName('source');
      if (src && src.type === 'string') {
        imports.push(stripQuotes(src.text));
      }
    }
    else if (node.type === 'export_statement') {
      const src = node.childForFieldName('source');
      if (src && src.type === 'string') {
        imports.push(stripQuotes(src.text));
      }
    }
    else if (node.type === 'call_expression') {
      const callee = node.childForFieldName('function');
      const arg = node.childForFieldName('arguments')?.namedChildren?.[0];
      if (callee?.type === 'identifier' && callee.text === 'require' && arg?.type === 'string') {
        imports.push(stripQuotes(arg.text));
      }
    }
    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i);
      if (child) {
        stack.push(child);
      }
    }
  }

  return imports;
}
