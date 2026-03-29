import { SecretsProvider, ProviderContext } from '../providers/providerTypes';
import { SecretMap } from '../config/configTypes';
import * as infisicalClient from './infisicalClient';

const DEFAULT_SECRET_PATH = '/';

/** Result of parsing an Infisical batch config string. */
interface InfisicalBatchConfig {
    environment: string;
    secretPath: string | undefined;
}

/**
 * Parse an Infisical batch string into an environment slug and
 * optional secret path.
 *
 * If the string contains a `/`, everything before the first `/` is the
 * environment slug and everything from the first `/` onwards (inclusive)
 * is the secret path.  When no `/` is present the entire string is the
 * environment and `secretPath` is `undefined`.
 *
 * @param batchString - The batch config portion (after `project:`) of a batch entry
 * @returns The parsed environment and optional secretPath
 *
 * @example
 * parseInfisicalBatchConfig('dev')            // { environment: 'dev', secretPath: undefined }
 * parseInfisicalBatchConfig('dev/backend')    // { environment: 'dev', secretPath: '/backend' }
 * parseInfisicalBatchConfig('prod/svc/api')   // { environment: 'prod', secretPath: '/svc/api' }
 * parseInfisicalBatchConfig('dev/')           // { environment: 'dev', secretPath: '/' }
 */
function parseInfisicalBatchConfig(batchString: string): InfisicalBatchConfig {
    const slashIndex = batchString.indexOf('/');
    if (slashIndex === -1) {
        return { environment: batchString, secretPath: undefined };
    }

    const environment = batchString.substring(0, slashIndex);
    const secretPath = batchString.substring(slashIndex); // includes the leading '/'
    return { environment, secretPath };
}

/**
 * Infisical provider adapter — implements the SecretsProvider interface
 * using the Infisical Universal Auth API client.
 */
export class InfisicalProvider implements SecretsProvider {
    readonly displayName = 'Infisical';
    readonly id = 'infisical';

    /**
     * Fetch secrets from Infisical for a given project and environment.
     * Retrieves stored credentials internally from SecretStorage, extracts
     * environment and optional secretPath from the batch string, and
     * delegates to the Infisical client.
     *
     * Authenticates once and reuses the access token for both project
     * slug resolution and secret fetching.
     *
     * If the batch string contains a `/`, the portion before the first
     * `/` is the environment slug and the remainder (including `/`) is
     * used as the secret path, overriding `providerParams.secretPath`.
     *
     * @param project        - The Infisical project name or project ID
     * @param batchString    - The environment slug, optionally followed by a secret path (e.g. 'dev', 'dev/backend')
     * @param ctx            - Provider context with secret storage and output channel
     * @param providerParams - Optional provider-specific parameters (e.g. secretPath)
     */
    async fetchSecrets(
        project: string,
        batchString: string,
        ctx: ProviderContext,
        providerParams?: Record<string, unknown>,
    ): Promise<SecretMap> {
        const creds = await infisicalClient.getStoredCredentials(ctx.secrets);
        if (!creds) {
            throw new Error('Infisical credentials not configured. Use the "Login to Infisical" command first.');
        }
        const credentials = infisicalClient.parseCredentials(JSON.stringify(creds));

        const parsed = parseInfisicalBatchConfig(batchString);

        // Per-batch path from config overrides providerParams.secretPath
        let secretPath: string;
        if (parsed.secretPath !== undefined) {
            secretPath = parsed.secretPath;
        } else {
            const rawSecretPath = providerParams?.secretPath;
            secretPath = typeof rawSecretPath === 'string' && rawSecretPath.length > 0
                ? rawSecretPath
                : DEFAULT_SECRET_PATH;
        }

        ctx.outputChannel.appendLine(
            `Dev Setup: Infisical batch config parsed — environment: "${parsed.environment}", secretPath: "${secretPath}"`,
        );

        // Authenticate once and reuse token for both operations
        const tokenResponse = await infisicalClient.authenticate(
            credentials,
            credentials.siteUrl,
            ctx.outputChannel,
        );

        const projectId = await infisicalClient.resolveProjectId(
            tokenResponse.accessToken,
            project,
            credentials.siteUrl,
            ctx.outputChannel,
        );

        return infisicalClient.fetchSecrets(
            tokenResponse.accessToken,
            projectId,
            parsed.environment,
            credentials.siteUrl,
            secretPath,
            ctx.outputChannel,
        );
    }
}
