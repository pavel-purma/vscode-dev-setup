import * as vscode from 'vscode';
import { SecretMap } from '../config/configTypes';

const INFISICAL_DEFAULT_BASE_URL = 'https://app.infisical.com';
const SECRET_KEY = 'dev-setup.infisicalCredentials';
const FETCH_TIMEOUT_MS = 30_000;

/** Credentials required for Infisical Universal Auth, including the server URL. */
export interface InfisicalCredentials {
    clientId: string;
    clientSecret: string;
    siteUrl: string;
}

/** Response from the Infisical Universal Auth login endpoint. */
export interface InfisicalAccessToken {
    accessToken: string;
    expiresIn: number;
    tokenType: string;
}

/** Project metadata returned by the Infisical API. */
export interface InfisicalProject {
    id: string;
    name: string;
    slug: string;
}

/** Checks whether a string is a valid GUID (UUID v4 format). */
export function isGuid(value: string): boolean {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

/**
 * Parse stored credential JSON into an InfisicalCredentials object.
 * Throws if the JSON is malformed or missing required fields.
 */
export function parseCredentials(raw: string): InfisicalCredentials {
    let parsed: unknown;
    try {
        parsed = JSON.parse(raw);
    } catch {
        throw new Error('Infisical credentials are not valid JSON');
    }

    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        throw new Error('Infisical credentials must be a JSON object');
    }

    const obj = parsed as Record<string, unknown>;

    if (typeof obj.clientId !== 'string' || obj.clientId.length === 0) {
        throw new Error('Infisical credentials missing required field "clientId"');
    }
    if (typeof obj.clientSecret !== 'string' || obj.clientSecret.length === 0) {
        throw new Error('Infisical credentials missing required field "clientSecret"');
    }

    const siteUrl = typeof obj.siteUrl === 'string' && obj.siteUrl.length > 0
        ? obj.siteUrl
        : INFISICAL_DEFAULT_BASE_URL;

    return {
        clientId: obj.clientId,
        clientSecret: obj.clientSecret,
        siteUrl,
    };
}

/**
 * Store Infisical credentials in VS Code SecretStorage as JSON.
 */
export async function storeCredentials(
    secrets: vscode.SecretStorage,
    credentials: InfisicalCredentials,
): Promise<void> {
    const json = JSON.stringify({
        clientId: credentials.clientId,
        clientSecret: credentials.clientSecret,
        siteUrl: credentials.siteUrl,
    });
    await secrets.store(SECRET_KEY, json);
}

/**
 * Retrieve stored Infisical credentials from VS Code SecretStorage.
 * Returns the parsed credentials, or undefined if nothing is stored.
 */
export async function getStoredCredentials(
    secrets: vscode.SecretStorage,
): Promise<InfisicalCredentials | undefined> {
    const raw = await secrets.get(SECRET_KEY);
    if (!raw) {
        return undefined;
    }
    return parseCredentials(raw);
}

/**
 * Authenticate with Infisical Universal Auth and return an access token.
 *
 * @param credentials - The client ID and client secret
 * @param baseUrl - The Infisical API base URL
 * @param outputChannel - Output channel for logging
 * @returns The access token response
 */
export async function authenticate(
    credentials: InfisicalCredentials,
    baseUrl: string,
    outputChannel: vscode.OutputChannel,
): Promise<InfisicalAccessToken> {
    const normalizedBase = baseUrl.replace(/\/+$/, '');
    const loginUrl = `${normalizedBase}/api/v1/auth/universal-auth/login`;
    outputChannel.appendLine(`Dev Setup: Authenticating with Infisical at ${normalizedBase}...`);

    try {
        const response = await fetch(loginUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json',
            },
            body: JSON.stringify({
                clientId: credentials.clientId,
                clientSecret: credentials.clientSecret,
            }),
            signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        });

        if (!response.ok) {
            const body = await response.text();
            throw new Error(`Infisical auth error (${response.status}): ${body}`);
        }

        const data = await response.json() as Record<string, unknown>;

        if (typeof data.accessToken !== 'string') {
            throw new Error('Infisical auth response missing accessToken');
        }

        outputChannel.appendLine('Dev Setup: Infisical authentication successful');

        return {
            accessToken: data.accessToken as string,
            expiresIn: typeof data.expiresIn === 'number' ? data.expiresIn : 0,
            tokenType: typeof data.tokenType === 'string' ? data.tokenType : 'Bearer',
        };
    } catch (err) {
        if (err instanceof DOMException && (err.name === 'TimeoutError' || err.name === 'AbortError')) {
            vscode.window.showErrorMessage('Dev Setup: Request timed out while authenticating with Infisical.');
            throw new Error('Request timed out while authenticating with Infisical.');
        }
        throw err;
    }
}

/**
 * Fetch secrets from the Infisical API for a given project and environment.
 * Uses a pre-authenticated access token.
 *
 * @param accessToken - A valid Infisical access token
 * @param projectId - The Infisical project ID
 * @param environment - The environment slug (maps to config/batch)
 * @param baseUrl - The Infisical API base URL
 * @param secretPath - The folder path for secrets within the environment
 * @param outputChannel - Output channel for logging
 * @returns A flat map of secret names to their string values
 */
export async function fetchSecrets(
    accessToken: string,
    projectId: string,
    environment: string,
    baseUrl: string,
    secretPath: string,
    outputChannel: vscode.OutputChannel,
): Promise<SecretMap> {
    outputChannel.appendLine(
        `Dev Setup: Fetching secrets from Infisical — project: "${projectId}", environment: "${environment}", path: "${secretPath}"`,
    );

    const normalizedBase = baseUrl.replace(/\/+$/, '');
    const url = new URL(`${normalizedBase}/api/v3/secrets/raw`);
    url.searchParams.set('workspaceId', projectId);
    url.searchParams.set('environment', environment);
    url.searchParams.set('secretPath', secretPath);

    try {
        const response = await fetch(url.toString(), {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Accept': 'application/json',
            },
            signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        });

        if (!response.ok) {
            const body = await response.text();
            throw new Error(
                `Infisical API error (${response.status}) fetching secrets for project "${projectId}", environment "${environment}": ${body}`,
            );
        }

        const data = await response.json() as Record<string, unknown>;

        if (!Array.isArray(data.secrets)) {
            throw new Error(
                `Infisical API returned unexpected response format for project "${projectId}", environment "${environment}"`,
            );
        }

        const result: SecretMap = {};
        for (const entry of data.secrets as Record<string, unknown>[]) {
            const key = entry.secretKey ?? entry.key;
            const value = entry.secretValue ?? entry.value;
            if (typeof key === 'string' && typeof value === 'string') {
                result[key] = value;
            }
        }

        outputChannel.appendLine(
            `Dev Setup: Fetched ${Object.keys(result).length} secrets from Infisical for environment "${environment}"`,
        );
        return result;
    } catch (err) {
        if (err instanceof DOMException && (err.name === 'TimeoutError' || err.name === 'AbortError')) {
            outputChannel.appendLine('Dev Setup: [Error] Infisical API request timed out after 30s');
            vscode.window.showErrorMessage(
                `Dev Setup: Request timed out fetching secrets for project "${projectId}", environment "${environment}".`,
            );
            throw new Error(
                `Request timed out fetching secrets for project "${projectId}", environment "${environment}".`,
            );
        }
        throw err;
    }
}

/**
 * Fetches the list of projects from Infisical.
 *
 * @param accessToken - A valid Infisical access token
 * @param siteUrl - The Infisical API base URL
 * @returns An array of project objects
 */
export async function fetchProjects(
    accessToken: string,
    siteUrl: string,
): Promise<InfisicalProject[]> {
    const normalizedBase = siteUrl.replace(/\/+$/, '');
    const url = `${normalizedBase}/api/v1/projects`;

    const res = await fetch(url, {
        method: 'GET',
        headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Accept': 'application/json',
        },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });

    if (!res.ok) {
        const body = await res.text();
        throw new Error(`Infisical projects request failed (${res.status}): ${body}`);
    }

    const data: unknown = await res.json();
    if (
        !data ||
        typeof data !== 'object' ||
        !Array.isArray((data as Record<string, unknown>).projects)
    ) {
        throw new Error('Unexpected response format from Infisical projects endpoint');
    }

    return (data as { projects: InfisicalProject[] }).projects;
}

/**
 * Resolves a project identifier to an Infisical project ID.
 * If the value is already a GUID, it is returned as-is.
 * Otherwise, it is treated as a project slug and resolved via the API.
 *
 * @param accessToken - A valid Infisical access token
 * @param project - A project ID (GUID) or project slug
 * @param siteUrl - The Infisical API base URL
 * @param outputChannel - Output channel for logging
 * @returns The resolved project ID
 */
export async function resolveProjectId(
    accessToken: string,
    project: string,
    siteUrl: string,
    outputChannel: vscode.OutputChannel,
): Promise<string> {
    if (isGuid(project)) {
        return project;
    }

    outputChannel.appendLine(`Dev Setup: Resolving Infisical project slug "${project}"...`);

    const normalizedSiteUrl = siteUrl.replace(/\/+$/, '') || INFISICAL_DEFAULT_BASE_URL;
    const projects = await fetchProjects(accessToken, normalizedSiteUrl);
    const match = projects.find((p) => p.slug === project);

    if (!match) {
        const available = projects.map((p) => p.slug).join(', ');
        const errorMsg = `No Infisical project found with slug "${project}". Available slugs: ${available}`;
        outputChannel.appendLine(`Dev Setup: [Error] ${errorMsg}`);
        throw new Error(errorMsg);
    }

    outputChannel.appendLine(`Dev Setup: Resolved slug "${project}" to project ID "${match.id}"`);
    return match.id;
}
