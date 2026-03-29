import * as vscode from 'vscode';
import { authenticate, storeCredentials, InfisicalCredentials } from '../infisical/infisicalClient';

const DEFAULT_SITE_URL = 'https://app.infisical.com';

/** Register the "Login to Infisical" command. */
export function registerLoginToInfisicalCommand(
    context: vscode.ExtensionContext,
    outputChannel: vscode.OutputChannel,
): void {
    const disposable = vscode.commands.registerCommand('dev-setup.loginToInfisical', async () => {
        outputChannel.appendLine('Dev Setup: Login to Infisical command invoked');

        // Step 1: Open Infisical dashboard for credential creation
        const openDashboard = await vscode.window.showInformationMessage(
            'To log in, create a Machine Identity with Universal Auth in the Infisical dashboard.',
            'Open Infisical Dashboard',
            'I already have credentials',
        );

        if (openDashboard === 'Open Infisical Dashboard') {
            outputChannel.appendLine('Dev Setup: Opening Infisical dashboard in browser');
            await vscode.env.openExternal(
                vscode.Uri.parse('https://app.infisical.com/organization/identities'),
            );
        } else if (openDashboard === undefined) {
            return; // User cancelled
        }

        // Step 2: Prompt for Infisical server URL
        const siteUrl = await vscode.window.showInputBox({
            prompt: 'Infisical server URL (leave default for Infisical Cloud)',
            value: DEFAULT_SITE_URL,
            ignoreFocusOut: true,
            validateInput: (value) => {
                if (!value || value.trim().length === 0) {
                    return 'Server URL cannot be empty';
                }
                return undefined;
            },
        });

        if (!siteUrl) {
            return; // User cancelled
        }

        // Step 3: Prompt for Client ID
        const clientId = await vscode.window.showInputBox({
            prompt: 'Paste your Infisical Machine Identity Client ID',
            placeHolder: 'Client ID',
            ignoreFocusOut: true,
            validateInput: (value) => {
                if (!value || value.trim().length === 0) {
                    return 'Client ID cannot be empty';
                }
                return undefined;
            },
        });

        if (!clientId) {
            return; // User cancelled
        }

        // Step 4: Prompt for Client Secret
        const clientSecret = await vscode.window.showInputBox({
            prompt: 'Paste your Infisical Machine Identity Client Secret',
            placeHolder: 'Client Secret',
            password: true,
            ignoreFocusOut: true,
            validateInput: (value) => {
                if (!value || value.trim().length === 0) {
                    return 'Client Secret cannot be empty';
                }
                return undefined;
            },
        });

        if (!clientSecret) {
            return; // User cancelled
        }

        // Step 5: Validate credentials by authenticating
        try {
            const trimmedUrl = siteUrl.trim();
            const credentials: InfisicalCredentials = {
                clientId: clientId.trim(),
                clientSecret: clientSecret.trim(),
                siteUrl: trimmedUrl,
            };

            await authenticate(credentials, trimmedUrl, outputChannel);

            // Step 6: Store credentials (including siteUrl)
            await storeCredentials(context.secrets, credentials);

            outputChannel.appendLine('Dev Setup: Infisical credentials validated and stored via login flow');

            vscode.window.showInformationMessage(
                `Dev Setup: Successfully logged in to Infisical at ${trimmedUrl}`,
            );
        } catch (error: unknown) {
            const msg = error instanceof Error ? error.message : String(error);
            outputChannel.appendLine(`Dev Setup: [Error] Failed to login to Infisical: ${msg}`);
            vscode.window.showErrorMessage(
                `Dev Setup: Infisical login failed: ${msg}`,
            );
        }
    });

    context.subscriptions.push(disposable);
}
