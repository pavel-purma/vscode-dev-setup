import * as os from 'os';
import * as path from 'path';
import * as crypto from 'crypto';
import * as vscode from 'vscode';

/**
 * Create an isolated temporary directory for use as a fake workspace root.
 * The directory name includes a random UUID to prevent collisions between
 * concurrent test runs.
 *
 * @returns The absolute path of the newly created temp directory.
 */
export async function createTempWorkspace(): Promise<string> {
    const id = crypto.randomUUID();
    const dir = path.join(os.tmpdir(), `vscode-dev-setup-test-${id}`);
    const uri = vscode.Uri.file(dir);
    await vscode.workspace.fs.createDirectory(uri);
    return dir;
}

/**
 * Write a `dev-setup.json` config file into the given base directory,
 * optionally inside a subdirectory (e.g. `'dev'`).
 *
 * @param baseDir - Root of the temp workspace.
 * @param config - The configuration object to serialize as JSON.
 * @param subdir - Optional subdirectory to place the config file in.
 */
export async function writeConfigFile(
    baseDir: string,
    config: object,
    subdir?: string,
): Promise<void> {
    const targetDir = subdir
        ? path.join(baseDir, subdir)
        : baseDir;
    const dirUri = vscode.Uri.file(targetDir);
    await vscode.workspace.fs.createDirectory(dirUri);

    const fileUri = vscode.Uri.joinPath(dirUri, 'dev-setup.json');
    const content = new TextEncoder().encode(JSON.stringify(config, null, 2));
    await vscode.workspace.fs.writeFile(fileUri, content);
}

/**
 * Recursively delete a temporary workspace directory created by
 * `createTempWorkspace()`.
 *
 * @param dir - Absolute path of the directory to remove.
 */
export async function cleanupTempWorkspace(dir: string): Promise<void> {
    const uri = vscode.Uri.file(dir);
    try {
        await vscode.workspace.fs.delete(uri, { recursive: true });
    } catch {
        // Best-effort cleanup — the OS will eventually clean tmpdir
    }
}
