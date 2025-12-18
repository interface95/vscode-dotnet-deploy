import * as vscode from 'vscode';
import * as path from 'path';
import * as cp from 'child_process';
import * as os from 'os';
import * as fs from 'fs';

export class DashboardProvider {
    public static readonly viewType = 'dotnetDeploy.dashboard';
    private _panel: vscode.WebviewPanel | undefined;

    constructor(
        private readonly _extensionUri: vscode.Uri,
        private readonly _outputChannel: vscode.OutputChannel
    ) { }

    public show() {
        if (this._panel) {
            this._panel.reveal();
            return;
        }

        this._panel = vscode.window.createWebviewPanel(
            DashboardProvider.viewType,
            'Dotnet Deploy Dashboard',
            vscode.ViewColumn.One,
            {
                enableScripts: true,
                localResourceRoots: [this._extensionUri]
            }
        );

        this._panel.webview.html = this._getHtml();

        this._panel.onDidDispose(() => {
            this._panel = undefined;
        });

        this._panel.webview.onDidReceiveMessage(async message => {
            switch (message.command) {
                case 'ready':
                    await this._refreshData();
                    break;
                case 'saveConfig':
                    await this._saveConfig(message.config);
                    break;
                case 'checkEnv':
                    await this._checkEnvironment();
                    break;
            }
        });
    }

    private async _refreshData() {
        const config = vscode.workspace.getConfiguration('dotnetDeploy');
        const envInfo = await this._getEnvironmentInfo();

        this._postMessage({
            command: 'data',
            config: {
                upxEnabled: config.get('upx.enabled', false),
                upxLevel: config.get('upx.level', '--best'),
                afterUploadCommand: config.get('deploy.afterUploadCommand', 'sudo {remote_path}/{app_name} start'),
                telegramEnabled: config.get('telegram.enabled', false),
                telegramUpload: config.get('telegram.upload', false),
                telegramBotToken: config.get('telegram.botToken', ''),
                telegramChatId: config.get('telegram.chatId', '')
            },
            env: envInfo
        });
    }

    private async _saveConfig(newConfig: any) {
        const config = vscode.workspace.getConfiguration('dotnetDeploy');
        await config.update('upx.enabled', newConfig.upxEnabled, vscode.ConfigurationTarget.Global);
        await config.update('upx.level', newConfig.upxLevel, vscode.ConfigurationTarget.Global);
        await config.update('deploy.afterUploadCommand', newConfig.afterUploadCommand, vscode.ConfigurationTarget.Global);
        await config.update('telegram.enabled', newConfig.telegramEnabled, vscode.ConfigurationTarget.Global);
        await config.update('telegram.upload', newConfig.telegramUpload, vscode.ConfigurationTarget.Global);
        await config.update('telegram.botToken', newConfig.telegramBotToken, vscode.ConfigurationTarget.Global);
        await config.update('telegram.chatId', newConfig.telegramChatId, vscode.ConfigurationTarget.Global);
        vscode.window.showInformationMessage('配置已保存');
        await this._refreshData();
    }

    private async _getEnvironmentInfo() {
        const info: any = {
            upxInstalled: false,
            upxVersion: '',
            crossBuildInstalled: false
        };

        // Check UPX
        try {
            const upxVer = cp.execSync('upx --version').toString().split('\n')[0];
            info.upxInstalled = true;
            info.upxVersion = upxVer;
        } catch {
            info.upxInstalled = false;
        }

        // Check Cross Build (PublishAotCross.macOS)
        // Check global nuget cache for 'publishaotcross.macos' package
        const nugetGlobalPath = path.join(os.homedir(), '.nuget', 'packages', 'publishaotcross.macos');
        info.crossBuildInstalled = fs.existsSync(nugetGlobalPath);

        // Also check if we have the IL Compiler tools for cross compilation
        // This usually resides inside the package, e.g. ~/.nuget/packages/publishaotcross.macos/x.x.x/tools
        // We can just check if the directory exists and has some versions
        if (info.crossBuildInstalled) {
            try {
                const versions = fs.readdirSync(nugetGlobalPath);
                if (versions.length > 0) {
                    // Just pick the first one to say it's valid
                    info.crossBuildVersion = versions[0];
                } else {
                    info.crossBuildInstalled = false;
                }
            } catch {
                info.crossBuildInstalled = false;
            }
        }

        return info;
    }

    private async _checkEnvironment() {
        await this._refreshData();
        vscode.window.showInformationMessage('环境检测完成');
    }

    private _postMessage(message: any) {
        if (this._panel) {
            this._panel.webview.postMessage(message);
        }
    }

    private _getToolkitUri(): vscode.Uri {
        return vscode.Uri.joinPath(this._extensionUri, 'node_modules', '@vscode', 'webview-ui-toolkit', 'dist', 'toolkit.min.js');
    }

    private _getHtml(): string {
        const toolkitUri = this._panel?.webview.asWebviewUri(this._getToolkitUri());

        return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<script type="module" src="${toolkitUri}"></script>
<style>
body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); background: var(--vscode-editor-background); padding: 24px; font-size: 13px; }
.card { background: var(--vscode-sideBar-background); border: 1px solid var(--vscode-panel-border); border-radius: 8px; padding: 20px; margin-bottom: 24px; box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1); }
h2 { margin-top: 0; font-size: 15px; font-weight: 600; border-bottom: 1px solid var(--vscode-panel-border); padding-bottom: 12px; margin-bottom: 20px; display: flex; align-items: center; gap: 10px; color: var(--vscode-editor-foreground); }
.row { display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px; }
.desc { font-size: 12px; color: var(--vscode-descriptionForeground); margin-top: 6px; line-height: 1.4; }
.form-group { margin-bottom: 20px; }
.status-badge { padding: 4px 8px; border-radius: 4px; font-size: 11px; margin-left: 8px; font-weight: 600; }
.status-ok { background: var(--vscode-testing-iconPassed); color: #fff; }
.status-err { background: var(--vscode-testing-iconFailed); color: #fff; }

/* Toolkit Overrides */
vscode-checkbox { margin-bottom: 12px; display: flex; align-items: center; min-height: 24px; }
vscode-button { margin-top: 12px; }
</style>
</head>
<body>
    <h1 style="margin-bottom: 20px;">🚀 高级功能仪表盘</h1>

    <div class="card">
        <h2><span class="codicon codicon-tools"></span> 环境检测</h2>
        <div class="row">
            <div style="flex:1">
                <div style="display:flex;align-items:center;justify-content:space-between">
                    <span style="font-weight:600">UPX 压缩工具</span>
                    <vscode-tag id="upxStatus">检测中...</vscode-tag>
                </div>
                <div class="desc" id="upxVersion"></div>
            </div>
        </div>
        <div class="row" style="margin-top: 12px; border-top: 1px dashed var(--vscode-panel-border); padding-top: 12px;">
            <div style="flex:1">
                <div style="display:flex;align-items:center;justify-content:space-between">
                    <span style="font-weight:600">PublishAotCross.macOS</span>
                    <vscode-tag id="crossStatus">检测中...</vscode-tag>
                </div>
                <div class="desc">用于 macOS 交叉编译 Linux AOT</div>
            </div>
        </div>
        <vscode-button appearance="secondary" onclick="checkEnv()" style="margin-top: 16px; width:100%">
            <span slot="start" class="codicon codicon-refresh"></span> 重新检测
        </vscode-button>
    </div>

    <div class="card">
        <h2><span class="codicon codicon-archive"></span> 压缩配置 (UPX)</h2>
        <div class="form-group">
            <vscode-checkbox id="upxEnabled">启用 UPX 压缩</vscode-checkbox>
        </div>
        <div class="form-group">
            <vscode-dropdown id="upxLevel" style="width: 100%;">
                <span slot="label">压缩级别</span>
                <vscode-option value="-1">快速 (-1)</vscode-option>
                <vscode-option value="--best">最佳 (--best)</vscode-option>
                <vscode-option value="--lzma">LZMA (--lzma)</vscode-option>
            </vscode-dropdown>
        </div>
    </div>

    <div class="card">
        <h2><span class="codicon codicon-terminal"></span> 远程命令配置</h2>
        <div class="form-group">
            <vscode-text-area id="afterUploadCommand" rows="3" style="width: 100%; font-family: monospace;">
                上传后执行命令 (After Upload Command)
                <span slot="subtitle">支持变量: {app_name}, {remote_path}</span>
            </vscode-text-area>
        </div>
    </div>

    <div class="card">
        <h2><span class="codicon codicon-bell"></span> Telegram 推送</h2>
        <div class="form-group">
            <vscode-checkbox id="telegramEnabled">启用通知</vscode-checkbox>
        </div>
        <div class="form-group">
            <vscode-checkbox id="telegramUpload">
                推送构建产物 (Upload Artifact)
                <span slot="hint">注意：Telegram Bot API 限制文件大小为 50MB</span>
            </vscode-checkbox>
        </div>
        <div class="form-group">
            <vscode-text-field id="telegramBotToken" type="password" style="width: 100%;">Bot Token</vscode-text-field>
        </div>
        <div class="form-group">
            <vscode-text-field id="telegramChatId" style="width: 100%;">Chat ID</vscode-text-field>
        </div>
    </div>

    <vscode-button onclick="saveConfig()" style="width: 100%">
        <span slot="start" class="codicon codicon-save"></span> 保存配置
    </vscode-button>

<script>
    const vscode = acquireVsCodeApi();

    function checkEnv() {
        vscode.postMessage({ command: 'checkEnv' });
    }

    function saveConfig() {
        vscode.postMessage({
            command: 'saveConfig',
            config: {
                upxEnabled: document.getElementById('upxEnabled').checked,
                upxLevel: document.getElementById('upxLevel').value,
                afterUploadCommand: document.getElementById('afterUploadCommand').value,
                telegramEnabled: document.getElementById('telegramEnabled').checked,
                telegramUpload: document.getElementById('telegramUpload').checked,
                telegramBotToken: document.getElementById('telegramBotToken').value,
                telegramChatId: document.getElementById('telegramChatId').value
            }
        });
    }

    window.addEventListener('message', event => {
        const message = event.data;
        if (message.command === 'data') {
            // Config
            document.getElementById('upxEnabled').checked = message.config.upxEnabled;
            document.getElementById('upxLevel').value = message.config.upxLevel;
            document.getElementById('afterUploadCommand').value = message.config.afterUploadCommand;
            document.getElementById('telegramEnabled').checked = message.config.telegramEnabled;
            document.getElementById('telegramUpload').checked = message.config.telegramUpload;
            document.getElementById('telegramBotToken').value = message.config.telegramBotToken;
            document.getElementById('telegramChatId').value = message.config.telegramChatId;

            // Env
            const upxEl = document.getElementById('upxStatus');
            upxEl.textContent = message.env.upxInstalled ? '已安装' : '未安装';
            // Use 'appearance' attribute if supported or custom class
            // For now simple text update is fine, but let's change color if possible via attributes?
            // Vscode tag doesn't support direct color change easily without css variables,
            // but we can set inner text and let user infer from text.
            // Or better, stick to custom class for color but use the tag component structure

            // Actually, vscode-tag doesn't have 'status-ok' classes.
            // We can style the tag using css variables in JS if we want, or rely on text.
            // Let's rely on text and maybe opacity.

            // To make it green/red we can inject style
            if (message.env.upxInstalled) {
                upxEl.style.color = 'var(--vscode-testing-iconPassed)';
                upxEl.style.borderColor = 'var(--vscode-testing-iconPassed)';
                document.getElementById('upxVersion').textContent = message.env.upxVersion;
            } else {
                upxEl.style.color = 'var(--vscode-testing-iconFailed)';
                upxEl.style.borderColor = 'var(--vscode-testing-iconFailed)';
            }

            const crossEl = document.getElementById('crossStatus');
            crossEl.textContent = message.env.crossBuildInstalled ? '已检测到库' : '未检测到';
            if (message.env.crossBuildInstalled) {
                crossEl.style.color = 'var(--vscode-testing-iconPassed)';
                crossEl.style.borderColor = 'var(--vscode-testing-iconPassed)';
            } else {
                crossEl.style.color = 'var(--vscode-testing-iconFailed)';
                crossEl.style.borderColor = 'var(--vscode-testing-iconFailed)';
            }

            if (message.env.crossBuildInstalled && message.env.crossBuildVersion) {
                 const descEl = crossEl.parentElement.nextElementSibling;
                 if (!descEl.innerHTML.includes('版本')) {
                    descEl.innerHTML += ' <br/><span style="color:#4ec9b0">版本: ' + message.env.crossBuildVersion + '</span>';
                 }
            }
        }
    });

    // Init
    vscode.postMessage({ command: 'ready' });
</script>
</body>
</html>`;
    }
}
