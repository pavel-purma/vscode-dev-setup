import { SecretsProvider, ProviderContext } from '../providers/providerTypes';
import { SecretMap } from '../config/configTypes';
import { getStoredToken, fetchSecrets } from './dopplerClient';

/**
 * Doppler provider adapter — wraps the existing dopplerClient
 * functions to conform to the SecretsProvider interface.
 */
export class DopplerProvider implements SecretsProvider {
    readonly displayName = 'Doppler';
    readonly id = 'doppler';

    /** Retrieve the stored Doppler token from SecretStorage. */
    async getStoredToken(ctx: ProviderContext): Promise<string | undefined> {
        return getStoredToken(ctx.secrets);
    }

    /**
     * Fetch secrets from Doppler for a given project and config.
     * Delegates to the existing dopplerClient fetchSecrets function.
     */
    async fetchSecrets(
        token: string,
        project: string,
        config: string,
        ctx: ProviderContext,
        _providerParams?: Record<string, unknown>,
    ): Promise<SecretMap> {
        return fetchSecrets(token, project, config, ctx.outputChannel);
    }
}
