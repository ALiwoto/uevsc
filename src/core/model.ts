export type SymbolKind =
  | "class"
  | "struct"
  | "union"
  | "enum"
  | "namespace"
  | "function"
  | "method"
  | "constructor"
  | "destructor"
  | "variable"
  | "field"
  | "parameter"
  | "enumMember"
  | "typeAlias"
  | "macro";

export interface SourcePosition {
  readonly line: number;
  readonly character: number;
}

export interface SourceRange {
  readonly start: SourcePosition;
  readonly end: SourcePosition;
}

export interface CppSymbol {
  readonly name: string;
  readonly qualifiedName: string;
  readonly kind: SymbolKind;
  readonly uri: string;
  readonly range: SourceRange;
  readonly selectionRange: SourceRange;
  readonly scope: readonly string[];
  readonly container?: string;
  readonly type?: string;
  readonly signature: string;
  readonly documentation?: string;
  readonly isDefinition: boolean;
  readonly isLocal: boolean;
  readonly visibilityRange?: SourceRange;
}

export interface ParsedFile {
  readonly uri: string;
  readonly symbols: readonly CppSymbol[];
  readonly parseErrors: number;
  readonly bytes: number;
  readonly elapsedMs: number;
}

export function shortTypeName(type: string | undefined): string | undefined {
  if (!type) {
    return undefined;
  }

  const withoutQualifiers = type
    .replace(/\b(?:const|volatile|mutable|static|extern|register|typename|class|struct)\b/g, " ")
    .replace(/[&*]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const templateBase = withoutQualifiers.replace(/<.*>/s, "").trim();
  const parts = templateBase.split("::");
  return parts.at(-1)?.trim() || undefined;
}
