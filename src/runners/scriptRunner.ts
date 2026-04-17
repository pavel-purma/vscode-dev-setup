import * as vscode from 'vscode';
import { spawn, SpawnOptionsWithoutStdio } from 'child_process';
import { BatchedSecretEntry } from '../config/configTypes';

/**
 * Merges all batched secret entries into a single flat record.
 * First-writer-wins: if a key appears in multiple batches, the first occurrence is kept.
 */
export function mergeBatchedSecrets(batches: BatchedSecretEntry[]): Record<string, string> {
    const merged: Record<string, string> = {};
    for (const batch of batches) {
        for (const [key, value] of Object.entries(batch.secrets)) {
            if (!(key in merged)) {
                merged[key] = value;
            }
        }
    }
    return merged;
}

/**
 * Injectable spawn function — overridable for tests. Defaults to Node's
 * `child_process.spawn`. In remote scenarios (Remote-SSH, WSL, Dev Containers)
 * this runs on the remote extension host, which is exactly where we want
 * the script to execute.
 */
export type SpawnFn = (
    command: string,
    options: SpawnOptionsWithoutStdio,
) => import('child_process').ChildProcessWithoutNullStreams;

let spawnImpl: SpawnFn = (command, options) => spawn(command, options);

/**
 * Override the spawn implementation. Intended for tests only.
 */
export function setSpawnImplForTests(impl: SpawnFn | null): void {
    spawnImpl = impl ?? ((command, options) => spawn(command, options));
}

/**
 * Split a chunk of output into lines, carrying any trailing partial line
 * forward for the next chunk. Returns the completed lines and the new
 * residual buffer.
 */
function splitLines(buffer: string, chunk: string): { lines: string[]; residual: string } {
    const combined = buffer + chunk;
    const parts = combined.split(/\r?\n/);
    const residual = parts.pop() ?? '';
    return { lines: parts, residual };
}

/**
 * Run a script command as a headless child process with secrets injected
 * as environment variables. All stdout/stderr is streamed line-by-line
 * into the provided output channel — no visible terminal is created.
 *
 * The process runs on whatever machine hosts the extension (local, or the
 * remote side of a Remote-SSH/WSL/Dev Container session), using the
 * platform's default shell.
 *
 * @param script       Shell command to execute.
 * @param cwd          Working directory.
 * @param batches      Batched secrets to merge and inject as env vars.
 * @param outputChannel Dev Setup output channel; receives all script output.
 * @returns Exit code of the script (non-zero on failure; -1 on spawn error).
 */
export async function runScript(
    script: string,
    cwd: string,
    batches: BatchedSecretEntry[],
    outputChannel: vscode.OutputChannel,
): Promise<number> {
    const secretEnv = mergeBatchedSecrets(batches);
    const env = { ...process.env, ...secretEnv };

    outputChannel.appendLine(
        `[script-runner] Running script in ${cwd} (hidden, output streamed here)`,
    );
    outputChannel.appendLine(
        `[script-runner] Injecting ${Object.keys(secretEnv).length} environment variable(s)`,
    );
    outputChannel.appendLine(`[script-runner] $ ${script}`);

    return await new Promise<number>((resolve) => {
        let child: import('child_process').ChildProcessWithoutNullStreams;
        try {
            child = spawnImpl(script, {
                cwd,
                env,
                shell: true,
            });
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            outputChannel.appendLine(`[script-runner] Failed to spawn: ${msg}`);
            resolve(-1);
            return;
        }

        let stdoutBuf = '';
        let stderrBuf = '';

        child.stdout.setEncoding('utf8');
        child.stderr.setEncoding('utf8');

        child.stdout.on('data', (chunk: string) => {
            const { lines, residual } = splitLines(stdoutBuf, chunk);
            stdoutBuf = residual;
            for (const line of lines) {
                outputChannel.appendLine(line);
            }
        });

        child.stderr.on('data', (chunk: string) => {
            const { lines, residual } = splitLines(stderrBuf, chunk);
            stderrBuf = residual;
            for (const line of lines) {
                outputChannel.appendLine(line);
            }
        });

        child.on('error', (err: Error) => {
            outputChannel.appendLine(`[script-runner] Error: ${err.message}`);
            resolve(-1);
        });

        child.on('close', (code: number | null) => {
            if (stdoutBuf) {
                outputChannel.appendLine(stdoutBuf);
                stdoutBuf = '';
            }
            if (stderrBuf) {
                outputChannel.appendLine(stderrBuf);
                stderrBuf = '';
            }
            const exitCode = code ?? -1;
            outputChannel.appendLine(`[script-runner] Script exited with code ${exitCode}`);
            resolve(exitCode);
        });
    });
}
