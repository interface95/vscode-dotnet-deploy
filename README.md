# VSCode Dotnet Deploy

一键部署 .NET 应用到服务器或打包为桌面应用的 VSCode 插件。

## ✨ 功能特性

### 🚀 部署功能
- 🔍 自动扫描解决方案中的可执行项目
- 📦 可配置的发布选项（self-contained、single-file、debug symbols）
- 🚀 支持 SSH 密钥或密码认证连接服务器
- 📤 SFTP 上传发布产物
- ▶️ 远程执行 systemd 启动命令

### 🔧 Native AOT 交叉编译
- 🐧 **Linux 目标**: 自动使用 Zig 作为链接器
- 🪟 **Windows 目标**: 自动使用 LLD 链接器和 Windows SDK
- 🛠️ **工具链管理**: 提供可视化安装向导和一键安装功能
- 📦 **零配置**: 自动检测并配置所有必要的 MSBuild 参数

### 📦 UPX 压缩
- 🗜️ 支持 Linux 和 Windows 目标的可执行文件压缩
- 📊 可选压缩级别：`-1`、`-9`、`--best`、`--lzma`
- ⚠️ macOS 目标不支持（Mach-O 格式限制）

### 🍎 macOS 打包 (新功能)
- 📱 生成标准 `.app` 应用程序包
- 💿 生成 `.dmg` 磁盘镜像（可分发）
- 📦 生成 `.pkg` 安装包
- 🎨 自定义应用图标（支持 .png 或 .icns）
- 🔐 代码签名和 Apple 公证
- 🛡️ 完整的 Entitlements 配置：
  - App Sandbox
  - Hardened Runtime
  - 网络权限（客户端/服务器）
  - 文件系统权限
  - 硬件访问权限（摄像头、麦克风等）

### 📢 Telegram 通知
- 📲 部署完成后发送通知
- 📎 可选上传构建产物到 Telegram

## 📋 快速开始

### 1. 安装插件

```bash
# 从 VSIX 安装
# Extensions → Install from VSIX → 选择 .vsix 文件

# 或开发模式
git clone https://github.com/interface95/vscode-dotnet-deploy.git
cd vscode-dotnet-deploy
npm install
npm run compile
# 按 F5 启动调试
```

### 2. 基本使用

1. 打开包含 `.sln` 文件的工作区
2. 点击左侧边栏的 **Dotnet Deploy** 图标
3. 在下拉列表中选择要部署的项目
4. 选择部署模式：
   - **Deploy to Server**: 部署到远程服务器
   - **Local Publish**: 本地发布（可选 macOS 打包）

### 3. 部署到服务器

1. 填写服务器配置（Host, Username, Key Path）
2. 配置发布选项（Runtime, Self-contained 等）
3. 点击 **🚀 Deploy Now**
4. 观察进度条

### 4. Native AOT 交叉编译

1. 勾选 **Native AOT 编译**
2. 选择目标运行时（如 `linux-x64` 或 `win-x64`）
3. 如果缺少工具链，会显示 **配置向导** 按钮
4. 点击按钮安装所需工具（Zig, LLD, xwin 等）

详细配置请参阅 [交叉编译配置指南](CROSS_COMPILE_SETUP.md)

### 5. macOS 打包

1. 选择目标运行时为 `osx-x64` 或 `osx-arm64`
2. 勾选 **macOS 打包**
3. 点击 **⚙️ 配置** 按钮打开配置面板
4. 配置应用信息：
   - 应用名称、Bundle ID
   - 版本号
   - 应用图标
   - 打包格式（.app / .dmg / .pkg）
5. 可选配置代码签名和 Entitlements
6. 点击 **Local Publish**

## ⚙️ 配置说明

### 服务器配置

| 配置项 | 说明 | 默认值 |
|--------|------|--------|
| `server.host` | SSH 服务器主机名或 IP | - |
| `server.port` | SSH 端口 | `22` |
| `server.username` | SSH 用户名 | `root` |
| `server.privateKeyPath` | SSH 私钥路径 | `~/.ssh/id_rsa` |
| `deploy.remotePath` | 远程部署目录 | `/opt/apps` |
| `deploy.afterUploadCommand` | 上传后执行的命令 | `sudo {remote_path}/{app_name} start` |

### 发布选项

| 配置项 | 说明 | 默认值 |
|--------|------|--------|
| `publish.runtime` | 目标运行时 | `linux-x64` |
| `publish.selfContained` | 独立发布（包含运行时） | `true` |
| `publish.singleFile` | 发布为单文件 | `false` |
| `publish.aot` | Native AOT 编译 | `false` |
| `publish.trim` | 裁剪未使用代码 | `false` |
| `publish.debugSymbols` | 包含调试符号 | `false` |
| `publish.stripSymbols` | 剥离符号 | `false` |
| `publish.invariantGlobalization` | 无全球化依赖 | `false` |

### UPX 压缩

| 配置项 | 说明 | 默认值 |
|--------|------|--------|
| `upx.enabled` | 启用 UPX 压缩 | `false` |
| `upx.level` | 压缩级别 | `--best` |

> ⚠️ UPX 仅支持 Linux 和 Windows 目标，macOS Mach-O 格式不支持

### macOS 打包

| 配置项 | 说明 | 默认值 |
|--------|------|--------|
| `macos.enabled` | 启用 macOS 打包 | `false` |
| `macos.appName` | 应用名称 | - |
| `macos.bundleId` | Bundle Identifier | `com.example.app` |
| `macos.version` | 版本号 | `1.0.0` |
| `macos.format` | 打包格式 | `app` |
| `macos.iconPath` | 图标路径 | - |
| `macos.minimumOSVersion` | 最低 macOS 版本 | `10.15` |

### 交叉编译

| 配置项 | 说明 | 默认值 |
|--------|------|--------|
| `crossCompile.enabled` | 启用交叉编译 | `true` |
| `crossCompile.zigPath` | Zig 编译器路径 | 自动检测 |
| `crossCompile.xwinSdkPath` | Windows SDK 路径 | `~/.local/share/xwin-sdk` |

## 📁 工作流程

```
┌─────────────────────┐
│  1. 选择项目         │
└──────────┬──────────┘
           ▼
┌─────────────────────┐
│  2. dotnet publish  │  编译发布
└──────────┬──────────┘
           ▼
┌─────────────────────┐
│  3. UPX 压缩 (可选)  │  压缩可执行文件
└──────────┬──────────┘
           ▼
    ┌──────┴──────┐
    ▼             ▼
┌─────────┐  ┌─────────────┐
│ 服务器   │  │  本地打包    │
│ 部署模式 │  │  模式       │
└────┬────┘  └──────┬──────┘
     ▼              ▼
┌─────────┐  ┌─────────────┐
│ SFTP    │  │ macOS 打包   │
│ 上传    │  │ .app/.dmg   │
└────┬────┘  └──────┬──────┘
     ▼              ▼
┌─────────┐  ┌─────────────┐
│ 启动    │  │  完成       │
│ 服务    │  │             │
└─────────┘  └─────────────┘
```

## 🔧 系统要求

- **本地环境**
  - .NET SDK 8.0+
  - VSCode 1.85+
  - Node.js 18+

- **交叉编译** (可选)
  - Zig 0.11+（Linux 目标）
  - LLD + xwin（Windows 目标）

- **UPX 压缩** (可选)
  - `brew install upx`

- **服务器要求** (部署模式)
  - SSH 密钥认证
  - systemd（支持 `./程序名 start` 命令）

## 📝 更新日志

### v0.1.62
- ✨ 新增 macOS 打包功能（.app/.dmg/.pkg）
- ✨ 新增 Entitlements 配置面板
- ✨ 新增本地发布进度显示（编译/压缩/打包）
- 🐛 修复 UPX 参数未传递的问题
- 🐛 修复 macOS 打包时循环复制的问题
- 🐛 修复 DMG/PKG 生成后临时 .app 未清理的问题

### v0.1.50
- ✨ 新增 Native AOT 交叉编译支持
- ✨ 新增工具链安装向导
- ✨ 新增 UPX 压缩支持

### v0.1.0
- 🎉 初始版本
- 基本的 SSH 部署功能

## 📄 License

MIT

## 🤝 贡献

欢迎提交 Issue 和 Pull Request！

[GitHub Repository](https://github.com/interface95/vscode-dotnet-deploy)
