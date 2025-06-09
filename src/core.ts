import type { MadgeConfig, MadgeInstance } from 'madge';
import type { ComponentResolver, EffectReport, ReverseDependencyGraph } from './types';
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import madge from 'madge';
import { createComponentResolver, isNuxtProject, parseVueTemplateForComponents } from './vue';

export function getStagedFiles(): Set<string> {
  const gitOutput = execSync('git diff --name-only --cached --diff-filter=AM', {
    encoding: 'utf-8',
  });

  const stagedFiles = gitOutput
    .split('\n')
    .filter(Boolean)
    .map(file => path.resolve(process.cwd(), file));

  return new Set(stagedFiles);
}

export async function scanFile(
  entryPath: string | string[],
  resolveComponent: ComponentResolver,
  isNuxt: boolean = false,
  isRoot: boolean = true,
): Promise<Record<string, string[]>> {
  const config: MadgeConfig = {
    baseDir: process.cwd(),
    fileExtensions: ['ts', 'tsx', 'js', 'jsx', 'vue', 'mjs', 'cjs'],
    tsConfig: path.resolve(process.cwd(), 'tsconfig.json'),
    includeNpm: false,
    excludeRegExp: [
      /^node_modules/,
      /\.d\.ts$/,
      /\.nuxt/,
      /\.output/,
      /\.cache/,
      /dist/,
    ],
  };

  if (isNuxt) {
    const nuxtTsConfig = path.resolve(process.cwd(), '.nuxt/tsconfig.json');
    if (fs.existsSync(nuxtTsConfig)) {
      config.tsConfig = nuxtTsConfig;
    }
  }

  const instance: MadgeInstance = await madge(entryPath, config);
  const dependencyObject = instance.obj();

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
