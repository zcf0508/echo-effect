export interface CodeSymbol {
  name: string
  type: 'function' | 'class' | 'method' | 'variable' | 'import' | 'export' | 'interface' | 'type'
  filePath: string
  range: {
    startLine: number
    endLine: number
    startColumn: number
    endColumn: number
  }
  parent?: string
  language: string
}

export interface SymbolReference {
  symbol: CodeSymbol
  referrer: {
    filePath: string
    line: number
    column: number
    type: 'call' | 'reference' | 'import' | 'inherit'
  }
  context: CodeSnippet
}

export interface CodeSnippet {
  filePath: string
  type: 'function' | 'class' | 'method' | 'block' | 'statement'
  name?: string
  startLine: number
  endLine: number
  code: string
  symbolsUsed: CodeSymbol[]
  reason?: string
}

export interface AffectedSymbol {
  symbol: CodeSymbol
  changeType: 'added' | 'modified' | 'deleted'
  changeLines: {
    startLine: number
    endLine: number
  }
  referencedBy: SymbolReference[]
}

export interface EnhancedEffectInfo {
  level: number
  isModified: boolean
  dependencies: string[]
  symbols?: CodeSymbol[]
  affectedSymbols?: AffectedSymbol[]
  codeSnippets?: CodeSnippet[]
}
