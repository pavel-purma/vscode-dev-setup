import { DevSetupConfig } from './configTypes';

/**
 * Parse raw file content into a DevSetupConfig.
 * Validates that the JSON structure contains the expected fields.
 * Throws descriptive errors on invalid input.
 */
export function parseConfig(rawContent: Uint8Array): DevSetupConfig {
    const text = new TextDecoder('utf-8').decode(rawContent);

    let parsed: any;
    try {
        parsed = JSON.parse(text);
    } catch (e: any) {
        throw new Error(`Failed to parse dev-setup.json: ${e.message}`);
    }

    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        throw new Error('Invalid dev-setup.json: root must be a JSON object');
    }

    const secrets = parsed.secrets;

    if (secrets !== undefined) {
        if (typeof secrets.provider !== 'string' || secrets.provider.length === 0) {
            throw new Error("Invalid dev-setup.json: 'secrets.provider' must be a non-empty string");
        }

        if (typeof secrets.loader !== 'string' || secrets.loader.length === 0) {
            throw new Error("Invalid dev-setup.json: 'secrets.loader' must be a non-empty string");
        }

        if (!Array.isArray(secrets.batches) || secrets.batches.length === 0) {
            throw new Error("Invalid dev-setup.json: 'secrets.batches' must be a non-empty array");
        }

        for (const batch of secrets.batches) {
            if (typeof batch !== 'string' || batch.length === 0) {
                throw new Error("Invalid dev-setup.json: each entry in 'secrets.batches' must be a non-empty string");
            }
        }

        if (secrets.project !== undefined && (typeof secrets.project !== 'string' || secrets.project.length === 0)) {
            throw new Error("Invalid dev-setup.json: 'secrets.project' must be a non-empty string if provided");
        }
    }

    return parsed as DevSetupConfig;
}
