import Module, { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const originalLoad = Module._load;

const disposable = { dispose() {} };
const event = () => disposable;
const watcher = {
    ...disposable,
    onDidCreate: event,
    onDidChange: event,
    onDidDelete: event,
};
class ThemeColor {
    constructor(id) {
        this.id = id;
    }
}
class Range {
    constructor(start, end) {
        this.start = start;
        this.end = end;
    }
}
class MarkdownString {
    constructor(value = "") {
        this.value = value;
        this.isTrusted = false;
    }

    appendCodeblock(value, language) {
        this.value += `\n\`\`\`${language}\n${value}\n\`\`\`\n`;
        return this;
    }

    appendMarkdown(value) {
        this.value += value;
        return this;
    }
}
class Hover {
    constructor(contents, range) {
        this.contents = contents;
        this.range = range;
    }
}
const decorations = new Map();
const definitionProviders = [];
const hoverProviders = [];
const fixtureSource =
    "// 🎮 UI fields\nUPROPERTY()\n\tTObjectPtr<UTexture2D> ScrollbarTrackTexture;\n\tTSharedPtr<SMyGamePauseScreen> PauseScreen;\n\tif (SelectedIndex == INDEX_NONE) {}\n";
const fixtureDocument = {
    languageId: "cpp",
    uri: { toString: () => "file:///fixture.h" },
    getText(range) {
        if (!range) return fixtureSource;
        return fixtureSource.slice(this.offsetAt(range.start), this.offsetAt(range.end));
    },
    positionAt(offset) {
        const prefix = fixtureSource.slice(0, offset);
        const lines = prefix.split("\n");
        return { line: lines.length - 1, character: lines.at(-1).length };
    },
    offsetAt(position) {
        const lines = fixtureSource.split("\n");
        let offset = 0;
        for (let line = 0; line < position.line; line++) offset += lines[line].length + 1;
        return offset + position.character;
    },
    getWordRangeAtPosition(position) {
        const lines = fixtureSource.split("\n");
        const line = lines[position.line] ?? "";
        let start = position.character;
        let end = position.character;
        while (start > 0 && /[A-Za-z0-9_]/.test(line[start - 1])) start--;
        while (end < line.length && /[A-Za-z0-9_]/.test(line[end])) end++;
        return start === end
            ? undefined
            : new Range({ line: position.line, character: start }, { line: position.line, character: end });
    },
};
const fixtureEditor = {
    document: fixtureDocument,
    setDecorations(decoration, ranges) {
        decorations.set(decoration.id, ranges);
    },
};

const vscode = {
    version: "smoke-test",
    ProgressLocation: { Window: 10 },
    ThemeColor,
    Range,
    MarkdownString,
    Hover,
    window: {
        visibleTextEditors: [fixtureEditor],
        createOutputChannel() {
            const lines = [];
            return {
                ...disposable,
                lines,
                appendLine(line) {
                    lines.push(line);
                },
            };
        },
        showErrorMessage: async () => undefined,
        showInformationMessage: async () => undefined,
        setStatusBarMessage: () => disposable,
        createTextEditorDecorationType: (options) => ({ ...disposable, id: options.color.id }),
        onDidChangeVisibleTextEditors: event,
        onDidChangeActiveTextEditor: event,
        withProgress: async (_options, task) => task({ report() {} }),
    },
    workspace: {
        textDocuments: [],
        createFileSystemWatcher: () => watcher,
        onDidChangeTextDocument: event,
        onDidCloseTextDocument: event,
        onDidChangeConfiguration: event,
        getConfiguration: () => ({ get: (_key, fallback) => fallback }),
        getWorkspaceFolder: () => undefined,
        findFiles: async () => [],
    },
    languages: {
        registerDefinitionProvider(_selector, provider) {
            definitionProviders.push(provider);
            return disposable;
        },
        registerHoverProvider(_selector, provider) {
            hoverProviders.push(provider);
            return disposable;
        },
    },
    commands: {
        registerCommand: () => disposable,
    },
};

Module._load = function load(request, parent, isMain) {
    if (request === "vscode") {
        return vscode;
    }
    return originalLoad.call(this, request, parent, isMain);
};

try {
    const extension = require(resolve(root, "dist/extension.js"));

    const failedOutput = await activate(extension, resolve(root, "missing"));
    const failedLog = failedOutput.lines.join("\n");
    if (!failedLog.includes("[error]") || !/src[\\/]extension\.ts/.test(failedLog)) {
        throw new Error(
            `Initialization failures do not include an error level and mapped TypeScript stack trace.\n${failedLog}`,
        );
    }

    const successfulOutput = await activate(extension, root);
    if (!successfulOutput.lines.some((line) => line.includes("C++ parser initialized successfully."))) {
        throw new Error("The packaged extension did not initialize its C++ parser.");
    }
    const typeRanges = decorations.get("uevsc.unrealTypeForeground");
    if (typeRanges?.length !== 4) {
        throw new Error("The packaged extension did not decorate annotated and ordinary member type names.");
    }
    const sharedPointerRange = typeRanges[2];
    if (
        sharedPointerRange.start.line !== 3 ||
        sharedPointerRange.start.character !== 1 ||
        sharedPointerRange.end.character !== 11
    ) {
        throw new Error("The packaged extension did not preserve UTF-16 offsets for ordinary member types.");
    }
    const propertyRanges = decorations.get("uevsc.unrealPropertyForeground");
    if (propertyRanges?.length !== 2) {
        throw new Error("The packaged extension did not decorate annotated and ordinary member names.");
    }
    const pauseScreenRange = propertyRanges[1];
    if (
        pauseScreenRange.start.line !== 3 ||
        pauseScreenRange.start.character !== 32 ||
        pauseScreenRange.end.character !== 43
    ) {
        throw new Error("The packaged extension did not preserve UTF-16 offsets for ordinary member names.");
    }
    const constantRanges = decorations.get("uevsc.unrealConstantForeground");
    if (constantRanges?.length !== 1) {
        throw new Error("The packaged extension did not decorate known Unreal Engine constants.");
    }
    const constantOffset = fixtureSource.indexOf("INDEX_NONE") + 2;
    const constantPosition = fixtureDocument.positionAt(constantOffset);
    const constantHover = hoverProviders.at(-1)?.provideHover(fixtureDocument, constantPosition);
    const constantHoverText = constantHover?.contents?.value ?? "";
    if (
        !constantHoverText.includes("enum { INDEX_NONE = -1 };") ||
        !constantHoverText.includes("**Type:** `anonymous unscoped enum constant`") ||
        !constantHoverText.includes("**Value:** `-1`") ||
        constantHoverText.includes("command:") ||
        constantHoverText.includes("](") ||
        constantHover.contents.isTrusted !== false
    ) {
        throw new Error("The packaged extension did not return a static informational hover for INDEX_NONE.");
    }
    const constantDefinition = definitionProviders.at(-1)?.provideDefinition(fixtureDocument, constantPosition);
    if (constantDefinition !== undefined) {
        throw new Error("Known Unreal Engine constants unexpectedly provided definition navigation.");
    }
    extension.deactivate();
    console.log("Packaged extension activation smoke test passed.");
} finally {
    Module._load = originalLoad;
}

async function activate(extension, extensionRoot) {
    const subscriptions = [];
    const context = {
        subscriptions: {
            push(...items) {
                subscriptions.push(...items);
            },
        },
        extension: { packageJSON: { version: "smoke-test" } },
        extensionPath: extensionRoot,
        asAbsolutePath: (relativePath) => resolve(extensionRoot, relativePath),
    };

    await extension.activate(context);
    const output = subscriptions.find((item) => Array.isArray(item.lines));
    if (!output) {
        throw new Error("The packaged extension did not create its output channel.");
    }
    return output;
}
