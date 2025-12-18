/**
 * Cross-Compile Module for .NET Native AOT
 *
 * 支持从 macOS 交叉编译到 Linux 和 Windows 平台
 *
 * Linux: 使用 Zig 作为 C 编译器和链接器
 * Windows: 使用 lld-link + xwin (Windows SDK)
 */

export * from './toolchain';
export * from './zigWrapper';
export {
    getDefaultXwinSdkPath,
    getXwinSdkPath,
    downloadWindowsSdk,
    getWindowsCrossCompileArgs,
    validateWindowsSdk,
    getLldLinkPath,
    getWindowsCrossCompileEnv,
    cleanWindowsSdkCache,
} from './xwinSetup';
export * from './types';
