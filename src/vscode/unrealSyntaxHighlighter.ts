import * as vscode from "vscode";

import { findUnrealConstantOccurrences } from "../language/unrealConstants.js";
import { findCppVariableDeclarations, type TextOffsetRange } from "../language/unrealPropertyDeclarations.js";

export class UnrealSyntaxHighlighter implements vscode.Disposable {
    private readonly typeDecoration = vscode.window.createTextEditorDecorationType({
        color: new vscode.ThemeColor("uevsc.unrealTypeForeground"),
    });
    private readonly propertyDecoration = vscode.window.createTextEditorDecorationType({
        color: new vscode.ThemeColor("uevsc.unrealPropertyForeground"),
    });
    private readonly constantDecoration = vscode.window.createTextEditorDecorationType({
        color: new vscode.ThemeColor("uevsc.unrealConstantForeground"),
    });
    private readonly disposables: vscode.Disposable[];
    private readonly timers = new Map<string, NodeJS.Timeout>();

    constructor() {
        this.disposables = [
            this.typeDecoration,
            this.propertyDecoration,
            this.constantDecoration,
            vscode.window.onDidChangeVisibleTextEditors((editors) => {
                for (const editor of editors) this.update(editor);
            }),
            vscode.window.onDidChangeActiveTextEditor((editor) => {
                if (editor) this.update(editor);
            }),
            vscode.workspace.onDidChangeTextDocument((event) => this.schedule(event.document)),
            vscode.workspace.onDidChangeConfiguration((event) => {
                if (event.affectsConfiguration("uevsc.syntaxHighlighting.enabled")) this.updateVisibleEditors();
            }),
        ];

        this.updateVisibleEditors();
    }

    dispose(): void {
        for (const timer of this.timers.values()) clearTimeout(timer);
        this.timers.clear();
        for (const disposable of this.disposables) disposable.dispose();
    }

    private updateVisibleEditors(): void {
        for (const editor of vscode.window.visibleTextEditors) this.update(editor);
    }

    private schedule(document: vscode.TextDocument): void {
        if (!isCppDocument(document)) return;
        const key = document.uri.toString();
        const previous = this.timers.get(key);
        if (previous) clearTimeout(previous);
        this.timers.set(
            key,
            setTimeout(() => {
                this.timers.delete(key);
                for (const editor of vscode.window.visibleTextEditors) {
                    if (editor.document.uri.toString() === key) this.update(editor);
                }
            }, 75),
        );
    }

    private update(editor: vscode.TextEditor): void {
        if (!isCppDocument(editor.document) || !isEnabled(editor.document.uri)) {
            editor.setDecorations(this.typeDecoration, []);
            editor.setDecorations(this.propertyDecoration, []);
            editor.setDecorations(this.constantDecoration, []);
            return;
        }

        const declarations = findCppVariableDeclarations(editor.document.getText());
        const typeRanges = declarations
            .flatMap((declaration) => declaration.typeNames)
            .map((range) => toRange(editor.document, range));
        const propertyRanges = declarations.map((declaration) => toRange(editor.document, declaration.propertyName));
        const constantRanges = findUnrealConstantOccurrences(editor.document.getText()).map((occurrence) =>
            toRange(editor.document, occurrence.range),
        );
        editor.setDecorations(this.typeDecoration, typeRanges);
        editor.setDecorations(this.propertyDecoration, propertyRanges);
        editor.setDecorations(this.constantDecoration, constantRanges);
    }
}

function toRange(document: vscode.TextDocument, range: TextOffsetRange): vscode.Range {
    return new vscode.Range(document.positionAt(range.start), document.positionAt(range.end));
}

function isCppDocument(document: vscode.TextDocument): boolean {
    return document.languageId === "cpp" || document.languageId === "c";
}

function isEnabled(uri: vscode.Uri): boolean {
    return vscode.workspace.getConfiguration("uevsc", uri).get("syntaxHighlighting.enabled", true);
}
