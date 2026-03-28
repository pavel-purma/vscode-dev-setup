import * as vscode from 'vscode';
import { findConfig } from '../config/configFinder';
import { SecretMap } from '../config/configTypes';
import { fetchSecrets, getStoredToken } from '../doppler/dopplerClient';
import { writeDotenv } from '../loaders/dotenvWriter';

let activeFetch: Promise<void> | null = null;

/**
 * Reset the concurrency guard. Intended for use in tests only.
 */
export function resetConcurrencyGuard(): void {
    activeFetch = null;
}

/**
 * Hook called on workspace open. Triggers the secrets-fetch pipeline
 * for each workspace folder that contains a dev-setup.json.
 */
export async function onWorkspaceOpen(context: vscode.ExtensionContext, outputChannel: vscode.OutputChannel): Promise<void> {
    outputChannel.appendLine('Dev Setup: Workspace open hook triggered');
    try {
        await fetchSecretsFromConfig(context, outputChannel, false);
    } catch (err) {
        outputChannel.appendLine(`[Error] Unexpected: ${err instanceof Error ? err.message : String(err)}`);
    }
}

/**
 * Orchestrate the full secrets-fetch pipeline for all workspace folders.
 * Can be called from the workspace-open hook or the manual command.
 * If a fetch is already in progress, the second invocation awaits
 * the first rather than spawning a duplicate pipeline.
 *
 * @param manual — when `true` (manual command), missing config triggers an
 *   interactive warning; when `false` (workspace-open), it only logs silently.
 */
export async function fetchSecretsFromConfig(
    context: vscode.ExtensionContext,
    outputChannel: vscode.OutputChannel,
    manual: boolean = false,
): Promise<void> {
    outputChannel.appendLine(`Dev Setup: Starting secrets fetch pipeline (manual: ${manual})`);

    if (activeFetch) {
        outputChannel.appendLine('Dev Setup: Fetch already in progress, waiting for completion...');
        if (manual) {
            vscode.window.showInformationMessage('Dev Setup: A secrets fetch is already in progress.');
        }
        await activeFetch;
        if (!manual) {
            return;
        }
        outputChannel.appendLine('Dev Setup: Previous fetch completed, re-running pipeline with manual: true');
    }

    const run = async (): Promise<void> => {
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
            outputChannel.appendLine(`Dev Setup: Processing workspace folder: "${folder.name}" (${folder.uri.toString()})`);
            try {
                await processWorkspaceFolder(folder, context, outputChannel, manual);
            } catch (error: unknown) {
                const message = error instanceof Error ? error.message : String(error);
                outputChannel.appendLine(`[Error] ${folder.name}: ${message}`);
                vscode.window.showErrorMessage(`Dev Setup: Error processing "${folder.name}" — ${message}`);
            }
        }
    };

    try {
        activeFetch = run();
        await activeFetch;
    } finally {
        activeFetch = null;
    }
}

export async function processWorkspaceFolder(
    folder: vscode.WorkspaceFolder,
    context: vscode.ExtensionContext,
    outputChannel: vscode.OutputChannel,
    manual: boolean,
): Promise<void> {
    // 1. Find config
    const location = await findConfig(folder.uri, outputChannel);
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
    outputChannel.appendLine('Dev Setup: Retrieving stored Doppler token...');
    const token = await getStoredToken(context.secrets);
    if (!token) {
        outputChannel.appendLine('Dev Setup: No Doppler token found');
        vscode.window.showInformationMessage(
            "Doppler token not configured. Use 'Enter Doppler Token' command first.",
        );
        return;
    }

    outputChannel.appendLine('Dev Setup: Doppler token found');

    // 6. Determine project name
    const project = configProject || folder.name;

    // 7. Fetch secrets from each batch and merge
    outputChannel.appendLine(`Dev Setup: Processing ${batches.length} secret batch(es): ${batches.join(', ')}`);
    const mergedSecrets: SecretMap = {};

    for (const batchName of batches) {
        try {
            outputChannel.appendLine(
                `Dev Setup: Fetching batch "${batchName}" for project "${project}"`,
            );
            const batchSecrets = await fetchSecrets(token, project, batchName, outputChannel);
            Object.assign(mergedSecrets, batchSecrets);
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : String(error);
            outputChannel.appendLine(
                `[Error] Failed to fetch batch "${batchName}": ${message}`,
            );
            vscode.window.showErrorMessage(
                `Dev Setup: Failed to fetch secrets for batch "${batchName}" — ${message}`,
            );
        }
    }

    outputChannel.appendLine(`Dev Setup: Merged ${Object.keys(mergedSecrets).length} total secrets from ${batches.length} batch(es)`);

    if (Object.keys(mergedSecrets).length === 0) {
        outputChannel.appendLine('No secrets fetched — skipping .env write.');
        return;
    }

    // 8. Write .env file
    try {
        await writeDotenv(configDir, mergedSecrets, outputChannel);
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        outputChannel.appendLine(`[Error] Failed to write .env file: ${message}`);
        vscode.window.showErrorMessage(`Dev Setup: Failed to write .env file — ${message}`);
        return;
    }

    outputChannel.appendLine(
        `Secrets loaded successfully from Doppler for project '${project}' into ${configDir}/.env`,
    );
}
