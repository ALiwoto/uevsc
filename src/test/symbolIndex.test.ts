import assert from "node:assert/strict";
import test from "node:test";

import type { CppSymbol, ParsedFile, SymbolKind } from "../core/model.js";
import { SymbolIndex } from "../index/symbolIndex.js";

test("uses a local receiver's type to choose the matching class member", () => {
  const index = new SymbolIndex();
  index.replaceFile(file("file:///caller.cpp", [
    symbol("Spells", "variable", "file:///caller.cpp", 10, "UPeaceboundSpellComponent *", undefined, true),
  ]));
  index.replaceFile(file("file:///spell.h", [
    symbol("GetPreparedSpellId", "method", "file:///spell.h", 20, "EPeaceboundSpellId", "UPeaceboundSpellComponent"),
  ]));
  index.replaceFile(file("file:///other.h", [
    symbol("GetPreparedSpellId", "method", "file:///other.h", 5, "int", "UOtherComponent"),
  ]));

  const result = index.resolve({
    uri: "file:///caller.cpp",
    position: { line: 15, character: 20 },
    word: "GetPreparedSpellId",
    linePrefix: "    if (Spells->",
  });

  assert.equal(result.receiverType, "UPeaceboundSpellComponent");
  assert.equal(result.symbols.length, 1);
  assert.equal(result.symbols[0]?.container, "UPeaceboundSpellComponent");
});

test("uses the containing implementation and a receiver call's return type", () => {
  const index = new SymbolIndex();
  index.replaceFile(file("file:///controller.cpp", [
    {
      ...symbol("HandlePrimaryAction", "method", "file:///controller.cpp", 10, "void", "APeaceboundPlayerController"),
      range: { start: { line: 10, character: 0 }, end: { line: 30, character: 0 } },
    },
    symbol("GetControlledSpellComponent", "method", "file:///controller.cpp", 2, "UPeaceboundSpellComponent *", "APeaceboundPlayerController"),
  ]));
  index.replaceFile(file("file:///spell.h", [
    symbol("PrepareSpell", "method", "file:///spell.h", 20, "bool", "UPeaceboundSpellComponent"),
  ]));
  index.replaceFile(file("file:///other.h", [
    symbol("PrepareSpell", "method", "file:///other.h", 5, "bool", "UOtherComponent"),
  ]));

  const result = index.resolve({
    uri: "file:///controller.cpp",
    position: { line: 15, character: 45 },
    word: "PrepareSpell",
    linePrefix: "    GetControlledSpellComponent()->",
  });

  assert.equal(result.receiverType, "UPeaceboundSpellComponent");
  assert.equal(result.symbols.length, 1);
  assert.equal(result.symbols[0]?.container, "UPeaceboundSpellComponent");
});

function file(uri: string, symbols: CppSymbol[]): ParsedFile {
  return { uri, symbols, parseErrors: 0, bytes: 100, elapsedMs: 1 };
}

function symbol(
  name: string,
  kind: SymbolKind,
  uri: string,
  line: number,
  type?: string,
  container?: string,
  isLocal = false,
): CppSymbol {
  const position = { line, character: 0 };
  return {
    name,
    qualifiedName: container ? `${container}::${name}` : name,
    kind,
    uri,
    range: { start: position, end: { line: line + 1, character: 0 } },
    selectionRange: { start: position, end: { line, character: name.length } },
    scope: container ? [container] : [],
    container,
    type,
    signature: `${type ?? "void"} ${name}`,
    isDefinition: true,
    isLocal,
    visibilityRange: isLocal
      ? { start: { line: 0, character: 0 }, end: { line: 1000, character: 0 } }
      : undefined,
  };
}
