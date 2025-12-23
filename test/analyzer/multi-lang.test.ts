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

describe('treeSitterAnalyzer 多语言', () => {
  it('解析 JSX 函数与类', async () => {
    const analyzer = new TreeSitterAnalyzer('jsx');
    const code = `
      function Comp() { return <div/> }
      class C { render() { return <Comp/> } }
      Comp();
    `;
    const symbols = await analyzer.extractSymbols('a.jsx', code);
    const names = symbols.map(s => `${s.type}:${s.name}`).sort();
    expect(names).toContain('function:Comp');
    expect(names).toContain('class:C');
    const refs = await analyzer.extractReferences('a.jsx', code);
    expect(refs.some(r => r.symbol.name === 'Comp')).toBe(true);
  });

  it('解析 TSX 函数与类', async () => {
    const analyzer = new TreeSitterAnalyzer('tsx');
    const code = `
      function Comp(): JSX.Element { return <div/> }
      class C { render(): JSX.Element { return <Comp/> } }
      Comp();
    `;
    const symbols = await analyzer.extractSymbols('a.tsx', code);
    const names = symbols.map(s => `${s.type}:${s.name}`).sort();
    expect(names).toContain('function:Comp');
    expect(names).toContain('class:C');
    const refs = await analyzer.extractReferences('a.tsx', code);
    expect(refs.some(r => r.symbol.name === 'Comp')).toBe(true);
  });

  it('识别 JSX 箭头函数组件与使用', async () => {
    const analyzer = new TreeSitterAnalyzer('jsx');
    const code = `
      const Comp = () => <div/>;
      const App = () => <Comp/>;
    `;
    const symbols = await analyzer.extractSymbols('b.jsx', code);
    const names = symbols.map(s => `${s.type}:${s.name}`).sort();
    expect(names).toContain('function:Comp');
    const refs = await analyzer.extractReferences('b.jsx', code);
    expect(refs.some(r => r.symbol.name === 'Comp')).toBe(true);
  });

  it('识别 TSX 箭头函数组件与使用', async () => {
    const analyzer = new TreeSitterAnalyzer('tsx');
    const code = `
      const Comp: React.FC = () => <div/>;
      const App: React.FC = () => <Comp/>;
    `;
    const symbols = await analyzer.extractSymbols('b.tsx', code);
    const names = symbols.map(s => `${s.type}:${s.name}`).sort();
    expect(names).toContain('function:Comp');
    const refs = await analyzer.extractReferences('b.tsx', code);
    expect(refs.some(r => r.symbol.name === 'Comp')).toBe(true);
  });

  it.skipIf(!hasPkg('tree-sitter-python'))('解析 Python 函数与类', async () => {
    const analyzer = new TreeSitterAnalyzer('python');
    const code = `
def foo(a):
    return a

class Bar:
    def m(self):
        return foo(1)
`;
    const symbols = await analyzer.extractSymbols('a.py', code);
    const names = symbols.map(s => `${s.type}:${s.name}`).sort();
    expect(names).toContain('function:foo');
    expect(names).toContain('class:Bar');
    const refs = await analyzer.extractReferences('a.py', code);
    expect(refs.some(r => r.symbol.name === 'foo')).toBe(true);
  });

  it.skipIf(!hasPkg('tree-sitter-java'))('解析 Java 方法与类', async () => {
    const analyzer = new TreeSitterAnalyzer('java');
    const code = `
class A {
  int m() { return 1; }
}
class B {
  void x() { new A().m(); }
}
`;
    const symbols = await analyzer.extractSymbols('A.java', code);
    const names = symbols.map(s => `${s.type}:${s.name}`).sort();
    expect(names).toContain('method:m');
    expect(names).toContain('class:A');
    expect(names).toContain('class:B');
    const refs = await analyzer.extractReferences('A.java', code);
    expect(refs.some(r => r.symbol.name === 'm')).toBe(true);
  });

  it.skipIf(!hasPkg('tree-sitter-go'))('解析 Go 函数与调用', async () => {
    const analyzer = new TreeSitterAnalyzer('go');
    const code = `
package main
func Foo(a int) int { return a }
func main() { Foo(1) }
`;
    const symbols = await analyzer.extractSymbols('a.go', code);
    const names = symbols.map(s => `${s.type}:${s.name}`).sort();
    expect(names).toContain('function:Foo');
    const refs = await analyzer.extractReferences('a.go', code);
    expect(refs.some(r => r.symbol.name === 'Foo')).toBe(true);
  });

  it.skipIf(!hasPkg('tree-sitter-cpp'))('解析 C++ 函数与调用', async () => {
    const analyzer = new TreeSitterAnalyzer('cpp');
    const code = `
int foo(int a) { return a; }
int main() { return foo(1); }
`;
    const symbols = await analyzer.extractSymbols('a.cpp', code);
    const names = symbols.map(s => `${s.type}:${s.name}`).sort();
    expect(names).toContain('function:foo');
    const refs = await analyzer.extractReferences('a.cpp', code);
    expect(refs.some(r => r.symbol.name === 'foo')).toBe(true);
  });
});
