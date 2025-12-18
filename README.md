# VSCode Dotnet Deploy

一键部署 .NET 应用到 Ubuntu/Linux 服务器的 VSCode 插件。

## 功能

- 🔍 自动扫描解决方案中的可执行项目
- 📦 可配置的发布选项（self-contained、single-file、debug symbols）
- 🚀 支持 SSH 密钥或密码认证连接服务器
- 📤 SFTP 上传发布产物
- ▶️ 远程执行 systemd 启动命令
- 🔧 **Native AOT 交叉编译** (macOS → Linux/Windows)

## Native AOT 交叉编译

插件支持从 macOS 交叉编译 Native AOT 应用到 Linux 和 Windows，无需安装 NuGet 包。

### 功能特点
- 🐧 **Linux 目标**: 自动使用 Zig 作为链接器
- 🪟 **Windows 目标**: 自动使用 LLD 链接器和 Windows SDK
- 🛠️ **工具链管理**: 提供可视化安装向导和一键安装功能
- 📦 **零配置**: 自动检测并配置所有必要的 MSBuild 参数

### 快速开始
1. 打开侧边栏的 Dotnet Deploy
2. 勾选 **Native AOT 编译**
3. 选择目标运行时 (如 `linux-x64` 或 `win-x64`)
4. 如果缺少工具链，会显示"配置向导"按钮
5. 点击按钮按照指引安装所需工具 (Zig, LLD, xwin 等)

更多详细信息请参阅 [交叉编译配置指南](CROSS_COMPILE_SETUP.md)。

## 安装

```bash
cd tools/vscode-dotnet-deploy
npm install
npm run compile
```

安装到 VSCode：
```bash
# 方式 1: 打包安装
npm install -g vsce
vsce package
# 然后在 VSCode 中：Extensions → Install from VSIX

# 方式 2: 开发模式
# 在 VSCode 中按 F5 启动调试
```

## 配置

在 VSCode settings.json 中添加：

```json
{
  "dotnetDeploy.server.host": "your-server-ip",
  "dotnetDeploy.server.port": 22,
  "dotnetDeploy.server.username": "root",
  "dotnetDeploy.server.privateKeyPath": "~/.ssh/id_rsa",
  "dotnetDeploy.deploy.remotePath": "/opt/apps"
}
```

## 使用

48. 打开包含 `.sln` 文件的工作区
49. 点击左侧边栏的 Dotnet Deploy 图标
50. 在下拉列表中选择要部署的项目
51. 填写服务器配置（Host, Username, Key Path 等）
52. 配置发布选项（Runtime, Self-contained 等）
53. 点击 "🚀 Deploy Now" 按钮
54. 观察下方的部署进度条

## 发布选项

| 选项 | 说明 |
|------|------|
| Self-contained | 包含 .NET 运行时，不需要服务器安装 .NET |
| Single file | 打包成单个可执行文件 |
| Debug symbols | 包含 .pdb 调试符号文件 |

## 工作流程

```
┌─────────────────┐
│  1. 选择项目     │
└────────┬────────┘
         ▼
┌─────────────────┐
│  2. dotnet pub  │ 本地发布
└────────┬────────┘
         ▼
┌─────────────────┐
│  3. SFTP 上传   │ 上传到服务器
└────────┬────────┘
         ▼
┌─────────────────┐
│  4. sudo start  │ 启动服务
└─────────────────┘
```

## 要求

- 服务器需要 SSH 密钥认证
- 项目需要集成 systemd（支持 `./程序名 start` 命令）
- 本地需要安装 .NET SDK

## License

MIT
