import * as esbuild from "esbuild";
import { mkdir, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { sharedBuildOptions } from "./esbuild-shared.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const temporaryDirectory = resolve(root, ".tmp");
const outputFile = resolve(temporaryDirectory, "parser-smoke.cjs");

await mkdir(temporaryDirectory, { recursive: true });
try {
    await esbuild.build({
        ...sharedBuildOptions(root),
        entryPoints: [resolve(root, "src/parser/cppParser.ts")],
        format: "cjs",
        outfile: outputFile,
        sourcemap: true,
        logLevel: "warning",
    });

    const require = createRequire(import.meta.url);
    const { CppParser } = require(outputFile);
    const parser = await CppParser.create(
        resolve(root, "node_modules/web-tree-sitter/web-tree-sitter.wasm"),
        resolve(root, "node_modules/tree-sitter-cpp/tree-sitter-cpp.wasm"),
    );
    try {
        const parsed = parser.parse("file:///smoke.cpp", "class FSmoke { public: int32 Value = 1; };\n");
        if (!parsed.symbols.some((symbol) => symbol.name === "FSmoke")) {
            throw new Error("The bundled parser did not extract the smoke-test class.");
        }
    } finally {
        parser.dispose();
    }
    console.log("Bundled CommonJS parser smoke test passed.");
} finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
}
