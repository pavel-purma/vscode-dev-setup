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
     * Retrieve the stored authentication token/credential.
     * Returns `undefined` when no credential is stored.
     */
    getStoredToken(ctx: ProviderContext): Promise<string | undefined>;

    /**
     * Fetch secrets for a given project and config/environment batch.
     *
     * @param token      - The authentication token (already retrieved)
     * @param project    - The project identifier (Doppler project slug, Infisical workspace ID)
     * @param config     - The config/environment name (Doppler config name, Infisical environment slug)
     * @param ctx        - Provider context with output channel
     * @param providerParams - Optional provider-specific parameters from config
     * @returns A flat map of secret names to their string values
     */
    fetchSecrets(
        token: string,
        project: string,
        config: string,
        ctx: ProviderContext,
        providerParams?: Record<string, unknown>,
    ): Promise<SecretMap>;
}
