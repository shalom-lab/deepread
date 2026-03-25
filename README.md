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
  <b>English | <a href="README_zh.md">简体中文</a></b>
</p>

<p align="center">
  <b>If you find this plugin useful, please give it a Star on <a href="https://github.com/shalom-lab/deepread">GitHub</a> 🌟. Your support is my greatest motivation!</b>
</p>

---

**DeepRead** is a powerful AI-driven research assistant extension for Zotero 7. Integrated seamlessly into the right-hand Detail Panel (Item Pane), it leverages Gemini's multimodal capabilities to provide a complete workflow from "One-click Summaries" to "Deep Conversations."

## ✨ Key Features

- 🚀 **Deep Integration**: Native Zotero 7 plugin architecture. Read and chat without switching windows.
- 🌐 **Multilingual Support**: Fully supports **English and Chinese** out of the box, matching your Zotero system language automatically.
- 👁️‍🗨️ **Multimodal PDF Awareness**: Automatically loads parent items and **all child PDF attachments**, using Gemini's native multimodal power to analyze original document content.
- 💬 **Long-Context Chat**: Based on Gemini 1.5/2.5 Pro with an massive context window. Ideal for discussing entire books or lengthy reviews.
- 🛠️ **Power Preset System**: Built-in academic commands (Summarize, Data Extraction, etc.). Custom Prompt management included.
- 📁 **Local Persistence**: All chat history and presets are stored locally in your Zotero data directory for privacy.
- 📝 **Save to Note**: Export chat content to Zotero's native notes system with one click for easy citation and organization.

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
4. Enter your API Key and select your preferred model (e.g., `gemini-2.0-flash` or `gemini-1.5-pro`).

## 📖 Usage Guide

### Automatic PDF Packing
The plugin intelligently detects the scope based on your selection:
- **Selected a single PDF**: Precisely analyzes that specific file.
- **Selected a parent Item**: Automatically bundles all child PDF attachments (e.g., Main text + Supplementary materials) for joint analysis.
- **No PDF attachments**: Falling back to context-aware text analysis (Title + Abstract).

### Interaction
- **Run Presets**: Select a preset from the dropdown (e.g., "Deep Read") and click **Run**.
- **Freeform Chat**: Type any question in the bottom input box.
- **Export Result**: Check messages you are interested in and click **Save to Note** ✅.

## 🔐 Data & Privacy

DeepRead prioritizes your data privacy:
- **Zero Cloud**: There is no third-party backend server. Your conversations stay on your machine.
- **Local Database Linking**: Records are mapped locally using the `itemID` (Primary Key) from the internal Zotero SQLite database (`zotero.sqlite`), ensuring persistence even if files are renamed.

---

## 🤝 Contributing

If you find a bug or have a suggestion, feel free to open an [Issue](https://github.com/shalom-lab/deepread/issues) or submit a [Pull Request](https://github.com/shalom-lab/deepread/pulls).

## 📜 License

This project is licensed under the [MIT License](LICENSE).

---
<p align="center">Made with ❤️ for Academic Research</p>
