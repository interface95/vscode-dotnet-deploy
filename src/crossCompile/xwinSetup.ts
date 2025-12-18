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
    /** 临时 props 文件路径，需要在构建后删除 */
    tempPropsFile?: string;
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

    // 设置 LIB 环境变量
    // 注意：lld-link 是 Windows 工具，期望使用分号 (;) 分隔路径，而不是 macOS 的冒号 (:)
    const libEnvPaths = libPaths.join(';');

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
 * 临时 props 文件管理
 */
export interface TempPropsFileResult {
    /** 创建的文件路径 */
    propsFilePath: string;
    /** 原始文件的备份路径（如果需要备份） */
    backupFilePath?: string;
    /** 是否需要恢复原始文件 */
    needsRestore: boolean;
}

/**
 * 创建临时的 Directory.Build.props 文件用于设置链接器参数
 * @param projectDir 项目目录
 * @param runtime 目标运行时
 * @returns 创建的文件信息，或 null 如果失败
 */
export function createTempLinkerPropsFile(projectDir: string, runtime: string): TempPropsFileResult | null {
    const sdkPath = getXwinSdkPath();
    const splatPath = path.join(sdkPath, 'splat');
    const arch = getWindowsArch(runtime);

    const crtLibPath = path.join(splatPath, 'crt', 'lib', arch);
    const sdkUmPath = path.join(splatPath, 'sdk', 'lib', 'um', arch);
    const sdkUcrtPath = path.join(splatPath, 'sdk', 'lib', 'ucrt', arch);

    const libPaths = [crtLibPath, sdkUmPath, sdkUcrtPath].filter(p => fs.existsSync(p));

    if (libPaths.length === 0) {
        return null;
    }

    // 构建 LinkerArg ItemGroup
    const linkerArgs = libPaths.map(p => `    <LinkerArg Include="/LIBPATH:${p}" />`).join('\n');

    // 必须使用 Directory.Build.props 这个名称，MSBuild 才会自动导入
    const propsFileName = 'Directory.Build.props';
    const propsFilePath = path.join(projectDir, propsFileName);
    const backupFilePath = path.join(projectDir, 'Directory.Build.props.dotnet-deploy-backup');

    let needsRestore = false;
    let originalContent: string | null = null;

    // 检查是否已存在 Directory.Build.props
    if (fs.existsSync(propsFilePath)) {
        // 备份现有文件
        try {
            originalContent = fs.readFileSync(propsFilePath, 'utf8');
            fs.writeFileSync(backupFilePath, originalContent, 'utf8');
            needsRestore = true;
        } catch {
            // 如果无法备份，不继续
            return null;
        }

        // 尝试在现有文件中添加我们的 ItemGroup
        // 查找 </Project> 结束标签并在之前插入
        const insertIndex = originalContent.lastIndexOf('</Project>');
        if (insertIndex !== -1) {
            const newContent = originalContent.slice(0, insertIndex) +
                `  <!-- Auto-generated by vscode-dotnet-deploy for cross-compilation -->
  <ItemGroup Condition="'$(PublishAot)' == 'true' and '$(RuntimeIdentifier)' == '${runtime}'">
${linkerArgs}
  </ItemGroup>
` + originalContent.slice(insertIndex);
            try {
                fs.writeFileSync(propsFilePath, newContent, 'utf8');
                return { propsFilePath, backupFilePath, needsRestore };
            } catch {
                // 恢复原始文件
                if (needsRestore) {
                    fs.writeFileSync(propsFilePath, originalContent, 'utf8');
                }
                return null;
            }
        }
    }

    // 创建新的 Directory.Build.props 文件
    const propsContent = `<?xml version="1.0" encoding="utf-8"?>
<!-- Auto-generated by vscode-dotnet-deploy for cross-compilation -->
<Project>
  <ItemGroup Condition="'$(PublishAot)' == 'true' and '$(RuntimeIdentifier)' == '${runtime}'">
${linkerArgs}
  </ItemGroup>
</Project>
`;

    try {
        fs.writeFileSync(propsFilePath, propsContent, 'utf8');
        return { propsFilePath, backupFilePath: needsRestore ? backupFilePath : undefined, needsRestore };
    } catch {
        return null;
    }
}

/**
 * 删除或恢复临时 props 文件
 */
export function removeTempLinkerPropsFile(result: TempPropsFileResult): void {
    try {
        if (result.needsRestore && result.backupFilePath && fs.existsSync(result.backupFilePath)) {
            // 恢复原始文件
            const originalContent = fs.readFileSync(result.backupFilePath, 'utf8');
            fs.writeFileSync(result.propsFilePath, originalContent, 'utf8');
            // 删除备份
            fs.unlinkSync(result.backupFilePath);
        } else if (fs.existsSync(result.propsFilePath)) {
            // 删除创建的文件
            fs.unlinkSync(result.propsFilePath);
        }
    } catch {
        // 忽略错误
    }
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
