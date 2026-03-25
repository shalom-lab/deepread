/**
 * DeepRead - 主逻辑模块
 * 参考 Zotero 7 官方模板结构
 * 注意：全局变量 DeepRead 由 bootstrap.js 声明，这里只复用，不再重新 var
 */
DeepRead = {
	id: null,
	version: null,
	rootURI: null,
	initialized: false,
	provider: null,
	chatHistory: new Map(),
	/** @type {string|null} Zotero 7 ItemPaneManager 返回的 section 句柄，shutdown 时 unregister */
	registeredSectionID: null,

	init({ id, version, rootURI }) {
		if (this.initialized) return;
		this.id = id;
		this.version = version;
		this.rootURI = rootURI;
		this.initialized = true;
		// Detect locale once at startup
		this._locale = (typeof Zotero !== "undefined" && Zotero.locale && Zotero.locale.startsWith("zh")) ? "zh" : "en";
	},

	// ── Inline i18n dictionary ──
	_strings: {
		zh: {
			"title-heading": "AI \u8f85\u52a9\u9605\u8bfb",
			"current-item": "\u5f53\u524d\u6587\u732e\uff1a",
			"untitled": "\u672a\u547d\u540d",
			"tab-chat": "\u5bf9\u8bdd",
			"tab-presets": "\u8bbe\u7f6e",
			"presets-header": "\u5df2\u4fdd\u5b58\u7684\u9884\u8bbe\u63d0\u793a\u8bcd(Prompt):",
			"preset-name-placeholder": "\u9884\u8bbe\u540d\u79f0",
			"preset-prompt-placeholder": "Prompt \u5185\u5bb9...",
			"btn-add-preset": "\u65b0\u5efa\u9884\u8bbe",
			"btn-save-changes": "\u4fdd\u5b58\u4fee\u6539",
			"btn-delete-preset": "\u5220\u9664\u9009\u4e2d",
			"btn-run": "\u6267\u884c",
			"btn-running": "\u5904\u7406\u4e2d...",
			"btn-send": "\u53d1\u9001",
			"btn-save-note": "\u5b58\u4e3a\u7b14\u8bb0",
			"btn-save-preset": "\u5b58\u4e3a\u9884\u8bbe",
			"btn-delete-selected": "\u5220\u9664\u9009\u4e2d",
			"btn-clear-all": "\u6e05\u7a7a\u5168\u90e8",
			"select-all": "\u5168\u9009",
			"role-user": "\u60a8",
			"hint-pdf": "\ud83d\udcce \u5c06\u81ea\u52a8\u6302\u8f7d {count} \u4e2a PDF \u9644\u4ef6\u7ed9 AI",
			"hint-no-pdf": "\u26a0\ufe0f \u5f53\u524d\u65e0 PDF \u9644\u4ef6 (\u4ec5\u57fa\u4e8e\u6807\u9898/\u6458\u8981\u5206\u6790)",
			"hint-loading": "\u23f3 AI \u601d\u8003\u4e2d\uff0c\u8bf7\u7a0d\u5019...",
			"input-placeholder": "\u8f93\u5165\u4f60\u60f3\u4e86\u89e3\u7684\u5185\u5bb9\uff0c\u4f8b\u5982\u201c\u5e2e\u6211\u603b\u7ed3\u8fd9\u7bc7\u6587\u7ae0\u201d\u3002",
			"alert-title": "DeepRead",
			"alert-no-apikey": "\u8bf7\u5148\u5728\u8bbe\u7f6e\u4e2d\u914d\u7f6e API Key",
			"alert-empty-fields": "\u540d\u79f0\u548c\u5185\u5bb9\u4e0d\u80fd\u4e3a\u7a7a",
			"alert-add-ok": "\u6dfb\u52a0\u6210\u529f \u2705",
			"alert-save-ok": "\u4fee\u6539\u4fdd\u5b58\u6210\u529f \u2705",
			"alert-delete-ok": "\u5220\u9664\u6210\u529f \ud83d\uddd1\ufe0f",
			"alert-min-presets": "\u81f3\u5c11\u4fdd\u7559\u4e00\u4e2a\u9884\u8bbe",
			"alert-select-first": "\u8bf7\u5148\u5728\u4e0a\u65b9\u5217\u8868\u4e2d\u9009\u62e9\u4e00\u9879",
			"alert-check-note": "\u8bf7\u5148\u52fe\u9009\u8981\u5b58\u4e3a\u7b14\u8bb0\u7684\u6d88\u606f",
			"alert-note-ok": "\u5df2\u6210\u529f\u5c06 {count} \u6761\u6d88\u606f\u5b58\u4e3a\u7b14\u8bb0 \u2705",
			"alert-check-del": "\u8bf7\u5148\u52fe\u9009\u8981\u5220\u9664\u7684\u6d88\u606f",
			"alert-check-preset": "\u8bf7\u5148\u52fe\u9009\u8981\u5b58\u4e3a\u9884\u8bbe\u7684\u6d88\u606f\uff08\u5efa\u8bae\u52fe\u9009\u60a8\u53d1\u9001\u7684\u63d0\u793a\u8bcd\uff09",
			"alert-preset-name-prompt": "\u8bf7\u8f93\u5165\u65b0\u9884\u8bbe\u7684\u540d\u79f0\uff1a",
			"alert-preset-name-default": "\u65b0\u9884\u8bbe",
			"alert-preset-ok": "\u5df2\u6210\u529f\u4fdd\u5b58\u4e3a\u65b0\u9884\u8bbe \"{name}\" \u2705",
			"confirm-clear": "\u786e\u5b9a\u8981\u6e05\u7a7a\u5f53\u524d\u6587\u732e\u7684\u6240\u6709\u5bf9\u8bdd\u8bb0\u5f55\u5417\uff1f\u6b64\u64cd\u4f5c\u4e0d\u53ef\u6062\u590d\u3002",
			"cleared": "\u8bb0\u5f55\u5df2\u6e05\u7a7a\u3002",
			"alert-cleared": "\u5bf9\u8bdd\u8bb0\u5f55\u5df2\u6e05\u7a7a \ud83d\uddd1\ufe0f",
			"render-error": "\u6e32\u67d3\u9519\u8bef",
			"summary-fail": "\u751f\u6210\u6458\u8981\u5931\u8d25\uff1a{error}",
			"extract-fail": "\u63d0\u53d6\u8868\u683c\u6570\u636e\u5931\u8d25\uff1a{error}",
			"send-fail": "\u53d1\u9001\u6d88\u606f\u5931\u8d25\uff1a{error}",
			"run-preset-fail": "\u6267\u884c\u9884\u8bbe\u5931\u8d25\uff1a{error}",
			"note-record": "DeepRead \u5bf9\u8bdd\u8bb0\u5f55",
			"untitled-item": "\u672a\u547d\u540d\u6587\u732e",
			"read-pdf-fail": "\u8bfb\u53d6 PDF \u6587\u4ef6\u5931\u8d25: ",
			"get-pdf-fail": "\u83b7\u53d6 PDF \u5931\u8d25: ",
			"default-preset-name": "\u6df1\u5ea6\u9605\u8bfb",
			"default-preset-prompt": "\u8bf7\u4ed4\u7ec6\u9605\u8bfb\u8fd9\u7bc7\u8bba\u6587\uff0c\u5e76\u6309\u4ee5\u4e0b\u7ed3\u6784\u603b\u7ed3\uff1a\n1. \u7814\u7a76\u80cc\u666f\u4e0e\u65f6\u95f4\u5730\u70b9\n2. \u6838\u5fc3\u95ee\u9898\u4e0e\u7814\u7a76\u76ee\u7684\n3. \u5173\u952e\u7ed3\u679c\u4e0e\u6570\u636e\n4. \u53ef\u501f\u9274\u7684\u7814\u7a76\u65b9\u6cd5\n5. \u8bba\u6587\u7684\u4eae\u70b9\u4e0e\u4e0d\u8db3\n\u8bf7\u4f7f\u7528\u4e2d\u6587\uff0c\u8bed\u8a00\u4e13\u4e1a\u7b80\u6d01\u3002",
			"alert-copy-ok": "\u590d\u5236\u6210\u529f \u2705",
		},
		en: {
			"title-heading": "AI Assisted Reading",
			"current-item": "Current item: ",
			"untitled": "Untitled",
			"tab-chat": "Chat",
			"tab-presets": "Presets",
			"presets-header": "Saved Prompt Presets:",
			"preset-name-placeholder": "Preset Name",
			"preset-prompt-placeholder": "Prompt content...",
			"btn-add-preset": "New Preset",
			"btn-save-changes": "Save Changes",
			"btn-delete-preset": "Delete Selected",
			"btn-run": "Run",
			"btn-running": "Processing...",
			"btn-send": "Send",
			"btn-save-note": "Save to Note",
			"btn-save-preset": "Save as Preset",
			"btn-delete-selected": "Delete Selected",
			"btn-clear-all": "Clear All",
			"select-all": "Select All",
			"role-user": "You",
			"hint-pdf": "\ud83d\udcce Automatically mounting {count} PDF attachment(s) for AI",
			"hint-no-pdf": "\u26a0\ufe0f No PDF attachment (title/abstract only)",
			"hint-loading": "\u23f3 AI is thinking, please wait...",
			"input-placeholder": "Ask anything, e.g. \"Summarize this paper for me.\"",
			"alert-title": "DeepRead",
			"alert-no-apikey": "Please configure your API Key in settings first.",
			"alert-empty-fields": "Name and content cannot be empty.",
			"alert-add-ok": "Added successfully \u2705",
			"alert-save-ok": "Changes saved \u2705",
			"alert-delete-ok": "Deleted \ud83d\uddd1\ufe0f",
			"alert-min-presets": "At least one preset must be kept.",
			"alert-select-first": "Please select an item from the list above first.",
			"alert-check-note": "Please check the messages you want to save as a note.",
			"alert-note-ok": "Successfully saved {count} message(s) as a note \u2705",
			"alert-check-del": "Please check the messages you want to delete.",
			"alert-check-preset": "Please check the messages to save as a preset (recommend selecting your own prompts).",
			"alert-preset-name-prompt": "Enter a name for the new preset:",
			"alert-preset-name-default": "New Preset",
			"alert-preset-ok": "Successfully saved as new preset \"{name}\" \u2705",
			"confirm-clear": "Are you sure you want to clear all chat history for this item? This action cannot be undone.",
			"cleared": "History cleared.",
			"alert-cleared": "Chat history cleared \ud83d\uddd1\ufe0f",
			"render-error": "Render error",
			"summary-fail": "Failed to generate summary: {error}",
			"extract-fail": "Failed to extract data: {error}",
			"send-fail": "Failed to send message: {error}",
			"run-preset-fail": "Failed to run preset: {error}",
			"note-record": "DeepRead Chat Record",
			"untitled-item": "Untitled Item",
			"read-pdf-fail": "Failed to read PDF file: ",
			"get-pdf-fail": "Failed to get PDF: ",
			"default-preset-name": "Deep Read",
			"default-preset-prompt": "Please thoroughly read this paper and summarize it with the following structure:\n1. Research background\n2. Core problems and objectives\n3. Key results and data\n4. Methods worth adopting\n5. Highlights and limitations\nPlease use concise professional language.",
			"alert-copy-ok": "Copied successfully ✅",
		}
	},

	getString(key, params) {
		const dict = this._strings[this._locale] || this._strings["en"];
		let s = dict[key] || key;
		if (params) {
			for (const [k, v] of Object.entries(params)) {
				s = s.replace(`{${k}}`, v);
			}
		}
		return s;
	},

	log(msg) {
		Zotero.logError("DeepRead: " + msg);
	},

	showAlert(title, msg) {
		try {
			let win = null;
			if (typeof Zotero !== "undefined" && Zotero.getMainWindow) {
				win = Zotero.getMainWindow();
			}
			if (win && win.alert) {
				win.alert(title + "\n\n" + msg);
			} else if (typeof Services !== "undefined" && Services.prompt) {
				Services.prompt.alert(win || null, title, msg);
			} else {
				this.log(`ALERT: ${title} - ${msg}`);
			}
		} catch (e) {
			this.log(`showAlert Failed: ${e.message}. Msg was: ${msg}`);
		}
	},

	_getHistoryKey(item) {
		return String(item.id);
	},

	_getOrCreateHistory(item) {
		const key = this._getHistoryKey(item);
		let history = this.chatHistory.get(key);
		if (!history) {
			history = [];
			this.chatHistory.set(key, history);
		}
		return { key, history };
	},

	_appendMessageToUI(msg, msgIndex) {
		try {
			const windows = Zotero.getMainWindows();
			for (let win of windows) {
				const doc = win.document;
				const chatDiv = doc.getElementById("deepread-chat-container");
				if (!chatDiv) continue;
				const msgDiv = this.renderMessage(msg, doc, msgIndex);
				chatDiv.appendChild(msgDiv);
				chatDiv.scrollTop = chatDiv.scrollHeight;
			}
		} catch (e) {
			this.log(`Failed to append message to UI: ${e.message}`);
		}
	},

	_showLoading() {
		try {
			const windows = Zotero.getMainWindows();
			for (let win of windows) {
				const doc = win.document;
				const chatDiv = doc.getElementById("deepread-chat-container");
				if (!chatDiv) continue;
				// 避免重复添加
				if (doc.getElementById("deepread-loading-indicator")) continue;

				const loadingDiv = doc.createElement("div");
				loadingDiv.id = "deepread-loading-indicator";
				loadingDiv.style.cssText = `
					margin-bottom: 10px; padding: 8px; border-radius: 4px;
					background: #fff; border-left: 3px solid #ff9800;
					font-size: 12px; color: #666; display: flex; align-items: center; gap: 8px;
				`;
				// 简单的 CSS 动画转圈
				loadingDiv.innerHTML = `
					<style>@keyframes deepread-spin { 100% { transform: rotate(360deg); } }</style>
					<span style="display:inline-block; animation: deepread-spin 1.5s linear infinite; font-size: 14px;">⏳</span>
					<span>AI 思考中，请稍候...</span>
				`;
				chatDiv.appendChild(loadingDiv);
				chatDiv.scrollTop = chatDiv.scrollHeight;
			}
		} catch (e) {
			this.log(`Failed to show loading: ${e.message}`);
		}
	},

	_hideLoading() {
		try {
			const windows = Zotero.getMainWindows();
			for (let win of windows) {
				const doc = win.document;
				const loadingDiv = doc.getElementById("deepread-loading-indicator");
				if (loadingDiv) loadingDiv.remove();
			}
		} catch (e) {
			this.log(`Failed to hide loading: ${e.message}`);
		}
	},

	_buildItemContextText(item) {
		let parts = [];
		const title = item.getField && item.getField("title");
		if (title) {
			parts.push(`标题：${title}`);
		}
		const abstract = item.getField && item.getField("abstractNote");
		if (abstract) {
			parts.push(`摘要：${abstract}`);
		}
		return parts.join("\n\n") || "该条目目前没有标题或摘要。";
	},

	async _readPdfFile(filePath, pdfData) {
		try {
			let binary = "";
			if (typeof IOUtils !== "undefined") {
				let buffer = await IOUtils.read(filePath);
				for (let i = 0; i < buffer.length; i += 32768) {
					binary += String.fromCharCode.apply(null, buffer.subarray(i, i + 32768));
				}
			} else if (typeof OS !== "undefined" && OS.File) {
				let buffer = await OS.File.read(filePath);
				for (let i = 0; i < buffer.length; i += 32768) {
					binary += String.fromCharCode.apply(null, buffer.subarray(i, i + 32768));
				}
			}

			if (binary) {
				const base64Str = btoa(binary);
				if (!pdfData.files) pdfData.files = [];
				pdfData.files.push({
					base64: base64Str,
					mimeType: "application/pdf"
				});
				// 保持向下兼容，第一份 PDF 仍然写入裸字段
				if (!pdfData.base64) {
					pdfData.base64 = base64Str;
					pdfData.mimeType = "application/pdf";
				}
			}
		} catch (e) {
			this.log(this.getString("read-pdf-fail") + e.message);
		}
		return pdfData;
	},

	async _getPdfData(item) {
		let pdfData = { text: this._buildItemContextText(item), files: [] };
		try {
			// item 本身就是 PDF 附件条目
			if (!item || !item.isRegularItem || !item.isRegularItem()) {
				if (item && item.isPDFAttachment && item.isPDFAttachment()) {
					const filePath = await item.getFilePathAsync();
					if (filePath) pdfData = await this._readPdfFile(filePath, pdfData);
				}
				return pdfData;
			}

			// 普通条目：遍历挂载的所有附件，将所有 PDF 全部加载投喂给 AI
			const ids = item.getAttachments ? item.getAttachments() : [];
			for (const id of ids) {
				const att = Zotero.Items.get(id);
				if (att && att.isPDFAttachment && att.isPDFAttachment()) {
					const filePath = await att.getFilePathAsync();
					if (filePath) pdfData = await this._readPdfFile(filePath, pdfData);
				}
			}
		} catch (e) {
			this.log(this.getString("get-pdf-fail") + e.message);
		}
		return pdfData;
	},

	async initializeProvider() {
		try {
			const config = await this.loadConfig();

			if (config.provider === "gemini" && config.apiKey) {
				// 加载 Provider 类
				if (typeof GeminiProvider === "undefined") {
					Services.scriptloader.loadSubScript(this.rootURI + "providers/BaseAIProvider.js");
					Services.scriptloader.loadSubScript(this.rootURI + "providers/GeminiProvider.js");
				}

				if (typeof GeminiProvider === "undefined") {
					throw new Error("Failed to load GeminiProvider class");
				}

				this.provider = new GeminiProvider({
					apiKey: config.apiKey,
					model: config.model || "gemini-1.5-flash",
					temperature: config.temperature || 0.7,
					maxTokens: config.maxTokens || 4096
				});
				this.log("GeminiProvider initialized successfully");
			} else {
				this.log(`No provider configured (provider: ${config.provider}, hasKey: ${!!config.apiKey})`);
			}
		} catch (error) {
			this.log(`Failed to initialize provider: ${error.message}`);
		}
	},

	async loadConfig() {
		try {
			const apiKey = Zotero.Prefs.get("extensions.deepread.apiKey", true) || "";
			const model = Zotero.Prefs.get("extensions.deepread.model", true) || "gemini-2.5-flash";
			const temperaturePref = Zotero.Prefs.get("extensions.deepread.temperature", true);
			const maxTokensPref = Zotero.Prefs.get("extensions.deepread.maxTokens", true);

			// Zotero 可能把 number 型 preference 存成字符串，需要解析
			const temperature = (typeof temperaturePref === "number")
				? temperaturePref
				: (parseFloat(temperaturePref) || 0.7);
			const maxTokens = (typeof maxTokensPref === "number")
				? maxTokensPref
				: (parseInt(maxTokensPref, 10) || 4096);

			const config = {
				provider: "gemini",
				apiKey,
				model,
				temperature,
				maxTokens
			};

			this.log(`loadConfig: provider=${config.provider}, hasKey=${!!config.apiKey}, model=${config.model}, temperature=${config.temperature}, maxTokens=${config.maxTokens}`);
			return config;
		} catch (error) {
			this.log(`Failed to load config: ${error.message}`);
			return {
				provider: "gemini",
				apiKey: "",
				model: "gemini-2.5-flash",
				temperature: 0.7,
				maxTokens: 4096
			};
		}
	},

	async syncProviderConfig() {
		const config = await this.loadConfig();
		if (this.provider) {
			this.provider.config.apiKey = config.apiKey;
			this.provider.config.model = config.model;
			this.provider.config.temperature = config.temperature;
			this.provider.config.maxTokens = config.maxTokens;
		} else if (config.apiKey) {
			await this.initializeProvider();
		}
	},

	registerItemPane() {
		this.log("registerItemPane called");
		try {
			if (this.registeredSectionID) {
				this.log("registerItemPane skipped (already registered)");
				return;
			}
			this.log("registerItemPane called");
			if (typeof Zotero.ItemPaneManager === "undefined" || typeof Zotero.ItemPaneManager.registerSection !== "function") {
				this.log("ItemPaneManager.registerSection not available");
				return;
			}
			this.registeredSectionID = Zotero.ItemPaneManager.registerSection({
				paneID: "deepread-ai",
				pluginID: "deepread@zotero.org",
				header: {
					l10nID: "deepread-item-pane-header",
					icon: this.rootURI + "images/icon16.png"
				},
				sidenav: {
					l10nID: "deepread-item-pane-header",
					icon: this.rootURI + "images/icon32.png"
				},
				onRender: ({ body, item, editable, tabType }) => {
					this.renderItemPane(body, item, tabType);
				}
			});
			this.log("ItemPane registered using ItemPaneManager.registerSection");
		} catch (error) {
			this.log(`Failed to register ItemPane: ${error.message}\n${error.stack}`);
		}
	},

	unregisterItemPane() {
		try {
			if (this.registeredSectionID != null && typeof Zotero.ItemPaneManager !== "undefined" && typeof Zotero.ItemPaneManager.unregisterSection === "function") {
				Zotero.ItemPaneManager.unregisterSection(this.registeredSectionID);
				this.registeredSectionID = null;
				this.log("ItemPane section unregistered");
			}
		} catch (error) {
			this.log(`Failed to unregister ItemPane: ${error.message}`);
		}
	},

	// ----------- Preset helpers -----------

	_promptsFilePath() {
		return PathUtils.join(Zotero.DataDirectory.dir, "deepread_prompts.json");
	},

	async loadPromptPresets() {
		const DEFAULT_PRESETS = [{
			name: this.getString("default-preset-name"),
			prompt: this.getString("default-preset-prompt")
		}];
		try {
			const fp = this._promptsFilePath();
			if (await IOUtils.exists(fp)) {
				const text = await IOUtils.readUTF8(fp);
				const saved = JSON.parse(text);
				if (Array.isArray(saved) && saved.length > 0) return saved;
			}
		} catch (e) {
			this.log("loadPromptPresets failed: " + e.message);
		}
		// 首次使用：写入文件让设置页也能看到
		try {
			await IOUtils.writeUTF8(this._promptsFilePath(), JSON.stringify(DEFAULT_PRESETS));
		} catch (e) { }
		return DEFAULT_PRESETS;
	},

	async savePromptPresets(presets) {
		try {
			await IOUtils.writeUTF8(this._promptsFilePath(), JSON.stringify(presets));
			return true;
		} catch (e) {
			this.log("savePromptPresets failed: " + e.message);
			throw e;
		}
	},

	// ----------- Item Pane Rendering -----------

	/**
	 * 尝试获取当前正在阅读的 PDF 附件条目。
	 * 利用 Zotero.Reader.getByTabID + Zotero_Tabs.selectedID 实现。
	 * @param {Document} doc
	 * @returns {{ readerItem: ZoteroItem|null, readerTitle: string }}
	 */
	_getActiveReaderItem(doc) {
		try {
			const win = doc ? doc.defaultView : (Zotero.getMainWindow ? Zotero.getMainWindow() : null);
			if (!win) return { readerItem: null, readerTitle: "" };
			// Zotero_Tabs 是挂在 window 上的全局对象
			const tabs = win.Zotero_Tabs;
			if (!tabs || !tabs.selectedID) return { readerItem: null, readerTitle: "" };
			const reader = Zotero.Reader.getByTabID(tabs.selectedID);
			if (!reader) return { readerItem: null, readerTitle: "" };
			const readerItem = Zotero.Items.get(reader.itemID);
			if (!readerItem) return { readerItem: null, readerTitle: "" };
			// 优先取附件自身标题，再取父条目标题
			let readerTitle = "";
			try {
				readerTitle = readerItem.getField && readerItem.getField("title");
				if (!readerTitle && readerItem.parentItemID) {
					const parent = Zotero.Items.get(readerItem.parentItemID);
					if (parent) readerTitle = parent.getField("title");
				}
			} catch(e) {}
			return { readerItem, readerTitle: readerTitle || "" };
		} catch(e) {
			this.log("_getActiveReaderItem failed: " + e.message);
			return { readerItem: null, readerTitle: "" };
		}
	},

	async renderItemPane(pane, item, tabType) {
		try {
			pane.innerHTML = "";
			const doc = pane.ownerDocument;

			// ── 优先使用正在阅读的 PDF ──
			const { readerItem, readerTitle } = this._getActiveReaderItem(doc);
			let effectiveItem = item;
			let isFromReader = false;
			if (readerItem) {
				effectiveItem = readerItem;
				isFromReader = true;
			}

			const container = doc.createElement("div");
			container.id = "deepread-itempane-container";
			container.style.cssText = `
				padding: 12px 14px;
				height: 100%;
				display: flex;
				flex-direction: column;
				box-sizing: border-box;
				gap: 8px;
				background: linear-gradient(180deg, #fafafa 0%, #ffffff 40%);
			`;

			// 标题区域
			const titleDiv = doc.createElement("div");
			const _t = (k, p) => this.getString(k, p);
			// 显示来源标记
			const readerBadge = isFromReader
				? `<span style="display:inline-block;background:#e8f5e9;color:#2e7d32;font-size:10px;padding:1px 5px;border-radius:3px;border:1px solid #c8e6c9;margin-left:5px;vertical-align:middle;">
					${this._locale === 'zh' ? '📖 阅读器' : '📖 Reader'}</span>`
				: "";
			const displayTitle = (() => {
				try { return effectiveItem.getField("title") || _t("untitled"); } catch(e) { return _t("untitled"); }
			})();
			titleDiv.innerHTML = `
				<h3 style="margin: 0 0 4px 0; font-size: 14px; font-weight: 600; color: #c0392b; display:flex; align-items:center;">
					${_t("title-heading")}${readerBadge}
				</h3>
				<p style="margin: 0; font-size: 11px; color: #777; line-height: 1.4;">
					${_t("current-item")}<span style="font-weight: 500; color: #444;">${displayTitle}</span>
				</p>
			`;
			container.appendChild(titleDiv);

			// ── 选项卡区域 ─────────────────────────────────────
			const tabHeaderRow = doc.createElement("div");
			tabHeaderRow.style.cssText = `display: flex; gap: 10px; border-bottom: 2px solid #eaeaea; margin-bottom: 8px;`;

			const createTabBtn = (text, onClick, isActive = false) => {
				const btn = doc.createElement("button");
				btn.textContent = text;
				btn.style.cssText = `
					background: none; border: none; padding: 4px 8px; font-size: 13px; font-weight: 600; cursor: pointer;
					color: ${isActive ? '#c0392b' : '#777'}; border-bottom: 2px solid ${isActive ? '#c0392b' : 'transparent'}; margin-bottom: -2px;
				`;
				btn.addEventListener("click", () => {
					Array.from(tabHeaderRow.children).forEach(c => {
						c.style.color = '#777';
						c.style.borderBottomColor = 'transparent';
					});
					btn.style.color = '#c0392b';
					btn.style.borderBottomColor = '#c0392b';
					onClick();
				});
				return btn;
			};

			const chatTabContent = doc.createElement("div");
			chatTabContent.style.cssText = `display: flex; flex-direction: column; flex: 1; min-height: 0;`;

			const presetTabContent = doc.createElement("div");
			presetTabContent.style.cssText = `display: none; flex-direction: column; flex: 1; min-height: 0; gap: 8px;`;

			const tabChatBtn = createTabBtn(_t("tab-chat"), () => {
				chatTabContent.style.display = "flex";
				presetTabContent.style.display = "none";
			}, true);

			const tabPresetBtn = createTabBtn(_t("tab-presets"), () => {
				chatTabContent.style.display = "none";
				presetTabContent.style.display = "flex";
				refreshManageList(); // 每次切换过去时刷新列表
			});

			tabHeaderRow.appendChild(tabChatBtn);
			tabHeaderRow.appendChild(tabPresetBtn);
			container.appendChild(tabHeaderRow);

			// ==================== 预设管理 Tab (presetTabContent) ====================
			let presets = await this.loadPromptPresets();

			const manageListBox = doc.createElement("select");
			manageListBox.size = 6;
			manageListBox.style.cssText = `width: 100%; font-size: 12px; padding: 4px; border: 1px solid #ccc; border-radius: 4px; outline: none;`;

			const mNameInput = doc.createElement("input");
			mNameInput.type = "text";
			mNameInput.placeholder = _t("preset-name-placeholder");
			mNameInput.style.cssText = `width: 100%; font-size: 12px; padding: 4px; box-sizing: border-box;`;

			const mPromptInput = doc.createElement("textarea");
			mPromptInput.placeholder = _t("preset-prompt-placeholder");
			mPromptInput.style.cssText = `width: 100%; min-height: 80px; max-height: 400px; font-size: 12px; padding: 4px; resize: vertical; box-sizing: border-box;`;

			const mBtnRow = doc.createElement("div");
			mBtnRow.style.cssText = `display: flex; gap: 6px;`;

			const mAddBtn = doc.createElement("button");
			mAddBtn.textContent = _t("btn-add-preset");
			mAddBtn.className = "zotero-button";
			mAddBtn.style.cssText = `flex: 1; padding: 4px; cursor: pointer; color: #1565c0;`;

			const mSaveBtn = doc.createElement("button");
			mSaveBtn.textContent = _t("btn-save-changes");
			mSaveBtn.className = "zotero-button";
			mSaveBtn.style.cssText = `flex: 1; padding: 4px; cursor: pointer;`;

			const mDelBtn = doc.createElement("button");
			mDelBtn.textContent = _t("btn-delete-preset");
			mDelBtn.className = "zotero-button";
			mDelBtn.style.cssText = `flex: 1; padding: 4px; cursor: pointer; color: #b71c1c;`;

			mBtnRow.appendChild(mAddBtn);
			mBtnRow.appendChild(mSaveBtn);
			mBtnRow.appendChild(mDelBtn);

			presetTabContent.appendChild(doc.createTextNode(_t("presets-header")));
			presetTabContent.appendChild(manageListBox);
			presetTabContent.appendChild(mNameInput);
			presetTabContent.appendChild(mPromptInput);
			presetTabContent.appendChild(mBtnRow);
			container.appendChild(presetTabContent);

			// 管理列表联动
			const refreshManageList = () => {
				manageListBox.innerHTML = "";
				presets.forEach((p, i) => {
					const opt = doc.createElement("option");
					opt.value = String(i);
					opt.textContent = p.name;
					manageListBox.appendChild(opt);
				});
				refreshSelect(); // 同时刷新聊天页的下拉框
			};

			manageListBox.addEventListener("change", () => {
				const idx = parseInt(manageListBox.value, 10);
				if (presets[idx]) {
					mNameInput.value = presets[idx].name;
					mPromptInput.value = presets[idx].prompt;
				}
			});

			mAddBtn.addEventListener("click", async () => {
				const name = mNameInput.value.trim();
				const prompt = mPromptInput.value.trim();
				if (!name || !prompt) { this.showAlert(this.getString("alert-title"), this.getString("alert-empty-fields")); return; }
				presets.push({ name, prompt });
				await this.savePromptPresets(presets);
				refreshManageList();
				manageListBox.value = String(presets.length - 1);
				this.showAlert(this.getString("alert-title"), this.getString("alert-add-ok"));
			});

			mSaveBtn.addEventListener("click", async () => {
				const idx = parseInt(manageListBox.value, 10);
				if (isNaN(idx) || !presets[idx]) { this.showAlert("DeepRead", "请先在上方列表中选择一项"); return; }
				const name = mNameInput.value.trim();
				const prompt = mPromptInput.value.trim();
				if (!name || !prompt) { this.showAlert("DeepRead", "名称和内容不能为空"); return; }
				presets[idx] = { name, prompt };
				await this.savePromptPresets(presets);
				refreshManageList();
				manageListBox.value = String(idx);
				this.showAlert(this.getString("alert-title"), this.getString("alert-save-ok"));
			});

			mDelBtn.addEventListener("click", async () => {
				const idx = parseInt(manageListBox.value, 10);
				if (isNaN(idx) || !presets[idx]) return;
				if (presets.length <= 1) { this.showAlert(this.getString("alert-title"), this.getString("alert-min-presets")); return; }
				presets.splice(idx, 1);
				await this.savePromptPresets(presets);
				refreshManageList();
				mNameInput.value = "";
				mPromptInput.value = "";
				this.showAlert(this.getString("alert-title"), this.getString("alert-delete-ok"));
			});

			// ==================== 对话阅读 Tab (chatTabContent) ====================

			// ── 附件提示区域 ──
			let pdfCount = 0;
			if (effectiveItem) {
				if (effectiveItem.isRegularItem && effectiveItem.isRegularItem()) {
					const ids = effectiveItem.getAttachments ? effectiveItem.getAttachments() : [];
					for (const id of ids) {
						const att = Zotero.Items.get(id);
						if (att && att.isPDFAttachment && att.isPDFAttachment()) pdfCount++;
					}
				} else if (effectiveItem.isPDFAttachment && effectiveItem.isPDFAttachment()) {
					pdfCount = 1;
				}
			}

			const hintDiv = doc.createElement("div");
			if (pdfCount > 0) {
				hintDiv.style.cssText = `font-size: 10px; color: #1565c0; background: #e3f2fd; padding: 3px 8px; border-radius: 4px; margin-bottom: 8px; display: inline-block; align-self: flex-start; border: 1px solid #bbdefb;`;
				hintDiv.textContent = _t("hint-pdf", { count: pdfCount });
			} else {
				hintDiv.style.cssText = `font-size: 10px; color: #e65100; background: #fff3e0; padding: 3px 8px; border-radius: 4px; margin-bottom: 8px; display: inline-block; align-self: flex-start; border: 1px solid #ffe0b2;`;
				hintDiv.textContent = _t("hint-no-pdf");
			}
			chatTabContent.appendChild(hintDiv);

			// ── 预设下拉区域 ──
			const presetRow = doc.createElement("div");
			presetRow.style.cssText = `display: flex; gap: 6px; align-items: center; margin-bottom: 6px;`;

			const presetSelect = doc.createElement("select");
			presetSelect.id = "deepread-preset-select";
			presetSelect.style.cssText = `flex: 1; font-size: 12px; padding: 3px 6px; border: 1px solid rgba(0,0,0,0.15); border-radius: 4px;`;

			const refreshSelect = () => {
				const currentVal = presetSelect.value;
				presetSelect.innerHTML = "";
				presets.forEach((p, i) => {
					const opt = doc.createElement("option");
					opt.value = String(i);
					opt.textContent = p.name;
					presetSelect.appendChild(opt);
				});
				if (currentVal) presetSelect.value = currentVal;
			};
			refreshSelect();

			const runBtn = doc.createElement("button");
			runBtn.textContent = _t("btn-run");
			runBtn.className = "zotero-button";
			runBtn.style.cssText = `padding: 4px 10px; font-size: 11px; cursor: pointer; white-space: nowrap;`;
			runBtn.addEventListener("click", async () => {
				const idx = parseInt(presetSelect.value, 10);
				const preset = presets[idx];
				if (!preset) return;
				try {
					runBtn.disabled = true;
					runBtn.textContent = _t("btn-running");
					await this.handleRunPreset(effectiveItem, preset);
				} catch (e) {
					this.showAlert("Error", e.message || String(e));
				} finally {
					runBtn.disabled = false;
					runBtn.textContent = _t("btn-run");
				}
			});
			presetRow.appendChild(presetSelect);
			presetRow.appendChild(runBtn);
			chatTabContent.appendChild(presetRow);

			// ── 历史管理工具栏 ────────────────────────────────
			const toolbarDiv = doc.createElement("div");
			toolbarDiv.style.cssText = `display: flex; gap: 6px; align-items: center; flex-wrap: wrap;`;

			// 全选复选框
			const selectAllLabel = doc.createElement("label");
			selectAllLabel.style.cssText = `display: flex; align-items: center; gap: 3px; font-size: 11px; color: #555; cursor: pointer;`;
			const selectAllCb = doc.createElement("input");
			selectAllCb.type = "checkbox";
			selectAllCb.id = "deepread-select-all";
			selectAllCb.addEventListener("change", () => {
				const chatDiv = doc.getElementById("deepread-chat-container");
				if (!chatDiv) return;
				chatDiv.querySelectorAll(".deepread-msg-cb").forEach(cb => { cb.checked = selectAllCb.checked; });
			});
			selectAllLabel.appendChild(selectAllCb);
			selectAllLabel.appendChild(doc.createTextNode(_t("select-all")));
			toolbarDiv.appendChild(selectAllLabel);

			const makeToolBtn = (label, style) => {
				const b = doc.createElement("button");
				b.textContent = label;
				b.className = "zotero-button";
				b.style.cssText = `padding: 3px 8px; font-size: 11px; cursor: pointer; ${style || ""}`;
				return b;
			};

			const saveNoteBtn = makeToolBtn(_t("btn-save-note"), "color: #1565c0;");
			saveNoteBtn.addEventListener("click", async () => {
				try {
					saveNoteBtn.disabled = true;
					await this.handleSaveAsNote(effectiveItem, doc);
				} catch (e) {
					this.showAlert("Error", e.message || String(e));
				} finally {
					saveNoteBtn.disabled = false;
				}
			});
			toolbarDiv.appendChild(saveNoteBtn);

			const savePromptBtn = makeToolBtn(_t("btn-save-preset"), "color: #1565c0;");
			savePromptBtn.addEventListener("click", async () => {
				try {
					savePromptBtn.disabled = true;
					await this.handleSaveAsPrompt(effectiveItem, doc, refreshSelect);
				} catch (e) {
					this.showAlert("Error", e.message || String(e));
				} finally {
					savePromptBtn.disabled = false;
				}
			});
			toolbarDiv.appendChild(savePromptBtn);

			const deleteSelBtn = makeToolBtn(_t("btn-delete-selected"), "color: #b71c1c;");
			deleteSelBtn.addEventListener("click", () => {
				this.handleDeleteSelected(effectiveItem, doc);
				if (selectAllCb) selectAllCb.checked = false;
			});
			toolbarDiv.appendChild(deleteSelBtn);

			const clearAllBtn = makeToolBtn(_t("btn-clear-all"), "color: #b71c1c;");
			clearAllBtn.addEventListener("click", () => {
				this.handleClearHistory(effectiveItem, doc);
				if (selectAllCb) selectAllCb.checked = false;
			});
			toolbarDiv.appendChild(clearAllBtn);

			chatTabContent.appendChild(toolbarDiv);

			// ── 聊天区域 ─────────────────────────────────────
			const chatDiv = doc.createElement("div");
			chatDiv.id = "deepread-chat-container";
			chatDiv.style.cssText = `
				flex: 1;
				overflow-y: auto;
				border: 1px solid rgba(0,0,0,0.08);
				border-radius: 6px;
				padding: 8px 10px;
				background: #ffffff;
				box-shadow: 0 1px 2px rgba(0,0,0,0.04);
				margin-bottom: 4px;
			`;

			const historyKey = String(effectiveItem.id);
			const history = this.chatHistory.get(historyKey) || [];
			history.forEach((msg, idx) => {
				const msgDiv = this.renderMessage(msg, doc, idx);
				chatDiv.appendChild(msgDiv);
			});

			chatTabContent.appendChild(chatDiv);

			// 输入区域
			const inputDiv = doc.createElement("div");
			inputDiv.style.cssText = `
				display: flex;
				flex-direction: column;
				gap: 6px;
			`;

			const input = doc.createElement("textarea");
			input.id = "deepread-chat-input";
			input.placeholder = _t("input-placeholder");
			input.style.cssText = `
				width: 100%;
				min-height: 60px;
				max-height: 120px;
				padding: 6px 8px;
				border: 1px solid rgba(0,0,0,0.12);
				border-radius: 4px;
				font-size: 12px;
				resize: vertical;
				box-sizing: border-box;
			`;

			const sendBtn = doc.createElement("button");
			sendBtn.textContent = _t("btn-send");
			sendBtn.className = "zotero-button";
			sendBtn.style.cssText = `
				padding: 6px 18px;
				font-size: 12px;
				cursor: pointer;
				white-space: nowrap;
				align-self: flex-end;
			`;
			sendBtn.addEventListener("click", async () => {
				const message = input.value.trim();
				if (message) {
					try {
						sendBtn.disabled = true;
						input.value = "";
						await this.handleSendMessage(effectiveItem, message);
					} catch (e) {
						this.showAlert("Error", e.message || String(e));
						input.value = message; // restore message
					} finally {
						sendBtn.disabled = false;
					}
				}
			});

			inputDiv.appendChild(input);
			inputDiv.appendChild(sendBtn); // Assuming sendWrapper is not defined, keeping sendBtn
			chatTabContent.appendChild(inputDiv);

			container.appendChild(chatTabContent);

			// =========================================================================

			// 延迟滚动到底部
			doc.defaultView.setTimeout(() => {
				const chatContainer = doc.getElementById("deepread-chat-container");
				if (chatContainer) {
					chatContainer.scrollTop = chatContainer.scrollHeight;
				}
			}, 100);

			pane.appendChild(container);
		} catch (error) {
			this.log(`Failed to render ItemPane: ${error.message}`);
			pane.innerHTML = `<div style="padding: 10px; color: red;">${this.getString("render-error")}: ${error.message}</div>`;
		}
	},

	renderMessage(msg, doc, msgIndex) {
		if (!doc) {
			const win = typeof Zotero !== "undefined" && Zotero.getMainWindow ? Zotero.getMainWindow() : null;
			doc = win ? win.document : null;
		}
		if (!doc) throw new Error("Document object not found");

		const msgDiv = doc.createElement("div");
		msgDiv.className = "deepread-msg-wrapper";
		if (msgIndex !== undefined) msgDiv.setAttribute("data-index", String(msgIndex));
		msgDiv.style.cssText = `
			margin-bottom: 10px;
			padding: 8px;
			border-radius: 4px;
			background: ${msg.role === "user" ? "#e3f2fd" : "#fff"};
			border-left: 3px solid ${msg.role === "user" ? "#2196f3" : "#4caf50"};
			position: relative;
		`;

		// 复选框和复制按钮容器（右上角）
		const actionContainer = doc.createElement("div");
		actionContainer.style.cssText = `position: absolute; top: 4px; right: 6px; display: flex; align-items: center; gap: 8px;`;

		// 复制按钮
		const copyBtn = doc.createElement("div");
		//copyBtn.title = "Copy content / 复制内容";
		copyBtn.style.cssText = `cursor: pointer; display: flex; align-items: center; opacity: 0.6; transition: opacity 0.2s; font-size: 13px; line-height: 1;`;
		// 使用 Unicode 图标，避免 XUL 文档 innerHTML 不解析 SVG 的问题
		const copyIcon = doc.createTextNode("\uD83D\uDCCB");
		copyBtn.appendChild(copyIcon);
		copyBtn.onmouseover = () => { copyBtn.style.opacity = "1"; };
		copyBtn.onmouseout = () => { copyBtn.style.opacity = "0.6"; };
		copyBtn.addEventListener("click", (e) => {
			e.preventDefault();
			e.stopPropagation();
			const text = msg.content;
			if (typeof Zotero !== "undefined" && Zotero.getMainWindow) {
				try {
					const clipboardHelper = Components.classes["@mozilla.org/widget/clipboardhelper;1"]
						.getService(Components.interfaces.nsIClipboardHelper);
					clipboardHelper.copyString(text);
					this.showAlert(this.getString("alert-title"), this.getString("alert-copy-ok"));
				} catch (err) {
					// 兜底方案
					const input = doc.createElement("textarea");
					input.style.position = "fixed";
					input.style.opacity = "0";
					input.value = text;
					doc.body.appendChild(input);
					input.select();
					doc.execCommand("copy");
					doc.body.removeChild(input);
					this.showAlert(this.getString("alert-title"), this.getString("alert-copy-ok"));
				}
			}
		});

		// 复选框
		const cbLabel = doc.createElement("label");
		cbLabel.style.cssText = `display: flex; align-items: center; cursor: pointer;`;
		const cb = doc.createElement("input");
		cb.type = "checkbox";
		cb.className = "deepread-msg-cb";
		cbLabel.appendChild(cb);

		actionContainer.appendChild(copyBtn);
		actionContainer.appendChild(cbLabel);
		msgDiv.appendChild(actionContainer);

		const roleSpan = doc.createElement("div");
		roleSpan.textContent = msg.role === "user" ? this.getString("role-user") : "AI";
		roleSpan.style.cssText = `font-weight: bold; font-size: 11px; color: #666; margin-bottom: 4px; padding-right: 20px;`;

		const contentDiv = doc.createElement("div");
		contentDiv.textContent = msg.content;
		contentDiv.style.cssText = `font-size: 12px; line-height: 1.5; white-space: pre-wrap; word-wrap: break-word;`;

		msgDiv.appendChild(roleSpan);
		msgDiv.appendChild(contentDiv);
		return msgDiv;
	},

	async handleGenerateSummary(item) {
		await this.syncProviderConfig();
		if (!this.provider || !this.provider.config.apiKey) {
			this.showAlert("DeepRead", "请先在设置中配置 API Key");
			return;
		}
		try {
			this._showLoading();
			const pdfData = await this._getPdfData(item);
			const result = await this.provider.generateSummary(pdfData, { language: "zh", length: "medium" });
			const { key, history } = this._getOrCreateHistory(item);
			const msg = { role: "assistant", content: `【摘要】\n${result.content}` };
			history.push(msg);
			this.chatHistory.set(key, history);
			this.saveChatHistory();
			this._hideLoading();
			this._appendMessageToUI(msg);
			this.log("Generate summary completed");
		} catch (error) {
			this._hideLoading();
			this.log(`Generate summary failed: ${error.message}`);
			this.showAlert(this.getString("alert-title"), this.getString("summary-fail", { error: error.message }));
		}
	},

	async handleExtractNumbers(item) {
		await this.syncProviderConfig();
		if (!this.provider || !this.provider.config.apiKey) {
			this.showAlert("DeepRead", "请先在设置中配置 API Key");
			return;
		}
		try {
			this._showLoading();
			const pdfData = await this._getPdfData(item);
			const result = await this.provider.extractNumbers(pdfData, {});
			const pretty = typeof result === "string" ? result : JSON.stringify(result, null, 2);
			const { key, history } = this._getOrCreateHistory(item);
			const msg = { role: "assistant", content: `【表格提取】\n${pretty}` };
			history.push(msg);
			this.chatHistory.set(key, history);
			this.saveChatHistory();
			this._hideLoading();
			this._appendMessageToUI(msg);
			this.log("Extract numbers completed");
		} catch (error) {
			this._hideLoading();
			this.log(`Extract numbers failed: ${error.message}`);
			this.showAlert(this.getString("alert-title"), this.getString("extract-fail", { error: error.message }));
		}
	},

	async handleSendMessage(item, message) {
		await this.syncProviderConfig();
		if (!this.provider || !this.provider.config.apiKey) {
			this.showAlert("DeepRead", "请先在设置中配置 API Key");
			return;
		}
		try {
			const pdfData = await this._getPdfData(item);
			const { key, history } = this._getOrCreateHistory(item);
			const userMsg = { role: "user", content: message };
			history.push(userMsg);
			this.chatHistory.set(key, history);
			this.saveChatHistory();
			this._appendMessageToUI(userMsg, history.length - 1);
			this.log(`Send message: ${message}`);

			this._showLoading();
			const result = await this.provider.chat(history, {}, pdfData);
			const assistantMsg = { role: "assistant", content: result.content };
			history.push(assistantMsg);
			this.chatHistory.set(key, history);
			this.saveChatHistory();
			this._hideLoading();
			this._appendMessageToUI(assistantMsg, history.length - 1);
		} catch (error) {
			this._hideLoading();
			this.log(`Send message failed: ${error.message}`);
			this.showAlert(this.getString("alert-title"), this.getString("send-fail", { error: error.message }));
		}
	},

	// ──────────────────────────────────────────────
	// 预设快捷执行
	// ──────────────────────────────────────────────
	async handleRunPreset(item, preset) {
		await this.syncProviderConfig();
		if (!this.provider || !this.provider.config.apiKey) {
			this.showAlert("DeepRead", "请先在设置中配置 API Key");
			return;
		}
		try {
			const pdfData = await this._getPdfData(item);
			const { key, history } = this._getOrCreateHistory(item);
			const userMsg = { role: "user", content: preset.prompt };
			history.push(userMsg);
			this.chatHistory.set(key, history);
			this.saveChatHistory();
			this._appendMessageToUI(userMsg, history.length - 1);
			this.log(`Run preset: ${preset.name}`);

			this._showLoading();
			const result = await this.provider.chat(history, {}, pdfData);
			const assistantMsg = { role: "assistant", content: result.content };
			history.push(assistantMsg);
			this.chatHistory.set(key, history);
			this.saveChatHistory();
			this._hideLoading();
			this._appendMessageToUI(assistantMsg, history.length - 1);
		} catch (error) {
			this._hideLoading();
			this.log(`Run preset failed: ${error.message}`);
			this.showAlert(this.getString("alert-title"), this.getString("run-preset-fail", { error: error.message }));
		}
	},

	// ──────────────────────────────────────────────
	// 存为 Zotero 笔记
	// ──────────────────────────────────────────────
	async handleSaveAsNote(item, doc) {
		const chatDiv = doc.getElementById("deepread-chat-container");
		if (!chatDiv) return;

		const checked = [];
		chatDiv.querySelectorAll(".deepread-msg-wrapper").forEach(wrapper => {
			const cb = wrapper.querySelector(".deepread-msg-cb");
			if (cb && cb.checked) {
				const idx = parseInt(wrapper.getAttribute("data-index"), 10);
				checked.push(idx);
			}
		});

		if (checked.length === 0) {
			this.showAlert(this.getString("alert-title"), this.getString("alert-check-note"));
			return;
		}

		const history = this.chatHistory.get(String(item.id)) || [];
		const lines = checked
			.sort((a, b) => a - b)
			.map(idx => {
				const msg = history[idx];
				if (!msg) return "";
				const roleLabel = msg.role === "user" ? `**${this.getString("role-user")}**` : "**AI**";
				return `${roleLabel}\n\n${msg.content}`;
			})
			.filter(Boolean)
			.join("\n\n---\n\n");

		const title = item.getField && item.getField("title") || this.getString("untitled-item");
		const noteContent = `<h2>${this.getString("note-record")} - ${title}</h2><pre style="white-space:pre-wrap;font-family:sans-serif;">${lines.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")}</pre>`;

		try {
			const note = new Zotero.Item("note");
			note.libraryID = item.libraryID;
			// 如果当前 item 是附件（比如 PDF），则挂载到它的父条目上
			note.parentID = item.isAttachment() ? item.parentItemID : item.id;
			note.setNote(noteContent);
			await note.saveTx();
			this.showAlert(this.getString("alert-title"), this.getString("alert-note-ok", { count: checked.length }));
			// 取消勾选
			chatDiv.querySelectorAll(".deepread-msg-cb").forEach(cb => { cb.checked = false; });
			const selectAll = doc.getElementById("deepread-select-all");
			if (selectAll) selectAll.checked = false;
		} catch (error) {
			this.log(`Save as note failed: ${error.message}`);
			throw error;
		}
	},

	// ──────────────────────────────────────────────
	// 存为预设 (Prompt)
	// ──────────────────────────────────────────────
	async handleSaveAsPrompt(item, doc, refreshSelectCallback) {
		const chatDiv = doc.getElementById("deepread-chat-container");
		if (!chatDiv) return;

		const checked = [];
		chatDiv.querySelectorAll(".deepread-msg-wrapper").forEach(wrapper => {
			const cb = wrapper.querySelector(".deepread-msg-cb");
			if (cb && cb.checked) {
				const idx = parseInt(wrapper.getAttribute("data-index"), 10);
				checked.push(idx);
			}
		});

		if (checked.length === 0) {
			this.showAlert(this.getString("alert-title"), this.getString("alert-check-preset"));
			return;
		}

		const history = this.chatHistory.get(String(item.id)) || [];
		const promptContent = checked
			.sort((a, b) => a - b)
			.map(idx => history[idx] ? history[idx].content : "")
			.filter(Boolean)
			.join("\n\n");

		if (!promptContent) return;

		// 弹出原生对话框要求输入名称
		const win = doc.defaultView || Zotero.getMainWindow();
		const name = win.prompt(this.getString("alert-preset-name-prompt"), this.getString("alert-preset-name-default"));
		if (!name) return; // 用户取消

		const presets = await this.loadPromptPresets();
		presets.push({ name: name.trim(), prompt: promptContent.trim() });
		await this.savePromptPresets(presets);

		if (refreshSelectCallback) refreshSelectCallback();

		const selectAll = doc.getElementById("deepread-select-all");
		if (selectAll) selectAll.checked = false;
		chatDiv.querySelectorAll(".deepread-msg-cb").forEach(cb => { cb.checked = false; });
		this.showAlert(this.getString("alert-title"), this.getString("alert-preset-ok", { name }));
	},

	// ──────────────────────────────────────────────
	// 删除选中消息
	// ──────────────────────────────────────────────
	handleDeleteSelected(item, doc) {
		const chatDiv = doc.getElementById("deepread-chat-container");
		if (!chatDiv) return;

		const toDelete = new Set();
		chatDiv.querySelectorAll(".deepread-msg-wrapper").forEach(wrapper => {
			const cb = wrapper.querySelector(".deepread-msg-cb");
			if (cb && cb.checked) {
				toDelete.add(parseInt(wrapper.getAttribute("data-index"), 10));
			}
		});

		if (toDelete.size === 0) {
			this.showAlert(this.getString("alert-title"), this.getString("alert-check-del"));
			return;
		}

		const key = String(item.id);
		const history = this.chatHistory.get(key) || [];
		const newHistory = history.filter((_, i) => !toDelete.has(i));
		this.chatHistory.set(key, newHistory);
		this.saveChatHistory();

		// 重新渲染聊天列表
		chatDiv.innerHTML = "";
		newHistory.forEach((msg, idx) => {
			const msgDiv = this.renderMessage(msg, doc, idx);
			chatDiv.appendChild(msgDiv);
		});
	},

	// ──────────────────────────────────────────────
	// 清空全部记录
	// ──────────────────────────────────────────────
	handleClearHistory(item, doc) {
		const win = doc.defaultView || Zotero.getMainWindow();
		if (!win.confirm(this.getString("confirm-clear"))) {
			return;
		}

		const key = String(item.id);
		this.chatHistory.set(key, []);
		this.saveChatHistory();
		const chatDiv = doc.getElementById("deepread-chat-container");
		if (chatDiv) chatDiv.innerHTML = `<div style="text-align: center; color: #aaa; margin-top: 10px; font-size: 11px;">${this.getString("cleared")}</div>`;
		this.showAlert(this.getString("alert-title"), this.getString("alert-cleared"));
	},


	async main() {
		await this.loadChatHistory();
		await this.initializeProvider();
		// ItemPane 注册移到 onMainWindowLoad 中，因为 API 可能只在窗口加载后可用
		// this.registerItemPane();
	},

	_historyFilePath() {
		return PathUtils.join(Zotero.DataDirectory.dir, "deepread_history.json");
	},

	async loadChatHistory() {
		try {
			const filePath = this._historyFilePath();
			if (await IOUtils.exists(filePath)) {
				const text = await IOUtils.readUTF8(filePath);
				const obj = JSON.parse(text);
				this.chatHistory = new Map(Object.entries(obj));
				this.log(`Chat history loaded from file (${this.chatHistory.size} items)`);
			} else {
				// 迁移：如果 prefs 里有旧数据，读取后写入文件并清除 prefs
				const legacy = Zotero.Prefs.get("extensions.deepread.history", true);
				if (legacy) {
					this.chatHistory = new Map(Object.entries(JSON.parse(legacy)));
					this.saveChatHistory(); // 写入文件
					Zotero.Prefs.clear("extensions.deepread.history"); // 清除旧 prefs
					this.log("Migrated chat history from prefs to file");
				}
			}
		} catch (error) {
			this.log(`Failed to load chat history: ${error.message}`);
		}
	},

	saveChatHistory() {
		try {
			const filePath = this._historyFilePath();
			const json = JSON.stringify(Object.fromEntries(this.chatHistory));
			// 异步写入，不阻塞 UI
			IOUtils.writeUTF8(filePath, json).catch(e => {
				this.log(`Failed to save chat history: ${e.message}`);
			});
		} catch (error) {
			this.log(`Failed to save chat history: ${error.message}`);
		}
	},

	addToWindow(window) {
		// 如果需要在窗口中添加元素，在这里实现
		// 当前主要逻辑在 ItemPane 中，这里可以留空或添加其他 UI 元素
	},

	addToAllWindows() {
		var windows = Zotero.getMainWindows();
		for (let win of windows) {
			if (!win.ZoteroPane) continue;
			this.addToWindow(win);
		}
	},

	removeFromWindow(window) {
		// 清理窗口中的元素
	},

	removeFromAllWindows() {
		var windows = Zotero.getMainWindows();
		for (let win of windows) {
			if (!win.ZoteroPane) continue;
			this.removeFromWindow(win);
		}
	}
};

