# AI Workspace

AI Workspace 是一款基于 Tauri + React + Rust 构建的桌面应用程序，定位为 **AI Capability Package Manager (无状态配置包管理器)**。它旨在为各类 AI 助手（Cursor / Claude / Windsurf 等）统一管理其核心能力配置（Skills、Rules、Plugins、MCPs 等）。本工具坚持“绝对无状态”和“渐进增强”原则，不仅能够一键分发与同步配置，还能通过统一 IR 与 Adapter 机制跨平台抹平不同 Agent 的能力格式差异，极大提升开发者的多 Agent 协作效率。

## 🌟 主要功能 (Features)

- **统一能力包管理 (Package Management)**：将不同 AI Agent 需要的 `skills`、`rules`、`plugins` 和 `mcps` 集中放置在一个数据仓库中作为唯一数据源 (Single Source of Truth)。
- **极简 Profile 引擎 (Profile Engine)**：支持根据不同的项目上下文（如前端开发、Rust 架构）创建自定义配置集（Profiles）。只需在界面一键下拉切换，即可实现整套 Skill 和 Rule 的瞬间组合装配。
- **渐进增强的解析体系 (Progressive Enhancement)**：
  - 支持“零门槛”的纯 Markdown 文件，也支持在文件头部写入 YAML Front Matter 声明依赖和路由。
  - **第三方非侵入性 (Override 机制)**：支持在 Profile 层面强行覆盖第三方能力的元数据，保障通过 Git 引入的外部能力包零冲突更新。
- **Adapter 与透传机制 (Core IR + Extension)**：针对 MCP 等碎片化协议定义统一中间层，经由 Adapter 渲染为各 Agent 原生配置。允许保留专属字段直接透传（Passthrough），拒绝特性降级。
- **多端一键同步与链接 (Save and Sync)**：
  - 支持通过软链接 (Junctions / Symlinks) 或 Adapter 编译覆盖的形式，将 Profile 组合全量下发至目标工作区。
  - 支持 Windows 本地环境与 WSL 环境的双向路径转换处理。
- **极其丰富的全系端点支持 (Supported Agents)**：
  - 一键同步至：Cursor, Gemini/Antigravity, Claude CLI, Windsurf, Continue, Codex, Trae, Qoder, AstrBot, DeepSeek TUI, ZCode 等市面主流的十余款 AI 工具。
- **配置的绝对上游 (Absolute Upstream)**：工具作为配置的唯一单点源 (SSOT)，内置冲突检测与时间戳备份（`.bak`）机制，防止因为跨客户端切换导致的隐式状态覆盖。
- **实时执行日志**：界面集成终端样式的日志面板，清晰追溯所有目录的映射、备份与切换行为。

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

## 🏷️ 发布规范 (Tag Message 规范)

- **统一格式**：`vX.Y.Z` 标题行，空行后紧跟 `Added:` / `Changed:` / `Fixed:` 分段列表。
- **目标**：`git tag -l vX.Y.Z -n99` 即可获取完整 changelog 摘要，无需额外打开文件。
- **与 CHANGELOG 关系**：tag message 是 CHANGELOG 对应版本的压缩版，两者内容须一致但 tag message 可更精简。

### 格式模板

```txt
v1.0.6

Added:
- 功能描述一。
- 功能描述二。

Changed:
- 变更描述。

Fixed:
- 修复描述。
```

### 约束

- **禁止**空 message 或单行草稿式 tag（如 `v1.0.6` 无正文）。
- **禁止**在 tag message 中使用 `###` markdown 标题，纯文本分段即可。
- **类型段可选**：若无某类变更，可省略对应分段（如无 Changed 则只保留 Added / Fixed）。
- **发布 commit**：打 tag 前须确保 `VERSION` 已更新、`CHANGELOG.md` 已追加对应版本条目并提交。
