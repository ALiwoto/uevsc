import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

interface InjectionGrammar {
    readonly injectionSelector?: string;
    readonly repository?: Record<string, GrammarRule>;
}

interface GrammarRule {
    readonly name?: string;
    readonly match?: string;
    readonly begin?: string;
    readonly end?: string;
    readonly captures?: Record<string, { readonly name?: string }>;
    readonly beginCaptures?: Record<string, { readonly name?: string }>;
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

test("highlights reflected property types and field names", async () => {
    const contents = await readFile(resolve("syntaxes/unreal-cpp.tmLanguage.json"), "utf8");
    const grammar = JSON.parse(contents) as InjectionGrammar;
    const propertyRule = grammar.repository?.["reflected-property"];
    const declarationRule = grammar.repository?.["reflected-field-declaration"];

    assert.equal(propertyRule?.begin, "(\\bUPROPERTY\\b)(\\s*)(\\()");
    assert.equal(propertyRule?.end, ";");
    assert.equal(propertyRule?.beginCaptures?.["1"]?.name, "entity.name.function.preprocessor.cpp");
    assert.equal(declarationRule?.captures?.["1"]?.name, "entity.name.type.class.cpp");
    assert.equal(declarationRule?.captures?.["2"]?.name, "variable.other.property.cpp");

    const matcher = new RegExp(declarationRule?.match ?? "(?!.*)");
    const declaration = matcher.exec("FMyGameResourceSaveData Resources;");
    assert.equal(declaration?.[1], "FMyGameResourceSaveData");
    assert.equal(declaration?.[2], "Resources");

    const templatedDeclaration = matcher.exec("TObjectPtr<UMyGameResource> Resource = nullptr;");
    assert.equal(templatedDeclaration?.[1], "TObjectPtr<UMyGameResource>");
    assert.equal(templatedDeclaration?.[2], "Resource");
});
