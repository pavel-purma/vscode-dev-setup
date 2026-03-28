import * as os from 'os';
import * as path from 'path';
import * as crypto from 'crypto';
import * as vscode from 'vscode';
import { stringify as stringifyYaml } from 'yaml';

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
 * optionally inside a subdirectory (e.g. `'.dev'`).
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
 * Write a YAML config file into the given base directory,
 * optionally inside a subdirectory (e.g. `'.dev'`).
 *
 * @param baseDir - Root of the temp workspace.
 * @param config - The configuration object to serialize as YAML.
 * @param filename - Name of the file to write (e.g. `'dev-setup.yaml'` or `'dev-setup.yml'`).
 * @param subdir - Optional subdirectory to place the config file in.
 */
export async function writeYamlConfigFile(
    baseDir: string,
    config: object,
    filename: string,
    subdir?: string,
): Promise<void> {
    const targetDir = subdir
        ? path.join(baseDir, subdir)
        : baseDir;
    const dirUri = vscode.Uri.file(targetDir);
    await vscode.workspace.fs.createDirectory(dirUri);

    const fileUri = vscode.Uri.joinPath(dirUri, filename);
    const content = new TextEncoder().encode(stringifyYaml(config));
    await vscode.workspace.fs.writeFile(fileUri, content);
}

/**
 * Write a raw text file into the given base directory,
 * optionally inside a subdirectory. Useful for testing invalid file content.
 *
 * @param baseDir - Root of the temp workspace.
 * @param filename - Name of the file to write.
 * @param rawContent - Raw string content to write.
 * @param subdir - Optional subdirectory to place the file in.
 */
export async function writeRawConfigFile(
    baseDir: string,
    filename: string,
    rawContent: string,
    subdir?: string,
): Promise<void> {
    const targetDir = subdir
        ? path.join(baseDir, subdir)
        : baseDir;
    const dirUri = vscode.Uri.file(targetDir);
    await vscode.workspace.fs.createDirectory(dirUri);

    const fileUri = vscode.Uri.joinPath(dirUri, filename);
    const content = new TextEncoder().encode(rawContent);
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
