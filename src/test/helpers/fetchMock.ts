/** Record of a single fetch call captured by the mock. */
export interface FetchCallRecord {
    url: string;
    method: string;
    headers: Record<string, string>;
}

/** Configured response that the mock returns for a matched route. */
export interface MockResponse {
    status: number;
    body: string;
    headers?: Record<string, string>;
}

let originalFetch: typeof globalThis.fetch | undefined;
let callLog: FetchCallRecord[] = [];
let routes: Map<string, MockResponse> = new Map();

/**
 * Install a mock replacement for `globalThis.fetch`.
 * Saves the original fetch and replaces it with one that records calls
 * and returns configured responses based on URL matching.
 */
export function install(): void {
    originalFetch = globalThis.fetch;
    callLog = [];
    routes = new Map();

    globalThis.fetch = (async (
        input: string | URL | Request,
        init?: RequestInit,
    ): Promise<Response> => {
        const url = typeof input === 'string'
            ? input
            : input instanceof URL
                ? input.toString()
                : (input as Request).url;

        const headers: Record<string, string> = {};
        if (init?.headers) {
            const h = init.headers as Record<string, string>;
            for (const [k, v] of Object.entries(h)) {
                headers[k] = v;
            }
        }

        callLog.push({ url, method: init?.method ?? 'GET', headers });

        // Match by checking if any route key matches the base URL (ignoring query param order)
        for (const [routeUrl, response] of routes) {
            const routeBase = routeUrl.split('?')[0];
            if (url === routeUrl || url.startsWith(routeBase)) {
                return new Response(response.body, {
                    status: response.status,
                    headers: response.headers ?? { 'Content-Type': 'application/json' },
                });
            }
        }

        // Fallback: unexpected call
        throw new Error(`FetchMock: unexpected fetch call to ${url}`);
    }) as typeof globalThis.fetch;
}

/**
 * Restore the original `globalThis.fetch` that was saved during `install()`.
 */
export function restore(): void {
    if (originalFetch) {
        globalThis.fetch = originalFetch;
        originalFetch = undefined;
    }
    callLog = [];
    routes = new Map();
}

/**
 * Add a response route. When a fetch URL matches the given URL (by base path),
 * the mock returns the configured response.
 *
 * @param url - The URL to match against (can include query params for exact match)
 * @param response - The mock response to return
 */
export function addResponse(url: string, response: MockResponse): void {
    routes.set(url, response);
}

/**
 * Get all recorded fetch calls for assertion.
 *
 * @returns An array of all fetch call records captured since `install()`.
 */
export function getCalls(): FetchCallRecord[] {
    return callLog;
}
