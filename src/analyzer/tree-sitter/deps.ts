import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import Parser from 'tree-sitter';
import JavaScript from 'tree-sitter-javascript';
import walkdir from 'walkdir';
import { createAutoImportResolverFn } from '../../resolvers';
import { EXTENSIONS, getTsconfigPath, interopDefault } from '../../utils';

function ensureFileExtension(filePath: string, extensions: string[]): string {
  if (path.extname(filePath)) {
    return filePath;
  }
  for (const ext of extensions) {
    const fullPath = path.resolve(process.cwd(), filePath + ext);
    if (fs.existsSync(fullPath)) {
      return filePath + ext;
    }
  }
  const dirPath = path.resolve(process.cwd(), filePath);
  if (fs.existsSync(dirPath) && fs.statSync(dirPath).isDirectory()) {
    for (const ext of extensions) {
      const indexFile = path.join(dirPath, `index${ext}`);
      if (fs.existsSync(indexFile)) {
        return path.join(filePath, `index${ext}`);
      }
    }
  }
  return filePath;
}

async function createAliasResolver(): Promise<(specifier: string) => string | null> {
  const tsConfigPath = getTsconfigPath();
  const tsConfig = tsConfigPath
    ? await (await import('../../utils')).extractTSConfig(tsConfigPath)
    : undefined;
  const matchPath = (await interopDefault(await import('tsconfig-paths'))).createMatchPath(
    tsConfig?.options?.baseUrl || path.join(process.cwd(), '.'),
    tsConfig?.options?.paths ?? {},
  );
  return (specifier: string) => {
    const r = matchPath(specifier, undefined, undefined, EXTENSIONS);
    return r || null;
  };
}

function stripQuotes(s: string): string {
  return s.replace(/^['"`]/, '').replace(/['"`]$/, '');
}

function collectEntryFiles(entries: string[]): string[] {
  const files = new Set<string>();
  entries.forEach((p) => {
    const abs = path.resolve(process.cwd(), p);
    if (!fs.existsSync(abs)) {
      return;
    }
    const stat = fs.statSync(abs);
    if (stat.isDirectory()) {
      walkdir.sync(abs, (f) => {
        if (/\.(?:ts|tsx|js|jsx)$/.test(f)) {
          files.add(f);
        }
      });
    }
    else if (/\.(?:ts|tsx|js|jsx)$/.test(abs)) {
      files.add(abs);
    }
  });
  return Array.from(files);
}

function resolveImport(
  currentFile: string,
  specifier: string,
  resolveAlias: (s: string) => string | null,
): string | null {
  if (specifier.startsWith('.')) {
    const abs = path.resolve(path.dirname(currentFile), specifier);
    const withExt = ensureFileExtension(abs, EXTENSIONS);
    if (fs.existsSync(withExt)) {
      return withExt;
    }
    return null;
  }
  const aliased = resolveAlias(specifier);
  if (aliased) {
    const withExt = ensureFileExtension(aliased, EXTENSIONS);
    if (fs.existsSync(withExt)) {
      return withExt;
    }
    return null;
  }
  return null;
}

export async function scanDependenciesJsTs(entryPaths: string[]): Promise<Record<string, string[]>> {
  const resolveAlias = await createAliasResolver();
  const autoImportResolver = createAutoImportResolverFn();
  const parser = new Parser();
  parser.setLanguage(JavaScript as unknown as Parser.Language);

  const dependencyObject: Record<string, string[]> = {};
  const queue: string[] = collectEntryFiles(entryPaths);
  const visited = new Set<string>();

  const addDep = (file: string, depAbs: string): void => {
    const relFile = path.relative(process.cwd(), file);
    const relDep = path.relative(process.cwd(), depAbs);
    if (relDep === relFile) {
      return;
    }
    if (relDep.includes('node_modules')) {
      return;
    }
    if (!dependencyObject[relFile]) {
      dependencyObject[relFile] = [];
    }
    if (!dependencyObject[relFile].includes(relDep)) {
      dependencyObject[relFile].push(relDep);
    }
  };

  while (queue.length) {
    const file = queue.shift()!;
    if (visited.has(file)) {
      continue;
    }
    visited.add(file);
    const content = fs.readFileSync(file, 'utf-8');
    const relFileInit = path.relative(process.cwd(), file);
    if (!dependencyObject[relFileInit]) {
      dependencyObject[relFileInit] = [];
    }
    const tree = parser.parse(content);
    // import statements
    const stack: Parser.SyntaxNode[] = [tree.rootNode];
    while (stack.length) {
      const node = stack.pop()!;
      if (node.type === 'import_statement') {
        const src = node.childForFieldName('source');
        if (src && src.type === 'string') {
          const spec = stripQuotes(src.text);
          const resolved = resolveImport(file, spec, resolveAlias);
          if (resolved) {
            addDep(file, resolved);
            if (!visited.has(resolved)) {
              queue.push(resolved);
            }
          }
        }
      }
      else if (node.type === 'export_statement') {
        const src = node.childForFieldName('source');
        if (src && src.type === 'string') {
          const spec = stripQuotes(src.text);
          const resolved = resolveImport(file, spec, resolveAlias);
          if (resolved) {
            addDep(file, resolved);
            if (!visited.has(resolved)) {
              queue.push(resolved);
            }
          }
        }
      }
      else if (node.type === 'call_expression') {
        const callee = node.childForFieldName('function');
        const arg = node.childForFieldName('arguments')?.namedChildren?.[0];
        if (callee?.type === 'identifier' && callee.text === 'require' && arg?.type === 'string') {
          const spec = stripQuotes(arg.text);
          const resolved = resolveImport(file, spec, resolveAlias);
          if (resolved) {
            addDep(file, resolved);
            if (!visited.has(resolved)) {
              queue.push(resolved);
            }
          }
        }
      }
      for (let i = 0; i < node.namedChildCount; i++) {
        const child = node.namedChild(i);
        if (child) {
          stack.push(child);
        }
      }
    }
    // auto-import identifiers
    const clean = content
      .replace(/\/\/.*$/gm, '')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(['"])(?:(?!\1)[^\\]|\\.)*?\1/g, '')
      .replace(/`[\s\S]*?`/g, '');
    const ids = Array.from(new Set(clean.match(/\b(\w+)\b/g) || []));
    ids.forEach((id) => {
      const resolved = autoImportResolver(id);
      if (resolved) {
        const withExt = ensureFileExtension(resolved, EXTENSIONS);
        const abs = path.resolve(process.cwd(), withExt);
        addDep(file, abs);
        if (!visited.has(abs)) {
          queue.push(abs);
        }
      }
    });
  }

  const sorted: Record<string, string[]> = {};
  Object.keys(dependencyObject).sort().forEach((k) => {
    sorted[k] = [...new Set(dependencyObject[k])].sort();
  });
  return sorted;
}
