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

    /**
     * Fetch secrets from Doppler for a given project and batch.
     * Retrieves the Doppler token internally from SecretStorage
     * and delegates to the dopplerClient fetchSecrets function.
     *
     * @param project        - The Doppler project slug
     * @param batchString    - The Doppler config name (e.g. 'dev', 'staging')
     * @param ctx            - Provider context with secret storage and output channel
     * @param _providerParams - Unused for Doppler
     */
    async fetchSecrets(
        project: string,
        batchString: string,
        ctx: ProviderContext,
        _providerParams?: Record<string, unknown>,
    ): Promise<SecretMap> {
        const token = await getStoredToken(ctx.secrets);
        if (!token) {
            throw new Error('Doppler token not configured. Use the "Login to Doppler" command first.');
        }
        return fetchSecrets(token, project, batchString, ctx.outputChannel);
    }
}
