import type { ICruiseOptions } from 'dependency-cruiser';
import type { ComponentResolver, DependencyGraph, EffectReport, ReverseDependencyGraph } from './types';
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { cruise } from 'dependency-cruiser';
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

  const cruiseOptions: ICruiseOptions = {
    doNotFollow: 'node_modules',
    maxDepth: 99,
    tsConfig: { fileName: tsConfigPath },
    tsPreCompilationDeps: true,
  };

  const tsConfig = tsConfigPath
    ? await extractTSConfig(tsConfigPath)
    : undefined;

  const result = await cruise(entryPath, cruiseOptions, undefined, { tsConfig }).catch(() => undefined);

  const resolveAlias = (await interopDefault(await import('tsconfig-paths'))).createMatchPath(
    tsConfig?.options?.baseUrl || path.join(process.cwd(), '.'),
    tsConfig?.options?.paths ?? {},
  );

  const dependencyObject: Record<string, string[]> = {};

  const addDependency = (file: string, dep: string, components?: Set<string>): void => {
    if (dep !== file && !dependencyObject[file]?.includes(dep)) {
      if (!dependencyObject[file]) {
        dependencyObject[file] = [];
      }
      dependencyObject[file].push(dep);
      components?.add(dep);
    }
  };

  if (result?.output && typeof result?.output !== 'string') {
    result.output.modules.forEach((module) => {
      if (module.source) {
        const resolvedSource = ensureFileExtension(
          resolveAlias(
            module.source,
            undefined,
            undefined,
            EXTENSIONS,
          ) || module.source,
          EXTENSIONS,
        );

        const relativePath = path.relative(process.cwd(), resolvedSource);

        if (relativePath.includes('node_modules') || !fs.existsSync(resolvedSource)) {
          return;
        }

        if (!dependencyObject[relativePath]) {
          dependencyObject[relativePath] = [];
        }

        module.dependencies
          .filter((dep) => {
            return dep.resolved && !dep.resolved.includes('node_modules');
          })
          .forEach((dep) => {
            const resolvedDep = ensureFileExtension(
              resolveAlias(dep.resolved, undefined, undefined, EXTENSIONS) || dep.resolved,
              EXTENSIONS,
            );
            const depPath = path.relative(process.cwd(), resolvedDep);
            addDependency(relativePath, depPath);
          });
      }
    });
  }

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

    // 2. Scan for auto-imports and Vue components/imports in all identified files
    await Promise.all(Array.from(filesToScan).map(async (file) => {
      const filePath = path.resolve(process.cwd(), file);
      if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
        return;
      }

      const content = fs.readFileSync(filePath, 'utf-8');

      // Auto-import scanning
      // Strip comments and strings to avoid false positives
      const cleanContent = content
        .replace(/\/\/.*$/gm, '') // single line comments
        .replace(/\/\*[\s\S]*?\*\//g, '') // multi-line comments
        .replace(/(['"])(?:(?!\1)[^\\]|\\.)*?\1/g, '') // single/double quoted strings
        .replace(/`[\s\S]*?`/g, ''); // template literals (simplified)

      const identifiers = cleanContent.match(/\b(\w+)\b/g) || [];
      const uniqueIdentifiers = [...new Set(identifiers)];

      uniqueIdentifiers.forEach((id) => {
        const resolved = autoImportResolver(id);
        if (resolved) {
          const resolvedWithExt = ensureFileExtension(resolved, EXTENSIONS);
          const relPath = path.relative(process.cwd(), resolvedWithExt);
          addDependency(file, relPath, newLinkedComponents);
        }
      });

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

/**
 * 构建正向依赖图
 */
function createForwardDependencyGraph(dependencyObject: Record<string, string[]>): DependencyGraph {
  const Graph: DependencyGraph = new Map();

  Object.keys(dependencyObject).forEach((file) => {
    Graph.set(path.resolve(process.cwd(), file), new Set());
  });

  // 构建正向依赖图
  for (const [file, dependencies] of Object.entries(dependencyObject)) {
    const absFile = path.resolve(process.cwd(), file);
    for (const dep of dependencies) {
      const absDep = path.resolve(process.cwd(), dep);
      if (!Graph.has(absDep)) {
        Graph.set(absDep, new Set());
      }
      Graph.get(absFile)!.add(absDep);
    }
  }

  return Graph;
}

export async function buildDependencyGraph(entryPath: string): Promise<DependencyGraph> {
  const isNuxt = isNuxtProject();

  const resolveComponent = createComponentResolver();

  const dependencyObject = await scanFile([entryPath], resolveComponent, isNuxt);

  return createForwardDependencyGraph(dependencyObject);
}

/**
 * 构建反向依赖图
 */
function createReverseDependencyGraph(dependencyObject: Record<string, string[]>): ReverseDependencyGraph {
  const reverseGraph: ReverseDependencyGraph = new Map();

  Object.keys(dependencyObject).forEach((file) => {
    reverseGraph.set(path.resolve(process.cwd(), file), new Set());
  });

  // 构建反向依赖图
  for (const [file, dependencies] of Object.entries(dependencyObject)) {
    const absFile = path.resolve(process.cwd(), file);
    for (const dep of dependencies) {
      const absDep = path.resolve(process.cwd(), dep);
      if (!reverseGraph.has(absDep)) {
        reverseGraph.set(absDep, new Set());
      }
      reverseGraph.get(absDep)!.add(absFile);
    }
  }

  return reverseGraph;
}

export async function buildReverseDependencyGraph(entryPath: string): Promise<ReverseDependencyGraph> {
  const isNuxt = isNuxtProject();

  const resolveComponent = createComponentResolver();

  const dependencyObject = await scanFile([entryPath], resolveComponent, isNuxt);

  return createReverseDependencyGraph(dependencyObject);
}

export async function buildBidirectionalDependencyGraph(entryPath: string): Promise<{
  forward: DependencyGraph
  reverse: ReverseDependencyGraph
}> {
  const isNuxt = isNuxtProject();

  const resolveComponent = createComponentResolver();

  const dependencyObject = await scanFile([entryPath], resolveComponent, isNuxt);

  return {
    forward: createForwardDependencyGraph(dependencyObject),
    reverse: createReverseDependencyGraph(dependencyObject),
  };
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
