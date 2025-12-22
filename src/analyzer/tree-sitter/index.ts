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
    if ((this.language === 'typescript' || this.language === 'tsx') && this.currentLang !== 'typescript') {
      const mod = await import('tree-sitter-typescript') as any;
      const lang = (mod.typescript || mod.default?.typescript) as Parser.Language;
      if (lang) {
        this.parser.setLanguage(lang);
        this.currentLang = 'typescript';
      }
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
      if (t === 'function_declaration') {
        const name = node.childForFieldName('name') || node.namedChildren.find(c => c.type === 'identifier');
        if (name) {
          res.push({ name: name.text, type: 'function', filePath, range: toRange(name), language: this.language });
        }
      }
      else if (t === 'class_declaration') {
        const name = node.childForFieldName('name') || node.namedChildren.find(c => c.type === 'identifier' || c.type === 'type_identifier');
        if (name) {
          res.push({ name: name.text, type: 'class', filePath, range: toRange(name), language: this.language });
        }
      }
      else if (t === 'method_definition') {
        const name = node.childForFieldName('name') || node.namedChildren.find(c => c.type === 'property_identifier');
        if (name) {
          res.push({
            name: name.text,
            type: 'method',
            filePath,
            range: toRange(name),
            language: this.language,
          });
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
      if (node.type === 'call_expression') {
        const callee = node.childForFieldName('function') || node.namedChildren.find(c => c.type === 'identifier' || c.type === 'property_identifier');
        if (callee) {
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
