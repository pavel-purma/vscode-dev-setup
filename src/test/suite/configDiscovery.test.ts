import * as assert from 'assert';
import * as vscode from 'vscode';
import { findConfig } from '../../config/configFinder';
import { createFakeOutputChannel } from '../helpers/fakeOutputChannel';
import {
    createTempWorkspace,
    cleanupTempWorkspace,
    writeConfigFile,
    writeYamlConfigFile,
} from '../helpers/tempWorkspace';
import { resetConcurrencyGuard } from '../../pipeline/secretsPipeline';

suite('Config Discovery', () => {
    let tempDir: string;

    setup(async () => {
        tempDir = await createTempWorkspace();
        resetConcurrencyGuard();
    });

    teardown(async () => {
        resetConcurrencyGuard();
        await cleanupTempWorkspace(tempDir);
    });

    // ── Config Discovery (JSON) ─────────────────────────────────────

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

    // ── Infisical Config Discovery ──────────────────────────────────

    test('should discover Infisical JSON config in workspace root', async () => {
        const config = {
            secrets: {
                provider: 'infisical',
                loader: 'dotenv',
                batches: ['dev'],
                project: 'infisical-root-project',
            },
        };
        await writeConfigFile(tempDir, config);

        const fakeOutput = createFakeOutputChannel();
        const location = await findConfig(vscode.Uri.file(tempDir), fakeOutput);

        assert.ok(location, 'Config should be found');
        assert.strictEqual(location.config.secrets?.project, 'infisical-root-project');
        assert.strictEqual(location.config.secrets?.provider, 'infisical');
        assert.deepStrictEqual(location.config.secrets?.batches, ['dev']);
    });

    test('should discover Infisical YAML config in workspace root', async () => {
        const config = {
            secrets: {
                provider: 'infisical',
                loader: 'dotenv',
                batches: ['dev', 'staging'],
                project: 'infisical-yaml-root',
            },
        };
        await writeYamlConfigFile(tempDir, config, 'dev-setup.yaml');

        const fakeOutput = createFakeOutputChannel();
        const location = await findConfig(vscode.Uri.file(tempDir), fakeOutput);

        assert.ok(location, 'YAML config should be found');
        assert.strictEqual(location.config.secrets?.project, 'infisical-yaml-root');
        assert.strictEqual(location.config.secrets?.provider, 'infisical');
        assert.deepStrictEqual(location.config.secrets?.batches, ['dev', 'staging']);
        assert.strictEqual(location.filename, 'dev-setup.yaml');
    });
});
