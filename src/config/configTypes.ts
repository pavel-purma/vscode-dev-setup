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
    filename: string;   // name of the config file that was found (e.g. 'dev-setup.yaml')
}

export type SecretMap = Record<string, string>;
