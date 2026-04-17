import * as assert from 'assert';
import { EventEmitter, Readable } from 'stream';
import { mergeBatchedSecrets, runScript, setSpawnImplForTests, SpawnFn } from '../../runners/scriptRunner';
import { BatchedSecretEntry } from '../../config/configTypes';
import { createFakeOutputChannel } from '../helpers/fakeOutputChannel';

/**
 * Minimal fake ChildProcess — an EventEmitter with stdout/stderr Readables.
 * Tests drive it by emitting data and then a 'close' event.
 */
interface FakeChild extends EventEmitter {
    stdout: Readable;
    stderr: Readable;
    emitStdout(chunk: string): void;
    emitStderr(chunk: string): void;
    finish(code: number): void;
}

function createFakeChild(): FakeChild {
    const ee = new EventEmitter() as FakeChild;
    const stdout = new Readable({ read(): void { /* push via emit */ } });
    const stderr = new Readable({ read(): void { /* push via emit */ } });
    stdout.setEncoding = (): Readable => stdout;
    stderr.setEncoding = (): Readable => stderr;
    ee.stdout = stdout;
    ee.stderr = stderr;
    ee.emitStdout = (chunk: string): void => { stdout.emit('data', chunk); };
    ee.emitStderr = (chunk: string): void => { stderr.emit('data', chunk); };
    ee.finish = (code: number): void => { ee.emit('close', code); };
    return ee;
}

suite('scriptRunner', () => {

    // ── mergeBatchedSecrets ──────────────────────────────────────────

    suite('mergeBatchedSecrets', () => {

        test('single batch returns all secrets', () => {
            const batches: BatchedSecretEntry[] = [
                { batchName: 'dev', secrets: { A: '1', B: '2', C: '3' } },
            ];
            assert.deepStrictEqual(
                mergeBatchedSecrets(batches),
                { A: '1', B: '2', C: '3' },
            );
        });

        test('multiple batches merge all unique keys', () => {
            const batches: BatchedSecretEntry[] = [
                { batchName: 'dev', secrets: { A: '1', B: '2' } },
                { batchName: 'ci', secrets: { C: '3', D: '4' } },
            ];
            assert.deepStrictEqual(
                mergeBatchedSecrets(batches),
                { A: '1', B: '2', C: '3', D: '4' },
            );
        });

        test('first-writer-wins on duplicate keys', () => {
            const batches: BatchedSecretEntry[] = [
                { batchName: 'dev', secrets: { KEY: 'a' } },
                { batchName: 'ci', secrets: { KEY: 'b' } },
            ];
            const result = mergeBatchedSecrets(batches);
            assert.strictEqual(result['KEY'], 'a');
            assert.strictEqual(Object.keys(result).length, 1);
        });

        test('empty batches array returns empty record', () => {
            assert.deepStrictEqual(mergeBatchedSecrets([]), {});
        });

        test('batch with empty secrets contributes nothing', () => {
            const batches: BatchedSecretEntry[] = [
                { batchName: 'x', secrets: {} },
            ];
            assert.deepStrictEqual(mergeBatchedSecrets(batches), {});
        });
    });

    // ── runScript ────────────────────────────────────────────────────

    suite('runScript', () => {
        let spawnCalls: Array<{ command: string; options: any }>;
        let child: FakeChild;

        setup(() => {
            spawnCalls = [];
            child = createFakeChild();
            const fake: SpawnFn = (command, options) => {
                spawnCalls.push({ command, options });
                return child as unknown as import('child_process').ChildProcessWithoutNullStreams;
            };
            setSpawnImplForTests(fake);
        });

        teardown(() => {
            setSpawnImplForTests(null);
        });

        test('spawns with shell:true, correct cwd, and merged env', async () => {
            const fakeOutput = createFakeOutputChannel();
            const batches: BatchedSecretEntry[] = [
                { batchName: 'dev', secrets: { DB_HOST: 'localhost', API_KEY: 'sk-123' } },
            ];

            const promise = runScript('npm start', '/my/project', batches, fakeOutput);
            child.finish(0);
            const code = await promise;

            assert.strictEqual(code, 0);
            assert.strictEqual(spawnCalls.length, 1);
            assert.strictEqual(spawnCalls[0].command, 'npm start');
            assert.strictEqual(spawnCalls[0].options.cwd, '/my/project');
            assert.strictEqual(spawnCalls[0].options.shell, true);
            assert.strictEqual(spawnCalls[0].options.env.DB_HOST, 'localhost');
            assert.strictEqual(spawnCalls[0].options.env.API_KEY, 'sk-123');
        });

        test('streams stdout line-by-line into output channel', async () => {
            const fakeOutput = createFakeOutputChannel();

            const promise = runScript('echo hi', '/w', [], fakeOutput);
            child.emitStdout('hello\nworld\npart');
            child.emitStdout('ial-rest\n');
            child.finish(0);
            await promise;

            const lines = fakeOutput.getLines();
            assert.ok(lines.includes('hello'));
            assert.ok(lines.includes('world'));
            assert.ok(lines.includes('partial-rest'));
        });

        test('streams stderr into output channel too', async () => {
            const fakeOutput = createFakeOutputChannel();

            const promise = runScript('bad', '/w', [], fakeOutput);
            child.emitStderr('oops\n');
            child.finish(1);
            const code = await promise;

            assert.strictEqual(code, 1);
            assert.ok(fakeOutput.getLines().includes('oops'));
        });

        test('flushes residual buffer without trailing newline on close', async () => {
            const fakeOutput = createFakeOutputChannel();

            const promise = runScript('x', '/w', [], fakeOutput);
            child.emitStdout('no-newline-tail');
            child.finish(0);
            await promise;

            assert.ok(fakeOutput.getLines().includes('no-newline-tail'));
        });

        test('logs exit code', async () => {
            const fakeOutput = createFakeOutputChannel();

            const promise = runScript('x', '/w', [], fakeOutput);
            child.finish(7);
            await promise;

            assert.ok(
                fakeOutput.getLines().some(l => l.includes('exited with code 7')),
            );
        });

        test('does NOT create a VS Code terminal', async () => {
            // Sanity: the runner must no longer touch vscode.window.createTerminal.
            // We verify indirectly by checking no such call path: we simply
            // assert the spawn mock was used and nothing threw.
            const fakeOutput = createFakeOutputChannel();
            const promise = runScript('x', '/w', [], fakeOutput);
            child.finish(0);
            await promise;
            assert.strictEqual(spawnCalls.length, 1);
        });

        test('resolves -1 and logs on spawn throw', async () => {
            const fakeOutput = createFakeOutputChannel();
            setSpawnImplForTests(() => {
                throw new Error('ENOENT');
            });

            const code = await runScript('x', '/w', [], fakeOutput);

            assert.strictEqual(code, -1);
            assert.ok(
                fakeOutput.getLines().some(l => l.includes('Failed to spawn') && l.includes('ENOENT')),
            );
        });
    });
});
