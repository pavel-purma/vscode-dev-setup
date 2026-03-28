import * as vscode from 'vscode';
import { validateToken, storeToken } from '../doppler/dopplerClient';

/** Register the "Login to Doppler" command. */
export function registerLoginToDopplerCommand(
    context: vscode.ExtensionContext,
    outputChannel: vscode.OutputChannel,
): void {
    const disposable = vscode.commands.registerCommand('dev-setup.loginToDoppler', async () => {
        outputChannel.appendLine('Dev Setup: Login to Doppler command invoked');

        // Step 1: Open Doppler dashboard for token creation
        const openDashboard = await vscode.window.showInformationMessage(
            'To log in, create a Personal Token in the Doppler dashboard.',
            'Open Doppler Dashboard',
            'I already have a token',
        );

        if (openDashboard === 'Open Doppler Dashboard') {
            outputChannel.appendLine('Dev Setup: Opening Doppler dashboard in browser');
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
            const info = await validateToken(token.trim(), outputChannel);

            // Step 4: Store token
            await storeToken(context.secrets, token.trim());

            const workplaceName = info.workplace?.name || 'unknown';
            outputChannel.appendLine(`Dev Setup: Doppler token validated and stored via login flow for workplace "${workplaceName}"`);
            vscode.window.showInformationMessage(
                `Doppler: Logged in to workspace "${workplaceName}".`,
            );
        } catch (error: unknown) {
            const msg = error instanceof Error ? error.message : String(error);
            outputChannel.appendLine(`Dev Setup: [Error] Failed to login to Doppler: ${msg}`);
            vscode.window.showErrorMessage(
                `Doppler login failed: ${msg}`,
            );
        }
    });

    context.subscriptions.push(disposable);
}
