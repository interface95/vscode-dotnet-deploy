/**
 * xwin Windows SDK 配置模块
 *
 * 用于配置 Windows 交叉编译所需的 SDK 和链接器参数
 */

import { exec, spawn } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as vscode from 'vscode';
import { getWindowsArch } from './types';
import { checkXwin, checkWindowsSdk, checkLld } from './toolchain';

const execAsync = promisify(exec);

/**
 * 默认 Windows SDK 缓存路径
 */
export function getDefaultXwinSdkPath(): string {
    return path.join(os.homedir(), '.local', 'share', 'xwin-sdk');
}

/**
 * 获取配置的 SDK 路径
 */
export function getXwinSdkPath(): string {
    const config = vscode.workspace.getConfiguration('dotnetDeploy');
    const customPath = config.get<string>('crossCompile.xwinSdkPath');

    if (customPath) {
        return expandPath(customPath);
    }

    return getDefaultXwinSdkPath();
}

/**
 * 下载 Windows SDK (使用 xwin)
 */
export async function downloadWindowsSdk(
    outputChannel: vscode.OutputChannel,
    progress?: vscode.Progress<{ message?: string; increment?: number }>
): Promise<{ success: boolean; error?: string; path?: string }> {
    const sdkPath = getXwinSdkPath();
    const splatPath = path.join(sdkPath, 'splat');

    // 检查是否已存在
    if (fs.existsSync(path.join(splatPath, 'crt'))) {
        outputChannel.appendLine('[CrossCompile] Windows SDK already exists');
        return { success: true, path: sdkPath };
    }

    // 检查 xwin 是否安装
    const xwinStatus = await checkXwin();
    if (!xwinStatus.installed) {
        return {
            success: false,
            error: 'xwin is not installed. Please install it first: cargo install --locked xwin',
        };
    }

    outputChannel.appendLine('[CrossCompile] Downloading Windows SDK...');
    outputChannel.appendLine('[CrossCompile] This may take 5-10 minutes, please wait...');

    if (progress) {
        progress.report({ message: 'Downloading Windows SDK...' });
    }

    // 创建目录
    fs.mkdirSync(sdkPath, { recursive: true });

    return new Promise((resolve) => {
        // 使用 xwin 下载 SDK
        const xwinPath = xwinStatus.path || 'xwin';
        const args = [
            '--accept-license',
            '--cache-dir', sdkPath,
            '--arch', 'x86_64,aarch64',
            '--sdk-version', '10.0.22621',
            'splat',
            '--preserve-ms-arch-notation',
            '--include-debug-symbols',
        ];

        outputChannel.appendLine(`[CrossCompile] Running: ${xwinPath} ${args.join(' ')}`);

        const proc = spawn(xwinPath, args, {
            cwd: sdkPath,
            shell: true,
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

        proc.on('close', (code) => {
            if (code === 0) {
                outputChannel.appendLine('[CrossCompile] ✓ Windows SDK downloaded successfully');
                resolve({ success: true, path: sdkPath });
            } else {
                outputChannel.appendLine(`[CrossCompile] ✗ Failed to download Windows SDK (exit code: ${code})`);
                resolve({
                    success: false,
                    error: stderr || `xwin exited with code ${code}`,
                });
            }
        });

        proc.on('error', (err) => {
            outputChannel.appendLine(`[CrossCompile] ✗ Error: ${err.message}`);
            resolve({
                success: false,
                error: err.message,
            });
        });
    });
}

/**
 * 获取 Windows 交叉编译所需的 MSBuild 参数
 */
export async function getWindowsCrossCompileArgs(runtime: string): Promise<{
    success: boolean;
    args: string[];
    env: Record<string, string>;
    error?: string;
}> {
    const sdkPath = getXwinSdkPath();
    const splatPath = path.join(sdkPath, 'splat');
    const arch = getWindowsArch(runtime);

    // 检查 SDK 是否存在
    const crtPath = path.join(splatPath, 'crt');
    const crtLibPath = path.join(splatPath, 'crt', 'lib', arch);
    const sdkUmPath = path.join(splatPath, 'sdk', 'lib', 'um', arch);
    const sdkUcrtPath = path.join(splatPath, 'sdk', 'lib', 'ucrt', arch);

    if (!fs.existsSync(crtPath)) {
        return {
            success: false,
            args: [],
            env: {},
            error: 'Windows SDK not found. Please download it first.',
        };
    }

    // 检查 lld-link 是否可用
    const lldStatus = await checkLld();
    if (!lldStatus.installed) {
        return {
            success: false,
            args: [],
            env: {},
            error: 'lld-link is not installed. Please install LLD: brew install lld',
        };
    }

    // 获取 lld-link 路径
    const lldPath = await getLldLinkPath();

    // 构建 MSBuild 参数
    const args: string[] = [
        '-p:DisableUnsupportedError=true',
        '-p:AcceptVSBuildToolsLicense=true',
        // 禁用 SourceLink 以避免 lld-link 路径解析问题
        '-p:EnableSourceLink=false',
        '-p:EnableSourceControlManagerQueries=false',
    ];

    // 设置 C++ 链接器
    if (lldPath) {
        args.push(`-p:CppLinker=${lldPath}`);
    } else {
        args.push('-p:CppLinker=lld-link');
    }

    // 构建链接器参数 - 使用 /LIBPATH 指定库搜索路径
    const libPaths = [
        crtLibPath,
        sdkUmPath,
        sdkUcrtPath,
    ].filter(p => fs.existsSync(p));

    // 通过 IlcAdditionalLinkArgs 传递链接器参数
    // 使用分号分隔多个参数，避免空格被 MSBuild 误解
    const linkerArgs = libPaths.map(p => `/LIBPATH:${p}`).join(';');
    args.push(`-p:IlcAdditionalLinkArgs="${linkerArgs}"`);

    // 构建 LIB 环境变量 - lld-link 需要这个来查找库
    const libEnvPaths = libPaths.join(path.delimiter);

    // 添加 lld-link 到 PATH
    const brewPrefix = process.arch === 'arm64' ? '/opt/homebrew' : '/usr/local';
    const lldBinPath = path.join(brewPrefix, 'opt', 'lld', 'bin');
    const pathEnv = fs.existsSync(lldBinPath)
        ? `${lldBinPath}:${process.env['PATH'] || ''}`
        : process.env['PATH'] || '';

    const env: Record<string, string> = {
        'LIB': libEnvPaths,
        'PATH': pathEnv,
    };

    return { success: true, args, env };
}

/**
 * 验证 Windows SDK 完整性
 */
export async function validateWindowsSdk(): Promise<{
    valid: boolean;
    issues: string[];
}> {
    const sdkPath = getXwinSdkPath();
    const splatPath = path.join(sdkPath, 'splat');
    const issues: string[] = [];

    // 检查 CRT
    const crtPath = path.join(splatPath, 'crt');
    if (!fs.existsSync(crtPath)) {
        issues.push('CRT directory not found');
    } else {
        const crtLibPath = path.join(crtPath, 'lib');
        if (!fs.existsSync(crtLibPath)) {
            issues.push('CRT lib directory not found');
        }
    }

    // 检查 SDK
    const sdkLibPath = path.join(splatPath, 'sdk');
    if (!fs.existsSync(sdkLibPath)) {
        issues.push('SDK directory not found');
    } else {
        // 检查架构支持
        for (const arch of ['x64', 'arm64']) {
            const archPath = path.join(splatPath, 'sdk', 'lib', 'ucrt', arch);
            if (!fs.existsSync(archPath)) {
                issues.push(`SDK ${arch} architecture not found`);
            }
        }
    }

    return {
        valid: issues.length === 0,
        issues,
    };
}

/**
 * 获取 lld-link 路径
 */
export async function getLldLinkPath(): Promise<string | null> {
    const lldStatus = await checkLld();

    if (lldStatus.installed && lldStatus.path) {
        return lldStatus.path;
    }

    // 尝试 Homebrew 路径
    const brewPrefix = process.arch === 'arm64' ? '/opt/homebrew' : '/usr/local';
    const lldPath = path.join(brewPrefix, 'opt', 'lld', 'bin', 'lld-link');

    if (fs.existsSync(lldPath)) {
        return lldPath;
    }

    return null;
}

/**
 * 获取 Windows 交叉编译环境变量
 */
export function getWindowsCrossCompileEnv(): Record<string, string> {
    const env: Record<string, string> = {};

    // 添加 lld-link 到 PATH
    const brewPrefix = process.arch === 'arm64' ? '/opt/homebrew' : '/usr/local';
    const lldBinPath = path.join(brewPrefix, 'opt', 'lld', 'bin');

    if (fs.existsSync(lldBinPath)) {
        env['PATH'] = `${lldBinPath}:${process.env['PATH'] || ''}`;
    }

    return env;
}

/**
 * 展开路径中的 ~
 */
function expandPath(filePath: string): string {
    if (filePath.startsWith('~')) {
        return path.join(os.homedir(), filePath.slice(1));
    }
    return filePath;
}

/**
 * 清理 Windows SDK 缓存
 */
export async function cleanWindowsSdkCache(
    outputChannel: vscode.OutputChannel
): Promise<{ success: boolean; error?: string }> {
    const sdkPath = getXwinSdkPath();

    try {
        if (fs.existsSync(sdkPath)) {
            outputChannel.appendLine(`[CrossCompile] Removing Windows SDK cache: ${sdkPath}`);
            fs.rmSync(sdkPath, { recursive: true, force: true });
            outputChannel.appendLine('[CrossCompile] ✓ Windows SDK cache removed');
        } else {
            outputChannel.appendLine('[CrossCompile] Windows SDK cache does not exist');
        }

        return { success: true };
    } catch (err: any) {
        outputChannel.appendLine(`[CrossCompile] ✗ Failed to remove cache: ${err.message}`);
        return { success: false, error: err.message };
    }
}
