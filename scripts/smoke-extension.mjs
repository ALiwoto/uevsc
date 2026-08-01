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

const vscode = {
    version: "smoke-test",
    ProgressLocation: { Window: 10 },
    window: {
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
        registerDefinitionProvider: () => disposable,
        registerHoverProvider: () => disposable,
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
