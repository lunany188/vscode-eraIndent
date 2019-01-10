// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import * as indentor from './indenter';

export class EraIndentProvider implements vscode.DocumentFormattingEditProvider {
	public provideDocumentFormattingEdits(document: vscode.TextDocument, options: vscode.FormattingOptions, token: vscode.CancellationToken): vscode.ProviderResult<vscode.TextEdit[]> {
		const hoge = new indentor.EraIndenter(options);
		const ret: vscode.TextEdit[] = [];
		for (let lineNo = 0; lineNo < document.lineCount; lineNo++) {
			const line: vscode.TextLine = document.lineAt(lineNo);
			const result = hoge.update(line);
			// 仮 エラーが起きても次の行を読めるようにうまいことやる
			if (result instanceof Error) {
				throw result;
			}
			result.forEach(ns => ret.push(vscode.TextEdit.replace(document.lineAt(ns.lineNumber).range, ns.text)));
		}
		return ret;
	}
}

// this method is called when your extension is activated
// your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {

	// Use the console to output diagnostic information (console.log) and errors (console.error)
	// This line of code will only be executed once when your extension is activated
		console.log('Congratulations, your extension "eraindent" is now active!');

	// The command has been defined in the package.json file
	// Now provide the implementation of the command with registerCommand
	// The commandId parameter must match the command field in package.json
	let disposable = vscode.commands.registerCommand('extension.helloWorld', () => {
		// The code you place here will be executed every time your command is executed

		// Display a message box to the user
		vscode.window.showInformationMessage('Hello World!');
	});

	context.subscriptions.push(disposable);
}

// this method is called when your extension is deactivated
export function deactivate() {}
