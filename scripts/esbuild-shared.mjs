import { resolve } from "node:path";

export function sharedBuildOptions(root) {
    return {
        bundle: true,
        platform: "node",
        target: "node20",
        alias: {
            "web-tree-sitter": resolve(root, "node_modules/web-tree-sitter/web-tree-sitter.cjs"),
        },
    };
}
