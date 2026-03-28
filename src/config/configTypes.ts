/** Filter configuration for secret keys using regex patterns. */
export interface SecretFilter {
    /** Regex patterns — a secret key must match ALL patterns to be included. */
    include?: string[];
    /** Regex patterns — a secret key matching ANY pattern is excluded. */
    exclude?: string[];
}

export interface SecretsConfig {
    provider: string;
    loader: string;
    batches: string[];
    project?: string;
    /** Optional filter object with include/exclude regex patterns for secret keys. */
    filter?: SecretFilter;
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
