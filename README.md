<p align="center">
  <img src="images/logo.svg" width="160" alt="DeepRead Logo" />
</p>

<h1 align="center">DeepRead for Zotero 7</h1>

<p align="center">
  <i>A powerful AI-driven research assistant for your Zotero workflow.</i>
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
  <b>If you find this plugin useful, please give it a Star on <a href="https://github.com/shalom-lab/deepread">GitHub</a> 🌟. <br/> Your support is my greatest motivation!</b>
</p>

---

**DeepRead** is a powerful AI-driven research assistant extension for Zotero 7. Integrated seamlessly into the right-hand Detail Panel (Item Pane), it leverages Gemini's multimodal capabilities to provide a complete workflow from "One-click Summaries" to "Deep Conversations."

## ✨ Key Features

- 🚀 **Deep Integration**: Native Zotero 7 plugin architecture. Read and chat without switching windows.
- 🌐 **Multilingual Support**: Fully supports **English and Chinese** out of the box, matching your Zotero system language automatically.
- 👁️‍🗨️ **All-Format Attachment Awareness**: Supports all **PDF and Word (.doc/.docx)** attachments. Analyzes content using Gemini's native multimodal or long-context capabilities.
- 💬 **Long-Context Chat**: Massive context window based on Gemini 1.5/2.5 Pro. Ideal for discussing entire books or lengthy reviews.
- 📋 **Message Interaction & Context Menu** *(v0.6.0)*: Supports collapsible messages to save space. Added right-click menu for quick "Save as Note," "Save as Preset," or "Delete" actions for individual messages.
- 🛠️ **Power Preset System**: Built-in academic commands. Manage and extend your Prompt library with a "Set as Default" option.
- 📝 **Smart Note Archive**: Timestamped titles, plus **rich HTML + collapsible Markdown source** for reading and later extraction.
- 🎨 **Companion Note Styling**: Pair with Zotero’s official `extensions.zotero.note.css` — see **Companion Note CSS** below.
- 🗂️ **Item Organize Agent** *(v0.11)*: Multi-select → **DeepRead Organize Items…**. Titles come **only from PubMed/Crossref**; confidence log first, then OK applies `Manuscript_` / `AppendixN_` renames.
- 📖 **PDF Reader Context Detection** *(v0.4.0)*: When a PDF is open in Zotero's built-in reader, DeepRead **automatically switches context** to that PDF — regardless of which item is selected in the library. A green `📖 Reader` badge confirms the active context.
- 📋 **One-click Copy** *(v0.4.0)*: Each chat message has a **copy icon** (📋) for instant clipboard access, with a bilingual success notification.

## 🛠️ Quick Start

### 1. Installation
1. Download the latest `.xpi` file from [GitHub Releases](https://github.com/shalom-lab/deepread/releases).
2. In Zotero, go to `Tools` -> `Add-ons`.
3. Click the gear icon in the top right, select `Install Add-on From File...`, and choose the downloaded file.
4. Restart Zotero.

### 2. Configure AI Engine
1. Visit [Google AI Studio](https://aistudio.google.com/) to get your **Gemini API Key**.
2. Go to `Edit` -> `Settings` (or `Zotero` -> `Settings` on macOS).
3. Switch to the **DeepRead** configuration tab.
4. Enter your API Key and select your preferred model (e.g., `gemini-2.5-flash` or `gemini-2.0-flash`).

## 📖 Usage Guide

### Automatic PDF Packing
The plugin intelligently detects the scope based on your selection:
- **PDF Reader open**: Uses the **currently reading PDF** as context automatically *(v0.4.0+)*.
- **Selected a single PDF**: Precisely analyzes that specific file.
- **Selected a parent Item**: Automatically bundles all child PDF attachments (e.g., Main text + Supplementary materials) for joint analysis.
- **No PDF attachments**: Falling back to context-aware text analysis (Title + Abstract).

### Interaction
- **Run Presets**: Select a preset from the dropdown (e.g., "Deep Read") and click **Run**.
- **Freeform Chat**: Type any question in the bottom input box.
- **Copy Message**: Click the 📋 icon on any message bubble to copy its content to clipboard.
- **Export Result**: Check messages and click **Save to Note**. Newer notes store rendered HTML up top, with expandable **Markdown source** at the bottom for copy/export.

### 🎨 Companion Note CSS (recommended)

DeepRead writes readable HTML into Zotero notes; the note editor look-and-feel is customized via Zotero’s built-in preference. Use them together.

1. Open `Edit` → `Settings` → `Advanced` → `Config Editor`
2. Search for and open `extensions.zotero.note.css`
3. Paste the full contents of [`extras/deepread-note.css`](extras/deepread-note.css)
4. Confirm, then **restart Zotero**

Full stylesheet (same as the repo file — copy freely):

```css
/* DeepRead companion note styles — see extras/deepread-note.css */
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

> Prefer copying from [`extras/deepread-note.css`](extras/deepread-note.css) to avoid missing lines. Older notes saved as plain `<pre>` need a fresh **Save to Note** to get the new HTML layout.

### AI Context & Memory
- **What is Sent**: For every chat or preset execution, DeepRead automatically passes the selected document attachments (via the tickboxes, defaulting to the open PDF) directly to the Gemini API, ensuring answers are grounded in the full document content.
- **Conversational Memory**: **The AI remembers your entire conversation history** in the chat panel! You can easily ask follow-up questions. For instance, after running the "Summary" preset, you can simply type *"Can you explain the methodology in section 2 in more detail?"*
- **Persistent Chat History**: Your chats are saved **locally and permanently**. Even if you close Zotero or restart your computer, opening the same paper later will reload your previous chat, allowing you to seamlessly continue exactly where you left off.

## 🔐 Data & Privacy

DeepRead prioritizes your data privacy:
- **Zero Cloud**: There is no third-party backend server. Your conversations stay on your machine.
- **Local Database Linking**: Records are mapped locally using the `itemID` (Primary Key) from the internal Zotero SQLite database (`zotero.sqlite`), ensuring persistence even if files are renamed.

---

## 💻 Developer API: Headless Automation Mode

DeepRead exposes internal APIs such as `Zotero.DeepRead.runHeadless`, perfectly enabling batch automation scripts through Zotero's built-in **Run JavaScript** or integrations with plugins like **Action Tags**. It extracts text and prompts the AI seamlessly in the background without requiring the UI pane to be open.

### Example 1: View Configured Presets
In `Tools -> Developer -> Run JavaScript`, execute this snippet to fetch all your saved presets:

```javascript
let presets = await Zotero.DeepRead.loadPromptPresets();
let output = "【DeepRead Presets】\n" + "=".repeat(40) + "\n";
presets.forEach((p, index) => {
    let mark = index === 0 ? " (Default⭐)" : "";
    output += `Index: [${index}]${mark}\nName: ${p.name}\nPrompt: ${p.prompt}\n` + "-".repeat(40) + "\n";
});
return output;
```

### Example 2: Batch Summarization (Auto-Creates Notes)
Select multiple items in Zotero, and run this to automatically summarize all items with an attachment using Preset [0], subsequently auto-generating a Zotero Note for each:

```javascript
// Simple sleep function to prevent hitting the free API rate limit (15 RPM)
const sleep = ms => new Promise(r => Zotero.setTimeout(r, ms));

let items = ZoteroPane.getSelectedItems();
if (items.length === 0) return "Please select at least one item!";

let presets = await Zotero.DeepRead.loadPromptPresets();
let prompt = presets[0].prompt;

for (let item of items) {
    if (!item.isRegularItem() || item.getAttachments().length === 0) continue;
    
    try {
        // API Signature: runHeadless(item, prompt, saveToHistory, sendHistory)
        // Param 3 (true): Sync results to the chat history panel naturally
        // Param 4 (false): Do NOT send previous history to the AI (Fast, clean extraction saving tokens)
        let aiResult = await Zotero.DeepRead.runHeadless(item, prompt, true, false);
        
        // If you want to automatically generate a Zotero child note as well, uncomment the following lines:
        // let note = new Zotero.Item('note');
        // note.setNote(`【AI Batch Processing: ${presets[0].name}】<br/><br/>${aiResult.replace(/\\n/g, '<br/>')}`);
        // note.parentID = item.id;
        // await note.saveTx();

        // Pause for 5 seconds between requests (max 12 requests per minute)
        await sleep(5000);
    } catch (e) {
        Zotero.warn("Item 《" + item.getField("title") + "》 failed: " + e.message);
    }
}
return "Batch task completed!";
```

### Example 3: Read Specific Item Chat History
If you want to extract past conversations you had with the AI regarding a specific item, you can access the internal history arrays programmatically:

```javascript
let items = ZoteroPane.getSelectedItems();
if (items.length === 0) return "Please select an item!";

let targetItem = items[0];
// Fetch the raw dialogue records
let histData = Zotero.DeepRead._getOrCreateHistory(targetItem);

let output = `【Item: ${targetItem.getField('title')}】 has ${histData.history.length} messages:\n\n`;
histData.history.forEach((msg, idx) => {
    let roleName = msg.role === 'user' ? '🧑‍💻 User' : '🤖 AI';
    output += `[${idx + 1}] ${roleName}:\n${msg.content}\n` + "-".repeat(30) + "\n";
});
return output;
```

---

## 📋 Changelog

### v0.7.3
- 🚜 **Removed Single PDF Mode**: This feature has been removed due to unstable underlying support in Zotero, ensuring a more reliable core experience.

### v0.7.2
- 🚜 **Removed CAJ Support**: Removed unstable CAJ file parsing logic to focus on high-quality PDF and Word integration.
- 🐛 **UI Rendering Fix**: Resolved potential display conflicts in the "Current Config" panel across different window states.

### v0.7.1
- ✨ **Cross-window Sync**: Real-time synchronization of chat logs and loading states between the main interface and independent PDF windows.
- ✨ **Enhanced Reader Mode**: Fixed document identification and preset loading issues in independent PDF windows.
- ✨ **Auto Migration**: Legacy chat records are now automatically migrated to parent bibliographical items.
- ✨ **Interaction Improvements**: Added "Resend" to the context menu and optimized preset list management.

### v0.7.0
- ✨ **Developer API**: Introduced the "Headless Automation Mode", allowing power users and 3rd-party plugins (like Action Tags / Run JS) to execute DeepRead's capabilities in the background.
- 🔧 Added precise API toggle controls (`saveToHistory` and `sendHistory`) for maximum scriptability and API rate-limit optimization.

### v0.6.6
- [UI] **Attachment Rendering**: Truncated long attachment titles to 30 characters in the sidebar to prevent layout stretching, while intelligently preserving file extensions (e.g., `... [PDF]`).
- [UI] **Preset Name Rendering**: Truncated long preset names in dropdowns and management lists to 30 characters to prevent sidebar stretching.

### v0.6.5
- [UI] **Config Transparency**: Added a "Current Config" panel in the settings tab to display active Model, Temp, and Tokens.
- [Model] **Gemini 3.1 Default**: Standardized the initial default model to `gemini-3.1-flash-lite-preview` across the plugin.
- [Chat] **Historical Stamps**: AI responses now include labels with the model name, tracked in chat history.
- [Bugfix] **Sync Hardening**: Improved preference synchronization to ensure instant model switching without latency.
- [UI] **Settings Refinement**: Added a quick link to check API quotas and optimized footer styling.

### v0.6.2
- 🎨 **Plugin Icons**: Added official logo support for the Zotero Add-ons Manager.
- 📝 **Description Optimization**: Refined the plugin description to better reflect multi-format support.

### v0.6.1
- ✨ **Quota-Aware Model Selection**: Re-organized model list based on latest Google AI Studio Free Tier RPD (Requests Per Day) limits.
- ✨ **New High-Quota Models**: Added **gemini-3.1-flash-lite (500 RPD)**, **gemma-4-31b (1500 RPD)**, and others.
- ✨ **UI Guidance**: Integrated quota labels directly in the settings dropdown for easy resource management.
- ✨ **Optimized Defaults**: Set `gemini-3.1-flash-lite` as the new default for the best free-tier experience.

### v0.6.0
- ✨ **Multi-format Support**: Added support for **Word (.doc, .docx)** attachments.
- ✨ **Context Menu**: Added right-click menu for messages, supporting individual "Save as Note," "Save as Preset," and "Delete."
- ✨ **Collapsible Messages**: Individual messages can be folded/unfolded. New toolbar toggle for global state.
- ✨ **Note Naming**: Saved notes now use `AI Reading Note - Date Time` format with linked item info.
- ✨ **Preset Upgrades**: Added "Set as Default" for presets and fixed real-time list sync across tabs.
- 🛠️ **UI Refinement**: Steamlined toolbar by removing redundant buttons, added confirmation dialogs for bulk deletions, and fixed model selection sync bug in settings.

### v0.5.1
- 🎨 Optimized loading animations and removed redundant indicators.
- 🐛 Fixed right-click menu error ('doc.body is null') in specific Zotero window environments.

### v0.5.0
- ✨ Initial support for Word attachments.
- ✨ Implemented basic message folding.

### v0.4.0
- ✨ **PDF Reader Context Detection**: Auto-detects the currently open PDF in Zotero's reader and uses it as the chat context, overriding the library selection. Displays a `📖 Reader` badge as confirmation.
- ✨ **Copy Button**: Added a 📋 copy icon to each message bubble with bilingual clipboard feedback.
- 🐛 **Fix**: Delete / Save to Note / Save as Preset now correctly detect checked messages in reader mode (was using stale `getElementById` across document contexts).
- 🐛 **Fix**: New messages and the loading indicator now correctly render in the reader tab's chat panel (was appending to the wrong document context).

### v0.2.0
- ✨ Added copy icon to each message bubble for quick clipboard access.

### v0.1.0
- 🎉 Initial release: chat, preset management, history persistence, and Save to Note.

---

## 🤝 Contributing

If you find a bug or have a suggestion, feel free to open an [Issue](https://github.com/shalom-lab/deepread/issues) or submit a [Pull Request](https://github.com/shalom-lab/deepread/pulls).

## 📜 License

This project is licensed under the [MIT License](LICENSE).

---
<p align="center">Made with ❤️ for Academic Research</p>
