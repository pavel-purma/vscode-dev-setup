import * as vscode from 'vscode';
import { SecretMap } from '../config/configTypes';

const DOPPLER_API_BASE = 'https://api.doppler.com/v3';
const SECRET_KEY = 'dev-setup.dopplerToken';
const FETCH_TIMEOUT_MS = 30_000;

export interface DopplerTokenInfo {
    name: string;
    slug: string;
    created_at: string;
    last_seen_at: string;
    expires_at: string | null;
    workplace: {
        name: string;
        slug: string;
    };
}

/**
 * Validate a Doppler token by calling GET /v3/me
 * Returns token info if valid, throws on failure.
 */
export async function validateToken(token: string): Promise<DopplerTokenInfo> {
    try {
        const response = await fetch(`${DOPPLER_API_BASE}/me`, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Accept': 'application/json',
            },
            signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        });

        if (!response.ok) {
            const body = await response.text();
            throw new Error(`Doppler API error (${response.status}): ${body}`);
        }

        const data = await response.json() as any;
        return data as DopplerTokenInfo;
    } catch (err) {
        // AbortSignal.timeout() throws TimeoutError; AbortError covers manual abort scenarios
        if (err instanceof DOMException && (err.name === 'TimeoutError' || err.name === 'AbortError')) {
            vscode.window.showErrorMessage('Dev Setup: Request timed out while validating Doppler token.');
            throw new Error('Request timed out while validating Doppler token.');
        }
        throw err;
    }
}

/**
 * Store Doppler token in VS Code SecretStorage.
 */
export async function storeToken(secrets: vscode.SecretStorage, token: string): Promise<void> {
    await secrets.store(SECRET_KEY, token);
}

/**
 * Retrieve Doppler token from VS Code SecretStorage.
 */
export async function getStoredToken(secrets: vscode.SecretStorage): Promise<string | undefined> {
    return secrets.get(SECRET_KEY);
}

/**
 * Delete Doppler token from VS Code SecretStorage.
 */
export async function deleteStoredToken(secrets: vscode.SecretStorage): Promise<void> {
    await secrets.delete(SECRET_KEY);
}

/**
 * Fetch all secrets for a given Doppler project and config (batch).
 * Returns a flat Record<string, string> mapping secret names to their computed values.
 */
export async function fetchSecrets(token: string, project: string, config: string): Promise<SecretMap> {
    const url = new URL(`${DOPPLER_API_BASE}/configs/config/secrets`);
    url.searchParams.set('project', project);
    url.searchParams.set('config', config);

    try {
        const response = await fetch(url.toString(), {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Accept': 'application/json',
            },
            signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        });

        if (!response.ok) {
            const body = await response.text();
            throw new Error(`Doppler API error (${response.status}) fetching secrets for project "${project}", config "${config}": ${body}`);
        }

        const data = await response.json() as any;

        if (!data.secrets || typeof data.secrets !== 'object') {
            throw new Error(`Doppler API returned unexpected response format for project "${project}", config "${config}"`);
        }

        const result: SecretMap = {};
        for (const [key, value] of Object.entries(data.secrets)) {
            const secret = value as { raw?: string; computed?: string };
            if (secret.computed !== undefined) {
                result[key] = secret.computed;
            }
        }

        return result;
    } catch (err) {
        // AbortSignal.timeout() throws TimeoutError; AbortError covers manual abort scenarios
        if (err instanceof DOMException && (err.name === 'TimeoutError' || err.name === 'AbortError')) {
            vscode.window.showErrorMessage(`Dev Setup: Request timed out fetching secrets for project "${project}", config "${config}".`);
            throw new Error(`Request timed out fetching secrets for project "${project}", config "${config}".`);
        }
        throw err;
    }
}
