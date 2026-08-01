import type { CppSymbol, ParsedFile, SourcePosition } from "../core/model.js";
import { shortTypeName } from "../core/model.js";

export interface ResolutionContext {
    readonly uri: string;
    readonly position: SourcePosition;
    readonly word: string;
    readonly linePrefix: string;
}

export interface ResolutionResult {
    readonly symbols: readonly CppSymbol[];
    readonly receiverType?: string;
    readonly qualifier?: string;
}

export interface IndexStats {
    readonly files: number;
    readonly symbols: number;
    readonly parseErrors: number;
    readonly bytes: number;
    readonly elapsedMs: number;
}

export class SymbolIndex {
    private readonly files = new Map<string, ParsedFile>();
    private readonly symbolsByName = new Map<string, CppSymbol[]>();

    clear(): void {
        this.files.clear();
        this.symbolsByName.clear();
    }

    replaceFile(parsed: ParsedFile): void {
        this.removeFile(parsed.uri);
        this.files.set(parsed.uri, parsed);
        for (const symbol of parsed.symbols) {
            const existing = this.symbolsByName.get(symbol.name);
            if (existing) existing.push(symbol);
            else this.symbolsByName.set(symbol.name, [symbol]);
        }
    }

    removeFile(uri: string): void {
        const previous = this.files.get(uri);
        if (!previous) return;
        this.files.delete(uri);
        for (const symbol of previous.symbols) {
            const bucket = this.symbolsByName.get(symbol.name);
            if (!bucket) continue;
            const filtered = bucket.filter((candidate) => candidate.uri !== uri);
            if (filtered.length > 0) this.symbolsByName.set(symbol.name, filtered);
            else this.symbolsByName.delete(symbol.name);
        }
    }

    resolve(context: ResolutionContext): ResolutionResult {
        const candidates = this.symbolsByName.get(context.word) ?? [];
        if (candidates.length === 0) return { symbols: [] };

        const qualifier = extractQualifier(context.linePrefix);
        const receiverName = extractReceiver(context.linePrefix);
        const receiverCall = extractReceiverCall(context.linePrefix);
        const containingType = this.findContainingTypeName(context.uri, context.position);
        const receiverType =
            qualifier ??
            this.resolveReceiverType(context.uri, context.position, receiverName, receiverCall, containingType);

        if (!qualifier && !receiverName && !receiverCall) {
            const locals = nearestVisibleLocals(candidates, context);
            if (locals.length > 0) {
                return { symbols: locals };
            }
        }

        let eligible = candidates.filter(
            (symbol) =>
                !symbol.isLocal ||
                (symbol.uri === context.uri &&
                    Boolean(symbol.visibilityRange) &&
                    contains(symbol.visibilityRange!, context.position)),
        );
        if (receiverType) {
            const exactMembers = eligible.filter((symbol) => typeMatches(symbol.container, receiverType));
            if (exactMembers.length > 0) eligible = exactMembers;
        } else if (containingType && !qualifier) {
            const classMembers = eligible.filter(
                (symbol) => !symbol.isLocal && typeMatches(symbol.container, containingType),
            );
            if (classMembers.length > 0) eligible = classMembers;
        }

        const scored = eligible
            .map((symbol) => ({ symbol, score: scoreSymbol(symbol, context, receiverType, qualifier, containingType) }))
            .sort((left, right) => right.score - left.score || compareSymbol(left.symbol, right.symbol));

        if (scored.length === 0) return { symbols: [], receiverType, qualifier };
        const highest = scored[0]?.score ?? 0;
        const selected = scored
            .filter((item, index) => index < 20 && (item.score >= highest - 20 || !receiverType))
            .map((item) => item.symbol);
        return { symbols: selected, receiverType, qualifier };
    }

    getFile(uri: string): ParsedFile | undefined {
        return this.files.get(uri);
    }

    getStats(): IndexStats {
        let symbols = 0;
        let parseErrors = 0;
        let bytes = 0;
        let elapsedMs = 0;
        for (const file of this.files.values()) {
            symbols += file.symbols.length;
            parseErrors += file.parseErrors;
            bytes += file.bytes;
            elapsedMs += file.elapsedMs;
        }
        return { files: this.files.size, symbols, parseErrors, bytes, elapsedMs };
    }

    private resolveReceiverType(
        uri: string,
        position: SourcePosition,
        receiverName: string | undefined,
        receiverCall: string | undefined,
        containingType: string | undefined,
    ): string | undefined {
        if (receiverCall) {
            const functions = this.symbolsByName.get(receiverCall) ?? [];
            const best = functions
                .filter(
                    (symbol) =>
                        !symbol.isLocal &&
                        (!containingType || !symbol.container || typeMatches(symbol.container, containingType)),
                )
                .sort((left, right) => Number(Boolean(right.isDefinition)) - Number(Boolean(left.isDefinition)))[0];
            const callType = shortTypeName(best?.type);
            if (callType) return callType;
        }

        if (!receiverName) return undefined;
        if (receiverName === "this") return containingType;

        const file = this.files.get(uri);
        if (!file) return undefined;
        const variable = file.symbols
            .filter(
                (symbol) =>
                    symbol.name === receiverName &&
                    isBeforeOrAt(symbol.selectionRange.start, position) &&
                    (!symbol.isLocal ||
                        (Boolean(symbol.visibilityRange) && contains(symbol.visibilityRange!, position))),
            )
            .sort((left, right) => comparePosition(right.selectionRange.start, left.selectionRange.start))[0];
        const localType = shortTypeName(variable?.type);
        if (localType) return localType;

        const field = (this.symbolsByName.get(receiverName) ?? []).find(
            (symbol) => symbol.kind === "field" && containingType && typeMatches(symbol.container, containingType),
        );
        return shortTypeName(field?.type);
    }

    private findContainingTypeName(uri: string, position: SourcePosition): string | undefined {
        const file = this.files.get(uri);
        if (!file) return undefined;
        const enclosing = file.symbols
            .filter(
                (symbol) =>
                    (symbol.kind === "class" || symbol.kind === "struct" || symbol.kind === "union") &&
                    contains(symbol.range, position),
            )
            .sort((left, right) => comparePosition(right.range.start, left.range.start))[0];
        if (enclosing) return enclosing.name;

        return file.symbols
            .filter((symbol) => Boolean(symbol.container) && contains(symbol.range, position))
            .sort((left, right) => comparePosition(right.range.start, left.range.start))[0]?.container;
    }
}

function extractReceiver(prefix: string): string | undefined {
    return prefix.match(/([A-Za-z_]\w*)\s*(?:->|\.)\s*$/)?.[1];
}

function extractReceiverCall(prefix: string): string | undefined {
    return prefix.match(/([A-Za-z_]\w*)\s*\([^;{}]*\)\s*(?:->|\.)\s*$/)?.[1];
}

function extractQualifier(prefix: string): string | undefined {
    const match = prefix.match(/((?:[A-Za-z_]\w*::)*[A-Za-z_]\w*)::\s*$/);
    return match?.[1]?.split("::").at(-1);
}

function nearestVisibleLocals(candidates: readonly CppSymbol[], context: ResolutionContext): readonly CppSymbol[] {
    const locals = candidates
        .filter(
            (symbol) =>
                symbol.isLocal &&
                symbol.uri === context.uri &&
                Boolean(symbol.visibilityRange) &&
                contains(symbol.visibilityRange!, context.position) &&
                isBeforeOrAt(symbol.selectionRange.start, context.position),
        )
        .sort(compareLocalPrecedence);
    const best = locals[0];
    if (!best) return [];

    return locals.filter(
        (symbol) =>
            comparePosition(symbol.selectionRange.start, best.selectionRange.start) === 0 &&
            compareRange(symbol.visibilityRange!, best.visibilityRange!) === 0,
    );
}

function compareLocalPrecedence(left: CppSymbol, right: CppSymbol): number {
    const scopeSizeDifference = rangeSize(left.visibilityRange!) - rangeSize(right.visibilityRange!);
    if (scopeSizeDifference !== 0) return scopeSizeDifference;
    return comparePosition(right.selectionRange.start, left.selectionRange.start);
}

function rangeSize(range: { start: SourcePosition; end: SourcePosition }): number {
    return (range.end.line - range.start.line) * 1_000_000 + range.end.character - range.start.character;
}

function compareRange(
    left: { start: SourcePosition; end: SourcePosition },
    right: { start: SourcePosition; end: SourcePosition },
): number {
    return comparePosition(left.start, right.start) || comparePosition(left.end, right.end);
}

function scoreSymbol(
    symbol: CppSymbol,
    context: ResolutionContext,
    receiverType: string | undefined,
    qualifier: string | undefined,
    containingType: string | undefined,
): number {
    let score = 0;
    if (receiverType && typeMatches(symbol.container, receiverType)) score += 300;
    if (qualifier && typeMatches(symbol.container, qualifier)) score += 300;
    if (!receiverType && containingType && typeMatches(symbol.container, containingType)) score += 100;
    if (symbol.uri === context.uri) score += 25;
    if (symbol.isDefinition) score += 18;
    if (!symbol.isLocal) score += 5;
    if (
        symbol.kind === "method" ||
        symbol.kind === "function" ||
        symbol.kind === "constructor" ||
        symbol.kind === "destructor"
    )
        score += 4;
    return score;
}

function typeMatches(container: string | undefined, expected: string): boolean {
    if (!container) return false;
    return shortTypeName(container) === shortTypeName(expected);
}

function compareSymbol(left: CppSymbol, right: CppSymbol): number {
    return (
        left.qualifiedName.localeCompare(right.qualifiedName) ||
        left.uri.localeCompare(right.uri) ||
        comparePosition(left.selectionRange.start, right.selectionRange.start)
    );
}

function contains(range: { start: SourcePosition; end: SourcePosition }, position: SourcePosition): boolean {
    return comparePosition(range.start, position) <= 0 && comparePosition(position, range.end) <= 0;
}

function isBeforeOrAt(left: SourcePosition, right: SourcePosition): boolean {
    return comparePosition(left, right) <= 0;
}

function comparePosition(left: SourcePosition, right: SourcePosition): number {
    return left.line - right.line || left.character - right.character;
}
