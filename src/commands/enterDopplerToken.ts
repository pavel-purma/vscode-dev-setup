import * as vscode from 'vscode';
import { validateToken, storeToken } from '../doppler/dopplerClient';

export function registerEnterDopplerTokenCommand(context: vscode.ExtensionContext): void {
    const disposable = vscode.commands.registerCommand('dev-setup.enterDopplerToken', async () => {
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
            const info = await validateToken(token.trim());
            await storeToken(context.secrets, token.trim());

            vscode.window.showInformationMessage(
                `Doppler: Token stored successfully. Workspace: "${info.workplace?.name || 'unknown'}".`
            );
        } catch (error: any) {
            vscode.window.showErrorMessage(
                `Doppler: Invalid token – ${error.message}`
            );
        }
    });

    context.subscriptions.push(disposable);
}
