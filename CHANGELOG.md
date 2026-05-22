# Changelog

All notable changes to this project will be documented in this file.

## [v0.1.3] - 2026-05-22

### Fixed
- 兼容 Antigravity 2.0，在同步 skills 时额外添加 `~/.gemini/config/skills` 的兼容链接。

## [v0.1.2] - 2026-05-21

### Changed
- 适配 Antigravity 新版双版本架构，新增 `antigravity-skills` 和 `antigravity-ide-skills` 支持。

## [v0.1.1] - 2026-05-21

### Added
- 新增 Profile 引擎功能，支持跨环境切换不同的 Agent 技能/插件组合。
- 前端新增下拉 Profile 选取、另存为及删除功能的独立操作栏。
- 在页面底部新增一键检查版本更新与 Github Release 下载联动。
- 新增针对 DeepSeek TUI 的双端点适配 (`skills` 和 `rules`)。

### Changed
- 将原有的右侧划出式日志面板改造为了独立的屏幕居中弹窗 (Modal) 以优化交互体验。
- 移除了原生的浏览器 `prompt`/`confirm`，全部替换为 Tailwind 自定义样式弹窗。

### Fixed
- 修复了因为 Tauri 同步指令阻塞主线程，导致点击“执行日志”会卡死整个浏览器窗口的严重 Bug。
- 修复了由于日志条目过多（超大文件系统扫描时）导致 React 渲染 DOM 撑爆内存卡死的问题，现在严格截断展示最新的 1000 条记录。
