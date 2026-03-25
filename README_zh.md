<p align="center">
  <img src="images/logo.svg" width="120" alt="DeepRead Logo" />
</p>

# DeepRead for Zotero 7

<p align="center">
  <img src="https://img.shields.io/badge/Zotero-7.0+-blue.svg?style=for-the-badge&logo=zotero&logoColor=white" alt="Zotero 7" />
  <img src="https://img.shields.io/badge/AI-Gemini%202.5-purple.svg?style=for-the-badge" alt="Gemini AI" />
  <img src="https://img.shields.io/github/v/release/shalom-lab/deepread?style=for-the-badge&color=success" alt="Release" />
  <img src="https://img.shields.io/github/license/shalom-lab/deepread?style=for-the-badge&color=orange" alt="License" />
</p>

---

<p align="center">
  <b><a href="README.md">English</a> | 简体中文</b>
</p>

<p align="center">
  <b>如果觉得有用，欢迎前往 <a href="https://github.com/shalom-lab/deepread">shalom-lab/deepread</a> 给我一个 Star 🌟，你的支持是我最大的动力！</b>
</p>

---

**DeepRead** 是一款专为 Zotero 7 打造的深度学术辅助工具。它无缝集成在 Zotero 的右侧详情面板（Item Pane）中，利用强大的 Gemini 多模态长上下文能力，为你提供从“一键摘要”到“深度对话”的全流程 AI 阅读体验。

## ✨ 核心特性

- 🚀 **深层集成**：原生 Zotero 7 插件架构，无需切换窗口，边读边聊。
- 👁️‍🗨️ **多模态 PDF 感知**：支持直接投喂母文献及其下**所有 PDF 附件**，利用 Gemini 原生多模态能力直接分析文档原始内容。
- 💬 **长文本对话**：基于 Gemini 1.5/2.5 Pro 的超长上下文，支持对整本著作、长篇综述进行连贯的追问与探讨。
- 🛠️ **预设管理系统**：内置常用学术指令（总结、数据提取等），支持用户自由扩展和管理个人 Prompt 库。
- 📁 **本地持久化**：所有对话历史与预设均存储在本地 Zotero 目录下，安全隐私。
- 📝 **一键转笔记**：对话内容可一键保存为 Zotero 原生笔记，方便引用与二次整理。
- 🌐 **全方位国际化**：完整支持中英双语，随系统语言自动切换。

## 🛠️ 快速开始

### 1. 安装插件
1. 从 [GitHub Releases](https://github.com/shalom-lab/deepread/releases) 下载最新的 `.xpi` 文件。
2. 在 Zotero 菜单中选择 `工具` -> `插件`。
3. 点击右上角齿轮图标，选择 `Install Add-on From File...` 并选中下载的文件。
4. 重启 Zotero。

### 2. 配置 AI 引擎
1. 访问 [Google AI Studio](https://aistudio.google.com/) 获取你的 **Gemini API Key**。
2. 在 Zotero 菜单中选择 `编辑` -> `设置` (macOS 下为 `Zotero` -> `Settings`)。
3. 切换到 **DeepRead** 配置分栏。
4. 填入 API Key 并选择你偏好的模型（推荐 `gemini-2.0-flash` 或 `gemini-1.5-pro`）。

## 📖 使用指南

### 自动 PDF 提取策略
插件会根据你的选中状态智能判断分析范围：
- **选中单条 PDF**：精确分析当前文件。
- **选中主文献条目**：自动打包所有子级 PDF 附件（如正文 + 附录）联合分析。
- **无 PDF 附件**：自动降级为基于“标题 + 摘要”进行纯文本对话。

### 会话管理
- **执行预设**：在下拉列表中选择预设（如“深度阅读”），点击“执行”即可一键开始。
- **自由对话**：在底部输入框输入任何问题。
- **保存结果**：勾选感兴趣的消息，点击工具栏的“存为笔记” ✅。

## 🔐 数据与隐私

DeepRead 极其重视你的学术数据隐私：
- **Zero Cloud**：插件本身不设任何后端服务器，你的对话记录存储在本地。
- **数据 ID 映射**：记录通过 Zotero 内部数据库（`zotero.sqlite`）的 `itemID`（主键）进行本地关联，确保即便文献更名或移动文件夹，对话历史依然精准匹配。

---

## 🤝 参与贡献

如果你在使用过程中发现 Bug 或有任何功能建议，欢迎提交 [Issue](https://github.com/shalom-lab/deepread/issues) 或 [Pull Request](https://github.com/shalom-lab/deepread/pulls)。

## 📜 许可证

本项目基于 [MIT License](LICENSE) 开源。

---
<p align="center">Made with ❤️ for Academic Research</p>
