import * as vscode from 'vscode';
import { registerLoginToDopplerCommand } from './commands/loginToDoppler';
import { registerEnterDopplerTokenCommand } from './commands/enterDopplerToken';
import { registerFetchSecretsCommand } from './commands/fetchSecrets';
import { onWorkspaceOpen } from './hooks/onWorkspaceOpen';

export function activate(context: vscode.ExtensionContext): void {
    const outputChannel = vscode.window.createOutputChannel('Dev Setup');
    context.subscriptions.push(outputChannel);

    outputChannel.appendLine('Dev Setup: Extension activated');

    // Register commands
    registerLoginToDopplerCommand(context, outputChannel);
    outputChannel.appendLine('Dev Setup: Registered command "dev-setup.loginToDoppler"');

    registerEnterDopplerTokenCommand(context, outputChannel);
    outputChannel.appendLine('Dev Setup: Registered command "dev-setup.enterDopplerToken"');

    registerFetchSecretsCommand(context, outputChannel);
    outputChannel.appendLine('Dev Setup: Registered command "dev-setup.fetchSecrets"');

    // Run workspace-open hook
    void onWorkspaceOpen(context, outputChannel);
}

export function deactivate(): void {
    // Cleanup if needed
}
