import * as assert from 'assert';
import * as vscode from 'vscode';

suite('Extension Test Suite', () => {
    suiteSetup(async () => {
        // Wait for the extension to activate
        const ext = vscode.extensions.getExtension('undefined_publisher.dev-setup');
        if (ext && !ext.isActive) {
            await ext.activate();
        }
    });

    test('Extension should be present', () => {
        const ext = vscode.extensions.getExtension('undefined_publisher.dev-setup');
        assert.ok(ext, 'Extension should be installed');
    });

    test('Extension should activate', async () => {
        const ext = vscode.extensions.getExtension('undefined_publisher.dev-setup');
        assert.ok(ext);
        if (!ext.isActive) {
            await ext.activate();
        }
        assert.strictEqual(ext.isActive, true, 'Extension should be active');
    });

    test('Should register loginToDoppler command', async () => {
        const commands = await vscode.commands.getCommands(true);
        assert.ok(
            commands.includes('dev-setup.loginToDoppler'),
            'Command dev-setup.loginToDoppler should be registered'
        );
    });

    test('Should register enterDopplerToken command', async () => {
        const commands = await vscode.commands.getCommands(true);
        assert.ok(
            commands.includes('dev-setup.enterDopplerToken'),
            'Command dev-setup.enterDopplerToken should be registered'
        );
    });
});
