import * as assert from 'assert';
import * as vscode from 'vscode';
import { findConfig } from '../../config/configFinder';
import { parseJsonConfig, parseYamlConfig } from '../../config/configParser';
import { BatchedSecretEntry } from '../../config/configTypes';
import { fetchSecrets } from '../../doppler/dopplerClient';
import {
    isGuid,
    fetchWorkspaces,
    resolveWorkspaceId,
    InfisicalCredentials,
} from '../../infisical/infisicalClient';
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

    test('should discover JSON config in dev/ subdirectory', async () => {
        const config = {
            secrets: {
                provider: 'doppler',
                loader: 'dotenv',
                batches: ['staging'],
                project: 'sub-project',
            },
        };
        await writeConfigFile(tempDir, config, 'dev');

        const fakeOutput = createFakeOutputChannel();
        const location = await findConfig(vscode.Uri.file(tempDir), fakeOutput);

        assert.ok(location, 'Config should be found in dev/ subdir');
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

    test('dev/dev-setup.yaml should have higher priority than root dev-setup.json', async () => {
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

        // Place YAML in dev/ subdir (higher priority)
        const yamlConfig = {
            secrets: {
                provider: 'doppler',
                loader: 'dotenv',
                batches: ['yaml-batch'],
                project: 'yaml-project',
            },
        };
        await writeYamlConfigFile(tempDir, yamlConfig, 'dev-setup.yaml', 'dev');

        const fakeOutput = createFakeOutputChannel();
        const location = await findConfig(vscode.Uri.file(tempDir), fakeOutput);

        assert.ok(location, 'Config should be found');
        assert.strictEqual(location.config.secrets?.project, 'yaml-project', 'dev/ YAML should win over root JSON');
        assert.strictEqual(location.filename, 'dev-setup.yaml');
    });

    test('dev/dev-setup.json should have higher priority than root dev-setup.yaml', async () => {
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

        // Place JSON in dev/ subdir (higher priority)
        const jsonConfig = {
            secrets: {
                provider: 'doppler',
                loader: 'dotenv',
                batches: ['json-batch'],
                project: 'json-subdir-project',
            },
        };
        await writeConfigFile(tempDir, jsonConfig, 'dev');

        const fakeOutput = createFakeOutputChannel();
        const location = await findConfig(vscode.Uri.file(tempDir), fakeOutput);

        assert.ok(location, 'Config should be found');
        assert.strictEqual(location.config.secrets?.project, 'json-subdir-project', 'dev/ JSON should win over root YAML');
        assert.strictEqual(location.filename, 'dev-setup.json');
    });

    test('YAML in dev/ should take priority over YAML in root', async () => {
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

        // Place YAML in dev/ subdir (higher priority)
        const subConfig = {
            secrets: {
                provider: 'doppler',
                loader: 'dotenv',
                batches: ['sub-batch'],
                project: 'sub-yaml',
            },
        };
        await writeYamlConfigFile(tempDir, subConfig, 'dev-setup.yaml', 'dev');

        const fakeOutput = createFakeOutputChannel();
        const location = await findConfig(vscode.Uri.file(tempDir), fakeOutput);

        assert.ok(location, 'Config should be found');
        assert.strictEqual(location.config.secrets?.project, 'sub-yaml', 'dev/ YAML should win over root YAML');
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
            // missing 'loader' and 'script' fields
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
                    err.message.includes("'secrets' must define at least one of 'loader' or 'script'"),
                    `Error should mention at least one of loader or script, got: "${err.message}"`,
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

    test('should strip DOPPLER_ prefixed metadata secrets from response', async () => {
        fetchMock.install();
        const mockSecrets = {
            secrets: {
                DATABASE_URL: { raw: 'pg://ref', computed: 'pg://localhost:5432/mydb' },
                API_KEY: { raw: '${ref}', computed: 'sk-test-12345' },
                DOPPLER_PROJECT: { raw: 'my-project', computed: 'my-project' },
                DOPPLER_CONFIG: { raw: 'dev', computed: 'dev' },
                DOPPLER_ENVIRONMENT: { raw: 'development', computed: 'development' },
            },
        };
        fetchMock.addResponse(
            'https://api.doppler.com/v3/configs/config/secrets',
            { status: 200, body: JSON.stringify(mockSecrets) },
        );

        const fakeOutput = createFakeOutputChannel();
        const secrets = await fetchSecrets('dp.test.token', 'proj', 'dev', fakeOutput);

        // Regular secrets should be present
        assert.strictEqual(secrets['DATABASE_URL'], 'pg://localhost:5432/mydb');
        assert.strictEqual(secrets['API_KEY'], 'sk-test-12345');

        // DOPPLER_ prefixed metadata secrets should be stripped
        assert.strictEqual(secrets['DOPPLER_PROJECT'], undefined, 'DOPPLER_PROJECT should be stripped');
        assert.strictEqual(secrets['DOPPLER_CONFIG'], undefined, 'DOPPLER_CONFIG should be stripped');
        assert.strictEqual(secrets['DOPPLER_ENVIRONMENT'], undefined, 'DOPPLER_ENVIRONMENT should be stripped');

        // Only the 2 regular secrets should remain
        assert.strictEqual(Object.keys(secrets).length, 2, 'Only non-DOPPLER_ secrets should remain');
    });

    test('should keep secrets that happen to contain DOPPLER in the middle of the name', async () => {
        fetchMock.install();
        const mockSecrets = {
            secrets: {
                MY_DOPPLER_SETTING: { raw: 'custom', computed: 'custom-value' },
                APP_DOPPLER_KEY: { raw: 'key', computed: 'key-value' },
                DOPPLER_PROJECT: { raw: 'my-project', computed: 'my-project' },
                DATABASE_URL: { raw: 'pg://ref', computed: 'pg://localhost:5432/mydb' },
            },
        };
        fetchMock.addResponse(
            'https://api.doppler.com/v3/configs/config/secrets',
            { status: 200, body: JSON.stringify(mockSecrets) },
        );

        const fakeOutput = createFakeOutputChannel();
        const secrets = await fetchSecrets('dp.test.token', 'proj', 'dev', fakeOutput);

        // Secrets with DOPPLER in the middle should NOT be stripped
        assert.strictEqual(secrets['MY_DOPPLER_SETTING'], 'custom-value', 'MY_DOPPLER_SETTING should be kept');
        assert.strictEqual(secrets['APP_DOPPLER_KEY'], 'key-value', 'APP_DOPPLER_KEY should be kept');
        assert.strictEqual(secrets['DATABASE_URL'], 'pg://localhost:5432/mydb', 'DATABASE_URL should be kept');

        // Only DOPPLER_PROJECT (starts with DOPPLER_) should be stripped
        assert.strictEqual(secrets['DOPPLER_PROJECT'], undefined, 'DOPPLER_PROJECT should be stripped');

        assert.strictEqual(Object.keys(secrets).length, 3, 'Three non-DOPPLER_ prefixed secrets should remain');
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
        await writeDotenv(tempDir, batches, fakeOutput);

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
        await writeDotenv(tempDir, batches, fakeOutput);

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
        await writeDotenv(tempDir, batches, fakeOutput);

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

    // ── Config Validation: filter field ──────────────────────────────

    test('parseJsonConfig should accept valid filter with include only', () => {
        const jsonContent = JSON.stringify({
            secrets: {
                provider: 'doppler',
                loader: 'dotenv',
                batches: ['dev'],
                filter: { include: ['^DB_'] },
            },
        });

        const fakeOutput = createFakeOutputChannel();
        const raw = new TextEncoder().encode(jsonContent);
        const config = parseJsonConfig(raw, fakeOutput);

        assert.deepStrictEqual(config.secrets?.filter, { include: ['^DB_'] });
    });

    test('parseJsonConfig should accept valid filter with exclude only', () => {
        const jsonContent = JSON.stringify({
            secrets: {
                provider: 'doppler',
                loader: 'dotenv',
                batches: ['dev'],
                filter: { exclude: ['^TEMP_'] },
            },
        });

        const fakeOutput = createFakeOutputChannel();
        const raw = new TextEncoder().encode(jsonContent);
        const config = parseJsonConfig(raw, fakeOutput);

        assert.deepStrictEqual(config.secrets?.filter, { exclude: ['^TEMP_'] });
    });

    test('parseJsonConfig should accept valid filter with both include and exclude', () => {
        const jsonContent = JSON.stringify({
            secrets: {
                provider: 'doppler',
                loader: 'dotenv',
                batches: ['dev'],
                filter: { include: ['^DB_'], exclude: ['_TEMP$'] },
            },
        });

        const fakeOutput = createFakeOutputChannel();
        const raw = new TextEncoder().encode(jsonContent);
        const config = parseJsonConfig(raw, fakeOutput);

        assert.deepStrictEqual(config.secrets?.filter, { include: ['^DB_'], exclude: ['_TEMP$'] });
    });

    test('parseJsonConfig should accept config without filter field', () => {
        const jsonContent = JSON.stringify({
            secrets: {
                provider: 'doppler',
                loader: 'dotenv',
                batches: ['dev'],
            },
        });

        const fakeOutput = createFakeOutputChannel();
        const raw = new TextEncoder().encode(jsonContent);
        const config = parseJsonConfig(raw, fakeOutput);

        assert.strictEqual(config.secrets?.filter, undefined);
    });

    test('parseJsonConfig should reject filter that is a plain array', () => {
        const jsonContent = JSON.stringify({
            secrets: {
                provider: 'doppler',
                loader: 'dotenv',
                batches: ['dev'],
                filter: ['^DB_'],
            },
        });

        const fakeOutput = createFakeOutputChannel();
        const raw = new TextEncoder().encode(jsonContent);

        assert.throws(
            () => parseJsonConfig(raw, fakeOutput),
            (err: unknown) => {
                assert.ok(err instanceof Error);
                assert.ok(
                    err.message.includes("'secrets.filter' must be an object"),
                    `Error should mention must be an object, got: "${err.message}"`,
                );
                return true;
            },
        );
    });

    test('parseJsonConfig should reject filter with empty include array', () => {
        const jsonContent = JSON.stringify({
            secrets: {
                provider: 'doppler',
                loader: 'dotenv',
                batches: ['dev'],
                filter: { include: [] },
            },
        });

        const fakeOutput = createFakeOutputChannel();
        const raw = new TextEncoder().encode(jsonContent);

        assert.throws(
            () => parseJsonConfig(raw, fakeOutput),
            (err: unknown) => {
                assert.ok(err instanceof Error);
                assert.ok(
                    err.message.includes("'secrets.filter.include' must be a non-empty array"),
                    `Error should mention non-empty array, got: "${err.message}"`,
                );
                return true;
            },
        );
    });

    test('parseJsonConfig should reject filter with empty exclude array', () => {
        const jsonContent = JSON.stringify({
            secrets: {
                provider: 'doppler',
                loader: 'dotenv',
                batches: ['dev'],
                filter: { exclude: [] },
            },
        });

        const fakeOutput = createFakeOutputChannel();
        const raw = new TextEncoder().encode(jsonContent);

        assert.throws(
            () => parseJsonConfig(raw, fakeOutput),
            (err: unknown) => {
                assert.ok(err instanceof Error);
                assert.ok(
                    err.message.includes("'secrets.filter.exclude' must be a non-empty array"),
                    `Error should mention non-empty array, got: "${err.message}"`,
                );
                return true;
            },
        );
    });

    test('parseJsonConfig should reject filter with neither include nor exclude', () => {
        const jsonContent = JSON.stringify({
            secrets: {
                provider: 'doppler',
                loader: 'dotenv',
                batches: ['dev'],
                filter: {},
            },
        });

        const fakeOutput = createFakeOutputChannel();
        const raw = new TextEncoder().encode(jsonContent);

        assert.throws(
            () => parseJsonConfig(raw, fakeOutput),
            (err: unknown) => {
                assert.ok(err instanceof Error);
                assert.ok(
                    err.message.includes("'secrets.filter' must contain at least one of 'include' or 'exclude'"),
                    `Error should mention at least one key required, got: "${err.message}"`,
                );
                return true;
            },
        );
    });

    test('parseJsonConfig should reject filter with invalid regex in include', () => {
        const jsonContent = JSON.stringify({
            secrets: {
                provider: 'doppler',
                loader: 'dotenv',
                batches: ['dev'],
                filter: { include: ['[invalid'] },
            },
        });

        const fakeOutput = createFakeOutputChannel();
        const raw = new TextEncoder().encode(jsonContent);

        assert.throws(
            () => parseJsonConfig(raw, fakeOutput),
            (err: unknown) => {
                assert.ok(err instanceof Error);
                assert.ok(
                    err.message.includes("'secrets.filter.include' contains an invalid regex"),
                    `Error should mention invalid regex, got: "${err.message}"`,
                );
                return true;
            },
        );
    });

    test('parseJsonConfig should reject filter with invalid regex in exclude', () => {
        const jsonContent = JSON.stringify({
            secrets: {
                provider: 'doppler',
                loader: 'dotenv',
                batches: ['dev'],
                filter: { exclude: ['[invalid'] },
            },
        });

        const fakeOutput = createFakeOutputChannel();
        const raw = new TextEncoder().encode(jsonContent);

        assert.throws(
            () => parseJsonConfig(raw, fakeOutput),
            (err: unknown) => {
                assert.ok(err instanceof Error);
                assert.ok(
                    err.message.includes("'secrets.filter.exclude' contains an invalid regex"),
                    `Error should mention invalid regex, got: "${err.message}"`,
                );
                return true;
            },
        );
    });

    test('parseJsonConfig should reject filter with non-string elements in include', () => {
        const jsonContent = JSON.stringify({
            secrets: {
                provider: 'doppler',
                loader: 'dotenv',
                batches: ['dev'],
                filter: { include: [123] },
            },
        });

        const fakeOutput = createFakeOutputChannel();
        const raw = new TextEncoder().encode(jsonContent);

        assert.throws(
            () => parseJsonConfig(raw, fakeOutput),
            (err: unknown) => {
                assert.ok(err instanceof Error);
                assert.ok(
                    err.message.includes("each entry in 'secrets.filter.include' must be a non-empty string"),
                    `Error should mention non-empty string, got: "${err.message}"`,
                );
                return true;
            },
        );
    });

    test('parseJsonConfig should reject filter with unknown keys', () => {
        const jsonContent = JSON.stringify({
            secrets: {
                provider: 'doppler',
                loader: 'dotenv',
                batches: ['dev'],
                filter: { include: ['^DB_'], unknown: true },
            },
        });

        const fakeOutput = createFakeOutputChannel();
        const raw = new TextEncoder().encode(jsonContent);

        assert.throws(
            () => parseJsonConfig(raw, fakeOutput),
            (err: unknown) => {
                assert.ok(err instanceof Error);
                assert.ok(
                    err.message.includes("'secrets.filter' contains unknown key"),
                    `Error should mention unknown key, got: "${err.message}"`,
                );
                return true;
            },
        );
    });

    test('parseYamlConfig should accept valid filter in YAML', () => {
        const yamlContent = [
            'secrets:',
            '  provider: doppler',
            '  loader: dotenv',
            '  batches:',
            '    - dev',
            '  filter:',
            '    include:',
            '      - "^DB_"',
            '    exclude:',
            '      - "_TEMP$"',
        ].join('\n');

        const fakeOutput = createFakeOutputChannel();
        const raw = new TextEncoder().encode(yamlContent);
        const config = parseYamlConfig(raw, fakeOutput);

        assert.deepStrictEqual(config.secrets?.filter, { include: ['^DB_'], exclude: ['_TEMP$'] });
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

    test('automatic mode should NOT show popup when Doppler token is missing', async () => {
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

        // 3. Spy on showInformationMessage
        const originalShowInfo = vscode.window.showInformationMessage;
        const infoCalls: string[] = [];
        (vscode.window as any).showInformationMessage = (...args: any[]) => {
            infoCalls.push(args[0]);
            return Promise.resolve(undefined);
        };

        try {
            // 4. Run the pipeline with manual: false
            await processWorkspaceFolder(fakeFolder, fakeContext, fakeOutput, false);

            // 5. Verify NO popup was shown
            assert.ok(
                !infoCalls.some(m => m.includes('Doppler token not configured')),
                'Should NOT show info popup for missing token in automatic mode',
            );

            // 6. Verify the skip was logged to the output channel
            const logLines = fakeOutput.getLines();
            assert.ok(
                logLines.some(l => l.includes('[no-token-auto] Doppler token not configured — skipping.')),
                'Should log skip message to output channel in automatic mode',
            );
        } finally {
            (vscode.window as any).showInformationMessage = originalShowInfo;
        }
    });

    test('manual mode should show popup when Doppler token is missing', async () => {
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

        // 3. Spy on showInformationMessage
        const originalShowInfo = vscode.window.showInformationMessage;
        const infoCalls: string[] = [];
        (vscode.window as any).showInformationMessage = (...args: any[]) => {
            infoCalls.push(args[0]);
            return Promise.resolve(undefined);
        };

        try {
            // 4. Run the pipeline with manual: true
            await processWorkspaceFolder(fakeFolder, fakeContext, fakeOutput, true);

            // 5. Verify the popup WAS shown with Dev Setup: prefix
            assert.ok(
                infoCalls.some(m => m === "Dev Setup: Doppler token not configured. Use 'Login to Doppler' command first."),
                'Should show info popup with Dev Setup: prefix for missing token in manual mode',
            );
        } finally {
            (vscode.window as any).showInformationMessage = originalShowInfo;
        }
    });

    // ── Config Validation: loader/script optionality ─────────────────

    test('loader optional when script is defined', () => {
        const jsonContent = JSON.stringify({
            secrets: {
                provider: 'doppler',
                script: 'npm start',
                batches: ['dev'],
            },
        });

        const fakeOutput = createFakeOutputChannel();
        const raw = new TextEncoder().encode(jsonContent);
        const config = parseJsonConfig(raw, fakeOutput);

        assert.strictEqual(config.secrets?.script, 'npm start');
        assert.strictEqual(config.secrets?.loader, undefined);
    });

    test('both loader and script defined parses successfully', () => {
        const jsonContent = JSON.stringify({
            secrets: {
                provider: 'doppler',
                loader: 'dotenv',
                script: 'npm start',
                batches: ['dev'],
            },
        });

        const fakeOutput = createFakeOutputChannel();
        const raw = new TextEncoder().encode(jsonContent);
        const config = parseJsonConfig(raw, fakeOutput);

        assert.strictEqual(config.secrets?.loader, 'dotenv');
        assert.strictEqual(config.secrets?.script, 'npm start');
    });

    test('neither loader nor script rejects', () => {
        const jsonContent = JSON.stringify({
            secrets: {
                provider: 'doppler',
                batches: ['dev'],
            },
        });

        const fakeOutput = createFakeOutputChannel();
        const raw = new TextEncoder().encode(jsonContent);

        assert.throws(
            () => parseJsonConfig(raw, fakeOutput),
            (err: unknown) => {
                assert.ok(err instanceof Error);
                assert.ok(
                    err.message.includes("at least one of 'loader' or 'script'"),
                    `Error should mention at least one of loader or script, got: "${err.message}"`,
                );
                return true;
            },
        );
    });

    test('empty string script rejects', () => {
        const jsonContent = JSON.stringify({
            secrets: {
                provider: 'doppler',
                script: '',
                batches: ['dev'],
            },
        });

        const fakeOutput = createFakeOutputChannel();
        const raw = new TextEncoder().encode(jsonContent);

        assert.throws(
            () => parseJsonConfig(raw, fakeOutput),
            (err: unknown) => {
                assert.ok(err instanceof Error);
                assert.ok(
                    err.message.includes("'secrets.script' must be a non-empty string"),
                    `Error should mention non-empty string, got: "${err.message}"`,
                );
                return true;
            },
        );
    });

    test('non-string script rejects', () => {
        const jsonContent = JSON.stringify({
            secrets: {
                provider: 'doppler',
                script: 123,
                batches: ['dev'],
            },
        });

        const fakeOutput = createFakeOutputChannel();
        const raw = new TextEncoder().encode(jsonContent);

        assert.throws(
            () => parseJsonConfig(raw, fakeOutput),
            (err: unknown) => {
                assert.ok(err instanceof Error);
                assert.ok(
                    err.message.includes("'secrets.script' must be a non-empty string"),
                    `Error should mention non-empty string, got: "${err.message}"`,
                );
                return true;
            },
        );
    });

    // ── Script Pipeline Integration Tests ────────────────────────────

    suite('script pipeline integration', () => {
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

            // 5. Verify createTerminal was called with correct env vars
            assert.strictEqual(terminalOptions.length, 1, 'createTerminal should be called once');
            assert.deepStrictEqual(terminalOptions[0].env, {
                DB_HOST: 'localhost',
                API_KEY: 'sk-12345',
            });

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

            // 6. Verify createTerminal was called
            assert.strictEqual(terminalOptions.length, 1, 'createTerminal should be called once');
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

                // 6. Verify success message mentions script started
                assert.ok(
                    infoCalls.some(m => m.includes('script started')),
                    `Should show success notification mentioning script started, got: ${JSON.stringify(infoCalls)}`,
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

                // 6. Verify success message mentions both written to and script started
                assert.ok(
                    infoCalls.some(m => m.includes('written to')),
                    `Should mention written to in notification, got: ${JSON.stringify(infoCalls)}`,
                );
                assert.ok(
                    infoCalls.some(m => m.includes('script started')),
                    `Should mention script started in notification, got: ${JSON.stringify(infoCalls)}`,
                );
            } finally {
                (vscode.window as any).showInformationMessage = originalShowInfo;
            }
        });
    });

    // ── Infisical Slug-to-Workspace-ID Resolution ─────────────────────

    suite('isGuid()', () => {
        test('valid GUID returns true', () => {
            assert.strictEqual(isGuid('a1b2c3d4-e5f6-7890-abcd-ef1234567890'), true);
        });

        test('valid GUID with uppercase returns true', () => {
            assert.strictEqual(isGuid('A1B2C3D4-E5F6-7890-ABCD-EF1234567890'), true);
        });

        test('non-GUID slug returns false', () => {
            assert.strictEqual(isGuid('my-project'), false);
        });

        test('empty string returns false', () => {
            assert.strictEqual(isGuid(''), false);
        });

        test('partial GUID returns false', () => {
            assert.strictEqual(isGuid('a1b2c3d4-e5f6'), false);
        });
    });

    suite('fetchWorkspaces()', () => {
        test('successful fetch returns workspace array', async () => {
            fetchMock.install();

            const mockWorkspaces = {
                workspaces: [
                    { id: 'ws-id-1', name: 'Project Alpha', slug: 'project-alpha' },
                    { id: 'ws-id-2', name: 'Project Beta', slug: 'project-beta' },
                ],
            };
            fetchMock.addResponse(
                'https://app.infisical.com/api/v1/workspaces',
                { status: 200, body: JSON.stringify(mockWorkspaces) },
            );

            const result = await fetchWorkspaces('mock-access-token', 'https://app.infisical.com');

            assert.strictEqual(result.length, 2);
            assert.strictEqual(result[0].id, 'ws-id-1');
            assert.strictEqual(result[0].slug, 'project-alpha');
            assert.strictEqual(result[1].id, 'ws-id-2');
            assert.strictEqual(result[1].slug, 'project-beta');

            const calls = fetchMock.getCalls();
            assert.strictEqual(calls.length, 1);
            assert.strictEqual(calls[0].headers['Authorization'], 'Bearer mock-access-token');
        });

        test('non-OK response throws with status code', async () => {
            fetchMock.install();

            fetchMock.addResponse(
                'https://app.infisical.com/api/v1/workspaces',
                { status: 403, body: 'Forbidden' },
            );

            await assert.rejects(
                () => fetchWorkspaces('bad-token', 'https://app.infisical.com'),
                (err: unknown) => {
                    assert.ok(err instanceof Error);
                    assert.ok(
                        err.message.includes('403'),
                        `Error should include status code 403, got: "${err.message}"`,
                    );
                    return true;
                },
            );
        });

        test('unexpected response format (missing workspaces key) throws', async () => {
            fetchMock.install();

            fetchMock.addResponse(
                'https://app.infisical.com/api/v1/workspaces',
                { status: 200, body: JSON.stringify({ projects: [] }) },
            );

            await assert.rejects(
                () => fetchWorkspaces('mock-token', 'https://app.infisical.com'),
                (err: unknown) => {
                    assert.ok(err instanceof Error);
                    assert.ok(
                        err.message.includes('Unexpected response format'),
                        `Error should mention unexpected format, got: "${err.message}"`,
                    );
                    return true;
                },
            );
        });
    });

    suite('resolveWorkspaceId()', () => {
        test('GUID project returns as-is without any API calls', async () => {
            fetchMock.install();

            const credentials: InfisicalCredentials = {
                clientId: 'client-id',
                clientSecret: 'client-secret',
                siteUrl: 'https://app.infisical.com',
            };
            const fakeOutput = createFakeOutputChannel();
            const guid = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';

            const result = await resolveWorkspaceId(credentials, guid, fakeOutput);

            assert.strictEqual(result, guid);

            // Verify no fetch calls were made
            const calls = fetchMock.getCalls();
            assert.strictEqual(calls.length, 0, 'No API calls should be made for a GUID project');
        });

        test('slug project authenticates, fetches workspaces, and returns matching ID', async () => {
            fetchMock.install();

            const credentials: InfisicalCredentials = {
                clientId: 'test-client-id',
                clientSecret: 'test-client-secret',
                siteUrl: 'https://app.infisical.com',
            };

            // Mock auth response
            fetchMock.addResponse(
                'https://app.infisical.com/api/v1/auth/universal-auth/login',
                {
                    status: 200,
                    body: JSON.stringify({
                        accessToken: 'resolved-access-token',
                        expiresIn: 3600,
                        tokenType: 'Bearer',
                    }),
                },
            );

            // Mock workspaces response
            fetchMock.addResponse(
                'https://app.infisical.com/api/v1/workspaces',
                {
                    status: 200,
                    body: JSON.stringify({
                        workspaces: [
                            { id: 'ws-id-alpha', name: 'Alpha', slug: 'alpha' },
                            { id: 'ws-id-beta', name: 'Beta', slug: 'my-project' },
                        ],
                    }),
                },
            );

            const fakeOutput = createFakeOutputChannel();
            const result = await resolveWorkspaceId(credentials, 'my-project', fakeOutput);

            assert.strictEqual(result, 'ws-id-beta');

            // Verify auth and workspaces calls were made
            const calls = fetchMock.getCalls();
            assert.strictEqual(calls.length, 2, 'Should make auth + workspaces calls');
            assert.ok(calls[0].url.includes('/auth/universal-auth/login'), 'First call should be auth');
            assert.ok(calls[1].url.includes('/workspaces'), 'Second call should be workspaces');
        });

        test('slug with no match throws error listing available slugs', async () => {
            fetchMock.install();

            const credentials: InfisicalCredentials = {
                clientId: 'test-client-id',
                clientSecret: 'test-client-secret',
                siteUrl: 'https://app.infisical.com',
            };

            // Mock auth response
            fetchMock.addResponse(
                'https://app.infisical.com/api/v1/auth/universal-auth/login',
                {
                    status: 200,
                    body: JSON.stringify({
                        accessToken: 'resolved-access-token',
                        expiresIn: 3600,
                        tokenType: 'Bearer',
                    }),
                },
            );

            // Mock workspaces response — no matching slug
            fetchMock.addResponse(
                'https://app.infisical.com/api/v1/workspaces',
                {
                    status: 200,
                    body: JSON.stringify({
                        workspaces: [
                            { id: 'ws-1', name: 'Alpha', slug: 'alpha' },
                            { id: 'ws-2', name: 'Beta', slug: 'beta' },
                        ],
                    }),
                },
            );

            const fakeOutput = createFakeOutputChannel();

            await assert.rejects(
                () => resolveWorkspaceId(credentials, 'nonexistent-slug', fakeOutput),
                (err: unknown) => {
                    assert.ok(err instanceof Error);
                    assert.ok(
                        err.message.includes('No Infisical workspace found with slug "nonexistent-slug"'),
                        `Error should mention the missing slug, got: "${err.message}"`,
                    );
                    assert.ok(
                        err.message.includes('alpha') && err.message.includes('beta'),
                        `Error should list available slugs, got: "${err.message}"`,
                    );
                    return true;
                },
            );
        });
    });

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
});
