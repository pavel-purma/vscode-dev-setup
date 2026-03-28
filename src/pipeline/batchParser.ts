/** Separator character used to split project and config in batch entries. */
export const BATCH_SEPARATOR = ':';

/** Result of parsing a batch entry from the config */
export interface ParsedBatchEntry {
    project: string;
    config: string;
}

/**
 * Parse a batch entry string into project and config components.
 *
 * If the entry contains a `:`, the part before the first `:` is the Doppler project
 * and everything after is the config (batch) name.
 * If there is no `:`, the defaultProject is used and the entire entry is the config name.
 *
 * @param batchEntry - Raw batch string from config (e.g., 'dev' or 'my-project:dev')
 * @param defaultProject - Fallback project when no colon is present
 * @returns Parsed project and config pair
 */
export function parseBatchEntry(batchEntry: string, defaultProject: string): ParsedBatchEntry {
    const separatorIndex = batchEntry.indexOf(BATCH_SEPARATOR);
    if (separatorIndex === -1) {
        return { project: defaultProject, config: batchEntry };
    }
    return {
        project: batchEntry.substring(0, separatorIndex),
        config: batchEntry.substring(separatorIndex + 1),
    };
}
