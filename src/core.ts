import type { ICruiseOptions } from 'dependency-cruiser';
import type { ComponentResolver, EffectReport, ReverseDependencyGraph } from './types';
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { cruise } from 'dependency-cruiser';
import extractTSConfig from 'dependency-cruiser/config-utl/extract-ts-config';
import { createMatchPath } from 'tsconfig-paths';
import { ensurePackages } from './utils';
import { createComponentResolver, isNuxtProject, isVue, parseVueTemplateForComponents } from './vue';

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
  entryPath: string | string[],
  resolveComponent: ComponentResolver,
  isNuxt: boolean = false,
  isRoot: boolean = true,
): Promise<Record<string, string[]>> {
  const tsConfigPath = isNuxt && fs.existsSync(path.resolve(process.cwd(), '.nuxt/tsconfig.json'))
    ? '.nuxt/tsconfig.json'
    : 'tsconfig.json';
  const tsConfig = extractTSConfig(tsConfigPath);

  const cruiseOptions: ICruiseOptions = {
    doNotFollow: 'node_modules',
    maxDepth: 99,
    tsConfig: { fileName: tsConfigPath },
    tsPreCompilationDeps: true,
  };

  const filesToCruise = Array.isArray(entryPath)
    ? entryPath
    : [entryPath];
  const result = await cruise(filesToCruise, cruiseOptions, undefined, { tsConfig });

  const resolveAlias = createMatchPath(tsConfig.options.baseUrl || './', tsConfig.options.paths ?? {});

  const dependencyObject: Record<string, string[]> = {};

  if (typeof result.output !== 'string') {
    // console.log(JSON.stringify(result.output.modules));
    result.output.modules.forEach((module) => {
      if (module.source) {
        const resolvedSource = ensureFileExtension(
          resolveAlias(module.source) || module.source,
          ['.ts', '.tsx', 'cjs', 'mjs', '.js', '.jsx', '.vue'],
        );

        const relativePath = path.relative(process.cwd(), resolvedSource);

        if (relativePath.includes('node_modules') || !fs.existsSync(resolvedSource)) {
          return;
        }

        dependencyObject[relativePath] = module.dependencies
          .filter(dep => dep.resolved && !dep.resolved.includes('node_modules') && fs.existsSync(
            ensureFileExtension(
              resolveAlias(dep.resolved) || dep.resolved,
              ['.ts', '.tsx', '.js', '.jsx', '.vue'],
            ),
          ))
          .map((dep) => {
            const resolvedDep = ensureFileExtension(
              resolveAlias(dep.resolved) || dep.resolved,
              ['.ts', '.tsx', '.js', '.jsx', '.vue'],
            );
            const depPath = path.relative(process.cwd(), resolvedDep);
            return depPath;
          });
      }
    });
  }

  // console.log(dependencyObject);

  if (isVue()) {
    if (isRoot) {
      await ensurePackages(['@vue/compiler-sfc']);
      await ensurePackages(['@vue/compiler-dom']);
    }

    const newLinkedComponents = new Set<string>();

    await Promise.all(
      Object.entries(dependencyObject).map(async ([_, dependencies]) => {
        const vueFiles = Array.from(new Set(dependencies.flat())).filter(file => file.endsWith('.vue'));

        await Promise.all(
          vueFiles.map(async (file) => {
            const components = (await parseVueTemplateForComponents(file, resolveComponent)).map(
              compPath => compPath.replace(process.cwd(), '').slice(1),
            );

            if (dependencyObject[file]) {
              components.forEach((compPath) => {
                if (!dependencyObject[file].includes(compPath)) {
                  dependencyObject[file].push(compPath);
                  newLinkedComponents.add(compPath);
                }
              });
            }
            else {
              dependencyObject[file] = components;
            }
          }),
        );
      }),
    );

    if (newLinkedComponents.size && isRoot) {
      const newDependencyObject = await scanFile(
        Array.from(newLinkedComponents),
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

  return dependencyObject;
}

export async function buildReverseDependencyGraph(entryPath: string): Promise<ReverseDependencyGraph> {
  const isNuxt = isNuxtProject();

  const resolveComponent = createComponentResolver();

  const dependencyObject = await scanFile(entryPath, resolveComponent, isNuxt);

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

  console.log(reverseGraph);

  return reverseGraph;
}

export function calculateEffect(
  modifiedFiles: Set<string>,
  reverseGraph: ReverseDependencyGraph,
): EffectReport {
  const effectReport: EffectReport = new Map();
  const queue: { file: string, level: number }[] = [];

  // console.log(reverseGraph);

  modifiedFiles.forEach((file) => {
    console.log('Modified file:', file, reverseGraph.has(file));
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
