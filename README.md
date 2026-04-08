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
- 👁️‍🗨️ **All-Format Attachment Awareness**: Supports all **PDF, Word (.doc/.docx), and CAJ** attachments. Analyzes content using Gemini's native multimodal or long-context capabilities.
- 💬 **Long-Context Chat**: Massive context window based on Gemini 1.5/2.5 Pro. Ideal for discussing entire books or lengthy reviews.
- 📋 **Message Interaction & Context Menu** *(v0.6.0)*: Supports collapsible messages to save space. Added right-click menu for quick "Save as Note," "Save as Preset," or "Delete" actions for individual messages.
- 🛠️ **Power Preset System**: Built-in academic commands. Manage and extend your Prompt library with a "Set as Default" option.
- 📝 **Smart Note Archive** *(v0.6.0)*: Automatically saves notes with standardized, timestamped titles (e.g., `AI Reading Note - 2026-04-08`).
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
- **Export Result**: Check messages you are interested in and click **Save to Note** ✅.

## 🔐 Data & Privacy

DeepRead prioritizes your data privacy:
- **Zero Cloud**: There is no third-party backend server. Your conversations stay on your machine.
- **Local Database Linking**: Records are mapped locally using the `itemID` (Primary Key) from the internal Zotero SQLite database (`zotero.sqlite`), ensuring persistence even if files are renamed.

---

## 📋 Changelog

### v0.6.0
- ✨ **Multi-format Support**: Added support for **Word (.doc, .docx)** and **CAJ (.caj)** attachments.
- ✨ **Context Menu**: Added right-click menu for messages, supporting individual "Save as Note," "Save as Preset," and "Delete."
- ✨ **Collapsible Messages**: Individual messages can be folded/unfolded. New toolbar toggle for global state.
- ✨ **Note Naming**: Saved notes now use `AI Reading Note - Date Time` format with linked item info.
- ✨ **Preset Upgrades**: Added "Set as Default" for presets and fixed real-time list sync across tabs.
- 🛠️ **UI Refinement**: Steamlined toolbar by removing redundant buttons, added confirmation dialogs for bulk deletions, and fixed model selection sync bug in settings.

### v0.5.1
- 🎨 Optimized loading animations and removed redundant indicators.
- 🐛 Fixed right-click menu error ('doc.body is null') in specific Zotero window environments.

### v0.5.0
- ✨ Initial support for Word and CAJ attachments.
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
