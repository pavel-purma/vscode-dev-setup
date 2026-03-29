import * as assert from 'assert';
import { fetchSecrets } from '../../doppler/dopplerClient';
import * as fetchMock from '../helpers/fetchMock';
import { createFakeOutputChannel } from '../helpers/fakeOutputChannel';
import {
    createTempWorkspace,
    cleanupTempWorkspace,
} from '../helpers/tempWorkspace';
import { resetConcurrencyGuard } from '../../pipeline/secretsPipeline';

suite('Doppler API Client', () => {
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

    // ── Timeout Handling (Doppler) ─────────────────────────────────────

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
});
