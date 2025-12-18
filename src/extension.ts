import * as vscode from 'vscode';
import * as path from 'path';
import * as os from 'os';
import { SidebarProvider } from './sidebarProvider';
import { DashboardProvider } from './dashboardProvider';

let outputChannel: vscode.OutputChannel;

export function activate(context: vscode.ExtensionContext) {
    outputChannel = vscode.window.createOutputChannel('Dotnet Deploy');

    // Register sidebar webview provider (unified UI)
    const sidebarProvider = new SidebarProvider(context.extensionUri, outputChannel);
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(SidebarProvider.viewType, sidebarProvider)
    );

    // Register dashboard provider
    const dashboardProvider = new DashboardProvider(context.extensionUri, outputChannel);
    const dashboardCommand = vscode.commands.registerCommand('dotnetDeploy.openDashboard', () => {
        dashboardProvider.show();
    });

    // Register configure command
    const configureCommand = vscode.commands.registerCommand('dotnetDeploy.configure', async () => {
        await vscode.commands.executeCommand('workbench.action.openSettings', 'dotnetDeploy');
    });

    // Register refresh command (for sidebar)
    const refreshCommand = vscode.commands.registerCommand('dotnetDeploy.refresh', () => {
        vscode.window.showInformationMessage('Use the refresh button in sidebar');
    });

    context.subscriptions.push(
        dashboardCommand,
        configureCommand,
        refreshCommand,
        outputChannel
    );
}

export function deactivate() {
    if (outputChannel) {
        outputChannel.dispose();
    }
}
