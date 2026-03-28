import * as vscode from 'vscode';
import { parse as parseYaml } from 'yaml';
import { DevSetupConfig } from './configTypes';

/**
 * Validate that a parsed object conforms to the DevSetupConfig structure.
 * Throws descriptive errors on invalid input.
 */
function validateConfig(parsed: unknown, outputChannel: vscode.OutputChannel): DevSetupConfig {
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        throw new Error('Invalid dev-setup config: root must be an object');
    }

    const obj = parsed as Record<string, unknown>;
    const secrets = obj.secrets;

    if (secrets !== undefined) {
        const sec = secrets as Record<string, unknown>;

        if (typeof sec.provider !== 'string' || sec.provider.length === 0) {
            throw new Error("Invalid dev-setup config: 'secrets.provider' must be a non-empty string");
        }

        if (typeof sec.loader !== 'string' || sec.loader.length === 0) {
            throw new Error("Invalid dev-setup config: 'secrets.loader' must be a non-empty string");
        }

        if (!Array.isArray(sec.batches) || sec.batches.length === 0) {
            throw new Error("Invalid dev-setup config: 'secrets.batches' must be a non-empty array");
        }

        for (const batch of sec.batches) {
            if (typeof batch !== 'string' || batch.length === 0) {
                throw new Error("Invalid dev-setup config: each entry in 'secrets.batches' must be a non-empty string");
            }
        }

        if (sec.project !== undefined && (typeof sec.project !== 'string' || sec.project.length === 0)) {
            throw new Error("Invalid dev-setup config: 'secrets.project' must be a non-empty string if provided");
        }

        if (sec.filter !== undefined) {
            if (typeof sec.filter !== 'object' || sec.filter === null || Array.isArray(sec.filter)) {
                throw new Error("Invalid dev-setup config: 'secrets.filter' must be an object if provided");
            }

            const filterObj = sec.filter as Record<string, unknown>;
            const allowedFilterKeys = new Set(['include', 'exclude']);
            for (const key of Object.keys(filterObj)) {
                if (!allowedFilterKeys.has(key)) {
                    throw new Error(`Invalid dev-setup config: 'secrets.filter' contains unknown key "${key}"`);
                }
            }

            if (filterObj.include === undefined && filterObj.exclude === undefined) {
                throw new Error("Invalid dev-setup config: 'secrets.filter' must contain at least one of 'include' or 'exclude'");
            }

            for (const prop of ['include', 'exclude'] as const) {
                if (filterObj[prop] !== undefined) {
                    if (!Array.isArray(filterObj[prop]) || (filterObj[prop] as unknown[]).length === 0) {
                        throw new Error(`Invalid dev-setup config: 'secrets.filter.${prop}' must be a non-empty array if provided`);
                    }
                    for (const pattern of filterObj[prop] as unknown[]) {
                        if (typeof pattern !== 'string' || pattern.length === 0) {
                            throw new Error(`Invalid dev-setup config: each entry in 'secrets.filter.${prop}' must be a non-empty string`);
                        }
                        try {
                            new RegExp(pattern);
                        } catch {
                            throw new Error(`Invalid dev-setup config: 'secrets.filter.${prop}' contains an invalid regex: "${pattern}"`);
                        }
                    }
                }
            }
        }
    }

    const result = parsed as DevSetupConfig;

    outputChannel.appendLine('Dev Setup: Configuration parsed successfully');

    if (result.secrets) {
        const batchCount = result.secrets.batches?.length ?? 0;
        outputChannel.appendLine(
            `Dev Setup: Config contains secrets section with provider "${result.secrets.provider}", loader "${result.secrets.loader}", ${batchCount} batch(es)`,
        );
    }

    return result;
}

/**
 * Parse raw JSON file content into a DevSetupConfig.
 * Validates that the structure contains the expected fields.
 * Throws descriptive errors on invalid input.
 */
export function parseJsonConfig(rawContent: Uint8Array, outputChannel: vscode.OutputChannel): DevSetupConfig {
    outputChannel.appendLine('Dev Setup: Parsing JSON configuration file');

    const text = new TextDecoder('utf-8').decode(rawContent);

    let parsed: unknown;
    try {
        parsed = JSON.parse(text);
    } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        throw new Error(`Failed to parse dev-setup JSON config: ${msg}`);
    }

    return validateConfig(parsed, outputChannel);
}

/**
 * Parse raw YAML file content into a DevSetupConfig.
 * Validates that the structure contains the expected fields.
 * Throws descriptive errors on invalid input.
 */
export function parseYamlConfig(rawContent: Uint8Array, outputChannel: vscode.OutputChannel): DevSetupConfig {
    outputChannel.appendLine('Dev Setup: Parsing YAML configuration file');

    const text = new TextDecoder('utf-8').decode(rawContent);

    let parsed: unknown;
    try {
        parsed = parseYaml(text);
    } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        throw new Error(`Failed to parse dev-setup YAML config: ${msg}`);
    }

    return validateConfig(parsed, outputChannel);
}

/**
 * Parse raw JSON file content into a DevSetupConfig.
 * @deprecated Use {@link parseJsonConfig} instead.
 */
export const parseConfig = parseJsonConfig;
