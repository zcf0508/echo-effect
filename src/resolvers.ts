import type { ComponentResolver } from './types';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

export function getAutoImportFiles(): string[] {
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

export function parseAutoImportsDTS(filePath: string): Map<string, string> {
  const content = fs.readFileSync(filePath, 'utf-8');
  const importMap = new Map<string, string>();

  const regex = /(?:const|function)\s+(\w+):\s*typeof\s+import\('([^']+)'\)/g;
  let match: RegExpExecArray | null;

  // eslint-disable-next-line no-cond-assign
  while ((match = regex.exec(content)) !== null) {
    const name = match[1];
    const importPath = match[2];
    const absolutePath = path.resolve(path.dirname(filePath), importPath);
    importMap.set(name, absolutePath);
  }

  return importMap;
}

export function createAutoImportResolverFn(): ComponentResolver {
  const importMaps: Map<string, string>[] = [];
  const files = getAutoImportFiles().filter(f => f.endsWith('auto-imports.d.ts'));

  files.forEach((file) => {
    const map = parseAutoImportsDTS(file);
    if (map.size > 0) {
      importMaps.push(map);
    }
  });

  return (name: string) => {
    for (const map of importMaps) {
      if (map.has(name)) {
        return map.get(name)!;
      }
    }
    return null;
  };
}
