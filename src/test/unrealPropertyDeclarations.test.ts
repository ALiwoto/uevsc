import assert from "node:assert/strict";
import test from "node:test";

import {
    findCppVariableDeclarations,
    findUnrealPropertyDeclarations,
    type TextOffsetRange,
} from "../language/unrealPropertyDeclarations.js";

test("finds reflected property type names and member names", () => {
    const source = `
UPROPERTY()
FMyGameResourceSaveData Resources;

UPROPERTY(EditAnywhere, meta=(AllowedClasses="Texture2D"))
TObjectPtr<UTexture2D> ScrollbarTrackTexture;
`;

    const declarations = findUnrealPropertyDeclarations(source);
    assert.equal(declarations.length, 2);
    assert.deepEqual(
        declarations[0]?.typeNames.map((range) => textAt(source, range)),
        ["FMyGameResourceSaveData"],
    );
    assert.equal(textAt(source, declarations[0]!.propertyName), "Resources");
    assert.deepEqual(
        declarations[1]?.typeNames.map((range) => textAt(source, range)),
        ["TObjectPtr", "UTexture2D"],
    );
    assert.equal(textAt(source, declarations[1]!.propertyName), "ScrollbarTrackTexture");
});

test("handles comments, qualifiers, nested templates, initializers, and bit fields", () => {
    const source = `
UPROPERTY() // exposed asset list
const TArray<TObjectPtr<UMyGameAsset>> Assets = {};

UPROPERTY()
uint8 bEnabled : 1;
`;

    const declarations = findUnrealPropertyDeclarations(source);
    assert.deepEqual(
        declarations[0]?.typeNames.map((range) => textAt(source, range)),
        ["TArray", "TObjectPtr", "UMyGameAsset"],
    );
    assert.equal(textAt(source, declarations[0]!.propertyName), "Assets");
    assert.deepEqual(
        declarations[1]?.typeNames.map((range) => textAt(source, range)),
        ["uint8"],
    );
    assert.equal(textAt(source, declarations[1]!.propertyName), "bEnabled");
});

test("ignores UPROPERTY text in comments and strings", () => {
    const source = `
// UPROPERTY() FIgnoredType IgnoredField;
const char* Example = "UPROPERTY() FAlsoIgnored OtherField;";
UPROPERTY()
FMyGameSettings Settings;
`;

    const declarations = findUnrealPropertyDeclarations(source);
    assert.equal(declarations.length, 1);
    assert.equal(textAt(source, declarations[0]!.propertyName), "Settings");
});

test("finds ordinary Unreal-style member declarations without UPROPERTY", () => {
    const source = `
TSharedPtr<SMyGamePauseScreen> PauseScreen;
TSharedPtr<SMyGameGameplayHUD> GameplayHUD;
TSharedPtr<SMyGameSavePrompt> SavePrompt;
TSharedPtr<SMyGameSettingsScreen> SettingsScreen;
EPendingExitDestination PendingExitDestination = EPendingExitDestination::None;
int32 SelectedHotbarSlotIndex = INDEX_NONE;
bool bVisible = false;
`;

    const declarations = findCppVariableDeclarations(source);
    assert.deepEqual(
        declarations.map((declaration) => textAt(source, declaration.propertyName)),
        [
            "PauseScreen",
            "GameplayHUD",
            "SavePrompt",
            "SettingsScreen",
            "PendingExitDestination",
            "SelectedHotbarSlotIndex",
            "bVisible",
        ],
    );
    assert.deepEqual(
        declarations[0]?.typeNames.map((range) => textAt(source, range)),
        ["TSharedPtr", "SMyGamePauseScreen"],
    );
    assert.deepEqual(
        declarations[4]?.typeNames.map((range) => textAt(source, range)),
        ["EPendingExitDestination"],
    );
    assert.deepEqual(
        declarations[5]?.typeNames.map((range) => textAt(source, range)),
        ["int32"],
    );
    assert.deepEqual(declarations[6]?.typeNames, []);
});

test("does not treat calls, control statements, comments, or strings as declarations", () => {
    const source = `
// TSharedPtr<SMyGameScreen> CommentedOut;
LogText("TSharedPtr<SMyGameScreen> InAString;");
return PauseScreen;
OpenScreen(PauseScreen);
#define DECLARE_SCREEN TSharedPtr<SMyGameScreen> MacroScreen;
`;

    assert.deepEqual(findCppVariableDeclarations(source), []);
});

test("does not decorate method names or trailing method qualifiers as variables", () => {
    const source = `
FMyGameGameplayHUDSnapshot BuildGameplayHUDSnapshot() const;
virtual void BeginPlay() override;
virtual void EndPlay(const EEndPlayReason::Type EndPlayReason) override;
virtual void SetupInputComponent() override;
`;

    assert.deepEqual(findCppVariableDeclarations(source), []);
});

test("preserves UTF-16 offsets when non-BMP characters occur before declarations", () => {
    const source = `
// 🎮 UI fields
TSharedPtr<SMyGamePauseScreen> PauseScreen;
`;

    const declarations = findCppVariableDeclarations(source);
    assert.deepEqual(
        declarations[0]?.typeNames.map((range) => textAt(source, range)),
        ["TSharedPtr", "SMyGamePauseScreen"],
    );
    assert.equal(textAt(source, declarations[0]!.propertyName), "PauseScreen");
});

test("includes leading indentation when mapping ordinary declaration type ranges", () => {
    const source = "\tTSharedPtr<SMyGamePauseScreen> PauseScreen;\n";

    const declarations = findCppVariableDeclarations(source);
    assert.deepEqual(
        declarations[0]?.typeNames.map((range) => textAt(source, range)),
        ["TSharedPtr", "SMyGamePauseScreen"],
    );
    assert.equal(textAt(source, declarations[0]!.propertyName), "PauseScreen");
});

function textAt(source: string, range: TextOffsetRange): string {
    return source.slice(range.start, range.end);
}
