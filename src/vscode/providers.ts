import * as vscode from "vscode";

import type { CppSymbol } from "../core/model.js";
import type { SymbolIndex } from "../index/symbolIndex.js";
import { toLocation } from "./conversions.js";

export class CppDefinitionProvider implements vscode.DefinitionProvider {
  constructor(private readonly index: SymbolIndex) {}

  provideDefinition(document: vscode.TextDocument, position: vscode.Position): vscode.ProviderResult<vscode.Definition | vscode.LocationLink[]> {
    const lookup = lookupAt(document, position, this.index);
    if (!lookup) return undefined;
    if (lookup.symbols.length === 0) {
      const configuration = vscode.workspace.getConfiguration("uevsc", document.uri);
      if (configuration.get("showMissingDefinitionMessage", true)) {
        vscode.window.setStatusBarMessage(`uevsc: can't find a definition for '${lookup.word}'.`, 4000);
      }
      return undefined;
    }

    return uniqueLocations(preferDefinitions(lookup.symbols)).map(toLocation);
  }
}

export class CppHoverProvider implements vscode.HoverProvider {
  constructor(private readonly index: SymbolIndex) {}

  provideHover(document: vscode.TextDocument, position: vscode.Position): vscode.ProviderResult<vscode.Hover> {
    const lookup = lookupAt(document, position, this.index);
    if (!lookup || lookup.symbols.length === 0) return undefined;

    const symbols = uniqueSignatures(lookup.symbols).slice(0, 6);
    const markdown = new vscode.MarkdownString(undefined, true);
    markdown.isTrusted = false;
    for (const [index, symbol] of symbols.entries()) {
      if (index > 0) markdown.appendMarkdown("\n\n---\n\n");
      markdown.appendCodeblock(symbol.signature || symbol.qualifiedName, "cpp");
      const relative = vscode.workspace.asRelativePath(vscode.Uri.parse(symbol.uri), false);
      const location = `${relative}:${symbol.selectionRange.start.line + 1}`;
      const classification = [symbol.kind, symbol.isDefinition ? "definition" : "declaration"].join(" · ");
      markdown.appendMarkdown(`\n${escapeMarkdown(classification)} — ${escapeMarkdown(location)}`);
      if (symbol.documentation) markdown.appendMarkdown(`\n\n${escapeMarkdown(symbol.documentation)}`);
    }
    if (lookup.symbols.length > symbols.length) {
      markdown.appendMarkdown(`\n\n_+${lookup.symbols.length - symbols.length} more matching symbols_`);
    }
    return new vscode.Hover(markdown, document.getWordRangeAtPosition(position, /[A-Za-z_]\w*/));
  }
}

function lookupAt(document: vscode.TextDocument, position: vscode.Position, index: SymbolIndex) {
  const wordRange = document.getWordRangeAtPosition(position, /[A-Za-z_]\w*/);
  if (!wordRange) return undefined;
  const word = document.getText(wordRange);
  const linePrefix = document.lineAt(position.line).text.slice(0, wordRange.start.character);
  const result = index.resolve({
    uri: document.uri.toString(),
    position: { line: position.line, character: position.character },
    word,
    linePrefix,
  });
  return { ...result, word };
}

function uniqueLocations(symbols: readonly CppSymbol[]): CppSymbol[] {
  const seen = new Set<string>();
  return symbols.filter((symbol) => {
    const key = `${symbol.uri}:${symbol.selectionRange.start.line}:${symbol.selectionRange.start.character}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function preferDefinitions(symbols: readonly CppSymbol[]): readonly CppSymbol[] {
  const definitions = symbols.filter((symbol) => symbol.isDefinition);
  return definitions.length > 0 ? definitions : symbols;
}

function uniqueSignatures(symbols: readonly CppSymbol[]): CppSymbol[] {
  const seen = new Set<string>();
  return symbols.filter((symbol) => {
    const key = `${symbol.qualifiedName}:${symbol.signature}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function escapeMarkdown(value: string): string {
  return value.replace(/[\\`*_{}\[\]()<>#+\-.!|]/g, "\\$&");
}
