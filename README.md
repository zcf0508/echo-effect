# echo-effect

[![npm version][npm-version-src]][npm-version-href]
[![npm downloads][npm-downloads-src]][npm-downloads-href]
[![bundle][bundle-src]][bundle-href]
[![JSDocs][jsdocs-src]][jsdocs-href]
[![License][license-src]][license-href]

`EchoEffect` is a powerful dependency impact analysis tool designed for the entire frontend ecosystem.
It helps developers understand the ripple effects of code changes across their projects
by mapping and analyzing dependency chains.

## Key Features

*   **Git Staged File Analysis**: Focuses specifically on the changes you're about to commit.
*   **Comprehensive Dependency Mapping**: Leverages `dependency-cruiser` to understand import/export relationships in:
    *   JavaScript (`.js`, `.jsx`)
    *   TypeScript (`.ts`, `.tsx`)
    *   Vue.js Single File Components (`.vue`)
    *   ES Modules (`.mjs`) and CommonJS (`.cjs`)
*   **Advanced Vue.js & Nuxt.js Support**:
    *   Parses `<template>` sections in `.vue` files to identify component dependencies.
    *   Intelligently resolves components from `unplugin-vue-components`.
    *   Prompts to install necessary Vue parsing dependencies (`@vue/compiler-sfc`, `@vue/compiler-dom`) if missing.
*   **Impact Level Reporting**: Clearly visualizes the chain of impact:
    *   **Level 0**: Your directly modified staged files.
    *   **Level 1+**: Files that depend on Level 0 files, and so on, up to a configurable depth.
*   **CLI Interface**: Easy to integrate into your development workflow.

## How It Works

1.  **Identifies Staged Files**: Runs `git diff --name-only --cached --diff-filter=AM`
to get a list of added or modified files in your Git staging area.
2.  **Builds Dependency Graph**: Scans your project from a specified entry point using `dependency-cruiser`
to map out all module dependencies.
For Vue/Nuxt projects, it performs additional parsing for template components.
3.  **Constructs Reverse Dependency Graph**: Inverts the dependency map to understand "who depends on whom."
4.  **Calculates Impact**: Compares the staged files against the reverse dependency graph
to trace and report all affected files.
5.  **Prints Report**: Outputs a clear, color-coded report to the console, detailing the modified and affected files.

## Usage

Navigate to your project's root directory and run:

```bash
npx -y echo-effect <path-to-your-project-entry-folder>
```

For example:

```bash
# For a project with src/main.ts as an entry point
npx -y echo-effect src/main.ts
```

## Why Echo Effect?
- Proactive Risk Assessment: Understand the potential blast radius of your changes before you commit or push.
- Focused Code Reviews: Helps reviewers concentrate on the most critical areas affected by a change.
- Enhanced Codebase Understanding: Provides insights into the interconnectedness of your project's modules.
- Safer Refactoring: Make larger changes with more confidence by seeing their downstream effects.

## Testing

The project includes comprehensive test coverage for the core `scanFile` functionality:

### Test Categories
- **Basic Functionality**: Single file scanning, multiple file scanning, file extension handling
- **Edge Cases**: Non-existent files, empty dependencies, node_modules filtering
- **Vue Component Parsing**: SFC component resolution, duplicate component handling
- **Path Handling**: TypeScript path alias resolution, relative path processing

### Running Tests
```bash
npm test
```

Tests use Vitest with proper mocking of file system operations and external dependencies.

## License

[MIT](./LICENSE) License © [huali](https://github.com/zcf0508)

<!-- Badges -->

[npm-version-src]: https://img.shields.io/npm/v/echo-effect?style=flat&colorA=080f12&colorB=1fa669
[npm-version-href]: https://npmjs.com/package/echo-effect
[npm-downloads-src]: https://img.shields.io/npm/dm/echo-effect?style=flat&colorA=080f12&colorB=1fa669
[npm-downloads-href]: https://npmjs.com/package/echo-effect
[bundle-src]: https://img.shields.io/bundlephobia/minzip/echo-effect?style=flat&colorA=080f12&colorB=1fa669&label=minzip
[bundle-href]: https://bundlephobia.com/result?p=echo-effect
[license-src]: https://img.shields.io/github/license/zcf0508/echo-effect.svg?style=flat&colorA=080f12&colorB=1fa669
[license-href]: https://github.com/zcf0508/echo-effect/blob/main/LICENSE
[jsdocs-src]: https://img.shields.io/badge/jsdocs-reference-080f12?style=flat&colorA=080f12&colorB=1fa669
[jsdocs-href]: https://www.jsdocs.io/package/echo-effect
