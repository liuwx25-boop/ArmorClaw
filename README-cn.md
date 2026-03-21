<div align="center">

<!-- TODO: 替换为实际 Logo 图片路径 -->
<!-- <img src="docs/images/logo.png" alt="ArmorClaw Logo" width="120" /> -->

# ArmorClaw

**🛡️ 基于 OpenClaw 的 AI 个人助理桌面客户端 —— 一键管理你的本地 AI 网关**

[![GitHub Stars](https://img.shields.io/github/stars/liuwx25-boop/ArmorClaw?style=social)](https://github.com/liuwx25-boop/ArmorClaw)
[![License](https://img.shields.io/badge/license-AGPL--3.0-blue.svg)](LICENSE)
[![Platform](https://img.shields.io/badge/platform-macOS%20%7C%20Windows%20%7C%20Linux-lightgrey.svg)](#-支持平台)
[![Discord](https://img.shields.io/badge/Discord-社区-5865F2?logo=discord&logoColor=white)](https://discord.gg/GgqyQWPe6K)
[![Telegram](https://img.shields.io/badge/Telegram-频道-blue?logo=telegram)](https://t.me/ArmorClaw_AI)

[English](./README.md) | **中文**

</div>

---

ArmorClaw 是一款开源、跨平台的桌面应用程序，为 [OpenClaw](https://github.com/openclaw/openclaw) AI 智能体提供图形化管理界面。它通过 Docker 容器在本地运行 OpenClaw，让你轻松管理 AI 模型、IM 频道、技能插件和对话 —— 实现**本地化 AI 能力，数据完全自主可控**。

> 🔒 **核心价值**：OpenClaw 的第三方 Skill 插件可以读取你的 API Key、访问你的文件系统。ArmorClaw 通过**容器沙箱 + 代理注入**架构，让恶意插件无法窃取密钥、无法破坏宿主机。[了解安全架构 →](#️-安全架构)

## 📸 产品截图

<!-- TODO: 替换为实际截图路径 -->

| 主界面 | AI 模型管理 | IM 通道管理 |
|:------:|:----------:|:----------:|
| ![主界面](docs/images/screenshot-home.png) | ![AI模型管理](docs/images/screenshot-ai-models.png) | ![IM通道管理](docs/images/screenshot-im-channels.png) |

| Skill 管理 | 容器终端 | 资源监控 |
|:----------:|:-------:|:-------:|
| ![Skill管理](docs/images/screenshot-skills.png) | ![容器终端](docs/images/screenshot-terminal.png) | ![资源监控](docs/images/screenshot-monitor.png) |

## ✨ 核心特性

- **🖥️ 跨平台支持**：macOS (Intel / Apple Silicon)、Windows (x64)、Linux (x64)
- **🐳 Docker 自动化**：自动检测并引导安装 Docker 运行时 (Colima / Docker Desktop / WSL2)
- **🤖 多模型支持**：支持火山引擎、智谱、阿里云百炼、腾讯云、Kimi、DeepSeek 等多种模型
- **🔑 双密钥管理**：平台密钥 (按量计费) 和 BYOK (自带密钥) 两种模式
- **💬 多渠道 IM 集成**：通过 OpenClaw 连接 WhatsApp、Telegram、Slack、Discord、企业微信、飞书等 20+ 即时通讯渠道
- **🧩 技能管理**：一键安装/管理 AI 技能插件，扩展 AI 能力
- **📟 内嵌终端**：在客户端内直接访问 OpenClaw 容器终端
- **📊 资源监控**：实时监控容器 CPU、内存、磁盘和进程使用情况
- **🌐 本地代理**：内置代理服务器，安全转发 AI 请求 —— 数据不经过任何第三方

## 🛡️ 安全架构

ArmorClaw 的核心使命是解决 OpenClaw 开放式 Skill 生态引入的安全风险。OpenClaw 允许安装第三方 Skill 插件来扩展功能，但这些插件与应用在同一进程中运行，拥有相同权限，带来两大威胁：

1. **API Key 泄露**：恶意 Skill 可以直接读取配置文件中明文存储的 API Key，将其窃取后用于转卖或非授权使用
2. **宿主机入侵**：恶意 Skill 可以访问宿主机文件系统，执行破坏性操作或发起资源耗尽攻击

ArmorClaw 采用 **容器沙箱 + 代理注入** 双核心架构，构建多层纵深防御体系：

```
┌──────────────────────────────────────────────────┐
│ ArmorClaw 客户端 (宿主机)                          │
│                                                  │
│  ┌──────────────────────────────────────────┐    │
│  │ 加密密钥存储 (OS Keychain/DPAPI/         │    │
│  │ libsecret) —— 真实 API Key 存储于此，     │    │
│  │ 永不进入容器                              │    │
│  └──────────────────────────────────────────┘    │
│                                                  │
│  ┌──────────────────────────────────────────┐    │
│  │ 本地代理服务 (:19090)                     │    │
│  │ 拦截 → 解密注入 Key → 转发               │    │
│  └──────────────────────────────────────────┘    │
│                                                  │
│  ─ ─ ─ ─ ─ ─ Docker 隔离层 ─ ─ ─ ─ ─ ─ ─ ─     │
│                                                  │
│  ┌──────────────────────────────────────────┐    │
│  │ OpenClaw 容器 (沙箱)                      │    │
│  │ • apiKey = "byok-placeholder"            │    │
│  │ • 恶意 Skill 只能读到占位符               │    │
│  │ • 无法访问宿主机文件系统                    │    │
│  │ • 权限严格限制                             │    │
│  └──────────────────────────────────────────┘    │
└──────────────────────────────────────────────────┘
```

### 🔐 防御层 1：API Key 安全 (代理注入)

OpenClaw 原生将 API Key 以明文存储在配置文件中，恶意 Skill 可以直接读取并窃取。ArmorClaw 采用 **"密钥永不进入容器，由宿主机代理注入"** 策略解决这一问题：

| 防御层 | 机制 | 效果 |
|--------|------|------|
| **加密存储** | 使用 OS 原生密钥服务 (macOS Keychain / Windows DPAPI / Linux libsecret) | 即使磁盘被入侵，密钥仍保持加密 |
| **配置分离** | 敏感密钥与非敏感配置（厂商名、模型名等）分开存储 | 缩小暴露面 |
| **占位符替换** | 容器内配置文件 apiKey 字段使用 `byok-placeholder` | 恶意 Skill 只能读到无意义的占位符 |
| **代理注入** | 本地代理拦截容器的 AI 请求，动态解密并注入真实密钥后转发 | 密钥永不进入容器 |
| **界面脱敏** | UI 中显示的密钥自动脱敏 (`sk-****xxxx`) | 防止偷窥和截图泄露 |

**请求流程**：容器发起 AI 请求 → 携带占位符密钥到宿主机代理 → 代理解密并注入真实密钥 → 转发至 AI 厂商 API

### 🏰 防御层 2：宿主机安全 (容器沙箱隔离)

当 OpenClaw 直接运行在宿主机上时，恶意 Skill 可以删除文件、窃取数据、发起网络攻击。ArmorClaw 通过 Docker 容器沙箱实现完全隔离：

| 防御层 | 配置 | 保护目标 |
|--------|------|----------|
| **非 root 运行** | 容器内以 `node` 非特权用户运行 | 即使存在内核漏洞，非 root 用户也无法利用大多数逃逸路径 |
| **能力控制** | `--cap-drop ALL` + `--cap-add NET_BIND_SERVICE` | 移除所有特权能力，仅保留端口绑定 |
| **防止提权** | `--security-opt no-new-privileges` | 阻止 setuid/setgid 提权，防止容器逃逸 |
| **资源限制** | CPU / 内存 / 进程数 / 文件描述符限制 | 防止 fork 炸弹、内存耗尽攻击 |
| **网络隔离** | Bridge 网络模式，仅暴露服务端口 | 无法扫描宿主机端口或访问本地服务 |
| **文件系统隔离** | 仅挂载 OpenClaw 数据目录 | 无法访问 `~/.armorclaw`、系统目录或用户文档 |
| **日志控制** | 日志大小和轮转限制 | 防止日志洪泛导致磁盘耗尽 |

### 🆚 安全对比

| 风险场景 | 原生 OpenClaw | ArmorClaw |
|----------|--------------|-----------|
| 恶意 Skill 读取 API Key | ❌ 明文可读，直接泄露 | ✅ 只能读到 `byok-placeholder` |
| 恶意 Skill 删除宿主机文件 | ❌ 与应用同权限，不受限制 | ✅ 容器隔离，无法访问宿主机 |
| 恶意 Skill 发起 fork 炸弹 | ❌ 直接耗尽系统资源 | ✅ 进程数限制，攻击无效 |
| 恶意 Skill 扫描内网 | ❌ 可扫描所有端口 | ✅ Bridge 网络隔离 |
| 恶意 Skill 提权到 root | ❌ 可能利用漏洞提权 | ✅ `no-new-privileges` 阻止提权 |
| 内核漏洞容器逃逸 | ❌ 以 root 运行，攻击面大 | ✅ 以 `node` 用户运行 + 移除所有能力，大幅缩小攻击面 |
| API Key 被截图泄露 | ❌ 完整密钥在 UI 中显示 | ✅ 界面脱敏显示 `sk-****xxxx` |

## 📥 下载安装

### 方式一：官网下载（推荐）

<!-- TODO: 替换为实际官网地址 -->

前往 **[ArmorClaw 官网](https://armorclaw.ai)** 下载对应平台的安装包，双击即可使用：

| 平台 | 架构 | 下载 |
|------|------|------|
| macOS | Apple Silicon (M1/M2/M3/M4) | [下载 DMG](https://armorclaw.ai/download?platform=mac&arch=arm64) |
| macOS | Intel | [下载 DMG](https://armorclaw.ai/download?platform=mac&arch=x64) |
| Windows | x64 | [下载安装包](https://armorclaw.ai/download?platform=win&arch=x64) |
| Linux | x64 | [下载 AppImage](https://armorclaw.ai/download?platform=linux&arch=x64) |

### 方式二：从源码构建

详见下方 [开发指南](#-开发指南)。

## 🖼️ 功能模块

| 模块 | 说明 |
|------|------|
| **环境配置向导** | 首次启动自动检测系统环境，引导安装 Docker |
| **AI 模型管理** | 配置平台密钥 / BYOK，管理套餐额度和用量 |
| **IM 频道管理** | 添加和管理 OpenClaw IM 消息频道 |
| **对话管理** | 查看和管理 AI 聊天记录 |
| **技能管理** | 浏览、安装和卸载 AI 技能插件 |
| **容器终端** | 内嵌终端，直接访问 OpenClaw 容器 |
| **资源监控** | 实时监控容器资源使用情况 |
| **文件管理** | 浏览和管理容器内的文件 |

## 🔌 支持的 AI 厂商

| 服务商 | 状态 |
|-------|------|
| 火山引擎（豆包） | ✅ 已支持 |
| 智谱 AI | ✅ 已支持 |
| 阿里云百炼 | ✅ 已支持 |
| 腾讯云 | ✅ 已支持 |
| Kimi (月之暗面) | ✅ 已支持 |
| Minimax | ✅ 已支持 |
| DeepSeek | ✅ 已支持 |
| *更多厂商* | 🚧 持续接入中 |

## 📋 支持的平台

| 平台 | 架构 | 安装包格式 | Docker 方案 |
|------|------|-----------|-------------|
| macOS | x64 / arm64 | DMG | Colima 或 Docker Desktop |
| Windows | x64 | NSIS 安装程序 | WSL2 Docker 或 Docker Desktop |
| Linux | x64 | AppImage / DEB | 原生 Docker |

## 🗺️ Roadmap

- [x] 跨平台桌面客户端（macOS / Windows / Linux）
- [x] 容器沙箱 + 代理注入安全架构
- [x] 多 AI 服务商接入（火山引擎、智谱、百炼、DeepSeek 等）
- [x] 20+ IM 通道集成
- [ ] 官网下载 & 自动更新
- [ ] Skill 插件市场
- [ ] Web 版管理界面
- [ ] 一键部署到云服务器
- [ ] 更多 AI 服务商（OpenAI、Claude、Gemini 等）

---

## 🔧 开发指南

<details>
<summary><b>📦 项目结构</b></summary>

```
ArmorClaw-Client/
├── client/                   # Electron 桌面客户端
│   ├── electron/             #   主进程 (Docker 管理、代理服务、IPC)
│   ├── src/                  #   渲染进程 (React 前端 UI)
│   ├── resources/            #   应用资源 (图标、品牌配置)
│   └── SoftwarePackage/      #   打包输出 & 脚本
├── openclaw/                 #   OpenClaw 开源项目, 版本: 2026年3月12日
└── image-builder/            #   Docker 镜像构建工具
    ├── general/              #   通用配置 & 依赖清单
    └── github-builder/       #   Docker 镜像构建脚本 & Dockerfile
```

</details>

<details>
<summary><b>🛠️ 技术栈</b></summary>

| 类别 | 技术 |
|------|------|
| 桌面框架 | Electron 28 |
| 前端框架 | React 18 + TypeScript 5 |
| 构建工具 | Vite 5 |
| CSS 框架 | Tailwind CSS 3 |
| 状态管理 | Zustand 4 |
| 终端模拟 | xterm.js + node-pty |
| 容器技术 | Docker (Colima / Docker Desktop / WSL2) |
| 打包工具 | electron-builder |

</details>

### 环境要求

- **Node.js** >= 18
- **npm** 或 **pnpm**
- **Docker** (客户端首次启动时会自动引导安装)

### 开发模式

```bash
cd client
npm install
npm run dev
```

### 构建客户端

```bash
cd client

# 构建当前平台
npm run build

# 构建指定平台
npm run build:mac       # macOS
npm run build:win       # Windows
npm run build:linux     # Linux
```

### 打包安装程序

```bash
cd client/SoftwarePackage

# 当前平台、当前架构
./install_package.sh

# macOS 全架构 (x64 + arm64)
./install_package.sh mac all

# 全平台、全架构 (正式发布)
./install_package.sh all all
```

## 🐳 Docker 镜像构建

ArmorClaw 需要将 OpenClaw 构建为 Docker 镜像，以便在容器中运行 AI 网关。

```bash
cd image-builder/github-builder

# 构建完整版镜像 (预装所有 Skill 工具)
bash build.sh

# 构建轻量版镜像
bash build-lite.sh

# 构建并打包为 tar.gz (用于离线分发)
bash build-and-package.sh
```

### 镜像版本

| 镜像 | 说明 |
|------|------|
| `armorclaw:full` | 完整版，预装 bun、uv、himalaya 等 Skill CLI 工具 |
| `armorclaw:lite` | 轻量版，仅包含基础运行环境 |

支持 **amd64** 和 **arm64** 双架构。

## 📄 许可证

ArmorClaw Client 采用双许可模式：

- **开源许可**：[AGPL-3.0](LICENSE) — 个人使用、学术研究、开源项目免费使用。任何修改或衍生作品（包括 SaaS 部署）必须同样以 AGPL-3.0 开源。
- **商业许可**：如需闭源使用、商业集成或 SaaS 部署且不希望开源，请联系我们获取商业许可。

**OpenClaw**：[MIT 许可证](openclaw/LICENSE)

> 📧 商业授权咨询请通过 [Issues](https://github.com/liuwx25-boop/ArmorClaw/issues) 或 [Discord 服务器](https://discord.gg/GgqyQWPe6K) 联系我们。

## 🤝 参与贡献

欢迎通过 Issue 和 Pull Request 参与贡献！

1. Fork 本仓库
2. 创建特性分支：`git checkout -b feature/amazing-feature`
3. 提交更改：`git commit -m 'feat: add amazing feature'`
4. 推送分支：`git push origin feature/amazing-feature`
5. 提交 Pull Request

## 🌐 社区

[![Discord](https://img.shields.io/badge/Discord-服务器-5865F2?logo=discord&logoColor=white)](https://discord.gg/GgqyQWPe6K)
[![Telegram Channel](https://img.shields.io/badge/Telegram-频道-blue?logo=telegram)](https://t.me/ArmorClaw_AI)
[![Telegram Group](https://img.shields.io/badge/Telegram-群组-blue?logo=telegram)](https://t.me/ArmorClaw)

- 🎮 [Discord 服务器](https://discord.gg/GgqyQWPe6K) — 社区交流中心
- 📢 [Telegram 频道](https://t.me/ArmorClaw_AI) — 项目公告 & 版本更新
- 💬 [Telegram 群组](https://t.me/ArmorClaw) — 交流讨论 & 问题求助

## 📮 联系我们

如有问题或建议，请通过 [Issues](https://github.com/liuwx25-boop/ArmorClaw/issues) 反馈。
