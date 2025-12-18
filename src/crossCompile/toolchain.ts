/**
 * 工具链检测与安装模块
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import * as vscode from 'vscode';
import { ToolchainStatus, ToolStatus, ToolInstallResult } from './types';

const execAsync = promisify(exec);

/**
 * 检测完整的工具链状态
 */
export async function detectToolchain(): Promise<ToolchainStatus> {
    const [zig, lld, xwin, llvm] = await Promise.all([
        checkZig(),
        checkLld(),
        checkXwin(),
        checkLlvm(),
    ]);

    const windowsSdk = await checkWindowsSdk();

    return {
        zig,
        lld,
        xwin,
        windowsSdk,
        llvm,
    };
}

/**
 * 检测 Zig 编译器
 */
export async function checkZig(): Promise<ToolStatus> {
    try {
        const { stdout } = await execAsync('which zig');
        const zigPath = stdout.trim();

        if (!zigPath) {
            return { installed: false };
        }

        const { stdout: versionOut } = await execAsync('zig version');
        return {
            installed: true,
            version: versionOut.trim(),
            path: zigPath,
        };
    } catch {
        return { installed: false };
    }
}

/**
 * 检测 lld-link 链接器
 */
export async function checkLld(): Promise<ToolStatus> {
    try {
        // 首先检查 lld-link 是否在 PATH 中
        const { stdout } = await execAsync('which lld-link');
        const lldPath = stdout.trim();

        if (lldPath) {
            const { stdout: versionOut } = await execAsync('lld-link --version');
            return {
                installed: true,
                version: versionOut.trim().split('\n')[0],
                path: lldPath,
            };
        }

        return { installed: false };
    } catch {
        // 尝试 Homebrew 安装的 lld 路径
        try {
            const brewPrefix = process.arch === 'arm64' ? '/opt/homebrew' : '/usr/local';
            const lldPath = path.join(brewPrefix, 'opt', 'lld', 'bin', 'lld-link');

            if (fs.existsSync(lldPath)) {
                const { stdout: versionOut } = await execAsync(`"${lldPath}" --version`);
                return {
                    installed: true,
                    version: versionOut.trim().split('\n')[0],
                    path: lldPath,
                };
            }
        } catch {
            // 忽略
        }

        return { installed: false };
    }
}

/**
 * 检测 xwin 工具
 */
export async function checkXwin(): Promise<ToolStatus> {
    try {
        const { stdout } = await execAsync('which xwin');
        const xwinPath = stdout.trim();

        if (!xwinPath) {
            return { installed: false };
        }

        const { stdout: versionOut } = await execAsync('xwin --version');
        return {
            installed: true,
            version: versionOut.trim(),
            path: xwinPath,
        };
    } catch {
        // 尝试 cargo 安装的路径
        try {
            const cargoPath = path.join(os.homedir(), '.cargo', 'bin', 'xwin');
            if (fs.existsSync(cargoPath)) {
                const { stdout: versionOut } = await execAsync(`"${cargoPath}" --version`);
                return {
                    installed: true,
                    version: versionOut.trim(),
                    path: cargoPath,
                };
            }
        } catch {
            // 忽略
        }

        return { installed: false };
    }
}

/**
 * 检测 LLVM (用于 objcopy)
 */
export async function checkLlvm(): Promise<{ installed: boolean; hasObjcopy: boolean; path?: string }> {
    try {
        // 检查 llvm-objcopy
        const { stdout } = await execAsync('which llvm-objcopy');
        const objcopyPath = stdout.trim();

        if (objcopyPath) {
            return {
                installed: true,
                hasObjcopy: true,
                path: path.dirname(objcopyPath),
            };
        }

        return { installed: false, hasObjcopy: false };
    } catch {
        // 尝试 Homebrew 路径
        try {
            const brewPrefix = process.arch === 'arm64' ? '/opt/homebrew' : '/usr/local';
            const llvmPath = path.join(brewPrefix, 'opt', 'llvm', 'bin');
            const objcopyPath = path.join(llvmPath, 'llvm-objcopy');

            if (fs.existsSync(objcopyPath)) {
                return {
                    installed: true,
                    hasObjcopy: true,
                    path: llvmPath,
                };
            }
        } catch {
            // 忽略
        }

        return { installed: false, hasObjcopy: false };
    }
}

/**
 * 检测 Windows SDK 缓存
 */
export async function checkWindowsSdk(): Promise<{ installed: boolean; path?: string; size?: string }> {
    const defaultPath = path.join(os.homedir(), '.local', 'share', 'xwin-sdk');
    const config = vscode.workspace.getConfiguration('dotnetDeploy');
    const customPath = config.get<string>('crossCompile.xwinSdkPath');

    const sdkPath = customPath ? expandPath(customPath) : defaultPath;
    const crtPath = path.join(sdkPath, 'splat', 'crt');

    if (fs.existsSync(crtPath)) {
        try {
            const { stdout } = await execAsync(`du -sh "${sdkPath}"`);
            const size = stdout.trim().split('\t')[0];
            return {
                installed: true,
                path: sdkPath,
                size,
            };
        } catch {
            return {
                installed: true,
                path: sdkPath,
            };
        }
    }

    return { installed: false };
}

/**
 * 安装 Zig (通过 Homebrew)
 */
export async function installZig(outputChannel: vscode.OutputChannel): Promise<ToolInstallResult> {
    try {
        outputChannel.appendLine('[CrossCompile] Installing Zig via Homebrew...');

        // 检查 Homebrew
        try {
            await execAsync('which brew');
        } catch {
            return {
                success: false,
                error: 'Homebrew is not installed. Please install Homebrew first: https://brew.sh',
                tool: 'zig',
            };
        }

        await execAsync('brew install zig');
        outputChannel.appendLine('[CrossCompile] ✓ Zig installed successfully');

        return { success: true, tool: 'zig' };
    } catch (err: any) {
        return {
            success: false,
            error: err.message,
            tool: 'zig',
        };
    }
}

/**
 * 安装 lld (通过 Homebrew)
 */
export async function installLld(outputChannel: vscode.OutputChannel): Promise<ToolInstallResult> {
    try {
        outputChannel.appendLine('[CrossCompile] Installing LLD via Homebrew...');

        // 检查 Homebrew
        try {
            await execAsync('which brew');
        } catch {
            return {
                success: false,
                error: 'Homebrew is not installed. Please install Homebrew first: https://brew.sh',
                tool: 'lld',
            };
        }

        await execAsync('brew install lld');
        outputChannel.appendLine('[CrossCompile] ✓ LLD installed successfully');

        // 添加到 PATH 提示
        const brewPrefix = process.arch === 'arm64' ? '/opt/homebrew' : '/usr/local';
        outputChannel.appendLine(`[CrossCompile] Add to PATH: export PATH="${brewPrefix}/opt/lld/bin:$PATH"`);

        return { success: true, tool: 'lld' };
    } catch (err: any) {
        return {
            success: false,
            error: err.message,
            tool: 'lld',
        };
    }
}

/**
 * 安装 xwin (通过 Cargo)
 */
export async function installXwin(outputChannel: vscode.OutputChannel): Promise<ToolInstallResult> {
    try {
        outputChannel.appendLine('[CrossCompile] Installing xwin via Cargo...');

        // 检查 Cargo
        try {
            await execAsync('which cargo');
        } catch {
            return {
                success: false,
                error: 'Rust/Cargo is not installed. Please install Rust first: https://rustup.rs',
                tool: 'xwin',
            };
        }

        await execAsync('cargo install --locked xwin');
        outputChannel.appendLine('[CrossCompile] ✓ xwin installed successfully');

        return { success: true, tool: 'xwin' };
    } catch (err: any) {
        return {
            success: false,
            error: err.message,
            tool: 'xwin',
        };
    }
}

/**
 * 安装 LLVM (通过 Homebrew)
 */
export async function installLlvm(outputChannel: vscode.OutputChannel): Promise<ToolInstallResult> {
    try {
        outputChannel.appendLine('[CrossCompile] Installing LLVM via Homebrew...');

        // 检查 Homebrew
        try {
            await execAsync('which brew');
        } catch {
            return {
                success: false,
                error: 'Homebrew is not installed. Please install Homebrew first: https://brew.sh',
                tool: 'llvm',
            };
        }

        await execAsync('brew install llvm');
        outputChannel.appendLine('[CrossCompile] ✓ LLVM installed successfully');

        // 创建 objcopy 符号链接
        const brewPrefix = process.arch === 'arm64' ? '/opt/homebrew' : '/usr/local';
        const localBin = path.join(os.homedir(), '.local', 'bin');

        try {
            fs.mkdirSync(localBin, { recursive: true });
            const objcopyLink = path.join(localBin, 'objcopy');
            const llvmObjcopy = path.join(brewPrefix, 'opt', 'llvm', 'bin', 'llvm-objcopy');

            if (!fs.existsSync(objcopyLink) && fs.existsSync(llvmObjcopy)) {
                fs.symlinkSync(llvmObjcopy, objcopyLink);
                outputChannel.appendLine(`[CrossCompile] Created symlink: ${objcopyLink} -> ${llvmObjcopy}`);
            }
        } catch {
            // 忽略符号链接错误
        }

        return { success: true, tool: 'llvm' };
    } catch (err: any) {
        return {
            success: false,
            error: err.message,
            tool: 'llvm',
        };
    }
}

/**
 * 获取所需工具列表
 */
export function getRequiredTools(runtime: string): ('zig' | 'lld' | 'xwin' | 'windowsSdk')[] {
    if (runtime.startsWith('linux-')) {
        return ['zig'];
    }
    if (runtime.startsWith('win-')) {
        return ['lld', 'xwin', 'windowsSdk'];
    }
    return [];
}

/**
 * 检查是否缺少所需工具
 */
export async function checkMissingTools(runtime: string): Promise<string[]> {
    const required = getRequiredTools(runtime);
    const status = await detectToolchain();
    const missing: string[] = [];

    for (const tool of required) {
        switch (tool) {
            case 'zig':
                if (!status.zig.installed) missing.push('zig');
                break;
            case 'lld':
                if (!status.lld.installed) missing.push('lld');
                break;
            case 'xwin':
                if (!status.xwin.installed) missing.push('xwin');
                break;
            case 'windowsSdk':
                if (!status.windowsSdk.installed) missing.push('Windows SDK');
                break;
        }
    }

    return missing;
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
 * 获取工具链状态摘要 (用于 UI 显示)
 */
export function getToolchainSummary(status: ToolchainStatus): {
    linuxReady: boolean;
    windowsReady: boolean;
    linuxMissing: string[];
    windowsMissing: string[];
} {
    const linuxMissing: string[] = [];
    const windowsMissing: string[] = [];

    // Linux 交叉编译需要 Zig
    if (!status.zig.installed) {
        linuxMissing.push('Zig');
    }

    // Windows 交叉编译需要 lld + xwin + SDK
    if (!status.lld.installed) {
        windowsMissing.push('LLD');
    }
    if (!status.xwin.installed) {
        windowsMissing.push('xwin');
    }
    if (!status.windowsSdk.installed) {
        windowsMissing.push('Windows SDK');
    }

    return {
        linuxReady: linuxMissing.length === 0,
        windowsReady: windowsMissing.length === 0,
        linuxMissing,
        windowsMissing,
    };
}
