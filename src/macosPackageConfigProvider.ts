/**
 * macOS 打包配置面板 Provider
 *
 * 提供一个 WebView 面板用于配置 macOS 打包选项
 */

import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

/**
 * 检查是否在 macOS 平台上
 */
function isMacOS(): boolean {
    return process.platform === 'darwin';
}

export class MacOSPackageConfigProvider {
    public static currentPanel: MacOSPackageConfigProvider | undefined;
    private readonly _panel: vscode.WebviewPanel;
    private readonly _extensionUri: vscode.Uri;
    private _disposables: vscode.Disposable[] = [];

    public static createOrShow(extensionUri: vscode.Uri) {
        // 检查是否在 macOS 上
        if (!isMacOS()) {
            vscode.window.showWarningMessage('macOS 打包功能仅在 macOS 系统上可用');
            return;
        }

        const column = vscode.window.activeTextEditor
            ? vscode.window.activeTextEditor.viewColumn
            : undefined;

        // 如果已存在面板，显示它
        if (MacOSPackageConfigProvider.currentPanel) {
            MacOSPackageConfigProvider.currentPanel._panel.reveal(column);
            return;
        }

        // 创建新面板
        const panel = vscode.window.createWebviewPanel(
            'macosPackageConfig',
            '📦 macOS 打包配置',
            column || vscode.ViewColumn.One,
            {
                enableScripts: true,
                localResourceRoots: [extensionUri],
                retainContextWhenHidden: true,
            }
        );

        MacOSPackageConfigProvider.currentPanel = new MacOSPackageConfigProvider(panel, extensionUri);
    }

    private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri) {
        this._panel = panel;
        this._extensionUri = extensionUri;

        // 设置初始内容
        this._panel.webview.html = this._getHtmlContent();

        // 处理面板关闭
        this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

        // 处理消息
        this._panel.webview.onDidReceiveMessage(
            async (message) => {
                switch (message.command) {
                    case 'getConfig':
                        this._sendConfig();
                        break;
                    case 'saveConfig':
                        await this._saveConfig(message.config);
                        break;
                    case 'selectIcon':
                        await this._selectIcon();
                        break;
                    case 'clearIcon':
                        await this._clearIcon();
                        break;
                    case 'close':
                        this._panel.dispose();
                        break;
                }
            },
            null,
            this._disposables
        );
    }

    private _sendConfig() {
        const config = vscode.workspace.getConfiguration('dotnetDeploy.macos');
        this._panel.webview.postMessage({
            command: 'config',
            config: {
                enabled: config.get<boolean>('enabled', false),
                appName: config.get<string>('appName', ''),
                bundleId: config.get<string>('bundleId', 'com.example.app'),
                version: config.get<string>('version', '1.0.0'),
                shortVersion: config.get<string>('shortVersion', ''),
                buildNumber: config.get<string>('buildNumber', '1'),
                format: config.get<string>('format', 'app'),
                iconPath: config.get<string>('iconPath', ''),
                minimumOSVersion: config.get<string>('minimumOSVersion', '10.15'),
                codeSignEnabled: config.get<boolean>('codeSign.enabled', false),
                codeSignIdentity: config.get<string>('codeSign.identity', ''),
                notarize: config.get<boolean>('codeSign.notarize', false),
                appleId: config.get<string>('codeSign.appleId', ''),
                teamId: config.get<string>('codeSign.teamId', ''),
            },
        });
    }

    private async _saveConfig(config: any) {
        const wsConfig = vscode.workspace.getConfiguration('dotnetDeploy.macos');

        try {
            await wsConfig.update('enabled', config.enabled, vscode.ConfigurationTarget.Workspace);
            await wsConfig.update('appName', config.appName, vscode.ConfigurationTarget.Workspace);
            await wsConfig.update('bundleId', config.bundleId, vscode.ConfigurationTarget.Workspace);
            await wsConfig.update('version', config.version, vscode.ConfigurationTarget.Workspace);
            await wsConfig.update('shortVersion', config.shortVersion, vscode.ConfigurationTarget.Workspace);
            await wsConfig.update('buildNumber', config.buildNumber, vscode.ConfigurationTarget.Workspace);
            await wsConfig.update('format', config.format, vscode.ConfigurationTarget.Workspace);
            await wsConfig.update('iconPath', config.iconPath, vscode.ConfigurationTarget.Workspace);
            await wsConfig.update('minimumOSVersion', config.minimumOSVersion, vscode.ConfigurationTarget.Workspace);
            await wsConfig.update('codeSign.enabled', config.codeSignEnabled, vscode.ConfigurationTarget.Workspace);
            await wsConfig.update('codeSign.identity', config.codeSignIdentity, vscode.ConfigurationTarget.Workspace);
            await wsConfig.update('codeSign.notarize', config.notarize, vscode.ConfigurationTarget.Workspace);
            await wsConfig.update('codeSign.appleId', config.appleId, vscode.ConfigurationTarget.Workspace);
            await wsConfig.update('codeSign.teamId', config.teamId, vscode.ConfigurationTarget.Workspace);

            vscode.window.showInformationMessage('✓ macOS 打包配置已保存');
            this._panel.webview.postMessage({ command: 'saved' });
        } catch (err: any) {
            vscode.window.showErrorMessage(`保存配置失败: ${err.message}`);
        }
    }

    private async _selectIcon() {
        const result = await vscode.window.showOpenDialog({
            canSelectFiles: true,
            canSelectFolders: false,
            canSelectMany: false,
            filters: {
                'Icons': ['png', 'icns'],
            },
            title: '选择应用图标',
        });

        if (result && result.length > 0) {
            const iconPath = result[0].fsPath;
            this._panel.webview.postMessage({
                command: 'iconSelected',
                path: iconPath,
            });
        }
    }

    private async _clearIcon() {
        this._panel.webview.postMessage({
            command: 'iconCleared',
        });
    }

    public dispose() {
        MacOSPackageConfigProvider.currentPanel = undefined;
        this._panel.dispose();
        while (this._disposables.length) {
            const disposable = this._disposables.pop();
            if (disposable) {
                disposable.dispose();
            }
        }
    }

    private _getHtmlContent(): string {
        return `<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>macOS 打包配置</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
            padding: 20px;
            font-family: var(--vscode-font-family);
            font-size: 13px;
            color: var(--vscode-foreground);
            background: var(--vscode-editor-background);
        }
        .header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 20px;
            padding-bottom: 15px;
            border-bottom: 1px solid var(--vscode-panel-border);
        }
        .header h1 {
            font-size: 18px;
            font-weight: 600;
            display: flex;
            align-items: center;
            gap: 8px;
        }
        .section {
            margin-bottom: 20px;
            padding: 15px;
            background: var(--vscode-sideBar-background);
            border: 1px solid var(--vscode-panel-border);
            border-radius: 6px;
        }
        .section-title {
            font-size: 14px;
            font-weight: 600;
            margin-bottom: 15px;
            display: flex;
            align-items: center;
            gap: 6px;
        }
        .form-row {
            margin-bottom: 12px;
        }
        .form-label {
            display: block;
            font-size: 12px;
            font-weight: 500;
            margin-bottom: 4px;
            color: var(--vscode-descriptionForeground);
        }
        .form-hint {
            font-size: 11px;
            color: var(--vscode-descriptionForeground);
            opacity: 0.8;
            margin-top: 3px;
        }
        .form-input {
            width: 100%;
            padding: 6px 10px;
            font-size: 13px;
            border: 1px solid var(--vscode-input-border);
            background: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
            border-radius: 4px;
            outline: none;
        }
        .form-input:focus {
            border-color: var(--vscode-focusBorder);
        }
        .form-select {
            width: 100%;
            padding: 6px 10px;
            font-size: 13px;
            border: 1px solid var(--vscode-input-border);
            background: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
            border-radius: 4px;
            outline: none;
            cursor: pointer;
        }
        .row-2 {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 15px;
        }
        .row-3 {
            display: grid;
            grid-template-columns: 1fr 1fr 1fr;
            gap: 15px;
        }
        .checkbox-row {
            display: flex;
            align-items: center;
            gap: 8px;
            padding: 8px 0;
        }
        .checkbox-row input[type="checkbox"] {
            width: 16px;
            height: 16px;
            cursor: pointer;
        }
        .checkbox-label {
            cursor: pointer;
            user-select: none;
        }
        .radio-group {
            display: flex;
            flex-direction: column;
            gap: 8px;
        }
        .radio-row {
            display: flex;
            align-items: center;
            gap: 8px;
            padding: 6px 10px;
            border: 1px solid var(--vscode-panel-border);
            border-radius: 4px;
            cursor: pointer;
            transition: all 0.2s;
        }
        .radio-row:hover {
            background: var(--vscode-list-hoverBackground);
        }
        .radio-row.selected {
            border-color: var(--vscode-focusBorder);
            background: var(--vscode-list-activeSelectionBackground);
        }
        .radio-row input[type="radio"] {
            width: 16px;
            height: 16px;
            cursor: pointer;
        }
        .radio-info {
            flex: 1;
        }
        .radio-title {
            font-weight: 500;
        }
        .radio-desc {
            font-size: 11px;
            color: var(--vscode-descriptionForeground);
            margin-top: 2px;
        }
        .icon-preview {
            display: flex;
            align-items: center;
            gap: 15px;
            padding: 10px;
            background: var(--vscode-editor-background);
            border: 1px dashed var(--vscode-panel-border);
            border-radius: 6px;
        }
        .icon-placeholder {
            width: 64px;
            height: 64px;
            display: flex;
            align-items: center;
            justify-content: center;
            background: var(--vscode-input-background);
            border: 1px solid var(--vscode-panel-border);
            border-radius: 8px;
            font-size: 24px;
        }
        .icon-actions {
            display: flex;
            flex-direction: column;
            gap: 6px;
        }
        .btn {
            padding: 6px 14px;
            font-size: 12px;
            border: none;
            border-radius: 4px;
            cursor: pointer;
            transition: all 0.2s;
        }
        .btn-primary {
            background: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
        }
        .btn-primary:hover {
            background: var(--vscode-button-hoverBackground);
        }
        .btn-secondary {
            background: var(--vscode-button-secondaryBackground);
            color: var(--vscode-button-secondaryForeground);
        }
        .btn-secondary:hover {
            background: var(--vscode-button-secondaryHoverBackground);
        }
        .footer {
            display: flex;
            justify-content: flex-end;
            gap: 10px;
            margin-top: 20px;
            padding-top: 15px;
            border-top: 1px solid var(--vscode-panel-border);
        }
        .footer .btn {
            padding: 8px 20px;
            font-size: 13px;
        }
        .hidden {
            display: none !important;
        }
        .enable-toggle {
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 12px 15px;
            background: var(--vscode-sideBar-background);
            border: 1px solid var(--vscode-panel-border);
            border-radius: 6px;
            margin-bottom: 15px;
        }
        .enable-toggle-label {
            font-weight: 500;
        }
        .enable-toggle-desc {
            font-size: 11px;
            color: var(--vscode-descriptionForeground);
            margin-top: 2px;
        }
        .toggle-switch {
            position: relative;
            width: 44px;
            height: 24px;
        }
        .toggle-switch input {
            opacity: 0;
            width: 0;
            height: 0;
        }
        .toggle-slider {
            position: absolute;
            cursor: pointer;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background: var(--vscode-input-background);
            border: 1px solid var(--vscode-input-border);
            border-radius: 24px;
            transition: 0.3s;
        }
        .toggle-slider:before {
            position: absolute;
            content: "";
            height: 18px;
            width: 18px;
            left: 2px;
            bottom: 2px;
            background: var(--vscode-foreground);
            border-radius: 50%;
            transition: 0.3s;
        }
        .toggle-switch input:checked + .toggle-slider {
            background: var(--vscode-button-background);
            border-color: var(--vscode-button-background);
        }
        .toggle-switch input:checked + .toggle-slider:before {
            transform: translateX(20px);
            background: var(--vscode-button-foreground);
        }
        .config-content.disabled {
            opacity: 0.5;
            pointer-events: none;
        }
    </style>
</head>
<body>
    <div class="header">
        <h1>📦 macOS 打包配置</h1>
    </div>

    <div class="enable-toggle">
        <div>
            <div class="enable-toggle-label">启用 macOS 打包</div>
            <div class="enable-toggle-desc">发布时自动创建 .app / .dmg / .pkg 文件</div>
        </div>
        <label class="toggle-switch">
            <input type="checkbox" id="enabled" onchange="toggleEnabled()">
            <span class="toggle-slider"></span>
        </label>
    </div>

    <div id="configContent" class="config-content disabled">
        <!-- 基本信息 -->
        <div class="section">
            <div class="section-title">📋 基本信息</div>
            <div class="form-row">
                <label class="form-label">应用名称</label>
                <input type="text" class="form-input" id="appName" placeholder="My Application">
                <div class="form-hint">显示在菜单栏和 Dock 中的名称</div>
            </div>
            <div class="row-2">
                <div class="form-row">
                    <label class="form-label">Bundle Identifier</label>
                    <input type="text" class="form-input" id="bundleId" placeholder="com.example.myapp">
                    <div class="form-hint">应用的唯一标识符</div>
                </div>
                <div class="form-row">
                    <label class="form-label">最低 macOS 版本</label>
                    <select class="form-select" id="minimumOSVersion">
                        <option value="10.15">macOS 10.15 (Catalina)</option>
                        <option value="11.0">macOS 11 (Big Sur)</option>
                        <option value="12.0">macOS 12 (Monterey)</option>
                        <option value="13.0">macOS 13 (Ventura)</option>
                        <option value="14.0">macOS 14 (Sonoma)</option>
                    </select>
                </div>
            </div>
            <div class="row-3">
                <div class="form-row">
                    <label class="form-label">版本号</label>
                    <input type="text" class="form-input" id="version" placeholder="1.0.0">
                </div>
                <div class="form-row">
                    <label class="form-label">短版本号 (可选)</label>
                    <input type="text" class="form-input" id="shortVersion" placeholder="1.0">
                </div>
                <div class="form-row">
                    <label class="form-label">Build 号</label>
                    <input type="text" class="form-input" id="buildNumber" placeholder="1">
                </div>
            </div>
        </div>

        <!-- 打包格式 -->
        <div class="section">
            <div class="section-title">📁 打包格式</div>
            <div class="radio-group" id="formatGroup">
                <div class="radio-row" onclick="selectFormat('app')">
                    <input type="radio" name="format" value="app" id="format-app">
                    <div class="radio-info">
                        <div class="radio-title">.app 应用程序包</div>
                        <div class="radio-desc">可直接双击运行，适合开发测试</div>
                    </div>
                </div>
                <div class="radio-row" onclick="selectFormat('dmg')">
                    <input type="radio" name="format" value="dmg" id="format-dmg">
                    <div class="radio-info">
                        <div class="radio-title">.dmg 磁盘镜像</div>
                        <div class="radio-desc">推荐用于分发，用户可拖拽安装</div>
                    </div>
                </div>
                <div class="radio-row" onclick="selectFormat('pkg')">
                    <input type="radio" name="format" value="pkg" id="format-pkg">
                    <div class="radio-info">
                        <div class="radio-title">.pkg 安装包</div>
                        <div class="radio-desc">支持自定义安装路径，适合企业部署</div>
                    </div>
                </div>
            </div>
        </div>

        <!-- 应用图标 -->
        <div class="section">
            <div class="section-title">🖼️ 应用图标</div>
            <div class="icon-preview">
                <div class="icon-placeholder" id="iconPreview">🍎</div>
                <div class="icon-actions">
                    <button class="btn btn-secondary" onclick="selectIcon()">📂 选择图标文件</button>
                    <button class="btn btn-secondary" onclick="clearIcon()" id="clearIconBtn" style="display:none">✕ 清除</button>
                    <div class="form-hint">支持 .png (1024x1024) 或 .icns 格式</div>
                </div>
            </div>
            <input type="hidden" id="iconPath">
        </div>

        <!-- 代码签名 -->
        <div class="section">
            <div class="section-title">🔐 代码签名 (可选)</div>
            <div class="checkbox-row">
                <input type="checkbox" id="codeSignEnabled" onchange="toggleCodeSign()">
                <label class="checkbox-label" for="codeSignEnabled">启用代码签名</label>
            </div>
            <div id="codeSignOptions" class="hidden">
                <div class="form-row">
                    <label class="form-label">开发者证书 ID</label>
                    <input type="text" class="form-input" id="codeSignIdentity" placeholder="Developer ID Application: Your Name (TEAMID)">
                    <div class="form-hint">运行 "security find-identity -p codesigning" 查看可用证书</div>
                </div>
                <div class="checkbox-row">
                    <input type="checkbox" id="notarize">
                    <label class="checkbox-label" for="notarize">提交 Apple 公证</label>
                </div>
                <div id="notarizeOptions" class="hidden">
                    <div class="row-2">
                        <div class="form-row">
                            <label class="form-label">Apple ID</label>
                            <input type="text" class="form-input" id="appleId" placeholder="your@apple.id">
                        </div>
                        <div class="form-row">
                            <label class="form-label">Team ID</label>
                            <input type="text" class="form-input" id="teamId" placeholder="XXXXXXXXXX">
                        </div>
                    </div>
                </div>
            </div>
        </div>
    </div>

    <div class="footer">
        <button class="btn btn-secondary" onclick="close()">取消</button>
        <button class="btn btn-primary" onclick="save()">💾 保存配置</button>
    </div>

    <script>
        const vscode = acquireVsCodeApi();

        // 加载配置
        vscode.postMessage({ command: 'getConfig' });

        window.addEventListener('message', event => {
            const message = event.data;
            switch (message.command) {
                case 'config':
                    loadConfig(message.config);
                    break;
                case 'iconSelected':
                    document.getElementById('iconPath').value = message.path;
                    document.getElementById('iconPreview').innerHTML = '<img src="' + message.path + '" style="width:64px;height:64px;object-fit:contain;border-radius:8px;">';
                    document.getElementById('clearIconBtn').style.display = 'block';
                    break;
                case 'iconCleared':
                    document.getElementById('iconPath').value = '';
                    document.getElementById('iconPreview').innerHTML = '🍎';
                    document.getElementById('clearIconBtn').style.display = 'none';
                    break;
                case 'saved':
                    // 配置已保存
                    break;
            }
        });

        function loadConfig(config) {
            document.getElementById('enabled').checked = config.enabled;
            document.getElementById('appName').value = config.appName || '';
            document.getElementById('bundleId').value = config.bundleId || 'com.example.app';
            document.getElementById('version').value = config.version || '1.0.0';
            document.getElementById('shortVersion').value = config.shortVersion || '';
            document.getElementById('buildNumber').value = config.buildNumber || '1';
            document.getElementById('minimumOSVersion').value = config.minimumOSVersion || '10.15';
            document.getElementById('iconPath').value = config.iconPath || '';
            document.getElementById('codeSignEnabled').checked = config.codeSignEnabled;
            document.getElementById('codeSignIdentity').value = config.codeSignIdentity || '';
            document.getElementById('notarize').checked = config.notarize;
            document.getElementById('appleId').value = config.appleId || '';
            document.getElementById('teamId').value = config.teamId || '';

            // 设置打包格式
            selectFormat(config.format || 'app');

            // 更新 UI 状态
            toggleEnabled();
            toggleCodeSign();

            // 如果有图标路径
            if (config.iconPath) {
                document.getElementById('iconPreview').innerHTML = '📄';
                document.getElementById('clearIconBtn').style.display = 'block';
            }
        }

        function toggleEnabled() {
            const enabled = document.getElementById('enabled').checked;
            const content = document.getElementById('configContent');
            if (enabled) {
                content.classList.remove('disabled');
            } else {
                content.classList.add('disabled');
            }
        }

        function selectFormat(format) {
            document.querySelectorAll('.radio-row').forEach(row => row.classList.remove('selected'));
            const radioRow = document.querySelector('.radio-row:has(#format-' + format + ')') ||
                            document.querySelector('[onclick="selectFormat(\\'' + format + '\\')"]');
            if (radioRow) radioRow.classList.add('selected');
            document.getElementById('format-' + format).checked = true;
        }

        function toggleCodeSign() {
            const enabled = document.getElementById('codeSignEnabled').checked;
            document.getElementById('codeSignOptions').classList.toggle('hidden', !enabled);

            const notarize = document.getElementById('notarize').checked;
            document.getElementById('notarizeOptions').classList.toggle('hidden', !notarize || !enabled);
        }

        document.getElementById('notarize').addEventListener('change', toggleCodeSign);

        function selectIcon() {
            vscode.postMessage({ command: 'selectIcon' });
        }

        function clearIcon() {
            vscode.postMessage({ command: 'clearIcon' });
        }

        function save() {
            const config = {
                enabled: document.getElementById('enabled').checked,
                appName: document.getElementById('appName').value,
                bundleId: document.getElementById('bundleId').value,
                version: document.getElementById('version').value,
                shortVersion: document.getElementById('shortVersion').value,
                buildNumber: document.getElementById('buildNumber').value,
                format: document.querySelector('input[name="format"]:checked')?.value || 'app',
                iconPath: document.getElementById('iconPath').value,
                minimumOSVersion: document.getElementById('minimumOSVersion').value,
                codeSignEnabled: document.getElementById('codeSignEnabled').checked,
                codeSignIdentity: document.getElementById('codeSignIdentity').value,
                notarize: document.getElementById('notarize').checked,
                appleId: document.getElementById('appleId').value,
                teamId: document.getElementById('teamId').value,
            };
            vscode.postMessage({ command: 'saveConfig', config: config });
        }

        function close() {
            vscode.postMessage({ command: 'close' });
        }
    </script>
</body>
</html>`;
    }
}
