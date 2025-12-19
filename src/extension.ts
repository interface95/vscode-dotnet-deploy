import * as vscode from 'vscode';
import * as path from 'path';
import * as os from 'os';
import { SidebarProvider } from './sidebarProvider';
import { DashboardProvider } from './dashboardProvider';
import { SetupWizardProvider } from './setupWizardProvider';
import { MacOSPackageConfigProvider } from './macosPackageConfigProvider';

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

    // Register setup wizard provider
    const setupWizardProvider = new SetupWizardProvider(context.extensionUri, outputChannel);
    const setupWizardCommand = vscode.commands.registerCommand('dotnetDeploy.openSetupWizard', () => {
        setupWizardProvider.open();
    });

    // Register macOS package config command
    const macosPackageConfigCommand = vscode.commands.registerCommand('dotnetDeploy.openMacOSPackageConfig', () => {
        MacOSPackageConfigProvider.createOrShow(context.extensionUri);
    });

    // Register configure command
    const configureCommand = vscode.commands.registerCommand('dotnetDeploy.configure', async () => {
        await vscode.commands.executeCommand('workbench.action.openSettings', 'dotnetDeploy');
    });

    // Register refresh command (for sidebar)
    const refreshCommand = vscode.commands.registerCommand('dotnetDeploy.refresh', () => {
        vscode.window.showInformationMessage('Use the refresh button in sidebar');
    });

    // Register open docs command
    const openDocsCommand = vscode.commands.registerCommand('dotnetDeploy.openCrossCompileDocs', async () => {
        const docsPath = vscode.Uri.joinPath(context.extensionUri, 'CROSS_COMPILE_SETUP.md');
        try {
            await vscode.commands.executeCommand('markdown.showPreview', docsPath);
        } catch {
            // Fallback: open as text
            await vscode.window.showTextDocument(docsPath);
        }
    });

    context.subscriptions.push(
        dashboardCommand,
        setupWizardCommand,
        macosPackageConfigCommand,
        configureCommand,
        refreshCommand,
        openDocsCommand,
        outputChannel
    );
}

export function deactivate() {
    if (outputChannel) {
        outputChannel.dispose();
    }
}
