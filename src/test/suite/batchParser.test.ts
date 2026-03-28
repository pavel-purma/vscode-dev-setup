import * as assert from 'assert';
import { parseBatchEntry } from '../../pipeline/batchParser';

suite('batchParser', () => {
    suite('parseBatchEntry', () => {
        test('no slash returns defaultProject and full string as config', () => {
            const result = parseBatchEntry('dev', 'my-app');
            assert.deepStrictEqual(result, { project: 'my-app', config: 'dev' });
        });

        test('single slash splits into project and config', () => {
            const result = parseBatchEntry('shared-lib/staging', 'my-app');
            assert.deepStrictEqual(result, { project: 'shared-lib', config: 'staging' });
        });

        test('multiple slashes splits on first slash only', () => {
            const result = parseBatchEntry('org/team/env', 'my-app');
            assert.deepStrictEqual(result, { project: 'org', config: 'team/env' });
        });

        test('empty string returns defaultProject and empty config', () => {
            const result = parseBatchEntry('', 'fallback');
            assert.deepStrictEqual(result, { project: 'fallback', config: '' });
        });

        test('slash at start yields empty project', () => {
            const result = parseBatchEntry('/dev', 'my-app');
            assert.deepStrictEqual(result, { project: '', config: 'dev' });
        });

        test('slash at end yields empty config', () => {
            const result = parseBatchEntry('my-project/', 'my-app');
            assert.deepStrictEqual(result, { project: 'my-project', config: '' });
        });
    });
});
