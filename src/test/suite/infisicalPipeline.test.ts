import * as assert from 'assert';
import * as vscode from 'vscode';
import { processWorkspaceFolder, resetConcurrencyGuard } from '../../pipeline/secretsPipeline';
import * as fetchMock from '../helpers/fetchMock';
import { createFakeSecretStorage } from '../helpers/fakeSecretStorage';
import { createFakeOutputChannel } from '../helpers/fakeOutputChannel';
import {
    createTempWorkspace,
    cleanupTempWorkspace,
    writeConfigFile,
    writeYamlConfigFile,
} from '../helpers/tempWorkspace';

suite('Infisical Pipeline Integration', () => {
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

    // ── Infisical end-to-end with project slug ────────────────────────

    suite('Infisical end-to-end with project slug', () => {
        test('full pipeline with project slug resolves to workspace ID', async () => {
            // 1. Write config using Infisical with a slug (not a GUID)
            const config = {
                secrets: {
                    provider: 'infisical',
                    loader: 'dotenv',
                    batches: ['dev'],
                    project: 'my-infisical-project',
                },
            };
            await writeConfigFile(tempDir, config);

            // 2. Install fetch mock with all expected calls
            fetchMock.install();

            const siteUrl = 'https://app.infisical.com';
            const authBody = JSON.stringify({
                accessToken: 'test-access-token',
                expiresIn: 3600,
                tokenType: 'Bearer',
            });

            // resolveWorkspaceId: auth call
            fetchMock.addResponse(
                `${siteUrl}/api/v1/auth/universal-auth/login`,
                { status: 200, body: authBody },
            );

            // resolveWorkspaceId: workspaces call
            fetchMock.addResponse(
                `${siteUrl}/api/v1/workspaces`,
                {
                    status: 200,
                    body: JSON.stringify({
                        workspaces: [
                            { id: 'ws-resolved-id', name: 'My Project', slug: 'my-infisical-project' },
                        ],
                    }),
                },
            );

            // fetchSecrets: secrets call (auth is reused via route match)
            fetchMock.addResponse(
                `${siteUrl}/api/v3/secrets/raw`,
                {
                    status: 200,
                    body: JSON.stringify({
                        secrets: [
                            { secretKey: 'DB_HOST', secretValue: 'localhost' },
                            { secretKey: 'API_KEY', secretValue: 'infisical-secret-123' },
                        ],
                    }),
                },
            );

            // 3. Create fake SecretStorage with stored Infisical credentials
            const storedCreds = JSON.stringify({
                clientId: 'test-client-id',
                clientSecret: 'test-client-secret',
                siteUrl,
            });
            const fakeSecrets = createFakeSecretStorage({
                'dev-setup.infisicalCredentials': storedCreds,
            });

            // 4. Create fake OutputChannel
            const fakeOutput = createFakeOutputChannel();

            // 5. Build a minimal ExtensionContext
            const fakeContext = {
                secrets: fakeSecrets,
            } as unknown as vscode.ExtensionContext;

            // 6. Build a minimal WorkspaceFolder
            const fakeFolder: vscode.WorkspaceFolder = {
                uri: vscode.Uri.file(tempDir),
                name: 'infisical-slug-test',
                index: 0,
            };

            // 7. Run the pipeline
            await processWorkspaceFolder(fakeFolder, fakeContext, fakeOutput, false);

            // 8. Verify fetch calls were made in the right order:
            //    - Auth (for resolveWorkspaceId)
            //    - Workspaces
            //    - Auth (for fetchSecrets)
            //    - Secrets
            const calls = fetchMock.getCalls();
            assert.strictEqual(calls.length, 4, 'Should make 4 fetch calls: auth, workspaces, auth, secrets');
            assert.ok(calls[0].url.includes('/auth/universal-auth/login'), 'Call 1: auth for slug resolution');
            assert.ok(calls[1].url.includes('/api/v1/workspaces'), 'Call 2: workspaces list');
            assert.ok(calls[2].url.includes('/auth/universal-auth/login'), 'Call 3: auth for fetchSecrets');
            assert.ok(calls[3].url.includes('/api/v3/secrets/raw'), 'Call 4: secrets fetch');

            // 9. Verify the secrets call used the resolved workspace ID
            assert.ok(
                calls[3].url.includes('workspaceId=ws-resolved-id'),
                `Secrets call should use resolved workspace ID, got: ${calls[3].url}`,
            );

            // 10. Read back the .env file
            const envUri = vscode.Uri.joinPath(vscode.Uri.file(tempDir), '.env');
            const envContent = new TextDecoder().decode(
                await vscode.workspace.fs.readFile(envUri),
            );

            // 11. Verify .env content
            const expectedEnv = [
                '# Infisical: dev',
                'API_KEY=infisical-secret-123',
                'DB_HOST=localhost',
                '',
            ].join('\n');

            assert.strictEqual(envContent, expectedEnv, '.env should contain resolved secrets from Infisical');

            // 12. Verify output channel logged success
            const logLines = fakeOutput.getLines();
            assert.ok(
                logLines.some(l => l.includes('Secrets loaded successfully')),
                'Output should log success message',
            );
        });
    });

    // ── Infisical Batch Config Parsing (environment/path extraction) ───

    suite('Infisical batch config parsing', () => {

        /**
         * Helper: run the Infisical pipeline with the given batches and
         * providerParams, then return the fetch calls for inspection.
         */
        async function runInfisicalPipeline(
            dir: string,
            batches: string[],
            providerParams?: Record<string, unknown>,
        ): Promise<ReturnType<typeof fetchMock.getCalls>> {
            const config: Record<string, unknown> = {
                secrets: {
                    provider: 'infisical',
                    loader: 'dotenv',
                    batches,
                    project: 'my-infisical-project',
                    ...(providerParams ? { providerParams } : {}),
                },
            };
            await writeConfigFile(dir, config);

            fetchMock.install();

            const siteUrl = 'https://app.infisical.com';
            const authBody = JSON.stringify({
                accessToken: 'test-access-token',
                expiresIn: 3600,
                tokenType: 'Bearer',
            });

            // resolveWorkspaceId: auth call
            fetchMock.addResponse(
                `${siteUrl}/api/v1/auth/universal-auth/login`,
                { status: 200, body: authBody },
            );

            // resolveWorkspaceId: workspaces call
            fetchMock.addResponse(
                `${siteUrl}/api/v1/workspaces`,
                {
                    status: 200,
                    body: JSON.stringify({
                        workspaces: [
                            { id: 'ws-resolved-id', name: 'My Project', slug: 'my-infisical-project' },
                        ],
                    }),
                },
            );

            // fetchSecrets: secrets call
            fetchMock.addResponse(
                `${siteUrl}/api/v3/secrets/raw`,
                {
                    status: 200,
                    body: JSON.stringify({
                        secrets: [
                            { secretKey: 'DB_HOST', secretValue: 'localhost' },
                        ],
                    }),
                },
            );

            const storedCreds = JSON.stringify({
                clientId: 'test-client-id',
                clientSecret: 'test-client-secret',
                siteUrl,
            });
            const fakeSecrets = createFakeSecretStorage({
                'dev-setup.infisicalCredentials': storedCreds,
            });
            const fakeOutput = createFakeOutputChannel();
            const fakeContext = {
                secrets: fakeSecrets,
            } as unknown as vscode.ExtensionContext;
            const fakeFolder: vscode.WorkspaceFolder = {
                uri: vscode.Uri.file(dir),
                name: 'infisical-batch-test',
                index: 0,
            };

            await processWorkspaceFolder(fakeFolder, fakeContext, fakeOutput, false);

            return fetchMock.getCalls();
        }

        /** Extract the secrets-fetch call (the one hitting /api/v3/secrets/raw). */
        function getSecretsCall(calls: ReturnType<typeof fetchMock.getCalls>): { url: string } {
            const secretsCall = calls.find(c => c.url.includes('/api/v3/secrets/raw'));
            assert.ok(secretsCall, 'Expected a call to /api/v3/secrets/raw');
            return secretsCall;
        }

        test('simple environment (no /) uses default secretPath "/"', async () => {
            const calls = await runInfisicalPipeline(tempDir, ['dev']);
            const sc = getSecretsCall(calls);

            const url = new URL(sc.url);
            assert.strictEqual(url.searchParams.get('environment'), 'dev', 'environment should be "dev"');
            assert.strictEqual(url.searchParams.get('secretPath'), '/', 'secretPath should default to "/"');
        });

        test('environment with path: config "dev/backend" → environment="dev", secretPath="/backend"', async () => {
            const calls = await runInfisicalPipeline(tempDir, ['dev/backend']);
            const sc = getSecretsCall(calls);

            const url = new URL(sc.url);
            assert.strictEqual(url.searchParams.get('environment'), 'dev', 'environment should be "dev"');
            assert.strictEqual(url.searchParams.get('secretPath'), '/backend', 'secretPath should be "/backend"');
        });

        test('environment with nested path: config "prod/services/api" → environment="prod", secretPath="/services/api"', async () => {
            const calls = await runInfisicalPipeline(tempDir, ['prod/services/api']);
            const sc = getSecretsCall(calls);

            const url = new URL(sc.url);
            assert.strictEqual(url.searchParams.get('environment'), 'prod', 'environment should be "prod"');
            assert.strictEqual(url.searchParams.get('secretPath'), '/services/api', 'secretPath should be "/services/api"');
        });

        test('environment with trailing slash: config "dev/" → environment="dev", secretPath="/"', async () => {
            const calls = await runInfisicalPipeline(tempDir, ['dev/']);
            const sc = getSecretsCall(calls);

            const url = new URL(sc.url);
            assert.strictEqual(url.searchParams.get('environment'), 'dev', 'environment should be "dev"');
            assert.strictEqual(url.searchParams.get('secretPath'), '/', 'secretPath should be "/"');
        });

        test('per-batch path overrides providerParams.secretPath', async () => {
            const calls = await runInfisicalPipeline(tempDir, ['dev/override'], { secretPath: '/global' });
            const sc = getSecretsCall(calls);

            const url = new URL(sc.url);
            assert.strictEqual(url.searchParams.get('environment'), 'dev', 'environment should be "dev"');
            assert.strictEqual(
                url.searchParams.get('secretPath'),
                '/override',
                'secretPath from config should override providerParams.secretPath',
            );
        });

        test('no path in config falls back to providerParams.secretPath', async () => {
            const calls = await runInfisicalPipeline(tempDir, ['staging'], { secretPath: '/from-params' });
            const sc = getSecretsCall(calls);

            const url = new URL(sc.url);
            assert.strictEqual(url.searchParams.get('environment'), 'staging', 'environment should be "staging"');
            assert.strictEqual(
                url.searchParams.get('secretPath'),
                '/from-params',
                'secretPath should fall back to providerParams.secretPath when config has no "/"',
            );
        });
    });

    // ── Missing Infisical Credentials (manual vs automatic) ──────────

    test('automatic mode should show error when Infisical credentials are missing', async () => {
        // 1. Write config with Infisical provider
        const config = {
            secrets: {
                provider: 'infisical',
                loader: 'dotenv',
                batches: ['dev'],
                project: 'no-creds-project',
            },
        };
        await writeConfigFile(tempDir, config);

        // 2. Set up fakes — no Infisical credentials stored
        const fakeSecrets = createFakeSecretStorage({});
        const fakeOutput = createFakeOutputChannel();
        const fakeContext = {
            secrets: fakeSecrets,
        } as unknown as vscode.ExtensionContext;
        const fakeFolder: vscode.WorkspaceFolder = {
            uri: vscode.Uri.file(tempDir),
            name: 'no-infisical-creds-auto',
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

            // 5. Verify the error was shown
            assert.ok(
                errorCalls.some(m => m.includes('Infisical credentials not configured')),
                'Should show error for missing Infisical credentials in automatic mode',
            );

            // 6. Verify the error was logged to the output channel
            const logLines = fakeOutput.getLines();
            assert.ok(
                logLines.some(l => l.includes('Infisical credentials not configured')),
                'Should log credentials error message to output channel',
            );
        } finally {
            (vscode.window as any).showErrorMessage = originalShowError;
        }
    });

    test('manual mode should show error when Infisical credentials are missing', async () => {
        // 1. Write config with Infisical provider
        const config = {
            secrets: {
                provider: 'infisical',
                loader: 'dotenv',
                batches: ['dev'],
                project: 'no-creds-project',
            },
        };
        await writeConfigFile(tempDir, config);

        // 2. Set up fakes — no Infisical credentials stored
        const fakeSecrets = createFakeSecretStorage({});
        const fakeOutput = createFakeOutputChannel();
        const fakeContext = {
            secrets: fakeSecrets,
        } as unknown as vscode.ExtensionContext;
        const fakeFolder: vscode.WorkspaceFolder = {
            uri: vscode.Uri.file(tempDir),
            name: 'no-infisical-creds-manual',
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

            // 5. Verify the error popup was shown
            assert.ok(
                errorCalls.some(m => m.includes('Infisical credentials not configured')),
                'Should show error popup for missing Infisical credentials in manual mode',
            );
        } finally {
            (vscode.window as any).showErrorMessage = originalShowError;
        }
    });

    // ── Infisical Full Pipeline ──────────────────────────────────────

    test('Infisical full pipeline: YAML config → fetch → .env write', async () => {
        // 1. Write dev-setup.yaml with Infisical provider
        const config = {
            secrets: {
                provider: 'infisical',
                loader: 'dotenv',
                batches: ['dev'],
                project: 'infisical-yaml-pipeline',
            },
        };
        await writeYamlConfigFile(tempDir, config, 'dev-setup.yaml');

        // 2. Install fetch mock
        fetchMock.install();
        const siteUrl = 'https://app.infisical.com';
        const authBody = JSON.stringify({
            accessToken: 'yaml-test-token',
            expiresIn: 3600,
            tokenType: 'Bearer',
        });

        fetchMock.addResponse(
            `${siteUrl}/api/v1/auth/universal-auth/login`,
            { status: 200, body: authBody },
        );

        fetchMock.addResponse(
            `${siteUrl}/api/v1/workspaces`,
            {
                status: 200,
                body: JSON.stringify({
                    workspaces: [
                        { id: 'ws-yaml-id', name: 'YAML Project', slug: 'infisical-yaml-pipeline' },
                    ],
                }),
            },
        );

        fetchMock.addResponse(
            `${siteUrl}/api/v3/secrets/raw`,
            {
                status: 200,
                body: JSON.stringify({
                    secrets: [
                        { secretKey: 'DB_HOST', secretValue: 'yaml-host' },
                        { secretKey: 'DB_PORT', secretValue: '5432' },
                    ],
                }),
            },
        );

        // 3. Set up fakes
        const storedCreds = JSON.stringify({
            clientId: 'yaml-client-id',
            clientSecret: 'yaml-client-secret',
            siteUrl,
        });
        const fakeSecrets = createFakeSecretStorage({
            'dev-setup.infisicalCredentials': storedCreds,
        });
        const fakeOutput = createFakeOutputChannel();
        const fakeContext = {
            secrets: fakeSecrets,
        } as unknown as vscode.ExtensionContext;
        const fakeFolder: vscode.WorkspaceFolder = {
            uri: vscode.Uri.file(tempDir),
            name: 'infisical-yaml-test',
            index: 0,
        };

        // 4. Run the pipeline
        await processWorkspaceFolder(fakeFolder, fakeContext, fakeOutput, false);

        // 5. Read back .env
        const envUri = vscode.Uri.joinPath(vscode.Uri.file(tempDir), '.env');
        const envContent = new TextDecoder().decode(
            await vscode.workspace.fs.readFile(envUri),
        );

        const expectedEnv = [
            '# Infisical: dev',
            'DB_HOST=yaml-host',
            'DB_PORT=5432',
            '',
        ].join('\n');

        assert.strictEqual(envContent, expectedEnv, '.env should contain Infisical secrets from YAML config');

        // 6. Verify output channel logged success
        const logLines = fakeOutput.getLines();
        assert.ok(
            logLines.some(l => l.includes('Secrets loaded successfully')),
            'Output should log success message',
        );
    });

    // ── Infisical Filter Pipeline ────────────────────────────────────

    test('Infisical include filter keeps only matching secrets', async () => {
        // 1. Write config with Infisical provider and include filter
        const config = {
            secrets: {
                provider: 'infisical',
                loader: 'dotenv',
                batches: ['dev'],
                project: 'infisical-filter-project',
                filter: { include: ['^DB_'] },
            },
        };
        await writeConfigFile(tempDir, config);

        // 2. Install fetch mock
        fetchMock.install();
        const siteUrl = 'https://app.infisical.com';
        const authBody = JSON.stringify({
            accessToken: 'filter-token',
            expiresIn: 3600,
            tokenType: 'Bearer',
        });

        fetchMock.addResponse(
            `${siteUrl}/api/v1/auth/universal-auth/login`,
            { status: 200, body: authBody },
        );

        fetchMock.addResponse(
            `${siteUrl}/api/v1/workspaces`,
            {
                status: 200,
                body: JSON.stringify({
                    workspaces: [
                        { id: 'ws-filter-id', name: 'Filter Project', slug: 'infisical-filter-project' },
                    ],
                }),
            },
        );

        fetchMock.addResponse(
            `${siteUrl}/api/v3/secrets/raw`,
            {
                status: 200,
                body: JSON.stringify({
                    secrets: [
                        { secretKey: 'DB_HOST', secretValue: 'localhost' },
                        { secretKey: 'DB_PORT', secretValue: '5432' },
                        { secretKey: 'API_KEY', secretValue: 'inf-sk-12345' },
                        { secretKey: 'APP_NAME', secretValue: 'MyApp' },
                    ],
                }),
            },
        );

        // 3. Set up fakes
        const storedCreds = JSON.stringify({
            clientId: 'filter-client-id',
            clientSecret: 'filter-client-secret',
            siteUrl,
        });
        const fakeSecrets = createFakeSecretStorage({
            'dev-setup.infisicalCredentials': storedCreds,
        });
        const fakeOutput = createFakeOutputChannel();
        const fakeContext = {
            secrets: fakeSecrets,
        } as unknown as vscode.ExtensionContext;
        const fakeFolder: vscode.WorkspaceFolder = {
            uri: vscode.Uri.file(tempDir),
            name: 'infisical-filter-include-test',
            index: 0,
        };

        // 4. Run the pipeline
        await processWorkspaceFolder(fakeFolder, fakeContext, fakeOutput, false);

        // 5. Read back .env — only DB_ secrets should be present
        const envUri = vscode.Uri.joinPath(vscode.Uri.file(tempDir), '.env');
        const envContent = new TextDecoder().decode(
            await vscode.workspace.fs.readFile(envUri),
        );

        const expectedEnv = [
            '# Infisical: dev',
            'DB_HOST=localhost',
            'DB_PORT=5432',
            '',
        ].join('\n');

        assert.strictEqual(envContent, expectedEnv, '.env should only contain Infisical secrets matching include filter ^DB_');

        // 6. Verify filtering was logged
        const logLines = fakeOutput.getLines();
        assert.ok(
            logLines.some(l => l.includes('Filtered out 2 secret(s)')),
            'Output should log how many Infisical secrets were filtered out',
        );
    });

    test('Infisical exclude filter removes matching secrets', async () => {
        // 1. Write config with Infisical provider and exclude filter
        const config = {
            secrets: {
                provider: 'infisical',
                loader: 'dotenv',
                batches: ['dev'],
                project: 'infisical-exclude-project',
                filter: { exclude: ['^TEMP_', '_DEBUG$'] },
            },
        };
        await writeConfigFile(tempDir, config);

        // 2. Install fetch mock
        fetchMock.install();
        const siteUrl = 'https://app.infisical.com';
        const authBody = JSON.stringify({
            accessToken: 'exclude-token',
            expiresIn: 3600,
            tokenType: 'Bearer',
        });

        fetchMock.addResponse(
            `${siteUrl}/api/v1/auth/universal-auth/login`,
            { status: 200, body: authBody },
        );

        fetchMock.addResponse(
            `${siteUrl}/api/v1/workspaces`,
            {
                status: 200,
                body: JSON.stringify({
                    workspaces: [
                        { id: 'ws-excl-id', name: 'Exclude Project', slug: 'infisical-exclude-project' },
                    ],
                }),
            },
        );

        fetchMock.addResponse(
            `${siteUrl}/api/v3/secrets/raw`,
            {
                status: 200,
                body: JSON.stringify({
                    secrets: [
                        { secretKey: 'DB_HOST', secretValue: 'localhost' },
                        { secretKey: 'TEMP_KEY', secretValue: 'tmp-val' },
                        { secretKey: 'APP_DEBUG', secretValue: 'true' },
                        { secretKey: 'API_URL', secretValue: 'https://api.example.com' },
                    ],
                }),
            },
        );

        // 3. Set up fakes
        const storedCreds = JSON.stringify({
            clientId: 'excl-client-id',
            clientSecret: 'excl-client-secret',
            siteUrl,
        });
        const fakeSecrets = createFakeSecretStorage({
            'dev-setup.infisicalCredentials': storedCreds,
        });
        const fakeOutput = createFakeOutputChannel();
        const fakeContext = {
            secrets: fakeSecrets,
        } as unknown as vscode.ExtensionContext;
        const fakeFolder: vscode.WorkspaceFolder = {
            uri: vscode.Uri.file(tempDir),
            name: 'infisical-filter-exclude-test',
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
            '# Infisical: dev',
            'API_URL=https://api.example.com',
            'DB_HOST=localhost',
            '',
        ].join('\n');

        assert.strictEqual(envContent, expectedEnv, '.env should not contain Infisical secrets matching any exclude pattern');

        // 6. Verify filtering was logged
        const logLines = fakeOutput.getLines();
        assert.ok(
            logLines.some(l => l.includes('Filtered out 2 secret(s)')),
            'Output should log how many Infisical secrets were filtered out',
        );
    });

    // ── Infisical Success Notification ────────────────────────────────

    test('Infisical manual mode should show success notification after .env write', async () => {
        // 1. Write config with Infisical provider
        const config = {
            secrets: {
                provider: 'infisical',
                loader: 'dotenv',
                batches: ['dev'],
                project: 'infisical-notify-project',
            },
        };
        await writeConfigFile(tempDir, config);

        // 2. Install fetch mock
        fetchMock.install();
        const siteUrl = 'https://app.infisical.com';
        const authBody = JSON.stringify({
            accessToken: 'notify-token',
            expiresIn: 3600,
            tokenType: 'Bearer',
        });

        fetchMock.addResponse(
            `${siteUrl}/api/v1/auth/universal-auth/login`,
            { status: 200, body: authBody },
        );

        fetchMock.addResponse(
            `${siteUrl}/api/v1/workspaces`,
            {
                status: 200,
                body: JSON.stringify({
                    workspaces: [
                        { id: 'ws-notify-id', name: 'Notify Project', slug: 'infisical-notify-project' },
                    ],
                }),
            },
        );

        fetchMock.addResponse(
            `${siteUrl}/api/v3/secrets/raw`,
            {
                status: 200,
                body: JSON.stringify({
                    secrets: [
                        { secretKey: 'DB_HOST', secretValue: 'localhost' },
                    ],
                }),
            },
        );

        // 3. Set up fakes
        const storedCreds = JSON.stringify({
            clientId: 'notify-client-id',
            clientSecret: 'notify-client-secret',
            siteUrl,
        });
        const fakeSecrets = createFakeSecretStorage({
            'dev-setup.infisicalCredentials': storedCreds,
        });
        const fakeOutput = createFakeOutputChannel();
        const fakeContext = {
            secrets: fakeSecrets,
        } as unknown as vscode.ExtensionContext;
        const fakeFolder: vscode.WorkspaceFolder = {
            uri: vscode.Uri.file(tempDir),
            name: 'infisical-notify-test',
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
                'Should show success info notification in manual mode for Infisical',
            );
            assert.ok(
                infoCalls.some(m => m.includes('.env')),
                'Notification should mention .env file path',
            );
        } finally {
            (vscode.window as any).showInformationMessage = originalShowInfo;
        }
    });

    test('Infisical automatic mode should NOT show success notification after .env write', async () => {
        // 1. Write config with Infisical provider
        const config = {
            secrets: {
                provider: 'infisical',
                loader: 'dotenv',
                batches: ['dev'],
                project: 'infisical-silent-project',
            },
        };
        await writeConfigFile(tempDir, config);

        // 2. Install fetch mock
        fetchMock.install();
        const siteUrl = 'https://app.infisical.com';
        const authBody = JSON.stringify({
            accessToken: 'silent-token',
            expiresIn: 3600,
            tokenType: 'Bearer',
        });

        fetchMock.addResponse(
            `${siteUrl}/api/v1/auth/universal-auth/login`,
            { status: 200, body: authBody },
        );

        fetchMock.addResponse(
            `${siteUrl}/api/v1/workspaces`,
            {
                status: 200,
                body: JSON.stringify({
                    workspaces: [
                        { id: 'ws-silent-id', name: 'Silent Project', slug: 'infisical-silent-project' },
                    ],
                }),
            },
        );

        fetchMock.addResponse(
            `${siteUrl}/api/v3/secrets/raw`,
            {
                status: 200,
                body: JSON.stringify({
                    secrets: [
                        { secretKey: 'DB_HOST', secretValue: 'localhost' },
                    ],
                }),
            },
        );

        // 3. Set up fakes
        const storedCreds = JSON.stringify({
            clientId: 'silent-client-id',
            clientSecret: 'silent-client-secret',
            siteUrl,
        });
        const fakeSecrets = createFakeSecretStorage({
            'dev-setup.infisicalCredentials': storedCreds,
        });
        const fakeOutput = createFakeOutputChannel();
        const fakeContext = {
            secrets: fakeSecrets,
        } as unknown as vscode.ExtensionContext;
        const fakeFolder: vscode.WorkspaceFolder = {
            uri: vscode.Uri.file(tempDir),
            name: 'infisical-silent-test',
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
                'Should NOT show success info notification in automatic mode for Infisical',
            );
        } finally {
            (vscode.window as any).showInformationMessage = originalShowInfo;
        }

        // 7. Verify the .env was still written successfully
        const envUri = vscode.Uri.joinPath(vscode.Uri.file(tempDir), '.env');
        const envContent = new TextDecoder().decode(
            await vscode.workspace.fs.readFile(envUri),
        );
        assert.ok(envContent.includes('DB_HOST=localhost'), '.env should still be written in automatic mode for Infisical');
    });

    // ── Infisical with GUID Project (no slug resolution) ─────────────

    test('Infisical pipeline with GUID project skips workspace resolution', async () => {
        const projectGuid = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
        const config = {
            secrets: {
                provider: 'infisical',
                loader: 'dotenv',
                batches: ['dev'],
                project: projectGuid,
            },
        };
        await writeConfigFile(tempDir, config);

        fetchMock.install();
        const siteUrl = 'https://app.infisical.com';
        const authBody = JSON.stringify({
            accessToken: 'guid-token',
            expiresIn: 3600,
            tokenType: 'Bearer',
        });

        // Only auth + secrets calls (no workspaces call needed)
        fetchMock.addResponse(
            `${siteUrl}/api/v1/auth/universal-auth/login`,
            { status: 200, body: authBody },
        );

        fetchMock.addResponse(
            `${siteUrl}/api/v3/secrets/raw`,
            {
                status: 200,
                body: JSON.stringify({
                    secrets: [
                        { secretKey: 'GUID_SECRET', secretValue: 'guid-value' },
                    ],
                }),
            },
        );

        const storedCreds = JSON.stringify({
            clientId: 'guid-client-id',
            clientSecret: 'guid-client-secret',
            siteUrl,
        });
        const fakeSecrets = createFakeSecretStorage({
            'dev-setup.infisicalCredentials': storedCreds,
        });
        const fakeOutput = createFakeOutputChannel();
        const fakeContext = {
            secrets: fakeSecrets,
        } as unknown as vscode.ExtensionContext;
        const fakeFolder: vscode.WorkspaceFolder = {
            uri: vscode.Uri.file(tempDir),
            name: 'infisical-guid-test',
            index: 0,
        };

        await processWorkspaceFolder(fakeFolder, fakeContext, fakeOutput, false);

        // Verify only auth + secrets calls (no workspaces call)
        const calls = fetchMock.getCalls();
        assert.strictEqual(calls.length, 2, 'Should make 2 calls: auth + secrets (no workspaces)');
        assert.ok(calls[0].url.includes('/auth/universal-auth/login'), 'Call 1: auth');
        assert.ok(calls[1].url.includes('/api/v3/secrets/raw'), 'Call 2: secrets');

        // Verify the GUID was used directly
        assert.ok(
            calls[1].url.includes(`workspaceId=${projectGuid}`),
            `Secrets call should use GUID directly, got: ${calls[1].url}`,
        );

        // Verify .env was written
        const envUri = vscode.Uri.joinPath(vscode.Uri.file(tempDir), '.env');
        const envContent = new TextDecoder().decode(
            await vscode.workspace.fs.readFile(envUri),
        );
        assert.ok(envContent.includes('GUID_SECRET=guid-value'), '.env should contain the secret');
    });
});
