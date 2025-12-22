import type { AffectedSymbol, CodeSnippet, CodeSymbol, SymbolReference } from './symbols';

export interface CodeAnalyzer {
  language: string
  priority: number
  extractSymbols: (filePath: string, content: string) => Promise<CodeSymbol[]>
  extractReferences: (filePath: string, content: string) => Promise<SymbolReference[]>
  findAffectedSymbols: (
    filePath: string,
    content: string,
    changedLines: { startLine: number, endLine: number }
  ) => Promise<AffectedSymbol[]>
  extractCodeSnippet: (
    filePath: string,
    content: string,
    startLine: number,
    endLine: number,
    contextLines?: number
  ) => Promise<CodeSnippet>
}

export interface AnalyzerRegistry {
  register: (analyzer: CodeAnalyzer) => void
  getAnalyzer: (language: string) => CodeAnalyzer | null
  getAnalyzers: () => CodeAnalyzer[]
}
