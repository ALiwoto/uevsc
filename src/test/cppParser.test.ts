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

        const implementation = parsed.symbols.find((symbol) => symbol.name === "PrepareSpell" && symbol.isDefinition);
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

test("assigns locals to their nearest lexical scopes", async () => {
    const parser = await CppParser.create(runtimeWasm, cppWasm);
    const source = `
void RunScopeTest(int32 Parameter)
{
    int32 Snapshot = Parameter;
    {
        int32 Snapshot = 2;
        Consume(Snapshot);
    }
    for (int32 SlotIndex = 0; SlotIndex < 3; ++SlotIndex)
    {
        Consume(SlotIndex);
    }
    Consume(Snapshot);
}
`;

    try {
        const parsed = parser.parse("file:///scope.cpp", source);
        const snapshots = parsed.symbols
            .filter((symbol) => symbol.name === "Snapshot")
            .sort((left, right) => left.selectionRange.start.line - right.selectionRange.start.line);
        const outer = snapshots[0];
        const inner = snapshots[1];
        const slotIndex = parsed.symbols.find((symbol) => symbol.name === "SlotIndex" && symbol.kind === "variable");
        const parameter = parsed.symbols.find((symbol) => symbol.name === "Parameter" && symbol.kind === "parameter");

        assert.ok(outer?.visibilityRange);
        assert.ok(inner?.visibilityRange);
        assert.ok(slotIndex?.visibilityRange);
        assert.ok(parameter?.visibilityRange);
        assert.ok(outer.visibilityRange.end.line > inner.visibilityRange.end.line);
        assert.ok(slotIndex.visibilityRange.end.line < outer.visibilityRange.end.line);
        assert.equal(parameter.visibilityRange.end.line, outer.visibilityRange.end.line);
    } finally {
        parser.dispose();
    }
});
