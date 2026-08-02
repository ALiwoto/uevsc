import assert from "node:assert/strict";
import test from "node:test";

import { formatHoverSource } from "../vscode/hoverMarkdown.js";

test("formats a compact clickable source location without definition labels or directories", () => {
    const markdown = formatHoverSource("field", {
        fileName: "MyGameController.cpp",
        line: 56,
        target: "file:///workspace/MyGame/Source/MyGameController.cpp#L56",
    });

    assert.equal(
        markdown,
        "field · [\\(MyGameController\\.cpp:56\\)](file:///workspace/MyGame/Source/MyGameController.cpp#L56)",
    );
    assert.equal(markdown.includes("definition"), false);
    assert.equal(markdown.includes("workspace/MyGame/Source/MyGameController.cpp:56"), false);
});
