import * as vscode from "vscode";

import type { CppSymbol, SourcePosition, SourceRange } from "../core/model.js";

export function toPosition(position: SourcePosition): vscode.Position {
  return new vscode.Position(position.line, position.character);
}

export function toRange(range: SourceRange): vscode.Range {
  return new vscode.Range(toPosition(range.start), toPosition(range.end));
}

export function toLocation(symbol: CppSymbol): vscode.Location {
  return new vscode.Location(vscode.Uri.parse(symbol.uri), toRange(symbol.selectionRange));
}
