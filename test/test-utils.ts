import path from 'node:path';

/**
 * 规范化路径，使其在不同平台上保持一致
 * 将路径分隔符统一为 Unix 风格 (/)
 */
export function normalizePath(filePath: string): string {
  return filePath.replace(/\\/g, '/');
}

/**
 * 规范化依赖关系对象中的所有路径
 */
export function normalizeDependencyPaths(
  dependencies: Record<string, string[]>,
): Record<string, string[]> {
  const normalized: Record<string, string[]> = {};

  for (const [filePath, deps] of Object.entries(dependencies)) {
    normalized[normalizePath(filePath)] = deps.map(normalizePath);
  }

  return normalized;
}
