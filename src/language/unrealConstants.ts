import type { TextOffsetRange } from "./unrealPropertyDeclarations.js";

export interface UnrealConstantInfo {
    readonly name: string;
    readonly declaration: string;
    readonly type: string;
    readonly value: string;
    readonly description: string;
    readonly preferredReplacement?: string;
}

export interface UnrealConstantOccurrence {
    readonly constant: UnrealConstantInfo;
    readonly range: TextOffsetRange;
}

// Verified against Unreal Engine 5.4 CoreMiscDefines.h, UnrealMathUtility.h,
// and NumericLimits.h. This catalog is intentionally static at runtime.
export const UNREAL_CONSTANTS: readonly UnrealConstantInfo[] = [
    {
        name: "INDEX_NONE",
        declaration: "enum { INDEX_NONE = -1 };",
        type: "anonymous unscoped enum constant",
        value: "-1",
        description: "Sentinel used when an index is invalid, missing, or not found.",
    },
    floatMacro("UE_PI", "3.1415926535897932f", "Single-precision value of pi."),
    floatMacro("UE_SMALL_NUMBER", "1.e-8f", "Strict floating-point tolerance for near-zero checks."),
    floatMacro(
        "UE_KINDA_SMALL_NUMBER",
        "1.e-4f",
        "General-purpose floating-point tolerance for approximate comparisons.",
    ),
    floatMacro("UE_BIG_NUMBER", "3.4e+38f", "Large finite float commonly used as a practical upper-bound sentinel."),
    floatMacro("UE_EULERS_NUMBER", "2.71828182845904523536f", "Single-precision value of Euler's number."),
    floatMacro("UE_GOLDEN_RATIO", "1.6180339887498948482045868343656381f", "Single-precision golden ratio."),
    floatMacro("UE_HALF_PI", "1.57079632679f", "Single-precision value of pi divided by two."),
    floatMacro("UE_TWO_PI", "6.28318530717f", "Single-precision value of two times pi."),
    integerMacro("MIN_int32", "int32", "0x80000000", "-2147483648", "Minimum signed 32-bit integer value."),
    integerMacro("MAX_int32", "int32", "0x7fffffff", "2147483647", "Maximum signed 32-bit integer value."),
    integerMacro("MAX_uint32", "uint32", "0xffffffff", "4294967295", "Maximum unsigned 32-bit integer value."),
    integerMacro(
        "MIN_int64",
        "int64",
        "0x8000000000000000",
        "-9223372036854775808",
        "Minimum signed 64-bit integer value.",
    ),
    integerMacro(
        "MAX_int64",
        "int64",
        "0x7fffffffffffffff",
        "9223372036854775807",
        "Maximum signed 64-bit integer value.",
    ),
    integerMacro(
        "MAX_uint64",
        "uint64",
        "0xffffffffffffffff",
        "18446744073709551615",
        "Maximum unsigned 64-bit integer value.",
    ),
    legacyFloatAlias("PI", "UE_PI", "3.1415926535897932f"),
    legacyFloatAlias("SMALL_NUMBER", "UE_SMALL_NUMBER", "1.e-8f"),
    legacyFloatAlias("KINDA_SMALL_NUMBER", "UE_KINDA_SMALL_NUMBER", "1.e-4f"),
    legacyFloatAlias("BIG_NUMBER", "UE_BIG_NUMBER", "3.4e+38f"),
    legacyFloatAlias("HALF_PI", "UE_HALF_PI", "1.57079632679f"),
    legacyFloatAlias("TWO_PI", "UE_TWO_PI", "6.28318530717f"),
];

const CONSTANTS_BY_NAME = new Map(UNREAL_CONSTANTS.map((constant) => [constant.name, constant]));
const CONSTANT_PATTERN = new RegExp(
    `\\b(?:${UNREAL_CONSTANTS.map((constant) => escapeRegExp(constant.name)).join("|")})\\b`,
    "g",
);

export function getUnrealConstant(name: string): UnrealConstantInfo | undefined {
    return CONSTANTS_BY_NAME.get(name);
}

export function findUnrealConstantOccurrences(source: string): UnrealConstantOccurrence[] {
    const masked = maskCommentsAndStrings(source);
    return [...masked.matchAll(CONSTANT_PATTERN)].flatMap((match) => {
        const name = match[0];
        const start = match.index;
        const constant = getUnrealConstant(name);
        return start === undefined || !constant ? [] : [{ constant, range: { start, end: start + name.length } }];
    });
}

function floatMacro(name: string, value: string, description: string): UnrealConstantInfo {
    return {
        name,
        declaration: `#define ${name} (${value})`,
        type: "float macro",
        value,
        description,
    };
}

function integerMacro(
    name: string,
    type: string,
    literal: string,
    value: string,
    description: string,
): UnrealConstantInfo {
    return {
        name,
        declaration: `#define ${name} ((${type}) ${literal})`,
        type: `${type} macro`,
        value,
        description,
    };
}

function legacyFloatAlias(name: string, replacement: string, value: string): UnrealConstantInfo {
    return {
        name,
        declaration: `#define ${name} UE_PRIVATE_MATH_DEPRECATION(${name}, ${replacement}) ${replacement}`,
        type: "deprecated float macro alias",
        value,
        description: `Deprecated compatibility alias for ${replacement}.`,
        preferredReplacement: replacement,
    };
}

function maskCommentsAndStrings(source: string): string {
    const characters = source.split("");
    let cursor = 0;
    while (cursor < source.length) {
        const character = source[cursor]!;
        if (character === "R" && source[cursor + 1] === '"') {
            const end = skipRawString(source, cursor);
            maskRange(characters, cursor, end);
            cursor = end;
            continue;
        }
        if (character === '"' || character === "'") {
            const end = skipQuotedString(source, cursor, character);
            maskRange(characters, cursor, end);
            cursor = end;
            continue;
        }
        if (character === "/" && source[cursor + 1] === "/") {
            const newline = source.indexOf("\n", cursor + 2);
            const end = newline < 0 ? source.length : newline + 1;
            maskRange(characters, cursor, end);
            cursor = end;
            continue;
        }
        if (character === "/" && source[cursor + 1] === "*") {
            const commentEnd = source.indexOf("*/", cursor + 2);
            const end = commentEnd < 0 ? source.length : commentEnd + 2;
            maskRange(characters, cursor, end);
            cursor = end;
            continue;
        }
        cursor++;
    }
    return characters.join("");
}

function skipQuotedString(source: string, start: number, quote: string): number {
    let cursor = start + 1;
    while (cursor < source.length) {
        if (source[cursor] === "\\") {
            cursor += 2;
            continue;
        }
        if (source[cursor] === quote) return cursor + 1;
        cursor++;
    }
    return source.length;
}

function skipRawString(source: string, start: number): number {
    const delimiterEnd = source.indexOf("(", start + 2);
    if (delimiterEnd < 0) return source.length;
    const delimiter = source.slice(start + 2, delimiterEnd);
    const terminator = `)${delimiter}\"`;
    const end = source.indexOf(terminator, delimiterEnd + 1);
    return end < 0 ? source.length : end + terminator.length;
}

function maskRange(characters: string[], start: number, end: number): void {
    for (let index = start; index < end; index++) {
        if (characters[index] !== "\n" && characters[index] !== "\r") characters[index] = " ";
    }
}

function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
