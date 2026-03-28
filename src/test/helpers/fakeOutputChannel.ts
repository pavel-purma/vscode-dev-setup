import * as vscode from 'vscode';

/** Extended OutputChannel that exposes captured log lines for assertions. */
export interface FakeOutputChannel extends vscode.OutputChannel {
    /** All lines captured via `appendLine()`. */
    readonly lines: string[];
    /** Get all captured lines (alias for `lines`). */
    getLines(): string[];
}

/**
 * Create a stub `vscode.OutputChannel` that captures `appendLine()` calls
 * in an array for test assertions. All other methods are no-ops.
 *
 * @returns A fake output channel with a `lines` array and `getLines()` helper.
 */
export function createFakeOutputChannel(): FakeOutputChannel {
    const lines: string[] = [];

    return {
        name: 'Test Output',
        lines,
        getLines(): string[] {
            return lines;
        },
        appendLine(line: string): void {
            lines.push(line);
        },
        append(): void { /* no-op */ },
        clear(): void { /* no-op */ },
        show(): void { /* no-op */ },
        hide(): void { /* no-op */ },
        dispose(): void { /* no-op */ },
        replace(): void { /* no-op */ },
    };
}
