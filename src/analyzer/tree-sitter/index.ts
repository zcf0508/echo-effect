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
    const findNameNode = (root: Parser.SyntaxNode | null | undefined): Parser.SyntaxNode | null => {
      if (!root) {
        return null;
      }
      const focus = root.childForFieldName('declarator') || root;
      const s: Parser.SyntaxNode[] = [focus];
      let qualified: Parser.SyntaxNode | null = null;
      while (s.length) {
        const n = s.pop()!;
        if (n.type === 'qualified_identifier') {
          qualified = n;
          break;
        }
        for (let i = 0; i < n.namedChildCount; i++) {
          const c = n.namedChild(i);
          if (c) {
            s.push(c);
          }
        }
      }
      if (qualified) {
        return qualified;
      }
      const s2: Parser.SyntaxNode[] = [focus];
      while (s2.length) {
        const n = s2.pop()!;
        if (n.type === 'identifier' || n.type === 'type_identifier' || n.type === 'property_identifier') {
          return n;
        }
        for (let i = 0; i < n.namedChildCount; i++) {
          const c = n.namedChild(i);
          if (c) {
            s2.push(c);
          }
        }
      }
      return null;
    };
    while (stack.length) {
      const node = stack.pop()!;
      const t = node.type;
      const langKey = this.currentLang;
      const pushSymbol = (nameNode: Parser.SyntaxNode | null | undefined, kind: CodeSymbol['type']): void => {
        if (nameNode) {
          const parent = nameNode.text.includes('::')
            ? nameNode.text.slice(0, nameNode.text.lastIndexOf('::'))
            : undefined;
          res.push({
            name: nameNode.text,
            type: kind,
            filePath,
            range: toRange(nameNode),
            language: this.language,
            parent,
          });
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
          const decl = node.childForFieldName('declarator');
          const name = findNameNode(decl) || node.namedChildren.find(c => c.type === 'identifier');
          if (name) {
            const kind: CodeSymbol['type'] = name.text.includes('::')
              ? 'method'
              : 'function';
            pushSymbol(name, kind);
          }
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
    const buildContext = (n: Parser.SyntaxNode): CodeSnippet => {
      const s = n.startPosition.row + 1;
      const e = n.endPosition.row + 1;
      const code = lines.slice(s - 1, e).join('\n');
      return { filePath, type: 'statement', startLine: s, endLine: e, code, symbolsUsed: [] };
    };
    while (stack.length) {
      const node = stack.pop()!;
      const langKey = this.currentLang;
      const pushRef = (callee: Parser.SyntaxNode | null | undefined): void => {
        if (!callee) {
          return;
        }
        refs.push({
          symbol: {
            name: callee.text,
            type: 'function',
            filePath,
            range: toRange(callee),
            language: this.language,
          },
          referrer: { filePath, line: callee.startPosition.row + 1, column: callee.startPosition.column, type: 'call' },
          context: buildContext(callee),
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
        // extends / implements
        if (node.type === 'class_declaration') {
          const superclass = node.childForFieldName('superclass');
          const superId = superclass?.namedChildren.find(c => c.type === 'type_identifier' || c.type === 'identifier') || superclass || null;
          if (superId) {
            refs.push({
              symbol: { name: superId.text, type: 'class', filePath, range: toRange(superId), language: this.language },
              referrer: { filePath, line: node.startPosition.row + 1, column: node.startPosition.column, type: 'inherit' },
              context: buildContext(node),
            });
          }
          const interfaces = node.childForFieldName('interfaces');
          if (interfaces) {
            for (let i = 0; i < interfaces.namedChildCount; i++) {
              const iface = interfaces.namedChild(i);
              const ifaceId = iface?.namedChildren.find(c => c.type === 'type_identifier' || c.type === 'identifier') || iface || null;
              if (ifaceId) {
                refs.push({
                  symbol: { name: ifaceId.text, type: 'interface', filePath, range: toRange(ifaceId), language: this.language },
                  referrer: { filePath, line: node.startPosition.row + 1, column: node.startPosition.column, type: 'inherit' },
                  context: buildContext(node),
                });
              }
            }
          }
        }
      }
      else if (langKey === 'go') {
        if (node.type === 'call_expression') {
          const callee = node.childForFieldName('function') || node.namedChildren.find(c => c.type === 'identifier');
          pushRef(callee);
        }
        // implicit interface implementation detection
        if (node.type === 'source_file') {
          const interfaceMethods: Map<string, Set<string>> = new Map();
          const receiverMethods: Map<string, Set<string>> = new Map();
          const q: Parser.SyntaxNode[] = [node];
          while (q.length) {
            const n = q.pop()!;
            if (n.type === 'type_declaration') {
              for (let i = 0; i < n.namedChildCount; i++) {
                let spec = n.namedChild(i);
                if (spec && spec.type !== 'type_spec') {
                  spec = spec.namedChildren.find(c => c.type === 'type_spec') || spec;
                }
                const name = spec?.childForFieldName('name') || spec?.namedChildren.find(c => c.type === 'type_identifier' || c.type === 'identifier');
                const typeNode = spec?.childForFieldName('type') || spec?.namedChildren.find(c => c.type === 'interface_type') || null;
                if (name && typeNode?.type === 'interface_type') {
                  const iface = name.text;
                  const methods = new Set<string>();
                  for (let j = 0; j < typeNode.namedChildCount; j++) {
                    const m = typeNode.namedChild(j);
                    if (m?.type === 'method_spec') {
                      const mn = m.childForFieldName('name') || m.namedChildren.find(c => c.type === 'field_identifier' || c.type === 'identifier');
                      if (mn) {
                        methods.add(mn.text);
                      }
                    }
                  }
                  interfaceMethods.set(iface, methods);
                }
              }
            }
            if (n.type === 'interface_type') {
              let p: Parser.SyntaxNode | null = n.parent;
              while (p && p.type !== 'type_spec') {
                p = p.parent;
              }
              const name = p?.childForFieldName('name') || p?.namedChildren.find(c => c.type === 'type_identifier' || c.type === 'identifier') || null;
              if (name) {
                const iface = name.text;
                const methods = new Set<string>();
                for (let j = 0; j < n.namedChildCount; j++) {
                  const m = n.namedChild(j);
                  if (m?.type === 'method_spec') {
                    const mn = m.childForFieldName('name') || m.namedChildren.find(c => c.type === 'field_identifier' || c.type === 'identifier');
                    if (mn) {
                      methods.add(mn.text);
                    }
                  }
                }
                interfaceMethods.set(iface, methods);
              }
            }
            if (n.type === 'method_declaration') {
              const recv = n.childForFieldName('receiver');
              const findType = (root: Parser.SyntaxNode | null | undefined): Parser.SyntaxNode | null => {
                if (!root) {
                  return null;
                }
                const qq: Parser.SyntaxNode[] = [root];
                while (qq.length) {
                  const x = qq.pop()!;
                  if (x.type === 'type_identifier' || x.type === 'identifier') {
                    return x;
                  }
                  if (x.type === 'pointer_type') {
                    const id = x.namedChildren.find(c => c.type === 'type_identifier' || c.type === 'identifier');
                    if (id) {
                      return id;
                    }
                  }
                  for (let i = 0; i < x.namedChildCount; i++) {
                    const c = x.namedChild(i);
                    if (c) {
                      qq.push(c);
                    }
                  }
                }
                return null;
              };
              const recvTypeNode = findType(recv);
              const methodName = n.childForFieldName('name') || n.namedChildren.find(c => c.type === 'field_identifier' || c.type === 'identifier');
              if (recvTypeNode && methodName) {
                const t = recvTypeNode.text.replace(/^\*+/, '');
                const set = receiverMethods.get(t) || new Set<string>();
                set.add(methodName.text);
                receiverMethods.set(t, set);
              }
            }
            for (let i = 0; i < n.namedChildCount; i++) {
              const c = n.namedChild(i);
              if (c) {
                q.push(c);
              }
            }
          }
          receiverMethods.forEach((methods, typeName) => {
            interfaceMethods.forEach((ifaceMethods, ifaceName) => {
              const implementsAll = Array.from(ifaceMethods).every(m => methods.has(m));
              if (implementsAll && ifaceMethods.size > 0) {
                refs.push({
                  symbol: { name: ifaceName, type: 'interface', filePath, range: toRange(node), language: this.language },
                  referrer: { filePath, line: node.startPosition.row + 1, column: node.startPosition.column, type: 'inherit' },
                  context: buildContext(node),
                });
              }
            });
          });
          if (refs.every(r => r.referrer.type !== 'inherit')) {
            const text = lines.join('\n');
            const ifaceRegex = /type\s+([A-Za-z_]\w*)\s+interface\s*\{([\s\S]*?)\}/g;
            const recvRegex = /func\s*\(\s*\*?([A-Za-z_]\w*)\s*\)\s*([A-Za-z_]\w*)\s*\(/g;
            const ifaceMap: Map<string, Set<string>> = new Map();
            let m: RegExpExecArray | null;
            // eslint-disable-next-line no-cond-assign
            while ((m = ifaceRegex.exec(text)) !== null) {
              const ifaceName = m[1];
              const body = m[2];
              const methodNames = new Set<string>();
              const methodRegex = /^\s*(?<name>[A-Z_]\w*)\s*\(/gim;
              let mm: RegExpExecArray | null;
              // eslint-disable-next-line no-cond-assign
              while ((mm = methodRegex.exec(body)) !== null) {
                methodNames.add(mm.groups?.name || '');
              }
              if (methodNames.size > 0) {
                ifaceMap.set(ifaceName, methodNames);
              }
            }
            const recvMap: Map<string, Set<string>> = new Map();
            let r: RegExpExecArray | null;
            // eslint-disable-next-line no-cond-assign
            while ((r = recvRegex.exec(text)) !== null) {
              const typeName = r[1];
              const methodName = r[2];
              const set = recvMap.get(typeName) || new Set<string>();
              set.add(methodName);
              recvMap.set(typeName, set);
            }
            recvMap.forEach((methods, _) => {
              ifaceMap.forEach((ifaceMethods, ifaceName) => {
                const ok = Array.from(ifaceMethods).every(x => methods.has(x));
                if (ok && ifaceMethods.size > 0) {
                  refs.push({
                    symbol: { name: ifaceName, type: 'interface', filePath, range: toRange(node), language: this.language },
                    referrer: { filePath, line: node.startPosition.row + 1, column: node.startPosition.column, type: 'inherit' },
                    context: buildContext(node),
                  });
                }
              });
            });
          }
        }
      }
      else if (langKey === 'cpp') {
        if (node.type === 'call_expression') {
          const callee = node.childForFieldName('function') || node.namedChildren.find(c => c.type === 'qualified_identifier' || c.type === 'identifier');
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
