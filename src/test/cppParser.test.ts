import assert from "node:assert/strict";
import { resolve } from "node:path";
import test from "node:test";

import { CppParser } from "../parser/cppParser.js";

const runtimeWasm = resolve("node_modules/web-tree-sitter/web-tree-sitter.wasm");
const cppWasm = resolve("node_modules/tree-sitter-cpp/tree-sitter-cpp.wasm");

test("extracts UE-style classes, methods, fields, definitions, and locals", async () => {
  const parser = await CppParser.create(runtimeWasm, cppWasm);
  const source = `
/** Spell state owned by the player. */
UCLASS(ClassGroup=(Peacebound))
class PEACEBOUND_API UPeaceboundSpellComponent final : public UActorComponent
{
    GENERATED_BODY()
public:
    EPeaceboundSpellId GetPreparedSpellId() const { return PreparedSpellId; }
    bool PrepareSpell(EPeaceboundSpellId SpellId);
private:
    EPeaceboundSpellId PreparedSpellId = EPeaceboundSpellId::None;
};

bool UPeaceboundSpellComponent::PrepareSpell(EPeaceboundSpellId SpellId)
{
    UPeaceboundSpellComponent* Spells = this;
    return Spells->GetPreparedSpellId() != SpellId;
}
`;

  try {
    const parsed = parser.parse("file:///fixture.cpp", source);
    assert.equal(parsed.symbols.find((symbol) => symbol.name === "UPeaceboundSpellComponent")?.kind, "class");

    const getter = parsed.symbols.find((symbol) => symbol.name === "GetPreparedSpellId");
    assert.equal(getter?.container, "UPeaceboundSpellComponent");
    assert.equal(getter?.isDefinition, true);
    assert.match(getter?.signature ?? "", /EPeaceboundSpellId GetPreparedSpellId\(\) const/);

    const implementation = parsed.symbols.find(
      (symbol) => symbol.name === "PrepareSpell" && symbol.isDefinition,
    );
    assert.equal(implementation?.qualifiedName, "UPeaceboundSpellComponent::PrepareSpell");
    assert.equal(implementation?.type, "bool");

    const field = parsed.symbols.find((symbol) => symbol.name === "PreparedSpellId" && symbol.kind === "field");
    assert.equal(field?.type, "EPeaceboundSpellId");

    const local = parsed.symbols.find((symbol) => symbol.name === "Spells");
    assert.equal(local?.type, "UPeaceboundSpellComponent *");
    assert.equal(local?.isLocal, true);
  } finally {
    parser.dispose();
  }
});
