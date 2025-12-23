import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { TreeSitterAnalyzer } from '../../src/analyzer/tree-sitter';

const require = createRequire(import.meta.url);
function hasPkg(name: string): boolean {
  try {
    require.resolve(name);
    return true;
  }
  catch {
    return false;
  }
}

describe('treeSitterAnalyzer 多语言增强', () => {
  it.skipIf(!hasPkg('tree-sitter-cpp'))('c++ 命名空间与方法识别', async () => {
    const analyzer = new TreeSitterAnalyzer('cpp');
    const code = `
namespace N { int foo(int); }
int N::foo(int a) { return a; }
int main() { return N::foo(1); }
`;
    const symbols = await analyzer.extractSymbols('a.cpp', code);
    const names = symbols.map(s => `${s.type}:${s.name}`).sort();
    expect(names).toContain('method:N::foo');
    const refs = await analyzer.extractReferences('a.cpp', code);
    expect(refs.some(r => r.symbol.name === 'N::foo')).toBe(true);
  });

  it.skipIf(!hasPkg('tree-sitter-go'))('go 接口隐式实现检测', async () => {
    const analyzer = new TreeSitterAnalyzer('go');
    const code = `
package main
type I interface { M() }
type T struct{}
func (T) M() {}
`;
    const refs = await analyzer.extractReferences('a.go', code);
    expect(refs.some(r => r.referrer.type === 'inherit' && r.symbol.name === 'I')).toBe(true);
  });

  it.skipIf(!hasPkg('tree-sitter-java'))('java extends/implements 检测', async () => {
    const analyzer = new TreeSitterAnalyzer('java');
    const code = `
interface I {}
class A {}
class B extends A implements I { void x() {} }
`;
    const refs = await analyzer.extractReferences('A.java', code);
    const inheritNames = refs.filter(r => r.referrer.type === 'inherit').map(r => r.symbol.name);
    expect(inheritNames).toContain('A');
    expect(inheritNames).toContain('I');
  });
});
