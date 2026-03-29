import * as assert from 'assert';
import * as vscode from 'vscode';
import { findConfig } from '../../config/configFinder';
import { parseJsonConfig, parseYamlConfig } from '../../config/configParser';
import { createFakeOutputChannel } from '../helpers/fakeOutputChannel';
import {
    createTempWorkspace,
    cleanupTempWorkspace,
    writeRawConfigFile,
} from '../helpers/tempWorkspace';
import { resetConcurrencyGuard } from '../../pipeline/secretsPipeline';

suite('Config Parsing', () => {
    let tempDir: string;

    setup(async () => {
        tempDir = await createTempWorkspace();
        resetConcurrencyGuard();
    });

    teardown(async () => {
        resetConcurrencyGuard();
        await cleanupTempWorkspace(tempDir);
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
});
