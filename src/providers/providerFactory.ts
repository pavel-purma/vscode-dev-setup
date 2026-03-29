import { SecretsProvider } from './providerTypes';
import { DopplerProvider } from '../doppler/dopplerProvider';
import { InfisicalProvider } from '../infisical/infisicalProvider';

const PROVIDER_REGISTRY: Record<string, () => SecretsProvider> = {
    doppler: () => new DopplerProvider(),
    infisical: () => new InfisicalProvider(),
};

/**
 * Create a SecretsProvider instance for the given provider id.
 * Throws if the provider is unknown.
 *
 * @param providerId - The provider identifier from config (e.g. 'doppler', 'infisical')
 * @returns A new SecretsProvider instance
 */
export function createProvider(providerId: string): SecretsProvider {
    const factory = PROVIDER_REGISTRY[providerId];
    if (!factory) {
        throw new Error(
            `Unknown secrets provider: "${providerId}". ` +
            `Supported providers: ${Object.keys(PROVIDER_REGISTRY).join(', ')}`,
        );
    }
    return factory();
}
