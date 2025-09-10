import type { Awaitable } from './types';
import process from 'node:process';
import { consola as _consola } from 'consola';
import { isPackageExists } from 'local-pkg';

export const consola = _consola.withTag('ee');

export async function interopDefault<T>(m: Awaitable<T>): Promise<T extends { default: infer U } ? U : T> {
  const resolved = await m;
  return (resolved as any).default || resolved;
}

const cwd = process.cwd();

function isPackageInScope(name: string): boolean {
  return isPackageExists(name, { paths: [cwd] });
}

/**
 * https://github.com/antfu/eslint-config/blob/main/src/utils.ts#L119
 */
export async function ensurePackages(packages: (string | undefined)[]): Promise<void> {
  if (process.env.CI || process.stdout.isTTY === false) {
    return;
  }

  const nonExistingPackages = packages.filter(i => i && !isPackageInScope(i)) as string[];
  if (nonExistingPackages.length === 0) {
    return;
  }

  const p = await import('@clack/prompts');
  const result = await p.confirm({
    message: `${nonExistingPackages.length === 1
      ? 'Package is'
      : 'Packages are'} required: ${nonExistingPackages.join(', ')}. Do you want to install them?`,
  });
  if (result) {
    await import('@antfu/install-pkg').then(i => i.installPackage(
      nonExistingPackages,
      {
        dev: true,
      },
    ));
  }
}

export const EXTENSIONS = ['.ts', '.tsx', 'cjs', 'mjs', '.js', '.jsx', '.vue'];
