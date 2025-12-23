import type { Language as TSParserLanguage } from 'tree-sitter';
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

function collectEntryFilesMulti(entries: string[]): string[] {
  const files = new Set<string>();
  const exts = /\.(?:py|java|go|cpp|cc|cxx|h|hh|hpp)$/;
  entries.forEach((p) => {
    const abs = path.resolve(process.cwd(), p);
    if (!fs.existsSync(abs)) {
      return;
    }
    const stat = fs.statSync(abs);
    if (stat.isDirectory()) {
      walkdir.sync(abs, (f) => {
        if (exts.test(f)) {
          files.add(f);
        }
      });
    }
    else if (exts.test(abs)) {
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

async function loadLanguage(name: 'python' | 'java' | 'go' | 'cpp'): Promise<TSParserLanguage | null> {
  try {
    if (name === 'python') {
      const mod = await import('tree-sitter-python') as any;
      return (mod.default || mod.python || mod.Python) as TSParserLanguage || null;
    }
    if (name === 'java') {
      const mod = await import('tree-sitter-java') as any;
      return (mod.default || mod.java || mod.Java) as TSParserLanguage || null;
    }
    if (name === 'go') {
      const mod = await import('tree-sitter-go') as any;
      return (mod.default || mod.go || mod.Go) as TSParserLanguage || null;
    }
    if (name === 'cpp') {
      const mod = await import('tree-sitter-cpp') as any;
      return (mod.default || mod.cpp || mod.CPP) as TSParserLanguage || null;
    }
    return null;
  }
  catch {
    return null;
  }
}

function resolvePythonModule(currentFile: string, module: string): string | null {
  if (!module) {
    return null;
  }
  const dir = path.dirname(currentFile);
  if (module.startsWith('.')) {
    const dotMatch = module.match(/^\.+/);
    const dots = dotMatch
      ? dotMatch[0].length
      : 0;
    const tail = module.slice(dots).trim();
    const prefix = dots <= 1
      ? ''
      : '../'.repeat(dots - 1);
    const tailPath = tail
      ? tail.split('.').join('/')
      : '';
    const relPath = path.join(dir, prefix, tailPath);
    const candidates = [
      `${relPath}.py`,
      path.join(relPath, '__init__.py'),
    ].map(p => path.resolve(p));
    for (const c of candidates) {
      if (fs.existsSync(c)) {
        return c;
      }
    }
    return null;
  }
  const absPath = path.resolve(process.cwd(), module.split('.').join('/'));
  const candidates = [
    `${absPath}.py`,
    path.join(absPath, '__init__.py'),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) {
      return c;
    }
  }
  return null;
}

function resolveJavaImport(importPath: string): string | null {
  const absPath = `${path.resolve(process.cwd(), importPath.split('.').join('/'))}.java`;
  return fs.existsSync(absPath)
    ? absPath
    : null;
}

function resolveGoImport(currentFile: string, spec: string): string[] {
  const dir = path.dirname(currentFile);
  let base: string;
  if (spec.startsWith('./') || spec.startsWith('../')) {
    base = path.resolve(dir, spec);
  }
  else {
    base = path.resolve(process.cwd(), spec);
  }
  if (fs.existsSync(base) && fs.statSync(base).isDirectory()) {
    const files: string[] = [];
    fs.readdirSync(base).forEach((f) => {
      if (f.endsWith('.go')) {
        files.push(path.join(base, f));
      }
    });
    return files;
  }
  const fileCandidate = `${base}.go`;
  return fs.existsSync(fileCandidate)
    ? [fileCandidate]
    : [];
}

function resolveCppInclude(currentFile: string, spec: string): string | null {
  if (!spec || spec.startsWith('<')) {
    return null;
  }
  const p = spec.replace(/^["<]/, '').replace(/[">]$/, '');
  const abs = path.resolve(path.dirname(currentFile), p);
  if (fs.existsSync(abs)) {
    return abs;
  }
  const rootAbs = path.resolve(process.cwd(), p);
  return fs.existsSync(rootAbs)
    ? rootAbs
    : null;
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

export async function scanDependenciesMultiLang(entryPaths: string[]): Promise<Record<string, string[]>> {
  const depObj: Record<string, string[]> = {};
  const queue: string[] = collectEntryFilesMulti(entryPaths);
  const visited = new Set<string>();
  const pushDep = (file: string, depAbs: string): void => {
    const relFile = path.relative(process.cwd(), file);
    const relDep = path.relative(process.cwd(), depAbs);
    if (relDep.includes('node_modules') || relDep === relFile) {
      return;
    }
    if (!depObj[relFile]) {
      depObj[relFile] = [];
    }
    if (!depObj[relFile].includes(relDep)) {
      depObj[relFile].push(relDep);
    }
  };
  const parser = new Parser();
  const py = await loadLanguage('python');
  const java = await loadLanguage('java');
  const go = await loadLanguage('go');
  const cpp = await loadLanguage('cpp');
  while (queue.length) {
    const file = queue.shift()!;
    if (visited.has(file)) {
      continue;
    }
    visited.add(file);
    const content = fs.readFileSync(file, 'utf-8');
    const relInit = path.relative(process.cwd(), file);
    if (!depObj[relInit]) {
      depObj[relInit] = [];
    }
    const ext = path.extname(file).toLowerCase();
    if (ext === '.py' && py) {
      parser.setLanguage(py);
      const tree = parser.parse(content);
      const stack: Parser.SyntaxNode[] = [tree.rootNode];
      while (stack.length) {
        const node = stack.pop()!;
        if (node.type === 'import_statement') {
          let text = node.text.replace(/^import\s+/, '').trim();
          const specs: string[] = [];
          const re = /^\s*([.\w]+)(?:\s+as\s+\w+)?(?:\s*,\s*|$)/;
          while (text.length) {
            const m = text.match(re);
            if (!m) {
              break;
            }
            specs.push(m[1]);
            text = text.slice(m[0].length);
          }
          for (const spec of specs) {
            const resolved = resolvePythonModule(file, spec);
            if (resolved) {
              pushDep(file, resolved);
              if (!visited.has(resolved)) {
                queue.push(resolved);
              }
            }
          }
        }
        else if (node.type === 'import_from_statement') {
          const text = node.text.replace(/^from\s+/, '').trim();
          const m = text.match(/^([.\w]+)\s+import\s+/);
          const module = m?.[1] || '';
          const resolved = resolvePythonModule(file, module);
          if (resolved) {
            pushDep(file, resolved);
            if (!visited.has(resolved)) {
              queue.push(resolved);
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
    }
    else if (ext === '.java' && java) {
      parser.setLanguage(java);
      const tree = parser.parse(content);
      const stack: Parser.SyntaxNode[] = [tree.rootNode];
      while (stack.length) {
        const node = stack.pop()!;
        if (node.type === 'import_declaration') {
          const text = node.text.replace(/^\s*import\s+/, '').replace(/;$/, '').trim();
          const resolved = resolveJavaImport(text);
          if (resolved) {
            pushDep(file, resolved);
            if (!visited.has(resolved)) {
              queue.push(resolved);
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
    }
    else if (ext === '.go' && go) {
      parser.setLanguage(go);
      const tree = parser.parse(content);
      const stack: Parser.SyntaxNode[] = [tree.rootNode];
      while (stack.length) {
        const node = stack.pop()!;
        if (node.type === 'import_declaration') {
          const specs = node.namedChildren.filter(c => c.type === 'import_spec');
          specs.forEach((spec) => {
            const pathNode = spec.namedChildren.find(c => c.type === 'interpreted_string_literal' || c.type === 'raw_string_literal');
            if (pathNode) {
              const s = stripQuotes(pathNode.text.replace(/^`|`$/g, '"'));
              const files = resolveGoImport(file, s);
              files.forEach((f) => {
                pushDep(file, f);
                if (!visited.has(f)) {
                  queue.push(f);
                }
              });
            }
          });
        }
        for (let i = 0; i < node.namedChildCount; i++) {
          const child = node.namedChild(i);
          if (child) {
            stack.push(child);
          }
        }
      }
    }
    else if ((ext === '.cpp' || ext === '.cc' || ext === '.cxx' || ext === '.h' || ext === '.hh' || ext === '.hpp') && cpp) {
      parser.setLanguage(cpp);
      const tree = parser.parse(content);
      const stack: Parser.SyntaxNode[] = [tree.rootNode];
      while (stack.length) {
        const node = stack.pop()!;
        if (node.type === 'preproc_include') {
          const m = node.text.match(/#\s*include\s*(<[^>]+>|"[^"]+")/);
          const spec = m?.[1] || '';
          const resolved = resolveCppInclude(file, spec);
          if (resolved) {
            pushDep(file, resolved);
            if (!visited.has(resolved)) {
              queue.push(resolved);
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
    }
  }
  const sorted: Record<string, string[]> = {};
  Object.keys(depObj).sort().forEach((k) => {
    sorted[k] = [...new Set(depObj[k])].sort();
  });
  return sorted;
}
