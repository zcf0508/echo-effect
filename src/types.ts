export type Awaitable<T> = T | Promise<T>;

export interface EffectInfo {
  level: number
  isModified: boolean
  dependencies: string[]
}

export type EffectReport = Map<string, EffectInfo>;
export type DependencyGraph = Map<string, Set<string>>;
export type ReverseDependencyGraph = Map<string, Set<string>>;
export type ComponentResolver = (name: string) => string | null;
