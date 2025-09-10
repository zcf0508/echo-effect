import type { ParsedCommandLine } from 'typescript';
import type { Awaitable } from './types';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
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

export async function extractTSConfig(pTSConfigFileName: string): Promise<ParsedCommandLine> {
  let lReturnValue = {} as ParsedCommandLine;

  const typescript = await interopDefault(await import('typescript'));

  if (typescript) {
    const FORMAT_DIAGNOSTICS_HOST = {
      getCanonicalFileName(pFileName: string) {
        let lReturnValue = pFileName.toLowerCase();

        // depends on the platform which branch is taken, hence the c8 ignore
        /* c8 ignore start */
        if (typescript?.sys?.useCaseSensitiveFileNames ?? false) {
          lReturnValue = pFileName;
        }
        /* c8 ignore stop */
        return lReturnValue;
      },
      getCurrentDirectory() {
        return process.cwd();
      },
      getNewLine() {
        return '\n';
      },
    };

    const lConfig = typescript.readConfigFile(
      pTSConfigFileName,
      typescript.sys.readFile,
    );

    if (typeof lConfig.error !== 'undefined') {
      throw new TypeError(
        typescript.formatDiagnostics([lConfig.error], FORMAT_DIAGNOSTICS_HOST),
      );
    }
    lReturnValue = typescript.parseJsonConfigFileContent(
      lConfig.config,
      typescript.sys,
      dirname(resolve(pTSConfigFileName)),
      {},
      pTSConfigFileName,
    );

    if (lReturnValue.errors.length > 0) {
      throw new Error(
        typescript.formatDiagnostics(
          lReturnValue.errors,
          FORMAT_DIAGNOSTICS_HOST,
        ),
      );
    }
  }

  return lReturnValue;
}

export function getTsconfigPath(isNuxt = false): string | undefined {
  if (isNuxt) {
    const tsconfigPath = resolve(process.cwd(), '.nuxt/tsconfig.json');
    if (existsSync(tsconfigPath)) {
      return tsconfigPath;
    }
  }
  const tsconfigPath = resolve(process.cwd(), 'tsconfig.json');
  if (existsSync(tsconfigPath)) {
    return tsconfigPath;
  }
  else {
    const tsconfigPath = resolve(process.cwd(), 'jsconfig.json');
    if (existsSync(tsconfigPath)) {
      return tsconfigPath;
    }
  }
}
