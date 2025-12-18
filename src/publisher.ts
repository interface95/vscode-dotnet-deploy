import * as vscode from 'vscode';
import * as path from 'path';
import { spawn } from 'child_process';

export interface PublishOptions {
    projectPath: string;
    outputPath: string;
    selfContained: boolean;
    singleFile: boolean;
    debugSymbols?: boolean; // Deprecated, kept for compat if needed, but we prefer disableSymbols
    disableSymbols?: boolean;
    runtime: string;
    publishAot?: boolean;
    stripSymbols?: boolean;
    invariantGlobalization?: boolean;
    upxEnabled?: boolean;
    upxLevel?: string;
}

export interface PublishResult {
    success: boolean;
    outputPath: string;
    assemblyName: string;
    error?: string;
}

/**
 * Execute dotnet publish with the given options
 */
export async function publish(
    options: PublishOptions,
    outputChannel: vscode.OutputChannel
): Promise<PublishResult> {
    const projectDir = path.dirname(options.projectPath);
    const projectName = path.basename(options.projectPath, '.csproj');
    const publishDir = options.outputPath || path.join(projectDir, 'bin', 'publish');

    const args = [
        'publish',
        options.projectPath,
        '-c', 'Release',
        '-o', publishDir,
        '-r', options.runtime,
    ];

    if (options.selfContained) {
        args.push('--self-contained=true');
    }

    if (options.singleFile) {
        args.push('-p:PublishSingleFile=true');
    }

    if (options.disableSymbols) {
        args.push('-p:DebugType=none');
        args.push('-p:DebugSymbols=false');
    } else if (options.debugSymbols === false) {
        // Fallback for old calls if any
        args.push('-p:DebugType=none');
        args.push('-p:DebugSymbols=false');
    }

    if (options.publishAot) {
        args.push('-p:PublishAot=true');
        // AOT implies strip symbols and size optimization often, but we can be explicit
        args.push('-p:StripSymbols=true');
        args.push('-p:IlcOptimizationPreference=Size');
    } else if (options.stripSymbols) {
        args.push('-p:StripSymbols=true');
    }

    if (options.invariantGlobalization) {
        args.push('-p:InvariantGlobalization=true');
    }

    outputChannel.appendLine(`[Publisher] Running: dotnet ${args.join(' ')}`);
    outputChannel.appendLine('');

    return new Promise((resolve) => {
        const process = spawn('dotnet', args, {
            cwd: projectDir,
            shell: true
        });

        let stdout = '';
        let stderr = '';

        process.stdout.on('data', (data) => {
            const text = data.toString();
            stdout += text;
            outputChannel.append(text);
        });

        process.stderr.on('data', (data) => {
            const text = data.toString();
            stderr += text;
            outputChannel.append(text);
        });

        process.on('close', async (code) => {
            if (code === 0) {
                outputChannel.appendLine('');
                outputChannel.appendLine(`[Publisher] ✓ Published successfully to ${publishDir}`);

                // UPX Compression
                if (options.upxEnabled) {
                    await compressWithUpx(publishDir, projectName, options.upxLevel || '--best', outputChannel);
                }

                resolve({
                    success: true,
                    outputPath: publishDir,
                    assemblyName: projectName
                });
            } else {
                outputChannel.appendLine('');
                outputChannel.appendLine(`[Publisher] ✗ Publish failed with code ${code}`);
                resolve({
                    success: false,
                    outputPath: publishDir,
                    assemblyName: projectName,
                    error: stderr || stdout
                });
            }
        });

        process.on('error', (err) => {
            outputChannel.appendLine(`[Publisher] ✗ Error: ${err.message}`);
            resolve({
                success: false,
                outputPath: publishDir,
                assemblyName: projectName,
                error: err.message
            });
        });
    });
}

async function compressWithUpx(dir: string, projectName: string, level: string, outputChannel: vscode.OutputChannel) {
    const fs = require('fs');
    // Find executable file
    // In single-file mode, it's projectName (no ext on linux/mac, .exe on win)
    // We should try to find the binary.
    let files = fs.readdirSync(dir);
    let targetFile = files.find((f: string) => f === projectName || f === projectName + '.exe');

    if (!targetFile) {
        outputChannel.appendLine(`[UPX] ⚠️ Could not find executable for compression: ${projectName}`);
        return;
    }

    const targetPath = path.join(dir, targetFile);
    outputChannel.appendLine(`[UPX] Compressing ${targetFile} with level ${level}...`);

    return new Promise<void>((resolve) => {
        const args = [level, targetPath];
        const upx = spawn('upx', args, { cwd: dir, shell: true });

        upx.stdout.on('data', (d) => outputChannel.append(d.toString()));
        upx.stderr.on('data', (d) => outputChannel.append(d.toString()));

        upx.on('close', (code) => {
            if (code === 0) {
                outputChannel.appendLine(`[UPX] ✓ Compression successful`);
            } else {
                outputChannel.appendLine(`[UPX] ✗ Compression failed with code ${code}`);
            }
            resolve();
        });
        upx.on('error', (err) => {
            outputChannel.appendLine(`[UPX] ✗ Error: ${err.message}`);
            resolve();
        });
    });
}
