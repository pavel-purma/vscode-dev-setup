import * as vscode from 'vscode';
import { findConfig } from '../config/configFinder';
import { SecretMap } from '../config/configTypes';
import { fetchSecrets, getStoredToken } from '../doppler/dopplerClient';
import { writeDotenv } from '../loaders/dotenvWriter';

/**
 * Hook called on workspace open. Triggers the secrets-fetch pipeline
 * for each workspace folder that contains a dev-setup.json.
 */
export function onWorkspaceOpen(context: vscode.ExtensionContext, outputChannel: vscode.OutputChannel): void {
    fetchSecretsFromConfig(context, outputChannel, false).catch(err => {
        outputChannel.appendLine(`[Error] Unexpected: ${err instanceof Error ? err.message : String(err)}`);
    });
}

/**
 * Orchestrate the full secrets-fetch pipeline for all workspace folders.
 * Can be called from the workspace-open hook or the manual command.
 *
 * @param manual — when `true` (manual command), missing config triggers an
 *   interactive warning; when `false` (workspace-open), it only logs silently.
 */
export async function fetchSecretsFromConfig(
    context: vscode.ExtensionContext,
    outputChannel: vscode.OutputChannel,
    manual: boolean = false,
): Promise<void> {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders || folders.length === 0) {
        if (manual) {
            vscode.window.showWarningMessage(
                'Dev Setup: No workspace folder is open. Open a folder first.',
            );
        }
        return;
    }

    for (const folder of folders) {
        try {
            await processWorkspaceFolder(folder, context, outputChannel, manual);
        } catch (error: any) {
            const message = error.message || String(error);
            outputChannel.appendLine(`[Error] ${folder.name}: ${message}`);
            vscode.window.showErrorMessage(`Dev Setup: Error processing "${folder.name}" — ${message}`);
        }
    }
}

export async function processWorkspaceFolder(
    folder: vscode.WorkspaceFolder,
    context: vscode.ExtensionContext,
    outputChannel: vscode.OutputChannel,
    manual: boolean,
): Promise<void> {
    // 1. Find config
    const location = await findConfig(folder.uri);
    if (!location) {
        if (manual) {
            vscode.window.showWarningMessage(
                `Dev Setup: No dev-setup.json file found in workspace folder "${folder.name}".`,
            );
        } else {
            outputChannel.appendLine(`No dev-setup.json found in "${folder.name}", skipping.`);
        }
        return;
    }

    const { config, directory: configDir } = location;

    // 2. Validate secrets section exists
    if (!config.secrets) {
        return;
    }

    const { provider, loader, batches, project: configProject } = config.secrets;

    // 3. Validate provider
    if (provider !== 'doppler') {
        outputChannel.appendLine(
            `Unsupported secrets provider: ${provider}. Only 'doppler' is supported.`,
        );
        return;
    }

    // 4. Validate loader
    if (loader !== 'dotenv') {
        outputChannel.appendLine(
            `Unsupported secrets loader: ${loader}. Only 'dotenv' is supported.`,
        );
        return;
    }

    // 5. Retrieve Doppler token
    const token = await getStoredToken(context.secrets);
    if (!token) {
        vscode.window.showInformationMessage(
            "Doppler token not configured. Use 'Enter Doppler Token' command first.",
        );
        return;
    }

    // 6. Determine project name
    const project = configProject || folder.name;

    // 7. Fetch secrets from each batch and merge
    const mergedSecrets: SecretMap = {};

    for (const batchName of batches) {
        try {
            outputChannel.appendLine(
                `Fetching secrets for project "${project}", config "${batchName}"...`,
            );
            const batchSecrets = await fetchSecrets(token, project, batchName);
            Object.assign(mergedSecrets, batchSecrets);
        } catch (error: any) {
            const message = error.message || String(error);
            outputChannel.appendLine(
                `[Error] Failed to fetch batch "${batchName}": ${message}`,
            );
            vscode.window.showErrorMessage(
                `Dev Setup: Failed to fetch secrets for batch "${batchName}" — ${message}`,
            );
        }
    }

    if (Object.keys(mergedSecrets).length === 0) {
        outputChannel.appendLine('No secrets fetched — skipping .env write.');
        return;
    }

    // 8. Write .env file
    try {
        await writeDotenv(configDir, mergedSecrets);
    } catch (error: any) {
        const message = error instanceof Error ? error.message : String(error);
        outputChannel.appendLine(`[Error] Failed to write .env file: ${message}`);
        vscode.window.showErrorMessage(`Dev Setup: Failed to write .env file — ${message}`);
        return;
    }

    outputChannel.appendLine(
        `Secrets loaded successfully from Doppler for project '${project}' into ${configDir}/.env`,
    );
}
