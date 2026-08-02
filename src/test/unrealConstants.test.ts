import assert from "node:assert/strict";
import test from "node:test";

import { findUnrealConstantOccurrences, getUnrealConstant, UNREAL_CONSTANTS } from "../language/unrealConstants.js";
import { formatUnrealConstantDetails } from "../vscode/hoverMarkdown.js";

test("describes INDEX_NONE using its verified UE 5.4 declaration", () => {
    const constant = getUnrealConstant("INDEX_NONE");
    assert.deepEqual(constant, {
        name: "INDEX_NONE",
        declaration: "enum { INDEX_NONE = -1 };",
        type: "anonymous unscoped enum constant",
        value: "-1",
        description: "Sentinel used when an index is invalid, missing, or not found.",
    });
});

test("catalog names are unique and contain static descriptions, types, and values", () => {
    assert.equal(new Set(UNREAL_CONSTANTS.map((constant) => constant.name)).size, UNREAL_CONSTANTS.length);
    for (const constant of UNREAL_CONSTANTS) {
        assert.ok(constant.declaration);
        assert.ok(constant.type);
        assert.ok(constant.value);
        assert.ok(constant.description);
    }
});

test("finds known constants in code while ignoring comments and strings", () => {
    const source = `
int32 SelectedIndex = INDEX_NONE;
float Tolerance = UE_KINDA_SMALL_NUMBER;
// INDEX_NONE
Log(TEXT("UE_PI"));
const char* Raw = R"example(MAX_int32)example";
`;

    const occurrences = findUnrealConstantOccurrences(source);
    assert.deepEqual(
        occurrences.map((occurrence) => source.slice(occurrence.range.start, occurrence.range.end)),
        ["INDEX_NONE", "UE_KINDA_SMALL_NUMBER"],
    );
});

test("formats constant hover details without links or commands", () => {
    const constant = getUnrealConstant("INDEX_NONE");
    assert.ok(constant);
    const markdown = formatUnrealConstantDetails(constant);
    assert.match(markdown, /Sentinel used when an index is invalid/);
    assert.match(markdown, /\*\*Type:\*\* `anonymous unscoped enum constant`/);
    assert.match(markdown, /\*\*Value:\*\* `-1`/);
    assert.equal(markdown.includes("]("), false);
    assert.equal(markdown.includes("command:"), false);
});
