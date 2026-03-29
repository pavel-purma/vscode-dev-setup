import * as assert from 'assert';
import * as vscode from 'vscode';
import { mergeBatchedSecrets, runScript } from '../../runners/scriptRunner';
import { BatchedSecretEntry } from '../../config/configTypes';
import { createFakeOutputChannel } from '../helpers/fakeOutputChannel';

suite('scriptRunner', () => {

    // ── mergeBatchedSecrets ──────────────────────────────────────────

    suite('mergeBatchedSecrets', () => {

        test('single batch returns all secrets', () => {
            const batches: BatchedSecretEntry[] = [
                {
                    batchName: 'dev',
                    secrets: { A: '1', B: '2', C: '3' },
                },
            ];

            const result = mergeBatchedSecrets(batches);

            assert.deepStrictEqual(result, { A: '1', B: '2', C: '3' });
        });

        test('multiple batches merge all unique keys', () => {
            const batches: BatchedSecretEntry[] = [
                {
                    batchName: 'dev',
                    secrets: { A: '1', B: '2' },
                },
                {
                    batchName: 'ci',
                    secrets: { C: '3', D: '4' },
                },
            ];

            const result = mergeBatchedSecrets(batches);

            assert.deepStrictEqual(result, { A: '1', B: '2', C: '3', D: '4' });
        });

        test('first-writer-wins on duplicate keys', () => {
            const batches: BatchedSecretEntry[] = [
                {
                    batchName: 'dev',
                    secrets: { KEY: 'a' },
                },
                {
                    batchName: 'ci',
                    secrets: { KEY: 'b' },
                },
            ];

            const result = mergeBatchedSecrets(batches);

            assert.strictEqual(result['KEY'], 'a', 'First batch value should win');
            assert.strictEqual(Object.keys(result).length, 1);
        });

        test('empty batches array returns empty record', () => {
            const result = mergeBatchedSecrets([]);

            assert.deepStrictEqual(result, {});
        });

        test('batch with empty secrets contributes nothing', () => {
            const batches: BatchedSecretEntry[] = [
                {
                    batchName: 'x',
                    secrets: {},
                },
            ];

            const result = mergeBatchedSecrets(batches);

            assert.deepStrictEqual(result, {});
        });
    });

    // ── runScript ────────────────────────────────────────────────────

    suite('runScript', () => {
        let terminalOptions: any[];
        let sentTexts: string[];
        let showCalls: number;
        let origCreateTerminal: typeof vscode.window.createTerminal;

        const fakeTerminal: vscode.Terminal = {
            show: () => { showCalls++; },
            sendText: (text: string) => { sentTexts.push(text); },
            name: 'fake',
            processId: Promise.resolve(undefined),
            creationOptions: {},
            exitStatus: undefined,
            state: { isInteractedWith: false, shell: undefined },
            dispose: () => {},
            hide: () => {},
            shellIntegration: undefined,
        };

        setup(() => {
            terminalOptions = [];
            sentTexts = [];
            showCalls = 0;
            origCreateTerminal = vscode.window.createTerminal;
            (vscode.window as any).createTerminal = (opts: any) => {
                terminalOptions.push(opts);
                return fakeTerminal;
            };
        });

        teardown(() => {
            (vscode.window as any).createTerminal = origCreateTerminal;
        });

        test('creates terminal with correct name', () => {
            const fakeOutput = createFakeOutputChannel();

            runScript('npm start', '/workspace', [], fakeOutput);

            assert.strictEqual(terminalOptions.length, 1);
            assert.strictEqual(terminalOptions[0].name, 'Dev Setup: npm start');
        });

        test('truncates long script names', () => {
            const fakeOutput = createFakeOutputChannel();
            // A 40-character script
            const longScript = 'a234567890123456789012345678901234567890';
            assert.strictEqual(longScript.length, 40, 'Test script should be 40 chars');

            runScript(longScript, '/workspace', [], fakeOutput);

            assert.strictEqual(terminalOptions.length, 1);
            const expectedName = `Dev Setup: ${longScript.substring(0, 27)}...`;
            assert.strictEqual(
                terminalOptions[0].name,
                expectedName,
                'Terminal name should be truncated at 27 chars with ellipsis',
            );
        });

        test('injects merged secrets as env vars', () => {
            const fakeOutput = createFakeOutputChannel();
            const batches: BatchedSecretEntry[] = [
                {
                    batchName: 'dev',
                    secrets: { DB_HOST: 'localhost', API_KEY: 'sk-123' },
                },
            ];

            runScript('npm start', '/workspace', batches, fakeOutput);

            assert.strictEqual(terminalOptions.length, 1);
            assert.deepStrictEqual(terminalOptions[0].env, {
                DB_HOST: 'localhost',
                API_KEY: 'sk-123',
            });
        });

        test('sets cwd correctly', () => {
            const fakeOutput = createFakeOutputChannel();

            runScript('npm start', '/my/project', [], fakeOutput);

            assert.strictEqual(terminalOptions.length, 1);
            assert.strictEqual(terminalOptions[0].cwd, '/my/project');
        });

        test('calls show() and sendText()', () => {
            const fakeOutput = createFakeOutputChannel();

            runScript('npm start', '/workspace', [], fakeOutput);

            assert.strictEqual(showCalls, 1, 'show() should be called once');
            assert.deepStrictEqual(sentTexts, ['npm start'], 'sendText should receive the script');
        });

        test('logs to output channel', () => {
            const fakeOutput = createFakeOutputChannel();
            const batches: BatchedSecretEntry[] = [
                {
                    batchName: 'dev',
                    secrets: { A: '1', B: '2' },
                },
            ];

            runScript('npm start', '/workspace', batches, fakeOutput);

            const logLines = fakeOutput.getLines();
            assert.ok(
                logLines.some(l => l.includes('Creating terminal')),
                'Output should log terminal creation',
            );
            assert.ok(
                logLines.some(l => l.includes('2 environment variable(s)')),
                'Output should log env var count',
            );
        });
    });
});
