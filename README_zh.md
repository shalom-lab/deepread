<p align="center">
  <img src="images/logo.svg" width="160" alt="DeepRead Logo" />
</p>

<h1 align="center">DeepRead for Zotero 7</h1>

<p align="center">
  <i>基于 Gemini 的 Zotero 7 AI 辅助阅读与深层学术对话插件。</i>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Zotero-7.0+-blue.svg?style=flat-square&logo=zotero&logoColor=white" alt="Zotero 7" />
  <img src="https://img.shields.io/badge/AI-Gemini%202.5-purple.svg?style=flat-square" alt="Gemini AI" />
  <img src="https://img.shields.io/github/v/release/shalom-lab/deepread?style=flat-square&color=success" alt="Release" />
  <img src="https://img.shields.io/github/license/shalom-lab/deepread?style=flat-square&color=orange" alt="License" />
</p>

<p align="center">
  <b><a href="README.md">English</a> | <a href="README_zh.md">简体中文</a></b>
</p>

---

<p align="center">
  <b>如果觉得有用，欢迎前往 <a href="https://github.com/shalom-lab/deepread">shalom-lab/deepread</a> 给我一个 Star 🌟，你的支持是我最大的动力！</b>
</p>

---

**DeepRead** 是一款专为 Zotero 7 打造的深度学术辅助工具。它无缝集成在 Zotero 的右侧详情面板（Item Pane）中，利用强大的 Gemini 多模态长上下文能力，为你提供从"一键摘要"到"深度对话"的全流程 AI 阅读体验。

## ✨ 核心特性

- 🚀 **深层集成**：原生 Zotero 7 插件架构，无需切换窗口，边读边聊。
- 🌐 **全方位国际化**：完整支持中英双语，随系统语言自动切换。
- 👁️‍🗨️ **全格式附件感知**：支持投喂母文献下所有的 **PDF、Word (.doc/.docx)** 附件，利用 Gemini 的原生多模态或超长上下文能力直接分析文档原始内容。
- 💬 **长文本对话**：支持基于 Gemini 1.5/2.5 Pro 的超长上下文，支持对整本著作、长篇综述进行连贯的追问与探讨。
- 📋 **消息交互与右键菜单** *(v0.6.0)*：支持单条消息折叠/展开，新增右键菜单，可快速进行单条“存为笔记”、“存为预设”或“删除”操作。
- 🛠️ **预设管理系统**：内置常用学术指令，支持用户自由扩展和管理 Prompt 库，新增“设为默认”功能。
- 📝 **智能笔记归档**：保存笔记时采用带时间戳的标题；正文为 **HTML 富文本 + 可折叠 Markdown 原文**（便于阅读与以后提取）。
- 🎨 **配套笔记美化**：推荐配合 Zotero 官方 `extensions.zotero.note.css`，样式见下方「配套笔记 CSS」。
- 🗂️ **条目整理 Agent** *(v0.11)*：多选文献后用「DeepRead 条目整理」；**标题只认 PubMed/Crossref**，先出把握度日志，OK 后再改名附件为 `Manuscript_` / `AppendixN_`。
- 📖 **PDF 阅读器上下文感知** *(v0.4.0)*：当 Zotero 内置阅读器中打开了某个 PDF，DeepRead 会**自动切换对话上下文**到该 PDF，无论侧边栏选中的是什么条目。标题栏会显示绿色 `📖 阅读器` 标记作为确认。
- 📋 **一键复制消息** *(v0.4.0)*：每条对话消息右上角都有 📋 复制图标，点击即可将内容写入剪贴板，并弹出中英双语成功提示。

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
4. 填入 API Key 并选择你偏好的模型（推荐 `gemini-2.5-flash` 或 `gemini-2.0-flash`）。

## 📖 使用指南

### 自动 PDF 提取策略
插件会根据当前状态智能判断分析范围（优先级从高到低）：
- **阅读器中打开了 PDF**：自动使用**正在阅读的 PDF** 作为对话上下文 *(v0.4.0+)*。
- **选中单条 PDF**：精确分析当前文件。
- **选中主文献条目**：自动打包所有子级 PDF 附件（如正文 + 附录）联合分析。
- **无 PDF 附件**：自动降级为基于"标题 + 摘要"进行纯文本对话。

### 会话管理
- **执行预设**：在下拉列表中选择预设（如"深度阅读"），点击"执行"即可一键开始。
- **自由对话**：在底部输入框输入任何问题。
- **复制消息**：点击消息气泡上的 📋 图标，一键复制消息内容到剪贴板。
- **保存结果**：勾选感兴趣的消息，点击工具栏的「存为笔记」。新版笔记上方是排版好的 HTML，文末可展开 **Markdown 原文** 全选复制。

### 🎨 配套笔记 CSS（强烈推荐）

DeepRead 负责把对话存成好看的 HTML；Zotero 笔记编辑器的观感则用官方隐藏偏好美化。两者配套，侧栏对话和笔记阅读会更统一。

1. 打开 `编辑` → `设置` → `高级` → `配置编辑器`
2. 搜索并双击 `extensions.zotero.note.css`
3. 打开仓库里的 [`extras/deepread-note.css`](extras/deepread-note.css)，**全部复制粘贴**进去
4. 确定后 **重启 Zotero**

完整样式如下（与仓库文件同步，可直接复制）：

```css
/* DeepRead 配套笔记样式 — 详见 extras/deepread-note.css */
.primary-editor {
  background: #faf9f7 !important;
  max-width: 42em !important;
  margin: 0 auto !important;
  padding: 18px 28px 48px !important;
  box-sizing: border-box !important;
  line-height: 1.7 !important;
  color: #222 !important;
  font-size: 15px !important;
}

.primary-editor h1 {
  font-size: 1.55em !important;
  font-weight: 700 !important;
  margin: 1.1em 0 0.45em !important;
  padding-bottom: 0.25em !important;
  border-bottom: 1px solid #e6e2dc !important;
  color: #1a1a1a !important;
}

.primary-editor h2 {
  font-size: 1.28em !important;
  font-weight: 700 !important;
  margin: 1em 0 0.4em !important;
  padding-left: 0.45em !important;
  border-left: 3px solid #1e88e5 !important;
  color: #1a1a1a !important;
}

.primary-editor h3 {
  font-size: 1.12em !important;
  font-weight: 650 !important;
  margin: 0.9em 0 0.35em !important;
  color: #1565c0 !important;
}

.primary-editor h4,
.primary-editor h5,
.primary-editor h6 {
  font-size: 1em !important;
  font-weight: 650 !important;
  margin: 0.75em 0 0.3em !important;
  color: #444 !important;
}

.primary-editor p {
  margin: 0 0 0.75em !important;
  text-indent: 0 !important;
}

.primary-editor ul,
.primary-editor ol {
  margin: 0.4em 0 0.85em !important;
  padding-left: 1.5em !important;
}

.primary-editor li {
  margin: 0.2em 0 !important;
}

.primary-editor blockquote {
  margin: 0.7em 0 !important;
  padding: 0.45em 0.85em !important;
  border-left: 3px solid #90caf9 !important;
  background: #f3f7fb !important;
  color: #555 !important;
}

.primary-editor blockquote p {
  margin: 0.25em 0 !important;
}

.primary-editor pre,
.primary-editor code {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace !important;
  font-size: 0.92em !important;
}

.primary-editor code {
  padding: 0.1em 0.35em !important;
  background: #f0f2f5 !important;
  border-radius: 3px !important;
}

.primary-editor pre {
  margin: 0.7em 0 !important;
  padding: 0.75em 0.9em !important;
  background: #f4f6f8 !important;
  border: 1px solid #e2e8ef !important;
  border-radius: 6px !important;
  white-space: pre-wrap !important;
  overflow-x: auto !important;
}

.primary-editor table {
  border-collapse: collapse !important;
  width: 100% !important;
  margin: 0.8em 0 !important;
  font-size: 0.95em !important;
}

.primary-editor th,
.primary-editor td {
  border: 1px solid #dde3ea !important;
  padding: 0.45em 0.6em !important;
  vertical-align: top !important;
}

.primary-editor th {
  background: #edf3fa !important;
  font-weight: 700 !important;
}

.primary-editor hr {
  border: none !important;
  border-top: 1px solid #e0e0e0 !important;
  margin: 1.1em 0 !important;
}

.primary-editor a {
  color: #1565c0 !important;
  text-decoration: none !important;
  border-bottom: 1px solid rgba(21, 101, 192, 0.28) !important;
}

.primary-editor strong {
  font-weight: 700 !important;
  color: #111 !important;
}

.primary-editor em {
  font-style: italic !important;
  color: #333 !important;
}

.primary-editor details {
  margin: 0.9em 0 !important;
  padding: 0.35em 0.6em !important;
  border: 1px dashed #d7dee7 !important;
  border-radius: 6px !important;
  background: #fff !important;
}

.primary-editor details > summary {
  cursor: pointer !important;
  font-weight: 650 !important;
  color: #1565c0 !important;
  margin-bottom: 0.35em !important;
}

.primary-editor .deepread-md-source,
.primary-editor pre[data-deepread-md="1"] {
  background: #f7f8fa !important;
  border-color: #d9e1ea !important;
}
```

> 也可只打开 [`extras/deepread-note.css`](extras/deepread-note.css) 复制，避免 README 里漏行。旧笔记若仍是纯文本 `<pre>`，需重新「存为笔记」才会是新版 HTML。

### AI 对话记忆与原理说明
- **传入的上下文（文件内容）**：每次发起对话时，DeepRead 会根据你在“全选/勾选框”中选中的附件（默认是当前正在阅读的 PDF，或该条目下的所有附件），将其完整内容发送给 Gemini，让它“看着原文件”进行回答。
- **对话历史记忆（连贯追问）**：在同一篇文献的对话面板中，**AI 会记得完整的上下文和历史对话！** 你可以在此基础上进行连贯的追问。例如，你可以先执行「深度阅读」预设，然后再追问“文中关于第二段提到的试验方法能再详细解释下吗”。
- **持久化记录**：你的对话记录将**永久保存在本地**。就算你关掉了 Zotero 甚至重启电脑，下次点击同一篇文献，你依然可以看到从前的对话，还能接着之前的历史继续提问。

### 浮窗工具与外接 MCP

在浮窗输入 `/tools` 或问「你现在支持哪些功能？」即可查看本轮可用的工具及其来源。查询清单不需要模型 API Key。外接 MCP 默认关闭，此时可以直接测试 DeepRead 的选区读取和条目整理。

运行「条目整理」后，浮窗按条目或附件 ID 显示旧值和建议值。勾选要接受的行，点「执行所选 N 项」才会写入文献库。执行回执分开列出磁盘文件名和 Zotero 显示标题的实际变化，某一步失败时也能看出另一步是否成功。

同一轮里需要确认的外接 MCP 调用也会列在这张清单里，可以展开查看完整参数。执行后，外接工具的回执显示服务返回的内容。遇到超时或断连，会标明执行结果待核实。

在 Zotero 设置的 DeepRead 页面中，可保存一个或多个 Streamable HTTP 服务，再打开外接 MCP 开关。例如，下方配置启用本机 Zotero MCP，同时保留一个暂时停用的服务。第二个地址可替换为你自己的端点。

```json
{
  "mcpServers": {
    "zotero": { "url": "http://127.0.0.1:23120/mcp" },
    "research": { "url": "https://example.org/mcp", "enabled": false }
  }
}
```

关闭总开关会保留配置。也可以保存 `{"mcpServers": {}}` 清空服务列表。

## 🔐 数据与隐私

DeepRead 极其重视你的学术数据隐私：
- **Zero Cloud**：插件本身不设任何后端服务器，你的对话记录存储在本地。
- **数据 ID 映射**：记录通过 Zotero 内部数据库的 `itemID`（主键）进行本地关联，确保即便文献更名或移动文件夹，对话历史依然精准匹配。

## ⚙️ 技术实现细节

### 1. 存储结构与区分
对话和预设保存在 Zotero 数据目录下的 `deepread.sqlite` 中。

- 每段对话占一行，消息按顺序保存为 JSON。单条目对话按顶层条目 ID 关联，条目面板和阅读器共享历史。浮窗对话按会话 ID 独立保存。
- 单条目和浮窗各有一张预设表，分别保留各自的顺序和默认预设。
- 第五张表 `tools` 保存已实现的原生工具目录，可按工具名、领域和浮窗可用性核对。插件启动时按当前版本同步目录，工具的执行函数随插件代码加载。外接 MCP 工具按已启用服务的实时清单发现。
- 升级后首次打开时，插件在同一个事务内导入旧 JSON 并核对记录。旧文件保留在原处，迁移成功后，后续读写使用 SQLite。

### 2. 存入时机
插件采用**即时持久化**策略，确保数据安全：
- **发送时存入**：当你点击“发送”或“执行预设”时，用户的问题会立即追加入历史并写入磁盘。
- **回复时存入**：当 AI 完成回答并渲染到 UI 后，回复内容（包含模型信息）会再次触发写入磁盘。

### 3. UI 实时同步
DeepRead 支持**跨窗口实时同步**：
- 如果你同时打开了主界面的侧边栏和独立的 PDF 阅读器窗口，在一个窗口中进行的对话操作（发送、等待、接收回复）会通过 `data-top-item-id` 标签实时同步映射到所有相关窗口的 UI 上，无需手动刷新。


---

## 💻 开发者 API：无头自动化模式 (Headless / Action Tags)

DeepRead 底层暴露了 `Zotero.DeepRead.runHeadless` 等无头接口，完美支持通过 Zotero 的 **Run JavaScript** 或 **Action Tags** 插件进行批量自动化脚本调用。即使左侧对话面板未打开，依然能后台提取 PDF 并请求大模型。

### 示例 1: 打印所有已存储的预设
在 `工具 -> 开发者 -> 运行 JavaScript` 面板中，执行以下代码查看所有可用预设与提示词：

```javascript
let presets = await Zotero.DeepRead.loadPromptPresets();
let output = "【DeepRead 预设列表】\n" + "=".repeat(40) + "\n";
presets.forEach((p, index) => {
    let mark = index === 0 ? " (默认⭐)" : "";
    output += `序号: [${index}]${mark}\n标签: ${p.name}\n内容: ${p.prompt}\n` + "-".repeat(40) + "\n";
});
return output;
```

### 示例 2: 批量静默总结 (自动建笔记)
框选多篇文献，使用默认预设（预设 [0]）对所有带附件的条目批量发问，并自动生成下级笔记。

```javascript
// 简单的延时函数，防止触发免费 API (如 15 RPM) 的速率限制
const sleep = ms => new Promise(r => Zotero.setTimeout(r, ms));

let items = ZoteroPane.getSelectedItems();
if (items.length === 0) return "请先选中至少一篇文献！";

let presets = await Zotero.DeepRead.loadPromptPresets();
let prompt = presets[0].prompt;

for (let item of items) {
    if (!item.isRegularItem() || item.getAttachments().length === 0) continue;
    
    try {
        // API 签名: runHeadless(item, prompt, saveToHistory, sendHistory)
        // 参数3 (true): 将生成结果写入本地对话历史，之后在侧边栏可见
        // 参数4 (false): 提问时不携带历史上下文 (极速纯净单次提问，省 Token 无干扰)
        let aiResult = await Zotero.DeepRead.runHeadless(item, prompt, true, false);
        
        // 如果你希望将结果额外生成为独立的黄色笔记，取消下方注释放开：
        // let note = new Zotero.Item('note');
        // note.setNote(`【AI 批量处理: ${presets[0].name}】<br/><br/>${aiResult.replace(/\\n/g, '<br/>')}`);
        // note.parentID = item.id;
        // await note.saveTx();

        // 每次跑完强制休息 5 秒钟 (60秒内最多跑12次)，严守 15 RPM 限制
        await sleep(5000);
    } catch (e) {
        Zotero.warn("文章 《" + item.getField("title") + "》 出错: " + e.message);
    }
}
return "所有批量摘要任务已完成！";
```

### 示例 3: 读取选中文献的过往对话记录
如果你想用脚本提取曾经和 AI 聊过的历史记录（例如将某篇文章的完整讨论一键导出），可以使用内部暴露的历史接口：

```javascript
let items = ZoteroPane.getSelectedItems();
if (items.length === 0) return "请先选中一篇文献！";

let targetItem = items[0];
// 获取该文献的所有底层对话记录
let histData = Zotero.DeepRead._getOrCreateHistory(targetItem);

let output = `【文献: ${targetItem.getField('title')}】 的历史对话共 ${histData.history.length} 条:\n\n`;
histData.history.forEach((msg, idx) => {
    let roleName = msg.role === 'user' ? '🧑‍💻 User' : '🤖 AI';
    output += `[${idx + 1}] ${roleName}:\n${msg.content}\n` + "-".repeat(30) + "\n";
});
return output;
```

### 示例 4: 批量清理由于 AI 未回复产生的孤立提问
如果你在批量处理时因为网络或 API 欠费导致 AI 没回复，本地会留下只有提问没有回答的“孤立记录”。可以使用此脚本一键清理选中的条目：

```javascript
let items = ZoteroPane.getSelectedItems();
let count = 0;

for (let item of items) {
    if (!item.isRegularItem()) continue;
    
    // 获取该条目的历史记录主键
    let key = Zotero.DeepRead._getHistoryKey(item);
    // 获取历史数据
    let histData = Zotero.DeepRead._getOrCreateHistory(item);
    
    // 判定条件：历史记录只有 1 条，且该条记录是用户发送的（说明 AI 还没回或者失败了）
    if (histData.history.length === 1 && histData.history[0].role === 'user') {
        Zotero.DeepRead.chatHistory.delete(key);
        count++;
    }
}

if (count > 0) {
    // 统一执行一次磁盘同步
    await Zotero.DeepRead.saveChatHistory();
    return `成功清理了 ${count} 条由于 AI 未回复而产生的孤立提问记录。`;
}

return "未发现符合条件的孤立记录。";
```


---

## 📋 更新日志

### v0.7.3
- 🚜 **移除单开模式**：由于 Zotero 对该特性的底层支持并不完善，现已将其移除，以保证核心功能的稳定性。

### v0.7.2
- 🚜 **移除 CAJ 格式支持**：移除了不稳定的 CAJ 文件解析逻辑，精简代码，专注于质量更高的 PDF 与 Word 附件直投。
- 🐛 **UI 渲染修复**：修复了在主界面与 PDF 阅读器并存时，设置面板“当前配置”状态框可能出现的显示冲突。

### v0.7.1
- ✨ **跨窗口同步**：实现了聊天记录与加载状态在主界面和独立 PDF 窗口之间的实时双向同步。
- ✨ **阅读器模式增强**：彻底修复了独立 PDF 窗口下无法识别当前文献及预设列表加载失败的问题。
- ✨ **数据自动迁移**：支持将旧版本挂载在附件 ID 下的对话记录自动合并到父条目下，确保升级后记录不丢失。
- ✨ **交互优化**：右键菜单新增“重新发送”功能，支持对失败的提问进行快捷补发；优化了预设列表的选择状态与按钮联动。


### v0.7.0
- ✨ **Developer API**: 隆重推出“无头模式（Headless API）”，为高级用户和第三方插件（如 Action Tags / Run JS）提供完整的批量处理底层接口支持！
- 🔧 支持通过 API 自由切换是否持久化生成笔记、是否向 AI 添加历史对话上下文，极大提高了第三方扩展调用插件的灵活性。

### v0.6.6
- [UI] **侧边栏优化**：对超长附件文件名进行了防溢出处理，超过 30 字符自动截断，但智能保留 `[PDF]` 等后缀，防止界面撑爆。
- [UI] **预设下拉框界面优化**：限制过长的预设名字长度，超过30字符则截断，避免侧边栏宽度被拉伸。

### v0.6.5
- [UI] **实时配置透明化**：在设置页底部增加“当前配置”展示区，直观看到正在生效的模型、温度与 Token。
- [Model] **Gemini 3.1 默认化**：全平台初始默认模型统一为 `gemini-3.1-flash-lite-preview`。
- [Chat] **历史溯源**：AI 回复增加模型名称标注，每条回复及其历史记录均可追溯具体的调用模型。
- [Bugfix] **配置同步加固**：修复从全局设置切换模型后，工作面板偶尔存在时延或残留旧模型的问题。
- [UI] **设置页优化**：增加 API 实时额度查询链接及更多视觉微调。

### v0.6.2
- 🎨 **新增插件图标**：为 Zotero 插件管理器增加了正式的 Logo 图标支持。
- 📝 **描述优化**：精简并优化了插件的描述信息，更清晰地展示多格式支持特性。

### v0.6.1
- ✨ **模型列表深度适配**：根据 Google AI Studio 免费层级最新配额，优化了模型选择列表。
- ✨ **新增高额度模型**：加入 **gemini-3.1-flash-lite (500次/日)**、**gemma-4-31b (1500次/日)** 等高性价比型号。
- ✨ **内置配额提示**：设置界面直接显示各模型的每日免费额度，方便用户管理资源。
- ✨ **更聪明的默认值**：将默认模型设为 `gemini-3.1-flash-lite`，兼顾速度与稳定性。

### v0.6.0
- ✨ **多格式支持**：新增对 **Word (.doc, .docx)** 格式附件的支持，自动识别并投喂给 AI。
- ✨ **右键菜单交互**：消息新增右键菜单，支持单条“存为笔记”、“存为预设”、“折叠/展开”及“删除”。
- ✨ **消息折叠功能**：每条消息可独立折叠/展开，工具栏新增一键切换全局折叠状态。
- ✨ **笔记命名优化**：存为笔记时采用 `AI 阅读笔记 - 日期时间` 格式，正文增加文献关联。
- ✨ **预设管理升级**：新增“设为默认”功能，修复了跨页面的预设列表实时刷新延迟。
- 🛠️ **UI 精简与交互**：移除了冗余按钮，增加了批量删除前的二次确认弹窗，修复了 Zotero 设置页的模型选中同步 Bug。

### v0.5.1
- 🎨 优化了 UI 加载动画，移除了重复的沙漏图标。
- 🐛 修复了右键菜单在某些 Zotero 窗口环境下 'doc.body is null' 的报错。

### v0.5.0
- ✨ 初步引入对 Word 附件的识别能力。
- ✨ 实现了基础的消息折叠交互。
- ✨ **PDF 阅读器上下文感知**：自动检测 Zotero 阅读器中当前打开的 PDF，并将其作为对话上下文，标题栏显示 `📖 阅读器` 徽章确认。
- ✨ **消息一键复制**：每条对话消息新增 📋 复制图标，支持中英双语剪贴板反馈。
- 🐛 **修复**：阅读器模式下"删除选中"、"存为笔记"、"存为预设"等操作现在可以正确识别勾选状态（原因：跨文档 `getElementById` 找到了错误节点）。
- 🐛 **修复**：阅读器模式下新发送的消息和加载指示器现在可以正确显示在聊天面板中（原因：消息被追加到了错误的文档上下文）。

### v0.2.0
- ✨ 为每条消息气泡添加了 📋 复制图标。

### v0.1.0
- 🎉 首次发布：对话、预设管理、历史持久化、一键转笔记。

---

## 🤝 参与贡献

如果你在使用过程中发现 Bug 或有任何功能建议，欢迎提交 [Issue](https://github.com/shalom-lab/deepread/issues) 或 [Pull Request](https://github.com/shalom-lab/deepread/pulls)。

## 📜 许可证

本项目基于 [MIT License](LICENSE) 开源。

---
<p align="center">Made with ❤️ for Academic Research</p>
