/**
 * macOS 打包模块
 *
 * 用于将 .NET 应用打包为 macOS 原生格式 (.app, .dmg, .pkg)
 * 仅在 macOS 平台上运行
 */

import { spawn, exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';

const execAsync = promisify(exec);

/**
 * macOS 打包选项
 */
export interface MacOSPackageOptions {
    /** 可执行文件路径 */
    executablePath: string;
    /** 输出目录 */
    outputDir: string;
    /** 应用名称 */
    appName: string;
    /** Bundle Identifier (如 com.example.myapp) */
    bundleId: string;
    /** 版本号 */
    version: string;
    /** 短版本号 */
    shortVersion?: string;
    /** Build 号 */
    buildNumber?: string;
    /** 应用图标路径 (.icns 或 .png) */
    iconPath?: string;
    /** 打包格式 */
    format: 'app' | 'dmg' | 'pkg';
    /** 最低支持的 macOS 版本 */
    minimumOSVersion?: string;
    /** 代码签名选项 */
    codeSign?: CodeSignOptions;
    /** 额外资源文件/目录 */
    resources?: string[];
}

/**
 * 代码签名选项
 */
export interface CodeSignOptions {
    /** 是否启用签名 */
    enabled: boolean;
    /** 开发者证书 ID */
    identity?: string;
    /** 是否进行 Apple 公证 */
    notarize?: boolean;
    /** Apple ID (用于公证) */
    appleId?: string;
    /** App-specific password */
    appPassword?: string;
    /** Team ID */
    teamId?: string;
}

/**
 * 打包结果
 */
export interface MacOSPackageResult {
    success: boolean;
    outputPath: string;
    error?: string;
}

/**
 * 检查是否在 macOS 平台上
 */
export function isMacOS(): boolean {
    return process.platform === 'darwin';
}

/**
 * 获取 macOS 打包配置
 */
export function getMacOSPackageConfig(): MacOSPackageOptions | null {
    if (!isMacOS()) {
        return null;
    }

    const config = vscode.workspace.getConfiguration('dotnetDeploy.macos');
    const enabled = config.get<boolean>('enabled', false);

    if (!enabled) {
        return null;
    }

    return {
        executablePath: '', // 会在发布时设置
        outputDir: '',      // 会在发布时设置
        appName: config.get<string>('appName', ''),
        bundleId: config.get<string>('bundleId', 'com.example.app'),
        version: config.get<string>('version', '1.0.0'),
        shortVersion: config.get<string>('shortVersion'),
        buildNumber: config.get<string>('buildNumber', '1'),
        iconPath: config.get<string>('iconPath'),
        format: config.get<'app' | 'dmg' | 'pkg'>('format', 'app'),
        minimumOSVersion: config.get<string>('minimumOSVersion', '10.15'),
        codeSign: {
            enabled: config.get<boolean>('codeSign.enabled', false),
            identity: config.get<string>('codeSign.identity'),
            notarize: config.get<boolean>('codeSign.notarize', false),
            appleId: config.get<string>('codeSign.appleId'),
            appPassword: config.get<string>('codeSign.appPassword'),
            teamId: config.get<string>('codeSign.teamId'),
        },
    };
}

/**
 * 生成 Info.plist 内容
 */
function generateInfoPlist(options: MacOSPackageOptions): string {
    const shortVersion = options.shortVersion || options.version;
    const buildNumber = options.buildNumber || '1';
    const iconName = options.iconPath ? path.basename(options.iconPath, path.extname(options.iconPath)) : 'AppIcon';

    return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>CFBundleName</key>
    <string>${options.appName}</string>
    <key>CFBundleDisplayName</key>
    <string>${options.appName}</string>
    <key>CFBundleIdentifier</key>
    <string>${options.bundleId}</string>
    <key>CFBundleVersion</key>
    <string>${buildNumber}</string>
    <key>CFBundleShortVersionString</key>
    <string>${shortVersion}</string>
    <key>CFBundleExecutable</key>
    <string>${options.appName}</string>
    <key>CFBundleIconFile</key>
    <string>${iconName}</string>
    <key>CFBundlePackageType</key>
    <string>APPL</string>
    <key>CFBundleSignature</key>
    <string>????</string>
    <key>LSMinimumSystemVersion</key>
    <string>${options.minimumOSVersion || '10.15'}</string>
    <key>NSHighResolutionCapable</key>
    <true/>
    <key>NSSupportsAutomaticGraphicsSwitching</key>
    <true/>
    <key>CFBundleInfoDictionaryVersion</key>
    <string>6.0</string>
</dict>
</plist>`;
}

/**
 * 将 PNG 转换为 ICNS 格式
 */
async function convertPngToIcns(
    pngPath: string,
    outputPath: string,
    outputChannel: vscode.OutputChannel
): Promise<boolean> {
    if (!fs.existsSync(pngPath)) {
        outputChannel.appendLine(`[macOS Packager] Icon file not found: ${pngPath}`);
        return false;
    }

    const ext = path.extname(pngPath).toLowerCase();

    // 如果已经是 icns，直接复制
    if (ext === '.icns') {
        fs.copyFileSync(pngPath, outputPath);
        return true;
    }

    if (ext !== '.png') {
        outputChannel.appendLine(`[macOS Packager] Unsupported icon format: ${ext}`);
        return false;
    }

    try {
        // 创建临时 iconset 目录
        const iconsetDir = path.join(path.dirname(outputPath), 'AppIcon.iconset');
        fs.mkdirSync(iconsetDir, { recursive: true });

        // 使用 sips 生成不同尺寸的图标
        const sizes = [16, 32, 64, 128, 256, 512, 1024];
        const sipsCommands: string[] = [];

        for (const size of sizes) {
            const filename = size === 1024 ? `icon_512x512@2x.png` : `icon_${size}x${size}.png`;
            sipsCommands.push(`sips -z ${size} ${size} "${pngPath}" --out "${path.join(iconsetDir, filename)}"`);

            // 也生成 @2x 版本 (除了最大的)
            if (size <= 512 && size * 2 <= 1024) {
                const filename2x = `icon_${size}x${size}@2x.png`;
                sipsCommands.push(`sips -z ${size * 2} ${size * 2} "${pngPath}" --out "${path.join(iconsetDir, filename2x)}"`);
            }
        }

        // 执行 sips 命令
        for (const cmd of sipsCommands) {
            try {
                await execAsync(cmd);
            } catch (e: any) {
                outputChannel.appendLine(`[macOS Packager] Warning: ${e.message}`);
            }
        }

        // 使用 iconutil 创建 icns
        await execAsync(`iconutil -c icns "${iconsetDir}" -o "${outputPath}"`);

        // 清理临时目录
        fs.rmSync(iconsetDir, { recursive: true, force: true });

        outputChannel.appendLine(`[macOS Packager] Created icon: ${outputPath}`);
        return true;
    } catch (err: any) {
        outputChannel.appendLine(`[macOS Packager] Failed to create icon: ${err.message}`);
        return false;
    }
}

/**
 * 创建 .app 包
 */
export async function createAppBundle(
    options: MacOSPackageOptions,
    outputChannel: vscode.OutputChannel
): Promise<MacOSPackageResult> {
    if (!isMacOS()) {
        return {
            success: false,
            outputPath: '',
            error: 'macOS packaging is only available on macOS',
        };
    }

    const appPath = path.join(options.outputDir, `${options.appName}.app`);
    const contentsPath = path.join(appPath, 'Contents');
    const macosPath = path.join(contentsPath, 'MacOS');
    const resourcesPath = path.join(contentsPath, 'Resources');

    try {
        outputChannel.appendLine(`[macOS Packager] Creating .app bundle: ${appPath}`);

        // 创建目录结构
        fs.mkdirSync(macosPath, { recursive: true });
        fs.mkdirSync(resourcesPath, { recursive: true });

        // 生成 Info.plist
        const infoPlistPath = path.join(contentsPath, 'Info.plist');
        fs.writeFileSync(infoPlistPath, generateInfoPlist(options), 'utf8');
        outputChannel.appendLine(`[macOS Packager] Created Info.plist`);

        // 生成 PkgInfo
        const pkgInfoPath = path.join(contentsPath, 'PkgInfo');
        fs.writeFileSync(pkgInfoPath, 'APPL????', 'utf8');

        // 复制可执行文件
        const executableDest = path.join(macosPath, options.appName);
        fs.copyFileSync(options.executablePath, executableDest);
        // 确保可执行权限
        fs.chmodSync(executableDest, 0o755);
        outputChannel.appendLine(`[macOS Packager] Copied executable`);

        // 复制依赖文件 (同目录下的其他文件)
        const sourceDir = path.dirname(options.executablePath);
        const sourceFiles = fs.readdirSync(sourceDir);
        for (const file of sourceFiles) {
            if (file === path.basename(options.executablePath)) {
                continue; // 跳过主可执行文件，已经复制过了
            }
            const sourcePath = path.join(sourceDir, file);
            const stat = fs.statSync(sourcePath);

            if (stat.isFile()) {
                // 复制到 MacOS 目录（与可执行文件同目录）
                fs.copyFileSync(sourcePath, path.join(macosPath, file));
            } else if (stat.isDirectory()) {
                // 复制目录到 Resources
                copyDirSync(sourcePath, path.join(resourcesPath, file));
            }
        }

        // 处理图标
        if (options.iconPath && fs.existsSync(options.iconPath)) {
            const iconDest = path.join(resourcesPath, 'AppIcon.icns');
            await convertPngToIcns(options.iconPath, iconDest, outputChannel);
        }

        // 复制额外资源
        if (options.resources) {
            for (const res of options.resources) {
                if (fs.existsSync(res)) {
                    const destName = path.basename(res);
                    const stat = fs.statSync(res);
                    if (stat.isDirectory()) {
                        copyDirSync(res, path.join(resourcesPath, destName));
                    } else {
                        fs.copyFileSync(res, path.join(resourcesPath, destName));
                    }
                }
            }
        }

        // 代码签名
        if (options.codeSign?.enabled && options.codeSign.identity) {
            outputChannel.appendLine(`[macOS Packager] Signing app with identity: ${options.codeSign.identity}`);
            try {
                await execAsync(`codesign --deep --force --sign "${options.codeSign.identity}" "${appPath}"`);
                outputChannel.appendLine(`[macOS Packager] ✓ App signed successfully`);
            } catch (err: any) {
                outputChannel.appendLine(`[macOS Packager] ⚠️ Code signing failed: ${err.message}`);
                // 不中断打包流程
            }
        }

        outputChannel.appendLine(`[macOS Packager] ✓ Created .app bundle: ${appPath}`);
        return { success: true, outputPath: appPath };
    } catch (err: any) {
        outputChannel.appendLine(`[macOS Packager] ✗ Failed to create .app bundle: ${err.message}`);
        return { success: false, outputPath: '', error: err.message };
    }
}

/**
 * 创建 DMG 镜像
 */
export async function createDmg(
    appPath: string,
    outputPath: string,
    volumeName: string,
    outputChannel: vscode.OutputChannel
): Promise<MacOSPackageResult> {
    if (!isMacOS()) {
        return {
            success: false,
            outputPath: '',
            error: 'DMG creation is only available on macOS',
        };
    }

    try {
        outputChannel.appendLine(`[macOS Packager] Creating DMG: ${outputPath}`);

        // 删除已存在的 DMG
        if (fs.existsSync(outputPath)) {
            fs.unlinkSync(outputPath);
        }

        // 使用 hdiutil 创建 DMG
        const cmd = `hdiutil create -volname "${volumeName}" -srcfolder "${appPath}" -ov -format UDZO "${outputPath}"`;
        await execAsync(cmd);

        outputChannel.appendLine(`[macOS Packager] ✓ Created DMG: ${outputPath}`);
        return { success: true, outputPath };
    } catch (err: any) {
        outputChannel.appendLine(`[macOS Packager] ✗ Failed to create DMG: ${err.message}`);
        return { success: false, outputPath: '', error: err.message };
    }
}

/**
 * 创建 PKG 安装包
 */
export async function createPkg(
    appPath: string,
    outputPath: string,
    identifier: string,
    version: string,
    outputChannel: vscode.OutputChannel
): Promise<MacOSPackageResult> {
    if (!isMacOS()) {
        return {
            success: false,
            outputPath: '',
            error: 'PKG creation is only available on macOS',
        };
    }

    try {
        outputChannel.appendLine(`[macOS Packager] Creating PKG: ${outputPath}`);

        // 删除已存在的 PKG
        if (fs.existsSync(outputPath)) {
            fs.unlinkSync(outputPath);
        }

        // 使用 pkgbuild 创建 PKG
        const cmd = `pkgbuild --root "${appPath}" --identifier "${identifier}" --version "${version}" --install-location "/Applications" "${outputPath}"`;
        await execAsync(cmd);

        outputChannel.appendLine(`[macOS Packager] ✓ Created PKG: ${outputPath}`);
        return { success: true, outputPath };
    } catch (err: any) {
        outputChannel.appendLine(`[macOS Packager] ✗ Failed to create PKG: ${err.message}`);
        return { success: false, outputPath: '', error: err.message };
    }
}

/**
 * 执行完整的 macOS 打包流程
 */
export async function packageForMacOS(
    options: MacOSPackageOptions,
    outputChannel: vscode.OutputChannel
): Promise<MacOSPackageResult> {
    // 1. 创建 .app 包
    const appResult = await createAppBundle(options, outputChannel);
    if (!appResult.success) {
        return appResult;
    }

    // 如果只需要 .app，直接返回
    if (options.format === 'app') {
        return appResult;
    }

    // 2. 根据格式创建 DMG 或 PKG
    if (options.format === 'dmg') {
        const dmgPath = path.join(options.outputDir, `${options.appName}.dmg`);
        return await createDmg(appResult.outputPath, dmgPath, options.appName, outputChannel);
    }

    if (options.format === 'pkg') {
        const pkgPath = path.join(options.outputDir, `${options.appName}.pkg`);
        return await createPkg(appResult.outputPath, pkgPath, options.bundleId, options.version, outputChannel);
    }

    return appResult;
}

/**
 * 递归复制目录
 */
function copyDirSync(src: string, dest: string): void {
    fs.mkdirSync(dest, { recursive: true });
    const entries = fs.readdirSync(src, { withFileTypes: true });

    for (const entry of entries) {
        const srcPath = path.join(src, entry.name);
        const destPath = path.join(dest, entry.name);

        if (entry.isDirectory()) {
            copyDirSync(srcPath, destPath);
        } else {
            fs.copyFileSync(srcPath, destPath);
        }
    }
}
