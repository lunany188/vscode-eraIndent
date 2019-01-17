// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import * as indentor from './indenter';

export class EraIndentProvider implements vscode.DocumentFormattingEditProvider {
	private diagonostics: vscode.DiagnosticCollection;
	constructor(diagnostics: vscode.DiagnosticCollection) {
		this.diagonostics = diagnostics;
	}
	public provideDocumentFormattingEdits(document: vscode.TextDocument, options: vscode.FormattingOptions, token: vscode.CancellationToken): vscode.ProviderResult<vscode.TextEdit[]> {
		const hoge = new indentor.EraIndenter(options);
		const ret: vscode.TextEdit[] = [];
		this.diagonostics.clear();
		for (let lineNo = 0; lineNo < document.lineCount; lineNo++) {
			const line: vscode.TextLine = document.lineAt(lineNo);
			const result = hoge.update(line);
			// 仮 エラーが起きても次の行を読めるようにうまいことやる
			if (indentor.isEraIndenterError(result)) {
				const test = this.diagonostics.get(document.uri);
				const newDiagnostic = new vscode.Diagnostic(document.lineAt(result.lineNumber).range, result.message);
				if (test===undefined) {
					this.diagonostics.set(document.uri, [newDiagnostic]);
				}
				else {
					test.push(newDiagnostic);
					this.diagonostics.set(document.uri, test);
				}
				continue;
			}
			result.forEach(ns => ret.push(vscode.TextEdit.replace(document.lineAt(ns.lineNumber).range, ns.text)));
		}
		return ret;
	}
}

// this method is called when your extension is activated
// your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {

	const diagnostics = vscode.languages.createDiagnosticCollection("erabasicIndenter");
	context.subscriptions.push(diagnostics);

	const test = vscode.languages.registerDocumentFormattingEditProvider({ language: 'erabasic', scheme: 'file' } , new EraIndentProvider(diagnostics));
	context.subscriptions.push(test);
}

// this method is called when your extension is deactivated
export function deactivate() {}
