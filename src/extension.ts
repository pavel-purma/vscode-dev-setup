import * as vscode from 'vscode';
import { registerLoginToDopplerCommand } from './commands/loginToDoppler';
import { registerEnterDopplerTokenCommand } from './commands/enterDopplerToken';
import { registerFetchSecretsCommand } from './commands/fetchSecrets';
import { onWorkspaceOpen } from './hooks/onWorkspaceOpen';

export function activate(context: vscode.ExtensionContext): void {
    console.log('Extension "dev-setup" is now active.');

    const outputChannel = vscode.window.createOutputChannel('Dev Setup');
    context.subscriptions.push(outputChannel);

    // Register commands
    registerLoginToDopplerCommand(context);
    registerEnterDopplerTokenCommand(context);
    registerFetchSecretsCommand(context, outputChannel);

    // Run workspace-open hook
    void onWorkspaceOpen(context, outputChannel);
}

export function deactivate(): void {
    // Cleanup if needed
}
