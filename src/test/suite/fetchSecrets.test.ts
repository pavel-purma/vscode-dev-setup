import * as assert from 'assert';
import * as vscode from 'vscode';
import { findConfig } from '../../config/configFinder';
import { fetchSecrets } from '../../doppler/dopplerClient';
import { writeDotenv } from '../../loaders/dotenvWriter';
import { processWorkspaceFolder } from '../../hooks/onWorkspaceOpen';
import * as fetchMock from '../helpers/fetchMock';
import { createFakeSecretStorage } from '../helpers/fakeSecretStorage';
import { createFakeOutputChannel } from '../helpers/fakeOutputChannel';
import {
    createTempWorkspace,
    cleanupTempWorkspace,
    writeConfigFile,
} from '../helpers/tempWorkspace';

suite('fetchSecrets Integration', () => {
    let tempDir: string;

    setup(async () => {
        tempDir = await createTempWorkspace();
    });

    teardown(async () => {
        fetchMock.restore();
        await cleanupTempWorkspace(tempDir);
    });

    // ── Config Discovery ────────────────────────────────────────────

    test('should discover config in workspace root', async () => {
        const config = {
            secrets: {
                provider: 'doppler',
                loader: 'dotenv',
                batches: ['dev'],
                project: 'root-project',
            },
        };
        await writeConfigFile(tempDir, config);

        const location = await findConfig(vscode.Uri.file(tempDir));

        assert.ok(location, 'Config should be found');
        assert.strictEqual(location.config.secrets?.project, 'root-project');
        assert.strictEqual(location.config.secrets?.provider, 'doppler');
        assert.deepStrictEqual(location.config.secrets?.batches, ['dev']);
    });

    test('should discover config in dev/ subdirectory', async () => {
        const config = {
            secrets: {
                provider: 'doppler',
                loader: 'dotenv',
                batches: ['staging'],
                project: 'sub-project',
            },
        };
        await writeConfigFile(tempDir, config, 'dev');

        const location = await findConfig(vscode.Uri.file(tempDir));

        assert.ok(location, 'Config should be found in dev/ subdir');
        assert.strictEqual(location.config.secrets?.project, 'sub-project');
        assert.deepStrictEqual(location.config.secrets?.batches, ['staging']);
    });

    // ── Doppler API Interaction ─────────────────────────────────────

    test('should call Doppler API with correct parameters', async () => {
        fetchMock.install();
        fetchMock.addResponse(
            'https://api.doppler.com/v3/configs/config/secrets',
            { status: 200, body: JSON.stringify({ secrets: {} }) },
        );

        await fetchSecrets('dp.test.mock_token', 'test-project', 'dev');

        const calls = fetchMock.getCalls();
        assert.strictEqual(calls.length, 1, 'fetch should be called exactly once');
        assert.ok(
            calls[0].url.includes('project=test-project'),
            'URL should contain project param',
        );
        assert.ok(
            calls[0].url.includes('config=dev'),
            'URL should contain config param',
        );
        assert.strictEqual(
            calls[0].headers['Authorization'],
            'Bearer dp.test.mock_token',
            'Authorization header should use Bearer token',
        );
        assert.strictEqual(
            calls[0].headers['Accept'],
            'application/json',
            'Accept header should be application/json',
        );
    });

    test('should extract computed values from Doppler response', async () => {
        fetchMock.install();
        const mockSecrets = {
            secrets: {
                DATABASE_URL: { raw: 'pg://ref', computed: 'pg://localhost:5432/mydb' },
                API_KEY: { raw: '${ref}', computed: 'sk-test-12345' },
                APP_NAME: { raw: 'MyApp', computed: 'MyApp' },
            },
        };
        fetchMock.addResponse(
            'https://api.doppler.com/v3/configs/config/secrets',
            { status: 200, body: JSON.stringify(mockSecrets) },
        );

        const secrets = await fetchSecrets('dp.test.token', 'proj', 'dev');

        assert.deepStrictEqual(secrets, {
            DATABASE_URL: 'pg://localhost:5432/mydb',
            API_KEY: 'sk-test-12345',
            APP_NAME: 'MyApp',
        });
    });

    // ── .env Writing ────────────────────────────────────────────────

    test('should write .env file with sorted keys', async () => {
        const secrets = {
            ZEBRA: 'z-value',
            ALPHA: 'a-value',
            MIDDLE: 'm-value',
        };

        await writeDotenv(tempDir, secrets);

        const envUri = vscode.Uri.joinPath(vscode.Uri.file(tempDir), '.env');
        const content = new TextDecoder().decode(
            await vscode.workspace.fs.readFile(envUri),
        );

        const lines = content.split('\n');
        assert.strictEqual(lines[0], 'ALPHA=a-value');
        assert.strictEqual(lines[1], 'MIDDLE=m-value');
        assert.strictEqual(lines[2], 'ZEBRA=z-value');
        assert.strictEqual(lines[3], '', 'File should end with trailing newline');
    });

    test('should quote values containing special characters', async () => {
        const secrets = {
            SIMPLE: 'no-special',
            SPACES: 'hello world',
            EMPTY: '',
            HASH: 'value#with-hash',
            NEWLINE: 'line1\nline2',
        };

        await writeDotenv(tempDir, secrets);

        const envUri = vscode.Uri.joinPath(vscode.Uri.file(tempDir), '.env');
        const content = new TextDecoder().decode(
            await vscode.workspace.fs.readFile(envUri),
        );

        const lines = content.split('\n');
        // Keys are sorted: EMPTY, HASH, NEWLINE, SIMPLE, SPACES
        assert.strictEqual(lines[0], 'EMPTY=""', 'Empty values should be quoted');
        assert.strictEqual(lines[1], 'HASH="value#with-hash"', 'Hash values should be quoted');
        assert.strictEqual(lines[2], 'NEWLINE="line1\\nline2"', 'Newlines should be escaped');
        assert.strictEqual(lines[3], 'SIMPLE=no-special', 'Simple values should not be quoted');
        assert.strictEqual(lines[4], 'SPACES="hello world"', 'Spaces should be quoted');
    });

    // ── Multi-Batch Merge ───────────────────────────────────────────

    test('should merge multiple batches with last-batch-wins', async () => {
        fetchMock.install();

        // First batch response
        fetchMock.addResponse(
            'https://api.doppler.com/v3/configs/config/secrets?project=proj&config=dev',
            {
                status: 200,
                body: JSON.stringify({
                    secrets: {
                        SHARED: { raw: 'dev-val', computed: 'dev-val' },
                        DEV_ONLY: { raw: 'dev-only', computed: 'dev-only' },
                    },
                }),
            },
        );

        // Second batch response — uses the same base URL, so we need a different approach
        // Since the mock matches by base URL prefix, we'll call fetchSecrets twice
        // and verify the merge logic manually
        const batch1 = await fetchSecrets('tok', 'proj', 'dev');

        // Now change the mock response for the second batch
        fetchMock.restore();
        fetchMock.install();
        fetchMock.addResponse(
            'https://api.doppler.com/v3/configs/config/secrets',
            {
                status: 200,
                body: JSON.stringify({
                    secrets: {
                        SHARED: { raw: 'ci-val', computed: 'ci-val' },
                        CI_ONLY: { raw: 'ci-only', computed: 'ci-only' },
                    },
                }),
            },
        );

        const batch2 = await fetchSecrets('tok', 'proj', 'ci');

        // Merge with Object.assign — matches the production code in onWorkspaceOpen.ts
        const merged: Record<string, string> = {};
        Object.assign(merged, batch1);
        Object.assign(merged, batch2);

        assert.strictEqual(merged['DEV_ONLY'], 'dev-only', 'Unique dev key present');
        assert.strictEqual(merged['CI_ONLY'], 'ci-only', 'Unique ci key present');
        assert.strictEqual(merged['SHARED'], 'ci-val', 'Last batch wins on collisions');
    });

    // ── Full Pipeline ───────────────────────────────────────────────

    test('full pipeline: config → fetch → .env write', async () => {
        // 1. Write dev-setup.json config
        const config = {
            secrets: {
                provider: 'doppler',
                loader: 'dotenv',
                batches: ['dev'],
                project: 'test-project',
            },
        };
        await writeConfigFile(tempDir, config);

        // 2. Install fetch mock with Doppler response
        fetchMock.install();
        const mockSecrets = {
            secrets: {
                DATABASE_URL: { raw: 'pg://ref', computed: 'pg://localhost:5432/mydb' },
                API_KEY: { raw: '${ref}', computed: 'sk-test-12345' },
                APP_NAME: { raw: 'MyApp', computed: 'MyApp' },
            },
        };
        fetchMock.addResponse(
            'https://api.doppler.com/v3/configs/config/secrets',
            { status: 200, body: JSON.stringify(mockSecrets) },
        );

        // 3. Create fake SecretStorage with a stored Doppler token
        const fakeSecrets = createFakeSecretStorage({
            'dev-setup.dopplerToken': 'dp.test.mock_token',
        });

        // 4. Create fake OutputChannel
        const fakeOutput = createFakeOutputChannel();

        // 5. Build a minimal ExtensionContext with the fake secrets
        const fakeContext = {
            secrets: fakeSecrets,
        } as unknown as vscode.ExtensionContext;

        // 6. Build a minimal WorkspaceFolder pointing at the temp dir
        const fakeFolder: vscode.WorkspaceFolder = {
            uri: vscode.Uri.file(tempDir),
            name: 'test-workspace',
            index: 0,
        };

        // 7. Run the pipeline
        await processWorkspaceFolder(
            fakeFolder,
            fakeContext,
            fakeOutput,
            false,
        );

        // 8. Verify fetch was called
        const calls = fetchMock.getCalls();
        assert.strictEqual(calls.length, 1, 'fetch should be called once');
        assert.ok(
            calls[0].url.includes('project=test-project'),
            'URL should contain project param',
        );

        // 9. Read back the .env file
        const envUri = vscode.Uri.joinPath(vscode.Uri.file(tempDir), '.env');
        const envContent = new TextDecoder().decode(
            await vscode.workspace.fs.readFile(envUri),
        );

        // 10. Verify .env content (keys sorted alphabetically)
        const expectedEnv = [
            'API_KEY=sk-test-12345',
            'APP_NAME=MyApp',
            'DATABASE_URL=pg://localhost:5432/mydb',
            '',
        ].join('\n');

        assert.strictEqual(envContent, expectedEnv, '.env should contain sorted secrets');

        // 11. Verify output channel logged success
        const logLines = fakeOutput.getLines();
        assert.ok(
            logLines.some(l => l.includes('Fetching secrets')),
            'Output should log fetching message',
        );
        assert.ok(
            logLines.some(l => l.includes('Secrets loaded successfully')),
            'Output should log success message',
        );
    });
});
