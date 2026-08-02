import { isCppKeyword } from "./cppKeywords.js";

export interface TextOffsetRange {
    readonly start: number;
    readonly end: number;
}

export interface UnrealPropertyDeclaration {
    readonly typeNames: readonly TextOffsetRange[];
    readonly propertyName: TextOffsetRange;
}

const IDENTIFIER_PATTERN = /\b[A-Za-z_]\w*\b/g;
const DECLARATION_PATTERN = /^\s*([\s\S]*?)\b([A-Za-z_]\w*)\s*(?:\[[^\]]*\]\s*)?(?::\s*[^=;]+)?(?:=\s*[\s\S]*)?;\s*$/;
const BUILTIN_TYPE_KEYWORDS = new Set([
    "_Bool",
    "auto",
    "bool",
    "char",
    "char8_t",
    "char16_t",
    "char32_t",
    "double",
    "float",
    "int",
    "long",
    "short",
    "signed",
    "unsigned",
    "void",
    "wchar_t",
]);

export function findCppVariableDeclarations(source: string): UnrealPropertyDeclaration[] {
    const declarations = new Map<number, UnrealPropertyDeclaration>();
    for (const declaration of findUnrealPropertyDeclarations(source)) {
        declarations.set(declaration.propertyName.start, declaration);
    }
    for (const declaration of findSingleLineDeclarations(source)) {
        if (!declarations.has(declaration.propertyName.start)) {
            declarations.set(declaration.propertyName.start, declaration);
        }
    }
    return [...declarations.values()].sort((left, right) => left.propertyName.start - right.propertyName.start);
}

export function findUnrealPropertyDeclarations(source: string): UnrealPropertyDeclaration[] {
    const declarations: UnrealPropertyDeclaration[] = [];
    let cursor = 0;

    while (cursor < source.length) {
        cursor = skipTriviaAndStrings(source, cursor);
        if (cursor >= source.length) break;

        if (!isIdentifierStart(source[cursor]!)) {
            cursor++;
            continue;
        }

        const identifierEnd = readIdentifierEnd(source, cursor);
        const identifier = source.slice(cursor, identifierEnd);
        if (identifier !== "UPROPERTY") {
            cursor = identifierEnd;
            continue;
        }

        const openParenthesis = skipWhitespace(source, identifierEnd);
        if (source[openParenthesis] !== "(") {
            cursor = identifierEnd;
            continue;
        }

        const annotationEnd = findMatchingParenthesis(source, openParenthesis);
        if (annotationEnd === undefined) break;

        const declarationStart = skipTrivia(source, annotationEnd + 1);
        const declarationEnd = findDeclarationSemicolon(source, declarationStart);
        if (declarationEnd === undefined) break;

        const declaration = parseDeclaration(source, declarationStart, declarationEnd + 1);
        if (declaration) declarations.push(declaration);
        cursor = declarationEnd + 1;
    }

    return declarations;
}

function parseDeclaration(source: string, start: number, end: number): UnrealPropertyDeclaration | undefined {
    const text = source.slice(start, end);
    const match = DECLARATION_PATTERN.exec(text);
    const typeText = match?.[1];
    const propertyName = match?.[2];
    if (!match || typeText === undefined || propertyName === undefined) return undefined;
    if (isCppKeyword(propertyName) || hasTopLevelParenthesis(typeText)) return undefined;

    const propertyOffset = match[0].indexOf(propertyName, typeText.length);
    const typeOffset = match[0].indexOf(typeText);
    if (propertyOffset < 0 || typeOffset < 0) return undefined;

    const typeNames: TextOffsetRange[] = [];
    let hasBuiltinType = false;
    for (const identifier of typeText.matchAll(IDENTIFIER_PATTERN)) {
        const name = identifier[0];
        const offset = identifier.index;
        if (BUILTIN_TYPE_KEYWORDS.has(name)) hasBuiltinType = true;
        if (offset === undefined || isCppKeyword(name)) continue;
        typeNames.push({
            start: start + typeOffset + offset,
            end: start + typeOffset + offset + name.length,
        });
    }
    if (typeNames.length === 0 && !hasBuiltinType) return undefined;

    const propertyStart = start + propertyOffset;
    return {
        typeNames,
        propertyName: { start: propertyStart, end: propertyStart + propertyName.length },
    };
}

function hasTopLevelParenthesis(typeText: string): boolean {
    let angleBracketDepth = 0;
    for (const character of typeText) {
        if (character === "<") angleBracketDepth++;
        else if (character === ">") angleBracketDepth = Math.max(0, angleBracketDepth - 1);
        else if ((character === "(" || character === ")") && angleBracketDepth === 0) return true;
    }
    return false;
}

function findSingleLineDeclarations(source: string): UnrealPropertyDeclaration[] {
    const masked = maskCommentsAndStrings(source);
    const declarations: UnrealPropertyDeclaration[] = [];
    let lineStart = 0;

    while (lineStart < masked.length) {
        const newline = masked.indexOf("\n", lineStart);
        const lineEnd = newline < 0 ? masked.length : newline;
        const line = masked.slice(lineStart, lineEnd);
        if (!line.trimStart().startsWith("#") && !line.includes("UPROPERTY")) {
            let statementStart = lineStart;
            let semicolon = masked.indexOf(";", statementStart);
            while (semicolon >= 0 && semicolon < lineEnd) {
                const declaration = parseDeclaration(masked, statementStart, semicolon + 1);
                if (declaration) declarations.push(declaration);
                statementStart = semicolon + 1;
                semicolon = masked.indexOf(";", statementStart);
            }
        }
        if (newline < 0) break;
        lineStart = newline + 1;
    }

    return declarations;
}

function maskCommentsAndStrings(source: string): string {
    const characters = source.split("");
    let cursor = 0;
    while (cursor < characters.length) {
        const character = source[cursor]!;
        if (character === '"' || character === "'") {
            const end = skipQuotedString(source, cursor, character);
            maskRange(characters, cursor, end);
            cursor = end;
            continue;
        }
        if (character === "/" && source[cursor + 1] === "/") {
            const end = skipLineComment(source, cursor);
            maskRange(characters, cursor, end);
            cursor = end;
            continue;
        }
        if (character === "/" && source[cursor + 1] === "*") {
            const end = skipBlockComment(source, cursor);
            maskRange(characters, cursor, end);
            cursor = end;
            continue;
        }
        cursor++;
    }
    return characters.join("");
}

function maskRange(characters: string[], start: number, end: number): void {
    for (let index = start; index < end; index++) {
        if (characters[index] !== "\n" && characters[index] !== "\r") characters[index] = " ";
    }
}

function findMatchingParenthesis(source: string, openParenthesis: number): number | undefined {
    let depth = 0;
    let cursor = openParenthesis;
    while (cursor < source.length) {
        const character = source[cursor]!;
        if (character === '"' || character === "'") {
            cursor = skipQuotedString(source, cursor, character);
            continue;
        }
        if (character === "/" && source[cursor + 1] === "/") {
            cursor = skipLineComment(source, cursor);
            continue;
        }
        if (character === "/" && source[cursor + 1] === "*") {
            cursor = skipBlockComment(source, cursor);
            continue;
        }
        if (character === "(") depth++;
        if (character === ")" && --depth === 0) return cursor;
        cursor++;
    }
    return undefined;
}

function findDeclarationSemicolon(source: string, start: number): number | undefined {
    let parenthesisDepth = 0;
    let bracketDepth = 0;
    let braceDepth = 0;
    let cursor = start;
    while (cursor < source.length) {
        const character = source[cursor]!;
        if (character === '"' || character === "'") {
            cursor = skipQuotedString(source, cursor, character);
            continue;
        }
        if (character === "/" && source[cursor + 1] === "/") {
            cursor = skipLineComment(source, cursor);
            continue;
        }
        if (character === "/" && source[cursor + 1] === "*") {
            cursor = skipBlockComment(source, cursor);
            continue;
        }

        if (character === "(") parenthesisDepth++;
        else if (character === ")") parenthesisDepth = Math.max(0, parenthesisDepth - 1);
        else if (character === "[") bracketDepth++;
        else if (character === "]") bracketDepth = Math.max(0, bracketDepth - 1);
        else if (character === "{") braceDepth++;
        else if (character === "}") braceDepth = Math.max(0, braceDepth - 1);
        else if (character === ";" && parenthesisDepth === 0 && bracketDepth === 0 && braceDepth === 0) return cursor;
        cursor++;
    }
    return undefined;
}

function skipTriviaAndStrings(source: string, start: number): number {
    let cursor = start;
    while (cursor < source.length) {
        const next = skipTrivia(source, cursor);
        if (next !== cursor) {
            cursor = next;
            continue;
        }
        const character = source[cursor];
        if (character === '"' || character === "'") {
            cursor = skipQuotedString(source, cursor, character);
            continue;
        }
        break;
    }
    return cursor;
}

function skipTrivia(source: string, start: number): number {
    let cursor = start;
    while (cursor < source.length) {
        const whitespaceEnd = skipWhitespace(source, cursor);
        if (whitespaceEnd !== cursor) {
            cursor = whitespaceEnd;
            continue;
        }
        if (source[cursor] === "/" && source[cursor + 1] === "/") {
            cursor = skipLineComment(source, cursor);
            continue;
        }
        if (source[cursor] === "/" && source[cursor + 1] === "*") {
            cursor = skipBlockComment(source, cursor);
            continue;
        }
        break;
    }
    return cursor;
}

function skipWhitespace(source: string, start: number): number {
    let cursor = start;
    while (cursor < source.length && /\s/.test(source[cursor]!)) cursor++;
    return cursor;
}

function skipLineComment(source: string, start: number): number {
    const newline = source.indexOf("\n", start + 2);
    return newline < 0 ? source.length : newline + 1;
}

function skipBlockComment(source: string, start: number): number {
    const end = source.indexOf("*/", start + 2);
    return end < 0 ? source.length : end + 2;
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

function readIdentifierEnd(source: string, start: number): number {
    let cursor = start + 1;
    while (cursor < source.length && /\w/.test(source[cursor]!)) cursor++;
    return cursor;
}

function isIdentifierStart(character: string): boolean {
    return /[A-Za-z_]/.test(character);
}
