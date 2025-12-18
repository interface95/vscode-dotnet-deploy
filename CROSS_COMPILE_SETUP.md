# 交叉编译环境配置指南

本文档介绍如何在 macOS 上配置交叉编译环境，以便使用 Native AOT 编译生成 Linux 和 Windows 可执行文件。

## 目录

- [概述](#概述)
- [Linux 目标配置](#linux-目标配置)
- [Windows 目标配置](#windows-目标配置)
- [前置依赖](#前置依赖)
- [故障排除](#故障排除)

---

## 概述

### 什么是交叉编译？

交叉编译是指在一个平台（如 macOS）上编译生成另一个平台（如 Linux 或 Windows）的可执行文件。

.NET Native AOT 编译需要目标平台的本机链接器才能生成最终的可执行文件。这意味着：
- 在 macOS 上编译 Linux 目标需要 Linux 兼容的链接器
- 在 macOS 上编译 Windows 目标需要 Windows PE/COFF 链接器

### 工具链要求

| 目标平台 | 所需工具 | 用途 |
|---------|---------|------|
| Linux | Zig | C 编译器和链接器 |
| Windows | LLD (lld-link) | PE/COFF 链接器 |
| Windows | xwin | Windows SDK 下载工具 |
| Windows | Windows SDK | CRT 和系统库 |
| (可选) | LLVM objcopy | 符号剥离 |

---

## Linux 目标配置

要从 macOS 交叉编译到 Linux，我们使用 **Zig** 作为 C 编译器和链接器。Zig 内置了完整的交叉编译支持，包含 Linux 系统的 libc。

### 步骤 1: 安装 Zig

使用 Homebrew 安装：

```bash
brew install zig
```

或者从官网下载：https://ziglang.org/download/

### 步骤 2: 验证安装

```bash
zig version
```

应该输出类似 `0.11.0` 或更高版本。

### 步骤 3: (可选) 安装 LLVM objcopy

用于符号剥离，可以减小可执行文件大小：

```bash
brew install llvm
```

安装后，需要将 LLVM 添加到 PATH：

```bash
# Apple Silicon Mac
export PATH="/opt/homebrew/opt/llvm/bin:$PATH"

# Intel Mac
export PATH="/usr/local/opt/llvm/bin:$PATH"
```

### 工作原理

插件会自动生成一个 Zig wrapper 脚本，将其作为 C 编译器传递给 .NET AOT 编译器。脚本会：
1. 过滤不兼容的链接器参数（如 `-pie`、`-fuse-ld=bfd`）
2. 设置正确的目标三元组（如 `x86_64-linux-gnu`）
3. 调用 Zig 进行编译和链接

---

## Windows 目标配置

从 macOS 交叉编译到 Windows 需要更多的设置，包括 LLD 链接器、xwin 工具和 Windows SDK。

### 步骤 1: 安装 LLD 链接器

LLD 是 LLVM 项目的链接器，支持 Windows PE/COFF 格式：

```bash
brew install lld
```

安装后，将 lld-link 添加到 PATH：

```bash
# Apple Silicon Mac
export PATH="/opt/homebrew/opt/lld/bin:$PATH"

# Intel Mac
export PATH="/usr/local/opt/lld/bin:$PATH"
```

验证安装：

```bash
lld-link --version
```

### 步骤 2: 安装 xwin

xwin 是一个用于下载和管理 Windows SDK 的工具，使用 Rust 编写：

```bash
# 首先确保已安装 Rust
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh

# 安装 xwin
cargo install --locked xwin
```

验证安装：

```bash
xwin --version
```

### 步骤 3: 下载 Windows SDK

使用 xwin 下载 Windows SDK 和 CRT 库（约 500MB）：

```bash
xwin splat --output ~/.local/share/xwin-sdk
```

这会下载并解压 Windows SDK 到指定目录。

### 步骤 4: 验证 SDK 安装

检查 SDK 是否正确安装：

```bash
ls ~/.local/share/xwin-sdk/splat/crt
```

应该看到 `lib` 目录和其他文件。

### 工作原理

插件会：
1. 使用 lld-link 作为链接器
2. 配置正确的库搜索路径指向 Windows SDK
3. 设置必要的链接器参数

---

## 前置依赖

### Homebrew

macOS 的包管理器，大部分工具都通过它安装：

```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
```

安装后，根据提示将 Homebrew 添加到 PATH。

官网：https://brew.sh/

### Rust (仅 Windows 目标需要)

xwin 是用 Rust 编写的，需要先安装 Rust 工具链：

```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
```

按照提示完成安装后，重新打开终端或运行：

```bash
source ~/.cargo/env
```

官网：https://rustup.rs/

### .NET SDK

如果尚未安装 .NET SDK：

```bash
brew install dotnet-sdk
```

或从官网下载：https://dotnet.microsoft.com/download

---

## 故障排除

### Zig 相关问题

#### "zig: command not found"

确保 Homebrew 的 bin 目录在 PATH 中：

```bash
# Apple Silicon
export PATH="/opt/homebrew/bin:$PATH"

# Intel Mac
export PATH="/usr/local/bin:$PATH"
```

#### 链接错误 "unrecognized option: -pie"

这通常由插件自动处理。如果仍然出现，请确保使用最新版本的插件。

### LLD 相关问题

#### "lld-link: command not found"

将 LLD 添加到 PATH：

```bash
# Apple Silicon
export PATH="/opt/homebrew/opt/lld/bin:$PATH"

# Intel Mac
export PATH="/usr/local/opt/lld/bin:$PATH"
```

### xwin 相关问题

#### "cargo: command not found"

确保 Rust 已正确安装并添加到 PATH：

```bash
source ~/.cargo/env
```

#### xwin 下载失败

检查网络连接。如果在中国大陆，可能需要使用代理：

```bash
export https_proxy=http://your-proxy:port
xwin splat --output ~/.local/share/xwin-sdk
```

### Windows SDK 相关问题

#### 找不到 SDK 路径

确保 SDK 已下载到正确位置。可以在插件设置中自定义路径：

```json
{
  "dotnetDeploy.crossCompile.xwinSdkPath": "~/.local/share/xwin-sdk"
}
```

### 常见编译错误

#### "error: unable to find library -lSystem"

这是 macOS 系统库错误，请确保：
1. 已安装 Xcode Command Line Tools: `xcode-select --install`
2. 使用正确的目标运行时

#### "error LNK2001: unresolved external symbol"

Windows 目标链接错误，请确保：
1. Windows SDK 已正确下载
2. SDK 路径配置正确

---

## 配置选项

在 VS Code 设置中可以自定义以下选项：

```json
{
  // 启用交叉编译
  "dotnetDeploy.crossCompile.enabled": true,

  // 自定义 Zig 路径
  "dotnetDeploy.crossCompile.zigPath": "",

  // Windows SDK 缓存路径
  "dotnetDeploy.crossCompile.xwinSdkPath": "~/.local/share/xwin-sdk",

  // 自动安装缺失工具
  "dotnetDeploy.crossCompile.autoInstallTools": false
}
```

---

## 参考资源

- [Zig 官方文档](https://ziglang.org/documentation/)
- [xwin GitHub](https://github.com/Jake-Shadle/xwin)
- [LLD - The LLVM Linker](https://lld.llvm.org/)
- [.NET Native AOT 文档](https://learn.microsoft.com/en-us/dotnet/core/deploying/native-aot/)
- [PublishAotCross 项目](https://github.com/AraHaan/PublishAotCross)

---

## 一键安装脚本

如果您希望手动运行一键安装，可以使用以下脚本：

### Linux 目标工具链

```bash
#!/bin/bash
# install-linux-toolchain.sh

echo "Installing Linux cross-compile toolchain..."

# Install Homebrew if not present
if ! command -v brew &> /dev/null; then
    /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
fi

# Install Zig
brew install zig

# Install LLVM (optional, for objcopy)
brew install llvm

echo "✓ Linux toolchain installed successfully!"
echo "Please restart your terminal or run: source ~/.zshrc"
```

### Windows 目标工具链

```bash
#!/bin/bash
# install-windows-toolchain.sh

echo "Installing Windows cross-compile toolchain..."

# Install Homebrew if not present
if ! command -v brew &> /dev/null; then
    /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
fi

# Install LLD
brew install lld

# Install Rust if not present
if ! command -v cargo &> /dev/null; then
    curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
    source ~/.cargo/env
fi

# Install xwin
cargo install --locked xwin

# Download Windows SDK
xwin splat --output ~/.local/share/xwin-sdk

echo "✓ Windows toolchain installed successfully!"
echo "Please add to your PATH:"
echo '  export PATH="/opt/homebrew/opt/lld/bin:$PATH"  # Apple Silicon'
echo '  export PATH="/usr/local/opt/lld/bin:$PATH"     # Intel Mac'
```

---

如有问题，请在 VS Code 中查看输出面板 (View > Output > .NET Deploy) 获取详细日志。
