export enum LineState {
    // 何らかの理由でインデントしない
    Empty,
    // 普通の行はインデントが増減しない
    Normal,
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
    EndSelect,
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

export interface ParseNormal {
    readonly kind: "Normal";
}
export interface ParseComment {
    readonly kind: "Comment";
    readonly isInSif: boolean;
}
export interface ParseConnectStart {
    readonly kind: "ConnectStart";
    readonly line: Line;
    readonly isInSif: boolean;
}
export interface ParseConnect {
    readonly kind: "Connect";
    readonly lineState: LineState;
    readonly isInSif: boolean;
}
export interface ParseSif {
    readonly kind: "Sif";
}

export type ParseState = ParseNormal | ParseComment | ParseConnectStart | ParseConnect | ParseSif;

export interface IndentState {
    readonly indentDepth: number;
    readonly parseState: ParseState;
    readonly options: EraIndentorOptions;
}

export const makeIndentState = (o: EraIndentorOptions, i: number = 0, p: ParseState = { kind: "Normal" }): IndentState => {
    return { indentDepth: i, parseState: p, options: o };
};

export const updateIndentState = (s: IndentState, u: Partial<IndentState>): IndentState => {
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
// 後日の追記だから存在意義が全く分からないんだけど 多分型レベルでNormalが来ることを保証したかった
export interface NormalIndentState {
    readonly indentDepth: number;
    readonly parseState: ParseNormal;
    readonly options: EraIndentorOptions;
}

export function isNormalState(state: IndentState): state is NormalIndentState {
    return state.parseState.kind === "Normal";
}

// vscode.TextLineから必要な部分だけ取り出すおまじない
export interface Line {
    readonly lineNumber: number;
    readonly text: string;
}

// vscode.FormattingOptionsに依存しないおまじない
export interface EraIndentorOptions {
    readonly tabSize: number;
    readonly insertSpaces: boolean;
}

// 読み取れない行のエラー出力のために最低限用意
export interface EraIndenterError {
    readonly kind: "EraIndenterError";
    readonly lineNumber: number;
    readonly message: string;
}
export const makeEraIndenterError = (line: number, message: string): EraIndenterError => {
    return { kind: "EraIndenterError", lineNumber: line, message: message };
};
export function isEraIndenterError(object: any): object is EraIndenterError {
    return 'kind' in object && object.kind === "EraIndenterError";
}

export class EraIndenter {
    state: IndentState;
    constructor(option: EraIndentorOptions) {
        this.state = makeIndentState(option);
    }
    update(line: Line): Line[] | EraIndenterError {
        const result = update(line, this.state);
        if (isEraIndenterError(result)) {
            return result;
        }
        this.state = result[1];
        return result[0];
    }
}

export function update(line: Line, state: IndentState): [Line[], IndentState] | EraIndenterError {
    // todo:ここでConnectFirstが帰って来た時、同時にその行の意味する内容も表示されないと困る
    const lineState: LineState = getLineState(line.text, state);
    const resultStrings: Line[] = setIndents(line, lineState, state);
    const nextState: IndentState | EraIndenterError = getNextState(line, lineState, state);
    if (isEraIndenterError(nextState)) {
        return nextState;
    }
    return [resultStrings, nextState];
}

export const ups = "(?:DATALIST|DO|FOR|IF|NOSKIP|PRINTDATA(?:K|D)?(?:L|W)?|REPEAT|STRDATA|TRY(?:CALL|GOTO|JUMP)LIST|TRYC(?:CALL|GOTO|JUMP)(?:FORM)?|WHILE)";
export const downs = "(?:END(?:CATCH|DATA|FUNC|IF|LIST|NOSKIP)|LOOP|NEXT|REND|WEND)";
export const downUps = "(?:ELSE(?:IF)?|CASE(?:ELSE)?|CATCH)";
export const selectCase = "SELECTCASE";
export const endCase = "ENDSELECT";
export const sif = "SIF";
export const connectStart = String.raw`{\s*$`;
export const connectEnd = String.raw`}\s*$`;
export const commentStart = String.raw`\[SKIPSTART\]`;
export const commentEnd = String.raw`\[SKIPEND\]`;
export const comment = ";(?![!?];)";
export const none = String.raw`\S+`;
export const _function = "@";
export const leftSpaces = String.raw`^\s*(?:;[!?];)?\s*`;
export const makeReg = (i: string) => new RegExp(leftSpaces + "(?:" + i + ")");

export function getLineState(line: string, state: { parseState: ParseState }): LineState {
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

export function getLineStateNormal(line: string): LineState {
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
        return LineState.EndSelect;
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
        return LineState.Normal;
    }
    return LineState.Empty;
}

export function setIndents(line: Line, lineState: LineState, state: IndentState): Line[] {
    let ret: Line[] = [];
    let depth: number | null = getNewIndent(lineState, state);
    if (depth === null) {
        return [];
    }
    depth = Math.max(depth, 0);
    const rowString: string = trimSpace(line.text);
    const newString: string = setIndent(rowString, depth, state);
    ret.push({ lineNumber: line.lineNumber, text: newString });
    if (state.parseState.kind === "ConnectStart") {
        const line = state.parseState.line;
        const rowString: string = trimSpace(line.text);
        const newString: string = setIndent(rowString, depth - (lineState === LineState.ConnectEnd ? 0 : 1), state);
        ret.push({ lineNumber: line.lineNumber, text: newString });
    }
    return ret;
}

// todo:本来はあり得ないことにインデントがマイナスの場合を返すことがある
export function getNewIndent(lineState: LineState, state: { indentDepth: number, parseState: ParseState }): number | null {
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

export function getNewIndentNormal(lineState: LineState): (indent: number) => number | null {
    switch (lineState) {
        // 空行はインデント0へ
        case LineState.Empty:
            return _ => 0;
        // コメント行は面倒だからインデント外へ
        case LineState.Comment:
            return _ => null;
        // 普通の行はインデントが変わらない
        case LineState.Normal:
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
        case LineState.EndSelect:
            return i => i - 2;
        // 行連結の最初の行は外側でうまい感じにこなす
        case LineState.ConnectStart:
            return _ => null;
        // どうせ後でエラーを返すけどこっちでやると面倒だから何もしない
        case LineState.Connect:
        case LineState.ConnectEnd:
        case LineState.CommentEnd:
            return _ => null;
        case LineState.CommentStart:
            return _ => 0;
        default:
            return lineState;
    }
}

export function trimSpace(text: string): string {
    return text.trimLeft();
}

export function setIndent(line: string, newIndent: number, state: { options: EraIndentorOptions }): string {
    return (state.options.insertSpaces ? "\s".repeat(state.options.tabSize) : "\t").repeat(newIndent) + line;
}

export function getNextState(line: Line, lineState: LineState, state: IndentState): IndentState | EraIndenterError {
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
                    return makeEraIndenterError(line.lineNumber, "行連結ブロックの中に{が出現してはいけません");
                // そうじゃないなら行連結の中身が決定した状態になる
                default:
                    return updateIndentState(state, { parseState: { kind: "Connect", lineState: lineState, isInSif: state.parseState.isInSif } });
            }
        case "Connect":
            if (lineState === LineState.ConnectEnd) {
                const normalState = updateIndentState(state, { parseState: { kind: "Normal" } });
                // ここはNormalIndentStateを手書きすれば必要ないけどめんどくさいから"Normal"と同じ方法で頑張る
                if (isNormalState(normalState)) {
                    return getNextStateNormal(line, state.parseState.lineState, normalState);
                }
                else {
                    throw new Error("ここが呼び出されるわけがない");
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
                    return makeEraIndenterError(line.lineNumber, "対応する[SKIPSTART]のない[SKIPEND]です");
                case LineState.ConnectEnd:
                    return makeEraIndenterError(line.lineNumber, "対応する{のない}です");
                // SIFのあとが何らかのブロックになったりしない
                case LineState.Up:
                case LineState.Down:
                case LineState.DownUp:
                case LineState.Sif:
                case LineState.SelectCase:
                case LineState.EndSelect:
                    return makeEraIndenterError(line.lineNumber, "SIFの次の行でブロックを作る命令は使えません");
                case LineState.Function:
                    return updateIndentState(state, { indentDepth: 0, parseState: { kind: "Normal" } });
                default:
                    return updateIndentState(state, { parseState: { kind: "Normal" } });
            }
        default:
            // もしcaseが網羅されていない場合エラーが出る
            return state.parseState;
    }
}

export function getNextStateNormal(line: Line, lineState: LineState, state: NormalIndentState): IndentState | EraIndenterError {
    switch (lineState) {
        case LineState.Empty:
        case LineState.Normal:
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
        case LineState.EndSelect:
            return updateIndentState(state, { indentDepth: state.indentDepth - 2 });
        case LineState.Sif:
            return updateIndentState(state, { parseState: { kind: "Sif" } });
        case LineState.ConnectStart:
            return updateIndentState(state, { parseState: { kind: "ConnectStart", line: line, isInSif: false } });
        case LineState.CommentStart:
            return updateIndentState(state, { parseState: { kind: "Comment", isInSif: false } });
        case LineState.Connect:
            throw new Error("ここは、この拡張のために独自に用意された分類なのでここに来ることはない はず");
        case LineState.ConnectEnd:
        case LineState.CommentEnd:
        case LineState.CommentEnd:
            return makeEraIndenterError(line.lineNumber, "対応する[SKIPSTART]のない[SKIPEND]です");
        case LineState.ConnectEnd:
            return makeEraIndenterError(line.lineNumber, "対応する{のない}です");
        default:
            //ここにたどり着くわけがない
            return lineState;
    }
}
