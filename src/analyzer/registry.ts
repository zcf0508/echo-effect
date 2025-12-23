import type { AnalyzerRegistry, CodeAnalyzer } from '../types/analyzer';

class InMemoryAnalyzerRegistry implements AnalyzerRegistry {
  private analyzers: Map<string, CodeAnalyzer> = new Map();
  register(analyzer: CodeAnalyzer): void {
    this.analyzers.set(analyzer.language.toLowerCase(), analyzer);
  }

  getAnalyzer(language: string): CodeAnalyzer | null {
    return this.analyzers.get(language.toLowerCase()) ?? null;
  }

  getAnalyzers(): CodeAnalyzer[] {
    return Array.from(this.analyzers.values()).sort((a, b) => b.priority - a.priority);
  }
}

export const analyzerRegistry: AnalyzerRegistry = new InMemoryAnalyzerRegistry();
