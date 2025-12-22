import { describe, expect, it } from 'vitest';
import { TreeSitterAnalyzer } from '../../src/analyzer/tree-sitter';

describe('treeSitterAnalyzer JS/TS', () => {
  it('extracts JS functions and classes', async () => {
    const analyzer = new TreeSitterAnalyzer('javascript');
    const code = `
      function foo(a, b) { return a + b }
      class Bar { method() { return foo(1,2) } }
      foo(3,4)
    `;
    const symbols = await analyzer.extractSymbols('a.js', code);
    const names = symbols.map(s => `${s.type}:${s.name}`).sort();
    expect(names).toContain('function:foo');
    expect(names).toContain('class:Bar');
    const refs = await analyzer.extractReferences('a.js', code);
    expect(refs.length).toBeGreaterThan(0);
  });

  it('extracts TS functions and classes', async () => {
    const analyzer = new TreeSitterAnalyzer('typescript');
    const code = `
      function add(a: number, b: number): number { return a + b }
      class Calc { sum(x: number, y: number) { return add(x,y) } }
      add(5,6)
    `;
    const symbols = await analyzer.extractSymbols('a.ts', code);
    const names = symbols.map(s => `${s.type}:${s.name}`).sort();
    expect(names).toContain('function:add');
    expect(names).toContain('class:Calc');
    const refs = await analyzer.extractReferences('a.ts', code);
    expect(refs.length).toBeGreaterThan(0);
  });
});
