<div align="center">

<!-- TODO: Replace with actual logo image path -->
<!-- <img src="docs/images/logo.png" alt="ArmorClaw Logo" width="120" /> -->

# ArmorClaw

**🛡️ An AI personal assistant desktop client based on OpenClaw — manage your local AI gateway with one click**

[![GitHub Stars](https://img.shields.io/github/stars/liuwx25-boop/ArmorClaw?style=social)](https://github.com/liuwx25-boop/ArmorClaw)
[![License](https://img.shields.io/badge/license-AGPL--3.0-blue.svg)](LICENSE)
[![Platform](https://img.shields.io/badge/platform-macOS%20%7C%20Windows%20%7C%20Linux-lightgrey.svg)](#-supported-platforms)
[![Discord](https://img.shields.io/badge/Discord-Server-5865F2?logo=discord&logoColor=white)](https://discord.gg/GgqyQWPe6K)
[![Telegram](https://img.shields.io/badge/Telegram-Channel-blue?logo=telegram)](https://t.me/ArmorClaw_AI)

**English** | [中文](./README-cn.md)

</div>

---

ArmorClaw is an open-source, cross-platform desktop application that provides a graphical management interface for the [OpenClaw](https://github.com/openclaw/openclaw) AI agent. It runs OpenClaw locally via Docker containers, allowing you to easily manage AI models, IM channels, skill plugins, and conversations — achieving **localized AI capabilities with full data sovereignty**.

> 🔒 **Core Value**: OpenClaw's third-party Skill plugins can read your API Keys and access your filesystem. ArmorClaw's **Container Sandbox + Proxy Injection** architecture ensures malicious plugins cannot steal keys or compromise your host machine. [Learn about the security architecture →](#️-security-architecture)

## 📸 Screenshots

<!-- TODO: Replace with actual screenshot paths -->

| Home | AI Model Management | IM Channels |
|:----:|:-------------------:|:-----------:|
| ![Home](docs/images/screenshot-home.png) | ![AI Models](docs/images/screenshot-ai-models.png) | ![IM Channels](docs/images/screenshot-im-channels.png) |

| Skill Management | Container Terminal | Resource Monitor |
|:----------------:|:-----------------:|:----------------:|
| ![Skills](docs/images/screenshot-skills.png) | ![Terminal](docs/images/screenshot-terminal.png) | ![Monitor](docs/images/screenshot-monitor.png) |

## ✨ Key Features

- **🖥️ Cross-Platform**: macOS (Intel / Apple Silicon), Windows (x64), Linux (x64)
- **🐳 Docker Automation**: Auto-detects and guides Docker runtime installation (Colima / Docker Desktop / WSL2)
- **🤖 Multi-Model Support**: Supports Volcengine, Zhipu, Alibaba Cloud Bailian, Tencent Cloud, Kimi, DeepSeek, and more
- **🔑 Dual Key Management**: Platform Key (token-based plans) and BYOK (Bring Your Own Key) modes
- **💬 Multi-Channel IM Integration**: Connect WhatsApp, Telegram, Slack, Discord, WeCom, Lark, and 20+ messaging channels via OpenClaw
- **🧩 Skill Management**: One-click install/manage AI skill plugins to extend capabilities
- **📟 Embedded Terminal**: Access the OpenClaw container terminal directly within the client
- **📊 Resource Monitoring**: Real-time container CPU, memory, disk, and process usage
- **🌐 Local Proxy**: Built-in proxy server for secure AI request forwarding — data never touches third parties

## 🛡️ Security Architecture

ArmorClaw's core mission is to address the security risks introduced by OpenClaw's open Skill ecosystem. OpenClaw allows installing third-party Skill plugins to extend functionality, but these plugins run within the application process with the same privileges, posing two major threats:

1. **API Key Leakage**: Malicious Skills can read plaintext API Keys stored in config files, stealing them for resale or unauthorized usage
2. **Host Compromise**: Malicious Skills can access the host filesystem, perform destructive operations, or launch resource exhaustion attacks

ArmorClaw implements a **Container Sandbox + Proxy Injection** dual-core architecture to build a multi-layered defense-in-depth system:

```
┌──────────────────────────────────────────────────┐
│ ArmorClaw Client (Host Machine)                  │
│                                                  │
│  ┌──────────────────────────────────────────┐    │
│  │ Encrypted Key Store (OS Keychain/DPAPI/  │    │
│  │ libsecret) — Real API Keys stored here,  │    │
│  │ never enter the container                │    │
│  └──────────────────────────────────────────┘    │
│                                                  │
│  ┌──────────────────────────────────────────┐    │
│  │ Local Proxy Service (:19090)             │    │
│  │ Intercept → Decrypt & Inject Key → Fwd  │    │
│  └──────────────────────────────────────────┘    │
│                                                  │
│  ─ ─ ─ ─ ─ ─ Docker Isolation ─ ─ ─ ─ ─ ─ ─    │
│                                                  │
│  ┌──────────────────────────────────────────┐    │
│  │ OpenClaw Container (Sandbox)             │    │
│  │ • apiKey = "byok-placeholder"            │    │
│  │ • Malicious Skills only see placeholder  │    │
│  │ • No access to host filesystem           │    │
│  │ • Privileges strictly limited            │    │
│  └──────────────────────────────────────────┘    │
└──────────────────────────────────────────────────┘
```

### 🔐 Defense Layer 1: API Key Security (Proxy Injection)

OpenClaw natively stores API Keys in plaintext config files, which malicious Skills can directly read and exfiltrate. ArmorClaw solves this with a **"Keys never enter the container; injected by host proxy"** strategy:

| Defense Layer | Mechanism | Effect |
|--------------|-----------|--------|
| **Encrypted Storage** | Uses OS-native key services (macOS Keychain / Windows DPAPI / Linux libsecret) | Keys remain encrypted even if disk is compromised |
| **Config Separation** | Sensitive keys stored separately from non-sensitive configs (vendor names, model names, etc.) | Reduced exposure surface |
| **Placeholder Substitution** | Container config files use `byok-placeholder` for apiKey fields | Malicious Skills only read meaningless placeholders |
| **Proxy Injection** | Local proxy intercepts container AI requests, dynamically decrypts and injects real keys before forwarding | Keys never enter the container |
| **UI Masking** | Keys displayed in UI are automatically masked (`sk-****xxxx`) | Prevents shoulder-surfing and screenshot leakage |

**Request Flow**: Container sends AI request → Carries placeholder key to host proxy → Proxy decrypts and injects real key → Forwards to AI vendor API

### 🏰 Defense Layer 2: Host Security (Container Sandbox Isolation)

When OpenClaw runs directly on the host, malicious Skills can delete files, steal data, and launch network attacks. ArmorClaw fully isolates it through Docker container sandboxing:

| Defense Layer | Configuration | Protection Target |
|--------------|---------------|-------------------|
| **Non-Root Execution** | Runs as `node` unprivileged user inside container | Even with kernel vulnerabilities, non-root users cannot exploit most escape paths |
| **Capability Control** | `--cap-drop ALL` + `--cap-add NET_BIND_SERVICE` | All privileged capabilities removed, only port binding retained |
| **Privilege Escalation Prevention** | `--security-opt no-new-privileges` | Blocks setuid/setgid escalation, prevents container escape |
| **Resource Limits** | CPU / memory / process count / file descriptor limits | Prevents fork bombs, memory exhaustion attacks |
| **Network Isolation** | Bridge network mode, only service ports exposed | Cannot scan host ports or access local services |
| **Filesystem Isolation** | Only OpenClaw data directory mounted | Cannot access `~/.armorclaw`, system directories, or user documents |
| **Log Control** | Log size and rotation limits | Prevents disk exhaustion via log flooding |

### 🆚 Security Comparison

| Risk Scenario | Native OpenClaw | ArmorClaw |
|--------------|----------------|-----------|
| Malicious Skill reads API Key | ❌ Plaintext readable, direct leakage | ✅ Can only read `byok-placeholder` |
| Malicious Skill deletes host files | ❌ Same privileges as app, unrestricted | ✅ Container isolated, no host access |
| Malicious Skill launches fork bomb | ❌ Directly exhausts system resources | ✅ Process limit enforced, attack ineffective |
| Malicious Skill scans internal network | ❌ Can scan all ports | ✅ Bridge network isolation |
| Malicious Skill escalates to root | ❌ May exploit vulnerabilities | ✅ `no-new-privileges` blocks escalation |
| Kernel vulnerability container escape | ❌ Runs as root, large attack surface | ✅ Runs as `node` user + all capabilities dropped, greatly reduced attack surface |
| API Key leaked via screenshot | ❌ Full key displayed in UI | ✅ UI masking shows `sk-****xxxx` |

## 📥 Download & Install

### Option 1: Official Website (Recommended)

<!-- TODO: Replace with actual website URL -->

Visit **[ArmorClaw Website](https://armorclaw.ai)** to download the installer for your platform:

| Platform | Architecture | Download |
|----------|-------------|---------|
| macOS | Apple Silicon (M1/M2/M3/M4) | [Download DMG](https://armorclaw.ai/download?platform=mac&arch=arm64) |
| macOS | Intel | [Download DMG](https://armorclaw.ai/download?platform=mac&arch=x64) |
| Windows | x64 | [Download Installer](https://armorclaw.ai/download?platform=win&arch=x64) |
| Linux | x64 | [Download AppImage](https://armorclaw.ai/download?platform=linux&arch=x64) |

### Option 2: Build from Source

See [Development Guide](#-development-guide) below.

## 🖼️ Feature Modules

| Module | Description |
|--------|-------------|
| **Environment Setup Guide** | Auto-detects system environment on first launch, guides Docker installation |
| **AI Model Management** | Configure Platform Key / BYOK, manage token plans and usage |
| **IM Channel Management** | Add and manage OpenClaw IM messaging channels |
| **Conversation Management** | View and manage AI chat history |
| **Skill Management** | Browse, install, and uninstall AI skill plugins |
| **Container Terminal** | Embedded terminal for direct OpenClaw container access |
| **Resource Monitoring** | Real-time container resource usage |
| **File Management** | Browse and manage files inside the container |

## 🔌 Supported AI Providers

| Provider | Status |
|----------|--------|
| Volcengine (Doubao) | ✅ Supported |
| Zhipu AI | ✅ Supported |
| Alibaba Cloud Bailian | ✅ Supported |
| Tencent Cloud | ✅ Supported |
| Kimi (Moonshot) | ✅ Supported |
| Minimax | ✅ Supported |
| DeepSeek | ✅ Supported |
| *More providers* | 🚧 Coming soon |

## 📋 Supported Platforms

| Platform | Architecture | Package Format | Docker Solution |
|----------|-------------|---------------|----------------|
| macOS | x64 / arm64 | DMG | Colima or Docker Desktop |
| Windows | x64 | NSIS Installer | WSL2 Docker or Docker Desktop |
| Linux | x64 | AppImage / DEB | Native Docker |

## 🗺️ Roadmap

- [x] Cross-platform desktop client (macOS / Windows / Linux)
- [x] Container Sandbox + Proxy Injection security architecture
- [x] Multi AI provider support (Volcengine, Zhipu, Bailian, DeepSeek, etc.)
- [x] 20+ IM channel integrations
- [ ] Official website downloads & auto-update
- [ ] Skill plugin marketplace
- [ ] Web-based management UI
- [ ] One-click cloud deployment
- [ ] More AI providers (OpenAI, Claude, Gemini, etc.)

---

## 🔧 Development Guide

<details>
<summary><b>📦 Project Structure</b></summary>

```
ArmorClaw-Client/
├── client/                   # Electron desktop client
│   ├── electron/             #   Main process (Docker mgmt, proxy server, IPC)
│   ├── src/                  #   Renderer process (React frontend UI)
│   ├── resources/            #   App resources (icons, branding config)
│   └── SoftwarePackage/      #   Packaging output & scripts
├── openclaw/                 #   OpenClaw open-source project, version: Mar 12, 2026
└── image-builder/            #   Docker image build tools
    ├── general/              #   Common configs & dependency manifests
    └── github-builder/       #   Docker image build scripts & Dockerfile
```

</details>

<details>
<summary><b>🛠️ Tech Stack</b></summary>

| Category | Technology |
|----------|-----------|
| Desktop Framework | Electron 28 |
| Frontend Framework | React 18 + TypeScript 5 |
| Build Tool | Vite 5 |
| CSS Framework | Tailwind CSS 3 |
| State Management | Zustand 4 |
| Terminal Emulation | xterm.js + node-pty |
| Container Technology | Docker (Colima / Docker Desktop / WSL2) |
| Packaging Tool | electron-builder |

</details>

### Prerequisites

- **Node.js** >= 18
- **npm** or **pnpm**
- **Docker** (the client will auto-guide installation on first launch)

### Development Mode

```bash
cd client
npm install
npm run dev
```

### Build Client

```bash
cd client

# Build for current platform
npm run build

# Build for specific platform
npm run build:mac       # macOS
npm run build:win       # Windows
npm run build:linux     # Linux
```

### Package Installer

```bash
cd client/SoftwarePackage

# Current platform, current architecture
./install_package.sh

# macOS all architectures (x64 + arm64)
./install_package.sh mac all

# All platforms, all architectures (production release)
./install_package.sh all all
```

## 🐳 Docker Image Build

ArmorClaw needs to build OpenClaw into a Docker image to run the AI gateway in a container.

```bash
cd image-builder/github-builder

# Build full image (all Skill tools pre-installed)
bash build.sh

# Build lite image
bash build-lite.sh

# Build and package as tar.gz (for offline distribution)
bash build-and-package.sh
```

### Image Versions

| Image | Description |
|-------|-------------|
| `armorclaw:full` | Full version, pre-installed with bun, uv, himalaya and other Skill CLI tools |
| `armorclaw:lite` | Lite version, base runtime environment only |

Supports **amd64** and **arm64** dual architectures.

## 📄 License

ArmorClaw Client is dual-licensed:

- **Open Source**: [AGPL-3.0](LICENSE) — Free for personal use, academic research, and open-source projects. Any modifications or derivative works (including SaaS deployments) must also be open-sourced under AGPL-3.0.
- **Commercial License**: For proprietary/closed-source use, commercial integration, or SaaS deployment without open-source obligations, please contact us for a commercial license.

**OpenClaw**: [MIT License](openclaw/LICENSE)

> 📧 For commercial licensing inquiries, please reach out via [Issues](https://github.com/liuwx25-boop/ArmorClaw/issues) or our [Discord Server](https://discord.gg/GgqyQWPe6K).

## 🤝 Contributing

Contributions via Issues and Pull Requests are welcome!

1. Fork this repository
2. Create your feature branch: `git checkout -b feature/amazing-feature`
3. Commit your changes: `git commit -m 'feat: add amazing feature'`
4. Push the branch: `git push origin feature/amazing-feature`
5. Submit a Pull Request

## 🌐 Community

[![Discord](https://img.shields.io/badge/Discord-Server-5865F2?logo=discord&logoColor=white)](https://discord.gg/GgqyQWPe6K)
[![Telegram Channel](https://img.shields.io/badge/Telegram-Channel-blue?logo=telegram)](https://t.me/ArmorClaw_AI)
[![Telegram Group](https://img.shields.io/badge/Telegram-Group-blue?logo=telegram)](https://t.me/ArmorClaw)

- 🎮 [Discord Server](https://discord.gg/GgqyQWPe6K) — Community Hub
- 📢 [Telegram Channel](https://t.me/ArmorClaw_AI) — Announcements & Updates
- 💬 [Telegram Group](https://t.me/ArmorClaw) — Chat & Support

## 📮 Contact

For questions or suggestions, please provide feedback via [Issues](https://github.com/liuwx25-boop/ArmorClaw/issues).
