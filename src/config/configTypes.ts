/** Filter configuration for secret keys using regex patterns. */
export interface SecretFilter {
    /** Regex patterns — a secret key must match ALL patterns to be included. */
    include?: string[];
    /** Regex patterns — a secret key matching ANY pattern is excluded. */
    exclude?: string[];
}

export interface SecretsConfig {
    provider: string;
    /** Loader to use for writing secrets (e.g. 'dotenv'). Optional if `script` is defined. */
    loader?: string;
    /** Shell command to run in a VS Code terminal with secrets injected as env vars. */
    script?: string;
    batches: string[];
    project?: string;
    /** Optional filter object with include/exclude regex patterns for secret keys. */
    filter?: SecretFilter;
    /**
     * Provider-specific parameters. Each provider defines which keys it recognizes.
     * Unknown keys are ignored.
     *
     * Doppler: (none currently)
     * Infisical: { baseUrl?: string; secretPath?: string }
     */
    providerParams?: Record<string, unknown>;
}

export interface DevSetupConfig {
    secrets?: SecretsConfig;
}

export interface ConfigLocation {
    config: DevSetupConfig;
    directory: string;  // absolute path of the directory containing the config file
    filename: string;   // name of the config file that was found (e.g. 'dev-setup.yaml')
}

export type SecretMap = Record<string, string>;

/** A batch of secrets with its source identifier. */
export interface BatchedSecretEntry {
    /** The raw batch string from config (e.g. "dev" or "my-project:dev"). */
    batchName: string;
    /** The key-value pairs fetched for this batch. */
    secrets: SecretMap;
}
