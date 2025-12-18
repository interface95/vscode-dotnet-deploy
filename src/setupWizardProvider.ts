
/**
 * 交叉编译环境安装向导
 */

import * as vscode from 'vscode';
import * as os from 'os';
import {
    detectToolchain,
    getToolchainSummary,
    installZig,
    installLld,
    installXwin,
    installLlvm,
} from './crossCompile/toolchain';
import { downloadWindowsSdk } from './crossCompile/xwinSetup';
import { ToolchainStatus } from './crossCompile/types';

export class SetupWizardProvider {
    public static readonly viewType = 'dotnetDeploy.setupWizard';
    private _panel?: vscode.WebviewPanel;
    private _outputChannel: vscode.OutputChannel;
    private _toolchainStatus?: ToolchainStatus;

    constructor(
        private readonly _extensionUri: vscode.Uri,
        outputChannel: vscode.OutputChannel
    ) {
        this._outputChannel = outputChannel;
    }

    public async open() {
        if (this._panel) {
            this._panel.reveal();
            return;
        }

        this._panel = vscode.window.createWebviewPanel(
            SetupWizardProvider.viewType,
            '交叉编译环境配置向导',
            vscode.ViewColumn.One,
            {
                enableScripts: true,
                localResourceRoots: [this._extensionUri],
                retainContextWhenHidden: true,
            }
        );

        this._panel.webview.html = this._getHtml();

        this._panel.webview.onDidReceiveMessage(async (message) => {
            switch (message.command) {
                case 'ready':
                case 'refresh':
                    await this._checkToolchain();
                    break;
                case 'installAll':
                    await this._installAllTools(message.target);
                    break;
                case 'installTool':
                    await this._installSingleTool(message.tool);
                    break;
                case 'openTerminal':
                    await this._openTerminalWithCommand(message.cmd);
                    break;
                case 'openUrl':
                    vscode.env.openExternal(vscode.Uri.parse(message.url));
                    break;
                case 'openDocs':
                    // 打开安装文档
                    const docsPath = vscode.Uri.joinPath(this._extensionUri, 'CROSS_COMPILE_SETUP.md');
                    vscode.commands.executeCommand('markdown.showPreview', docsPath);
                    break;
            }
        });

        this._panel.onDidDispose(() => {
            this._panel = undefined;
        });

        // 初始检测
        await this._checkToolchain();
    }

    private async _checkToolchain() {
        this._toolchainStatus = await detectToolchain();
        const summary = getToolchainSummary(this._toolchainStatus);

        this._postMessage({
            command: 'toolchainStatus',
            status: this._toolchainStatus,
            summary,
            platform: os.platform(),
            arch: os.arch(),
        });
    }

    private async _installAllTools(target: 'linux' | 'windows' | 'all') {
        this._outputChannel.clear();
        this._outputChannel.show(true);

        const tools: string[] = [];

        if (target === 'linux' || target === 'all') {
            if (!this._toolchainStatus?.zig.installed) {
                tools.push('zig');
            }
        }

        if (target === 'windows' || target === 'all') {
            if (!this._toolchainStatus?.lld.installed) {
                tools.push('lld');
            }
            if (!this._toolchainStatus?.xwin.installed) {
                tools.push('xwin');
            }
            if (!this._toolchainStatus?.windowsSdk.installed) {
                tools.push('windowsSdk');
            }
        }

        if (tools.length === 0) {
            vscode.window.showInformationMessage('所有工具已安装完成！');
            return;
        }

        this._postMessage({ command: 'installStart', tools });

        for (const tool of tools) {
            this._postMessage({ command: 'installProgress', tool, status: 'installing' });

            const result = await this._installSingleTool(tool, false);

            this._postMessage({
                command: 'installProgress',
                tool,
                status: result ? 'success' : 'failed',
            });

            if (!result) {
                break;
            }
        }

        await this._checkToolchain();
        this._postMessage({ command: 'installComplete' });
    }

    private async _installSingleTool(tool: string, refresh = true): Promise<boolean> {
        this._outputChannel.show(true);

        let result;

        switch (tool) {
            case 'zig':
                this._outputChannel.appendLine('[Setup] Installing Zig...');
                result = await installZig(this._outputChannel);
                break;
            case 'lld':
                this._outputChannel.appendLine('[Setup] Installing LLD...');
                result = await installLld(this._outputChannel);
                break;
            case 'xwin':
                this._outputChannel.appendLine('[Setup] Installing xwin...');
                result = await installXwin(this._outputChannel);
                break;
            case 'llvm':
                this._outputChannel.appendLine('[Setup] Installing LLVM...');
                result = await installLlvm(this._outputChannel);
                break;
            case 'windowsSdk':
                this._outputChannel.appendLine('[Setup] Downloading Windows SDK...');
                const sdkResult = await downloadWindowsSdk(this._outputChannel);
                result = { success: sdkResult.success, error: sdkResult.error, tool: 'windowsSdk' as const };
                break;
            default:
                vscode.window.showErrorMessage(`未知工具: ${tool}`);
                return false;
        }

        if (result.success) {
            this._outputChannel.appendLine(`[Setup] ✓ ${tool} installed successfully`);
            vscode.window.showInformationMessage(`✓ ${tool} 安装成功`);
            if (refresh) {
                await this._checkToolchain();
            }
            return true;
        } else {
            this._outputChannel.appendLine(`[Setup] ✗ Failed to install ${tool}: ${result.error}`);
            vscode.window.showErrorMessage(`安装 ${tool} 失败: ${result.error}`);
            return false;
        }
    }

    private async _openTerminalWithCommand(cmd: string) {
        const terminal = vscode.window.createTerminal('Cross-Compile Setup');
        terminal.show();
        terminal.sendText(cmd);
    }

    private _postMessage(message: any) {
        this._panel?.webview.postMessage(message);
    }

    private _getHtml(): string {
        return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>交叉编译环境配置向导</title>
<style>
* { margin: 0; padding: 0; box-sizing: border-box; }
body {
    font-family: var(--vscode-font-family);
    padding: 20px;
    color: var(--vscode-foreground);
    background: var(--vscode-editor-background);
    line-height: 1.6;
}
.container { max-width: 800px; margin: 0 auto; }
h1 {
    font-size: 24px;
    margin-bottom: 8px;
    display: flex;
    align-items: center;
    gap: 12px;
}
.subtitle {
    color: var(--vscode-descriptionForeground);
    margin-bottom: 24px;
}

.platform-info {
    background: var(--vscode-textBlockQuote-background);
    border-left: 3px solid var(--vscode-textLink-foreground);
    padding: 12px 16px;
    margin-bottom: 24px;
    border-radius: 0 4px 4px 0;
}

.section {
    background: var(--vscode-editor-background);
    border: 1px solid var(--vscode-panel-border);
    border-radius: 8px;
    padding: 20px;
    margin-bottom: 20px;
}
.section-title {
    font-size: 16px;
    font-weight: 600;
    margin-bottom: 16px;
    display: flex;
    align-items: center;
    gap: 8px;
}

/* Toolchain Status */
.tool-grid {
    display: grid;
    gap: 12px;
}
.tool-item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 12px 16px;
    background: var(--vscode-input-background);
    border: 1px solid var(--vscode-input-border);
    border-radius: 6px;
}
.tool-info {
    display: flex;
    align-items: center;
    gap: 12px;
}
.tool-icon {
    font-size: 20px;
    width: 32px;
    text-align: center;
}
.tool-icon.installed { color: var(--vscode-testing-iconPassed); }
.tool-icon.missing { color: var(--vscode-testing-iconFailed); }
.tool-icon.installing { color: var(--vscode-progressBar-background); }

.tool-name {
    font-weight: 600;
}
.tool-version {
    font-size: 12px;
    color: var(--vscode-descriptionForeground);
}
.tool-desc {
    font-size: 12px;
    color: var(--vscode-descriptionForeground);
    margin-top: 2px;
}

.tool-actions {
    display: flex;
    gap: 8px;
}

button {
    background: var(--vscode-button-background);
    color: var(--vscode-button-foreground);
    border: none;
    padding: 6px 14px;
    border-radius: 4px;
    cursor: pointer;
    font-size: 13px;
    display: flex;
    align-items: center;
    gap: 6px;
}
button:hover {
    background: var(--vscode-button-hoverBackground);
}
button.secondary {
    background: var(--vscode-button-secondaryBackground);
    color: var(--vscode-button-secondaryForeground);
}
button.secondary:hover {
    background: var(--vscode-button-secondaryHoverBackground);
}
button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
}

/* Quick Install Section */
.quick-install {
    display: flex;
    gap: 12px;
    margin-top: 16px;
}
.quick-install button {
    flex: 1;
    justify-content: center;
    padding: 12px;
    font-size: 14px;
}

/* Tutorial Section */
.tutorial-tabs {
    display: flex;
    border-bottom: 1px solid var(--vscode-panel-border);
    margin-bottom: 16px;
}
.tutorial-tab {
    padding: 8px 16px;
    cursor: pointer;
    border-bottom: 2px solid transparent;
    color: var(--vscode-descriptionForeground);
}
.tutorial-tab.active {
    color: var(--vscode-foreground);
    border-bottom-color: var(--vscode-textLink-foreground);
}
.tutorial-tab:hover:not(.active) {
    color: var(--vscode-foreground);
}

.tutorial-content {
    display: none;
}
.tutorial-content.active {
    display: block;
}

.code-block {
    background: var(--vscode-textCodeBlock-background);
    border: 1px solid var(--vscode-panel-border);
    border-radius: 4px;
    padding: 12px;
    font-family: var(--vscode-editor-font-family);
    font-size: 13px;
    margin: 8px 0;
    position: relative;
    overflow-x: auto;
}
.code-block .copy-btn {
    position: absolute;
    top: 8px;
    right: 8px;
    padding: 4px 8px;
    font-size: 11px;
}

.step {
    margin-bottom: 16px;
}
.step-title {
    font-weight: 600;
    margin-bottom: 8px;
    display: flex;
    align-items: center;
    gap: 8px;
}
.step-number {
    background: var(--vscode-badge-background);
    color: var(--vscode-badge-foreground);
    width: 24px;
    height: 24px;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 12px;
    font-weight: 600;
}

.link {
    color: var(--vscode-textLink-foreground);
    cursor: pointer;
    text-decoration: none;
}
.link:hover {
    text-decoration: underline;
}

.status-message {
    padding: 12px 16px;
    border-radius: 6px;
    margin-top: 16px;
    display: none;
}
.status-message.visible {
    display: block;
}
.status-message.success {
    background: var(--vscode-inputValidation-infoBackground);
    border: 1px solid var(--vscode-inputValidation-infoBorder);
}
.status-message.error {
    background: var(--vscode-inputValidation-errorBackground);
    border: 1px solid var(--vscode-inputValidation-errorBorder);
}

.spinner {
    display: inline-block;
    width: 16px;
    height: 16px;
    border: 2px solid var(--vscode-foreground);
    border-top-color: transparent;
    border-radius: 50%;
    animation: spin 1s linear infinite;
}
@keyframes spin {
    to { transform: rotate(360deg); }
}

.loading {
    text-align: center;
    padding: 40px;
    color: var(--vscode-descriptionForeground);
}
</style>
</head>
<body>
<div class="container">
    <h1>🔧 交叉编译环境配置向导</h1>
    <p class="subtitle">配置从 macOS 交叉编译到 Linux 和 Windows 所需的工具链</p>

    <div class="platform-info" id="platformInfo">
        <strong>当前平台:</strong> <span id="platformName">检测中...</span>
    </div>

    <!-- 工具状态 -->
    <div class="section">
        <div class="section-title">📦 工具链状态</div>
        <div class="tool-grid" id="toolGrid">
            <div class="loading">正在检测工具链状态...</div>
        </div>
        <div class="quick-install" id="quickInstall" style="display:none;">
            <button onclick="installAll('linux')" id="btnInstallLinux">
                🐧 一键安装 Linux 交叉编译工具
            </button>
            <button onclick="installAll('windows')" id="btnInstallWindows">
                🪟 一键安装 Windows 交叉编译工具
            </button>
        </div>
        <div class="status-message" id="statusMessage"></div>
    </div>

    <!-- 安装教程 -->
    <div class="section">
        <div class="section-title">📖 手动安装教程</div>
        <div class="tutorial-tabs">
            <div class="tutorial-tab active" onclick="switchTab('linux')">Linux 目标</div>
            <div class="tutorial-tab" onclick="switchTab('windows')">Windows 目标</div>
            <div class="tutorial-tab" onclick="switchTab('prereq')">前置依赖</div>
        </div>

        <div class="tutorial-content active" id="tab-linux">
            <p style="margin-bottom:16px;">要从 macOS 交叉编译到 Linux，需要安装 <strong>Zig</strong> 作为 C 编译器和链接器。</p>

            <div class="step">
                <div class="step-title"><span class="step-number">1</span> 安装 Zig</div>
                <p>使用 Homebrew 安装 Zig 编译器：</p>
                <div class="code-block">
                    brew install zig
                    <button class="copy-btn secondary" onclick="copyText('brew install zig')">复制</button>
                </div>
            </div>

            <div class="step">
                <div class="step-title"><span class="step-number">2</span> 验证安装</div>
                <p>运行以下命令确认安装成功：</p>
                <div class="code-block">
                    zig version
                    <button class="copy-btn secondary" onclick="copyText('zig version')">复制</button>
                </div>
            </div>

            <div class="step">
                <div class="step-title"><span class="step-number">3</span> (可选) 安装 LLVM objcopy</div>
                <p>用于符号剥离，减小可执行文件大小：</p>
                <div class="code-block">
                    brew install llvm
                    <button class="copy-btn secondary" onclick="copyText('brew install llvm')">复制</button>
                </div>
            </div>

            <p style="margin-top:16px;">
                <a class="link" onclick="openUrl('https://ziglang.org/')">📚 Zig 官方文档</a>
            </p>
        </div>

        <div class="tutorial-content" id="tab-windows">
            <p style="margin-bottom:16px;">要从 macOS 交叉编译到 Windows，需要安装 <strong>LLD</strong> 链接器、<strong>xwin</strong> 工具和 <strong>Windows SDK</strong>。</p>

            <div class="step">
                <div class="step-title"><span class="step-number">1</span> 安装 LLD 链接器</div>
                <p>LLD 是 LLVM 项目的链接器，支持 PE/COFF 格式：</p>
                <div class="code-block">
                    brew install lld
                    <button class="copy-btn secondary" onclick="copyText('brew install lld')">复制</button>
                </div>
            </div>

            <div class="step">
                <div class="step-title"><span class="step-number">2</span> 安装 xwin</div>
                <p>xwin 用于下载和管理 Windows SDK：</p>
                <div class="code-block">
                    cargo install --locked xwin
                    <button class="copy-btn secondary" onclick="copyText('cargo install --locked xwin')">复制</button>
                </div>
                <p style="font-size:12px; color:var(--vscode-descriptionForeground); margin-top:4px;">
                    需要先安装 Rust，参见"前置依赖"标签页
                </p>
            </div>

            <div class="step">
                <div class="step-title"><span class="step-number">3</span> 下载 Windows SDK</div>
                <p>使用 xwin 下载 Windows SDK 和 CRT 库（约 500MB）：</p>
                <div class="code-block">
                    xwin splat --output ~/.local/share/xwin-sdk
                    <button class="copy-btn secondary" onclick="copyText('xwin splat --output ~/.local/share/xwin-sdk')">复制</button>
                </div>
            </div>

            <div class="step">
                <div class="step-title"><span class="step-number">4</span> 配置 lld-link 路径</div>
                <p>确保 lld-link 在 PATH 中：</p>
                <div class="code-block">
                    # 添加到 ~/.zshrc 或 ~/.bashrc
export PATH="/opt/homebrew/opt/lld/bin:$PATH"  # Apple Silicon
# 或
export PATH="/usr/local/opt/lld/bin:$PATH"     # Intel Mac
                    <button class="copy-btn secondary" onclick="copyText('export PATH=\"/opt/homebrew/opt/lld/bin:$PATH\"')">复制</button>
                </div>
            </div>

            <p style="margin-top:16px;">
                <a class="link" onclick="openUrl('https://github.com/Jake-Shadle/xwin')">📚 xwin GitHub</a>
            </p>
        </div>

        <div class="tutorial-content" id="tab-prereq">
            <p style="margin-bottom:16px;">安装交叉编译工具前，需要先安装以下基础依赖。</p>

            <div class="step">
                <div class="step-title"><span class="step-number">1</span> 安装 Homebrew</div>
                <p>macOS 的包管理器，用于安装大部分工具：</p>
                <div class="code-block">
                    /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
                    <button class="copy-btn secondary" onclick="copyText('/bin/bash -c \"$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)\"')">复制</button>
                </div>
                <p style="font-size:12px; margin-top:8px;">
                    <a class="link" onclick="openUrl('https://brew.sh/')">brew.sh</a>
                </p>
            </div>

            <div class="step">
                <div class="step-title"><span class="step-number">2</span> 安装 Rust (用于 Windows 交叉编译)</div>
                <p>xwin 是用 Rust 编写的，需要先安装 Rust 工具链：</p>
                <div class="code-block">
                    curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
                    <button class="copy-btn secondary" onclick="copyText('curl --proto \\'=https\\' --tlsv1.2 -sSf https://sh.rustup.rs | sh')">复制</button>
                </div>
                <p style="font-size:12px; margin-top:8px;">
                    <a class="link" onclick="openUrl('https://rustup.rs/')">rustup.rs</a>
                </p>
            </div>

            <div class="step">
                <div class="step-title"><span class="step-number">3</span> 安装 .NET SDK</div>
                <p>如果尚未安装 .NET SDK：</p>
                <div class="code-block">
                    brew install dotnet-sdk
                    <button class="copy-btn secondary" onclick="copyText('brew install dotnet-sdk')">复制</button>
                </div>
            </div>
        </div>
    </div>

    <!-- 帮助信息 -->
    <div class="section">
        <div class="section-title">❓ 常见问题</div>
        <details style="margin-bottom:12px;">
            <summary style="cursor:pointer; font-weight:600;">什么是交叉编译？</summary>
            <p style="margin-top:8px; padding-left:16px;">
                交叉编译是指在一个平台（如 macOS）上编译生成另一个平台（如 Linux 或 Windows）的可执行文件。
                Native AOT 编译需要目标平台的 C 链接器，因此需要配置交叉编译工具链。
            </p>
        </details>
        <details style="margin-bottom:12px;">
            <summary style="cursor:pointer; font-weight:600;">为什么 Linux 目标使用 Zig？</summary>
            <p style="margin-top:8px; padding-left:16px;">
                Zig 内置了完整的交叉编译支持，包含 Linux 系统的 libc 和链接器，无需额外配置 sysroot。
                它可以作为 drop-in 替代 GCC/Clang 使用。
            </p>
        </details>
        <details style="margin-bottom:12px;">
            <summary style="cursor:pointer; font-weight:600;">Windows SDK 下载需要多大空间？</summary>
            <p style="margin-top:8px; padding-left:16px;">
                Windows SDK 和 CRT 库大约需要 500MB 磁盘空间。下载过程需要稳定的网络连接。
            </p>
        </details>
        <details>
            <summary style="cursor:pointer; font-weight:600;">安装失败怎么办？</summary>
            <p style="margin-top:8px; padding-left:16px;">
                1. 检查网络连接<br>
                2. 确保 Homebrew 已正确安装<br>
                3. 尝试手动运行安装命令查看详细错误<br>
                4. 查看输出面板中的错误日志
            </p>
        </details>
    </div>
</div>

<script>
const vscode = acquireVsCodeApi();

// 发送 ready 消息
vscode.postMessage({ command: 'ready' });

// 接收消息
window.addEventListener('message', e => {
    const msg = e.data;
    switch (msg.command) {
        case 'toolchainStatus':
            updateToolchainUI(msg.status, msg.summary, msg.platform, msg.arch);
            break;
        case 'installStart':
            showStatus('正在安装: ' + msg.tools.join(', ') + '...', 'info');
            disableButtons(true);
            break;
        case 'installProgress':
            updateToolStatus(msg.tool, msg.status);
            break;
        case 'installComplete':
            hideStatus();
            disableButtons(false);
            break;
    }
});

function updateToolchainUI(status, summary, platform, arch) {
    // 更新平台信息
    document.getElementById('platformName').textContent =
        platform + ' (' + arch + ')' + (platform === 'darwin' ? ' - macOS' : '');

    // 工具网格
    const grid = document.getElementById('toolGrid');
    let html = '';

    // Zig (Linux)
    html += createToolRow('zig', 'Zig',
        'Linux 交叉编译器/链接器',
        status.zig.installed,
        status.zig.version,
        status.zig.installing
    );

    // LLD (Windows)
    html += createToolRow('lld', 'LLD (lld-link)',
        'Windows PE/COFF 链接器',
        status.lld.installed,
        status.lld.version,
        status.lld.installing
    );

    // xwin (Windows)
    html += createToolRow('xwin', 'xwin',
        'Windows SDK 下载工具',
        status.xwin.installed,
        status.xwin.version,
        status.xwin.installing
    );

    // Windows SDK
    html += createToolRow('windowsSdk', 'Windows SDK',
        'Windows CRT 和系统库',
        status.windowsSdk.installed,
        status.windowsSdk.size || '',
        status.windowsSdk.installing
    );

    // LLVM objcopy (可选)
    html += createToolRow('llvm', 'LLVM objcopy',
        '(可选) 符号剥离工具',
        status.llvm.hasObjcopy,
        '',
        status.llvm.installing,
        true
    );

    grid.innerHTML = html;

    // 显示快速安装按钮
    document.getElementById('quickInstall').style.display = 'flex';

    // 更新按钮状态
    const btnLinux = document.getElementById('btnInstallLinux');
    const btnWindows = document.getElementById('btnInstallWindows');

    if (summary.linuxReady) {
        btnLinux.textContent = '✓ Linux 工具链已就绪';
        btnLinux.disabled = true;
    } else {
        btnLinux.textContent = '🐧 一键安装 Linux 交叉编译工具';
        btnLinux.disabled = false;
    }

    if (summary.windowsReady) {
        btnWindows.textContent = '✓ Windows 工具链已就绪';
        btnWindows.disabled = true;
    } else {
        btnWindows.textContent = '🪟 一键安装 Windows 交叉编译工具';
        btnWindows.disabled = false;
    }
}

function createToolRow(id, name, desc, installed, version, installing, optional = false) {
    let iconClass = installed ? 'installed' : 'missing';
    let icon = installed ? '✓' : (optional ? '○' : '✗');

    if (installing) {
        iconClass = 'installing';
        icon = '<span class="spinner"></span>';
    }

    return \`
        <div class="tool-item" id="tool-\${id}">
            <div class="tool-info">
                <div class="tool-icon \${iconClass}">\${icon}</div>
                <div>
                    <div class="tool-name">\${name}</div>
                    \${version ? '<div class="tool-version">' + version + '</div>' : ''}
                    <div class="tool-desc">\${desc}</div>
                </div>
            </div>
            <div class="tool-actions">
                \${!installed ? '<button onclick="installTool(\\'' + id + '\\')">安装</button>' : ''}
            </div>
        </div>
    \`;
}

function updateToolStatus(tool, status) {
    const el = document.getElementById('tool-' + tool);
    if (!el) return;

    const icon = el.querySelector('.tool-icon');
    if (status === 'installing') {
        icon.className = 'tool-icon installing';
        icon.innerHTML = '<span class="spinner"></span>';
    } else if (status === 'success') {
        icon.className = 'tool-icon installed';
        icon.textContent = '✓';
        // 隐藏安装按钮
        const btn = el.querySelector('button');
        if (btn) btn.style.display = 'none';
    } else if (status === 'failed') {
        icon.className = 'tool-icon missing';
        icon.textContent = '✗';
    }
}

function installAll(target) {
    vscode.postMessage({ command: 'installAll', target: target });
}

function installTool(tool) {
    vscode.postMessage({ command: 'installTool', tool: tool });
}

function switchTab(tabId) {
    // 更新标签页
    document.querySelectorAll('.tutorial-tab').forEach(tab => {
        tab.classList.remove('active');
    });
    event.target.classList.add('active');

    // 更新内容
    document.querySelectorAll('.tutorial-content').forEach(content => {
        content.classList.remove('active');
    });
    document.getElementById('tab-' + tabId).classList.add('active');
}

function copyText(text) {
    navigator.clipboard.writeText(text).then(() => {
        // 可以添加复制成功提示
    });
}

function openUrl(url) {
    vscode.postMessage({ command: 'openUrl', url: url });
}

function showStatus(message, type) {
    const el = document.getElementById('statusMessage');
    el.textContent = message;
    el.className = 'status-message visible ' + (type === 'error' ? 'error' : 'success');
}

function hideStatus() {
    document.getElementById('statusMessage').className = 'status-message';
}

function disableButtons(disabled) {
    document.querySelectorAll('button').forEach(btn => {
        btn.disabled = disabled;
    });
}
</script>
</body>
</html>`;
    }
}
