import * as assert from 'assert';
import * as vscode from 'vscode';
import { findConfig } from '../../config/configFinder';
import { parseJsonConfig, parseYamlConfig } from '../../config/configParser';
import { BatchedSecretEntry } from '../../config/configTypes';
import { fetchSecrets } from '../../doppler/dopplerClient';
import { writeDotenv } from '../../loaders/dotenvWriter';
import { processWorkspaceFolder, fetchSecretsFromConfig, resetConcurrencyGuard } from '../../pipeline/secretsPipeline';
import * as fetchMock from '../helpers/fetchMock';
import { createFakeSecretStorage } from '../helpers/fakeSecretStorage';
import { createFakeOutputChannel } from '../helpers/fakeOutputChannel';
import {
    createTempWorkspace,
    cleanupTempWorkspace,
    writeConfigFile,
    writeYamlConfigFile,
    writeRawConfigFile,
} from '../helpers/tempWorkspace';

suite('fetchSecrets Integration', () => {
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

    // ── Config Discovery ────────────────────────────────────────────

    test('should discover JSON config in workspace root', async () => {
        const config = {
            secrets: {
                provider: 'doppler',
                loader: 'dotenv',
                batches: ['dev'],
                project: 'root-project',
            },
        };
        await writeConfigFile(tempDir, config);

        const fakeOutput = createFakeOutputChannel();
        const location = await findConfig(vscode.Uri.file(tempDir), fakeOutput);

        assert.ok(location, 'Config should be found');
        assert.strictEqual(location.config.secrets?.project, 'root-project');
        assert.strictEqual(location.config.secrets?.provider, 'doppler');
        assert.deepStrictEqual(location.config.secrets?.batches, ['dev']);
        assert.strictEqual(location.filename, 'dev-setup.json');
    });

    test('should discover JSON config in .dev/ subdirectory', async () => {
        const config = {
            secrets: {
                provider: 'doppler',
                loader: 'dotenv',
                batches: ['staging'],
                project: 'sub-project',
            },
        };
        await writeConfigFile(tempDir, config, '.dev');

        const fakeOutput = createFakeOutputChannel();
        const location = await findConfig(vscode.Uri.file(tempDir), fakeOutput);

        assert.ok(location, 'Config should be found in .dev/ subdir');
        assert.strictEqual(location.config.secrets?.project, 'sub-project');
        assert.deepStrictEqual(location.config.secrets?.batches, ['staging']);
        assert.strictEqual(location.filename, 'dev-setup.json');
    });

    // ── YAML Config Discovery ───────────────────────────────────────

    test('should discover dev-setup.yaml in workspace root', async () => {
        const config = {
            secrets: {
                provider: 'doppler',
                loader: 'dotenv',
                batches: ['dev'],
                project: 'yaml-project',
            },
        };
        await writeYamlConfigFile(tempDir, config, 'dev-setup.yaml');

        const fakeOutput = createFakeOutputChannel();
        const location = await findConfig(vscode.Uri.file(tempDir), fakeOutput);

        assert.ok(location, 'YAML config should be found');
        assert.strictEqual(location.config.secrets?.project, 'yaml-project');
        assert.strictEqual(location.config.secrets?.provider, 'doppler');
        assert.deepStrictEqual(location.config.secrets?.batches, ['dev']);
        assert.strictEqual(location.filename, 'dev-setup.yaml');
    });

    test('should discover dev-setup.yml in workspace root', async () => {
        const config = {
            secrets: {
                provider: 'doppler',
                loader: 'dotenv',
                batches: ['prod'],
                project: 'yml-project',
            },
        };
        await writeYamlConfigFile(tempDir, config, 'dev-setup.yml');

        const fakeOutput = createFakeOutputChannel();
        const location = await findConfig(vscode.Uri.file(tempDir), fakeOutput);

        assert.ok(location, 'YML config should be found');
        assert.strictEqual(location.config.secrets?.project, 'yml-project');
        assert.strictEqual(location.config.secrets?.provider, 'doppler');
        assert.deepStrictEqual(location.config.secrets?.batches, ['prod']);
        assert.strictEqual(location.filename, 'dev-setup.yml');
    });

    test('.dev/dev-setup.yaml should have higher priority than root dev-setup.json', async () => {
        // Place JSON in workspace root
        const jsonConfig = {
            secrets: {
                provider: 'doppler',
                loader: 'dotenv',
                batches: ['json-batch'],
                project: 'json-project',
            },
        };
        await writeConfigFile(tempDir, jsonConfig);

        // Place YAML in .dev/ subdir (higher priority)
        const yamlConfig = {
            secrets: {
                provider: 'doppler',
                loader: 'dotenv',
                batches: ['yaml-batch'],
                project: 'yaml-project',
            },
        };
        await writeYamlConfigFile(tempDir, yamlConfig, 'dev-setup.yaml', '.dev');

        const fakeOutput = createFakeOutputChannel();
        const location = await findConfig(vscode.Uri.file(tempDir), fakeOutput);

        assert.ok(location, 'Config should be found');
        assert.strictEqual(location.config.secrets?.project, 'yaml-project', '.dev/ YAML should win over root JSON');
        assert.strictEqual(location.filename, 'dev-setup.yaml');
    });

    test('.dev/dev-setup.json should have higher priority than root dev-setup.yaml', async () => {
        // Place YAML in workspace root
        const yamlConfig = {
            secrets: {
                provider: 'doppler',
                loader: 'dotenv',
                batches: ['yaml-batch'],
                project: 'yaml-root-project',
            },
        };
        await writeYamlConfigFile(tempDir, yamlConfig, 'dev-setup.yaml');

        // Place JSON in .dev/ subdir (higher priority)
        const jsonConfig = {
            secrets: {
                provider: 'doppler',
                loader: 'dotenv',
                batches: ['json-batch'],
                project: 'json-subdir-project',
            },
        };
        await writeConfigFile(tempDir, jsonConfig, '.dev');

        const fakeOutput = createFakeOutputChannel();
        const location = await findConfig(vscode.Uri.file(tempDir), fakeOutput);

        assert.ok(location, 'Config should be found');
        assert.strictEqual(location.config.secrets?.project, 'json-subdir-project', '.dev/ JSON should win over root YAML');
        assert.strictEqual(location.filename, 'dev-setup.json');
    });

    test('YAML in .dev/ should take priority over YAML in root', async () => {
        // Place YAML in workspace root
        const rootConfig = {
            secrets: {
                provider: 'doppler',
                loader: 'dotenv',
                batches: ['root-batch'],
                project: 'root-yaml',
            },
        };
        await writeYamlConfigFile(tempDir, rootConfig, 'dev-setup.yaml');

        // Place YAML in .dev/ subdir (higher priority)
        const subConfig = {
            secrets: {
                provider: 'doppler',
                loader: 'dotenv',
                batches: ['sub-batch'],
                project: 'sub-yaml',
            },
        };
        await writeYamlConfigFile(tempDir, subConfig, 'dev-setup.yaml', '.dev');

        const fakeOutput = createFakeOutputChannel();
        const location = await findConfig(vscode.Uri.file(tempDir), fakeOutput);

        assert.ok(location, 'Config should be found');
        assert.strictEqual(location.config.secrets?.project, 'sub-yaml', '.dev/ YAML should win over root YAML');
        assert.strictEqual(location.filename, 'dev-setup.yaml');
    });

    // ── YAML Parsing ────────────────────────────────────────────────

    test('parseYamlConfig should parse valid YAML with same validation as JSON', async () => {
        const yamlContent = [
            'secrets:',
            '  provider: doppler',
            '  loader: dotenv',
            '  batches:',
            '    - dev',
            '    - staging',
            '  project: my-project',
        ].join('\n');

        const fakeOutput = createFakeOutputChannel();
        const raw = new TextEncoder().encode(yamlContent);
        const config = parseYamlConfig(raw, fakeOutput);

        assert.strictEqual(config.secrets?.provider, 'doppler');
        assert.strictEqual(config.secrets?.loader, 'dotenv');
        assert.deepStrictEqual(config.secrets?.batches, ['dev', 'staging']);
        assert.strictEqual(config.secrets?.project, 'my-project');
    });

    test('parseYamlConfig should accept config without secrets section', async () => {
        const yamlContent = '# empty config\n{}';

        const fakeOutput = createFakeOutputChannel();
        const raw = new TextEncoder().encode(yamlContent);
        const config = parseYamlConfig(raw, fakeOutput);

        assert.strictEqual(config.secrets, undefined, 'Config without secrets should parse successfully');
    });

    test('parseYamlConfig should reject invalid YAML content', async () => {
        // Tabs in YAML indentation can cause parse errors
        const invalidYaml = ':\n  - [\ninvalid:\n  {{bad}}';

        const fakeOutput = createFakeOutputChannel();
        const raw = new TextEncoder().encode(invalidYaml);

        assert.throws(
            () => parseYamlConfig(raw, fakeOutput),
            (err: unknown) => {
                assert.ok(err instanceof Error);
                assert.ok(err.message.includes('Failed to parse dev-setup YAML config'));
                return true;
            },
        );
    });

    test('parseYamlConfig should reject YAML with missing required fields', async () => {
        const yamlContent = [
            'secrets:',
            '  provider: doppler',
            // missing 'loader' field
            '  batches:',
            '    - dev',
        ].join('\n');

        const fakeOutput = createFakeOutputChannel();
        const raw = new TextEncoder().encode(yamlContent);

        assert.throws(
            () => parseYamlConfig(raw, fakeOutput),
            (err: unknown) => {
                assert.ok(err instanceof Error);
                assert.ok(
                    err.message.includes("'secrets.loader'"),
                    `Error should mention secrets.loader, got: "${err.message}"`,
                );
                return true;
            },
        );
    });

    test('parseYamlConfig should reject YAML with empty batches array', async () => {
        const yamlContent = [
            'secrets:',
            '  provider: doppler',
            '  loader: dotenv',
            '  batches: []',
        ].join('\n');

        const fakeOutput = createFakeOutputChannel();
        const raw = new TextEncoder().encode(yamlContent);

        assert.throws(
            () => parseYamlConfig(raw, fakeOutput),
            (err: unknown) => {
                assert.ok(err instanceof Error);
                assert.ok(
                    err.message.includes("'secrets.batches'"),
                    `Error should mention secrets.batches, got: "${err.message}"`,
                );
                return true;
            },
        );
    });

    test('parseJsonConfig should still work correctly', async () => {
        const jsonContent = JSON.stringify({
            secrets: {
                provider: 'doppler',
                loader: 'dotenv',
                batches: ['dev'],
                project: 'json-test',
            },
        });

        const fakeOutput = createFakeOutputChannel();
        const raw = new TextEncoder().encode(jsonContent);
        const config = parseJsonConfig(raw, fakeOutput);

        assert.strictEqual(config.secrets?.provider, 'doppler');
        assert.strictEqual(config.secrets?.project, 'json-test');
    });

    test('findConfig should parse YAML file found via discovery', async () => {
        const yamlContent = [
            'secrets:',
            '  provider: doppler',
            '  loader: dotenv',
            '  batches:',
            '    - production',
            '  project: discovered-yaml',
        ].join('\n');

        await writeRawConfigFile(tempDir, 'dev-setup.yaml', yamlContent);

        const fakeOutput = createFakeOutputChannel();
        const location = await findConfig(vscode.Uri.file(tempDir), fakeOutput);

        assert.ok(location, 'YAML config should be discovered');
        assert.strictEqual(location.config.secrets?.project, 'discovered-yaml');
        assert.strictEqual(location.filename, 'dev-setup.yaml');
    });

    // ── Doppler API Interaction ─────────────────────────────────────

    test('should call Doppler API with correct parameters', async () => {
        fetchMock.install();
        fetchMock.addResponse(
            'https://api.doppler.com/v3/configs/config/secrets',
            { status: 200, body: JSON.stringify({ secrets: {} }) },
        );

        const fakeOutput = createFakeOutputChannel();
        await fetchSecrets('dp.test.mock_token', 'test-project', 'dev', fakeOutput);

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

        const fakeOutput = createFakeOutputChannel();
        const secrets = await fetchSecrets('dp.test.token', 'proj', 'dev', fakeOutput);

        assert.deepStrictEqual(secrets, {
            DATABASE_URL: 'pg://localhost:5432/mydb',
            API_KEY: 'sk-test-12345',
            APP_NAME: 'MyApp',
        });
    });

    // ── .env Writing ────────────────────────────────────────────────

    test('should write .env file with sorted keys and batch header', async () => {
        const batches: BatchedSecretEntry[] = [
            {
                batchName: 'my-project/dev',
                secrets: {
                    ZEBRA: 'z-value',
                    ALPHA: 'a-value',
                    MIDDLE: 'm-value',
                },
            },
        ];

        const fakeOutput = createFakeOutputChannel();
        await writeDotenv(tempDir, batches, fakeOutput);

        const envUri = vscode.Uri.joinPath(vscode.Uri.file(tempDir), '.env');
        const content = new TextDecoder().decode(
            await vscode.workspace.fs.readFile(envUri),
        );

        const lines = content.split('\n');
        assert.strictEqual(lines[0], '# Doppler: my-project/dev');
        assert.strictEqual(lines[1], 'ALPHA=a-value');
        assert.strictEqual(lines[2], 'MIDDLE=m-value');
        assert.strictEqual(lines[3], 'ZEBRA=z-value');
        assert.strictEqual(lines[4], '', 'File should end with trailing newline');
    });

    test('should quote values containing special characters', async () => {
        const batches: BatchedSecretEntry[] = [
            {
                batchName: 'test/dev',
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
        await writeDotenv(tempDir, batches, fakeOutput);

        const envUri = vscode.Uri.joinPath(vscode.Uri.file(tempDir), '.env');
        const content = new TextDecoder().decode(
            await vscode.workspace.fs.readFile(envUri),
        );

        const lines = content.split('\n');
        // Line 0: batch header, then keys sorted: EMPTY, HASH, NEWLINE, SIMPLE, SPACES
        assert.strictEqual(lines[0], '# Doppler: test/dev');
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
                batchName: 'my-project/dev',
                secrets: {
                    SHARED: 'dev-val',
                    DEV_ONLY: 'dev-only',
                },
            },
            {
                batchName: 'my-project/ci',
                secrets: {
                    SHARED: 'ci-val',
                    CI_ONLY: 'ci-only',
                },
            },
        ];

        const fakeOutput = createFakeOutputChannel();
        await writeDotenv(tempDir, batches, fakeOutput);

        const envUri = vscode.Uri.joinPath(vscode.Uri.file(tempDir), '.env');
        const content = new TextDecoder().decode(
            await vscode.workspace.fs.readFile(envUri),
        );

        // Expected format:
        // # Doppler: my-project/dev
        // DEV_ONLY=dev-only
        // SHARED=dev-val
        //
        // # Doppler: my-project/ci
        // # SHARED: duplicate, already defined in "my-project/dev"
        // CI_ONLY=ci-only
        const expectedEnv = [
            '# Doppler: my-project/dev',
            'DEV_ONLY=dev-only',
            'SHARED=dev-val',
            '',
            '# Doppler: my-project/ci',
            '# SHARED: duplicate, already defined in "my-project/dev"',
            'CI_ONLY=ci-only',
            '',
        ].join('\n');

        assert.strictEqual(content, expectedEnv, '.env should use first-writer-wins with duplicate comments');
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

    // ── Timeout Handling ─────────────────────────────────────────────

    test('should throw on fetch timeout (AbortSignal)', async () => {
        fetchMock.install();

        // Install a handler that never resolves, simulating a hung connection
        fetchMock.addHandler(
            'https://api.doppler.com/v3/configs/config/secrets',
            () => new Promise<Response>(() => { /* never resolves */ }),
        );

        // Use a short AbortSignal to avoid waiting 30 s in tests.
        // We call fetch directly with a custom signal to prove the
        // timeout path works end-to-end via the dopplerClient catch block.
        const controller = new AbortController();
        // Abort after 50 ms
        setTimeout(() => controller.abort(new DOMException('The operation was aborted.', 'AbortError')), 50);

        // Call the underlying fetch ourselves to verify the mock respects the signal
        try {
            await globalThis.fetch(
                'https://api.doppler.com/v3/configs/config/secrets?project=p&config=c',
                { signal: controller.signal },
            );
            assert.fail('Expected fetch to throw on abort');
        } catch (err: any) {
            assert.ok(
                err instanceof DOMException,
                `Expected DOMException, got ${err.constructor.name}`,
            );
            assert.strictEqual(err.name, 'AbortError');
        }
    });

    test('fetchSecrets should throw a timeout error for a hung connection', async () => {
        fetchMock.install();

        // A handler that never resolves — simulates API hang
        fetchMock.addHandler(
            'https://api.doppler.com/v3/configs/config/secrets',
            () => new Promise<Response>(() => { /* never resolves */ }),
        );

        // Monkey-patch AbortSignal.timeout to use a short duration for this test
        const origTimeout = AbortSignal.timeout;
        AbortSignal.timeout = ((): AbortSignal => origTimeout.call(AbortSignal, 100)) as typeof AbortSignal.timeout;

        try {
            const fakeOutput = createFakeOutputChannel();
            await assert.rejects(
                () => fetchSecrets('dp.test.token', 'proj', 'dev', fakeOutput),
                (err: any) => {
                    assert.ok(err instanceof Error, 'Should throw an Error');
                    assert.ok(
                        err.message.includes('timed out'),
                        `Error message should mention timeout, got: "${err.message}"`,
                    );
                    return true;
                },
            );
        } finally {
            AbortSignal.timeout = origTimeout;
        }
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
});
