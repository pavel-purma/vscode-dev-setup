import * as vscode from 'vscode';
import { validateToken, storeToken } from '../doppler/dopplerClient';

/** Register the "Enter Doppler Token" command. */
export function registerEnterDopplerTokenCommand(
    context: vscode.ExtensionContext,
    outputChannel: vscode.OutputChannel,
): void {
    const disposable = vscode.commands.registerCommand('dev-setup.enterDopplerToken', async () => {
        outputChannel.appendLine('Dev Setup: Enter Doppler Token command invoked');

        const token = await vscode.window.showInputBox({
            prompt: 'Enter your Doppler personal token',
            placeHolder: 'dp.pt.xxxxxxxxxxxxxxxxxxxx (personal token)',
            password: true,
            ignoreFocusOut: true,
            validateInput: (value) => {
                if (!value || value.trim().length === 0) {
                    return 'Token cannot be empty';
                }
                return undefined;
            },
        });

        if (!token) {
            return; // User cancelled
        }

        try {
            const info = await validateToken(token.trim(), outputChannel);
            await storeToken(context.secrets, token.trim());

            const workplaceName = info.workplace?.name || 'unknown';
            outputChannel.appendLine(`Dev Setup: Doppler token validated and stored for workplace "${workplaceName}"`);
            vscode.window.showInformationMessage(
                `Doppler: Token stored successfully. Workspace: "${workplaceName}".`,
            );
        } catch (error: unknown) {
            const msg = error instanceof Error ? error.message : String(error);
            outputChannel.appendLine(`Dev Setup: [Error] Failed to enter Doppler token: ${msg}`);
            vscode.window.showErrorMessage(
                `Doppler: Invalid token – ${msg}`,
            );
        }
    });

    context.subscriptions.push(disposable);
}
