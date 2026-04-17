import * as assert from 'assert';
import * as vscode from 'vscode';
import { processWorkspaceFolder, fetchSecretsFromConfig, resetConcurrencyGuard } from '../../pipeline/secretsPipeline';
import * as fetchMock from '../helpers/fetchMock';
import { createFakeSecretStorage } from '../helpers/fakeSecretStorage';
import { createFakeOutputChannel } from '../helpers/fakeOutputChannel';
import {
    createTempWorkspace,
    cleanupTempWorkspace,
    writeConfigFile,
    writeYamlConfigFile,
} from '../helpers/tempWorkspace';
import { EventEmitter, Readable } from 'stream';
import { setSpawnImplForTests, SpawnFn } from '../../runners/scriptRunner';

suite('Doppler Pipeline Integration', () => {
    let tempDir: string;

    setup(async () => {
        tempDir = await createTempWorkspace();
        resetConcurrencyGuard();
    });

    teardown(async () => {
        fetchMock.restore();
        resetConcurrencyGuard();
        await cleanupTempWorkspace(tempDir);
    });

    // ── Full Pipeline ───────────────────────────────────────────────

    test('full pipeline: JSON config → fetch → .env write', async () => {
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

        // 10. Verify .env content (batch header + keys sorted alphabetically)
        const expectedEnv = [
            '# Doppler: dev',
            'API_KEY=sk-test-12345',
            'APP_NAME=MyApp',
            'DATABASE_URL=pg://localhost:5432/mydb',
            '',
        ].join('\n');

        assert.strictEqual(envContent, expectedEnv, '.env should contain batch header and sorted secrets');

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

    test('full pipeline: YAML config → fetch → .env write', async () => {
        // 1. Write dev-setup.yaml config
        const config = {
            secrets: {
                provider: 'doppler',
                loader: 'dotenv',
                batches: ['dev'],
                project: 'yaml-pipeline-project',
            },
        };
        await writeYamlConfigFile(tempDir, config, 'dev-setup.yaml');

        // 2. Install fetch mock with Doppler response
        fetchMock.install();
        const mockSecrets = {
            secrets: {
                DB_HOST: { raw: 'ref', computed: 'localhost' },
                DB_PORT: { raw: 'ref', computed: '5432' },
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
            name: 'yaml-test-workspace',
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
            calls[0].url.includes('project=yaml-pipeline-project'),
            'URL should contain YAML project param',
        );

        // 9. Read back the .env file
        const envUri = vscode.Uri.joinPath(vscode.Uri.file(tempDir), '.env');
        const envContent = new TextDecoder().decode(
            await vscode.workspace.fs.readFile(envUri),
        );

        // 10. Verify .env content (batch header + keys sorted alphabetically)
        const expectedEnv = [
            '# Doppler: dev',
            'DB_HOST=localhost',
            'DB_PORT=5432',
            '',
        ].join('\n');

        assert.strictEqual(envContent, expectedEnv, '.env should contain batch header and sorted secrets from YAML config');

        // 11. Verify output channel logged success
        const logLines = fakeOutput.getLines();
        assert.ok(
            logLines.some(l => l.includes('Secrets loaded successfully')),
            'Output should log success message',
        );
    });

    // ── Concurrency Guard ────────────────────────────────────────────

    test('concurrent fetchSecretsFromConfig calls should deduplicate', async () => {
        // Write a config so the pipeline has something to process
        const config = {
            secrets: {
                provider: 'doppler',
                loader: 'dotenv',
                batches: ['dev'],
                project: 'concurrency-project',
            },
        };
        await writeConfigFile(tempDir, config);

        fetchMock.install();

        let fetchCallCount = 0;
        fetchMock.addHandler(
            'https://api.doppler.com/v3/configs/config/secrets',
            async () => {
                fetchCallCount++;
                // Simulate a short delay so both calls overlap
                await new Promise<void>((resolve) => setTimeout(resolve, 100));
                return new Response(
                    JSON.stringify({ secrets: { KEY: { raw: 'v', computed: 'v' } } }),
                    { status: 200, headers: { 'Content-Type': 'application/json' } },
                );
            },
        );

        const fakeSecrets = createFakeSecretStorage({
            'dev-setup.dopplerToken': 'dp.test.mock_token',
        });
        const fakeOutput = createFakeOutputChannel();
        const fakeContext = { secrets: fakeSecrets } as unknown as vscode.ExtensionContext;

        // Stub workspaceFolders so fetchSecretsFromConfig sees our temp folder
        const originalFolders = vscode.workspace.workspaceFolders;
        const fakeFolder: vscode.WorkspaceFolder = {
            uri: vscode.Uri.file(tempDir),
            name: 'test-workspace',
            index: 0,
        };
        Object.defineProperty(vscode.workspace, 'workspaceFolders', {
            value: [fakeFolder],
            configurable: true,
        });

        try {
            // Fire two concurrent calls
            const promise1 = fetchSecretsFromConfig(fakeContext, fakeOutput, false);
            const promise2 = fetchSecretsFromConfig(fakeContext, fakeOutput, false);

            await Promise.all([promise1, promise2]);

            // Only one pipeline should have actually run — the second should have deduped
            assert.strictEqual(
                fetchCallCount,
                1,
                'Only one fetch call should occur when two concurrent fetchSecretsFromConfig calls are made',
            );
        } finally {
            Object.defineProperty(vscode.workspace, 'workspaceFolders', {
                value: originalFolders,
                configurable: true,
            });
        }
    });

    test('manual invocation should re-run pipeline after automatic fetch completes', async () => {
        // Write a config so the pipeline has something to process
        const config = {
            secrets: {
                provider: 'doppler',
                loader: 'dotenv',
                batches: ['dev'],
                project: 'rerun-project',
            },
        };
        await writeConfigFile(tempDir, config);

        fetchMock.install();

        let fetchCallCount = 0;
        fetchMock.addHandler(
            'https://api.doppler.com/v3/configs/config/secrets',
            async () => {
                fetchCallCount++;
                // Simulate a short delay so both calls overlap
                await new Promise<void>((resolve) => setTimeout(resolve, 100));
                return new Response(
                    JSON.stringify({ secrets: { KEY: { raw: 'v', computed: 'v' } } }),
                    { status: 200, headers: { 'Content-Type': 'application/json' } },
                );
            },
        );

        const fakeSecrets = createFakeSecretStorage({
            'dev-setup.dopplerToken': 'dp.test.mock_token',
        });
        const fakeOutput = createFakeOutputChannel();
        const fakeContext = { secrets: fakeSecrets } as unknown as vscode.ExtensionContext;

        // Stub workspaceFolders
        const originalFolders = vscode.workspace.workspaceFolders;
        const fakeFolder: vscode.WorkspaceFolder = {
            uri: vscode.Uri.file(tempDir),
            name: 'test-workspace',
            index: 0,
        };
        Object.defineProperty(vscode.workspace, 'workspaceFolders', {
            value: [fakeFolder],
            configurable: true,
        });

        try {
            // Fire automatic (non-manual) fetch first, then manual while it's in progress
            const promise1 = fetchSecretsFromConfig(fakeContext, fakeOutput, false);
            const promise2 = fetchSecretsFromConfig(fakeContext, fakeOutput, true);

            await Promise.all([promise1, promise2]);

            // The manual invocation should have re-run the pipeline after the automatic one finished
            assert.strictEqual(
                fetchCallCount,
                2,
                'Manual invocation should re-run the pipeline after the automatic fetch completes',
            );
        } finally {
            Object.defineProperty(vscode.workspace, 'workspaceFolders', {
                value: originalFolders,
                configurable: true,
            });
        }
    });

    // ── Filter Pipeline Tests ────────────────────────────────────────

    test('include filter keeps only matching secrets', async () => {
        // 1. Write config with an include filter pattern
        const config = {
            secrets: {
                provider: 'doppler',
                loader: 'dotenv',
                batches: ['dev'],
                project: 'filter-include-project',
                filter: { include: ['^DB_'] },
            },
        };
        await writeConfigFile(tempDir, config);

        // 2. Install fetch mock with secrets — some match, some don't
        fetchMock.install();
        const mockSecrets = {
            secrets: {
                DB_HOST: { raw: 'ref', computed: 'localhost' },
                DB_PORT: { raw: 'ref', computed: '5432' },
                API_KEY: { raw: 'ref', computed: 'sk-12345' },
                APP_NAME: { raw: 'ref', computed: 'MyApp' },
            },
        };
        fetchMock.addResponse(
            'https://api.doppler.com/v3/configs/config/secrets',
            { status: 200, body: JSON.stringify(mockSecrets) },
        );

        // 3. Set up fakes
        const fakeSecrets = createFakeSecretStorage({
            'dev-setup.dopplerToken': 'dp.test.mock_token',
        });
        const fakeOutput = createFakeOutputChannel();
        const fakeContext = {
            secrets: fakeSecrets,
        } as unknown as vscode.ExtensionContext;
        const fakeFolder: vscode.WorkspaceFolder = {
            uri: vscode.Uri.file(tempDir),
            name: 'filter-include-test',
            index: 0,
        };

        // 4. Run the pipeline
        await processWorkspaceFolder(fakeFolder, fakeContext, fakeOutput, false);

        // 5. Read back .env and verify only DB_ secrets are present
        const envUri = vscode.Uri.joinPath(vscode.Uri.file(tempDir), '.env');
        const envContent = new TextDecoder().decode(
            await vscode.workspace.fs.readFile(envUri),
        );

        const expectedEnv = [
            '# Doppler: dev',
            'DB_HOST=localhost',
            'DB_PORT=5432',
            '',
        ].join('\n');

        assert.strictEqual(envContent, expectedEnv, '.env should only contain secrets matching include filter ^DB_');

        // 6. Verify filtering was logged
        const logLines = fakeOutput.getLines();
        assert.ok(
            logLines.some(l => l.includes('Filtered out 2 secret(s)')),
            'Output should log how many secrets were filtered out',
        );
    });

    test('include filter with multiple patterns uses AND logic', async () => {
        // 1. Write config with multiple include patterns — ALL must match
        const config = {
            secrets: {
                provider: 'doppler',
                loader: 'dotenv',
                batches: ['dev'],
                project: 'filter-include-and-project',
                filter: { include: ['^DB_', '_URL$'] },
            },
        };
        await writeConfigFile(tempDir, config);

        // 2. Install fetch mock
        fetchMock.install();
        const mockSecrets = {
            secrets: {
                DB_HOST: { raw: 'ref', computed: 'localhost' },
                DB_CONNECTION_URL: { raw: 'ref', computed: 'pg://localhost/db' },
                API_URL: { raw: 'ref', computed: 'https://api.example.com' },
                APP_NAME: { raw: 'ref', computed: 'MyApp' },
            },
        };
        fetchMock.addResponse(
            'https://api.doppler.com/v3/configs/config/secrets',
            { status: 200, body: JSON.stringify(mockSecrets) },
        );

        // 3. Set up fakes
        const fakeSecrets = createFakeSecretStorage({
            'dev-setup.dopplerToken': 'dp.test.mock_token',
        });
        const fakeOutput = createFakeOutputChannel();
        const fakeContext = {
            secrets: fakeSecrets,
        } as unknown as vscode.ExtensionContext;
        const fakeFolder: vscode.WorkspaceFolder = {
            uri: vscode.Uri.file(tempDir),
            name: 'filter-include-and-test',
            index: 0,
        };

        // 4. Run the pipeline
        await processWorkspaceFolder(fakeFolder, fakeContext, fakeOutput, false);

        // 5. Read back .env — only DB_CONNECTION_URL matches both ^DB_ AND _URL$
        const envUri = vscode.Uri.joinPath(vscode.Uri.file(tempDir), '.env');
        const envContent = new TextDecoder().decode(
            await vscode.workspace.fs.readFile(envUri),
        );

        const expectedEnv = [
            '# Doppler: dev',
            'DB_CONNECTION_URL=pg://localhost/db',
            '',
        ].join('\n');

        assert.strictEqual(envContent, expectedEnv, '.env should only contain secrets matching ALL include patterns');

        // 6. Verify filtering was logged
        const logLines = fakeOutput.getLines();
        assert.ok(
            logLines.some(l => l.includes('Filtered out 3 secret(s)')),
            'Output should log how many secrets were filtered out',
        );
    });

    test('exclude filter removes matching secrets', async () => {
        // 1. Write config with an exclude filter
        const config = {
            secrets: {
                provider: 'doppler',
                loader: 'dotenv',
                batches: ['dev'],
                project: 'filter-exclude-project',
                filter: { exclude: ['^TEMP_', '_DEBUG$'] },
            },
        };
        await writeConfigFile(tempDir, config);

        // 2. Install fetch mock
        fetchMock.install();
        const mockSecrets = {
            secrets: {
                DB_HOST: { raw: 'ref', computed: 'localhost' },
                TEMP_KEY: { raw: 'ref', computed: 'tmp-val' },
                APP_DEBUG: { raw: 'ref', computed: 'true' },
                API_URL: { raw: 'ref', computed: 'https://api.example.com' },
            },
        };
        fetchMock.addResponse(
            'https://api.doppler.com/v3/configs/config/secrets',
            { status: 200, body: JSON.stringify(mockSecrets) },
        );

        // 3. Set up fakes
        const fakeSecrets = createFakeSecretStorage({
            'dev-setup.dopplerToken': 'dp.test.mock_token',
        });
        const fakeOutput = createFakeOutputChannel();
        const fakeContext = {
            secrets: fakeSecrets,
        } as unknown as vscode.ExtensionContext;
        const fakeFolder: vscode.WorkspaceFolder = {
            uri: vscode.Uri.file(tempDir),
            name: 'filter-exclude-test',
            index: 0,
        };

        // 4. Run the pipeline
        await processWorkspaceFolder(fakeFolder, fakeContext, fakeOutput, false);

        // 5. Read back .env — TEMP_KEY and APP_DEBUG should be excluded
        const envUri = vscode.Uri.joinPath(vscode.Uri.file(tempDir), '.env');
        const envContent = new TextDecoder().decode(
            await vscode.workspace.fs.readFile(envUri),
        );

        const expectedEnv = [
            '# Doppler: dev',
            'API_URL=https://api.example.com',
            'DB_HOST=localhost',
            '',
        ].join('\n');

        assert.strictEqual(envContent, expectedEnv, '.env should not contain secrets matching any exclude pattern');

        // 6. Verify filtering was logged
        const logLines = fakeOutput.getLines();
        assert.ok(
            logLines.some(l => l.includes('Filtered out 2 secret(s)')),
            'Output should log how many secrets were filtered out',
        );
    });

    test('include and exclude together', async () => {
        // 1. Write config with both include and exclude
        const config = {
            secrets: {
                provider: 'doppler',
                loader: 'dotenv',
                batches: ['dev'],
                project: 'filter-both-project',
                filter: { include: ['^DB_'], exclude: ['_TEMP$'] },
            },
        };
        await writeConfigFile(tempDir, config);

        // 2. Install fetch mock
        fetchMock.install();
        const mockSecrets = {
            secrets: {
                DB_HOST: { raw: 'ref', computed: 'localhost' },
                DB_TEMP: { raw: 'ref', computed: 'tmp-val' },
                DB_PORT: { raw: 'ref', computed: '5432' },
                API_KEY: { raw: 'ref', computed: 'sk-12345' },
            },
        };
        fetchMock.addResponse(
            'https://api.doppler.com/v3/configs/config/secrets',
            { status: 200, body: JSON.stringify(mockSecrets) },
        );

        // 3. Set up fakes
        const fakeSecrets = createFakeSecretStorage({
            'dev-setup.dopplerToken': 'dp.test.mock_token',
        });
        const fakeOutput = createFakeOutputChannel();
        const fakeContext = {
            secrets: fakeSecrets,
        } as unknown as vscode.ExtensionContext;
        const fakeFolder: vscode.WorkspaceFolder = {
            uri: vscode.Uri.file(tempDir),
            name: 'filter-both-test',
            index: 0,
        };

        // 4. Run the pipeline
        await processWorkspaceFolder(fakeFolder, fakeContext, fakeOutput, false);

        // 5. Read back .env — DB_HOST and DB_PORT pass include, DB_TEMP excluded, API_KEY fails include
        const envUri = vscode.Uri.joinPath(vscode.Uri.file(tempDir), '.env');
        const envContent = new TextDecoder().decode(
            await vscode.workspace.fs.readFile(envUri),
        );

        const expectedEnv = [
            '# Doppler: dev',
            'DB_HOST=localhost',
            'DB_PORT=5432',
            '',
        ].join('\n');

        assert.strictEqual(envContent, expectedEnv, '.env should contain secrets matching include but not exclude');

        // 6. Verify filtering was logged
        const logLines = fakeOutput.getLines();
        assert.ok(
            logLines.some(l => l.includes('Filtered out 2 secret(s)')),
            'Output should log how many secrets were filtered out',
        );
    });

    test('no filter means all secrets pass through', async () => {
        // 1. Write config WITHOUT a filter field
        const config = {
            secrets: {
                provider: 'doppler',
                loader: 'dotenv',
                batches: ['dev'],
                project: 'no-filter-project',
            },
        };
        await writeConfigFile(tempDir, config);

        // 2. Install fetch mock
        fetchMock.install();
        const mockSecrets = {
            secrets: {
                DB_HOST: { raw: 'ref', computed: 'localhost' },
                API_KEY: { raw: 'ref', computed: 'sk-12345' },
                APP_NAME: { raw: 'ref', computed: 'MyApp' },
            },
        };
        fetchMock.addResponse(
            'https://api.doppler.com/v3/configs/config/secrets',
            { status: 200, body: JSON.stringify(mockSecrets) },
        );

        // 3. Set up fakes
        const fakeSecrets = createFakeSecretStorage({
            'dev-setup.dopplerToken': 'dp.test.mock_token',
        });
        const fakeOutput = createFakeOutputChannel();
        const fakeContext = {
            secrets: fakeSecrets,
        } as unknown as vscode.ExtensionContext;
        const fakeFolder: vscode.WorkspaceFolder = {
            uri: vscode.Uri.file(tempDir),
            name: 'no-filter-test',
            index: 0,
        };

        // 4. Run the pipeline
        await processWorkspaceFolder(fakeFolder, fakeContext, fakeOutput, false);

        // 5. Read back .env — all secrets should be present
        const envUri = vscode.Uri.joinPath(vscode.Uri.file(tempDir), '.env');
        const envContent = new TextDecoder().decode(
            await vscode.workspace.fs.readFile(envUri),
        );

        const expectedEnv = [
            '# Doppler: dev',
            'API_KEY=sk-12345',
            'APP_NAME=MyApp',
            'DB_HOST=localhost',
            '',
        ].join('\n');

        assert.strictEqual(envContent, expectedEnv, '.env should contain all secrets when no filter is configured');

        // 6. Verify no filtering message in output
        const logLines = fakeOutput.getLines();
        assert.ok(
            !logLines.some(l => l.includes('Filtered out')),
            'Output should NOT log any filtering message when no filter is configured',
        );
    });

    // ── Success Notification (manual vs automatic) ───────────────────

    test('manual mode should show success notification after .env write', async () => {
        // 1. Write config
        const config = {
            secrets: {
                provider: 'doppler',
                loader: 'dotenv',
                batches: ['dev'],
                project: 'notify-project',
            },
        };
        await writeConfigFile(tempDir, config);

        // 2. Install fetch mock
        fetchMock.install();
        const mockSecrets = {
            secrets: {
                DB_HOST: { raw: 'ref', computed: 'localhost' },
            },
        };
        fetchMock.addResponse(
            'https://api.doppler.com/v3/configs/config/secrets',
            { status: 200, body: JSON.stringify(mockSecrets) },
        );

        // 3. Set up fakes
        const fakeSecrets = createFakeSecretStorage({
            'dev-setup.dopplerToken': 'dp.test.mock_token',
        });
        const fakeOutput = createFakeOutputChannel();
        const fakeContext = {
            secrets: fakeSecrets,
        } as unknown as vscode.ExtensionContext;
        const fakeFolder: vscode.WorkspaceFolder = {
            uri: vscode.Uri.file(tempDir),
            name: 'notify-test',
            index: 0,
        };

        // 4. Spy on showInformationMessage
        const originalShowInfo = vscode.window.showInformationMessage;
        const infoCalls: string[] = [];
        (vscode.window as any).showInformationMessage = (...args: any[]) => {
            infoCalls.push(args[0]);
            return Promise.resolve(undefined);
        };

        try {
            // 5. Run the pipeline with manual: true
            await processWorkspaceFolder(fakeFolder, fakeContext, fakeOutput, true);

            // 6. Verify the success notification was shown
            assert.ok(
                infoCalls.some(m => m.includes('Dev Setup: Secrets fetched and written to')),
                'Should show success info notification in manual mode',
            );
            assert.ok(
                infoCalls.some(m => m.includes('.env')),
                'Notification should mention .env file path',
            );
        } finally {
            (vscode.window as any).showInformationMessage = originalShowInfo;
        }
    });

    test('automatic mode should NOT show success notification after .env write', async () => {
        // 1. Write config
        const config = {
            secrets: {
                provider: 'doppler',
                loader: 'dotenv',
                batches: ['dev'],
                project: 'silent-project',
            },
        };
        await writeConfigFile(tempDir, config);

        // 2. Install fetch mock
        fetchMock.install();
        const mockSecrets = {
            secrets: {
                DB_HOST: { raw: 'ref', computed: 'localhost' },
            },
        };
        fetchMock.addResponse(
            'https://api.doppler.com/v3/configs/config/secrets',
            { status: 200, body: JSON.stringify(mockSecrets) },
        );

        // 3. Set up fakes
        const fakeSecrets = createFakeSecretStorage({
            'dev-setup.dopplerToken': 'dp.test.mock_token',
        });
        const fakeOutput = createFakeOutputChannel();
        const fakeContext = {
            secrets: fakeSecrets,
        } as unknown as vscode.ExtensionContext;
        const fakeFolder: vscode.WorkspaceFolder = {
            uri: vscode.Uri.file(tempDir),
            name: 'silent-test',
            index: 0,
        };

        // 4. Spy on showInformationMessage
        const originalShowInfo = vscode.window.showInformationMessage;
        const infoCalls: string[] = [];
        (vscode.window as any).showInformationMessage = (...args: any[]) => {
            infoCalls.push(args[0]);
            return Promise.resolve(undefined);
        };

        try {
            // 5. Run the pipeline with manual: false
            await processWorkspaceFolder(fakeFolder, fakeContext, fakeOutput, false);

            // 6. Verify NO success notification was shown
            assert.ok(
                !infoCalls.some(m => m.includes('Secrets loaded successfully')),
                'Should NOT show success info notification in automatic mode',
            );
        } finally {
            (vscode.window as any).showInformationMessage = originalShowInfo;
        }

        // 7. Verify the .env was still written successfully
        const envUri = vscode.Uri.joinPath(vscode.Uri.file(tempDir), '.env');
        const envContent = new TextDecoder().decode(
            await vscode.workspace.fs.readFile(envUri),
        );
        assert.ok(envContent.includes('DB_HOST=localhost'), '.env should still be written in automatic mode');
    });

    // ── Missing Doppler Token (manual vs automatic) ──────────────────

    test('automatic mode should show error when Doppler token is missing', async () => {
        // 1. Write config
        const config = {
            secrets: {
                provider: 'doppler',
                loader: 'dotenv',
                batches: ['dev'],
                project: 'no-token-project',
            },
        };
        await writeConfigFile(tempDir, config);

        // 2. Set up fakes — no Doppler token stored
        const fakeSecrets = createFakeSecretStorage({});
        const fakeOutput = createFakeOutputChannel();
        const fakeContext = {
            secrets: fakeSecrets,
        } as unknown as vscode.ExtensionContext;
        const fakeFolder: vscode.WorkspaceFolder = {
            uri: vscode.Uri.file(tempDir),
            name: 'no-token-auto',
            index: 0,
        };

        // 3. Spy on showErrorMessage
        const originalShowError = vscode.window.showErrorMessage;
        const errorCalls: string[] = [];
        (vscode.window as any).showErrorMessage = (...args: any[]) => {
            errorCalls.push(args[0]);
            return Promise.resolve(undefined);
        };

        try {
            // 4. Run the pipeline with manual: false
            await processWorkspaceFolder(fakeFolder, fakeContext, fakeOutput, false);

            // 5. Verify the error was shown (providers now throw on missing token)
            assert.ok(
                errorCalls.some(m => m.includes('Doppler token not configured')),
                'Should show error for missing token even in automatic mode',
            );

            // 6. Verify the error was logged to the output channel
            const logLines = fakeOutput.getLines();
            assert.ok(
                logLines.some(l => l.includes('Doppler token not configured')),
                'Should log token error message to output channel',
            );
        } finally {
            (vscode.window as any).showErrorMessage = originalShowError;
        }
    });

    test('manual mode should show error when Doppler token is missing', async () => {
        // 1. Write config
        const config = {
            secrets: {
                provider: 'doppler',
                loader: 'dotenv',
                batches: ['dev'],
                project: 'no-token-project',
            },
        };
        await writeConfigFile(tempDir, config);

        // 2. Set up fakes — no Doppler token stored
        const fakeSecrets = createFakeSecretStorage({});
        const fakeOutput = createFakeOutputChannel();
        const fakeContext = {
            secrets: fakeSecrets,
        } as unknown as vscode.ExtensionContext;
        const fakeFolder: vscode.WorkspaceFolder = {
            uri: vscode.Uri.file(tempDir),
            name: 'no-token-manual',
            index: 0,
        };

        // 3. Spy on showErrorMessage
        const originalShowError = vscode.window.showErrorMessage;
        const errorCalls: string[] = [];
        (vscode.window as any).showErrorMessage = (...args: any[]) => {
            errorCalls.push(args[0]);
            return Promise.resolve(undefined);
        };

        try {
            // 4. Run the pipeline with manual: true
            await processWorkspaceFolder(fakeFolder, fakeContext, fakeOutput, true);

            // 5. Verify the error popup WAS shown with the token-missing message
            assert.ok(
                errorCalls.some(m => m.includes('Doppler token not configured')),
                'Should show error popup for missing token in manual mode',
            );
        } finally {
            (vscode.window as any).showErrorMessage = originalShowError;
        }
    });

    // ── Script Pipeline Integration Tests ────────────────────────────

    suite('script pipeline integration', () => {
        let spawnCalls: Array<{ command: string; options: any }>;
        let exitCode: number;

        function makeFakeChild(): EventEmitter & { stdout: Readable; stderr: Readable } {
            const ee = new EventEmitter() as EventEmitter & {
                stdout: Readable;
                stderr: Readable;
            };
            const stdout = new Readable({ read(): void { /* noop */ } });
            const stderr = new Readable({ read(): void { /* noop */ } });
            stdout.setEncoding = (): Readable => stdout;
            stderr.setEncoding = (): Readable => stderr;
            ee.stdout = stdout;
            ee.stderr = stderr;
            // Emit close on next tick so `await` resolves deterministically.
            setImmediate(() => ee.emit('close', exitCode));
            return ee;
        }

        setup(() => {
            spawnCalls = [];
            exitCode = 0;
            const fake: SpawnFn = (command, options) => {
                spawnCalls.push({ command, options });
                return makeFakeChild() as unknown as import('child_process').ChildProcessWithoutNullStreams;
            };
            setSpawnImplForTests(fake);
        });

        teardown(() => {
            setSpawnImplForTests(null);
        });

        test('script-only pipeline: fetches secrets and runs script, no .env written', async () => {
            // 1. Write config with script only (no loader)
            const config = {
                secrets: {
                    provider: 'doppler',
                    script: 'npm start',
                    batches: ['dev'],
                    project: 'script-only-project',
                },
            };
            await writeConfigFile(tempDir, config);

            // 2. Install fetch mock
            fetchMock.install();
            const mockSecrets = {
                secrets: {
                    DB_HOST: { raw: 'ref', computed: 'localhost' },
                    API_KEY: { raw: 'ref', computed: 'sk-12345' },
                },
            };
            fetchMock.addResponse(
                'https://api.doppler.com/v3/configs/config/secrets',
                { status: 200, body: JSON.stringify(mockSecrets) },
            );

            // 3. Set up fakes
            const fakeSecrets = createFakeSecretStorage({
                'dev-setup.dopplerToken': 'dp.test.mock_token',
            });
            const fakeOutput = createFakeOutputChannel();
            const fakeContext = {
                secrets: fakeSecrets,
            } as unknown as vscode.ExtensionContext;
            const fakeFolder: vscode.WorkspaceFolder = {
                uri: vscode.Uri.file(tempDir),
                name: 'script-only-test',
                index: 0,
            };

            // 4. Run the pipeline
            await processWorkspaceFolder(fakeFolder, fakeContext, fakeOutput, false);

            // 5. Verify spawn was called with merged env vars + shell:true
            assert.strictEqual(spawnCalls.length, 1, 'spawn should be called once');
            assert.strictEqual(spawnCalls[0].command, 'npm start');
            assert.strictEqual(spawnCalls[0].options.shell, true);
            assert.strictEqual(spawnCalls[0].options.env.DB_HOST, 'localhost');
            assert.strictEqual(spawnCalls[0].options.env.API_KEY, 'sk-12345');

            // 6. Verify .env file does NOT exist
            const envUri = vscode.Uri.joinPath(vscode.Uri.file(tempDir), '.env');
            try {
                await vscode.workspace.fs.readFile(envUri);
                assert.fail('.env file should not exist in script-only mode');
            } catch {
                // Expected: file does not exist
            }
        });

        test('loader+script pipeline: writes .env AND runs script', async () => {
            // 1. Write config with both loader and script
            const config = {
                secrets: {
                    provider: 'doppler',
                    loader: 'dotenv',
                    script: 'npm start',
                    batches: ['dev'],
                    project: 'both-project',
                },
            };
            await writeConfigFile(tempDir, config);

            // 2. Install fetch mock
            fetchMock.install();
            const mockSecrets = {
                secrets: {
                    DB_HOST: { raw: 'ref', computed: 'localhost' },
                },
            };
            fetchMock.addResponse(
                'https://api.doppler.com/v3/configs/config/secrets',
                { status: 200, body: JSON.stringify(mockSecrets) },
            );

            // 3. Set up fakes
            const fakeSecrets = createFakeSecretStorage({
                'dev-setup.dopplerToken': 'dp.test.mock_token',
            });
            const fakeOutput = createFakeOutputChannel();
            const fakeContext = {
                secrets: fakeSecrets,
            } as unknown as vscode.ExtensionContext;
            const fakeFolder: vscode.WorkspaceFolder = {
                uri: vscode.Uri.file(tempDir),
                name: 'both-test',
                index: 0,
            };

            // 4. Run the pipeline
            await processWorkspaceFolder(fakeFolder, fakeContext, fakeOutput, false);

            // 5. Verify .env file exists
            const envUri = vscode.Uri.joinPath(vscode.Uri.file(tempDir), '.env');
            const envContent = new TextDecoder().decode(
                await vscode.workspace.fs.readFile(envUri),
            );
            assert.ok(envContent.includes('DB_HOST=localhost'), '.env should contain secrets');

            // 6. Verify spawn was called (script ran headlessly, no terminal)
            assert.strictEqual(spawnCalls.length, 1, 'spawn should be called once');
        });

        test('script-only success message (manual mode)', async () => {
            // 1. Write config with script only
            const config = {
                secrets: {
                    provider: 'doppler',
                    script: 'npm start',
                    batches: ['dev'],
                    project: 'script-notify-project',
                },
            };
            await writeConfigFile(tempDir, config);

            // 2. Install fetch mock
            fetchMock.install();
            const mockSecrets = {
                secrets: {
                    DB_HOST: { raw: 'ref', computed: 'localhost' },
                },
            };
            fetchMock.addResponse(
                'https://api.doppler.com/v3/configs/config/secrets',
                { status: 200, body: JSON.stringify(mockSecrets) },
            );

            // 3. Set up fakes
            const fakeSecrets = createFakeSecretStorage({
                'dev-setup.dopplerToken': 'dp.test.mock_token',
            });
            const fakeOutput = createFakeOutputChannel();
            const fakeContext = {
                secrets: fakeSecrets,
            } as unknown as vscode.ExtensionContext;
            const fakeFolder: vscode.WorkspaceFolder = {
                uri: vscode.Uri.file(tempDir),
                name: 'script-notify-test',
                index: 0,
            };

            // 4. Spy on showInformationMessage
            const originalShowInfo = vscode.window.showInformationMessage;
            const infoCalls: string[] = [];
            (vscode.window as any).showInformationMessage = (...args: any[]) => {
                infoCalls.push(args[0]);
                return Promise.resolve(undefined);
            };

            try {
                // 5. Run the pipeline with manual: true
                await processWorkspaceFolder(fakeFolder, fakeContext, fakeOutput, true);

                // 6. Verify success message mentions script completion
                assert.ok(
                    infoCalls.some(m => m.includes('script completed')),
                    `Should show success notification mentioning script completed, got: ${JSON.stringify(infoCalls)}`,
                );
            } finally {
                (vscode.window as any).showInformationMessage = originalShowInfo;
            }
        });

        test('loader+script success message (manual mode)', async () => {
            // 1. Write config with both loader and script
            const config = {
                secrets: {
                    provider: 'doppler',
                    loader: 'dotenv',
                    script: 'npm start',
                    batches: ['dev'],
                    project: 'both-notify-project',
                },
            };
            await writeConfigFile(tempDir, config);

            // 2. Install fetch mock
            fetchMock.install();
            const mockSecrets = {
                secrets: {
                    DB_HOST: { raw: 'ref', computed: 'localhost' },
                },
            };
            fetchMock.addResponse(
                'https://api.doppler.com/v3/configs/config/secrets',
                { status: 200, body: JSON.stringify(mockSecrets) },
            );

            // 3. Set up fakes
            const fakeSecrets = createFakeSecretStorage({
                'dev-setup.dopplerToken': 'dp.test.mock_token',
            });
            const fakeOutput = createFakeOutputChannel();
            const fakeContext = {
                secrets: fakeSecrets,
            } as unknown as vscode.ExtensionContext;
            const fakeFolder: vscode.WorkspaceFolder = {
                uri: vscode.Uri.file(tempDir),
                name: 'both-notify-test',
                index: 0,
            };

            // 4. Spy on showInformationMessage
            const originalShowInfo = vscode.window.showInformationMessage;
            const infoCalls: string[] = [];
            (vscode.window as any).showInformationMessage = (...args: any[]) => {
                infoCalls.push(args[0]);
                return Promise.resolve(undefined);
            };

            try {
                // 5. Run the pipeline with manual: true
                await processWorkspaceFolder(fakeFolder, fakeContext, fakeOutput, true);

                // 6. Verify success message mentions both written to and script completion
                assert.ok(
                    infoCalls.some(m => m.includes('written to')),
                    `Should mention written to in notification, got: ${JSON.stringify(infoCalls)}`,
                );
                assert.ok(
                    infoCalls.some(m => m.includes('script completed')),
                    `Should mention script completed in notification, got: ${JSON.stringify(infoCalls)}`,
                );
            } finally {
                (vscode.window as any).showInformationMessage = originalShowInfo;
            }
        });

        test('non-zero script exit shows warning notification (manual mode)', async () => {
            exitCode = 2;
            const config = {
                secrets: {
                    provider: 'doppler',
                    script: 'false',
                    batches: ['dev'],
                    project: 'fail-project',
                },
            };
            await writeConfigFile(tempDir, config);

            fetchMock.install();
            fetchMock.addResponse(
                'https://api.doppler.com/v3/configs/config/secrets',
                { status: 200, body: JSON.stringify({ secrets: { A: { raw: '1', computed: '1' } } }) },
            );

            const fakeSecrets = createFakeSecretStorage({
                'dev-setup.dopplerToken': 'dp.test.mock_token',
            });
            const fakeOutput = createFakeOutputChannel();
            const fakeContext = { secrets: fakeSecrets } as unknown as vscode.ExtensionContext;
            const fakeFolder: vscode.WorkspaceFolder = {
                uri: vscode.Uri.file(tempDir),
                name: 'fail-test',
                index: 0,
            };

            const origWarn = vscode.window.showWarningMessage;
            const warnCalls: string[] = [];
            (vscode.window as any).showWarningMessage = (...args: any[]) => {
                warnCalls.push(args[0]);
                return Promise.resolve(undefined);
            };

            try {
                await processWorkspaceFolder(fakeFolder, fakeContext, fakeOutput, true);

                assert.ok(
                    warnCalls.some(m => m.includes('exited with code 2')),
                    `Should warn about non-zero exit, got: ${JSON.stringify(warnCalls)}`,
                );
            } finally {
                (vscode.window as any).showWarningMessage = origWarn;
            }
        });
    });
});
