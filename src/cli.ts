import type { EffectReport } from './types';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { buildReverseDependencyGraph, calculateEffect, getStagedFiles } from './core';
import { consola } from './utils';

function printReport(report: EffectReport): void {
  const filesByLevel: Record<number, string[]> = {};

  report.forEach(({ level }, file) => {
    if (!filesByLevel[level]) {
      filesByLevel[level] = [];
    }
    filesByLevel[level].push(file);
  });

  if (Object.keys(filesByLevel).length === 1 && filesByLevel[0]?.length > 0) {
    consola.success('No dependency found.');
    return;
  }

  consola.log('--- Dependency Impact Analysis Report ---');

  Object.keys(filesByLevel).sort((a, b) => +a - +b).forEach((levelStr) => {
    const level = +levelStr;
    if (level > 5) {
      return;
    }

    const files = filesByLevel[level];
    const relativeRoot = process.cwd();

    if (level === 0) {
      consola.log(`\n🔴 LEVEL 0: Modified source files (${files.length})`);
    }
    else {
      consola.log(`\n${level === 1
        ? '🟠'
        : '🔵'} LEVEL ${level}: Indirect impact (${files.length})`);
    }

    files.sort().forEach((file) => {
      consola.log(` - ${path.relative(relativeRoot, file)}`);
    });
  });

  consola.success('\n--- Report End ---');
}

export async function main(): Promise<void> {
  const entryArg = process.argv[2];
  if (!entryArg) {
    consola.error('Error: Please provide a project entry file or directory as an argument.');
    process.exit(1);
  }

  const entryPath = path.resolve(process.cwd(), entryArg);
  if (!fs.existsSync(entryPath)) {
    consola.error(`Error: Entry path does not exist: ${entryPath}`);
    process.exit(1);
  }

  try {
    const stagedFiles = getStagedFiles();
    if (stagedFiles.size === 0) {
      consola.log('No modified JS/TS/Vue files in the staging area, no need to analyze.');
      return;
    }

    const reverseGraph = await buildReverseDependencyGraph(entryPath);
    const report = calculateEffect(stagedFiles, reverseGraph);
    printReport(report);
  }
  catch (error) {
    consola.error('\n❌ Analysis error:', error);
    process.exit(1);
  }
}
