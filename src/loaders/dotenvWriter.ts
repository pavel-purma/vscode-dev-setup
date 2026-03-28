import * as vscode from 'vscode';
import { BatchedSecretEntry } from '../config/configTypes';

/**
 * Write batched secrets to a .env file in the given directory.
 * Secrets are grouped by batch with comment headers. First-writer-wins
 * deduplication is applied: if a key was already written by an earlier batch,
 * a duplicate comment is emitted instead of the key-value pair.
 *
 * @param directory - Absolute path of the directory to write the .env file in
 * @param batches - Ordered list of batched secret entries
 * @param outputChannel - Output channel for logging
 * @returns The absolute path of the written .env file
 */
export async function writeDotenv(
    directory: string,
    batches: BatchedSecretEntry[],
    outputChannel: vscode.OutputChannel,
): Promise<string> {
    const envUri = vscode.Uri.joinPath(vscode.Uri.file(directory), '.env');

    const seenKeys = new Set<string>();
    const firstBatchByKey = new Map<string, string>();
    const sections: string[] = [];

    for (const { batchName, secrets } of batches) {
        const sectionLines: string[] = [];
        sectionLines.push(`# Doppler: ${batchName}`);

        const allKeys = Object.keys(secrets).sort();
        const duplicateKeys: string[] = [];
        const newKeys: string[] = [];

        for (const key of allKeys) {
            if (seenKeys.has(key)) {
                duplicateKeys.push(key);
            } else {
                newKeys.push(key);
            }
        }

        for (const key of duplicateKeys) {
            const firstBatch = firstBatchByKey.get(key)!;
            sectionLines.push(`# ${key}: duplicate, already defined in "${firstBatch}"`);
        }

        for (const key of newKeys) {
            const value = secrets[key];
            sectionLines.push(`${key}=${quoteValue(value)}`);
            seenKeys.add(key);
            firstBatchByKey.set(key, batchName);
        }

        sections.push(sectionLines.join('\n'));
    }

    const totalKeys = seenKeys.size;
    outputChannel.appendLine(`Dev Setup: Writing ${totalKeys} secrets to .env file at "${envUri.fsPath}"`);

    const content = sections.join('\n\n') + '\n';

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
