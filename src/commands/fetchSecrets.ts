import * as vscode from 'vscode';
import { fetchSecretsFromConfig } from '../hooks/onWorkspaceOpen';

export function registerFetchSecretsCommand(
    context: vscode.ExtensionContext,
    outputChannel: vscode.OutputChannel,
): void {
    const disposable = vscode.commands.registerCommand('dev-setup.fetchSecrets', async () => {
        try {
            await fetchSecretsFromConfig(context, outputChannel, true);
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            outputChannel.appendLine(`[Error] Unexpected: ${msg}`);
            vscode.window.showWarningMessage(`Dev Setup: Failed to fetch secrets — ${msg}`);
        }
    });

    context.subscriptions.push(disposable);
}
