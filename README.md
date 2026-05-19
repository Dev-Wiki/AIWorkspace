# AI Workspace

AI Workspace 是一款基于 Tauri + React + Rust 构建的桌面应用程序，旨在为各类 AI 助手统一管理其能力配置（包括 Skills、Rules、Plugins、MCPs 等）。通过本工具，你可以直观地配置启用的规则和技能，并一键同步（通过符号链接）到不同 AI 助手的配置目录中，包括本地和 WSL 环境中的工具。

## 🌟 主要功能 (Features)

- **统一能力管理**：将不同 AI Agent 需要的 `skills`、`rules`、`plugins` 和 `mcps` 集中放置在一个数据仓库中（默认：`~/.ai`）。
- **一键状态切换**：通过直观的用户界面，快速启用或禁用特定的规则和技能（即在 `enabled` 与 `disabled` 目录之间移动文件）。
- **多端一键同步 (Save and Sync)**：
  - 支持将启用的配置通过**软链接 (Junctions / Symlinks)** 同步到超过 10 种不同的 AI 工具配置目录中。
  - 支持 **Windows 本地路径**以及 **WSL (Windows Subsystem for Linux)** 路径的自动链接与转换。
- **丰富的兼容目标 (Supported Agents)**：
  - Cursor (Local & WSL)
  - Gemini CLI (Main & Extension, Local & WSL)
  - Claude CLI
  - Trae
  - Qoder
  - Codex
  - AstrBot
  - ZCode
  - LM Studio Plugins
- **安全备份机制**：在创建软链接覆盖目标环境现存文件/目录前，自动为其添加时间戳后缀（`.bak`）进行备份，保证数据安全。
- **实时执行日志**：界面集成终端样式的日志面板，实时显示同步、备份、移动的详细操作流程。

## 🛠️ 技术栈 (Tech Stack)

| 组件 | 技术 |
| --- | --- |
| **前端框架** | React 18, Vite |
| **应用宿主** | Tauri v2 |
| **后端逻辑** | Rust |
| **样式** | Tailwind CSS, Lucide React (图标) |

## 🚀 快速开始 (Quick Start)

1. **环境准备**：
   - 确保安装了 [Node.js](https://nodejs.org/)。
   - 确保安装了 [Rust](https://www.rust-lang.org/tools/install) 和相关的构建工具。

2. **安装依赖**：
   ```bash
   npm install
   ```

3. **运行开发环境**：
   ```bash
   npm run tauri dev
   ```

4. **构建生产版本**：
   ```bash
   npm run tauri build
   ```

## ⚙️ 使用指南

1. **配置仓库**：应用首次启动会自动初始化 `~/.ai` 目录。你也可以在顶部导航栏点击“配置仓库”选择自定义目录。
2. **存入规则**：通过点击“打开仓库”或对应的 `enabled`/`disabled` 按钮，打开系统的文件管理器，放入你需要的 `.md` 或其他配置文件。
3. **选择链接 Agent**：在左侧面板中，勾选你想要同步规则的 AI 目标。
4. **管理启用状态**：在右侧面板中，选择开启/关闭哪些项目。
5. **保存并同步**：点击界面右下角的“保存并同步”，应用将自动在后台移动文件并生成各平台的软链接。

## ⚠️ 边界与失败情况分析 (Failure Analysis)

- **路径权限不足**：在 Windows 平台上创建 Junction 或使用 WSL 创建软链接时，可能因目标路径所在的驱动器或文件夹权限不足导致失败。建议以适当权限运行或确保用户对目标配置目录有读写权限。
- **WSL 状态未唤醒**：如果开启了 WSL 环境的目标链接，但系统中的 WSL 服务未启动或异常，可能会导致执行 `wsl.exe` 超时或卡住。如果无响应，可尝试手动在终端唤醒 WSL。
- **原文件冲突**：目标路径如果是一个真实存在的重要文件夹，应用会自动执行重命名备份（`.bak_时间戳`），但这会在对应目录下留下历史备份。长期多次备份可能会占用空间。
