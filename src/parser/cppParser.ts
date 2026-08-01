import { performance } from "node:perf_hooks";
import { Language, Parser, type Node as SyntaxNode, type Point } from "web-tree-sitter";

import type { CppSymbol, ParsedFile, SourcePosition, SourceRange, SymbolKind } from "../core/model.js";

const CONTAINER_TYPES = new Set([
    "class_specifier",
    "struct_specifier",
    "union_specifier",
    "enum_specifier",
    "namespace_definition",
]);
const DECLARATION_TYPES = new Set([
    "declaration",
    "field_declaration",
    "parameter_declaration",
    "optional_parameter_declaration",
]);
const IDENTIFIER_TYPES = new Set([
    "identifier",
    "field_identifier",
    "type_identifier",
    "namespace_identifier",
    "operator_name",
    "destructor_name",
]);
const UNREAL_ANNOTATION_MACROS = new Set([
    "UCLASS",
    "USTRUCT",
    "UENUM",
    "UINTERFACE",
    "UFUNCTION",
    "UPROPERTY",
    "UMETA",
    "GENERATED_BODY",
    "GENERATED_UCLASS_BODY",
    "GENERATED_USTRUCT_BODY",
    "GENERATED_IINTERFACE_BODY",
    "GENERATED_UINTERFACE_BODY",
]);

interface ScopeEntry {
    readonly name: string;
    readonly kind: SymbolKind;
}

export class CppParser {
    private static runtimeInitialization: Promise<void> | undefined;
    private readonly parser: Parser;

    private constructor(parser: Parser) {
        this.parser = parser;
    }

    static async create(
        runtimeWasmPath: string,
        cppWasmPath: string,
        report: (message: string) => void = () => undefined,
    ): Promise<CppParser> {
        report(`Initializing Tree-sitter runtime from ${runtimeWasmPath}.`);
        try {
            CppParser.runtimeInitialization ??= Parser.init({
                locateFile: () => runtimeWasmPath,
            });
            await CppParser.runtimeInitialization;
        } catch (error) {
            CppParser.runtimeInitialization = undefined;
            throw new Error("Tree-sitter runtime initialization failed.", { cause: error });
        }

        report(`Loading C++ grammar from ${cppWasmPath}.`);
        let language: Language;
        try {
            language = await Language.load(cppWasmPath);
        } catch (error) {
            throw new Error("Tree-sitter C++ grammar loading failed.", { cause: error });
        }

        report("Creating C++ parser instance.");
        try {
            const parser = new Parser();
            parser.setLanguage(language);
            return new CppParser(parser);
        } catch (error) {
            throw new Error("Tree-sitter C++ parser creation failed.", { cause: error });
        }
    }

    dispose(): void {
        this.parser.delete();
    }

    parse(uri: string, source: string): ParsedFile {
        const started = performance.now();
        this.parser.reset();
        const tree = this.parser.parse(maskUnrealAnnotations(source));
        if (!tree) {
            return {
                uri,
                symbols: [],
                parseErrors: 1,
                bytes: Buffer.byteLength(source),
                elapsedMs: performance.now() - started,
            };
        }

        try {
            const lines = source.split(/\r?\n/);
            const symbols: CppSymbol[] = [];
            this.visit(tree.rootNode, [], uri, lines, symbols);
            const parseErrors = tree.rootNode.descendantsOfType("ERROR").length;
            return {
                uri,
                symbols: deduplicateSymbols(symbols),
                parseErrors,
                bytes: Buffer.byteLength(source),
                elapsedMs: performance.now() - started,
            };
        } finally {
            tree.delete();
        }
    }

    private visit(
        node: SyntaxNode,
        scope: readonly ScopeEntry[],
        uri: string,
        lines: readonly string[],
        output: CppSymbol[],
    ): void {
        if (CONTAINER_TYPES.has(node.type)) {
            const entry = this.extractContainer(node, scope, uri, lines, output);
            const nextScope = entry ? [...scope, entry] : scope;
            for (const child of node.namedChildren) {
                this.visit(child, nextScope, uri, lines, output);
            }
            return;
        }

        if (node.type === "function_definition") {
            this.extractFunction(node, scope, uri, lines, output, true);
        } else if (DECLARATION_TYPES.has(node.type)) {
            this.extractDeclaration(node, scope, uri, lines, output);
        } else if (node.type === "enumerator") {
            this.extractEnumerator(node, scope, uri, lines, output);
        } else if (node.type === "alias_declaration" || node.type === "type_definition") {
            this.extractAlias(node, scope, uri, lines, output);
        } else if (node.type === "preproc_def" || node.type === "preproc_function_def") {
            this.extractMacro(node, scope, uri, lines, output);
        }

        for (const child of node.namedChildren) {
            this.visit(child, scope, uri, lines, output);
        }
    }

    private extractContainer(
        node: SyntaxNode,
        scope: readonly ScopeEntry[],
        uri: string,
        lines: readonly string[],
        output: CppSymbol[],
    ): ScopeEntry | undefined {
        const nameNode =
            node.childForFieldName("name") ??
            findFirstDescendant(node, new Set(["type_identifier", "namespace_identifier"]));
        if (!nameNode) {
            return undefined;
        }

        const name = finalQualifiedPart(nameNode.text);
        const kind = containerKind(node.type);
        const scopeNames = scope.map((item) => item.name);
        output.push({
            name,
            qualifiedName: qualify(scopeNames, name),
            kind,
            uri,
            range: nodeRange(node, lines),
            selectionRange: nodeRange(nameNode, lines),
            scope: scopeNames,
            container: scope.at(-1)?.name,
            signature: containerSignature(node),
            documentation: precedingDocumentation(lines, node.startPosition.row),
            isDefinition: Boolean(node.childForFieldName("body")),
            isLocal: false,
        });
        return { name, kind };
    }

    private extractFunction(
        node: SyntaxNode,
        scope: readonly ScopeEntry[],
        uri: string,
        lines: readonly string[],
        output: CppSymbol[],
        isDefinition: boolean,
        explicitDeclarator?: SyntaxNode,
    ): void {
        const declarator = explicitDeclarator ?? node.childForFieldName("declarator");
        if (!declarator) {
            return;
        }

        const functionDeclarator = findDeclaratorOfType(declarator, "function_declarator") ?? declarator;
        const nameNode = declaratorName(functionDeclarator);
        if (!nameNode) {
            return;
        }

        const rawName = declaratorQualifiedName(functionDeclarator) ?? nameNode.text.trim();
        const name = finalQualifiedPart(nameNode.text);
        if (!name || isControlKeyword(name)) {
            return;
        }

        const explicitQualifier = qualifierFromName(rawName);
        const lexicalContainer = nearestTypeScope(scope)?.name;
        const container = explicitQualifier ?? lexicalContainer;
        const kind = functionKind(name, container);
        const signature = functionSignature(node, declarator);
        const type = returnTypeFromSignature(signature, rawName);
        const scopeNames = scope.map((item) => item.name);
        output.push({
            name,
            qualifiedName: explicitQualifier ? `${explicitQualifier}::${name}` : qualify(scopeNames, name),
            kind,
            uri,
            range: nodeRange(node, lines),
            selectionRange: nodeRange(nameNode, lines),
            scope: scopeNames,
            container,
            type,
            signature,
            documentation: precedingDocumentation(lines, node.startPosition.row),
            isDefinition,
            isLocal: false,
        });
    }

    private extractDeclaration(
        node: SyntaxNode,
        scope: readonly ScopeEntry[],
        uri: string,
        lines: readonly string[],
        output: CppSymbol[],
    ): void {
        const declarators = node.childrenForFieldName("declarator");
        const candidates = declarators.length > 0 ? declarators : findDirectDeclarators(node);
        for (const declarator of candidates) {
            const functionDeclarator = findDeclaratorOfType(declarator, "function_declarator");
            if (functionDeclarator) {
                this.extractFunction(node, scope, uri, lines, output, hasFunctionBody(node), functionDeclarator);
                continue;
            }

            const nameNode = declaratorName(declarator);
            if (!nameNode) {
                continue;
            }

            const name = finalQualifiedPart(nameNode.text);
            if (!name || isControlKeyword(name)) {
                continue;
            }

            const typeNode = node.childForFieldName("type");
            const type = declarationType(node, declarator, typeNode);
            const typeScope = nearestTypeScope(scope);
            const isParameter = node.type.includes("parameter");
            const isField = node.type === "field_declaration" && Boolean(typeScope);
            const scopeNames = scope.map((item) => item.name);
            const visibilityNode = nearestFunctionNode(node);
            output.push({
                name,
                qualifiedName: qualify(scopeNames, name),
                kind: isParameter ? "parameter" : isField ? "field" : "variable",
                uri,
                range: nodeRange(node, lines),
                selectionRange: nodeRange(nameNode, lines),
                scope: scopeNames,
                container: typeScope?.name,
                type,
                signature: normalizeSignature(node.text),
                documentation: isField ? precedingDocumentation(lines, node.startPosition.row) : undefined,
                isDefinition: true,
                isLocal: isParameter || isInsideFunction(node),
                visibilityRange: visibilityNode ? nodeRange(visibilityNode, lines) : undefined,
            });
        }
    }

    private extractEnumerator(
        node: SyntaxNode,
        scope: readonly ScopeEntry[],
        uri: string,
        lines: readonly string[],
        output: CppSymbol[],
    ): void {
        const nameNode = node.childForFieldName("name") ?? node.firstNamedChild;
        if (!nameNode) {
            return;
        }
        const name = nameNode.text;
        const scopeNames = scope.map((item) => item.name);
        output.push({
            name,
            qualifiedName: qualify(scopeNames, name),
            kind: "enumMember",
            uri,
            range: nodeRange(node, lines),
            selectionRange: nodeRange(nameNode, lines),
            scope: scopeNames,
            container: scope.at(-1)?.name,
            signature: normalizeSignature(node.text),
            isDefinition: true,
            isLocal: false,
        });
    }

    private extractAlias(
        node: SyntaxNode,
        scope: readonly ScopeEntry[],
        uri: string,
        lines: readonly string[],
        output: CppSymbol[],
    ): void {
        const nameNode =
            node.childForFieldName("name") ?? findLastDescendant(node, new Set(["type_identifier", "identifier"]));
        if (!nameNode) {
            return;
        }
        const name = finalQualifiedPart(nameNode.text);
        const scopeNames = scope.map((item) => item.name);
        output.push({
            name,
            qualifiedName: qualify(scopeNames, name),
            kind: "typeAlias",
            uri,
            range: nodeRange(node, lines),
            selectionRange: nodeRange(nameNode, lines),
            scope: scopeNames,
            container: scope.at(-1)?.name,
            signature: normalizeSignature(node.text),
            documentation: precedingDocumentation(lines, node.startPosition.row),
            isDefinition: true,
            isLocal: isInsideFunction(node),
        });
    }

    private extractMacro(
        node: SyntaxNode,
        scope: readonly ScopeEntry[],
        uri: string,
        lines: readonly string[],
        output: CppSymbol[],
    ): void {
        const nameNode = node.childForFieldName("name") ?? findFirstDescendant(node, new Set(["identifier"]));
        if (!nameNode) {
            return;
        }
        const scopeNames = scope.map((item) => item.name);
        output.push({
            name: nameNode.text,
            qualifiedName: nameNode.text,
            kind: "macro",
            uri,
            range: nodeRange(node, lines),
            selectionRange: nodeRange(nameNode, lines),
            scope: scopeNames,
            signature: normalizeSignature(node.text),
            documentation: precedingDocumentation(lines, node.startPosition.row),
            isDefinition: true,
            isLocal: false,
        });
    }
}

function findDirectDeclarators(node: SyntaxNode): SyntaxNode[] {
    return node.namedChildren.filter((child) => child.type.endsWith("declarator") || child.type === "init_declarator");
}

function findDeclaratorOfType(node: SyntaxNode, type: string): SyntaxNode | undefined {
    if (node.type === type) {
        return node;
    }
    const nested = node.childForFieldName("declarator");
    if (nested) {
        const found = findDeclaratorOfType(nested, type);
        if (found) {
            return found;
        }
    }
    return node.namedChildren.map((child) => findDeclaratorOfType(child, type)).find(Boolean);
}

function declaratorName(node: SyntaxNode): SyntaxNode | undefined {
    if (IDENTIFIER_TYPES.has(node.type)) {
        return node;
    }

    if (node.type === "qualified_identifier") {
        const name = node.childForFieldName("name") ?? node.lastNamedChild;
        return name ? (declaratorName(name) ?? name) : undefined;
    }

    const nested = node.childForFieldName("declarator");
    if (nested) {
        const found = declaratorName(nested);
        if (found) {
            return found;
        }
    }

    for (const child of node.namedChildren) {
        const found = declaratorName(child);
        if (found) {
            return found;
        }
    }
    return undefined;
}

function declaratorQualifiedName(node: SyntaxNode): string | undefined {
    if (node.type === "qualified_identifier") return node.text.trim();
    if (IDENTIFIER_TYPES.has(node.type)) return node.text.trim();
    const nested = node.childForFieldName("declarator");
    if (nested) {
        const found = declaratorQualifiedName(nested);
        if (found) return found;
    }
    for (const child of node.namedChildren) {
        const found = declaratorQualifiedName(child);
        if (found) return found;
    }
    return undefined;
}

function findFirstDescendant(node: SyntaxNode, types: ReadonlySet<string>): SyntaxNode | undefined {
    if (types.has(node.type)) {
        return node;
    }
    for (const child of node.namedChildren) {
        const found = findFirstDescendant(child, types);
        if (found) {
            return found;
        }
    }
    return undefined;
}

function findLastDescendant(node: SyntaxNode, types: ReadonlySet<string>): SyntaxNode | undefined {
    for (const child of [...node.namedChildren].reverse()) {
        const found = findLastDescendant(child, types);
        if (found) {
            return found;
        }
    }
    return types.has(node.type) ? node : undefined;
}

function nearestTypeScope(scope: readonly ScopeEntry[]): ScopeEntry | undefined {
    return [...scope]
        .reverse()
        .find((entry) => entry.kind === "class" || entry.kind === "struct" || entry.kind === "union");
}

function containerKind(type: string): SymbolKind {
    if (type === "class_specifier") return "class";
    if (type === "struct_specifier") return "struct";
    if (type === "union_specifier") return "union";
    if (type === "enum_specifier") return "enum";
    return "namespace";
}

function functionKind(name: string, container: string | undefined): SymbolKind {
    if (container && name === finalQualifiedPart(container)) return "constructor";
    if (container && name === `~${finalQualifiedPart(container)}`) return "destructor";
    return container ? "method" : "function";
}

function qualify(scope: readonly string[], name: string): string {
    return [...scope, name].filter(Boolean).join("::");
}

function qualifierFromName(name: string): string | undefined {
    const parts = name.split("::");
    return parts.length > 1 ? parts.slice(0, -1).join("::") : undefined;
}

function finalQualifiedPart(name: string): string {
    return name.trim().split("::").at(-1)?.trim() ?? name.trim();
}

function isControlKeyword(name: string): boolean {
    return new Set([
        "if",
        "for",
        "while",
        "switch",
        "catch",
        "return",
        "sizeof",
        "alignof",
        "decltype",
        "static_assert",
    ]).has(name);
}

function hasFunctionBody(node: SyntaxNode): boolean {
    return Boolean(node.childForFieldName("body")) || node.type === "function_definition";
}

function isInsideFunction(node: SyntaxNode): boolean {
    return Boolean(nearestFunctionNode(node));
}

function nearestFunctionNode(node: SyntaxNode): SyntaxNode | undefined {
    for (let parent = node.parent; parent; parent = parent.parent) {
        if (parent.type === "function_definition" || parent.type === "lambda_expression") return parent;
    }
    return undefined;
}

function functionSignature(node: SyntaxNode, declarator: SyntaxNode): string {
    const body = node.childForFieldName("body");
    if (body) {
        const prefixLength = Math.max(0, body.startIndex - node.startIndex);
        return normalizeSignature(Buffer.from(node.text).subarray(0, prefixLength).toString("utf8"));
    }
    if (node.type === "function_definition") {
        return normalizeSignature(declarator.text);
    }
    return normalizeSignature(node.text.replace(/;\s*$/, ""));
}

function returnTypeFromSignature(signature: string, rawName: string): string | undefined {
    const nameIndex = signature.indexOf(rawName);
    if (nameIndex <= 0) {
        return undefined;
    }
    const prefix = signature
        .slice(0, nameIndex)
        .replace(/\b(?:virtual|static|inline|constexpr|consteval|constinit|explicit|friend|extern)\b/g, " ")
        .replace(/\b[A-Z][A-Z0-9_]*_API\b/g, " ")
        .replace(/\s+/g, " ")
        .trim();
    return prefix || undefined;
}

function declarationType(node: SyntaxNode, declarator: SyntaxNode, typeNode: SyntaxNode | null): string | undefined {
    const base = typeNode?.text.trim();
    const declaratorText = declarator.text;
    const nameNode = declaratorName(declarator);
    if (!nameNode) return base;
    const nameIndex = declaratorText.lastIndexOf(nameNode.text);
    const modifiers = nameIndex > 0 ? declaratorText.slice(0, nameIndex).trim() : "";
    const combined = [base, modifiers].filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
    return combined || undefined;
}

function containerSignature(node: SyntaxNode): string {
    const body = node.childForFieldName("body");
    if (!body) return normalizeSignature(node.text);
    const prefixLength = Math.max(0, body.startIndex - node.startIndex);
    return normalizeSignature(Buffer.from(node.text).subarray(0, prefixLength).toString("utf8"));
}

function normalizeSignature(text: string): string {
    return text
        .replace(/\/\*[\s\S]*?\*\//g, " ")
        .replace(/\/\/.*$/gm, " ")
        .replace(/\s+/g, " ")
        .trim();
}

function precedingDocumentation(lines: readonly string[], declarationLine: number): string | undefined {
    let line = declarationLine - 1;
    while (line >= 0 && lines[line]?.trim() === "") line--;
    while (line >= 0 && /^(?:UCLASS|USTRUCT|UENUM|UFUNCTION|UPROPERTY)\b/.test(lines[line]?.trim() ?? "")) line--;
    if (line < 0) return undefined;

    const current = lines[line]?.trim() ?? "";
    if (current.startsWith("//")) {
        const collected: string[] = [];
        while (line >= 0 && (lines[line]?.trim() ?? "").startsWith("//")) {
            collected.unshift((lines[line]?.trim() ?? "").replace(/^\/\/\/?\s?/, ""));
            line--;
        }
        return collected.join("\n").trim() || undefined;
    }

    if (current.endsWith("*/")) {
        const collected: string[] = [];
        while (line >= 0) {
            const value = lines[line] ?? "";
            collected.unshift(value);
            if (value.includes("/*")) break;
            line--;
        }
        const cleaned = collected
            .join("\n")
            .replace(/^\s*\/\*\*?/, "")
            .replace(/\*\/\s*$/, "")
            .split("\n")
            .map((value) => value.replace(/^\s*\*\s?/, ""))
            .join("\n")
            .trim();
        return cleaned || undefined;
    }
    return undefined;
}

function nodeRange(node: SyntaxNode, lines: readonly string[]): SourceRange {
    return {
        start: pointToPosition(node.startPosition, lines),
        end: pointToPosition(node.endPosition, lines),
    };
}

function pointToPosition(point: Point, lines: readonly string[]): SourcePosition {
    const line = lines[point.row] ?? "";
    const character = Buffer.from(line, "utf8").subarray(0, point.column).toString("utf8").length;
    return { line: point.row, character };
}

function deduplicateSymbols(symbols: readonly CppSymbol[]): CppSymbol[] {
    const seen = new Set<string>();
    return symbols.filter((symbol) => {
        const key = `${symbol.kind}:${symbol.qualifiedName}:${symbol.selectionRange.start.line}:${symbol.selectionRange.start.character}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

/**
 * Tree-sitter intentionally does not run the preprocessor. UE's reflection and
 * module-export macros can therefore make otherwise ordinary declarations look
 * malformed. Blank only those annotations, preserving every byte and newline so
 * all syntax-tree locations still map exactly to the original document.
 */
function maskUnrealAnnotations(source: string): string {
    const characters = source.split("");
    const apiPattern = /\b[A-Z][A-Z0-9_]*_API\b/g;
    for (const match of source.matchAll(apiPattern)) {
        blankRange(characters, match.index, match.index + match[0].length);
    }

    const macroPattern =
        /\b(?:UCLASS|USTRUCT|UENUM|UINTERFACE|UFUNCTION|UPROPERTY|UMETA|GENERATED_BODY|GENERATED_UCLASS_BODY|GENERATED_USTRUCT_BODY|GENERATED_IINTERFACE_BODY|GENERATED_UINTERFACE_BODY)\b/g;
    for (const match of source.matchAll(macroPattern)) {
        if (!UNREAL_ANNOTATION_MACROS.has(match[0])) continue;
        let end = match.index + match[0].length;
        while (end < source.length && /[ \t]/.test(source[end] ?? "")) end++;
        if (source[end] === "(") end = balancedCallEnd(source, end);
        blankRange(characters, match.index, end);
    }
    return characters.join("");
}

function balancedCallEnd(source: string, openingParenthesis: number): number {
    let depth = 0;
    for (let index = openingParenthesis; index < source.length; index++) {
        const character = source[index];
        if (character === "(") depth++;
        else if (character === ")" && --depth === 0) return index + 1;
    }
    return openingParenthesis;
}

function blankRange(characters: string[], start: number, end: number): void {
    for (let index = start; index < end; index++) {
        if (characters[index] !== "\n" && characters[index] !== "\r") characters[index] = " ";
    }
}
