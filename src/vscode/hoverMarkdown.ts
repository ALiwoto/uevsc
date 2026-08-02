import type { SymbolKind } from "../core/model.js";

export interface HoverSourceLink {
    readonly fileName: string;
    readonly line: number;
    readonly target: string;
}

export function formatHoverSource(kind: SymbolKind, source: HoverSourceLink): string {
    const label = `(${source.fileName}:${source.line})`;
    return `${escapeMarkdown(kind)} · [${escapeMarkdown(label)}](${source.target})`;
}

export function escapeMarkdown(value: string): string {
    return value.replace(/[\\`*_{}\[\]()<>#+\-.!|]/g, "\\$&");
}
