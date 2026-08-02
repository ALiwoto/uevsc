import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

interface InjectionGrammar {
    readonly injectionSelector?: string;
    readonly repository?: Record<string, { readonly name?: string; readonly match?: string }>;
}

test("highlights Unreal module export macros through the C++ injection grammar", async () => {
    const contents = await readFile(resolve("syntaxes/unreal-cpp.tmLanguage.json"), "utf8");
    const grammar = JSON.parse(contents) as InjectionGrammar;
    const rule = grammar.repository?.["module-export-macro"];

    assert.equal(grammar.injectionSelector, "L:source.cpp -comment -string");
    assert.equal(rule?.name, "keyword.other.unreal.export-macro.cpp");

    const matcher = new RegExp(rule?.match ?? "(?!.*)", "g");
    const source = "class MYGAME_API AMyGameController final {};";
    assert.deepEqual(
        [...source.matchAll(matcher)].map((match) => match[0]),
        ["MYGAME_API"],
    );
    assert.equal(matcher.test("class MyGame_API AMyGameController {};"), false);
});
