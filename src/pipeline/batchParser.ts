/** Result of parsing a batch entry from the config */
export interface ParsedBatchEntry {
    project: string;
    config: string;
}

/**
 * Parse a batch entry string into project and config components.
 *
 * If the entry contains a `/`, the part before the first `/` is the Doppler project
 * and everything after is the config (batch) name.
 * If there is no `/`, the defaultProject is used and the entire entry is the config name.
 *
 * @param batchEntry - Raw batch string from config (e.g., 'dev' or 'my-project/dev')
 * @param defaultProject - Fallback project when no slash is present
 * @returns Parsed project and config pair
 */
export function parseBatchEntry(batchEntry: string, defaultProject: string): ParsedBatchEntry {
    const slashIndex = batchEntry.indexOf('/');
    if (slashIndex === -1) {
        return { project: defaultProject, config: batchEntry };
    }
    return {
        project: batchEntry.substring(0, slashIndex),
        config: batchEntry.substring(slashIndex + 1),
    };
}
