import * as vscode from 'vscode';
import { BatchedSecretEntry } from '../config/configTypes';

/**
 * Merges all batched secret entries into a single flat record.
 * First-writer-wins: if a key appears in multiple batches, the first occurrence is kept.
 */
export function mergeBatchedSecrets(batches: BatchedSecretEntry[]): Record<string, string> {
    const merged: Record<string, string> = {};
    for (const batch of batches) {
        for (const [key, value] of Object.entries(batch.secrets)) {
            if (!(key in merged)) {
                merged[key] = value;
            }
        }
    }
    return merged;
}

/**
 * Runs a script command in a new VS Code terminal with secrets injected as environment variables.
 * The terminal is created with the secrets as env vars and the script is sent as text.
 */
export function runScript(
    script: string,
    cwd: string,
    batches: BatchedSecretEntry[],
    outputChannel: vscode.OutputChannel,
): void {
    const env = mergeBatchedSecrets(batches);

    const terminalName = `Dev Setup: ${script.length > 30 ? script.substring(0, 27) + '...' : script}`;

    outputChannel.appendLine(`[script-runner] Creating terminal "${terminalName}" in ${cwd}`);
    outputChannel.appendLine(`[script-runner] Injecting ${Object.keys(env).length} environment variable(s)`);

    const terminal = vscode.window.createTerminal({
        name: terminalName,
        cwd,
        env,
    });

    terminal.show();
    terminal.sendText(script);

    outputChannel.appendLine(`[script-runner] Script sent to terminal: ${script}`);
}
