# echo-effect

[![npm version][npm-version-src]][npm-version-href]
[![npm downloads][npm-downloads-src]][npm-downloads-href]
[![bundle][bundle-src]][bundle-href]
[![JSDocs][jsdocs-src]][jsdocs-href]
[![License][license-src]][license-href]

`EchoEffect` 是一款专为前端生态设计的强大依赖影响分析工具。
它帮助开发者理解代码变更在项目中的“涟漪效应”，通过映射和分析依赖链，全面掌握变更的影响范围。

## 主要特性

*   **Git 暂存文件分析**：聚焦于你即将提交的更改。
*   **全面依赖关系映射**：利用 `madge` 理解以下文件的导入/导出关系：
    *   JavaScript（`.js`, `.jsx`）
    *   TypeScript（`.ts`, `.tsx`）
    *   Vue 单文件组件（`.vue`）
    *   ES Modules（`.mjs`）与 CommonJS（`.cjs`）
*   **高级 Vue.js & Nuxt.js 支持**：
    *   解析 `.vue` 文件中的 `<template>` 部分，识别组件依赖。
    *   智能解析 `unplugin-vue-components` 自动引入的组件。
    *   缺少依赖时，自动提示安装 Vue 解析相关依赖（`@vue/compiler-sfc`、`@vue/compiler-dom`）。
*   **影响层级报告**：清晰可视化影响链条：
    *   **Level 0**：你直接修改的暂存文件。
    *   **Level 1+**：依赖 Level 0 文件的文件，依次递归。
*   **CLI 命令行界面**：轻松集成到你的开发流程。

## 工作原理

1.  **识别暂存文件**：运行 `git diff --name-only --cached --diff-filter=AM` 获取 Git 暂存区新增或修改的文件列表。
2.  **构建依赖图**：从指定入口文件出发，利用 `madge` 扫描项目，映射所有模块依赖。对于 Vue/Nuxt 项目，还会额外解析模板组件依赖。
3.  **反向依赖图**：反转依赖关系，分析“谁依赖了谁”。
4.  **计算影响范围**：将暂存文件与反向依赖图对比，追踪并报告所有受影响文件，按影响层级分类。
5.  **输出报告**：在控制台输出清晰、带颜色的报告，详细列出修改及受影响文件。

## 使用方法

在项目根目录下运行：

```bash
npx -y echo-effect <项目入口文件路径>
```

例如：

```bash
# 以 src/main.ts 为入口的项目
npx -y echo-effect src/main.ts
```

## 为什么选择 Echo Effect？
- 主动风险评估：在提交或推送前，了解你的更改可能带来的影响范围。
- 聚焦代码评审：帮助评审者关注受影响的关键区域。
- 加深代码理解：洞察项目模块间的依赖关系。
- 更安全的重构：在大范围重构时，提前掌握下游影响，提高信心。

## 许可证

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
