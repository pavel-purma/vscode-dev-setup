import * as vscode from 'vscode';
import { SecretMap } from '../config/configTypes';

/** Options passed to every provider method. */
export interface ProviderContext {
    secrets: vscode.SecretStorage;
    outputChannel: vscode.OutputChannel;
}

/**
 * Common interface that every secrets provider must implement.
 * Each provider knows how to authenticate, fetch secrets,
 * and manage its stored credentials.
 */
export interface SecretsProvider {
    /** Human-readable name shown in UI messages (e.g. 'Doppler', 'Infisical'). */
    readonly displayName: string;

    /** Unique code name matching the config `provider` field (e.g. 'doppler', 'infisical'). */
    readonly id: string;

    /**
     * Fetch secrets for a given project and config/environment batch.
     * The provider is responsible for retrieving its own authentication
     * credentials from the provided context.
     *
     * @param project        - The project identifier (Doppler project slug, Infisical workspace ID)
     * @param batchString    - One of the strings from the `batches` array (Doppler config name, Infisical environment slug)
     * @param ctx            - Provider context with secret storage and output channel
     * @param providerParams - Optional provider-specific parameters from config
     * @returns A flat map of secret names to their string values
     */
    fetchSecrets(
        project: string,
        batchString: string,
        ctx: ProviderContext,
        providerParams?: Record<string, unknown>,
    ): Promise<SecretMap>;
}
