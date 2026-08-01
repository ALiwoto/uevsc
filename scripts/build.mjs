import * as esbuild from "esbuild";
import { cp, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { sharedBuildOptions } from "./esbuild-shared.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const watch = process.argv.includes("--watch");

async function copyWasm() {
    await mkdir(resolve(root, "dist"), { recursive: true });
    await cp(
        resolve(root, "node_modules/web-tree-sitter/web-tree-sitter.wasm"),
        resolve(root, "dist/web-tree-sitter.wasm"),
    );
    await cp(
        resolve(root, "node_modules/tree-sitter-cpp/tree-sitter-cpp.wasm"),
        resolve(root, "dist/tree-sitter-cpp.wasm"),
    );
}

const options = {
    ...sharedBuildOptions(root),
    entryPoints: [resolve(root, "src/extension.ts")],
    external: ["vscode"],
    format: "cjs",
    outfile: resolve(root, "dist/extension.js"),
    sourcemap: true,
    minify: false,
    logLevel: "info",
};

await copyWasm();
if (watch) {
    const context = await esbuild.context(options);
    await context.watch();
    console.log("Watching extension sources...");
} else {
    await esbuild.build(options);
}
