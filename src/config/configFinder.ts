import * as vscode from 'vscode';
import { ConfigLocation } from './configTypes';
import { parseJsonConfig, parseYamlConfig } from './configParser';

const CONFIG_BASENAMES = [
    'dev-setup.yaml',
    'dev-setup.yml',
    'dev-setup.json',
] as const;

const CONFIG_SUBDIRS = [
    '.dev',
    '',
] as const;

/** Per-file timeout for filesystem read operations (in milliseconds). */
const READ_FILE_TIMEOUT_MS = 5_000;

/**
 * Read a file with a timeout. Rejects with an error if the read
 * does not complete within the specified duration.
 */
async function readFileWithTimeout(
    uri: vscode.Uri,
    timeoutMs: number = READ_FILE_TIMEOUT_MS,
): Promise<Uint8Array> {
    return Promise.race([
        vscode.workspace.fs.readFile(uri),
        new Promise<never>((_resolve, reject) => {
            setTimeout(
                () => reject(new Error(`Filesystem read timed out after ${timeoutMs}ms: ${uri.toString()}`)),
                timeoutMs,
            );
        }),
    ]);
}

/**
 * Search for a dev-setup config file in the workspace.
 * Checks `.dev/` subfolder first, then the workspace root.
 * Within each folder, YAML formats (.yaml, .yml) take priority over JSON.
 * Returns the first match or undefined if not found.
 */
export async function findConfig(
    workspaceFolder: vscode.Uri,
    outputChannel: vscode.OutputChannel,
): Promise<ConfigLocation | undefined> {
    const folderName = workspaceFolder.path.split('/').pop() || workspaceFolder.path;
    outputChannel.appendLine(`Dev Setup: Searching for configuration files in workspace "${folderName}"`);

    const candidates: { uri: vscode.Uri; filename: string; relativePath: string }[] = [];

    for (const subdir of CONFIG_SUBDIRS) {
        for (const basename of CONFIG_BASENAMES) {
            const uri = subdir
                ? vscode.Uri.joinPath(workspaceFolder, subdir, basename)
                : vscode.Uri.joinPath(workspaceFolder, basename);
            const relativePath = subdir ? `${subdir}/${basename}` : basename;
            candidates.push({ uri, filename: basename, relativePath });
        }
    }

    for (const { uri, filename, relativePath } of candidates) {
        try {
            outputChannel.appendLine(`Dev Setup: Checking for config file: ${relativePath}`);
            const fileData = await readFileWithTimeout(uri);
            const config = filename.endsWith('.json')
                ? parseJsonConfig(fileData, outputChannel)
                : parseYamlConfig(fileData, outputChannel);
            const directory = vscode.Uri.joinPath(uri, '..').fsPath;
            outputChannel.appendLine(`Dev Setup: Found configuration file: ${relativePath}`);
            return { config, directory, filename };
        } catch (e: unknown) {
            // If the file doesn't exist, continue to the next candidate
            if (e instanceof vscode.FileSystemError && e.code === 'FileNotFound') {
                continue;
            }
            // Re-throw parse errors, permission errors, or other unexpected errors
            throw e;
        }
    }

    outputChannel.appendLine(`Dev Setup: No configuration file found in workspace "${folderName}"`);
    return undefined;
}
