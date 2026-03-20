import type { DependencyGraph, EffectReport, ReverseDependencyGraph } from './types';
import path from 'node:path';
import process from 'node:process';

/**
 * 构建正向依赖图
 */
export function createForwardDependencyGraph(
  dependencyObject: Record<string, string[]>,
): DependencyGraph {
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

/**
 * 构建反向依赖图
 */
export function createReverseDependencyGraph(
  dependencyObject: Record<string, string[]>,
): ReverseDependencyGraph {
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
