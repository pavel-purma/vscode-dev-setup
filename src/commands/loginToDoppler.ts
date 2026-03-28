import * as vscode from 'vscode';
import { validateToken, storeToken } from '../doppler/dopplerClient';

export function registerLoginToDopplerCommand(context: vscode.ExtensionContext): void {
    const disposable = vscode.commands.registerCommand('dev-setup.loginToDoppler', async () => {
        // Step 1: Open Doppler dashboard for token creation
        const openDashboard = await vscode.window.showInformationMessage(
            'To log in, create a Personal Token in the Doppler dashboard.',
            'Open Doppler Dashboard',
            'I already have a token'
        );

        if (openDashboard === 'Open Doppler Dashboard') {
            await vscode.env.openExternal(vscode.Uri.parse('https://dashboard.doppler.com/workplace/tokens'));
        } else if (openDashboard === undefined) {
            return; // User cancelled
        }

        // Step 2: Prompt for token
        const token = await vscode.window.showInputBox({
            prompt: 'Paste your Doppler Personal Token',
            placeHolder: 'dp.pt.xxxxxxxxxxxxxxxxxxxx',
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

        // Step 3: Validate token
        try {
            const info = await validateToken(token.trim());

            // Step 4: Store token
            await storeToken(context.secrets, token.trim());

            vscode.window.showInformationMessage(
                `Doppler: Logged in to workspace "${info.workplace?.name || 'unknown'}".`
            );
        } catch (error: any) {
            vscode.window.showErrorMessage(
                `Doppler login failed: ${error.message}`
            );
        }
    });

    context.subscriptions.push(disposable);
}
