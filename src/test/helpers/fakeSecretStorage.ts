import * as vscode from 'vscode';

/**
 * Create a fake `vscode.SecretStorage` backed by an in-memory `Map`.
 * Useful for tests that need to supply or retrieve tokens without
 * touching the real VS Code secret store.
 *
 * @param initial - Optional record of pre-populated key/value pairs.
 * @returns A fake `SecretStorage` that satisfies the VS Code interface.
 */
export function createFakeSecretStorage(
    initial: Record<string, string> = {},
): vscode.SecretStorage {
    const store = new Map<string, string>(Object.entries(initial));

    return {
        get: async (key: string): Promise<string | undefined> => store.get(key),
        store: async (key: string, value: string): Promise<void> => {
            store.set(key, value);
        },
        delete: async (key: string): Promise<void> => {
            store.delete(key);
        },
        keys: async (): Promise<string[]> => Array.from(store.keys()),
        onDidChange: new vscode.EventEmitter<vscode.SecretStorageChangeEvent>().event,
    };
}
