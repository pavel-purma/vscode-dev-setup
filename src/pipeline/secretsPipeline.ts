import * as vscode from 'vscode';
import { findConfig } from '../config/configFinder';
import { BatchedSecretEntry, SecretFilter, SecretMap } from '../config/configTypes';
import { fetchSecrets, getStoredToken } from '../doppler/dopplerClient';
import { writeDotenv } from '../loaders/dotenvWriter';
import { parseBatchEntry } from './batchParser';

/**
 * Filter a secret map using include/exclude regex patterns.
 *
 * Include is evaluated first — a key must match ALL include patterns.
 * Then exclude is applied — a key matching ANY exclude pattern is removed.
 *
 * @param secrets - The original secret key-value map
 * @param filter - Object with optional include and exclude regex pattern arrays
 * @returns A new SecretMap containing only the matching entries
 */
function applySecretFilter(secrets: SecretMap, filter: SecretFilter): SecretMap {
    const includeRegexes = filter.include?.map(p => new RegExp(p));
    const excludeRegexes = filter.exclude?.map(p => new RegExp(p));
    const filtered: SecretMap = {};
    for (const [key, value] of Object.entries(secrets)) {
        // Include check: if include patterns exist, key must match ALL
        if (includeRegexes && !includeRegexes.every(rx => rx.test(key))) {
            continue;
        }
        // Exclude check: if exclude patterns exist, key must NOT match ANY
        if (excludeRegexes && excludeRegexes.some(rx => rx.test(key))) {
            continue;
        }
        filtered[key] = value;
    }
    return filtered;
}

let activeFetch: Promise<void> | null = null;

/**
 * Reset the concurrency guard. Intended for use in tests only.
 */
export function resetConcurrencyGuard(): void {
    activeFetch = null;
}

/**
 * Orchestrate the full secrets-fetch pipeline for all workspace folders.
 * Can be called from the workspace-open hook or the manual command.
 * If a fetch is already in progress, the second invocation awaits
 * the first rather than spawning a duplicate pipeline.
 *
 * @param context - The VS Code extension context
 * @param outputChannel - Output channel for logging
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

/**
 * Process a single workspace folder: find config, fetch secrets, write .env.
 *
 * @param folder - The workspace folder to process
 * @param context - The VS Code extension context
 * @param outputChannel - Output channel for logging
 * @param manual - Whether this is a manual invocation
 */
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
        if (manual) {
            vscode.window.showInformationMessage(
                "Dev Setup: Doppler token not configured. Use 'Login to Doppler' command first.",
            );
        } else {
            outputChannel.appendLine(`[${folder.name}] Doppler token not configured — skipping.`);
        }
        return;
    }

    outputChannel.appendLine('Dev Setup: Doppler token found');

    // 6. Determine default project name
    const defaultProject = configProject || folder.name;

    // 7. Fetch secrets from each batch and merge
    outputChannel.appendLine(`Dev Setup: Processing ${batches.length} secret batch(es): ${batches.join(', ')}`);
    const batchedResults: BatchedSecretEntry[] = [];

    for (const batchEntry of batches) {
        try {
            const { project, config: batchConfig } = parseBatchEntry(batchEntry, defaultProject);
            outputChannel.appendLine(
                `  Batch "${batchEntry}" → project="${project}", config="${batchConfig}"`,
            );
            outputChannel.appendLine(
                `Dev Setup: Fetching batch "${batchEntry}" for project "${project}"`,
            );
            const batchSecrets = await fetchSecrets(token, project, batchConfig, outputChannel);

            // Apply secret key filter if configured
            let filteredSecrets = batchSecrets;
            if (config.secrets!.filter) {
                const beforeCount = Object.keys(batchSecrets).length;
                filteredSecrets = applySecretFilter(batchSecrets, config.secrets!.filter);
                const afterCount = Object.keys(filteredSecrets).length;
                const removedCount = beforeCount - afterCount;
                if (removedCount > 0) {
                    outputChannel.appendLine(
                        `  Filtered out ${removedCount} secret(s) from batch "${batchEntry}" that did not match filter patterns`,
                    );
                }
            }

            batchedResults.push({ batchName: batchEntry, secrets: filteredSecrets });
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : String(error);
            outputChannel.appendLine(
                `[Error] Failed to fetch batch "${batchEntry}": ${message}`,
            );
            vscode.window.showErrorMessage(
                `Dev Setup: Failed to fetch secrets for batch "${batchEntry}" — ${message}`,
            );
        }
    }

    const seenKeys = new Set<string>();
    for (const { secrets } of batchedResults) {
        for (const key of Object.keys(secrets)) {
            seenKeys.add(key);
        }
    }
    const uniqueKeyCount = seenKeys.size;

    outputChannel.appendLine(`Dev Setup: Merged ${uniqueKeyCount} total secrets from ${batches.length} batch(es)`);

    if (uniqueKeyCount === 0) {
        outputChannel.appendLine('No secrets fetched — skipping .env write.');
        return;
    }

    // 8. Write .env file
    try {
        await writeDotenv(configDir, batchedResults, outputChannel);
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        outputChannel.appendLine(`[Error] Failed to write .env file: ${message}`);
        vscode.window.showErrorMessage(`Dev Setup: Failed to write .env file — ${message}`);
        return;
    }

    outputChannel.appendLine(
        `Secrets loaded successfully from Doppler for project '${defaultProject}' into ${configDir}/.env`,
    );

    if (manual) {
        vscode.window.showInformationMessage(
            `Dev Setup: Secrets loaded successfully for project '${defaultProject}' into .env`,
        );
    }
}
