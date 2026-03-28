import * as assert from 'assert';
import { parseBatchEntry } from '../../pipeline/batchParser';

suite('batchParser', () => {
    suite('parseBatchEntry', () => {
        test('no colon returns defaultProject and full string as config', () => {
            const result = parseBatchEntry('dev', 'my-app');
            assert.deepStrictEqual(result, { project: 'my-app', config: 'dev' });
        });

        test('single colon splits into project and config', () => {
            const result = parseBatchEntry('shared-lib:staging', 'my-app');
            assert.deepStrictEqual(result, { project: 'shared-lib', config: 'staging' });
        });

        test('multiple colons splits on first colon only', () => {
            const result = parseBatchEntry('org:team/env', 'my-app');
            assert.deepStrictEqual(result, { project: 'org', config: 'team/env' });
        });

        test('empty string returns defaultProject and empty config', () => {
            const result = parseBatchEntry('', 'fallback');
            assert.deepStrictEqual(result, { project: 'fallback', config: '' });
        });

        test('colon at start yields empty project', () => {
            const result = parseBatchEntry(':dev', 'my-app');
            assert.deepStrictEqual(result, { project: '', config: 'dev' });
        });

        test('colon at end yields empty config', () => {
            const result = parseBatchEntry('my-project:', 'my-app');
            assert.deepStrictEqual(result, { project: 'my-project', config: '' });
        });
    });
});
