import type { SymbolKind } from "../core/model.js";
import type { UnrealConstantInfo } from "../language/unrealConstants.js";

export interface HoverSourceLink {
    readonly fileName: string;
    readonly line: number;
    readonly target: string;
}

export function formatHoverSource(kind: SymbolKind, source: HoverSourceLink): string {
    const label = `(${source.fileName}:${source.line})`;
    return `${escapeMarkdown(kind)} · [${escapeMarkdown(label)}](${source.target})`;
}

export function formatUnrealConstantDetails(constant: UnrealConstantInfo): string {
    const preferred = constant.preferredReplacement
        ? `\n\n**Preferred:** \`${escapeInlineCode(constant.preferredReplacement)}\``
        : "";
    return `${escapeMarkdown(constant.description)}\n\n**Type:** \`${escapeInlineCode(constant.type)}\`\n\n**Value:** \`${escapeInlineCode(constant.value)}\`${preferred}`;
}

export function escapeMarkdown(value: string): string {
    return value.replace(/[\\`*_{}\[\]()<>#+\-.!|]/g, "\\$&");
}

function escapeInlineCode(value: string): string {
    return value.replaceAll("`", "\\`");
}
