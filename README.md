# uevsc

A lightweight, syntax-only VS Code extension for reviewing Unreal Engine C++ projects.

It indexes C/C++ source files in memory and provides:

- hover cards with signatures, symbol kind, source location, and nearby documentation;
- Unreal-aware syntax highlighting for module export macros such as `MYGAME_API` and reflected `UPROPERTY` field declarations;
- highlighted popular Unreal constants with static type, value, and usage descriptions on hover;
- Ctrl+click / **Go to Definition** for classes, structs, enums, functions, methods, fields, variables, aliases, enum values, and macros;
- receiver-aware member lookup, so `Spells->GetPreparedSpellId()` prefers members of the type declared for `Spells`;
- lexical scope-aware lookup for locals, parameters, nested blocks, and shadowed names;
- automatic updates when files are edited, created, changed, or deleted;
- tolerant parsing of incomplete code and common Unreal annotations such as `UCLASS`, `UPROPERTY`, `UFUNCTION`, `GENERATED_BODY`, and module `_API` macros.

The extension does **not** compile code, invoke Unreal Engine, expand macros, read generated project metadata, or claim semantic correctness. It is intentionally an information and navigation aid for manual code review.

## Install locally

Prerequisites: Node.js and VS Code's `code` command on `PATH`.

```powershell
npm install
npm run package
code --install-extension .\uevsc-0.1.1.vsix --force
```

Then open the Unreal project (or a parent folder containing its `Source` and `Plugins` directories) in VS Code. Opening any C++ file activates the extension and builds the index. Reload VS Code after replacing an already-installed build.

The packaged VSIX is self-contained. It does not require `node_modules`, Visual Studio, Unreal Engine, a compiler, or a language server at runtime.

## Use

- Hover an identifier to see the best matching declarations/definitions.
- Hold Ctrl and click an identifier, or run **Go to Definition**.
- Run **uevsc: Rebuild Symbol Index** after a large external change.
- Run **uevsc: Show Index Statistics** to inspect indexed file/symbol counts.
- Open **Output → uevsc** for indexing errors and optional trace output.

The output channel records the extension, VS Code, Node, platform, WASM paths and sizes, parser initialization stages, and full source-mapped stack traces for startup failures.

For `Spells->GetPreparedSpellId()`, the extension finds the nearest declaration of `Spells`, reads its syntax-level type, and prefers `GetPreparedSpellId` symbols belonging to that class. It also understands direct type qualifiers such as `UMyGameSpellComponent::PrepareSpell` and simple call chains such as `GetControlledSpellComponent()->PrepareSpell` when the called function's return type is indexed.

## Settings

| Setting                              | Default                                    | Purpose                                                 |
| ------------------------------------ | ------------------------------------------ | ------------------------------------------------------- |
| `uevsc.enabled`                      | `true`                                     | Enables indexing and providers.                         |
| `uevsc.syntaxHighlighting.enabled`   | `true`                                     | Applies explicit Unreal type and variable colors.       |
| `uevsc.include`                      | `**/*.{h,hh,hpp,hxx,c,cc,cpp,cxx,inl,ipp}` | Workspace files to index.                               |
| `uevsc.exclude`                      | Unreal build/generated directories         | Files omitted from initial indexing.                    |
| `uevsc.maxFileSizeKb`                | `1024`                                     | Skips unusually large source files.                     |
| `uevsc.showMissingDefinitionMessage` | `true`                                     | Shows a short status message for unresolved navigation. |
| `uevsc.trace`                        | `false`                                    | Logs per-file parsing details to the output channel.    |

`Binaries`, `Build`, `DerivedDataCache`, `Intermediate`, `Saved`, `.git`, and `node_modules` are always ignored by live file watching.

The Unreal declaration and constant colors can be customized through `workbench.colorCustomizations` using `uevsc.unrealTypeForeground`, `uevsc.unrealPropertyForeground`, and `uevsc.unrealConstantForeground`.

## Accuracy and limitations

This extension parses syntax, not the compiled C++ program. It deliberately does not know build flags, include paths, generated headers, macro expansions, overload viability, templates after instantiation, inheritance conversions, or runtime types.

Resolution uses useful, deterministic hints:

1. the nearest visible local variable or parameter, respecting declaration order and nested block boundaries;
2. explicit type qualifiers;
3. local variables, parameters, and fields used as `object.member` or `pointer->member` receivers;
4. simple function-return receiver types;
5. members of the containing class;
6. the current file and whether a candidate is a definition rather than only a declaration.

When several candidates remain plausible, VS Code receives the ordered list instead of a fabricated single answer. When none exist, the extension reports that it could not find a definition.

## Development

```powershell
npm run check
npm test
npm run test:bundle
npm run build
npm run package
```

The implementation is split into independent layers:

- `src/parser`: tolerant Tree-sitter C++ symbol extraction and UE annotation masking;
- `src/index`: in-memory per-file storage and syntax-level resolution;
- `src/language`: shared C/C++ language facts used by editor features;
- `src/vscode`: editor adapters and hover/definition providers;
- `syntaxes`: Unreal-specific TextMate injection rules layered onto VS Code's C++ grammar;
- `src/extension.ts`: activation, commands, configuration, and lifecycle.

The parser and resolver have no dependency on the VS Code API, which keeps them directly testable and provides a clean base for future include graphs, inheritance lookup, incremental syntax trees, workspace persistence, references, and outline features.
