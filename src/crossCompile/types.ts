/**
 * 交叉编译类型定义
 */

/**
 * 支持的目标运行时
 */
export type TargetRuntime =
    | 'linux-x64'
    | 'linux-arm64'
    | 'linux-musl-x64'
    | 'linux-musl-arm64'
    | 'win-x64'
    | 'win-x86'
    | 'win-arm64'
    | 'osx-x64'
    | 'osx-arm64';

/**
 * 工具状态
 */
export interface ToolStatus {
    installed: boolean;
    version?: string;
    path?: string;
}

/**
 * 工具链完整状态
 */
export interface ToolchainStatus {
    /** Zig 编译器 (用于 Linux 交叉编译) */
    zig: ToolStatus;
    /** LLD 链接器 (用于 Windows 交叉编译) */
    lld: ToolStatus;
    /** xwin 工具 (用于下载 Windows SDK) */
    xwin: ToolStatus;
    /** Windows SDK 缓存 */
    windowsSdk: {
        installed: boolean;
        path?: string;
        size?: string;
    };
    /** LLVM (用于 Linux 符号剥离) */
    llvm: {
        installed: boolean;
        hasObjcopy: boolean;
        path?: string;
    };
}

/**
 * 交叉编译配置
 */
export interface CrossCompileConfig {
    /** 目标运行时 */
    targetRuntime: string;
    /** 是否启用交叉编译 */
    enabled: boolean;
    /** Zig 路径 (留空自动检测) */
    zigPath?: string;
    /** lld-link 路径 (留空自动检测) */
    lldPath?: string;
    /** Windows SDK 缓存路径 */
    xwinSdkPath: string;
    /** 是否剥离符号 */
    stripSymbols: boolean;
    /** 是否自动安装缺失工具 */
    autoInstallTools: boolean;
}

/**
 * 交叉编译准备结果
 */
export interface CrossCompilePrepareResult {
    success: boolean;
    error?: string;
    /** Zig wrapper 脚本路径 (Linux 交叉编译) */
    zigWrapperPath?: string;
    /** Windows SDK 路径 */
    xwinSdkPath?: string;
    /** 额外的 MSBuild 参数 */
    msbuildArgs: string[];
}

/**
 * 工具安装结果
 */
export interface ToolInstallResult {
    success: boolean;
    error?: string;
    tool: 'zig' | 'lld' | 'xwin' | 'llvm' | 'windowsSdk';
}

/**
 * 判断是否需要交叉编译
 */
export function isCrossCompileNeeded(runtime: string): boolean {
    const platform = process.platform;

    if (platform === 'darwin') {
        // macOS 上编译非 macOS 目标需要交叉编译
        return !runtime.startsWith('osx-');
    }

    if (platform === 'linux') {
        // Linux 上编译非 Linux 目标需要交叉编译
        return !runtime.startsWith('linux-');
    }

    if (platform === 'win32') {
        // Windows 上编译非 Windows 目标需要交叉编译
        return !runtime.startsWith('win-');
    }

    return false;
}

/**
 * 获取交叉编译目标类型
 */
export function getCrossCompileTarget(runtime: string): 'linux' | 'windows' | 'macos' | 'native' {
    if (runtime.startsWith('linux-')) {
        return 'linux';
    }
    if (runtime.startsWith('win-')) {
        return 'windows';
    }
    if (runtime.startsWith('osx-')) {
        return 'macos';
    }
    return 'native';
}

/**
 * 获取 Zig 目标三元组
 */
export function getZigTarget(runtime: string): string {
    const targetMap: Record<string, string> = {
        'linux-x64': 'x86_64-linux-gnu',
        'linux-arm64': 'aarch64-linux-gnu',
        'linux-musl-x64': 'x86_64-linux-musl',
        'linux-musl-arm64': 'aarch64-linux-musl',
    };

    return targetMap[runtime] || 'x86_64-linux-gnu';
}

/**
 * 获取 Windows SDK 架构
 */
export function getWindowsArch(runtime: string): string {
    if (runtime.endsWith('-x64')) return 'x64';
    if (runtime.endsWith('-x86')) return 'x86';
    if (runtime.endsWith('-arm64')) return 'arm64';
    return 'x64';
}
