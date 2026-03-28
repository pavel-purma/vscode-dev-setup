import * as vscode from 'vscode';
import { fetchSecretsFromConfig } from '../pipeline/secretsPipeline';

/**
 * Workspace-open event handler that triggers automatic secret fetching.
 * Delegates all pipeline logic to the secretsPipeline module.
 */
export function onWorkspaceOpen(
    context: vscode.ExtensionContext,
    outputChannel: vscode.OutputChannel,
): void {
    outputChannel.appendLine('Workspace opened – checking for dev-setup config…');
    fetchSecretsFromConfig(context, outputChannel, false);
}
