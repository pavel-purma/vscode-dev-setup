import * as assert from 'assert';
import {
    isGuid,
    fetchWorkspaces,
    resolveWorkspaceId,
    authenticate,
    fetchSecrets as infisicalFetchSecrets,
    InfisicalCredentials,
} from '../../infisical/infisicalClient';
import * as fetchMock from '../helpers/fetchMock';
import { createFakeOutputChannel } from '../helpers/fakeOutputChannel';
import {
    createTempWorkspace,
    cleanupTempWorkspace,
} from '../helpers/tempWorkspace';
import { resetConcurrencyGuard } from '../../pipeline/secretsPipeline';

suite('Infisical API Client', () => {
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

    // ── isGuid() ──────────────────────────────────────────────────────

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

    // ── fetchWorkspaces() ─────────────────────────────────────────────

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

    // ── resolveWorkspaceId() ──────────────────────────────────────────

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

    // ── Infisical API Interaction ────────────────────────────────────

    suite('Infisical API interaction', () => {

        /** Standard mock credentials for Infisical tests. */
        const testCredentials: InfisicalCredentials = {
            clientId: 'test-client-id',
            clientSecret: 'test-client-secret',
            siteUrl: 'https://app.infisical.com',
        };

        test('authenticate should call Infisical Universal Auth endpoint', async () => {
            fetchMock.install();
            fetchMock.addResponse(
                'https://app.infisical.com/api/v1/auth/universal-auth/login',
                {
                    status: 200,
                    body: JSON.stringify({
                        accessToken: 'mock-access-token',
                        expiresIn: 7200,
                        tokenType: 'Bearer',
                    }),
                },
            );

            const fakeOutput = createFakeOutputChannel();
            const token = await authenticate(testCredentials, 'https://app.infisical.com', fakeOutput);

            assert.strictEqual(token.accessToken, 'mock-access-token');
            assert.strictEqual(token.expiresIn, 7200);
            assert.strictEqual(token.tokenType, 'Bearer');

            const calls = fetchMock.getCalls();
            assert.strictEqual(calls.length, 1, 'Should make one auth call');
            assert.strictEqual(calls[0].method, 'POST', 'Auth should be a POST request');
            assert.ok(
                calls[0].url.includes('/auth/universal-auth/login'),
                'URL should hit universal auth endpoint',
            );
        });

        test('authenticate should throw on non-OK response', async () => {
            fetchMock.install();
            fetchMock.addResponse(
                'https://app.infisical.com/api/v1/auth/universal-auth/login',
                { status: 401, body: 'Unauthorized' },
            );

            const fakeOutput = createFakeOutputChannel();
            await assert.rejects(
                () => authenticate(testCredentials, 'https://app.infisical.com', fakeOutput),
                (err: unknown) => {
                    assert.ok(err instanceof Error);
                    assert.ok(
                        err.message.includes('401'),
                        `Error should include status code, got: "${err.message}"`,
                    );
                    return true;
                },
            );
        });

        test('infisicalFetchSecrets should call auth + secrets endpoints', async () => {
            fetchMock.install();

            // Auth mock
            fetchMock.addResponse(
                'https://app.infisical.com/api/v1/auth/universal-auth/login',
                {
                    status: 200,
                    body: JSON.stringify({
                        accessToken: 'test-token',
                        expiresIn: 3600,
                        tokenType: 'Bearer',
                    }),
                },
            );

            // Secrets mock
            fetchMock.addResponse(
                'https://app.infisical.com/api/v3/secrets/raw',
                {
                    status: 200,
                    body: JSON.stringify({
                        secrets: [
                            { secretKey: 'DB_HOST', secretValue: 'pg-host.infisical.io' },
                            { secretKey: 'API_KEY', secretValue: 'inf-sk-12345' },
                        ],
                    }),
                },
            );

            const fakeOutput = createFakeOutputChannel();
            const secrets = await infisicalFetchSecrets(
                testCredentials,
                'ws-id-123',
                'dev',
                'https://app.infisical.com',
                '/',
                fakeOutput,
            );

            assert.deepStrictEqual(secrets, {
                DB_HOST: 'pg-host.infisical.io',
                API_KEY: 'inf-sk-12345',
            });

            const calls = fetchMock.getCalls();
            assert.strictEqual(calls.length, 2, 'Should make auth + secrets calls');
            assert.ok(calls[0].url.includes('/auth/universal-auth/login'), 'Call 1: auth');
            assert.ok(calls[1].url.includes('/api/v3/secrets/raw'), 'Call 2: secrets');
            assert.ok(
                calls[1].url.includes('workspaceId=ws-id-123'),
                'Secrets URL should include workspaceId param',
            );
            assert.ok(
                calls[1].url.includes('environment=dev'),
                'Secrets URL should include environment param',
            );
        });

        test('infisicalFetchSecrets should extract secretKey/secretValue from response', async () => {
            fetchMock.install();

            fetchMock.addResponse(
                'https://app.infisical.com/api/v1/auth/universal-auth/login',
                {
                    status: 200,
                    body: JSON.stringify({
                        accessToken: 'test-token',
                        expiresIn: 3600,
                        tokenType: 'Bearer',
                    }),
                },
            );

            const mockSecrets = {
                secrets: [
                    { secretKey: 'REDIS_URL', secretValue: 'redis://localhost:6379' },
                    { secretKey: 'JWT_SECRET', secretValue: 'super-secret-jwt-key' },
                    { secretKey: 'EMPTY_SECRET', secretValue: '' },
                ],
            };
            fetchMock.addResponse(
                'https://app.infisical.com/api/v3/secrets/raw',
                { status: 200, body: JSON.stringify(mockSecrets) },
            );

            const fakeOutput = createFakeOutputChannel();
            const secrets = await infisicalFetchSecrets(
                testCredentials,
                'ws-id',
                'production',
                'https://app.infisical.com',
                '/',
                fakeOutput,
            );

            assert.strictEqual(secrets['REDIS_URL'], 'redis://localhost:6379');
            assert.strictEqual(secrets['JWT_SECRET'], 'super-secret-jwt-key');
            assert.strictEqual(secrets['EMPTY_SECRET'], '');
            assert.strictEqual(Object.keys(secrets).length, 3);
        });

        test('infisicalFetchSecrets should throw on non-OK secrets response', async () => {
            fetchMock.install();

            fetchMock.addResponse(
                'https://app.infisical.com/api/v1/auth/universal-auth/login',
                {
                    status: 200,
                    body: JSON.stringify({
                        accessToken: 'test-token',
                        expiresIn: 3600,
                        tokenType: 'Bearer',
                    }),
                },
            );

            fetchMock.addResponse(
                'https://app.infisical.com/api/v3/secrets/raw',
                { status: 403, body: 'Access denied' },
            );

            const fakeOutput = createFakeOutputChannel();
            await assert.rejects(
                () => infisicalFetchSecrets(
                    testCredentials,
                    'ws-id',
                    'dev',
                    'https://app.infisical.com',
                    '/',
                    fakeOutput,
                ),
                (err: unknown) => {
                    assert.ok(err instanceof Error);
                    assert.ok(
                        err.message.includes('403'),
                        `Error should include 403 status, got: "${err.message}"`,
                    );
                    return true;
                },
            );
        });
    });

    // ── Infisical Timeout Handling ────────────────────────────────────

    suite('Infisical timeout handling', () => {
        test('authenticate should throw timeout error for hung connection', async () => {
            fetchMock.install();

            fetchMock.addHandler(
                'https://app.infisical.com/api/v1/auth/universal-auth/login',
                () => new Promise<Response>(() => { /* never resolves */ }),
            );

            const origTimeout = AbortSignal.timeout;
            AbortSignal.timeout = ((): AbortSignal => origTimeout.call(AbortSignal, 100)) as typeof AbortSignal.timeout;

            const credentials: InfisicalCredentials = {
                clientId: 'test-client',
                clientSecret: 'test-secret',
                siteUrl: 'https://app.infisical.com',
            };

            try {
                const fakeOutput = createFakeOutputChannel();
                await assert.rejects(
                    () => authenticate(credentials, 'https://app.infisical.com', fakeOutput),
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

        test('infisicalFetchSecrets should throw timeout error for hung secrets endpoint', async () => {
            fetchMock.install();

            // Auth succeeds
            fetchMock.addResponse(
                'https://app.infisical.com/api/v1/auth/universal-auth/login',
                {
                    status: 200,
                    body: JSON.stringify({
                        accessToken: 'test-token',
                        expiresIn: 3600,
                        tokenType: 'Bearer',
                    }),
                },
            );

            // Secrets endpoint hangs
            fetchMock.addHandler(
                'https://app.infisical.com/api/v3/secrets/raw',
                () => new Promise<Response>(() => { /* never resolves */ }),
            );

            const origTimeout = AbortSignal.timeout;
            AbortSignal.timeout = ((): AbortSignal => origTimeout.call(AbortSignal, 100)) as typeof AbortSignal.timeout;

            const credentials: InfisicalCredentials = {
                clientId: 'test-client',
                clientSecret: 'test-secret',
                siteUrl: 'https://app.infisical.com',
            };

            try {
                const fakeOutput = createFakeOutputChannel();
                await assert.rejects(
                    () => infisicalFetchSecrets(
                        credentials,
                        'ws-id',
                        'dev',
                        'https://app.infisical.com',
                        '/',
                        fakeOutput,
                    ),
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
});
