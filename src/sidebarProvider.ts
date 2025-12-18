import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { findSolution, getExecutableProjects, parseProject, ProjectInfo } from './solutionParser';
import { publish } from './publisher';
import { deploy, executeRemote, DeployConfig } from './deployer';

export class SidebarProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'dotnetDeploy.sidebar';
    private _view?: vscode.WebviewView;
    private _outputChannel: vscode.OutputChannel;
    private _projects: ProjectInfo[] = [];

    constructor(
        private readonly _extensionUri: vscode.Uri,
        outputChannel: vscode.OutputChannel
    ) {
        this._outputChannel = outputChannel;
    }

    public resolveWebviewView(
        webviewView: vscode.WebviewView,
        context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken
    ) {
        this._view = webviewView;

        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this._extensionUri]
        };

        webviewView.webview.html = this._getHtml();

        webviewView.webview.onDidReceiveMessage(async message => {
            switch (message.command) {
                case 'ready':
                case 'refresh':
                    await this._loadProjects();
                    break;
                case 'deploy':
                    await this._handleDeploy(message);
                    break;
                case 'openFolder':
                    if (message.path) {
                        // 使用 revealFileInOS 在 Finder/文件管理器中打开文件夹
                        vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(message.path));
                    }
                    break;
                case 'openDashboard':
                    vscode.commands.executeCommand('dotnetDeploy.openDashboard');
                    break;
                case 'helpSSH':
                    vscode.window.showInformationMessage(
                        'SSH 密钥通常位于 "~/.ssh/id_rsa"。如果不存在，请在终端运行 "ssh-keygen" 生成。',
                        '复制生成命令'
                    ).then(selection => {
                        if (selection === '复制生成命令') {
                            vscode.env.clipboard.writeText('ssh-keygen -t rsa -b 4096');
                        }
                    });
                    break;
            }
        });

        webviewView.onDidChangeVisibility(() => {
            if (webviewView.visible) {
                this._loadProjects();
            }
        });

        setTimeout(() => this._loadProjects(), 200);
    }

    private async _loadProjects() {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders) {
            this._postMessage({ command: 'projects', projects: [], error: '未打开工作区' });
            return;
        }

        try {
            const projects: ProjectInfo[] = [];
            const processedPaths = new Set<string>();

            // 1. Find all .sln files recursively
            const slnFiles = await vscode.workspace.findFiles('**/*.sln', '**/node_modules/**');
            for (const slnUri of slnFiles) {
                try {
                    const slnProjects = getExecutableProjects(slnUri.fsPath);
                    for (const p of slnProjects) {
                        if (!processedPaths.has(p.path)) {
                            projects.push(p);
                            processedPaths.add(p.path);
                        }
                    }
                } catch (e) {
                    console.error(`Error parsing SLN ${slnUri.fsPath}:`, e);
                }
            }

            // 2. Find all .csproj files recursively
            const csprojFiles = await vscode.workspace.findFiles('**/*.csproj', '**/node_modules/**');
            for (const csprojUri of csprojFiles) {
                if (!processedPaths.has(csprojUri.fsPath)) {
                    try {
                        const p = parseProject(csprojUri.fsPath);
                        // 显示所有项目类型（不只是 Exe）
                        projects.push(p);
                        processedPaths.add(p.path);
                    } catch (e) {
                        console.error(`Error parsing CSPROJ ${csprojUri.fsPath}:`, e);
                    }
                }
            }

            if (projects.length === 0) {
                this._postMessage({ command: 'projects', projects: [], error: '未找到可执行的 .NET 项目 (.sln/.csproj)' });
                return;
            }

            this._projects = projects;
            const config = vscode.workspace.getConfiguration('dotnetDeploy');

            this._postMessage({
                command: 'projects',
                projects: this._projects.map(p => ({ name: p.name, path: p.path })),
                config: {
                    host: config.get('server.host', ''),
                    port: config.get('server.port', 22),
                    username: config.get('server.username', 'root'),
                    privateKeyPath: config.get('server.privateKeyPath', '~/.ssh/id_rsa'),
                    remotePath: config.get('deploy.remotePath', '/opt/apps'),
                    selfContained: config.get('publish.selfContained', true),
                    singleFile: config.get('publish.singleFile', false),
                    debugSymbols: config.get('publish.debugSymbols', false),
                    publishAot: config.get('publish.aot', false),
                    stripSymbols: config.get('publish.stripSymbols', false),
                    invariantGlobalization: config.get('publish.invariantGlobalization', false),
                    runtime: config.get<string>('publish.runtime') || 'linux-x64'
                }
            });
        } catch (err: any) {
            this._postMessage({ command: 'projects', projects: [], error: err.message });
        }
    }

    private async _handleDeploy(message: any) {
        const project = this._projects.find(p => p.name === message.projectName);
        if (!project) {
            this._postMessage({ command: 'error', message: '未找到项目' });
            return;
        }

        this._outputChannel.clear();
        this._outputChannel.show(true);

        const deployTarget = message.deployTarget || 'server';
        let publishDir: string;

        if (deployTarget === 'local') {
            if (message.localPath && message.localPath.trim() !== '') {
                publishDir = message.localPath;
            } else {
                publishDir = path.join(path.dirname(project.path), 'bin', 'publish');
            }

            // Clean output directory if requested (Local Mode Only)
            if (message.cleanDestination) {
                try {
                    if (fs.existsSync(publishDir)) {
                        this._outputChannel.appendLine(`[Deploy] Cleaning local output directory: ${publishDir}`);
                        fs.rmSync(publishDir, { recursive: true, force: true });
                    }
                } catch (e: any) {
                    this._outputChannel.appendLine(`[Deploy] Warning: Failed to clean output directory: ${e.message}`);
                }
            }
        } else {
            publishDir = path.join(require('os').tmpdir(), 'dotnet-deploy', project.name);
        }

        this._postMessage({ command: 'status', phase: 'publish' });
        this._outputChannel.appendLine(`[Deploy] Publishing ${project.name} to ${publishDir}...`);

        const publishResult = await publish({
            projectPath: project.path,
            outputPath: publishDir,
            selfContained: message.selfContained,
            singleFile: message.singleFile,
            debugSymbols: message.debugSymbols,
            disableSymbols: message.disableSymbols,
            publishAot: message.publishAot,
            stripSymbols: message.stripSymbols,
            invariantGlobalization: message.invariantGlobalization,
            runtime: message.runtime
        }, this._outputChannel);

        if (!publishResult.success) {
            this._postMessage({ command: 'error', message: '发布失败！' });
            return;
        }

        if (deployTarget === 'local') {
            this._postMessage({
                command: 'success',
                message: '发布成功！',
                path: publishResult.outputPath
            });
            vscode.window.showInformationMessage(`✓ ${project.name} 已发布到 ${publishDir}`);
            return;
        }

        const config = vscode.workspace.getConfiguration('dotnetDeploy');
        const deployConfig: DeployConfig = {
            host: message.host,
            port: message.port,
            username: message.username,
            authType: message.authType || 'key',
            privateKeyPath: message.privateKeyPath,
            password: message.password,
            remotePath: message.remotePath,
            afterUploadCommand: config.get('deploy.afterUploadCommand'),
            telegramEnabled: config.get('telegram.enabled'),
            telegramUpload: config.get('telegram.upload'),
            telegramBotToken: config.get('telegram.botToken'),
            telegramChatId: config.get('telegram.chatId'),
            incrementalUpload: message.incrementalUpload
        };

        this._postMessage({ command: 'status', phase: 'upload' });
        this._outputChannel.appendLine(`[Deploy] Uploading to ${message.host}...`);

        const deployResult = await deploy(deployConfig, publishDir, project.assemblyName, this._outputChannel);
        if (!deployResult.success) {
            this._postMessage({ command: 'error', message: '上传失败！' });
            return;
        }

        this._postMessage({ command: 'status', phase: 'start' });
        this._outputChannel.appendLine(`[Deploy] Starting service...`);

        const startResult = await executeRemote(deployConfig, project.assemblyName, this._outputChannel);
        if (startResult.success) {
            this._postMessage({ command: 'success', message: '部署成功！' });
            vscode.window.showInformationMessage(`✓ ${project.name} 部署成功！`);
        } else {
            this._postMessage({ command: 'error', message: '启动失败！' });
        }
    }

    private _postMessage(message: any) {
        if (this._view) {
            this._view.webview.postMessage(message);
        }
    }

    private _getToolkitUri(): vscode.Uri {
        return vscode.Uri.joinPath(this._extensionUri, 'node_modules', '@vscode', 'webview-ui-toolkit', 'dist', 'toolkit.min.js');
    }

    private _getHtml(): string {
        const toolkitUri = this._view?.webview.asWebviewUri(this._getToolkitUri());

        return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<script type="module" src="${toolkitUri}"></script>
<style>
* { margin: 0; padding: 0; box-sizing: border-box; }
body { padding: 16px; font-size: 13px; }
.header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; }
.header h2 { font-size: 13px; font-weight: 600; margin: 0; display: flex; align-items: center; gap: 6px; }
.section { margin-bottom: 4px; }
.section-title { font-size: 10px; font-weight: 600; text-transform: uppercase; opacity: 0.8; margin-bottom: 8px; letter-spacing: 0.5px; }
.form-row { margin-bottom: 4px; }
.form-label { display: block; font-size: 11px; margin-bottom: 2px; opacity: 0.9; }
.row-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.hidden { display: none; }
.loading { text-align: center; padding: 40px; opacity: 0.6; font-style: italic; }

/* Custom Progress Bar */
.progress-container { display: none; margin-bottom: 24px; gap: 6px; }
.progress-container.visible { display: flex; }
.progress-step { flex: 1; height: 18px; line-height: 18px; text-align: center; font-size: 10px; color: var(--vscode-descriptionForeground); background: var(--vscode-progressBar-background); opacity: 0.3; border-radius: 9px; transition: all 0.3s; position: relative; overflow: hidden; }
.progress-step.active { opacity: 1; color: #fff; font-weight: 600; }
.progress-step.done { background: var(--vscode-testing-iconPassed); opacity: 1; color: #fff; }

.cmd-preview-container {
    margin-top: 24px;
    padding: 12px;
    background: var(--vscode-editor-background);
    border: 1px solid var(--vscode-panel-border);
    border-radius: 4px;
    position: relative;
}
.cmd-preview {
    font-family: 'Consolas', 'Monaco', 'Courier New', monospace;
    font-size: 11px;
    color: var(--vscode-textPreformat-foreground);
    word-break: break-all;
    line-height: 1.4;
}
.cmd-preview-label {
    position: absolute;
    top: -10px;
    left: 8px;
    background: var(--vscode-sideBar-background);
    padding: 0 6px;
    font-size: 10px;
    font-weight: 600;
    color: var(--vscode-descriptionForeground);
    border-radius: 2px;
}

/* Toolkit Overrides for better spacing */
vscode-panel-view { padding: 4px 0; width: 100%; }
vscode-checkbox { margin-bottom: 6px; display: flex; align-items: center; min-height: 24px; }
vscode-radio { margin-right: 12px; display: flex; align-items: center; margin-bottom: 0; }
vscode-radio-group { display: flex; flex-direction: row; margin-bottom: 4px; align-items: center; min-height: 24px; }
vscode-divider { opacity: 0.4; margin: 16px 0; }
vscode-text-field, vscode-dropdown { width: 100%; display: block; margin-bottom: 4px; box-sizing: border-box; }
vscode-dropdown::part(control) { width: 100%; }

/* Segmented Control */
.segmented-control { display: flex; background: var(--vscode-input-background); padding: 2px; border-radius: 4px; margin-bottom: 16px; border: 1px solid var(--vscode-input-border); }
.segment-btn { flex: 1; text-align: center; padding: 6px; font-size: 11px; cursor: pointer; color: var(--vscode-foreground); border-radius: 2px; user-select: none; }
.segment-btn.active { background: var(--vscode-button-background); color: var(--vscode-button-foreground); font-weight: 600; }
.segment-btn:hover:not(.active) { background: var(--vscode-toolbar-hoverBackground); }
</style>
</head>
<body>
<div class="header">
    <h2>🚀 Dotnet Deploy</h2>
    <div style="display:flex; gap:4px;">
        <vscode-button appearance="icon" id="dashboardBtn" title="高级设置">⚙️</vscode-button>
        <vscode-button appearance="icon" id="refreshBtn" title="刷新项目">↻</vscode-button>
    </div>
</div>

<div class="progress-container" id="progress">
    <div class="progress-step" id="s1">发布</div>
    <div class="progress-step" id="s2">上传</div>
    <div class="progress-step" id="s3">启动</div>
</div>

<div id="content"><div class="loading">正在加载项目...</div></div>
<div id="msgContainer"></div>

<script>
(function() {
    const vscode = acquireVsCodeApi();
    const state = vscode.getState() || {};

    document.getElementById('refreshBtn').addEventListener('click', () => {
        document.getElementById('content').innerHTML = '<div class="loading">Loading...</div>';
        vscode.postMessage({ command: 'refresh' });
    });

    document.getElementById('dashboardBtn').addEventListener('click', () => {
        vscode.postMessage({ command: 'openDashboard' });
    });

    window.addEventListener('message', e => {
        const m = e.data;
        if (m.command === 'projects') {
            const mergedConfig = { ...m.config, ...state };
            renderForm(m.projects, mergedConfig, m.error);
        } else if (m.command === 'status') {
            updateStep(m.phase);
        } else if (m.command === 'success') {
            completeAllSteps();
            let msg = '✓ ' + m.message;
            if (m.path) {
                // Escape backslashes for JS string literal
                const escapedPath = m.path.replace(/\\\\/g, '\\\\\\\\');
                msg += ' <a href="#" onclick="openFolder(\\'' + escapedPath + '\\'); return false;" style="color:inherit;text-decoration:underline;margin-left:8px;">📂 打开目录</a>';
            }
            showMsg('success', msg);
            const btn = document.getElementById('deployBtn');
            btn.removeAttribute('disabled');
            btn.textContent = '🚀 发布';
        } else if (m.command === 'error') {
            showMsg('error', '✗ ' + m.message);
            const btn = document.getElementById('deployBtn');
            btn.removeAttribute('disabled');
            btn.textContent = '🚀 发布';
        }
    });

    function renderForm(projects, config, error) {
        try {
            if (error) {
                document.getElementById('content').innerHTML = '<div class="loading">' + error + '</div>';
                return;
            }

            const authType = config.authType || 'key';
            const deployTarget = config.deployTarget || 'local';
            const mode = state['optionsMode'] || 'simple';

            let html = '<div class="section"><div class="section-title">📦 项目</div>';
            html += '<div class="form-row"><vscode-dropdown id="project" style="width:100%" onchange="saveState(this)">';
            if (projects.length === 0) {
                html += '<vscode-option value="">无可用项目</vscode-option>';
            } else {
                projects.forEach(p => {
                    const selected = p.name === config.projectName ? ' selected' : '';
                    html += '<vscode-option value="' + p.name + '"' + selected + '>' + p.name + '</vscode-option>';
                });
            }
            html += '</vscode-dropdown></div></div>';

            html += '<vscode-panels activeid="tab-' + deployTarget + '" aria-label="Deploy Target">';
            html += '<vscode-panel-tab id="tab-local" onclick="toggleTarget(\\'local\\')">本地输出</vscode-panel-tab>';
            html += '<vscode-panel-tab id="tab-server" onclick="toggleTarget(\\'server\\')">远程服务器</vscode-panel-tab>';

            html += '<vscode-panel-view id="view-local">';
html += '<div style="display:flex; flex-direction:column; width:100%">';
            html += '<div class="form-row"><label class="form-label">输出路径</label><vscode-text-field id="localPath" placeholder="留空则发布到 bin/publish" value="' + (config.localPath || '') + '" oninput="saveState(this)"></vscode-text-field></div>';
html += '</div>';
            html += '</vscode-panel-view>';

            html += '<vscode-panel-view id="view-server">';
html += '<div style="display:flex; flex-direction:column; width:100%">';
            html += '<div class="row-2">';
            html += '<div><label class="form-label">主机 (Host)</label><vscode-text-field id="host" placeholder="192.168.1.100" value="' + (config.host || '') + '" oninput="saveState(this)"></vscode-text-field></div>';
            html += '<div><label class="form-label">端口</label><vscode-text-field id="port" value="' + (config.port || 22) + '" type="number" oninput="saveState(this)"></vscode-text-field></div>';
            html += '</div>';
            html += '<div class="form-row"><label class="form-label">用户名</label><vscode-text-field id="username" value="' + (config.username || 'root') + '" oninput="saveState(this)"></vscode-text-field></div>';

            html += '<div class="form-row">';
            html += '<label class="form-label" style="margin-bottom:6px">认证方式</label>';
            html += '<vscode-radio-group id="authType" value="' + authType + '" onchange="toggleAuth(this.value)">';
            html += '<vscode-radio value="key">SSH 密钥</vscode-radio>';
            html += '<vscode-radio value="password">密码</vscode-radio>';
            html += '</vscode-radio-group>';
            html += '</div>';

            const showKey = authType === 'key' ? '' : ' hidden';
            const showPass = authType === 'password' ? '' : ' hidden';
            html += '<div class="form-row' + showKey + '" id="keyInput">';
            html += '<label class="form-label">密钥路径</label>';
            html += '<div style="display:flex; align-items:center; gap:8px;">';
            html += '<vscode-text-field id="keyPath" value="' + (config.privateKeyPath || '') + '" style="flex:1" oninput="saveState(this)"></vscode-text-field>';
            html += '<vscode-button appearance="icon" onclick="helpSSH()" title="如何获取 SSH 密钥？"><span class="codicon codicon-question"></span></vscode-button>';
            html += '</div></div>';

            html += '<div class="form-row' + showPass + '" id="passInput"><label class="form-label">密码</label><vscode-text-field id="password" type="password" value="' + (config.password || '') + '" oninput="saveState(this)"></vscode-text-field></div>';
            html += '<div class="form-row"><label class="form-label">远程路径</label><vscode-text-field id="remotePath" value="' + (config.remotePath || '/opt/apps') + '" oninput="saveState(this)"></vscode-text-field></div>';
            html += '<div class="form-row" style="margin-top:8px;">';
            html += '<vscode-checkbox id="incrementalUpload" checked onchange="saveCheckbox(this)">增量上传 (仅上传有变化的文件)</vscode-checkbox>';
            html += '</div>';
html += '</div>';
            html += '</vscode-panel-view>';
            html += '</vscode-panels>';

            html += '<vscode-divider style="margin: 16px 0"></vscode-divider>';

            html += '<div class="section"><div class="section-title">⚙️ 选项</div>';

            html += '<div class="form-row">';
            html += '<vscode-checkbox id="cleanDestination" onchange="saveOptions()">清空输出目录 (Clean Output)</vscode-checkbox>';
            html += '</div>';

            html += '<div class="segmented-control">';
            html += '<div class="segment-btn' + (mode === 'simple' ? ' active' : '') + '" id="seg-simple" onclick="toggleMode(\\'simple\\')">简易发布</div>';
            html += '<div class="segment-btn' + (mode === 'advanced' ? ' active' : '') + '" id="seg-advanced" onclick="toggleMode(\\'advanced\\')">自定义发布</div>';
            html += '</div>';

            // Simple Mode View
            html += '<div id="view-simple" class="' + (mode === 'simple' ? '' : 'hidden') + '">';
            html += '<vscode-radio-group id="simpleMode" orientation="vertical" onchange="updateSimpleMode()" style="flex-direction: column; align-items: flex-start;">';
            html += '<vscode-radio value="standard" style="margin-bottom: 8px;">常规发布 (Standard)</vscode-radio>';
            html += '<vscode-radio value="singleFile" checked style="margin-bottom: 8px;">单文件 (Single File)</vscode-radio>';
            html += '<vscode-radio value="aot" style="margin-bottom: 8px;">Native AOT</vscode-radio>';
            html += '</vscode-radio-group>';
            html += '</div>';

            // Advanced Mode View
            html += '<div id="view-advanced" class="' + (mode === 'advanced' ? '' : 'hidden') + '" style="display:flex; flex-direction:column;">';
            html += '<vscode-checkbox id="selfContained"' + (config.selfContained !== false ? ' checked' : '') + ' onchange="saveCheckbox(this)">独立部署 (Self-Contained)</vscode-checkbox>';
            html += '<vscode-checkbox id="singleFile"' + (config.singleFile ? ' checked' : '') + ' onchange="saveCheckbox(this)">单文件 (Single File)</vscode-checkbox>';
            html += '<vscode-checkbox id="publishAot"' + (config.publishAot ? ' checked' : '') + ' onchange="saveCheckbox(this)">Native AOT 编译</vscode-checkbox>';
            html += '<vscode-checkbox id="disableSymbols" onchange="saveCheckbox(this)">禁用调试符号 (Disable Symbols)</vscode-checkbox>';
            html += '<vscode-checkbox id="stripSymbols"' + (config.stripSymbols ? ' checked' : '') + ' onchange="saveCheckbox(this)">剥离符号 (Strip Symbols)</vscode-checkbox>';
            html += '<vscode-checkbox id="invariantGlobalization"' + (config.invariantGlobalization ? ' checked' : '') + ' onchange="saveCheckbox(this)">无全球化依赖 (Invariant Globalization)</vscode-checkbox>';
            html += '</div>';

            html += '<div class="form-row"><vscode-dropdown id="runtime" style="width:100%" onchange="saveState(this)">';
            html += '<span slot="label" style="font-size:11px; font-weight:600; opacity:0.6; margin-bottom:4px; display:block">目标运行时</span>';
            const runtimes = ['linux-x64', 'linux-arm64', 'win-x64', 'win-x86', 'win-arm64', 'osx-x64', 'osx-arm64'];
            runtimes.forEach(r => {
                const selected = r === config.runtime ? ' selected' : '';
                html += '<vscode-option value="' + r + '"' + selected + '>' + r + '</vscode-option>';
            });
            html += '</vscode-dropdown></div>';

            html += '<div class="cmd-preview-container"><span class="cmd-preview-label">命令预览</span><div id="cmdPreview" class="cmd-preview">...</div></div>';
            html += '<vscode-button id="deployBtn" style="width:100%; margin-top:16px;">🚀 发布</vscode-button>';

            document.getElementById('content').innerHTML = html;
            document.getElementById('deployBtn').addEventListener('click', doDeploy);

            // Define functions early to ensure availability
            window.saveState = function(el) {
                let key = el.id;
                if (key === 'project') key = 'projectName';
                state[key] = el.value;
                vscode.setState(state);
                updateCommandPreview();
            };
            window.saveCheckbox = function(el) {
                state[el.id] = el.checked;
                vscode.setState(state);
                updateCommandPreview();
            };
            window.toggleAuth = function(type) {
                state['authType'] = type;
                vscode.setState(state);
                document.getElementById('keyInput').className = 'form-row' + (type === 'key' ? '' : ' hidden');
                document.getElementById('passInput').className = 'form-row' + (type === 'password' ? '' : ' hidden');
            };
            window.toggleTarget = function(target) {
                state['deployTarget'] = target;
                vscode.setState(state);

                // Update Progress Bar
                const progress = document.getElementById('progress');
                if (target === 'local') {
                    progress.classList.remove('visible');
                } else {
                    progress.classList.add('visible');
                }
            };
            window.updateSimpleMode = function() {
                try {
                    const el = document.getElementById('simpleMode');
                    if (!el) return;
                    const mode = el.value;
                    const setChecked = (id, val) => {
                        const el = document.getElementById(id);
                        if (el) el.checked = val;
                    };
                    if (mode === 'standard') {
                        setChecked('selfContained', false);
                        setChecked('singleFile', false);
                        setChecked('publishAot', false);
                    } else if (mode === 'singleFile') {
                        setChecked('selfContained', true);
                        setChecked('singleFile', true);
                        setChecked('publishAot', false);
                    } else if (mode === 'aot') {
                        setChecked('selfContained', true);
                        setChecked('singleFile', true);
                        setChecked('publishAot', true);
                    }
                    setChecked('disableSymbols', false);
                    setChecked('stripSymbols', false);
                    setChecked('invariantGlobalization', false);
                    updateCommandPreview();
                } catch (e) {
                    console.error(e);
                }
            };
            window.toggleMode = function(mode) {
                state['optionsMode'] = mode;
                vscode.setState(state);

                document.getElementById('seg-simple').className = 'segment-btn' + (mode === 'simple' ? ' active' : '');
                document.getElementById('seg-advanced').className = 'segment-btn' + (mode === 'advanced' ? ' active' : '');

                document.getElementById('view-simple').className = mode === 'simple' ? '' : 'hidden';
                const advView = document.getElementById('view-advanced');
                advView.className = mode === 'advanced' ? '' : 'hidden';

                // Restore flex for advanced view when visible
                if (mode === 'advanced') advView.style.display = 'flex';
                else advView.style.display = 'none';

                if (mode === 'simple') {
                    setTimeout(() => window.updateSimpleMode(), 0);
                } else {
                    updateCommandPreview();
                }
            };

            // Initial calls
            setTimeout(() => {
                window.toggleMode(mode);
                window.toggleTarget(deployTarget);
            }, 100);

        } catch (e) {
            document.getElementById('content').innerHTML = '<div class="msg error">Error rendering form: ' + e.message + '</div>';
        }
    }

    function updateCommandPreview() {
        try {
            const projectEl = document.getElementById('project');
            const project = projectEl ? (projectEl.value || 'Project.csproj') : 'Project.csproj';
            const runtimeEl = document.getElementById('runtime');
            const runtime = runtimeEl ? runtimeEl.value : 'linux-x64';

            const isChecked = (id) => {
                const el = document.getElementById(id);
                return el ? el.checked : false;
            };

            const cleanDestination = isChecked('cleanDestination');
            const selfContained = isChecked('selfContained');
            const singleFile = isChecked('singleFile');
            const disableSymbols = isChecked('disableSymbols');
            const publishAot = isChecked('publishAot');
            const stripSymbols = isChecked('stripSymbols');
            const invariantGlobalization = isChecked('invariantGlobalization');

            let cmd = 'dotnet publish ' + project + ' -c Release';
            cmd += ' -r ' + runtime;

            if (selfContained) {
                 cmd += ' --self-contained=true';
            }

            if (singleFile) cmd += ' -p:PublishSingleFile=true';

            if (disableSymbols) {
                cmd += ' -p:DebugType=none -p:DebugSymbols=false';
            }

            if (publishAot) {
                cmd += ' -p:PublishAot=true -p:StripSymbols=true -p:IlcOptimizationPreference=Size';
            } else if (stripSymbols) {
                cmd += ' -p:StripSymbols=true';
            }

            if (invariantGlobalization) {
                cmd += ' -p:InvariantGlobalization=true';
            }

            const previewEl = document.getElementById('cmdPreview');
            if (previewEl) previewEl.textContent = cmd;
        } catch (e) {
            console.error(e);
        }
    }

    function doDeploy() {
        const project = document.getElementById('project').value;
        // Use activeid from the panels component to determine target
        const deployTarget = document.querySelector('vscode-panels[aria-label="Deploy Target"]').activeid.replace('tab-', '');

        if (!project) { showMsg('error', '请选择一个项目'); return; }

        if (deployTarget === 'server') {
            const host = document.getElementById('host').value;
            if (!host) { showMsg('error', '请输入服务器地址'); return; }
        }

        const btn = document.getElementById('deployBtn');
        btn.setAttribute('disabled', '');
        btn.textContent = '发布中...';

        if (deployTarget === 'server') {
            document.getElementById('progress').classList.add('visible');
        }

        resetSteps();
        hideMsg();

        const authType = document.getElementById('authType').value;

        const isChecked = (id) => {
            const el = document.getElementById(id);
            return el ? el.checked : false;
        };

        vscode.postMessage({
            command: 'deploy',
            deployTarget: deployTarget,
            projectName: project,
            host: document.getElementById('host').value,
            port: parseInt(document.getElementById('port').value) || 22,
            username: document.getElementById('username').value || 'root',
            authType: authType,
            privateKeyPath: document.getElementById('keyPath').value,
            password: document.getElementById('password').value,
            remotePath: document.getElementById('remotePath').value,
            localPath: document.getElementById('localPath').value,
            runtime: document.getElementById('runtime').value,
            selfContained: isChecked('selfContained'),
            singleFile: isChecked('singleFile'),
            disableSymbols: isChecked('disableSymbols'),
            publishAot: isChecked('publishAot'),
            stripSymbols: isChecked('stripSymbols'),
            invariantGlobalization: isChecked('invariantGlobalization'),
            incrementalUpload: isChecked('incrementalUpload')
        });
    }

    function updateStep(phase) {
        const map = { 'publish': 1, 'upload': 2, 'start': 3 };
        const idx = map[phase];
        if (!idx) return;

        for (let i = 1; i <= 3; i++) {
            const el = document.getElementById('s' + i);
            if (i < idx) el.className = 'progress-step done';
            else if (i === idx) el.className = 'progress-step active';
            else el.className = 'progress-step';
        }
    }

    function completeAllSteps() {
        for (let i = 1; i <= 3; i++) {
            document.getElementById('s' + i).className = 'progress-step done';
        }
    }

    function resetSteps() {
        for (let i = 1; i <= 3; i++) {
            document.getElementById('s' + i).className = 'progress-step';
        }
    }

    function showMsg(type, html) {
        const container = document.getElementById('msgContainer');
        // Clear previous messages
        container.innerHTML = '';

        // Use VS Code Badge for simple status or just text for complex HTML
        const div = document.createElement('div');
        div.style.marginTop = '12px';
        div.style.padding = '8px';
        div.style.borderRadius = '4px';
        div.style.fontSize = '12px';

        if (type === 'error') {
            div.style.backgroundColor = 'var(--vscode-inputValidation-errorBackground)';
            div.style.border = '1px solid var(--vscode-inputValidation-errorBorder)';
        } else {
             div.style.backgroundColor = 'var(--vscode-inputValidation-infoBackground)';
             div.style.border = '1px solid var(--vscode-inputValidation-infoBorder)';
        }

        div.innerHTML = html;
        container.appendChild(div);
    }

    function hideMsg() {
        document.getElementById('msgContainer').innerHTML = '';
    }

    window.openFolder = function(path) {
        vscode.postMessage({ command: 'openFolder', path: path });
    };

    window.helpSSH = function() {
        vscode.postMessage({ command: 'helpSSH' });
    };

    // Signal ready
    vscode.postMessage({ command: 'ready' });
})();
</script>
</body>
</html>`;
    }
}
