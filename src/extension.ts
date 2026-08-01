import "source-map-support/register";

import { stat } from "node:fs/promises";
import * as vscode from "vscode";

import { SymbolIndex } from "./index/symbolIndex.js";
import { WorkspaceIndexer } from "./index/workspaceIndexer.js";
import { CppParser } from "./parser/cppParser.js";
import { CppDefinitionProvider, CppHoverProvider } from "./vscode/providers.js";

let parser: CppParser | undefined;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
    const output = vscode.window.createOutputChannel("uevsc");
    context.subscriptions.push(output);

    const log = (level: "info" | "error", message: string): void => {
        output.appendLine(`${new Date().toISOString()} [${level}] ${message}`);
    };

    log("info", `Activating uevsc ${context.extension.packageJSON.version ?? "unknown"}.`);
    log("info", `VS Code ${vscode.version}; Node ${process.version}; ${process.platform} ${process.arch}.`);
    log("info", `Extension path: ${context.extensionPath}`);

    try {
        const runtimeWasmPath = context.asAbsolutePath("dist/web-tree-sitter.wasm");
        const cppWasmPath = context.asAbsolutePath("dist/tree-sitter-cpp.wasm");
        await logFileDetails("Tree-sitter runtime WASM", runtimeWasmPath, log);
        await logFileDetails("C++ grammar WASM", cppWasmPath, log);

        parser = await CppParser.create(runtimeWasmPath, cppWasmPath, (message) => log("info", message));
        log("info", "C++ parser initialized successfully.");
    } catch (error) {
        const message = `uevsc could not initialize its C++ parser: ${errorMessage(error)}`;
        log("error", message);
        for (const line of formatError(error).split("\n")) {
            log("error", line);
        }
        void vscode.window.showErrorMessage(`${message} See Output > uevsc for details.`);
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
            void vscode.window.showInformationMessage(
                `uevsc indexed ${stats.symbols} symbols from ${stats.files} files.`,
            );
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

function formatError(error: unknown): string {
    if (!(error instanceof Error)) {
        return String(error);
    }

    const sections = [error.stack ?? `${error.name}: ${error.message}`];
    let cause: unknown = error.cause;
    while (cause) {
        if (cause instanceof Error) {
            sections.push(`Caused by: ${cause.stack ?? `${cause.name}: ${cause.message}`}`);
            cause = cause.cause;
        } else {
            sections.push(`Caused by: ${String(cause)}`);
            break;
        }
    }
    return sections.join("\n");
}

async function logFileDetails(
    label: string,
    filePath: string,
    log: (level: "info" | "error", message: string) => void,
): Promise<void> {
    try {
        const details = await stat(filePath);
        log("info", `${label}: ${filePath} (${details.size} bytes).`);
    } catch (error) {
        throw new Error(`${label} is not readable at '${filePath}'.`, { cause: error });
    }
}
