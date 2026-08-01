import * as path from "node:path";
import * as vscode from "vscode";
import { minimatch } from "minimatch";

import type { CppParser } from "../parser/cppParser.js";
import type { SymbolIndex } from "./symbolIndex.js";

const SOURCE_EXTENSIONS = new Set([".h", ".hh", ".hpp", ".hxx", ".c", ".cc", ".cpp", ".cxx", ".inl", ".ipp"]);
const ALWAYS_IGNORED_SEGMENTS = new Set([".git", "binaries", "build", "deriveddatacache", "intermediate", "saved", "node_modules"]);

export class WorkspaceIndexer implements vscode.Disposable {
  private readonly disposables: vscode.Disposable[] = [];
  private readonly timers = new Map<string, NodeJS.Timeout>();
  private generation = 0;
  private disposed = false;

  constructor(
    private readonly parser: CppParser,
    private readonly index: SymbolIndex,
    private readonly output: vscode.OutputChannel,
  ) {
    const watcher = vscode.workspace.createFileSystemWatcher("**/*.{h,hh,hpp,hxx,c,cc,cpp,cxx,inl,ipp}");
    this.disposables.push(
      watcher,
      watcher.onDidCreate((uri) => this.schedule(uri)),
      watcher.onDidChange((uri) => this.schedule(uri)),
      watcher.onDidDelete((uri) => this.index.removeFile(uri.toString())),
      vscode.workspace.onDidChangeTextDocument((event) => {
        if (isCppDocument(event.document)) this.schedule(event.document.uri, event.document);
      }),
      vscode.workspace.onDidCloseTextDocument((document) => {
        if (isCppDocument(document)) this.schedule(document.uri);
      }),
    );
  }

  async rebuild(): Promise<void> {
    const currentGeneration = ++this.generation;
    this.index.clear();
    const configuration = vscode.workspace.getConfiguration("uevsc");
    if (!configuration.get("enabled", true)) {
      this.output.appendLine("Indexing is disabled by configuration.");
      return;
    }

    const includes = configuration.get<string[]>("include", ["**/*.{h,hh,hpp,hxx,c,cc,cpp,cxx,inl,ipp}"]);
    const exclude = configuration.get<string>("exclude", "**/{Binaries,Build,DerivedDataCache,Intermediate,Saved,.git,node_modules}/**");
    const groups = await Promise.all(includes.map((include) => vscode.workspace.findFiles(include, exclude)));
    const uris = [...new Map(groups.flat().filter(isSupportedUri).map((uri) => [uri.toString(), uri])).values()];

    const started = performance.now();
    this.output.appendLine(`Indexing ${uris.length} C/C++ files...`);
    await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Window, title: "uevsc: indexing", cancellable: false },
      async (progress) => {
        for (let index = 0; index < uris.length; index++) {
          if (this.disposed || currentGeneration !== this.generation) return;
          const uri = uris[index];
          if (!uri) continue;
          await this.indexUri(uri);
          if (index % 10 === 0 || index === uris.length - 1) {
            progress.report({ message: `${index + 1}/${uris.length}` });
            await yieldToEventLoop();
          }
        }
      },
    );

    if (currentGeneration !== this.generation) return;
    const stats = this.index.getStats();
    this.output.appendLine(
      `Indexed ${stats.files} files and ${stats.symbols} symbols in ${(performance.now() - started).toFixed(0)} ms (${stats.parseErrors} recovered syntax errors).`,
    );
  }

  async indexUri(uri: vscode.Uri, document?: vscode.TextDocument): Promise<void> {
    if (!isSupportedUri(uri) || isAlwaysIgnored(uri) || !matchesConfiguration(uri)) {
      this.index.removeFile(uri.toString());
      return;
    }

    try {
      const maxBytes = vscode.workspace.getConfiguration("uevsc", uri).get("maxFileSizeKb", 1024) * 1024;
      let source: string;
      const openDocument = document ?? vscode.workspace.textDocuments.find((item) => item.uri.toString() === uri.toString());
      if (openDocument) {
        source = openDocument.getText();
        if (Buffer.byteLength(source) > maxBytes) {
          this.index.removeFile(uri.toString());
          return;
        }
      } else {
        const stat = await vscode.workspace.fs.stat(uri);
        if (stat.size > maxBytes) {
          this.index.removeFile(uri.toString());
          this.trace(`Skipped oversized file: ${uri.fsPath}`);
          return;
        }
        source = Buffer.from(await vscode.workspace.fs.readFile(uri)).toString("utf8");
      }

      const parsed = this.parser.parse(uri.toString(), source);
      this.index.replaceFile(parsed);
      this.trace(`Indexed ${uri.fsPath}: ${parsed.symbols.length} symbols, ${parsed.parseErrors} errors, ${parsed.elapsedMs.toFixed(1)} ms`);
    } catch (error) {
      this.output.appendLine(`Failed to index ${uri.fsPath}: ${errorMessage(error)}`);
    }
  }

  dispose(): void {
    this.disposed = true;
    this.generation++;
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
    for (const disposable of this.disposables) disposable.dispose();
  }

  private schedule(uri: vscode.Uri, document?: vscode.TextDocument): void {
    const key = uri.toString();
    const existing = this.timers.get(key);
    if (existing) clearTimeout(existing);
    this.timers.set(
      key,
      setTimeout(() => {
        this.timers.delete(key);
        void this.indexUri(uri, document);
      }, 300),
    );
  }

  private trace(message: string): void {
    if (vscode.workspace.getConfiguration("uevsc").get("trace", false)) this.output.appendLine(message);
  }
}

function isCppDocument(document: vscode.TextDocument): boolean {
  return (document.languageId === "cpp" || document.languageId === "c") && isSupportedUri(document.uri);
}

function isSupportedUri(uri: vscode.Uri): boolean {
  return uri.scheme === "file" && SOURCE_EXTENSIONS.has(path.extname(uri.fsPath).toLowerCase());
}

function isAlwaysIgnored(uri: vscode.Uri): boolean {
  return uri.fsPath.split(/[\\/]/).some((segment) => ALWAYS_IGNORED_SEGMENTS.has(segment.toLowerCase()));
}

function matchesConfiguration(uri: vscode.Uri): boolean {
  const folder = vscode.workspace.getWorkspaceFolder(uri);
  if (!folder) return false;
  const relative = path.relative(folder.uri.fsPath, uri.fsPath).replaceAll("\\", "/");
  const configuration = vscode.workspace.getConfiguration("uevsc", uri);
  const includes = configuration.get<string[]>("include", ["**/*.{h,hh,hpp,hxx,c,cc,cpp,cxx,inl,ipp}"]);
  const exclude = configuration.get<string>("exclude", "**/{Binaries,Build,DerivedDataCache,Intermediate,Saved,.git,node_modules}/**");
  const options = { dot: true, nocase: process.platform === "win32" };
  return includes.some((pattern) => minimatch(relative, pattern, options)) && !minimatch(relative, exclude, options);
}

function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
