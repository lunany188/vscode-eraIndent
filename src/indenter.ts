import * as vscode from 'vscode';

enum LineState {
    // 何らかの理由でインデントしない
    Empty = 1,
    // 普通の行はインデントが増減しない
    None,
    // コメント行も増減しないけどSIFで普通の行と区別する
    Comment,
    // 関数宣言行はインデント0固定
    Function,
    // IFとかの次の行でインデント増やす奴
    Up,
    // ENDIFとかのその行からインデントを減らす奴
    Down,
    // ELSEIFとかのその行だけインデントを減らす奴
    DownUp,
    // いろいろ実装できるだろうけどとりあえず2個インデントする
    SelectCase,
    // 2個インデント外す
    EndCase,
    // 次の行だけインデントする
    Sif,
    // 行連結の開始行
    ConnectStart,
    // 行連結の最初の行以外はインデント2
    Connect,
    // 行連結の最初の最後の行でインデントをいい感じにする
    ConnectEnd,
    // コメントブロックの開始
    CommentStart,
    // コメントブロックの終了
    CommentEnd,
}

interface ParseNormal {
    readonly kind: "Normal";
}
interface ParseComment {
    readonly kind: "Comment";
    readonly isInSif: boolean;
}
interface ParseConnectStart {
    readonly kind: "ConnectStart";
    readonly line: Line;
    readonly isInSif: boolean;
}
interface ParseConnect {
    readonly kind: "Connect";
    readonly lineState: LineState;
    readonly isInSif: boolean;
}
interface ParseSif {
    readonly kind: "Sif";
}

type ParseState = ParseNormal | ParseComment | ParseConnectStart | ParseConnect | ParseSif;

type IndentState = {
    readonly indentDepth: number,
    readonly parseState: ParseState,
    readonly options: vscode.FormattingOptions
};

const makeIndentState = (o: vscode.FormattingOptions, i: number = 0, p: ParseState = { kind: "Normal" }): IndentState => {
    return { indentDepth: i, parseState: p, options: o };
};

const updateIndentState = (s: IndentState, u: Partial<IndentState>): IndentState => {
    // uに指定したプロパティがあったらそっちの値を返す 名づけが思いつかない
    const func = <T extends keyof IndentState>(fun: T): IndentState[T] => {
        const tes: IndentState[T] | undefined = u[fun];
        if (tes !== undefined) {
            return tes;
        }
        return s[fun];
    };
    return makeIndentState(func("options"), func("indentDepth"), func("parseState"));
};

// todo:どう考えてもクソなやり方
type NormalIndentState = { readonly parseState: ParseNormal } & IndentState;

function isNormalState(state: IndentState): state is NormalIndentState {
    return state.parseState.kind === "Normal";
}

// vscode.TextLineから必要な部分だけ取り出すおまじない
interface Line {
    readonly lineNumber: number;
    readonly text: string;
    readonly range: vscode.Range;
}

export class EraIndenter implements vscode.DocumentFormattingEditProvider {
    public provideDocumentFormattingEdits(document: vscode.TextDocument, options: vscode.FormattingOptions, token: vscode.CancellationToken): vscode.ProviderResult<vscode.TextEdit[]> {
        let state = makeIndentState(options);
        let ret: vscode.TextEdit[] = [];
        for (let lineNo = 0; lineNo < document.lineCount; lineNo++) {
            const line: vscode.TextLine = document.lineAt(lineNo);
            const result: [Line[], IndentState] | Error = update(line, state);
            // 仮 エラーが起きても次の行を読めるようにうまいことやる
            if (result instanceof Error) {
                throw result;
            }
            result[0].forEach(ns => ret.push(vscode.TextEdit.replace(ns.range, ns.text)));
            state = result[1];
        }
        // 汚い
        // this.disposeState(ret, state);
        return ret;
    }
}

function update(line: Line, state: IndentState): [Line[], IndentState] | Error {
    // todo:ここでConnectFirstが帰って来た時、同時にその行の意味する内容も表示されないと困る
    const lineState: LineState = getLineState(line.text, state);
    const resultStrings: Line[] | Error = setIndents(line, lineState, state);
    if (resultStrings instanceof Error) {
        return resultStrings;
    }
    const nextState: IndentState | Error = getNextState(line, lineState, state);
    if (nextState instanceof Error) {
        return nextState;
    }
    return [resultStrings, nextState];
}

const ups = "(?:DATALIST|DO|FOR|IF|NOSKIP|PRINTDATA(?:K|D)?(?:L|W)?|REPEAT|STRDATA|TRY(?:CALL|GOTO|JUMP)LIST|TRYC(?:CALL|GOTO|JUMP)(?:FORM)?|WHILE)";
const downs = "(?:END(?:CATCH|DATA|FUNC|IF|LIST|NOSKIP)|LOOP|NEXT|REND|WEND)";
const downUps = "(?:ELSE(IF)?|CASE(?:ELSE)?|CATCH)";
const selectCase = "SELECTCASE";
const endCase = "ENDSELECT";
const sif = "SIF";
const connectStart = String.raw`{\s*$`;
const connectEnd = String.raw`}\s*$`;
const commentStart = "[SKIPSTART]";
const commentEnd = "[SKIPEND]";
const comment = ";(?![!?];)";
const none = String.raw`\S+`;
const _function = "@";
const leftSpaces = String.raw`\s*(?:;[!?];)?\s*`;
const makeReg = (i: string) => new RegExp(leftSpaces + i);

function getLineState(line: string, state: { parseState: ParseState }): LineState {
    // todo:なんかおかしい気がするから後で再確認する
    switch (state.parseState.kind) {
        case "Normal":
        case "Comment":
        case "ConnectStart":
        case "Sif":
            return getLineStateNormal(line);
        case "Connect":
            if (getLineStateNormal(line) === LineState.ConnectEnd) {
                return LineState.ConnectEnd;
            }
            return LineState.Connect;
        default:
            return state.parseState;
    }
}

function getLineStateNormal(line: string): LineState {
    const func = (i: string) => makeReg(i).test(line);
    //雑
    if (func(ups)) {
        return LineState.Up;
    }
    else if (func(downs)) {
        return LineState.Down;
    }
    else if (func(downUps)) {
        return LineState.DownUp;
    }
    else if (func(selectCase)) {
        return LineState.SelectCase;
    }
    else if (func(endCase)) {
        return LineState.EndCase;
    }
    else if (func(sif)) {
        return LineState.Sif;
    }
    else if (func(connectStart)) {
        return LineState.ConnectStart;
    }
    else if (func(connectEnd)) {
        return LineState.ConnectEnd;
    }
    else if (func(commentStart)) {
        return LineState.CommentStart;
    }
    else if (func(commentEnd)) {
        return LineState.CommentEnd;
    }
    else if (func(comment)) {
        return LineState.Comment;
    }
    else if (func(_function)) {
        return LineState.Function;
    }
    else if (func(none)) {
        return LineState.None;
    }
    return LineState.Empty;
}

function setIndents(line: Line, lineState: LineState, state: IndentState): Line[] | Error {
    let ret: Line[] = [];
    let depth: number | null | Error = getNewIndent(lineState, state);
    if (depth === null) {
        return [];
    }
    if (depth instanceof Error) {
        depth.message += `\rsetIndents(line:${line}, lineState:${lineState}, state:${state}`;
        return depth;
    }
    if (depth < 0) {
        depth = 0;
    }
    const rowString: string = trimSpace(line.text);
    const newString: string = setIndent(rowString, depth, state);
    ret.push({ lineNumber: line.lineNumber, text: newString, range: line.range });
    if (state.parseState.kind === "ConnectStart") {
        const line = state.parseState.line;
        const rowString: string = trimSpace(line.text);
        const newString: string = setIndent(rowString, depth - (lineState === LineState.ConnectEnd ? 0 : 1), state);
        ret.push({ lineNumber: line.lineNumber, text: newString, range: line.range });
    }
    return ret;
}

// todo:本来はあり得ないことにインデントがマイナスの場合を返すことがある
function getNewIndent(lineState: LineState, state: { indentDepth: number, parseState: ParseState }): number | null | Error {
    const isInSif = (state: { parseState: ParseState }) => state.parseState.kind === "Sif" || (state.parseState.kind === "ConnectStart" || state.parseState.kind === "Connect") && state.parseState.isInSif;

    const indent = state.indentDepth + (isInSif(state) ? 1 : 0);

    const func = getNewIndentNormal(lineState);
    switch (state.parseState.kind) {
        case "Comment":
            if (lineState !== LineState.CommentEnd) {
                return null;
            }
            return 0;
        case "ConnectStart":
            if (lineState === LineState.ConnectEnd) {
                return indent;
            }
            return func(indent + 1);
        case "Connect":
            if (lineState !== LineState.ConnectEnd) {
                return getNewIndentNormal(state.parseState.lineState)(indent + 2);
            }
            return getNewIndentNormal(state.parseState.lineState)(indent);
        case "Normal":
            return func(indent);
        case "Sif":
            return func(indent);
        default:
            return state.parseState;
    }
}

function getNewIndentNormal(lineState: LineState): (indent: number) => number | null | Error {
    switch (lineState) {
        // 空行はインデント0へ
        case LineState.Empty:
            return _ => 0;
        // コメント行は面倒だからインデント外へ
        case LineState.Comment:
            return _ => null;
        // 普通の行はインデントが変わらない
        case LineState.None:
        // インデントを増やすときは次の行から
        case LineState.Up:
        case LineState.SelectCase:
        case LineState.Sif:
            return i => i;
        case LineState.Function:
            return _ => 0;
        case LineState.Down:
        case LineState.DownUp:
            return i => i - 1;
        case LineState.EndCase:
            return i => i - 2;
        // 行連結の最初の行は外側でうまい感じにこなす
        case LineState.ConnectStart:
            return _ => null;
        case LineState.ConnectEnd:
        case LineState.Connect:
        case LineState.CommentEnd:
            return _ => { return new Error("こいつらがここで呼ばれるわけがない"); };
        case LineState.CommentStart:
            return _ => 0;
        default:
            return lineState;
    }
}

function trimSpace(text: string): string {
    return text.trimLeft();
}

function setIndent(line: string, newIndent: number, state: { options: vscode.FormattingOptions }): string {
    return (state.options.insertSpaces ? "\s".repeat(state.options.tabSize) : "\t").repeat(newIndent);
}

function getNextState(line: Line, lineState: LineState, state: IndentState): IndentState | Error {
    switch (state.parseState.kind) {
        case "Normal":
            // 型推論が無限に有能ならばここは当然isNormalStateであることを推論できるはずだけどできないので手書きする
            if (isNormalState(state)) {
                return getNextStateNormal(line, lineState, state);
            }
            else {
                // 当然ここは呼び出されないはず
                throw new Error("ここが呼び出されるわけがない");
            }
        case "Comment":
            if (lineState === LineState.CommentEnd) {
                if (state.parseState.isInSif) {
                    return updateIndentState(state, { parseState: { kind: "Sif" } });
                }
                return updateIndentState(state, { parseState: { kind: "Normal" } });
            }
            return state;
        case "ConnectStart":
            switch (lineState) {
                // 中身がなかったら次の行も行連結の読み出し待ち
                case LineState.Empty:
                    return state;
                // 中身がないままに行が読み終わったら空行として元の文脈に戻す
                case LineState.ConnectEnd:
                    if (state.parseState.isInSif) {
                        return updateIndentState(state, { parseState: { kind: "Sif" } });
                    }
                    else {
                        return updateIndentState(state, { parseState: { kind: "Normal" } });
                    }
                // 行連結が2重になることはない
                case LineState.ConnectStart:
                    throw new Error("行連結中に{を入れたら警告だけど未実装");
                // そうじゃないなら行連結の中身が決定した状態になる
                default:
                    return updateIndentState(state, { parseState: { kind: "Connect", lineState: lineState, isInSif: state.parseState.isInSif } });
            }
        case "Connect":
            if (lineState === LineState.ConnectEnd) {
                const normalState = updateIndentState(state, { parseState: { kind: "Normal" } });
                // ここも"Normal"と同じ
                if (isNormalState(normalState)) {
                    return getNextStateNormal(line, state.parseState.lineState, normalState);
                }
                else {
                    return new Error("ここが呼び出されるわけがない");
                }
            }
            return state;
        case "Sif":
            switch (lineState) {
                // 空行は飛ばす
                case LineState.Empty:
                case LineState.Comment:
                    return state;
                // コメントブロックが始まったらいい感じに処理する
                case LineState.CommentStart:
                    return updateIndentState(state, { parseState: { kind: "Comment", isInSif: true } });
                // 行連結もいい感じに処理する
                case LineState.ConnectStart:
                    return updateIndentState(state, { parseState: { kind: "ConnectStart", line: line, isInSif: true } });
                // SIFのあとが何らかのブロックの終端にはならない
                case LineState.CommentEnd:
                case LineState.ConnectEnd:
                    return new Error("SIFの次の行がコメントや行連結の終端になることは警告なんだけど未実装");
                // SIFのあとが何らかのブロックになったりしない
                case LineState.Up:
                case LineState.Down:
                case LineState.DownUp:
                case LineState.Sif:
                case LineState.SelectCase:
                case LineState.EndCase:
                case LineState.Function:
                    return new Error("SIFの次の行で別のブロックを作ったり壊したりは禁止で警告なんだけど未実装");
                default:
                    return updateIndentState(state, { parseState: { kind: "Normal" } });
            }
        default:
            // もしcaseが網羅されていない場合エラーが出る
            return state.parseState;
    }
}

function getNextStateNormal(line: Line, lineState: LineState, state: NormalIndentState): IndentState | Error {
    switch (lineState) {
        case LineState.Empty:
        case LineState.None:
        case LineState.Comment:
        case LineState.DownUp:
            return state;
        case LineState.Function:
            return updateIndentState(state, { indentDepth: 0 });
        case LineState.Up:
            return updateIndentState(state, { indentDepth: state.indentDepth + 1 });
        case LineState.Down:
            return updateIndentState(state, { indentDepth: state.indentDepth - 1 });
        case LineState.SelectCase:
            return updateIndentState(state, { indentDepth: state.indentDepth + 2 });
        case LineState.EndCase:
            return updateIndentState(state, { indentDepth: state.indentDepth - 2 });
        case LineState.Sif:
            return updateIndentState(state, { parseState: { kind: "Sif" } });
        case LineState.ConnectStart:
            return updateIndentState(state, { parseState: { kind: "ConnectStart", line: line, isInSif: false } });
        case LineState.CommentStart:
            return updateIndentState(state, { parseState: { kind: "Comment", isInSif: false } });
        case LineState.Connect:
            return new Error("ここは、この拡張のために独自に用意された分類なのでここに来ることはない");
        case LineState.ConnectEnd:
        case LineState.CommentEnd:
            return new Error("警告を出すべきだけど未実装");
        default:
            //ここにたどり着くわけがない
            return lineState;
    }
}
