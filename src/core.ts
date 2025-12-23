import type { ComponentResolver, EffectReport, ReverseDependencyGraph } from './types';
import type { AffectedSymbol, CodeSnippet, CodeSymbol, SymbolReference } from './types/symbols';
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { TreeSitterAnalyzer } from './analyzer/tree-sitter';
import { scanDependenciesJsTs, scanDependenciesMultiLang } from './analyzer/tree-sitter/deps';
import { createAutoImportResolverFn } from './resolvers';
import {
  ensurePackages,
  EXTENSIONS,
  extractTSConfig,
  getTsconfigPath,
  interopDefault,
} from './utils';
import {
  createComponentResolver,
  isNuxtProject,
  isVue,
  parseVueScriptForImports,
  parseVueTemplateForComponents,
} from './vue';

function ensureFileExtension(filePath: string, extensions: string[]): string {
  // 如果路径已经有扩展名，直接返回
  if (path.extname(filePath)) {
    return filePath;
  }

  // 检查文件是否存在，如果存在就返回带扩展名的路径
  for (const ext of extensions) {
    const fullPath = path.resolve(process.cwd(), filePath + ext);
    if (fs.existsSync(fullPath)) {
      return filePath + ext;
    }
  }

  // 检查是否是目录，如果是目录，检查是否存在 index 文件
  const dirPath = path.resolve(process.cwd(), filePath);
  if (fs.existsSync(dirPath) && fs.statSync(dirPath).isDirectory()) {
    for (const ext of extensions) {
      const indexFile = path.join(dirPath, `index${ext}`);
      if (fs.existsSync(indexFile)) {
        return path.join(filePath, `index${ext}`);
      }
    }
  }

  // 如果找不到文件，返回原始路径（让后续处理处理错误）
  return filePath;
}

export function getStagedFiles(): Set<string> {
  try {
    // 获取 Git 根目录
    const gitRoot = execSync('git rev-parse --show-toplevel', {
      encoding: 'utf-8',
    }).trim();

    // 获取暂存文件列表（相对于 Git 根目录）
    const gitOutput = execSync('git diff --name-only --cached --diff-filter=AM', {
      encoding: 'utf-8',
      cwd: gitRoot,
    });

    const stagedFiles = gitOutput
      .split('\n')
      .filter(Boolean)
      .map(file => path.resolve(gitRoot, file));

    return new Set(stagedFiles);
  }
  catch {
    // 如果不是 Git 仓库或者没有暂存文件，返回空集合
    return new Set();
  }
}

export async function scanFile(
  entryPath: string[],
  resolveComponent: ComponentResolver,
  isNuxt: boolean = false,
  isRoot: boolean = true,
): Promise<Record<string, string[]>> {
  const tsConfigPath = getTsconfigPath(isNuxt);

  const tsConfig = tsConfigPath
    ? await extractTSConfig(tsConfigPath)
    : undefined;

  const resolveAlias = (await interopDefault(await import('tsconfig-paths'))).createMatchPath(
    tsConfig?.options?.baseUrl || path.join(process.cwd(), '.'),
    tsConfig?.options?.paths ?? {},
  );

  const cwdName = path.basename(process.cwd());
  const normalizedEntries = entryPath.map((p) => {
    if (path.isAbsolute(p) && fs.existsSync(p)) {
      return p;
    }
    const rel = path.resolve(process.cwd(), p);
    if (fs.existsSync(rel)) {
      return rel;
    }
    const marker = `${cwdName}${path.sep}`;
    const idx = p.indexOf(marker);
    if (idx >= 0) {
      const sub = p.slice(idx + marker.length);
      const rebased = path.resolve(process.cwd(), sub);
      if (fs.existsSync(rebased)) {
        return rebased;
      }
    }
    return rel;
  });

  // 使用 Tree-Sitter 扫描依赖（JS/TS 为基础，多语言补充）
  const dependencyObject: Record<string, string[]> = await scanDependenciesJsTs(normalizedEntries);
  const multiDeps = await scanDependenciesMultiLang(normalizedEntries);
  Object.entries(multiDeps).forEach(([file, deps]) => {
    if (!dependencyObject[file]) {
      dependencyObject[file] = [];
    }
    deps.forEach((d) => {
      if (!dependencyObject[file].includes(d)) {
        dependencyObject[file].push(d);
      }
    });
  });

  const addDependency = (file: string, dep: string, components?: Set<string>): void => {
    if (dep !== file && !dependencyObject[file]?.includes(dep)) {
      if (!dependencyObject[file]) {
        dependencyObject[file] = [];
      }
      dependencyObject[file].push(dep);
      components?.add(dep);
    }
  };

  // Tree-Sitter 已经覆盖了 JS/TS 的 import/export/require 与自动导入，这里不再依赖 dependency-cruiser

  if (isVue()) {
    if (isRoot) {
      await ensurePackages(['@vue/compiler-sfc']);
      await ensurePackages(['@vue/compiler-dom']);
    }

    const newLinkedComponents = new Set<string>();
    const autoImportResolver = createAutoImportResolverFn();

    // 1. Collect all files to scan (keys and dependencies)
    const filesToScan = new Set<string>();
    Object.entries(dependencyObject).forEach(([file, deps]) => {
      filesToScan.add(file);
      deps.forEach(dep => filesToScan.add(dep));
    });
    // 确保入口文件（包括 .vue）也参与扫描
    normalizedEntries.forEach((abs) => {
      const rel = path.relative(process.cwd(), abs);
      const isFile = fs.existsSync(abs) && fs.statSync(abs).isFile();
      const ext = path.extname(abs).toLowerCase();
      const isSupported = ['.vue', '.ts', '.tsx', '.js', '.jsx'].includes(ext);
      if (isFile && isSupported) {
        filesToScan.add(rel);
        if (!dependencyObject[rel]) {
          dependencyObject[rel] = [];
        }
      }
    });

    // 2. Scan for auto-imports and Vue components/imports in all identified files
    await Promise.all(Array.from(filesToScan).map(async (file) => {
      const filePath = path.resolve(process.cwd(), file);
      if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
        return;
      }

      const content = fs.readFileSync(filePath, 'utf-8');

      // Auto-import 已由 Tree-Sitter 基础扫描覆盖，避免重复处理

      // Vue specific scanning
      if (file.endsWith('.vue')) {
        // 1. Template components
        const components = await parseVueTemplateForComponents(file, resolveComponent).catch(() => []);
        components.forEach((compPath) => {
          const relCompPath = path.relative(process.cwd(), compPath);
          addDependency(file, relCompPath, newLinkedComponents);
        });

        // 2. Script imports (fallback for dependency-cruiser)
        const scriptImports = await parseVueScriptForImports(file).catch(() => []);
        scriptImports.forEach((importSpecifier) => {
          let resolvedImport = resolveAlias(importSpecifier, undefined, undefined, EXTENSIONS) || importSpecifier;

          // If relative import, resolve it based on current file
          if (resolvedImport.startsWith('.')) {
            resolvedImport = path.resolve(path.dirname(filePath), resolvedImport);
          }

          const resolvedWithExt = ensureFileExtension(resolvedImport, EXTENSIONS);
          const relImportPath = path.relative(process.cwd(), resolvedWithExt);

          if (!relImportPath.includes('node_modules') && fs.existsSync(path.resolve(process.cwd(), relImportPath))) {
            addDependency(file, relImportPath, newLinkedComponents);
          }
        });
      }
    }));

    if (newLinkedComponents.size) {
      // Find components that are not in dependencyObject keys yet
      const unvisitedComponents = Array.from(newLinkedComponents).filter(c => !dependencyObject[c]);

      if (unvisitedComponents.length > 0) {
        const newDependencyObject = await scanFile(
          unvisitedComponents.map(p => path.resolve(process.cwd(), p)),
          resolveComponent,
          isNuxt,
          false,
        );

        Object.entries(newDependencyObject).forEach(([file, dependencies]) => {
          if (!dependencyObject[file]) {
            dependencyObject[file] = dependencies;
          }
          else {
            dependencyObject[file] = [...new Set([...dependencyObject[file], ...dependencies])];
          }
        });
      }
    }
  }

  // Sort dependencies for consistent output
  const sortedDependencyObject: Record<string, string[]> = {};
  Object.keys(dependencyObject).sort().forEach((key) => {
    sortedDependencyObject[key] = [...new Set(dependencyObject[key])].sort();
  });

  return sortedDependencyObject;
}

export async function buildReverseDependencyGraph(entryPath: string): Promise<ReverseDependencyGraph> {
  const isNuxt = isNuxtProject();

  const resolveComponent = createComponentResolver();

  const dependencyObject = await scanFile([entryPath], resolveComponent, isNuxt);

  const reverseGraph: ReverseDependencyGraph = new Map();

  Object.keys(dependencyObject).forEach((file) => {
    reverseGraph.set(path.resolve(process.cwd(), file), new Set());
  });

  for (const [file, dependencies] of Object.entries(dependencyObject)) {
    const absFile = path.resolve(process.cwd(), file);
    for (const dep of dependencies as string[]) {
      const absDep = path.resolve(process.cwd(), dep);
      if (!reverseGraph.has(absDep)) {
        reverseGraph.set(absDep, new Set());
      }
      reverseGraph.get(absDep)!.add(absFile);
    }
  }

  return reverseGraph;
}

export function calculateEffect(
  modifiedFiles: Set<string>,
  reverseGraph: ReverseDependencyGraph,
): EffectReport {
  const effectReport: EffectReport = new Map();
  const queue: { file: string, level: number }[] = [];

  modifiedFiles.forEach((file) => {
    if (reverseGraph.has(file)) {
      if (!effectReport.has(file)) {
        queue.push({ file, level: 0 });
        effectReport.set(file, { level: 0, isModified: true, dependencies: [] });
      }
    }
    else {
      // Add modified file to report if it's not in the graph
      effectReport.set(file, { level: 0, isModified: true, dependencies: [] });
    }
  });

  while (queue.length > 0) {
    const { file, level } = queue.shift()!;
    const dependents = reverseGraph.get(file) || new Set();

    for (const dependent of dependents) {
      const newLevel = level + 1;
      if (!effectReport.has(dependent)) {
        effectReport.set(dependent, { level: newLevel, isModified: false, dependencies: [file] });
        queue.push({ file: dependent, level: newLevel });
      }
      else if (effectReport.get(dependent)!.level >= newLevel) {
        effectReport.get(dependent)!.dependencies.push(file);
      }
    }
  }

  return effectReport;
}

export interface ScanOptions {
  analyzer?: 'auto' | 'dependency-cruiser' | 'tree-sitter'
  maxDepth?: number
  includeSymbols?: boolean
  includeSnippets?: boolean
}

export async function buildReverseDependencyGraphWithSymbols(
  entryPath: string,
  options?: ScanOptions,
): Promise<{
    dependencyGraph: ReverseDependencyGraph
    symbolMap: Map<string, CodeSymbol[]>
    references: SymbolReference[]
  }> {
  const dependencyGraph = await buildReverseDependencyGraph(entryPath);
  const symbolMap = new Map<string, CodeSymbol[]>();
  const references: SymbolReference[] = [];
  const files = new Set<string>();
  dependencyGraph.forEach((_, file) => files.add(file));
  dependencyGraph.forEach(dependents => dependents.forEach(f => files.add(f)));
  const useTreeSitter = options?.analyzer !== 'dependency-cruiser';
  if (useTreeSitter) {
    const entryAbs = path.isAbsolute(entryPath)
      ? entryPath
      : path.resolve(process.cwd(), entryPath);
    files.add(entryAbs);
    const getLangByExt = (ext: string): string | null => {
      if (ext === '.js') {
        return 'javascript';
      }
      if (ext === '.jsx') {
        return 'jsx';
      }
      if (ext === '.ts') {
        return 'typescript';
      }
      if (ext === '.tsx') {
        return 'tsx';
      }
      if (ext === '.py') {
        return 'python';
      }
      if (ext === '.java') {
        return 'java';
      }
      if (ext === '.go') {
        return 'go';
      }
      if (ext === '.cpp' || ext === '.cc' || ext === '.cxx' || ext === '.h' || ext === '.hh' || ext === '.hpp') {
        return 'cpp';
      }
      return null;
    };
    for (const absPath of files) {
      if (!fs.existsSync(absPath) || fs.statSync(absPath).isDirectory()) {
        continue;
      }
      const ext = path.extname(absPath).toLowerCase();
      const lang = getLangByExt(ext);
      if (!lang) {
        continue;
      }
      const content = fs.readFileSync(absPath, 'utf-8');
      const analyzer = new TreeSitterAnalyzer(lang);
      const syms = await analyzer.extractSymbols(absPath, content);
      symbolMap.set(absPath, syms);
      const refs = await analyzer.extractReferences(absPath, content);
      references.push(...refs);
    }
  }
  return { dependencyGraph, symbolMap, references };
}

export async function findAffectedSymbolsFromDiff(
  filePath: string,
  originalContent: string,
  modifiedContent: string,
  analyzer: import('./types/analyzer').CodeAnalyzer,
): Promise<AffectedSymbol[]> {
  const oLines = originalContent.split('\n');
  const mLines = modifiedContent.split('\n');
  let start = 1;
  const endO = oLines.length;
  let endM = mLines.length;
  let i = 0;
  while (i < oLines.length && i < mLines.length && oLines[i] === mLines[i]) {
    i++;
  }
  start = i + 1;
  let jO = oLines.length - 1;
  let jM = mLines.length - 1;
  while (jO >= i && jM >= i && oLines[jO] === mLines[jM]) {
    jO--;
    jM--;
  }
  endM = jM + 1;
  if (start > endM) {
    return [];
  }
  const affected = await analyzer.findAffectedSymbols(filePath, modifiedContent, { startLine: start, endLine: endM });
  const refs = await analyzer.extractReferences(filePath, modifiedContent);
  const refMap = new Map<string, SymbolReference[]>();
  refs.forEach((r) => {
    const k = r.symbol.name;
    const arr = refMap.get(k) || [];
    arr.push(r);
    refMap.set(k, arr);
  });
  affected.forEach((a) => {
    a.referencedBy = refMap.get(a.symbol.name) || [];
  });
  return affected;
}

export function extractRelevantSnippets(
  affectedSymbols: AffectedSymbol[],
  reverseGraph: ReverseDependencyGraph,
  references: SymbolReference[],
  depth: number = 1,
): CodeSnippet[] {
  const snippets: CodeSnippet[] = [];
  const added = new Set<string>();
  const reachable = new Set<string>();
  const queue: { file: string, d: number }[] = [];
  affectedSymbols.forEach((a) => {
    queue.push({ file: path.resolve(process.cwd(), a.symbol.filePath), d: 0 });
  });
  while (queue.length) {
    const { file, d } = queue.shift()!;
    if (reachable.has(file)) {
      continue;
    }
    reachable.add(file);
    if (d < depth) {
      const deps = reverseGraph.get(file) || new Set();
      deps.forEach(f => queue.push({ file: f, d: d + 1 }));
    }
  }
  affectedSymbols.forEach((a) => {
    const abs = path.resolve(process.cwd(), a.symbol.filePath);
    if (fs.existsSync(abs) && fs.statSync(abs).isFile()) {
      const content = fs.readFileSync(abs, 'utf-8');
      const lines = content.split('\n');
      const s = Math.max(1, a.symbol.range.startLine);
      const e = Math.min(lines.length, a.symbol.range.endLine);
      const code = lines.slice(s - 1, e).join('\n');
      const key = `${abs}:${s}:${e}`;
      if (!added.has(key)) {
        snippets.push({
          filePath: abs,
          type: 'block',
          name: a.symbol.name,
          startLine: s,
          endLine: e,
          code,
          symbolsUsed: [],
        });
        added.add(key);
      }
    }
    references.forEach((r) => {
      const absR = path.resolve(process.cwd(), r.referrer.filePath);
      if (r.symbol.name === a.symbol.name && reachable.has(absR)) {
        const key = `${absR}:${r.context.startLine}:${r.context.endLine}`;
        if (!added.has(key)) {
          snippets.push(r.context);
          added.add(key);
        }
      }
    });
  });
  return snippets;
}

export async function buildEnhancedEffectFromChanges(
  entryPath: string,
  changes: Array<{ filePath: string, original: string, modified: string }>,
  options?: { snippetDepth?: number },
): Promise<{
    dependencyGraph: ReverseDependencyGraph
    symbolMap: Map<string, CodeSymbol[]>
    references: SymbolReference[]
    affectedSymbols: AffectedSymbol[]
    snippets: CodeSnippet[]
  }> {
  const { dependencyGraph, symbolMap, references } = await buildReverseDependencyGraphWithSymbols(entryPath, { analyzer: 'tree-sitter' });
  const affectedSymbols: AffectedSymbol[] = [];
  for (const ch of changes) {
    const abs = path.resolve(process.cwd(), ch.filePath);
    const ext = path.extname(abs).toLowerCase();
    const lang = ((): string | null => {
      if (ext === '.js') {
        return 'javascript';
      }
      if (ext === '.jsx') {
        return 'jsx';
      }
      if (ext === '.ts') {
        return 'typescript';
      }
      if (ext === '.tsx') {
        return 'tsx';
      }
      if (ext === '.py') {
        return 'python';
      }
      if (ext === '.java') {
        return 'java';
      }
      if (ext === '.go') {
        return 'go';
      }
      if (ext === '.cpp' || ext === '.cc' || ext === '.cxx' || ext === '.h' || ext === '.hh' || ext === '.hpp') {
        return 'cpp';
      }
      return null;
    })();
    if (!lang) {
      continue;
    }
    const analyzer = new TreeSitterAnalyzer(lang);
    const aff = await findAffectedSymbolsFromDiff(abs, ch.original, ch.modified, analyzer);
    affectedSymbols.push(...aff);
  }
  const snippets = extractRelevantSnippets(affectedSymbols, dependencyGraph, references, options?.snippetDepth ?? 1);
  return { dependencyGraph, symbolMap, references, affectedSymbols, snippets };
}
