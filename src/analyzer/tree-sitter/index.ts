import type { CodeAnalyzer } from '../../types/analyzer';
import type { AffectedSymbol, CodeSnippet, CodeSymbol, SymbolReference } from '../../types/symbols';
import Parser from 'tree-sitter';
import JavaScript from 'tree-sitter-javascript';

function toRange(node: Parser.SyntaxNode): {
  startLine: number
  endLine: number
  startColumn: number
  endColumn: number
} {
  return {
    startLine: node.startPosition.row + 1,
    endLine: node.endPosition.row + 1,
    startColumn: node.startPosition.column,
    endColumn: node.endPosition.column,
  };
}

export class TreeSitterAnalyzer implements CodeAnalyzer {
  language: string;
  priority: number;
  private parser: Parser;
  private currentLang: string;
  constructor(language: string, priority = 100) {
    this.language = language;
    this.priority = priority;
    this.parser = new Parser();
    this.parser.setLanguage(JavaScript as unknown as Parser.Language);
    this.currentLang = 'javascript';
  }

  private async ensureLanguage(): Promise<void> {
    const langKey = this.language.toLowerCase();
    if ((langKey === 'javascript' || langKey === 'jsx') && this.currentLang !== 'javascript') {
      this.parser.setLanguage(JavaScript as unknown as Parser.Language);
      this.currentLang = 'javascript';
      return;
    }
    if ((langKey === 'typescript' || langKey === 'tsx') && this.currentLang !== langKey) {
      const mod = await import('tree-sitter-typescript') as any;
      const ts = (mod.typescript || mod.default?.typescript) as Parser.Language | undefined;
      const tsx = (mod.tsx || mod.default?.tsx) as Parser.Language | undefined;
      const selected = langKey === 'tsx'
        ? tsx
        : ts;
      if (selected) {
        this.parser.setLanguage(selected);
        this.currentLang = langKey;
      }
      return;
    }
    if (langKey === 'python' && this.currentLang !== 'python') {
      try {
        const mod = await import('tree-sitter-python') as any;
        const lang = (mod.default || mod.python || mod.Python) as Parser.Language | undefined;
        if (lang) {
          this.parser.setLanguage(lang);
          this.currentLang = 'python';
        }
      }
      catch {}
      return;
    }
    if (langKey === 'java' && this.currentLang !== 'java') {
      try {
        const mod = await import('tree-sitter-java') as any;
        const lang = (mod.default || mod.java || mod.Java) as Parser.Language | undefined;
        if (lang) {
          this.parser.setLanguage(lang);
          this.currentLang = 'java';
        }
      }
      catch {}
      return;
    }
    if (langKey === 'go' && this.currentLang !== 'go') {
      try {
        const mod = await import('tree-sitter-go') as any;
        const lang = (mod.default || mod.go || mod.Go) as Parser.Language | undefined;
        if (lang) {
          this.parser.setLanguage(lang);
          this.currentLang = 'go';
        }
      }
      catch {}
      return;
    }
    if ((langKey === 'cpp' || langKey === 'c++') && this.currentLang !== 'cpp') {
      try {
        const mod = await import('tree-sitter-cpp') as any;
        const lang = (mod.default || mod.cpp || mod.CPP) as Parser.Language | undefined;
        if (lang) {
          this.parser.setLanguage(lang);
          this.currentLang = 'cpp';
        }
      }
      catch {}
    }
  }

  async extractSymbols(filePath: string, content: string): Promise<CodeSymbol[]> {
    await this.ensureLanguage();
    const tree = this.parser.parse(content);
    const res: CodeSymbol[] = [];
    const stack: Parser.SyntaxNode[] = [tree.rootNode];
    while (stack.length) {
      const node = stack.pop()!;
      const t = node.type;
      const langKey = this.currentLang;
      const pushSymbol = (nameNode: Parser.SyntaxNode | null | undefined, kind: CodeSymbol['type']): void => {
        if (nameNode) {
          res.push({ name: nameNode.text, type: kind, filePath, range: toRange(nameNode), language: this.language });
        }
      };
      if (langKey === 'javascript' || langKey === 'typescript' || langKey === 'tsx') {
        if (t === 'function_declaration') {
          const name = node.childForFieldName('name') || node.namedChildren.find(c => c.type === 'identifier');
          pushSymbol(name, 'function');
        }
        else if (t === 'variable_declarator') {
          const id = node.childForFieldName('name') || node.namedChildren.find(c => c.type === 'identifier');
          const init = node.childForFieldName('value') || node.namedChildren.find(c => c.type === 'function' || c.type === 'arrow_function');
          if (id && init && (init.type === 'function' || init.type === 'arrow_function')) {
            pushSymbol(id, 'function');
          }
        }
        else if (t === 'class_declaration') {
          const name = node.childForFieldName('name') || node.namedChildren.find(c => c.type === 'identifier' || c.type === 'type_identifier');
          pushSymbol(name, 'class');
        }
        else if (t === 'method_definition') {
          const name = node.childForFieldName('name') || node.namedChildren.find(c => c.type === 'property_identifier');
          pushSymbol(name, 'method');
        }
      }
      else if (langKey === 'python') {
        if (t === 'function_definition') {
          const name = node.childForFieldName('name') || node.namedChildren.find(c => c.type === 'identifier');
          pushSymbol(name, 'function');
        }
        else if (t === 'class_definition') {
          const name = node.childForFieldName('name') || node.namedChildren.find(c => c.type === 'identifier');
          pushSymbol(name, 'class');
        }
      }
      else if (langKey === 'java') {
        if (t === 'method_declaration') {
          const name = node.childForFieldName('name') || node.namedChildren.find(c => c.type === 'identifier');
          pushSymbol(name, 'method');
        }
        else if (t === 'class_declaration' || t === 'interface_declaration') {
          const name = node.childForFieldName('name') || node.namedChildren.find(c => c.type === 'identifier');
          pushSymbol(name, 'class');
        }
      }
      else if (langKey === 'go') {
        if (t === 'function_declaration' || t === 'method_declaration') {
          const name = node.childForFieldName('name') || node.namedChildren.find(c => c.type === 'identifier');
          pushSymbol(name, t === 'method_declaration'
            ? 'method'
            : 'function');
        }
      }
      else if (langKey === 'cpp') {
        if (t === 'function_definition' || t === 'function_declaration') {
          const name = node.childForFieldName('declarator')?.childForFieldName('declarator') || node.namedChildren.find(c => c.type === 'identifier');
          pushSymbol(name, 'function');
        }
        else if (t === 'class_specifier' || t === 'class_declaration' || t === 'struct_specifier') {
          const name = node.namedChildren.find(c => c.type === 'type_identifier' || c.type === 'identifier');
          pushSymbol(name, 'class');
        }
      }
      for (let i = 0; i < node.namedChildCount; i++) {
        const child = node.namedChild(i);
        if (child) {
          stack.push(child);
        }
      }
    }
    return res;
  }

  async extractReferences(filePath: string, content: string): Promise<SymbolReference[]> {
    await this.ensureLanguage();
    const tree = this.parser.parse(content);
    const refs: SymbolReference[] = [];
    const stack: Parser.SyntaxNode[] = [tree.rootNode];
    const lines = content.split('\n');
    while (stack.length) {
      const node = stack.pop()!;
      const langKey = this.currentLang;
      const pushRef = (callee: Parser.SyntaxNode | null | undefined): void => {
        if (!callee) {
          return;
        }
        const s = callee.startPosition.row + 1;
        const e = callee.endPosition.row + 1;
        const code = lines.slice(s - 1, e).join('\n');
        refs.push({
          symbol: {
            name: callee.text,
            type: 'function',
            filePath,
            range: toRange(callee),
            language: this.language,
          },
          referrer: { filePath, line: s, column: callee.startPosition.column, type: 'call' },
          context: { filePath, type: 'statement', startLine: s, endLine: e, code, symbolsUsed: [] },
        });
      };
      if (langKey === 'javascript' || langKey === 'typescript' || langKey === 'tsx') {
        if (node.type === 'call_expression') {
          const callee = node.childForFieldName('function') || node.namedChildren.find(c => c.type === 'identifier' || c.type === 'property_identifier');
          pushRef(callee);
        }
        else if (node.type === 'jsx_opening_element' || node.type === 'jsx_self_closing_element') {
          const name = node.childForFieldName('name') || node.namedChildren.find(c => c.type === 'identifier' || c.type === 'jsx_identifier');
          pushRef(name);
        }
      }
      else if (langKey === 'python') {
        if (node.type === 'call') {
          const callee = node.childForFieldName('function') || node.namedChildren.find(c => c.type === 'identifier');
          pushRef(callee);
        }
      }
      else if (langKey === 'java') {
        if (node.type === 'method_invocation') {
          const callee = node.childForFieldName('name') || node.namedChildren.find(c => c.type === 'identifier');
          pushRef(callee);
        }
      }
      else if (langKey === 'go') {
        if (node.type === 'call_expression') {
          const callee = node.childForFieldName('function') || node.namedChildren.find(c => c.type === 'identifier');
          pushRef(callee);
        }
      }
      else if (langKey === 'cpp') {
        if (node.type === 'call_expression') {
          const callee = node.childForFieldName('function') || node.namedChildren.find(c => c.type === 'identifier');
          pushRef(callee);
        }
      }
      for (let i = 0; i < node.namedChildCount; i++) {
        const child = node.namedChild(i);
        if (child) {
          stack.push(child);
        }
      }
    }
    return refs;
  }

  async findAffectedSymbols(
    filePath: string,
    content: string,
    changedLines: { startLine: number, endLine: number },
  ): Promise<AffectedSymbol[]> {
    const symbols = await this.extractSymbols(filePath, content);
    const affected: AffectedSymbol[] = [];
    for (const s of symbols) {
      if (!(s.range.endLine < changedLines.startLine || s.range.startLine > changedLines.endLine)) {
        affected.push({
          symbol: s,
          changeType: 'modified',
          changeLines: { startLine: changedLines.startLine, endLine: changedLines.endLine },
          referencedBy: [],
        });
      }
    }
    return affected;
  }

  async extractCodeSnippet(
    filePath: string,
    content: string,
    startLine: number,
    endLine: number,
    contextLines: number = 0,
  ): Promise<CodeSnippet> {
    const lines = content.split('\n');
    const s = Math.max(1, startLine - contextLines);
    const e = Math.min(lines.length, endLine + contextLines);
    const snippet = lines.slice(s - 1, e).join('\n');
    return {
      filePath,
      type: 'block',
      startLine: s,
      endLine: e,
      code: snippet,
      symbolsUsed: [],
    };
  }
}
