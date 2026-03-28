export interface SecretsConfig {
    provider: string;
    loader: string;
    batches: string[];
    project?: string;
}

export interface DevSetupConfig {
    secrets?: SecretsConfig;
}

export interface ConfigLocation {
    config: DevSetupConfig;
    directory: string;  // absolute path of the directory containing the config file
}

export type SecretMap = Record<string, string>;
