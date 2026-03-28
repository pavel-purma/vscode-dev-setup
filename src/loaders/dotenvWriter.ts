import * as vscode from 'vscode';
import { SecretMap } from '../config/configTypes';

/**
 * Write a SecretMap to a .env file in the given directory.
 * Values containing spaces, special characters, or quotes are wrapped in double quotes.
 */
export async function writeDotenv(directory: string, secrets: SecretMap, outputChannel: vscode.OutputChannel): Promise<string> {
    const keys = Object.keys(secrets).sort();
    const envUri = vscode.Uri.joinPath(vscode.Uri.file(directory), '.env');

    outputChannel.appendLine(`Dev Setup: Writing ${keys.length} secrets to .env file at "${envUri.fsPath}"`);

    const lines: string[] = [];

    for (const key of keys) {
        const value = secrets[key];
        lines.push(`${key}=${quoteValue(value)}`);
    }

    const content = lines.join('\n') + '\n';

    await vscode.workspace.fs.writeFile(envUri, new TextEncoder().encode(content));

    outputChannel.appendLine(`Dev Setup: .env file written successfully at "${envUri.fsPath}"`);
    return envUri.fsPath;
}

/**
 * Quote a value for .env format.
 * Wraps in double quotes if the value contains spaces, quotes, newlines, or #.
 * Escapes inner double quotes and backslashes.
 */
function quoteValue(value: string): string {
    if (/[\s"'\\#\n\r]/.test(value) || value.length === 0) {
        const escaped = value
            .replace(/\\/g, '\\\\')
            .replace(/"/g, '\\"')
            .replace(/\n/g, '\\n')
            .replace(/\r/g, '\\r');
        return `"${escaped}"`;
    }
    return value;
}
