import * as vscode from 'vscode';
import { ConfigLocation } from './configTypes';
import { parseConfig } from './configParser';

const CONFIG_FILENAME = 'dev-setup.json';

/**
 * Search for dev-setup.json in the workspace root first, then in the dev/ subfolder.
 * Returns the first match or undefined if not found.
 */
export async function findConfig(workspaceFolder: vscode.Uri): Promise<ConfigLocation | undefined> {
    const candidates = [
        vscode.Uri.joinPath(workspaceFolder, CONFIG_FILENAME),
        vscode.Uri.joinPath(workspaceFolder, 'dev', CONFIG_FILENAME),
    ];

    for (const uri of candidates) {
        try {
            const fileData = await vscode.workspace.fs.readFile(uri);
            const config = parseConfig(fileData);
            const directory = vscode.Uri.joinPath(uri, '..').fsPath;
            return { config, directory };
        } catch (e: any) {
            // If the file doesn't exist, continue to the next candidate
            if (e instanceof vscode.FileSystemError && e.code === 'FileNotFound') {
                continue;
            }
            // Re-throw parse errors, permission errors, or other unexpected errors
            throw e;
        }
    }

    return undefined;
}
