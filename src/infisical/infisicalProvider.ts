import { SecretsProvider, ProviderContext } from '../providers/providerTypes';
import { SecretMap } from '../config/configTypes';
import * as infisicalClient from './infisicalClient';

const DEFAULT_SECRET_PATH = '/';

/**
 * Infisical provider adapter — implements the SecretsProvider interface
 * using the Infisical Universal Auth API client.
 */
export class InfisicalProvider implements SecretsProvider {
    readonly displayName = 'Infisical';
    readonly id = 'infisical';

    /** Retrieve stored Infisical credentials from SecretStorage. */
    async getStoredToken(ctx: ProviderContext): Promise<string | undefined> {
        const creds = await infisicalClient.getStoredCredentials(ctx.secrets);
        if (!creds) {
            return undefined;
        }
        // Return the raw JSON so the pipeline can pass it as `token`
        return JSON.stringify(creds);
    }

    /**
     * Fetch secrets from Infisical for a given workspace and environment.
     * Parses stored credentials (which include the siteUrl), extracts
     * secretPath from providerParams, and delegates to the Infisical client.
     */
    async fetchSecrets(
        token: string,
        project: string,
        config: string,
        ctx: ProviderContext,
        providerParams?: Record<string, unknown>,
    ): Promise<SecretMap> {
        const credentials = infisicalClient.parseCredentials(token);

        const rawSecretPath = providerParams?.secretPath;
        const secretPath = typeof rawSecretPath === 'string' && rawSecretPath.length > 0 ? rawSecretPath : DEFAULT_SECRET_PATH;

        return infisicalClient.fetchSecrets(
            credentials,
            project,       // workspaceId
            config,        // environment slug
            credentials.siteUrl,
            secretPath,
            ctx.outputChannel,
        );
    }
}
