import assert from "node:assert/strict";
import test from "node:test";

import { isCppKeyword } from "../language/cppKeywords.js";

test("recognizes C and C++ keywords without treating Unreal macros as keywords", () => {
    assert.equal(isCppKeyword("class"), true);
    assert.equal(isCppKeyword("consteval"), true);
    assert.equal(isCppKeyword("_Static_assert"), true);
    assert.equal(isCppKeyword("MYGAME_API"), false);
    assert.equal(isCppKeyword("FORCEINLINE"), false);
});
