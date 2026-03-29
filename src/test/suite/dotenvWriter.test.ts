import * as assert from 'assert';
import * as vscode from 'vscode';
import { BatchedSecretEntry } from '../../config/configTypes';
import { writeDotenv } from '../../loaders/dotenvWriter';
import { createFakeOutputChannel } from '../helpers/fakeOutputChannel';
import {
    createTempWorkspace,
    cleanupTempWorkspace,
} from '../helpers/tempWorkspace';
import { resetConcurrencyGuard } from '../../pipeline/secretsPipeline';

suite('.env Writing', () => {
    let tempDir: string;

    setup(async () => {
        tempDir = await createTempWorkspace();
        resetConcurrencyGuard();
    });

    teardown(async () => {
        resetConcurrencyGuard();
        await cleanupTempWorkspace(tempDir);
    });

    // ── .env Writing ────────────────────────────────────────────────

    test('should write .env file with sorted keys and batch header', async () => {
        const batches: BatchedSecretEntry[] = [
            {
                batchName: 'my-project:dev',
                secrets: {
                    ZEBRA: 'z-value',
                    ALPHA: 'a-value',
                    MIDDLE: 'm-value',
                },
            },
        ];

        const fakeOutput = createFakeOutputChannel();
        await writeDotenv(tempDir, batches, fakeOutput, 'Doppler');

        const envUri = vscode.Uri.joinPath(vscode.Uri.file(tempDir), '.env');
        const content = new TextDecoder().decode(
            await vscode.workspace.fs.readFile(envUri),
        );

        const lines = content.split('\n');
        assert.strictEqual(lines[0], '# Doppler: my-project:dev');
        assert.strictEqual(lines[1], 'ALPHA=a-value');
        assert.strictEqual(lines[2], 'MIDDLE=m-value');
        assert.strictEqual(lines[3], 'ZEBRA=z-value');
        assert.strictEqual(lines[4], '', 'File should end with trailing newline');
    });

    test('should quote values containing special characters', async () => {
        const batches: BatchedSecretEntry[] = [
            {
                batchName: 'test:dev',
                secrets: {
                    SIMPLE: 'no-special',
                    SPACES: 'hello world',
                    EMPTY: '',
                    HASH: 'value#with-hash',
                    NEWLINE: 'line1\nline2',
                },
            },
        ];

        const fakeOutput = createFakeOutputChannel();
        await writeDotenv(tempDir, batches, fakeOutput, 'Doppler');

        const envUri = vscode.Uri.joinPath(vscode.Uri.file(tempDir), '.env');
        const content = new TextDecoder().decode(
            await vscode.workspace.fs.readFile(envUri),
        );

        const lines = content.split('\n');
        // Line 0: batch header, then keys sorted: EMPTY, HASH, NEWLINE, SIMPLE, SPACES
        assert.strictEqual(lines[0], '# Doppler: test:dev');
        assert.strictEqual(lines[1], 'EMPTY=""', 'Empty values should be quoted');
        assert.strictEqual(lines[2], 'HASH="value#with-hash"', 'Hash values should be quoted');
        assert.strictEqual(lines[3], 'NEWLINE="line1\\nline2"', 'Newlines should be escaped');
        assert.strictEqual(lines[4], 'SIMPLE=no-special', 'Simple values should not be quoted');
        assert.strictEqual(lines[5], 'SPACES="hello world"', 'Spaces should be quoted');
    });

    // ── Multi-Batch Merge ───────────────────────────────────────────

    test('should merge multiple batches with first-writer-wins deduplication', async () => {
        const batches: BatchedSecretEntry[] = [
            {
                batchName: 'my-project:dev',
                secrets: {
                    SHARED: 'dev-val',
                    DEV_ONLY: 'dev-only',
                },
            },
            {
                batchName: 'my-project:ci',
                secrets: {
                    SHARED: 'ci-val',
                    CI_ONLY: 'ci-only',
                },
            },
        ];

        const fakeOutput = createFakeOutputChannel();
        await writeDotenv(tempDir, batches, fakeOutput, 'Doppler');

        const envUri = vscode.Uri.joinPath(vscode.Uri.file(tempDir), '.env');
        const content = new TextDecoder().decode(
            await vscode.workspace.fs.readFile(envUri),
        );

        // Expected format:
        // # Doppler: my-project:dev
        // DEV_ONLY=dev-only
        // SHARED=dev-val
        //
        // # Doppler: my-project:ci
        // # SHARED: duplicate, already defined in "my-project:dev"
        // CI_ONLY=ci-only
        const expectedEnv = [
            '# Doppler: my-project:dev',
            'DEV_ONLY=dev-only',
            'SHARED=dev-val',
            '',
            '# Doppler: my-project:ci',
            '# SHARED: duplicate, already defined in "my-project:dev"',
            'CI_ONLY=ci-only',
            '',
        ].join('\n');

        assert.strictEqual(content, expectedEnv, '.env should use first-writer-wins with duplicate comments');
    });

    // ── Infisical .env Writing ────────────────────────────────────────

    test('should write .env file with Infisical batch header', async () => {
        const batches: BatchedSecretEntry[] = [
            {
                batchName: 'dev',
                secrets: {
                    ZEBRA: 'z-value',
                    ALPHA: 'a-value',
                    MIDDLE: 'm-value',
                },
            },
        ];

        const fakeOutput = createFakeOutputChannel();
        await writeDotenv(tempDir, batches, fakeOutput, 'Infisical');

        const envUri = vscode.Uri.joinPath(vscode.Uri.file(tempDir), '.env');
        const content = new TextDecoder().decode(
            await vscode.workspace.fs.readFile(envUri),
        );

        const lines = content.split('\n');
        assert.strictEqual(lines[0], '# Infisical: dev', 'Header should use Infisical provider name');
        assert.strictEqual(lines[1], 'ALPHA=a-value');
        assert.strictEqual(lines[2], 'MIDDLE=m-value');
        assert.strictEqual(lines[3], 'ZEBRA=z-value');
        assert.strictEqual(lines[4], '', 'File should end with trailing newline');
    });

    test('should merge Infisical batches with first-writer-wins deduplication', async () => {
        const batches: BatchedSecretEntry[] = [
            {
                batchName: 'dev',
                secrets: {
                    SHARED: 'dev-val',
                    DEV_ONLY: 'dev-only',
                },
            },
            {
                batchName: 'staging',
                secrets: {
                    SHARED: 'staging-val',
                    STAGING_ONLY: 'staging-only',
                },
            },
        ];

        const fakeOutput = createFakeOutputChannel();
        await writeDotenv(tempDir, batches, fakeOutput, 'Infisical');

        const envUri = vscode.Uri.joinPath(vscode.Uri.file(tempDir), '.env');
        const content = new TextDecoder().decode(
            await vscode.workspace.fs.readFile(envUri),
        );

        const expectedEnv = [
            '# Infisical: dev',
            'DEV_ONLY=dev-only',
            'SHARED=dev-val',
            '',
            '# Infisical: staging',
            '# SHARED: duplicate, already defined in "dev"',
            'STAGING_ONLY=staging-only',
            '',
        ].join('\n');

        assert.strictEqual(content, expectedEnv, 'Infisical .env should use first-writer-wins with duplicate comments');
    });
});
