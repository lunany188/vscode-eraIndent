/**
 * These codes are licensed under CC0.
 * http://creativecommons.org/publicdomain/zero/1.0/deed.ja
 */

// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from "vscode";
import * as indentor from "./indenter";

export class EraIndentProvider
  implements
    vscode.DocumentFormattingEditProvider,
    vscode.DocumentRangeFormattingEditProvider,
    vscode.OnTypeFormattingEditProvider {
  private diagonostics: vscode.DiagnosticCollection;
  constructor(diagnostics: vscode.DiagnosticCollection) {
    this.diagonostics = diagnostics;
  }
  public provideDocumentFormattingEdits(
    document: vscode.TextDocument,
    options: vscode.FormattingOptions,
    token: vscode.CancellationToken
  ): vscode.ProviderResult<vscode.TextEdit[]> {
    const indenter = new indentor.EraIndenter(options);
    return this.innnerFormat(
      document,
      document.lineAt(document.lineCount - 1).range.end.line,
      indenter
    );
  }
  provideDocumentRangeFormattingEdits(
    document: vscode.TextDocument,
    range: vscode.Range,
    options: vscode.FormattingOptions,
    token: vscode.CancellationToken
  ): vscode.ProviderResult<vscode.TextEdit[]> {
    const indenter = new indentor.EraIndenter(options);
    const endline = range.end.line;
    return this.innnerFormat(document, endline, indenter);
  }
  provideOnTypeFormattingEdits(
    document: vscode.TextDocument,
    position: vscode.Position,
    ch: string,
    options: vscode.FormattingOptions,
    token: vscode.CancellationToken
  ): vscode.ProviderResult<vscode.TextEdit[]> {
    const indenter = new indentor.EraIndenter(options);
    const result = this.innnerFormat(document, position.line + 1, indenter);
    if (ch === "\n") {
      const newLine = indenter.newLine;
      if (newLine !== null) {
        const range = new vscode.Range(position, position);
        result.push(vscode.TextEdit.replace(range, "" + newLine[0]));
        newLine[1].forEach((ns) =>
          result.push(
            vscode.TextEdit.replace(
              document.lineAt(ns.lineNumber).range,
              ns.text
            )
          )
        );
      }
    }
    return result;
  }

  private innnerFormat(
    doc: vscode.TextDocument,
    endline: number,
    indenter: indentor.EraIndenter
  ): vscode.TextEdit[] {
    const ret: vscode.TextEdit[] = [];
    const diags = this.diagonostics.get(doc.uri);
    let nextDiags: vscode.Diagnostic[];
    if (diags !== undefined) {
      nextDiags = diags.filter((value) => value.range.end.line > endline);
    } else {
      nextDiags = [];
    }
    for (let lineNo = 0; lineNo < endline; lineNo++) {
      const line: vscode.TextLine = doc.lineAt(lineNo);
      const result = indenter.update(line);
      // 仮 エラーが起きても次の行を読めるようにうまいことやる
      if (indentor.isEraIndenterError(result)) {
        const newDiagnostic = new vscode.Diagnostic(
          doc.lineAt(result.lineNumber).range,
          result.message
        );
        nextDiags.push(newDiagnostic);
        continue;
      }
      result.forEach((ns) =>
        ret.push(
          vscode.TextEdit.replace(doc.lineAt(ns.lineNumber).range, ns.text)
        )
      );
    }
    this.diagonostics.set(doc.uri, nextDiags);
    return ret;
  }
}

// this method is called when your extension is activated
// your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {
  const eraSelector = { language: "erabasic", scheme: "file" };
  const diagnostics = vscode.languages.createDiagnosticCollection(
    "erabasicIndenter"
  );
  context.subscriptions.push(diagnostics);
  const provider = new EraIndentProvider(diagnostics);

  const rangeFormatter = vscode.languages.registerDocumentRangeFormattingEditProvider(
    eraSelector,
    provider
  );
  context.subscriptions.push(rangeFormatter);
  const onTypeFormatter = vscode.languages.registerOnTypeFormattingEditProvider(
    eraSelector,
    provider,
    "\n"
  );
  context.subscriptions.push(onTypeFormatter);
}

// this method is called when your extension is deactivated
export function deactivate() {}
