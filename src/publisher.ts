import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { spawn } from 'child_process';
import {
    isCrossCompileNeeded,
    getCrossCompileTarget,
} from './crossCompile/types';
import {
    detectToolchain,
    checkMissingTools,
} from './crossCompile/toolchain';
import {
    getLinuxCrossCompileArgs,
    getOrCreateZigWrapper,
} from './crossCompile/zigWrapper';
import {
    getWindowsCrossCompileArgs,
    getWindowsCrossCompileEnv,
} from './crossCompile/xwinSetup';
import {
    isMacOS,
    getMacOSPackageConfig,
    packageForMacOS,
    MacOSPackageOptions,
} from './crossCompile/macosPackager';

/** 发布阶段 */
export type PublishPhase = 'compile' | 'upx' | 'package';

/** 状态回调函数类型 */
export type StatusCallback = (phase: PublishPhase, message: string) => void;

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
    /** 是否启用交叉编译 (默认 true) */
    crossCompileEnabled?: boolean;
    /** 状态回调 */
    onStatus?: StatusCallback;
}

export interface PublishResult {
    success: boolean;
    outputPath: string;
    assemblyName: string;
    error?: string;
    /** 交叉编译警告信息 */
    crossCompileWarning?: string;
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

    // 检查是否需要交叉编译
    const needsCrossCompile = isCrossCompileNeeded(options.runtime);
    const crossCompileEnabled = options.crossCompileEnabled !== false;
    let crossCompileWarning: string | undefined;
    let extraEnv: Record<string, string> = {};

    if (needsCrossCompile && crossCompileEnabled && options.publishAot) {
        outputChannel.appendLine(`[Publisher] Cross-compilation detected: ${process.platform} → ${options.runtime}`);

        // 检查缺失的工具
        const missingTools = await checkMissingTools(options.runtime);
        if (missingTools.length > 0) {
            crossCompileWarning = `Missing tools for cross-compilation: ${missingTools.join(', ')}`;
            outputChannel.appendLine(`[Publisher] ⚠️ ${crossCompileWarning}`);
            outputChannel.appendLine(`[Publisher] Cross-compilation will be attempted but may fail.`);
        }

        // 获取交叉编译参数
        const crossCompileResult = await prepareCrossCompileArgs(options.runtime, options.stripSymbols || false, outputChannel, projectDir);

        if (crossCompileResult.success) {
            args.push(...crossCompileResult.args);
            if (crossCompileResult.env) {
                extraEnv = crossCompileResult.env;
            }
            outputChannel.appendLine(`[Publisher] Cross-compile args: ${crossCompileResult.args.join(' ')}`);
        } else if (crossCompileResult.error) {
            crossCompileWarning = crossCompileResult.error;
            outputChannel.appendLine(`[Publisher] ⚠️ Cross-compile setup failed: ${crossCompileResult.error}`);
        }
    }

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
        // 对于交叉编译，StripSymbols 可能已在交叉编译参数中处理
        if (!needsCrossCompile || !crossCompileEnabled) {
            args.push('-p:StripSymbols=true');
        }
        args.push('-p:IlcOptimizationPreference=Size');
    } else if (options.stripSymbols) {
        args.push('-p:StripSymbols=true');
    }

    if (options.invariantGlobalization) {
        args.push('-p:InvariantGlobalization=true');
    }

    outputChannel.appendLine(`[Publisher] Running: dotnet ${args.join(' ')}`);
    outputChannel.appendLine('');

    // 通知状态：编译中
    options.onStatus?.('compile', '正在编译...');

    return new Promise((resolve) => {
        // 合并环境变量
        const processEnv = { ...process.env, ...extraEnv };

        const proc = spawn('dotnet', args, {
            cwd: projectDir,
            shell: true,
            env: processEnv,
        });

        let stdout = '';
        let stderr = '';

        proc.stdout.on('data', (data) => {
            const text = data.toString();
            stdout += text;
            outputChannel.append(text);
        });

        proc.stderr.on('data', (data) => {
            const text = data.toString();
            stderr += text;
            outputChannel.append(text);
        });

        proc.on('close', async (code) => {
            if (code === 0) {
                outputChannel.appendLine('');
                outputChannel.appendLine(`[Publisher] ✓ Published successfully to ${publishDir}`);

                // UPX Compression (仅支持 Linux/Windows 目标)
                const isUPXSupported = options.runtime.startsWith('linux-') || options.runtime.startsWith('win-');
                if (options.upxEnabled && isUPXSupported) {
                    options.onStatus?.('upx', '正在压缩...');
                    await compressWithUpx(publishDir, projectName, options.upxLevel || '--best', outputChannel);
                } else if (options.upxEnabled && !isUPXSupported) {
                    outputChannel.appendLine(`[UPX] ⚠️ UPX 不支持 ${options.runtime} 目标，跳过压缩`);
                }

                // macOS 打包
                let macosPackagePath: string | undefined;
                if (isMacOS() && options.runtime.startsWith('osx-')) {
                    const macosConfig = getMacOSPackageConfig();
                    if (macosConfig) {
                        options.onStatus?.('package', '正在打包...');
                        outputChannel.appendLine('');
                        outputChannel.appendLine('[Publisher] Starting macOS packaging...');

                        // 查找可执行文件
                        const executablePath = findExecutable(publishDir, projectName);
                        if (executablePath) {
                            const packageOptions: MacOSPackageOptions = {
                                ...macosConfig,
                                executablePath,
                                outputDir: publishDir,
                                appName: macosConfig.appName || projectName,
                            };

                            const packageResult = await packageForMacOS(packageOptions, outputChannel);
                            if (packageResult.success) {
                                macosPackagePath = packageResult.outputPath;
                                outputChannel.appendLine(`[Publisher] ✓ macOS package created: ${macosPackagePath}`);
                            } else {
                                outputChannel.appendLine(`[Publisher] ⚠️ macOS packaging failed: ${packageResult.error}`);
                            }
                        } else {
                            outputChannel.appendLine(`[Publisher] ⚠️ Could not find executable for macOS packaging`);
                        }
                    }
                }

                resolve({
                    success: true,
                    outputPath: macosPackagePath || publishDir,
                    assemblyName: projectName,
                    crossCompileWarning,
                });
            } else {
                outputChannel.appendLine('');
                outputChannel.appendLine(`[Publisher] ✗ Publish failed with code ${code}`);
                resolve({
                    success: false,
                    outputPath: publishDir,
                    assemblyName: projectName,
                    error: stderr || stdout,
                    crossCompileWarning,
                });
            }
        });

        proc.on('error', (err) => {
            outputChannel.appendLine(`[Publisher] ✗ Error: ${err.message}`);
            resolve({
                success: false,
                outputPath: publishDir,
                assemblyName: projectName,
                error: err.message,
                crossCompileWarning,
            });
        });
    });
}

/**
 * 准备交叉编译参数
 */
async function prepareCrossCompileArgs(
    runtime: string,
    stripSymbols: boolean,
    outputChannel: vscode.OutputChannel,
    projectDir: string
): Promise<{ success: boolean; args: string[]; env?: Record<string, string>; error?: string }> {
    const target = getCrossCompileTarget(runtime);

    if (target === 'linux') {
        // Linux 交叉编译使用 Zig
        outputChannel.appendLine('[Publisher] Using Zig for Linux cross-compilation');

        try {
            const args = getLinuxCrossCompileArgs(runtime, stripSymbols);
            return { success: true, args };
        } catch (err: any) {
            return { success: false, args: [], error: err.message };
        }
    }

    if (target === 'windows') {
        // Windows 交叉编译使用 lld-link + xwin
        outputChannel.appendLine('[Publisher] Using lld-link + xwin for Windows cross-compilation');

        const result = await getWindowsCrossCompileArgs(runtime);
        if (result.success) {
            // 合并环境变量
            const baseEnv = getWindowsCrossCompileEnv();
            const combinedEnv = { ...baseEnv, ...result.env };

            outputChannel.appendLine(`[Publisher] LIB env: ${combinedEnv['LIB'] || 'not set'}`);

            // 先尝试只使用环境变量，不创建临时文件
            // lld-link 应该能读取 LIB 环境变量（使用分号分隔）
            // 如果失败，用户可以手动创建 Directory.Build.props 文件

            return { success: true, args: result.args, env: combinedEnv };
        } else {
            return { success: false, args: [], error: result.error };
        }
    }

    // 其他目标不需要特殊处理
    return { success: true, args: [] };
}

/**
 * 查找可执行文件
 */
function findExecutable(dir: string, projectName: string): string | undefined {
    const candidates = [
        projectName,           // macOS/Linux
        `${projectName}.exe`,  // Windows
    ];

    for (const candidate of candidates) {
        const filePath = path.join(dir, candidate);
        if (fs.existsSync(filePath)) {
            return filePath;
        }
    }

    return undefined;
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
