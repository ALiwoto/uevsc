import * as vscode from "vscode";

import { SymbolIndex } from "./index/symbolIndex.js";
import { WorkspaceIndexer } from "./index/workspaceIndexer.js";
import { CppParser } from "./parser/cppParser.js";
import { CppDefinitionProvider, CppHoverProvider } from "./vscode/providers.js";

let parser: CppParser | undefined;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const output = vscode.window.createOutputChannel("uevsc");
  context.subscriptions.push(output);

  try {
    parser = await CppParser.create(
      context.asAbsolutePath("dist/web-tree-sitter.wasm"),
      context.asAbsolutePath("dist/tree-sitter-cpp.wasm"),
    );
  } catch (error) {
    const message = `uevsc could not initialize its C++ parser: ${errorMessage(error)}`;
    output.appendLine(message);
    void vscode.window.showErrorMessage(message);
    return;
  }

  const index = new SymbolIndex();
  const indexer = new WorkspaceIndexer(parser, index, output);
  const selector: vscode.DocumentSelector = [
    { language: "cpp", scheme: "file" },
    { language: "c", scheme: "file" },
  ];

  context.subscriptions.push(
    indexer,
    vscode.languages.registerDefinitionProvider(selector, new CppDefinitionProvider(index)),
    vscode.languages.registerHoverProvider(selector, new CppHoverProvider(index)),
    vscode.commands.registerCommand("uevsc.rebuildIndex", async () => {
      await indexer.rebuild();
      const stats = index.getStats();
      void vscode.window.showInformationMessage(`uevsc indexed ${stats.symbols} symbols from ${stats.files} files.`);
    }),
    vscode.commands.registerCommand("uevsc.showIndexStats", () => {
      const stats = index.getStats();
      const sizeMiB = stats.bytes / (1024 * 1024);
      void vscode.window.showInformationMessage(
        `uevsc: ${stats.symbols} symbols, ${stats.files} files, ${sizeMiB.toFixed(2)} MiB, ${stats.parseErrors} recovered syntax errors.`,
      );
    }),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration("uevsc")) void indexer.rebuild();
    }),
  );

  await indexer.rebuild();
}

export function deactivate(): void {
  parser?.dispose();
  parser = undefined;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
