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
	/** @type {HTMLElement|null} 当前渲染的聊天容器，供 _appendMessageToUI 等方法直接使用 */
	_currentChatDiv: null,

	init({ id, version, rootURI }) {
		if (this.initialized) return;
		this.id = id;
		this.version = version;
		this.rootURI = rootURI;
		this.initialized = true;
		// Detect locale once at startup
		this._locale = (typeof Zotero !== "undefined" && Zotero.locale && Zotero.locale.startsWith("zh")) ? "zh" : "en";
		try { this._migrateLegacyPrefs(); } catch (e) { /* ignore */ }
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
			"btn-run": "\u53d1\u9001",
			"btn-fill-input": "\u586b\u5165",
			"btn-running": "\u5904\u7406\u4e2d...",
			"btn-send": "\u53d1\u9001",
			"btn-save-note": "\u5b58\u4e3a\u7b14\u8bb0",
			"btn-save-preset": "\u5b58\u4e3a\u9884\u8bbe",
			"btn-delete-selected": "\u5220\u9664\u9009\u4e2d",
			"btn-clear-all": "\u6e05\u7a7a\u5168\u90e8",
			"select-all": "\u5168\u9009",
			"role-user": "\u60a8",
			"hint-pdf": "\ud83d\udcce \u5c06\u81ea\u52a8\u6302\u8f7d {count} \u4e2a\u9644\u4ef6\u7ed9 AI",
			"hint-no-pdf": "\u26a0\ufe0f \u5f53\u524d\u65e0\u53ef\u7528\u9644\u4ef6 (\u4ec5\u57fa\u4e8e\u6807\u9898/\u6458\u8981\u5206\u6790)",
			"btn-fold-all": "\u6298\u53e0\u5168\u90e8",
			"btn-unfold-all": "\u5c55\u5f00\u5168\u90e8",
			"btn-set-default": "\u8bbe\u4e3a\u9ed8\u8ba4",
			"default-mark": " [\u9ed8\u8ba4]",
			"menu-save-note": "\u5b58\u4e3a\u7b14\u8bb0",
			"menu-save-preset": "\u5b58\u4e3a\u9884\u8bbe",
			"menu-toggle": "\u6298\u53e0/\u5c55\u5f00",
			"menu-delete": "\u5220\u9664\u6d88\u606f",
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
			"confirm-delete-selected": "\u786e\u5b9a\u8981\u5220\u9664\u9009\u4e2d\u7684\u6d88\u606f\u5417\uff1f",
			"cleared": "\u8bb0\u5f55\u5df2\u6e05\u7a7a\u3002",
			"alert-cleared": "\u5bf9\u8bdd\u8bb0\u5f55\u5df2\u6e05\u7a7a \ud83d\uddd1\ufe0f",
			"render-error": "\u6e32\u67d3\u9519\u8bef",
			"summary-fail": "\u751f\u6210\u6458\u8981\u5931\u8d25\uff1a{error}",
			"extract-fail": "\u63d0\u53d6\u8868\u683c\u6570\u636e\u5931\u8d25\uff1a{error}",
			"send-fail": "\u53d1\u9001\u6d88\u606f\u5931\u8d25\uff1a{error}",
			"run-preset-fail": "\u6267\u884c\u9884\u8bbe\u5931\u8d25\uff1a{error}",
			"note-record": "DeepRead \u5bf9\u8bdd\u8bb0\u5f55",
			"untitled-item": "\u672a\u547d\u540d\u6587\u732e",
			"read-pdf-fail": "\u8bfb\u53d6\u9644\u4ef6\u5931\u8d25: ",
			"get-pdf-fail": "\u83b7\u53d6\u9644\u4ef6\u5931\u8d25: ",
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
			"btn-run": "Send",
			"btn-fill-input": "Fill",
			"btn-running": "Processing...",
			"btn-send": "Send",
			"btn-save-note": "Save to Note",
			"btn-save-preset": "Save as Preset",
			"btn-delete-selected": "Delete Selected",
			"btn-clear-all": "Clear All",
			"select-all": "Select All",
			"role-user": "You",
			"hint-pdf": "\ud83d\udcce Automatically mounting {count} attachment(s) for AI",
			"hint-no-pdf": "\u26a0\ufe0f No supported attachment (title/abstract only)",
			"btn-fold-all": "Fold All",
			"btn-unfold-all": "Expand All",
			"btn-set-default": "Set as Default",
			"default-mark": " [Default]",
			"menu-save-note": "Save as Note",
			"menu-save-preset": "Save as Preset",
			"menu-toggle": "Fold/Unfold",
			"menu-delete": "Delete Message",
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
			"confirm-delete-selected": "Are you sure you want to delete the selected messages?",
			"cleared": "History cleared.",
			"alert-cleared": "Chat history cleared \ud83d\uddd1\ufe0f",
			"render-error": "Render error",
			"summary-fail": "Failed to generate summary: {error}",
			"extract-fail": "Failed to extract data: {error}",
			"send-fail": "Failed to send message: {error}",
			"run-preset-fail": "Failed to run preset: {error}",
			"note-record": "DeepRead Chat Record",
			"untitled-item": "Untitled Item",
			"read-pdf-fail": "Failed to read attachment: ",
			"get-pdf-fail": "Failed to get attachment: ",
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

	_getTopLevelItem(item) {
		if (!item) return null;
		if (item.isRegularItem && item.isRegularItem()) return item;
		if (item.parentItemID) {
			const parent = Zotero.Items.get(item.parentItemID);
			if (parent) return parent;
		}
		// 如果本身是附件但没有父条目，则它自己就是顶层条目
		return item;
	},

	_getHistoryKey(item) {
		const topItem = this._getTopLevelItem(item);
		return topItem ? String(topItem.id) : String(item.id);
	},

	_escapeHTML(str) {
		if (!str) return "";
		return String(str)
			.replace(/[^\x09\x0A\x0D\x20-\uD7FF\uE000-\uFFFD\u{10000}-\u{10FFFF}]/gu, "")
			.replace(/&/g, "&amp;")
			.replace(/</g, "&lt;")
			.replace(/>/g, "&gt;")
			.replace(/"/g, "&quot;")
			.replace(/'/g, "&#39;");
	},

	_katex: null,

	/** 加载内嵌 KaTeX（通用 TeX 渲染，替代手写符号替换） */
	_ensureKatex(doc) {
		if (this._katex && typeof this._katex.renderToString === "function") return this._katex;
		try {
			const win = doc && doc.defaultView;
			if (win && win.katex) {
				this._katex = win.katex;
				return this._katex;
			}
			if (typeof katex !== "undefined") {
				this._katex = katex;
				return this._katex;
			}
			const uri = this.rootURI + "vendor/katex/katex.min.js";
			if (win) {
				Services.scriptloader.loadSubScript(uri, win);
				if (win.katex) {
					this._katex = win.katex;
					return this._katex;
				}
			}
			const sandbox = {};
			Services.scriptloader.loadSubScript(uri, sandbox);
			this._katex = sandbox.katex || (typeof katex !== "undefined" ? katex : null);
			return this._katex;
		} catch (e) {
			this.log(`KaTeX load failed: ${e.message || e}`);
			return null;
		}
	},

	_injectKatexAssets(doc) {
		if (!doc) return;
		if (!doc.getElementById("deepread-katex-css") && this.rootURI) {
			const link = doc.createElement("link");
			link.id = "deepread-katex-css";
			link.rel = "stylesheet";
			link.type = "text/css";
			link.href = this.rootURI + "vendor/katex/katex.min.css";
			(doc.head || doc.documentElement).appendChild(link);
		}
		this._ensureKatex(doc);
	},

	/** 下标/上标里的中文等非 ASCII 包进 \\text{}，否则 KaTeX 会报错 */
	_prepareTexForKatex(tex) {
		let s = String(tex || "").trim();
		s = s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, "\"").replace(/&#39;/g, "'");
		const wrapText = (body) => {
			if (!/[\u0080-\uFFFF]/.test(body)) return body;
			if (/\\text\s*\{/.test(body) || /\\mathrm\s*\{/.test(body)) return body;
			return `\\text{${body}}`;
		};
		s = s.replace(/_\{([^{}]*)\}/g, (_, b) => `_{${wrapText(b)}}`);
		s = s.replace(/\^\{([^{}]*)\}/g, (_, b) => `^{${wrapText(b)}}`);
		return s;
	},

	_matchingBrace(s, openIdx) {
		if (!s || s[openIdx] !== "{") return -1;
		let depth = 0;
		for (let i = openIdx; i < s.length; i++) {
			if (s[i] === "{") depth++;
			else if (s[i] === "}") {
				depth--;
				if (depth === 0) return i;
			}
		}
		return -1;
	},

	_extendLatexForward(s, i) {
		while (i < s.length) {
			const ch = s[i];
			if (ch === "{") {
				const close = this._matchingBrace(s, i);
				if (close < 0) break;
				i = close + 1;
				continue;
			}
			if (ch === "_" || ch === "^") {
				i++;
				if (s[i] === "{") {
					const close = this._matchingBrace(s, i);
					if (close < 0) break;
					i = close + 1;
				} else if (/[A-Za-z0-9]/.test(s[i] || "")) {
					while (i < s.length && /[A-Za-z0-9]/.test(s[i])) i++;
				}
				continue;
			}
			if (/\s/.test(ch)) {
				const n = s[i + 1] || "";
				if (n === "\\" || n === "_" || n === "^" || n === "(" || n === "[" || /[×·+\-*/=|)]/.test(n)) {
					i++;
					continue;
				}
				break;
			}
			if (/[×·+\-*/=|()[\]]/.test(ch)) {
				i++;
				continue;
			}
			if (ch === "\\" && /[a-zA-Z]/.test(s[i + 1] || "")) {
				i++;
				while (i < s.length && /[a-zA-Z]/.test(s[i])) i++;
				continue;
			}
			if (/[A-Za-z0-9Α-Ωα-ωφϕρφ]/.test(ch)) {
				let j = i;
				while (j < s.length && /[A-Za-z0-9Α-Ωα-ωφϕρφ]/.test(s[j])) j++;
				const n = s[j] || "";
				if (n === "_" || n === "^" || n === "\\" || /[×·+\-*/=|()[\]{}]/.test(n)) {
					i = j;
					continue;
				}
				break;
			}
			break;
		}
		return i;
	},

	_extendLatexBackward(s, i) {
		while (i > 0) {
			const ch = s[i - 1];
			if (/[\u4e00-\u9fff。；！？，：、【】《》（）]/.test(ch)) break;
			if (/[A-Za-z0-9Α-Ωα-ωφϕρφ×·+\-*/=|()[\]_^<>|\s.,]/.test(ch)) {
				i--;
				continue;
			}
			if (ch === "}") {
				let depth = 1;
				let j = i - 2;
				while (j >= 0 && depth > 0) {
					if (s[j] === "}") depth++;
					else if (s[j] === "{") depth--;
					j--;
				}
				if (depth === 0) {
					i = j + 1;
					continue;
				}
				break;
			}
			break;
		}
		while (i < s.length && /\s/.test(s[i])) i++;
		return i;
	},

	/** 把正文里无 $ 包裹的裸 LaTeX 抽成公式槽（\\rho_g、\\underbrace 等） */
	_parkBareLatex(text, parkMath) {
		const s = String(text || "");
		const re = /\\[a-zA-Z]+/g;
		const ranges = [];
		let m;
		while ((m = re.exec(s)) !== null) {
			const start = this._extendLatexBackward(s, m.index);
			const end = this._extendLatexForward(s, m.index + m[0].length);
			if (end > start) ranges.push([start, end]);
		}
		if (!ranges.length) return s;
		ranges.sort((a, b) => a[0] - b[0]);
		const merged = [];
		for (const r of ranges) {
			const last = merged[merged.length - 1];
			if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
			else merged.push(r.slice());
		}
		let out = "";
		let cursor = 0;
		for (const [a, b] of merged) {
			if (a < cursor) continue;
			out += s.slice(cursor, a);
			const frag = s.slice(a, b).trim();
			out += frag ? parkMath(frag, /\\(underbrace|overbrace|begin|frac)\b/.test(frag)) : s.slice(a, b);
			cursor = b;
		}
		out += s.slice(cursor);
		return out;
	},

	/**
	 * 用 KaTeX 渲染公式；失败时回退到转义原文
	 */
	_formatMath(tex, displayMode = false) {
		const raw = String(tex || "").trim();
		if (!raw) return "";
		const prepared = this._prepareTexForKatex(raw);
		try {
			const k = this._katex || this._ensureKatex(null);
			if (k && typeof k.renderToString === "function") {
				return k.renderToString(prepared, {
					throwOnError: false,
					displayMode: !!displayMode,
					strict: "ignore",
					trust: false
				});
			}
		} catch (e) {
			this.log(`KaTeX render failed: ${e.message || e}`);
		}
		return `<code class="dr-md-inline">${this._escapeHTML(raw)}</code>`;
	},

	_marked: null,

	/** 加载内嵌 marked（标准 Markdown → HTML） */
	_ensureMarked(doc) {
		if (this._marked && typeof this._marked.parse === "function") return this._marked;
		try {
			const win = doc && doc.defaultView;
			const bind = (mod) => {
				if (!mod) return null;
				if (typeof mod.parse === "function") return mod;
				if (mod.marked && typeof mod.marked.parse === "function") return mod.marked;
				if (typeof mod.marked === "function") {
					mod.marked.parse = mod.marked.parse || mod.marked;
					return mod.marked;
				}
				return null;
			};
			if (win && win.marked) {
				this._marked = bind(win.marked);
				if (this._marked) return this._marked;
			}
			if (typeof marked !== "undefined") {
				this._marked = bind(marked);
				if (this._marked) return this._marked;
			}
			const uri = this.rootURI + "vendor/marked/marked.umd.js";
			if (win) {
				Services.scriptloader.loadSubScript(uri, win);
				this._marked = bind(win.marked);
				if (this._marked) return this._marked;
			}
			const sandbox = {};
			Services.scriptloader.loadSubScript(uri, sandbox);
			this._marked = bind(sandbox.marked) || bind(sandbox);
			return this._marked;
		} catch (e) {
			this.log(`marked load failed: ${e.message || e}`);
			return null;
		}
	},

	/** 模型常把表格多行挤成一行（用 || 粘行），先拆开再交给 marked */
	_normalizeCollapsedTables(text) {
		const pipeCount = (s) => ((String(s).match(/\|/g) || []).length);
		return String(text || "").split("\n").map((line) => {
			if (!line.includes("||")) return line;
			if (pipeCount(line) >= 6 && /\|?\s*:?-{3,}\s*\|/.test(line)) {
				return line.replace(/\|\|/g, "|\n|");
			}
			if (pipeCount(line) >= 8) return line.replace(/\|\|/g, "|\n|");
			return line;
		}).join("\n");
	},

	/** 只在代码块/行内代码之外抽公式，避免把代码里的 $ \\ 当数学 */
	_mapOutsideCode(text, fn) {
		const parts = String(text || "").split(/(```[\s\S]*?```|`[^`\n]+`)/g);
		return parts.map((part) => {
			if (!part) return part;
			if (part.startsWith("```") || (part.startsWith("`") && part.endsWith("`"))) return part;
			return fn(part);
		}).join("");
	},

	/**
	 * Markdown → HTML：marked（GFM）+ KaTeX
	 * 原始 HTML 标签丢弃，防 XSS；模型挤成一行的表格先规范化
	 */
	_markdownToHTML(src) {
		if (!src) return "";
		const md = this._ensureMarked(null);
		let text = this._normalizeCollapsedTables(String(src));

		const mathSlots = [];
		const parkMath = (raw, displayMode = false) => {
			const i = mathSlots.length;
			mathSlots.push(this._formatMath(raw, displayMode));
			return `%%DRMATH${i}%%`;
		};

		text = this._mapOutsideCode(text, (chunk) => {
			let c = chunk
				.replace(/\$\$([\s\S]+?)\$\$/g, (_, m) => parkMath(m, true))
				.replace(/\\\[([\s\S]+?)\\\]/g, (_, m) => parkMath(m, true))
				.replace(/\\\((.+?)\\\)/g, (_, m) => parkMath(m, false))
				.replace(/\$([^\$\n]+?)\$/g, (_, m) => parkMath(m, false));
			return this._parkBareLatex(c, parkMath);
		});

		let html;
		if (md && typeof md.parse === "function") {
			try {
				if (!this._markedConfigured) {
					md.setOptions({
						gfm: true,
						breaks: false,
						pedantic: false,
						silent: true
					});
					md.use({
						renderer: {
							html() { return ""; },
							link({ href, title, tokens }) {
								const body = this.parser.parseInline(tokens);
								const safe = String(href || "").trim();
								if (!/^https?:\/\//i.test(safe)) return body;
								const titleAttr = title
									? ` title="${String(title).replace(/"/g, "&quot;")}"`
									: "";
								return `<a href="${safe.replace(/"/g, "&quot;")}" class="dr-md-link" rel="noopener"${titleAttr}>${body}</a>`;
							}
						}
					});
					this._markedConfigured = true;
				}
				html = md.parse(text, { async: false });
			} catch (e) {
				this.log(`marked parse failed: ${e.message || e}`);
				html = `<p>${this._escapeHTML(src)}</p>`;
			}
		} else {
			html = `<p>${this._escapeHTML(src).replace(/\n/g, "<br/>")}</p>`;
		}

		html = String(html || "").replace(/%%DRMATH(\d+)%%/g, (_, i) => mathSlots[Number(i)] || "");
		html = html.replace(/<table(\s[^>]*)?>/gi, (m, attrs) => {
			if (/class\s*=/.test(attrs || "")) {
				return `<div class="dr-md-table-wrap"><table${attrs}>`;
			}
			return `<div class="dr-md-table-wrap"><table class="dr-md-table"${attrs || ""}>`;
		}).replace(/<\/table>/gi, "</table></div>");
		return html;
	},

	_injectMarkdownStyles(doc) {
		if (!doc) return;
		const STYLE_ID = "deepread-md-style-v7";
		try {
			doc.querySelectorAll("style[id^='deepread-md-style']").forEach(el => {
				if (el.id !== STYLE_ID) el.remove();
			});
		} catch (e) { /* ignore */ }

		let style = doc.getElementById(STYLE_ID);
		if (!style) {
			style = doc.createElement("style");
			style.id = STYLE_ID;
			(doc.head || doc.documentElement).appendChild(style);
		}
		// AI：蓝色点缀；用户气泡见 renderMessage（暖色）
		style.textContent = `
			.deepread-msg-wrapper.deepread-msg-assistant .deepread-msg-header {
				background: rgba(33, 150, 243, 0.05);
			}
			.deepread-msg-wrapper.deepread-msg-user .deepread-msg-header {
				background: rgba(245, 124, 0, 0.06);
			}

			.deepread-msg-content {
				color: #222;
				font-size: 12px;
				line-height: 1.62;
			}
			.deepread-msg-content > :first-child { margin-top: 0 !important; }
			.deepread-msg-content > :last-child { margin-bottom: 0 !important; }

			/* 一级/二级：问题级标题，蓝左边条 */
			.deepread-msg-content h1,
			.deepread-msg-content h2 {
				margin: 14px 0 8px;
				padding: 3px 0 3px 10px;
				border-left: 3px solid #1e88e5;
				font-weight: 700;
				line-height: 1.35;
				color: #1a1a1a;
			}
			.deepread-msg-content h1 { font-size: 15px; border-left-color: #1565c0; }
			.deepread-msg-content h2 { font-size: 14px; }

			/* 三级及以下：小节标题，不用左边条 */
			.deepread-msg-content h3 {
				margin: 10px 0 5px;
				padding: 0;
				border-left: none;
				font-size: 12.5px;
				font-weight: 600;
				line-height: 1.4;
				color: #1565c0;
			}
			.deepread-msg-content h4,
			.deepread-msg-content h5,
			.deepread-msg-content h6 {
				margin: 8px 0 4px;
				padding: 0;
				border-left: none;
				font-size: 12px;
				font-weight: 600;
				line-height: 1.4;
				color: #555;
			}

			.deepread-msg-content p { margin: 0 0 8px; }

			.deepread-msg-content ul,
			.deepread-msg-content ol {
				margin: 6px 0 10px;
				padding: 6px 10px 6px 1.6em;
				background: #f7f9fb;
				border: 1px solid #e8edf2;
				border-radius: 6px;
			}
			.deepread-msg-content ul ul,
			.deepread-msg-content ol ol,
			.deepread-msg-content ul ol,
			.deepread-msg-content ol ul {
				margin: 4px 0;
				padding: 2px 0 2px 1.2em;
				background: transparent;
				border: none;
			}
			.deepread-msg-content li {
				margin: 3px 0;
				padding-left: 2px;
				line-height: 1.55;
			}
			.deepread-msg-content li::marker {
				color: #333;
				font-weight: 600;
			}
			.deepread-msg-content ul {
				list-style-type: none;
				padding-left: 12px;
			}
			.deepread-msg-content ul > li {
				position: relative;
				padding-left: 12px;
			}
			.deepread-msg-content ul > li::before {
				content: "";
				position: absolute;
				left: 0;
				top: 0.55em;
				width: 5px;
				height: 5px;
				border-radius: 50%;
				background: #1e88e5;
			}
			.deepread-msg-content ul ul > li::before {
				background: transparent;
				border: 1.5px solid #1e88e5;
				box-sizing: border-box;
			}
			.deepread-msg-content ol {
				list-style-type: decimal;
				list-style-position: outside;
			}
			.deepread-msg-content ol > li::before { content: none; }
			.deepread-msg-content li > p { margin: 0; }

			.deepread-msg-content blockquote {
				margin: 8px 0;
				padding: 8px 10px;
				border-left: 3px solid #1e88e5;
				background: #f7f9fb;
				color: #444;
				border-radius: 0 6px 6px 0;
			}
			.deepread-msg-content blockquote p { margin: 0 0 4px; }
			.deepread-msg-content blockquote p:last-child { margin-bottom: 0; }

			.deepread-msg-content pre {
				margin: 8px 0;
				padding: 9px 11px;
				background: #f4f6f8;
				border: 1px solid #e2e8ef;
				border-radius: 6px;
				overflow-x: auto;
				font-size: 11px;
				line-height: 1.5;
				font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
				white-space: pre-wrap;
			}
			.deepread-msg-content code {
				padding: 1px 5px;
				background: #f0f2f5;
				border: 1px solid #e3e8ee;
				border-radius: 3px;
				font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
				font-size: 11px;
				color: #c62828;
			}
			.deepread-msg-content pre code {
				padding: 0;
				background: transparent;
				border: none;
				color: inherit;
			}

			.deepread-msg-content a,
			.deepread-msg-content .dr-md-link {
				color: #1565c0;
				text-decoration: none;
				border-bottom: 1px solid rgba(21, 101, 192, 0.25);
			}
			.deepread-msg-content a:hover,
			.deepread-msg-content .dr-md-link:hover {
				border-bottom-color: #1565c0;
			}

			.deepread-msg-content hr {
				border: none;
				border-top: 1px solid #e0e0e0;
				margin: 12px 0;
			}

			.deepread-msg-content .dr-md-table-wrap,
			.deepread-msg-content table {
				margin: 10px 0;
				max-width: 100%;
			}
			.deepread-msg-content .dr-md-table-wrap {
				overflow-x: auto;
				border: 1px solid #cfd8e3;
				border-radius: 8px;
				background: #fff;
				box-shadow: 0 1px 2px rgba(16, 24, 40, 0.04);
			}
			.deepread-msg-content .dr-md-table-wrap table,
			.deepread-msg-content table.dr-md-table,
			.deepread-msg-content table {
				width: 100%;
				border-collapse: collapse;
				font-size: 11px;
				line-height: 1.45;
				margin: 0;
			}
			.deepread-msg-content table th,
			.deepread-msg-content table td {
				padding: 8px 10px;
				border-right: 1px solid #e8edf3;
				border-bottom: 1px solid #e8edf3;
				vertical-align: top;
				text-align: left;
				word-break: break-word;
			}
			.deepread-msg-content table th:last-child,
			.deepread-msg-content table td:last-child { border-right: none; }
			.deepread-msg-content table thead th {
				background: #edf3fa;
				font-weight: 700;
				color: #243447;
				border-bottom: 1px solid #d0dbe8;
				white-space: nowrap;
			}
			.deepread-msg-content table tbody tr:nth-child(even) td {
				background: #f8fafc;
			}
			.deepread-msg-content table tbody tr:hover td {
				background: #eef5ff;
			}
			.deepread-msg-content table tbody tr:last-child td {
				border-bottom: none;
			}
			.deepread-msg-content table td:first-child {
				font-weight: 600;
				color: #334155;
				background: #fafbfd;
				white-space: nowrap;
			}
			.deepread-msg-content table tbody tr:nth-child(even) td:first-child {
				background: #f3f6fa;
			}

			.deepread-msg-content strong { font-weight: 700; color: #111; }
			.deepread-msg-content em { font-style: italic; color: #333; }
			.deepread-msg-content del { color: #777; }
			.deepread-msg-content .katex { font-size: 1.05em; }
			.deepread-msg-content .katex-display {
				margin: 8px 0;
				padding: 6px 8px;
				overflow-x: auto;
				overflow-y: hidden;
				background: #fafbfc;
				border: 1px solid #eef1f4;
				border-radius: 6px;
			}
		`;
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

	_clearResendButtons(chatDiv) {
		if (!chatDiv) return;
		chatDiv.querySelectorAll(".deepread-resend-btn").forEach(el => el.remove());
	},

	_appendMessageToUI(msg, msgIndex, topItemID) {
		try {
			const showResend = msg && msg.role === "user";
			const appendTo = (chatDiv) => {
				if (!chatDiv) return;
				const doc = chatDiv.ownerDocument;
				// 任何新消息到来都清掉旧重发钮；仅当本条是用户消息时再挂到最新一条
				this._clearResendButtons(chatDiv);
				const msgDiv = this.renderMessage(msg, doc, msgIndex, { showResend });
				chatDiv.appendChild(msgDiv);
				chatDiv.scrollTop = chatDiv.scrollHeight;
			};

			// 如果没有指定 ID，回退到原来的逻辑（虽然目前所有调用处应该都有了）
			if (!topItemID && this._currentChatDiv) {
				appendTo(this._currentChatDiv);
				return;
			}

			const windows = Zotero.getMainWindows();
			let found = false;
			for (let win of windows) {
				const doc = win.document;
				const chatDivs = doc.querySelectorAll(`#deepread-chat-container[data-top-item-id="${topItemID}"]`);
				chatDivs.forEach(chatDiv => {
					found = true;
					appendTo(chatDiv);
				});
			}

			// 如果全局搜索没找到（比如在独立的阅读器窗口且 getMainWindows 没包全），尝试直接使用缓存引用
			if (!found && this._currentChatDiv && this._currentChatDiv.getAttribute("data-top-item-id") === String(topItemID)) {
				appendTo(this._currentChatDiv);
			}
		} catch (e) {
			this.log(`Failed to append message to UI: ${e.message}`);
		}
	},

	_showLoading(topItemID) {
		try {
			const targets = [];
			const windows = Zotero.getMainWindows();
			for (let win of windows) {
				const doc = win.document;
				const chatDivs = doc.querySelectorAll(`#deepread-chat-container[data-top-item-id="${topItemID}"]`);
				chatDivs.forEach(d => targets.push(d));
			}

			if (targets.length === 0 && this._currentChatDiv && this._currentChatDiv.getAttribute("data-top-item-id") === String(topItemID)) {
				targets.push(this._currentChatDiv);
			}

			for (const chatDiv of targets) {
				const doc = chatDiv.ownerDocument;
				// 检查该容器内是否已经有加载指示器
				if (chatDiv.querySelector(".deepread-loading-indicator-cls")) continue;
				
				const loadingDiv = doc.createElement("div");
				loadingDiv.className = "deepread-loading-indicator-cls";
				loadingDiv.style.cssText = `
					margin-bottom: 10px; padding: 8px; border-radius: 4px;
					background: #fff; border-left: 3px solid #ff9800;
					font-size: 12px; color: #666; display: flex; align-items: center; gap: 8px;
				`;
				const textSpan = doc.createElement("span");
				textSpan.textContent = this.getString("hint-loading");
				loadingDiv.appendChild(textSpan);
				chatDiv.appendChild(loadingDiv);
				chatDiv.scrollTop = chatDiv.scrollHeight;
			}
		} catch (e) {
			this.log(`Failed to show loading: ${e.message}`);
		}
	},

	_hideLoading(topItemID) {
		try {
			const windows = Zotero.getMainWindows();
			for (let win of windows) {
				const doc = win.document;
				const chatDivs = doc.querySelectorAll(`#deepread-chat-container[data-top-item-id="${topItemID}"]`);
				chatDivs.forEach(chatDiv => {
					const indicators = chatDiv.querySelectorAll(".deepread-loading-indicator-cls");
					indicators.forEach(ind => ind.remove());
				});
			}
			// 补充处理缓存引用
			if (this._currentChatDiv && this._currentChatDiv.getAttribute("data-top-item-id") === String(topItemID)) {
				const loadingDiv = this._currentChatDiv.ownerDocument.getElementById("deepread-loading-indicator");
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

	/**
	 * 根据文件路径后缀推断 MIME 类型。
	 * 支持 PDF、Word（.doc/.docx）。
	 */
	_getMimeType(filePath) {
		const ext = (filePath || "").split(".").pop().toLowerCase();
		switch (ext) {
			case "pdf": return "application/pdf";
			case "docx": return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
			case "doc": return "application/msword";
			default: return "application/octet-stream";
		}
	},

	/**
	 * 判断一个附件条目是否为受支持的格式（PDF / Word）。
	 */
	_isSupportedAttachment(att) {
		if (!att) return false;
		// PDF 有专用 API
		if (att.isPDFAttachment && att.isPDFAttachment()) return true;
		// Word：通过 contentType 或文件名后缀判断
		try {
			const ct = att.attachmentContentType || "";
			if (
				ct === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
				ct === "application/msword"
			) {
				// 进一步检查路径后缀
				const path = att.attachmentPath || att.getFilePath && att.getFilePath() || "";
				const ext = path.split(".").pop().toLowerCase();
				if (["docx", "doc"].includes(ext)) return true;
			}
			// 没有 contentType 时仅靠路径后缀
			if (!ct) {
				const path = att.attachmentPath || att.getFilePath && att.getFilePath() || "";
				const ext = path.split(".").pop().toLowerCase();
				if (["docx", "doc"].includes(ext)) return true;
			}
		} catch (e) { }
		return false;
	},

	async _readAttachmentFile(filePath, pdfData) {
		try {
			const mimeType = this._getMimeType(filePath);
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
				pdfData.files.push({ base64: base64Str, mimeType });
				// 保持向下兼容，第一个文件仍写入裸字段
				if (!pdfData.base64) {
					pdfData.base64 = base64Str;
					pdfData.mimeType = mimeType;
				}
			}
		} catch (e) {
			this.log(this.getString("read-pdf-fail") + e.message);
		}
		return pdfData;
	},

	async _getPdfData(item, specificItemIDs) {
		const topItem = this._getTopLevelItem(item);
		let pdfData = { text: this._buildItemContextText(topItem), files: [] };
		try {
			// 如果指定了具体选中的附件 ID
			if (specificItemIDs && specificItemIDs.length > 0) {
				for (const id of specificItemIDs) {
					const att = Zotero.Items.get(id);
					if (this._isSupportedAttachment(att)) {
						const filePath = await att.getFilePathAsync();
						if (filePath) pdfData = await this._readAttachmentFile(filePath, pdfData);
					}
				}
				return pdfData;
			}

			// 兼容逻辑：如果没有指定 ID（比如 handleGenerateSummary 调用）
			// item 本身就是附件条目
			if (!item || !item.isRegularItem || !item.isRegularItem()) {
				if (this._isSupportedAttachment(item)) {
					const filePath = await item.getFilePathAsync();
					if (filePath) pdfData = await this._readAttachmentFile(filePath, pdfData);
				}
				return pdfData;
			}

			// 普通条目：全选所有附件
			const ids = item.getAttachments ? item.getAttachments() : [];
			for (const id of ids) {
				const att = Zotero.Items.get(id);
				if (this._isSupportedAttachment(att)) {
					const filePath = await att.getFilePathAsync();
					if (filePath) pdfData = await this._readAttachmentFile(filePath, pdfData);
				}
			}
		} catch (e) {
			this.log(this.getString("get-pdf-fail") + e.message);
		}
		return pdfData;
	},

	PROVIDER_MODELS: {
		gemini: [
			{ value: "gemini-3.1-flash-lite-preview", label: "gemini-3.1-flash-lite" },
			{ value: "gemini-2.5-flash-lite", label: "gemini-2.5-flash-lite" },
			{ value: "gemini-3-flash-preview", label: "gemini-3-flash" },
			{ value: "gemini-2.5-flash", label: "gemini-2.5-flash" }
		],
		openai: [
			{ value: "gpt-6.1-sol", label: "gpt-6.1-sol (日常)" },
			{ value: "gpt-6.1-terra", label: "gpt-6.1-terra (均衡)" },
			{ value: "gpt-6-luna", label: "gpt-6-luna (便宜)" }
		],
		deepseek: [
			{ value: "deepseek-flash", label: "deepseek-flash (V4.1-Flash)" }
		]
	},

	_pref(key, fallback) {
		try {
			const v = Zotero.Prefs.get(key, true);
			return (v === undefined || v === null || v === "") ? fallback : v;
		} catch (e) {
			return fallback;
		}
	},

	_setPref(key, value) {
		try {
			Zotero.Prefs.set(key, value, true);
			// 再读回确认；个别环境下第三参行为不一致时回退再写一次
			const got = Zotero.Prefs.get(key, true);
			if (got !== value) {
				Zotero.Prefs.set(key, value);
			}
		} catch (e) {
			try {
				Zotero.Prefs.set(key, value);
			} catch (e2) {
				this.log(`Failed to set pref ${key}: ${e2.message || e.message}`);
			}
		}
	},

	_migrateLegacyPrefs() {
		try {
			const legacyKey = Zotero.Prefs.get("extensions.deepread.apiKey", true);
			const geminiKey = Zotero.Prefs.get("extensions.deepread.gemini.apiKey", true);
			if (legacyKey && !geminiKey) {
				this._setPref("extensions.deepread.gemini.apiKey", legacyKey);
			}
			const legacyModel = Zotero.Prefs.get("extensions.deepread.model", true);
			const geminiModel = Zotero.Prefs.get("extensions.deepread.gemini.model", true);
			if (legacyModel && !geminiModel) {
				this._setPref("extensions.deepread.gemini.model", legacyModel);
			}
			if (!Zotero.Prefs.get("extensions.deepread.provider", true)) {
				this._setPref("extensions.deepread.provider", "gemini");
			}
			if (!Zotero.Prefs.get("extensions.deepread.openai.baseUrl", true)) {
				this._setPref("extensions.deepread.openai.baseUrl", "https://api.openai.com/v1");
			}
			if (!Zotero.Prefs.get("extensions.deepread.openai.model", true)) {
				this._setPref("extensions.deepread.openai.model", "gpt-6.1-sol");
			}
			if (!Zotero.Prefs.get("extensions.deepread.deepseek.baseUrl", true)) {
				this._setPref("extensions.deepread.deepseek.baseUrl", "https://api.deepseek.com");
			}
			if (!Zotero.Prefs.get("extensions.deepread.deepseek.model", true)) {
				this._setPref("extensions.deepread.deepseek.model", "deepseek-flash");
			}
			if (!Zotero.Prefs.get("extensions.deepread.deepseek.parsePurpose", true)) {
				this._setPref("extensions.deepread.deepseek.parsePurpose", "rich_layout_recognition");
			}
			if (!Zotero.Prefs.get("extensions.deepread.gemini.model", true)) {
				this._setPref("extensions.deepread.gemini.model", "gemini-3.1-flash-lite-preview");
			}

			// 仅 Gemini 保留可调 temperature；旧共用值迁过去
			const emptyPref = (v) => v === undefined || v === null || v === "";
			const legacyTemp = Zotero.Prefs.get("extensions.deepread.temperature", true);
			const geminiTempKey = "extensions.deepread.gemini.temperature";
			if (emptyPref(Zotero.Prefs.get(geminiTempKey, true))) {
				this._setPref(geminiTempKey, emptyPref(legacyTemp) ? 0.3 : legacyTemp);
			}
		} catch (e) {
			this.log(`migrateLegacyPrefs: ${e.message}`);
		}
	},

	_ensureProviderScripts() {
		if (typeof BaseAIProvider === "undefined") {
			Services.scriptloader.loadSubScript(this.rootURI + "providers/BaseAIProvider.js");
		}
		if (typeof GeminiProvider === "undefined") {
			Services.scriptloader.loadSubScript(this.rootURI + "providers/GeminiProvider.js");
		}
		if (typeof OpenAIProvider === "undefined") {
			Services.scriptloader.loadSubScript(this.rootURI + "providers/OpenAIProvider.js");
		}
		if (typeof DeepSeekProvider === "undefined") {
			Services.scriptloader.loadSubScript(this.rootURI + "providers/DeepSeekProvider.js");
		}
	},

	async initializeProvider() {
		try {
			this._migrateLegacyPrefs();
			const config = await this.loadConfig();
			if (!config.apiKey) {
				this.provider = null;
				this.log(`No API key for provider=${config.provider}`);
				return;
			}

			this._ensureProviderScripts();
			const common = {
				apiKey: config.apiKey,
				model: config.model,
				temperature: config.temperature,
				maxTokens: config.maxTokens,
				baseUrl: config.baseUrl,
				parsePurpose: config.parsePurpose
			};

			if (config.provider === "openai") {
				if (typeof OpenAIProvider === "undefined") throw new Error("Failed to load OpenAIProvider");
				this.provider = new OpenAIProvider(common);
			} else if (config.provider === "deepseek") {
				if (typeof DeepSeekProvider === "undefined") throw new Error("Failed to load DeepSeekProvider");
				this.provider = new DeepSeekProvider(common);
			} else {
				if (typeof GeminiProvider === "undefined") throw new Error("Failed to load GeminiProvider");
				this.provider = new GeminiProvider(common);
			}
			if (this.provider) this.provider.config._providerName = config.provider;
			this.log(`${config.provider} provider initialized (model=${config.model})`);
		} catch (error) {
			this.provider = null;
			this.log(`Failed to initialize provider: ${error.message}`);
		}
	},

	_parseTemp(v, fallback = 0.3) {
		let t = (typeof v === "number") ? v : parseFloat(v);
		if (Number.isNaN(t)) t = fallback;
		return Math.max(0, Math.min(1, t));
	},

	_parseTokens(v, fallback = 4096) {
		let n = (typeof v === "number") ? v : parseInt(v, 10);
		if (Number.isNaN(n)) n = fallback;
		return Math.max(1, Math.min(8192, n));
	},

	async loadConfig() {
		try {
			this._migrateLegacyPrefs();
			const provider = String(this._pref("extensions.deepread.provider", "gemini") || "gemini").toLowerCase();

			let apiKey = "";
			let model = "";
			let baseUrl = "";
			let parsePurpose = "rich_layout_recognition";
			let temperature = 0.3;
			let maxTokens = 4096;

			if (provider === "openai") {
				apiKey = this._pref("extensions.deepread.openai.apiKey", "") || "";
				model = this._pref("extensions.deepread.openai.model", "gpt-6.1-sol") || "gpt-6.1-sol";
				baseUrl = this._pref("extensions.deepread.openai.baseUrl", "https://api.openai.com/v1") || "https://api.openai.com/v1";
				temperature = this._parseTemp(this._pref("extensions.deepread.openai.temperature", 0.3), 0.3);
				maxTokens = this._parseTokens(this._pref("extensions.deepread.openai.maxTokens", 4096), 4096);
			} else if (provider === "deepseek") {
				apiKey = this._pref("extensions.deepread.deepseek.apiKey", "") || "";
				model = this._pref("extensions.deepread.deepseek.model", "deepseek-flash") || "deepseek-flash";
				baseUrl = this._pref("extensions.deepread.deepseek.baseUrl", "https://api.deepseek.com") || "https://api.deepseek.com";
				parsePurpose = this._pref("extensions.deepread.deepseek.parsePurpose", "rich_layout_recognition")
					|| "rich_layout_recognition";
				temperature = this._parseTemp(this._pref("extensions.deepread.deepseek.temperature", 0.3), 0.3);
				maxTokens = this._parseTokens(this._pref("extensions.deepread.deepseek.maxTokens", 4096), 4096);
			} else {
				apiKey = this._pref("extensions.deepread.gemini.apiKey", "")
					|| this._pref("extensions.deepread.apiKey", "")
					|| "";
				model = this._pref("extensions.deepread.gemini.model", "")
					|| this._pref("extensions.deepread.model", "gemini-3.1-flash-lite-preview")
					|| "gemini-3.1-flash-lite-preview";
				temperature = this._parseTemp(
					this._pref("extensions.deepread.gemini.temperature",
						this._pref("extensions.deepread.temperature", 0.3)),
					0.3
				);
				maxTokens = this._parseTokens(
					this._pref("extensions.deepread.gemini.maxTokens",
						this._pref("extensions.deepread.maxTokens", 8192)),
					8192
				);
			}

			const config = {
				provider: (provider === "openai" || provider === "deepseek") ? provider : "gemini",
				apiKey,
				model,
				baseUrl,
				parsePurpose,
				temperature,
				maxTokens
			};

			this.log(`loadConfig: provider=${config.provider}, hasKey=${!!config.apiKey}, model=${config.model}, temp=${config.temperature}, tokens=${config.maxTokens}`);
			return config;
		} catch (error) {
			this.log(`Failed to load config: ${error.message}`);
			return {
				provider: "gemini",
				apiKey: "",
				model: "gemini-3.1-flash-lite-preview",
				baseUrl: "",
				parsePurpose: "rich_layout_recognition",
				temperature: 0.3,
				maxTokens: 8192
			};
		}
	},

	async syncProviderConfig() {
		const config = await this.loadConfig();
		const needRebuild = !this.provider || this.provider.config._providerName !== config.provider;

		if (needRebuild) {
			await this.initializeProvider();
			return;
		}

		this.provider.config.apiKey = config.apiKey;
		this.provider.config.model = config.model;
		this.provider.config.temperature = config.temperature;
		this.provider.config.maxTokens = config.maxTokens;
		this.provider.config.baseUrl = config.baseUrl;
		this.provider.config.parsePurpose = config.parsePurpose;
		if (typeof this.provider.baseURL !== "undefined" && config.baseUrl) {
			this.provider.baseURL = String(config.baseUrl).replace(/\/$/, "");
		}
	},

	_modelPrefKey(provider) {
		if (provider === "openai") return "extensions.deepread.openai.model";
		if (provider === "deepseek") return "extensions.deepread.deepseek.model";
		return "extensions.deepread.gemini.model";
	},

	_providerGroupLabel(provider) {
		if (provider === "openai") return "OpenAI";
		if (provider === "deepseek") return "DeepSeek";
		return "Gemini";
	},

	_findModelLabel(provider, model) {
		const list = this.PROVIDER_MODELS[provider] || [];
		const hit = list.find(m => m.value === model);
		return hit ? hit.label : (model || "");
	},

	_closePickerMenus(doc, except) {
		if (!doc) return;
		doc.querySelectorAll(".deepread-picker-menu").forEach(menu => {
			if (except && menu === except) return;
			menu.style.display = "none";
		});
	},

	/** @deprecated 兼容旧调用 */
	_closeModelPickerMenus(doc, except) {
		this._closePickerMenus(doc, except);
	},

	_bindPickerValue(picker) {
		Object.defineProperty(picker, "value", {
			configurable: true,
			enumerable: true,
			get() { return picker.getAttribute("data-value") || ""; },
			set(v) { picker.setAttribute("data-value", v == null ? "" : String(v)); }
		});
		picker.getValue = () => picker.value;
	},

	_stylePickerOption(opt, selected) {
		opt.style.cssText = `
			padding: 5px 10px 5px 14px;
			font-size: 11px;
			line-height: 1.35;
			cursor: pointer;
			color: #222;
			background: ${selected ? "#e8f0fe" : "transparent"};
			font-weight: ${selected ? "600" : "400"};
		`;
		opt.onmouseenter = () => {
			opt.style.background = selected ? "#d2e3fc" : "#f0f4f8";
		};
		opt.onmouseleave = () => {
			opt.style.background = selected ? "#e8f0fe" : "transparent";
		};
	},

	/** 自定义模型下拉：分组标题与选项缩进统一，避开原生 optgroup 在 Windows 上错位 */
	_fillModelPicker(picker, selectedProvider, selectedModel) {
		if (!picker) return;
		const doc = picker.ownerDocument;
		const cur = `${selectedProvider || "gemini"}|${selectedModel || ""}`;
		picker.setAttribute("data-value", cur);

		const btn = picker.querySelector(".deepread-picker-btn") || picker.querySelector(".deepread-model-picker-btn");
		const menu = picker.querySelector(".deepread-picker-menu") || picker.querySelector(".deepread-model-picker-menu");
		if (!btn || !menu) return;

		menu.innerHTML = "";
		let matched = false;

		Object.keys(this.PROVIDER_MODELS).forEach(provider => {
			const head = doc.createElement("div");
			head.className = "deepread-model-group-label";
			head.textContent = this._providerGroupLabel(provider);
			head.style.cssText = `
				padding: 5px 10px 3px;
				font-size: 10px;
				font-weight: 700;
				color: #666;
				background: #f3f4f6;
				letter-spacing: 0.02em;
				user-select: none;
			`;
			menu.appendChild(head);

			(this.PROVIDER_MODELS[provider] || []).forEach(m => {
				const val = `${provider}|${m.value}`;
				const opt = doc.createElement("div");
				opt.className = "deepread-model-option";
				opt.setAttribute("data-value", val);
				opt.textContent = m.label;
				const selected = val === cur;
				if (selected) matched = true;
				this._stylePickerOption(opt, selected);
				opt.addEventListener("click", async (e) => {
					e.stopPropagation();
					menu.style.display = "none";
					if (val === picker.getAttribute("data-value")) return;
					picker.setAttribute("data-value", val);
					btn.textContent = m.label;
					try {
						await this._applyChatModelSelection(val);
						await this._refreshConfigStatus(doc);
						this._fillModelPicker(picker, provider, m.value);
					} catch (err) {
						this.log(`model switch failed: ${err.message}`);
						this.showAlert("DeepRead", err.message || String(err));
					}
				});
				menu.appendChild(opt);
			});
		});

		if (!matched && selectedProvider && selectedModel) {
			const val = `${selectedProvider}|${selectedModel}`;
			const opt = doc.createElement("div");
			opt.className = "deepread-model-option";
			opt.setAttribute("data-value", val);
			opt.textContent = selectedModel;
			opt.style.cssText = `
				padding: 5px 10px 5px 18px;
				font-size: 11px;
				cursor: pointer;
				background: #e8f0fe;
				font-weight: 600;
			`;
			menu.appendChild(opt);
			btn.textContent = selectedModel;
		} else {
			btn.textContent = this._findModelLabel(selectedProvider || "gemini", selectedModel) || selectedModel || "Model";
		}
	},

	_createPickerShell(doc, { id, className, title, menuUp = true }) {
		const picker = doc.createElement("div");
		picker.id = id || "";
		picker.className = className || "";
		picker.style.cssText = `
			flex: 1;
			min-width: 0;
			position: relative;
		`;

		const btn = doc.createElement("button");
		btn.type = "button";
		btn.className = "deepread-picker-btn";
		btn.title = title || "";
		btn.style.cssText = `
			width: 100%;
			box-sizing: border-box;
			font-size: 11px;
			padding: 4px 22px 4px 6px;
			border: 1px solid rgba(0,0,0,0.15);
			border-radius: 4px;
			background: #fff url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6'%3E%3Cpath d='M0 0l5 6 5-6z' fill='%23666'/%3E%3C/svg%3E") no-repeat right 7px center;
			cursor: pointer;
			text-align: left;
			overflow: hidden;
			text-overflow: ellipsis;
			white-space: nowrap;
			color: #222;
		`;

		const menu = doc.createElement("div");
		menu.className = "deepread-picker-menu";
		menu.style.cssText = `
			display: none;
			position: absolute;
			left: 0;
			right: 0;
			${menuUp ? "bottom: calc(100% + 4px);" : "top: calc(100% + 4px);"}
			max-height: 240px;
			overflow-y: auto;
			background: #fff;
			border: 1px solid rgba(0,0,0,0.18);
			border-radius: 6px;
			box-shadow: 0 6px 18px rgba(0,0,0,0.12);
			z-index: 1000;
			padding: 4px 0;
		`;

		btn.addEventListener("mousedown", (e) => e.stopPropagation());
		btn.addEventListener("click", (e) => {
			e.stopPropagation();
			const open = menu.style.display !== "none" && menu.style.display !== "";
			this._closePickerMenus(doc, open ? null : menu);
			menu.style.display = open ? "none" : "block";
		});
		menu.addEventListener("mousedown", (e) => e.stopPropagation());
		menu.addEventListener("click", (e) => e.stopPropagation());

		if (!doc.documentElement.hasAttribute("data-deepread-picker-doc")) {
			doc.documentElement.setAttribute("data-deepread-picker-doc", "1");
			doc.addEventListener("click", () => this._closePickerMenus(doc), true);
		}

		picker.appendChild(btn);
		picker.appendChild(menu);
		this._bindPickerValue(picker);
		return picker;
	},

	_createModelPicker(doc) {
		return this._createPickerShell(doc, {
			className: "deepread-model-picker deepread-chat-model-select-cls",
			title: this._locale === "zh" ? "选择服务商与模型" : "Choose provider & model",
			menuUp: true
		});
	},

	_createPresetPicker(doc) {
		return this._createPickerShell(doc, {
			id: "deepread-preset-select",
			className: "deepread-preset-picker",
			title: this._locale === "zh" ? "选择提示词预设" : "Choose prompt preset",
			menuUp: false
		});
	},

	_fillPresetPicker(picker, presets, selectedIndex) {
		if (!picker) return;
		const doc = picker.ownerDocument;
		const list = presets || [];
		const btn = picker.querySelector(".deepread-picker-btn") || picker.querySelector(".deepread-model-picker-btn");
		const menu = picker.querySelector(".deepread-picker-menu") || picker.querySelector(".deepread-model-picker-menu");
		if (!btn || !menu) return;

		let cur = String(selectedIndex == null ? (picker.value || "0") : selectedIndex);
		if (!list.length) {
			picker.value = "";
			btn.textContent = this._locale === "zh" ? "暂无预设" : "No presets";
			menu.innerHTML = "";
			return;
		}
		if (!list[parseInt(cur, 10)]) cur = "0";
		picker.value = cur;
		menu.innerHTML = "";

		const head = doc.createElement("div");
		head.textContent = this._locale === "zh" ? "提示词预设" : "Presets";
		head.style.cssText = `
			padding: 5px 10px 3px;
			font-size: 10px;
			font-weight: 700;
			color: #666;
			background: #f3f4f6;
			letter-spacing: 0.02em;
			user-select: none;
		`;
		menu.appendChild(head);

		list.forEach((p, i) => {
			const val = String(i);
			const mark = (i === 0) ? this.getString("default-mark") : "";
			const full = (p.name || "") + mark;
			const displayName = full.length > 36 ? full.substring(0, 36) + "..." : full;
			const opt = doc.createElement("div");
			opt.className = "deepread-preset-option";
			opt.setAttribute("data-value", val);
			opt.textContent = displayName;
			opt.title = full;
			const selected = val === cur;
			this._stylePickerOption(opt, selected);
			opt.addEventListener("click", (e) => {
				e.stopPropagation();
				menu.style.display = "none";
				if (val === picker.value) return;
				picker.value = val;
				btn.textContent = displayName;
				btn.title = full;
				this._fillPresetPicker(picker, list, i);
				if (typeof picker._onChange === "function") {
					try { picker._onChange(val); } catch (err) { /* ignore */ }
				}
			});
			menu.appendChild(opt);
		});

		const curPreset = list[parseInt(cur, 10)];
		const curMark = (parseInt(cur, 10) === 0) ? this.getString("default-mark") : "";
		const curFull = ((curPreset && curPreset.name) || "") + curMark;
		btn.textContent = curFull.length > 36 ? curFull.substring(0, 36) + "..." : (curFull || (this._locale === "zh" ? "选择预设" : "Choose preset"));
		btn.title = curFull;
	},

	async _applyChatModelSelection(value) {
		const parts = String(value || "").split("|");
		const provider = parts[0] || "gemini";
		const model = parts.slice(1).join("|");
		if (!model) return;

		this._setPref("extensions.deepread.provider", provider);
		this._setPref(this._modelPrefKey(provider), model);
		await this.initializeProvider();
	},

	openPreferencePane() {
		try {
			const win = Zotero.getMainWindow();
			if (win && win.ZoteroPane && win.ZoteroPane.openPreferences) {
				win.ZoteroPane.openPreferences("deepread@zotero.org");
				return;
			}
		} catch (e) { /* ignore */ }
		try {
			Zotero.Utilities.Internal.openPreferences("deepread@zotero.org");
		} catch (e2) {
			this.showAlert("DeepRead", this._locale === "zh"
				? "请打开：编辑 → 设置 → DeepRead"
				: "Open Edit → Settings → DeepRead");
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
		
		const fp = this._promptsFilePath();
		
		try {
			if (typeof IOUtils !== "undefined") {
				const exists = await IOUtils.exists(fp);
				if (exists) {
					const text = await IOUtils.readUTF8(fp);
					if (text) {
						const saved = JSON.parse(text);
						if (Array.isArray(saved) && saved.length > 0) {
							this.cachedPresets = saved;
							return saved;
						}
					}
				}
			}
		} catch (e) {
			this.log("loadPromptPresets error: " + e.message);
		}
		
		this.cachedPresets = DEFAULT_PRESETS;
		return DEFAULT_PRESETS;
	},

	async savePromptPresets(presets) {
		try {
			await IOUtils.writeUTF8(this._promptsFilePath(), JSON.stringify(presets));
			this.cachedPresets = presets;
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
			
			let reader = null;
			// 1. 优先尝试从窗口直接获取 Reader (针对独立窗口模式)
			if (typeof Zotero.Reader !== "undefined" && Zotero.Reader.getByWindow) {
				reader = Zotero.Reader.getByWindow(win);
			}
			
			// 2. 尝试从 Zotero_Tabs 获取 (针对主窗口标签页模式)
			if (!reader && win.Zotero_Tabs && win.Zotero_Tabs.selectedID) {
				reader = Zotero.Reader.getByTabID(win.Zotero_Tabs.selectedID);
			}

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
			} catch (e) { }
			return { readerItem, readerTitle: readerTitle || "" };
		} catch (e) {
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
			
			// 统一使用顶层条目
			const topLevelItem = this._getTopLevelItem(effectiveItem);
			if (!topLevelItem) throw new Error("No active item");

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
				user-select: text;
				-moz-user-select: text;
				-webkit-user-select: text;
			`;

			// 标题区域
			const titleDiv = doc.createElement("div");
			const _t = (k, p) => this.getString(k, p);
			// 显示来源标记
			const readerBadge = isFromReader
				? `<span style="display:inline-block;background:#e8f5e9;color:#2e7d32;font-size:10px;padding:1px 5px;border-radius:3px;border:1px solid #c8e6c9;margin-left:5px;vertical-align:middle;">
					${this._locale === 'zh' ? '📖 阅读器' : '📖 Reader'}</span>`
				: "";
			titleDiv.innerHTML = `
				<h3 style="margin: 0 0 4px 0; font-size: 14px; font-weight: 600; color: #c0392b; display:flex; align-items:center;">
					${_t("title-heading")}${readerBadge}
				</h3>
				<p style="margin: 0; font-size: 11px; color: #777; line-height: 1.4;">
					${_t("current-item")}<span style="font-weight: 500; color: #444;">${(() => {
						try { return this._escapeHTML(topLevelItem.getField("title") || _t("untitled")); } catch (e) { return this._escapeHTML(_t("untitled")); }
					})()}</span>
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
				this._refreshConfigStatus(doc); // 刷新当前模型状态展示
			});

			tabHeaderRow.appendChild(tabChatBtn);
			tabHeaderRow.appendChild(tabPresetBtn);
			container.appendChild(tabHeaderRow);

			// ==================== 预设管理 Tab (presetTabContent) ====================
			this.cachedPresets = await this.loadPromptPresets();

			const manageListBox = doc.createElement("select");
			manageListBox.id = "deepread-manage-list";
			manageListBox.size = 6;
			manageListBox.style.cssText = `width: 100%; font-size: 12px; padding: 4px; border: 1px solid #ccc; border-radius: 4px; outline: none; background: #fff; min-height: 100px;`;
			
			// [同步填充] 立即利用已加载的缓存填充列表，不等待异步
			if (this.cachedPresets && this.cachedPresets.length > 0) {
				this.cachedPresets.forEach((p, i) => {
					const opt = doc.createElement("option");
					opt.value = String(i);
					const mark = (i === 0) ? _t("default-mark") : "";
					opt.textContent = p.name + mark;
					manageListBox.appendChild(opt);
				});
			} else {
				this.log("DEBUG: cachedPresets is empty during initial creation.");
			}

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

			const mDefaultBtn = doc.createElement("button");
			mDefaultBtn.textContent = _t("btn-set-default");
			mDefaultBtn.className = "zotero-button";
			mDefaultBtn.style.cssText = `flex: 1; padding: 4px; cursor: pointer; color: #e67e22;`;

			mBtnRow.appendChild(mAddBtn);
			mBtnRow.appendChild(mSaveBtn);
			mBtnRow.appendChild(mDelBtn);
			mBtnRow.appendChild(mDefaultBtn);

			presetTabContent.appendChild(doc.createTextNode(_t("presets-header")));
			presetTabContent.appendChild(manageListBox);
			presetTabContent.appendChild(mNameInput);
			presetTabContent.appendChild(mPromptInput);
			presetTabContent.appendChild(mBtnRow);

			// 设置页底部：仅展示当前配置（快捷切换已移到对话输入栏）
			const configStatusDiv = doc.createElement("div");
			configStatusDiv.className = "deepread-config-status-cls";
			configStatusDiv.style.cssText = `
				margin-top: 15px; padding: 10px; background: #f8f9fa;
				border: 1px solid #dee2e6; border-radius: 4px;
				font-family: Consolas, monospace; font-size: 11px; color: #666;
				line-height: 1.4; word-break: break-all;
			`;
			presetTabContent.appendChild(configStatusDiv);

			const openPrefsBtn = doc.createElement("button");
			openPrefsBtn.className = "zotero-button";
			openPrefsBtn.textContent = this._locale === "zh" ? "打开 API Key 设置…" : "Open API Key settings…";
			openPrefsBtn.style.cssText = "width:100%; padding:4px; cursor:pointer; margin-top:8px;";
			openPrefsBtn.addEventListener("click", () => this.openPreferencePane());
			presetTabContent.appendChild(openPrefsBtn);

			container.appendChild(presetTabContent);

			// 管理列表联动
			const refreshManageList = () => this._refreshPresetUI(doc);

			manageListBox.addEventListener("change", () => {
				const idx = parseInt(manageListBox.value, 10);
				const p = this.cachedPresets && this.cachedPresets[idx];
				if (p) {
					mNameInput.value = p.name;
					mPromptInput.value = p.prompt;
				}
			});

			mAddBtn.addEventListener("click", async () => {
				const name = mNameInput.value.trim();
				const prompt = mPromptInput.value.trim();
				if (!name || !prompt) { this.showAlert(this.getString("alert-title"), this.getString("alert-empty-fields")); return; }
				const newList = [...(this.cachedPresets || [])];
				newList.push({ name, prompt });
				await this.savePromptPresets(newList);
				refreshManageList();
				manageListBox.value = String(newList.length - 1);
				this.showAlert(this.getString("alert-title"), this.getString("alert-add-ok"));
			});

			mSaveBtn.addEventListener("click", async () => {
				const idx = parseInt(manageListBox.value, 10);
				if (isNaN(idx) || !this.cachedPresets || !this.cachedPresets[idx]) { this.showAlert("DeepRead", "请先在上方列表中选择一项"); return; }
				const name = mNameInput.value.trim();
				const prompt = mPromptInput.value.trim();
				if (!name || !prompt) { this.showAlert("DeepRead", "名称和内容不能为空"); return; }
				const newList = [...this.cachedPresets];
				newList[idx] = { name, prompt };
				await this.savePromptPresets(newList);
				refreshManageList();
				manageListBox.value = String(idx);
				this.showAlert(this.getString("alert-title"), this.getString("alert-save-ok"));
			});

			mDelBtn.addEventListener("click", async () => {
				const idx = parseInt(manageListBox.value, 10);
				const win = doc.defaultView || Zotero.getMainWindow();

				if (isNaN(idx) || !this.cachedPresets || !this.cachedPresets[idx]) {
					this.showAlert(this.getString("alert-title"), this.getString("alert-select-first"));
					return;
				}

				if (!win.confirm(_t("confirm-clear"))) return; // 复用确认文案

				if (this.cachedPresets.length <= 1) {
					this.showAlert(this.getString("alert-title"), this.getString("alert-min-presets"));
					return;
				}

				const newList = [...this.cachedPresets];
				newList.splice(idx, 1);
				await this.savePromptPresets(newList);
				refreshManageList();
				mNameInput.value = "";
				mPromptInput.value = "";
				this.showAlert(this.getString("alert-title"), this.getString("alert-delete-ok"));
			});

			mDefaultBtn.addEventListener("click", async () => {
				const idx = parseInt(manageListBox.value, 10);
				if (isNaN(idx) || !this.cachedPresets || !this.cachedPresets[idx]) { this.showAlert(_t("alert-title"), _t("alert-select-first")); return; }
				if (idx === 0) return; // 已经是默认
				const newList = [...this.cachedPresets];
				const [item] = newList.splice(idx, 1);
				newList.unshift(item); // 移到首位
				await this.savePromptPresets(newList);
				refreshManageList();
				manageListBox.value = "0";
				this.showAlert(_t("alert-title"), _t("alert-save-ok"));
			});

			// ==================== 对话阅读 Tab (chatTabContent) ====================

			// ── 附件多选区域 ──
			const attachmentSelectorDiv = doc.createElement("div");
			attachmentSelectorDiv.style.cssText = `margin-bottom: 8px; font-size: 11px; color: #444;`;
			
			const attachments = [];
			if (topLevelItem.isRegularItem && topLevelItem.isRegularItem()) {
				const ids = topLevelItem.getAttachments ? topLevelItem.getAttachments() : [];
				for (const id of ids) {
					const att = Zotero.Items.get(id);
					if (this._isSupportedAttachment(att)) {
						attachments.push(att);
					}
				}
			} else if (this._isSupportedAttachment(topLevelItem)) {
				attachments.push(topLevelItem);
			}

			if (attachments.length > 0) {
				const attListHeader = doc.createElement("div");
				attListHeader.style.cssText = `font-weight: 600; margin-bottom: 4px; display: flex; align-items: center; gap: 4px;`;
				attListHeader.innerHTML = `<span style="color:#1565c0;">\uD83D\uDCCE</span> ${_t("select-all")}`;
				const masterCb = doc.createElement("input");
				masterCb.type = "checkbox";
				
				// 默认选中策略：
				// 1. 如果是从阅读器打开 (isFromReader) -> 只选当前 PDF，不全选
				// 2. 如果在库里选中父条目 (item.isRegularItem) -> 全选
				// 3. 如果在库里选中具体的附件条目 (item 不是 Regular) -> 只选当前选中的附件，不全选
				const isParentSelected = !isFromReader && item && item.isRegularItem && item.isRegularItem();
				masterCb.checked = isParentSelected; 
				
				masterCb.style.cssText = `margin: 0; cursor: pointer;`;
				
				const attItemsDiv = doc.createElement("div");
				attItemsDiv.style.cssText = `display: flex; flex-direction: column; gap: 2px; padding-left: 18px;`;

				attachments.forEach(att => {
					const attLabel = doc.createElement("label");
					attLabel.style.cssText = `display: flex; align-items: center; gap: 5px; cursor: pointer; padding: 2px 0;`;
					const cb = doc.createElement("input");
					cb.type = "checkbox";
					cb.className = "deepread-att-cb";
					cb.value = String(att.id);
					// 默认选中逻辑：
					// 如果是父条目选中 -> 全选所有
					// 如果是具体附件选中 (无论是在阅读器还是库里) -> 只选中 effectiveItem 对应的那个
					cb.checked = isParentSelected || (att.id === effectiveItem.id);
					
					attLabel.appendChild(cb);
					const nameSpan = doc.createElement("span");
					const { fullTitle, displayTitle } = (() => {
						let rawTitle = att.getField("title") || _t("untitled");
						let extStr = "";
						try {
							const path = att.attachmentPath || (att.getFilePath && att.getFilePath()) || "";
							const ext = path.split(".").pop().toUpperCase();
							if (ext && ext.length <= 4) extStr = ` [${ext}]`;
						} catch(e) {}
						
						// If the title already ends with the extension string (e.g. " [PDF]"), remove it temporarily to avoid duplication
						if (extStr && rawTitle.toUpperCase().endsWith(extStr.toUpperCase())) {
							rawTitle = rawTitle.slice(0, -extStr.length).trim();
						} else if (rawTitle.match(/\s*\[[a-zA-Z0-9]+\]$/)) {
							// If we couldn't get it from path but title naturally ends with [XXX]
							const match = rawTitle.match(/\s*\[([a-zA-Z0-9]+)\]$/);
							if (match) {
								if (!extStr) extStr = ` [${match[1].toUpperCase()}]`;
								rawTitle = rawTitle.slice(0, match.index).trim();
							}
						}
						
						const fTitle = rawTitle + extStr;
						const shortTitle = rawTitle.length > 30 ? rawTitle.substring(0, 30) + "..." : rawTitle;
						return { fullTitle: fTitle, displayTitle: shortTitle + extStr };
					})();
					nameSpan.textContent = displayTitle;
					nameSpan.title = fullTitle; // 悬停显示全名
					nameSpan.style.cssText = `
						overflow: hidden;
						text-overflow: ellipsis;
						white-space: nowrap;
						font-size: 11px;
						line-height: 1.5;
						flex: 1;
					`;
					attLabel.appendChild(nameSpan);
					
					if (isFromReader && att.id === effectiveItem.id) {
						const curTag = doc.createElement("span");
						curTag.textContent = this._locale === 'zh' ? " [当前]" : " [Active]";
						curTag.style.cssText = `color: #2e7d32; font-size: 9px; font-weight: bold;`;
						attLabel.appendChild(curTag);
					}
					
					attItemsDiv.appendChild(attLabel);
				});

				masterCb.addEventListener("change", () => {
					attItemsDiv.querySelectorAll(".deepread-att-cb").forEach(c => c.checked = masterCb.checked);
				});
				attListHeader.prepend(masterCb);
				attachmentSelectorDiv.appendChild(attListHeader);
				attachmentSelectorDiv.appendChild(attItemsDiv);
			} else {
				const noAttHint = doc.createElement("div");
				noAttHint.style.cssText = `font-size: 10px; color: #e65100; background: #fff3e0; padding: 3px 8px; border-radius: 4px; border: 1px solid #ffe0b2;`;
				noAttHint.textContent = _t("hint-no-pdf");
				attachmentSelectorDiv.appendChild(noAttHint);
			}
			chatTabContent.appendChild(attachmentSelectorDiv);

			// ── 预设下拉区域 ──
			const presetRow = doc.createElement("div");
			presetRow.style.cssText = `display: flex; gap: 6px; align-items: center; margin-bottom: 6px;`;

			const presetSelect = this._createPresetPicker(doc);
			this._fillPresetPicker(presetSelect, this.cachedPresets || [], 0);

			const fillBtn = doc.createElement("button");
			fillBtn.id = "deepread-fill-btn";
			fillBtn.textContent = _t("btn-fill-input");
			fillBtn.className = "zotero-button";
			fillBtn.title = this._locale === "zh" ? "追加写入下方输入框" : "Append preset into the input box";
			fillBtn.style.cssText = `padding: 4px 8px; font-size: 11px; cursor: pointer; white-space: nowrap;`;

			const runBtn = doc.createElement("button");
			runBtn.id = "deepread-run-btn";
			runBtn.textContent = _t("btn-run");
			runBtn.className = "zotero-button";
			runBtn.title = this._locale === "zh" ? "用预设替换输入框内容并立即发送" : "Replace input with preset and send";
			runBtn.style.cssText = `padding: 4px 8px; font-size: 11px; cursor: pointer; white-space: nowrap;`;

			const updatePresetBtnState = () => {
				const val = presetSelect.value;
				const isEmpty = val === "" || val === null || val === undefined || !(this.cachedPresets && this.cachedPresets.length);
				[fillBtn, runBtn].forEach(btn => {
					btn.disabled = isEmpty;
					btn.style.opacity = isEmpty ? "0.5" : "1";
					btn.style.cursor = isEmpty ? "default" : "pointer";
				});
			};

			presetSelect._onChange = () => updatePresetBtnState();

			fillBtn.addEventListener("click", () => {
				const idx = parseInt(presetSelect.value, 10);
				const preset = this.cachedPresets && this.cachedPresets[idx];
				if (!preset) return;
				const inputEl = chatTabContent.querySelector("#deepread-chat-input");
				if (!inputEl) return;
				const chunk = preset.prompt || "";
				const cur = inputEl.value || "";
				if (cur.trim()) {
					inputEl.value = cur.replace(/\s*$/, "") + "\n" + chunk;
				} else {
					inputEl.value = chunk;
				}
				inputEl.focus();
				try {
					inputEl.setSelectionRange(inputEl.value.length, inputEl.value.length);
				} catch (e) { /* ignore */ }
			});

			runBtn.addEventListener("click", async () => {
				const idx = parseInt(presetSelect.value, 10);
				const preset = this.cachedPresets && this.cachedPresets[idx];
				if (!preset) return;
				const inputEl = chatTabContent.querySelector("#deepread-chat-input");
				const message = (preset.prompt || "").trim();
				if (!message) return;
				try {
					fillBtn.disabled = true;
					runBtn.disabled = true;
					runBtn.textContent = _t("btn-running");
					if (inputEl) inputEl.value = message; // 先替换填入
					const selectedIDs = Array.from(chatTabContent.querySelectorAll(".deepread-att-cb:checked")).map(cb => parseInt(cb.value, 10));
					if (inputEl) inputEl.value = "";
					await this.handleSendMessage(topLevelItem, message, selectedIDs);
				} catch (e) {
					this.showAlert("Error", e.message || String(e));
					if (inputEl) inputEl.value = message;
				} finally {
					runBtn.textContent = _t("btn-run");
					updatePresetBtnState();
				}
			});
			presetRow.appendChild(presetSelect);
			presetRow.appendChild(fillBtn);
			presetRow.appendChild(runBtn);
			// 预设栏挂到输入区上方（见下方 inputDiv）
			updatePresetBtnState();

			// ── 历史管理工具栏 ────────────────────────────────
			const toolbarDiv = doc.createElement("div");
			toolbarDiv.style.cssText = `display: flex; gap: 6px; align-items: center; flex-wrap: wrap;`;
			// 用于让按钮直接引用 chatDiv，避免阅读器模式下 doc.getElementById 找到错误节点
			let chatDivRef = null;

			// 全选复选框
			const selectAllLabel = doc.createElement("label");
			selectAllLabel.style.cssText = `display: flex; align-items: center; gap: 3px; font-size: 11px; color: #555; cursor: pointer;`;
			const selectAllCb = doc.createElement("input");
			selectAllCb.type = "checkbox";
			selectAllCb.id = "deepread-select-all";
			selectAllCb.addEventListener("change", () => {
				const target = chatDivRef || doc.getElementById("deepread-chat-container");
				if (!target) return;
				target.querySelectorAll(".deepread-msg-cb").forEach(cb => { cb.checked = selectAllCb.checked; });
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
					await this.handleSaveAsNote(effectiveItem, chatDivRef);
				} catch (e) {
					this.showAlert("Error", e.message || String(e));
				} finally {
					saveNoteBtn.disabled = false;
				}
			});
			toolbarDiv.appendChild(saveNoteBtn);

			const deleteSelBtn = makeToolBtn(_t("btn-delete-selected"), "color: #b71c1c;");
			deleteSelBtn.addEventListener("click", () => {
				const win = doc.defaultView || Zotero.getMainWindow();
				// 先统计选中数量
				const checkedWrappers = chatDivRef.querySelectorAll(".deepread-msg-wrapper .deepread-msg-cb:checked");
				if (checkedWrappers.length === 0) {
					this.showAlert(_t("alert-title"), _t("alert-check-del"));
					return;
				}
				// 有选中才提示确认
				if (win.confirm(_t("confirm-delete-selected"))) {
					this.handleDeleteSelected(effectiveItem, chatDivRef);
					if (selectAllCb) selectAllCb.checked = false;
				}
			});
			toolbarDiv.appendChild(deleteSelBtn);

			// 合并后的折叠/展开按钮
			let isAllFolded = false;
			const toggleFoldBtn = makeToolBtn(_t("btn-fold-all"), "color: #555;");
			toggleFoldBtn.addEventListener("click", () => {
				const target = chatDivRef || doc.getElementById("deepread-chat-container");
				if (!target) return;
				isAllFolded = !isAllFolded;
				target.querySelectorAll(".deepread-msg-wrapper").forEach(wrapper => {
					this._toggleMessageCollapse(wrapper, isAllFolded);
				});
				toggleFoldBtn.textContent = isAllFolded ? _t("btn-unfold-all") : _t("btn-fold-all");
			});
			toolbarDiv.appendChild(toggleFoldBtn);



			chatTabContent.appendChild(toolbarDiv);

			// ── 聊天区域 ─────────────────────────────────────
			const chatDiv = doc.createElement("div");
			chatDivRef = chatDiv;
			this._currentChatDiv = chatDiv; // 供 _appendMessageToUI 等方法跨文档使用
			chatDiv.id = "deepread-chat-container";
			chatDiv.setAttribute("data-top-item-id", String(topLevelItem.id)); // 增加 ID 标识以支持多窗口同步
			chatDiv.style.cssText = `
				flex: 1;
				overflow-y: auto;
				border: 1px solid rgba(0,0,0,0.08);
				border-radius: 6px;
				padding: 8px 10px;
				background: #ffffff;
				box-shadow: 0 1px 2px rgba(0,0,0,0.04);
				margin-bottom: 4px;
				user-select: text;
				-moz-user-select: text;
				-webkit-user-select: text;
			`;

			// ── 历史记录加载与补丁迁移 (v0.7.0+) ────────────────────────
			const historyKey = this._getHistoryKey(topLevelItem);
			let history = this.chatHistory.get(historyKey) || [];

			/**
			 * [补丁] 历史数据兼容性迁移逻辑
			 * 原因：旧版本插件可能曾将对话记录挂载在附件 ID（如 PDF ID）而非父条目 ID 下。
			 * 逻辑：如果当前通过附件打开，检查该附件 ID 是否存有旧记录。如果有，则合并到父条目主记录中。
			 * 移除时机：当你确认所有旧记录都已在使用过程中自动完成“归拢”后，可删除此段 if 块。
			 */
			if (effectiveItem && effectiveItem.id !== topLevelItem.id) {
				const legacyKey = String(effectiveItem.id);
				const legacyHistory = this.chatHistory.get(legacyKey);
				if (legacyHistory && legacyHistory.length > 0) {
					this.log(`Migrating legacy history from attachment ${legacyKey} to parent ${historyKey}`);
					// 合并记录（这里简单做追溯合并）
					history = [...legacyHistory, ...history];
					this.chatHistory.set(historyKey, history);
					this.chatHistory.delete(legacyKey); // 清理旧 Key
					this.saveChatHistory(); // 同步到本地文件
				}
			}

			history.forEach((msg, idx) => {
				const showResend = msg.role === "user" && idx === history.length - 1;
				const msgDiv = this.renderMessage(msg, doc, idx, { showResend });
				chatDiv.appendChild(msgDiv);
			});
			// ──────────────────────────────────────────────────

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

			const bottomRow = doc.createElement("div");
			bottomRow.style.cssText = `
				display: flex;
				align-items: center;
				gap: 8px;
			`;

			const modelSelect = this._createModelPicker(doc);

			const sendBtn = doc.createElement("button");
			sendBtn.textContent = _t("btn-send");
			sendBtn.className = "zotero-button";
			sendBtn.style.cssText = `
				padding: 6px 18px;
				font-size: 12px;
				cursor: pointer;
				white-space: nowrap;
				flex-shrink: 0;
			`;
			sendBtn.addEventListener("click", async () => {
				const message = input.value.trim();
				if (message) {
					try {
						sendBtn.disabled = true;
						input.value = "";
						// 获取当前选中的附件 IDs
						const selectedIDs = Array.from(chatTabContent.querySelectorAll(".deepread-att-cb:checked")).map(cb => parseInt(cb.value, 10));
						await this.handleSendMessage(topLevelItem, message, selectedIDs);
					} catch (e) {
						this.showAlert("Error", e.message || String(e));
						input.value = message; // restore message
					} finally {
						sendBtn.disabled = false;
					}
				}
			});

			bottomRow.appendChild(modelSelect);
			bottomRow.appendChild(sendBtn);

			// 预设栏紧贴输入框上方：填入=追加，发送=替换后发送
			inputDiv.appendChild(presetRow);
			inputDiv.appendChild(input);
			inputDiv.appendChild(bottomRow);
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
			// 确保挂载后再刷新预设列表，增加一个延迟以确保 DOM 稳定
			setTimeout(() => {
				this._refreshPresetUI(doc);
				this._refreshConfigStatus(doc);
			}, 300);
		} catch (error) {
			this.log(`Failed to render ItemPane: ${error.message}`);
			pane.innerHTML = `<div style="padding: 10px; color: red;">${this.getString("render-error")}: ${this._escapeHTML(error.message)}</div>`;
		}
	},

	_makeMsgActionBtn(doc, { title, icon, className, danger }) {
		const btn = doc.createElement("button");
		btn.type = "button";
		if (className) btn.className = className;
		btn.title = title || "";
		btn.setAttribute("aria-label", title || "");
		btn.textContent = icon;
		btn.style.cssText = `
			appearance: none;
			-moz-appearance: none;
			border: none;
			background: transparent;
			padding: 1px 3px;
			margin: 0;
			cursor: pointer;
			font-size: 12px;
			line-height: 1;
			opacity: 0.55;
			border-radius: 3px;
			color: ${danger ? "#c62828" : "#444"};
		`;
		btn.addEventListener("mouseenter", () => {
			btn.style.opacity = "1";
			btn.style.background = danger ? "rgba(198,40,40,0.08)" : "rgba(0,0,0,0.06)";
		});
		btn.addEventListener("mouseleave", () => {
			btn.style.opacity = "0.55";
			btn.style.background = "transparent";
		});
		return btn;
	},

	_getMsgTopItem(wrapper) {
		try {
			const chatContainer = wrapper && wrapper.closest("#deepread-chat-container");
			const itemID = chatContainer && chatContainer.getAttribute("data-top-item-id");
			const item = itemID ? Zotero.Items.get(parseInt(itemID, 10)) : null;
			return item ? this._getTopLevelItem(item) : null;
		} catch (e) {
			return null;
		}
	},

	renderMessage(msg, doc, msgIndex, options = {}) {
		if (!doc) {
			const win = typeof Zotero !== "undefined" && Zotero.getMainWindow ? Zotero.getMainWindow() : null;
			doc = win ? win.document : null;
		}
		if (!doc) throw new Error("Document object not found");
		const _t = (k) => this.getString(k);

		const msgDiv = doc.createElement("div");
		msgDiv.className = "deepread-msg-wrapper" + (msg.role === "assistant" ? " deepread-msg-assistant" : " deepread-msg-user");
		if (msgIndex !== undefined) msgDiv.setAttribute("data-index", String(msgIndex));
		// AI：白底 + 蓝点缀（标题/列表）；用户：暖橙提问框，和 AI 冷色对比
		msgDiv.style.cssText = `
			margin-bottom: 8px;
			padding: 0;
			border-radius: 4px;
			background: ${msg.role === "user" ? "#fff8f1" : "#fff"};
			border: 1px solid ${msg.role === "user" ? "#ffe0b2" : "#e3eaf2"};
			${msg.role === "user" ? "border-left: 3px solid #f57c00;" : ""}
			position: relative;
			transition: all 0.2s ease;
			user-select: text;
			-moz-user-select: text;
			-webkit-user-select: text;
		`;

		// 头部：左角色 / 右操作条（折叠·重发·笔记·预设·复制·删除）
		const header = doc.createElement("div");
		header.className = "deepread-msg-header";
		header.style.cssText = `
			padding: 5px 8px;
			cursor: pointer;
			display: flex;
			align-items: center;
			justify-content: space-between;
			gap: 6px;
			user-select: none;
			background: rgba(0,0,0,0.02);
		`;

		const leftPart = doc.createElement("div");
		leftPart.style.cssText = `display: flex; align-items: center; gap: 6px; min-width: 0;`;

		const toggleIcon = doc.createElement("span");
		toggleIcon.className = "deepread-toggle-icon";
		toggleIcon.textContent = "\u25BC";
		toggleIcon.style.cssText = `font-size: 10px; color: #999; transition: transform 0.2s; flex-shrink: 0;`;

		const roleSpan = doc.createElement("span");
		roleSpan.textContent = msg.role === "user" ? this.getString("role-user") : "AI";
		roleSpan.style.cssText = `font-weight: bold; font-size: 11px; color: #666; flex-shrink: 0;`;

		leftPart.appendChild(toggleIcon);
		leftPart.appendChild(roleSpan);

		if (msg.role === "assistant" && msg.model) {
			const modelSpan = doc.createElement("span");
			modelSpan.textContent = `(${msg.model})`;
			modelSpan.style.cssText = `font-size: 10px; color: #aaa; font-weight: normal; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;`;
			leftPart.appendChild(modelSpan);
		}

		header.appendChild(leftPart);

		const actionContainer = doc.createElement("div");
		actionContainer.className = "deepread-msg-actions";
		actionContainer.style.cssText = `
			display: flex;
			align-items: center;
			gap: 2px;
			flex-shrink: 0;
		`;

		const stop = (e) => { e.stopPropagation(); };

		const toggleBtn = this._makeMsgActionBtn(doc, {
			title: _t("menu-toggle"),
			icon: "\u21c4",
			className: "deepread-msg-action-toggle"
		});
		toggleBtn.addEventListener("click", (e) => {
			stop(e);
			this._toggleMessageCollapse(msgDiv);
		});
		actionContainer.appendChild(toggleBtn);

		if (options.showResend && msg.role === "user") {
			const resendBtn = this._makeMsgActionBtn(doc, {
				title: this._locale === "zh" ? "重新发送" : "Resend",
				icon: "🔄",
				className: "deepread-resend-btn"
			});
			resendBtn.addEventListener("click", async (e) => {
				stop(e);
				try {
					const chatContainer = msgDiv.closest("#deepread-chat-container");
					if (chatContainer && chatContainer.querySelector(".deepread-loading-indicator-cls")) return;
					const topItem = this._getMsgTopItem(msgDiv);
					if (!topItem) return;
					await this._handleResend(topItem);
				} catch (err) {
					this.showAlert("DeepRead", err.message || String(err));
				}
			});
			actionContainer.appendChild(resendBtn);
		}

		const noteBtn = this._makeMsgActionBtn(doc, {
			title: _t("menu-save-note"),
			icon: "\ud83d\udcd1",
			className: "deepread-msg-action-note"
		});
		noteBtn.addEventListener("click", (e) => {
			stop(e);
			const effectiveItem = this._getEffectiveItemFromDoc(doc);
			this.handleSaveAsNote(effectiveItem, null, [msgIndex]);
		});
		actionContainer.appendChild(noteBtn);

		const presetBtn = this._makeMsgActionBtn(doc, {
			title: _t("menu-save-preset"),
			icon: "\u2728",
			className: "deepread-msg-action-preset"
		});
		presetBtn.addEventListener("click", (e) => {
			stop(e);
			const effectiveItem = this._getEffectiveItemFromDoc(doc);
			this.handleSaveAsPrompt(effectiveItem, null, () => this._refreshPresetUI(doc), [msgIndex]);
		});
		actionContainer.appendChild(presetBtn);

		const copyBtn = this._makeMsgActionBtn(doc, {
			title: this._locale === "zh" ? "复制" : "Copy",
			icon: "\uD83D\uDCCB",
			className: "deepread-msg-action-copy"
		});
		copyBtn.addEventListener("click", (e) => {
			stop(e);
			this._copyToClipboard(msg.content, doc);
		});
		actionContainer.appendChild(copyBtn);

		const delBtn = this._makeMsgActionBtn(doc, {
			title: _t("menu-delete"),
			icon: "\ud83d\uddd1",
			className: "deepread-msg-action-delete",
			danger: true
		});
		delBtn.addEventListener("click", (e) => {
			stop(e);
			const win = doc.defaultView || Zotero.getMainWindow();
			if (win.confirm(_t("confirm-delete-selected"))) {
				const effectiveItem = this._getEffectiveItemFromDoc(doc);
				this.handleDeleteSelected(effectiveItem, msgDiv.parentNode, new Set([msgIndex]));
			}
		});
		actionContainer.appendChild(delBtn);

		const cb = doc.createElement("input");
		cb.type = "checkbox";
		cb.className = "deepread-msg-cb";
		cb.title = this._locale === "zh" ? "选择" : "Select";
		cb.style.cssText = `margin: 0 0 0 2px; cursor: pointer;`;
		cb.addEventListener("click", stop);
		actionContainer.appendChild(cb);

		header.appendChild(actionContainer);
		msgDiv.appendChild(header);

		const contentDiv = doc.createElement("div");
		contentDiv.className = "deepread-msg-content";
		if (msg.role === "assistant") {
			this._injectKatexAssets(doc);
			this._ensureMarked(doc);
			contentDiv.innerHTML = this._markdownToHTML(msg.content);
		} else {
			contentDiv.textContent = msg.content;
		}
		contentDiv.style.cssText = `
			padding: 8px 10px 10px;
			font-size: 12px;
			line-height: 1.55;
			${msg.role === "assistant" ? "" : "white-space: pre-wrap;"}
			word-wrap: break-word;
			border-top: 1px solid rgba(0,0,0,0.03);
			overflow: hidden;
			user-select: text;
			-moz-user-select: text;
			-webkit-user-select: text;
			color: #222;
		`;
		if (msg.role === "assistant") {
			this._injectMarkdownStyles(doc);
			contentDiv.addEventListener("click", (e) => {
				const a = e.target && e.target.closest ? e.target.closest("a.dr-md-link") : null;
				if (!a) return;
				e.preventDefault();
				e.stopPropagation();
				const href = a.getAttribute("href");
				if (href && typeof Zotero !== "undefined" && Zotero.launchURL) {
					Zotero.launchURL(href);
				}
			});
		}
		msgDiv.appendChild(contentDiv);

		const doToggle = () => this._toggleMessageCollapse(msgDiv);
		header.addEventListener("click", doToggle);
		// 右键菜单保留作备用，与顶栏按钮同一套能力
		msgDiv.addEventListener("contextmenu", (e) => {
			e.preventDefault();
			this._showContextMenu(e, msgDiv, msg, msgIndex);
		});

		return msgDiv;
	},

	_showContextMenu(e, wrapper, msg, msgIndex) {
		const doc = wrapper.ownerDocument;
		const _t = (k) => this.getString(k);

		// 先移除可能存在的旧菜单
		const oldMenu = doc.getElementById("deepread-context-menu");
		if (oldMenu) oldMenu.remove();

		const menu = doc.createElement("div");
		menu.id = "deepread-context-menu";
		menu.style.cssText = `
			position: fixed;
			z-index: 10000;
			background: #fff;
			border: 1px solid #ccc;
			box-shadow: 2px 2px 10px rgba(0,0,0,0.2);
			padding: 4px 0;
			min-width: 100px;
			border-radius: 4px;
			font-size: 12px;
			left: ${e.clientX}px;
			top: ${e.clientY}px;
		`;

		const addItem = (label, icon, onClick) => {
			const item = doc.createElement("div");
			item.style.cssText = `padding: 6px 12px; cursor: pointer; display: flex; align-items: center; gap: 8px;`;
			item.innerHTML = `<span style="display:inline-block; width:18px; text-align:center; font-size:14px; color:#555;">${icon}</span> <span style="flex:1;">${label}</span>`;
			item.addEventListener("mouseover", () => { item.style.background = "#f0f0f0"; });
			item.addEventListener("mouseout", () => { item.style.background = "transparent"; });
			item.addEventListener("click", (evt) => {
				evt.stopPropagation();
				menu.remove();
				onClick();
			});
			menu.appendChild(item);
		};

		addItem(_t("menu-toggle"), "\u21c4", () => this._toggleMessageCollapse(wrapper));

		// ── 重新发送：历史最后一条是用户消息（AI 尚未回复）────────────────
		try {
			const chatContainer = wrapper.closest("#deepread-chat-container");
			const itemID = chatContainer && chatContainer.getAttribute("data-top-item-id");
			const item = itemID ? Zotero.Items.get(parseInt(itemID, 10)) : null;
			if (item) {
				const topItem = this._getTopLevelItem(item);
				const history = this.chatHistory.get(this._getHistoryKey(topItem)) || [];
				const isLoading = !!chatContainer.querySelector(".deepread-loading-indicator-cls");
				const isLastUser = msg.role === "user"
					&& history.length > 0
					&& msgIndex === history.length - 1
					&& history[history.length - 1].role === "user";
				if (isLastUser && !isLoading) {
					addItem(this._locale === "zh" ? "重新发送" : "Resend", "🔄", () => this._handleResend(topItem));
				}
			}
		} catch (e) { }

		addItem(_t("menu-save-note"), "\ud83d\udcd1", () => {
			const effectiveItem = this._getEffectiveItemFromDoc(doc);
			this.handleSaveAsNote(effectiveItem, null, [msgIndex]);
		});

		addItem(_t("menu-save-preset"), "\u2728", () => {
			const effectiveItem = this._getEffectiveItemFromDoc(doc);
			this.handleSaveAsPrompt(effectiveItem, null, () => this._refreshPresetUI(doc), [msgIndex]);
		});

		addItem(_t("menu-delete"), "\ud83d\uddd1", () => {
			const win = doc.defaultView || Zotero.getMainWindow();
			if (win.confirm(_t("confirm-delete-selected"))) {
				const effectiveItem = this._getEffectiveItemFromDoc(doc);
				this.handleDeleteSelected(effectiveItem, wrapper.parentNode, new Set([msgIndex]));
			}
		});

		(doc.body || doc.documentElement).appendChild(menu);

		const hideMenu = () => {
			menu.remove();
			doc.removeEventListener("click", hideMenu);
		};
		// 延迟绑定，防止当前点击立即触发隐藏
		setTimeout(() => doc.addEventListener("click", hideMenu), 10);
	},

	_getEffectiveItemFromDoc(doc) {
		// 尝试从全局状态或文档中反推当前条目
		const { readerItem } = this._getActiveReaderItem(doc);
		if (readerItem) return readerItem;
		// 如果不在阅读器，可能需要从 renderItemPane 的上下文中找，
		// 这里简化一下，依赖于 _currentChatDiv 对应的条目逻辑（通常是选中的条目）
		return Zotero.getActiveZoteroPane().getSelectedItems()[0];
	},

	async _refreshPresetUI(doc) {
		const presetSelect = doc.getElementById("deepread-preset-select");
		const manageList = doc.getElementById("deepread-manage-list");
		
		if (!presetSelect && !manageList) return;

		const presets = await this.loadPromptPresets();

		// 1. 更新对话预设自定义下拉（与模型选择同风格）
		if (presetSelect) {
			const currentVal = presetSelect.value;
			const keep = (currentVal && presets[parseInt(currentVal, 10)]) ? currentVal : "0";
			this._fillPresetPicker(presetSelect, presets, keep);

			const isEmpty = presets.length === 0;
			["deepread-run-btn", "deepread-fill-btn"].forEach(id => {
				const btn = doc.getElementById(id);
				if (!btn) return;
				btn.disabled = isEmpty;
				btn.style.opacity = isEmpty ? "0.5" : "1";
				btn.style.cursor = isEmpty ? "default" : "pointer";
			});
		}

		// 2. 更新设置管理列表（显示 [默认] 标记，方便管理）
		if (manageList) {
			const currentVal = manageList.value;
			manageList.innerHTML = "";
			presets.forEach((p, i) => {
				const opt = doc.createElement("option");
				opt.value = String(i);
				const baseName = p.name.length > 30 ? p.name.substring(0, 30) + "..." : p.name;
				opt.textContent = baseName + (i === 0 ? this.getString("default-mark") : "");
				opt.title = p.name; // Tooltip for full name
				manageList.appendChild(opt);
			});
			if (currentVal && presets[parseInt(currentVal, 10)]) {
				manageList.value = currentVal;
			}
		}
	},

	_toggleMessageCollapse(wrapper, forceState) {
		const content = wrapper.querySelector(".deepread-msg-content");
		const icon = wrapper.querySelector(".deepread-toggle-icon");
		if (!content || !icon) return;

		const isCurrentlyCollapsed = content.style.display === "none";
		const shouldCollapse = (forceState !== undefined) ? forceState : !isCurrentlyCollapsed;

		if (shouldCollapse) {
			content.style.display = "none";
			icon.style.transform = "rotate(-90deg)";
			wrapper.style.opacity = "0.8";
		} else {
			content.style.display = "block";
			icon.style.transform = "rotate(0deg)";
			wrapper.style.opacity = "1";
		}
	},

	_copyToClipboard(text, doc) {
		if (typeof Zotero !== "undefined" && Zotero.getMainWindow) {
			try {
				const clipboardHelper = Components.classes["@mozilla.org/widget/clipboardhelper;1"]
					.getService(Components.interfaces.nsIClipboardHelper);
				clipboardHelper.copyString(text);
				this.showAlert(this.getString("alert-title"), this.getString("alert-copy-ok"));
			} catch (err) {
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
	},

	async handleGenerateSummary(item) {
		const topItem = this._getTopLevelItem(item);
		await this.syncProviderConfig();
		if (!this.provider || !this.provider.config.apiKey) {
			this.showAlert("DeepRead", "请先在设置中配置 API Key");
			return;
		}
		try {
			this._showLoading(topItem.id);
			const pdfData = await this._getPdfData(item);
			const result = await this.provider.generateSummary(pdfData, { language: "zh", length: "medium" });
			const selectedModel = Zotero.Prefs.get("extensions.deepread.model");
			const { key, history } = this._getOrCreateHistory(topItem);
			const msg = { role: "assistant", content: `【摘要】\n${result.content}`, model: selectedModel };
			history.push(msg);
			this.chatHistory.set(key, history);
			this.saveChatHistory();
			this._hideLoading(topItem.id);
			this._appendMessageToUI(msg, history.length - 1, topItem.id);
			this.log("Generate summary completed");
		} catch (error) {
			this._hideLoading(topItem.id);
			this.log(`Generate summary failed: ${error.message}`);
			this.showAlert(this.getString("alert-title"), this.getString("summary-fail", { error: error.message }));
		}
	},

	async handleExtractNumbers(item) {
		const topItem = this._getTopLevelItem(item);
		await this.syncProviderConfig();
		if (!this.provider || !this.provider.config.apiKey) {
			this.showAlert("DeepRead", "请先在设置中配置 API Key");
			return;
		}
		try {
			this._showLoading(topItem.id);
			const pdfData = await this._getPdfData(item);
			const result = await this.provider.extractNumbers(pdfData, {});
			const pretty = typeof result === "string" ? result : JSON.stringify(result, null, 2);
			const { key, history } = this._getOrCreateHistory(topItem);
			const msg = { role: "assistant", content: `【表格提取】\n${pretty}` };
			history.push(msg);
			this.chatHistory.set(key, history);
			this.saveChatHistory();
			this._hideLoading(topItem.id);
			this._appendMessageToUI(msg, history.length - 1, topItem.id);
			this.log("Extract numbers completed");
		} catch (error) {
			this._hideLoading(topItem.id);
			this.log(`Extract numbers failed: ${error.message}`);
			this.showAlert(this.getString("alert-title"), this.getString("extract-fail", { error: error.message }));
		}
	},

	async handleSendMessage(item, message, specificItemIDs) {
		const topItem = this._getTopLevelItem(item);
		await this.syncProviderConfig();
		if (!this.provider || !this.provider.config.apiKey) {
			this.showAlert("DeepRead", "请先在设置中配置 API Key");
			return;
		}
		try {
			const pdfData = await this._getPdfData(topItem, specificItemIDs);
			const { key, history } = this._getOrCreateHistory(topItem);
			const userMsg = { role: "user", content: message };
			history.push(userMsg);
			this.chatHistory.set(key, history);
			this.saveChatHistory();
			this._appendMessageToUI(userMsg, history.length - 1, topItem.id);
			this.log(`Send message: ${message}`);

			this._showLoading(topItem.id);
			await this.syncProviderConfig(); // 再次确保同步到最新
			const activeModel = this.provider.config.model;
			const result = await this.provider.chat(history, { model: activeModel }, pdfData);
			const assistantMsg = { role: "assistant", content: result.content, model: activeModel };
			history.push(assistantMsg);
			this.chatHistory.set(key, history);
			this.saveChatHistory();
			this._hideLoading(topItem.id);
			this._appendMessageToUI(assistantMsg, history.length - 1, topItem.id);
		} catch (error) {
			this._hideLoading(topItem.id);
			this.log(`Send message failed: ${error.message}`);
			this.showAlert(this.getString("alert-title"), this.getString("send-fail", { error: error.message }));
		}
	},

	// ──────────────────────────────────────────────
	// 预设快捷执行
	// ──────────────────────────────────────────────
	async handleRunPreset(item, preset, specificItemIDs) {
		const topItem = this._getTopLevelItem(item);
		await this.syncProviderConfig();
		if (!this.provider || !this.provider.config.apiKey) {
			this.showAlert("DeepRead", "请先在设置中配置 API Key");
			return;
		}
		try {
			const pdfData = await this._getPdfData(topItem, specificItemIDs);
			const { key, history } = this._getOrCreateHistory(topItem);
			const userMsg = { role: "user", content: preset.prompt };
			history.push(userMsg);
			this.chatHistory.set(key, history);
			this.saveChatHistory();
			this._appendMessageToUI(userMsg, history.length - 1, topItem.id);
			this.log(`Run preset: ${preset.name}`);

			this._showLoading(topItem.id);
			await this.syncProviderConfig();
			const activeModel = this.provider.config.model;
			const result = await this.provider.chat(history, { model: activeModel }, pdfData);
			const assistantMsg = { role: "assistant", content: result.content, model: activeModel };
			history.push(assistantMsg);
			this.chatHistory.set(key, history);
			this.saveChatHistory();
			this._hideLoading(topItem.id);
			this._appendMessageToUI(assistantMsg, history.length - 1, topItem.id);
		} catch (error) {
			this._hideLoading(topItem.id);
			this.log(`Run preset failed: ${error.message}`);
			this.showAlert(this.getString("alert-title"), this.getString("run-preset-fail", { error: error.message }));
		}
	},

	/**
	 * 重新发送（用于处理历史记录中只有一条 User 提问但没有 AI 回复的情况）
	 */
	async _handleResend(item) {
		const topItem = this._getTopLevelItem(item);
		await this.syncProviderConfig();
		if (!this.provider || !this.provider.config.apiKey) {
			this.showAlert("DeepRead", "请先在设置中配置 API Key");
			return;
		}

		try {
			// 在重新发送时，我们需要尝试获取当前的附件选择状态
			let selectedIDs = [];
			try {
				const windows = Zotero.getMainWindows();
				for (let win of windows) {
					const doc = win.document;
					// 查找对应条目的面板并尝试读取勾选的附件
					const container = doc.querySelector(`[data-top-item-id="${topItem.id}"]`);
					if (container) {
						selectedIDs = Array.from(container.querySelectorAll(".deepread-att-cb:checked")).map(cb => parseInt(cb.value, 10));
						if (selectedIDs.length > 0) break;
					}
				}
			} catch (e) {
				this.log("Failed to auto-detect selected attachments for resend, using all: " + e.message);
			}

			const pdfData = await this._getPdfData(topItem, selectedIDs);
			const { key, history } = this._getOrCreateHistory(topItem);
			
			this._showLoading(topItem.id);
			await this.syncProviderConfig();
			const activeModel = this.provider.config.model;
			const result = await this.provider.chat(history, { model: activeModel }, pdfData);
			
			const assistantMsg = { role: "assistant", content: result.content, model: activeModel };
			history.push(assistantMsg);
			this.chatHistory.set(key, history);
			this.saveChatHistory();
			this._hideLoading(topItem.id);
			this._appendMessageToUI(assistantMsg, history.length - 1, topItem.id);
		} catch (error) {
			this._hideLoading(topItem.id);
			this.log(`Resend failed: ${error.message}`);
			const errTitle = this._locale === "zh" ? "发送失败" : "Send Failed";
			this.showAlert(errTitle, error.message);
		}
	},

	// ──────────────────────────────────────────────
	// 存为 Zotero 笔记
	// ──────────────────────────────────────────────
	async handleSaveAsNote(item, chatDiv, singleIndices) {
		const topItem = this._getTopLevelItem(item);
		const doc = chatDiv ? chatDiv.ownerDocument : (this._currentChatDiv ? this._currentChatDiv.ownerDocument : null);

		const checked = [];
		if (singleIndices) {
			checked.push(...singleIndices);
		} else if (chatDiv) {
			chatDiv.querySelectorAll(".deepread-msg-wrapper").forEach(wrapper => {
				const cb = wrapper.querySelector(".deepread-msg-cb");
				if (cb && cb.checked) {
					const idx = parseInt(wrapper.getAttribute("data-index"), 10);
					checked.push(idx);
				}
			});
		}

		if (checked.length === 0) {
			this.showAlert(this.getString("alert-title"), this.getString("alert-check-note"));
			return;
		}

		const history = this.chatHistory.get(this._getHistoryKey(topItem)) || [];
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

		const now = new Date();
		const dateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
		const title = item.getField && item.getField("title") || this.getString("untitled-item");

		const noteTitle = this._locale === 'zh' ? `AI 阅读笔记 - ${dateStr}` : `AI Reading Note - ${dateStr}`;
		const noteContent = `<h2>${noteTitle}</h2><p><strong>Item:</strong> ${this._escapeHTML(title)}</p><hr/><pre style="white-space:pre-wrap;font-family:sans-serif;">${lines.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")}</pre>`;

		try {
			const note = new Zotero.Item("note");
			note.libraryID = topItem.libraryID;
			note.parentID = topItem.id;
			note.setNote(noteContent);
			await note.saveTx();
			// this.showAlert(this.getString("alert-title"), this.getString("alert-note-ok", { count: checked.length }));
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
	async handleSaveAsPrompt(item, chatDiv, refreshSelectCallback, singleIndices) {
		if (!chatDiv && !singleIndices) return;
		const doc = chatDiv ? chatDiv.ownerDocument : (this._currentChatDiv ? this._currentChatDiv.ownerDocument : null);

		const checked = [];
		if (singleIndices) {
			checked.push(...singleIndices);
		} else if (chatDiv) {
			chatDiv.querySelectorAll(".deepread-msg-wrapper").forEach(wrapper => {
				const cb = wrapper.querySelector(".deepread-msg-cb");
				if (cb && cb.checked) {
					const idx = parseInt(wrapper.getAttribute("data-index"), 10);
					checked.push(idx);
				}
			});
		}

		if (checked.length === 0) {
			this.showAlert(this.getString("alert-title"), this.getString("alert-check-preset"));
			return;
		}

		const topItem = this._getTopLevelItem(item);
		const history = this.chatHistory.get(this._getHistoryKey(topItem)) || [];
		const promptContent = checked
			.sort((a, b) => a - b)
			.map(idx => history[idx] ? history[idx].content : "")
			.filter(Boolean)
			.join("\n\n");

		if (!promptContent) return;

		const win = doc.defaultView || Zotero.getMainWindow();
		const name = win.prompt(this.getString("alert-preset-name-prompt"), this.getString("alert-preset-name-default"));
		if (!name) return;

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
	handleDeleteSelected(item, chatDiv, singleIndices) {
		if (!chatDiv) return;
		const doc = chatDiv.ownerDocument;

		const toDelete = singleIndices || new Set();
		if (!singleIndices) {
			chatDiv.querySelectorAll(".deepread-msg-wrapper").forEach(wrapper => {
				const cb = wrapper.querySelector(".deepread-msg-cb");
				if (cb && cb.checked) {
					toDelete.add(parseInt(wrapper.getAttribute("data-index"), 10));
				}
			});
		}

		if (toDelete.size === 0) {
			this.showAlert(this.getString("alert-title"), this.getString("alert-check-del"));
			return;
		}

		// 单条删除不弹窗，批量删除才弹窗（已经在调用处处理了确认，这里保持纯净逻辑）
		const key = this._getHistoryKey(item);
		const history = this.chatHistory.get(key) || [];
		const newHistory = history.filter((_, i) => !toDelete.has(i));
		this.chatHistory.set(key, newHistory);
		this.saveChatHistory();

		chatDiv.innerHTML = "";
		newHistory.forEach((msg, idx) => {
			const showResend = msg.role === "user" && idx === newHistory.length - 1;
			const msgDiv = this.renderMessage(msg, doc, idx, { showResend });
			chatDiv.appendChild(msgDiv);
		});
	},

	// ──────────────────────────────────────────────
	// 清空全部记录
	// ──────────────────────────────────────────────
	handleClearHistory(item, chatDiv) {
		const doc = chatDiv ? chatDiv.ownerDocument : null;
		const win = (doc && doc.defaultView) || Zotero.getMainWindow();
		if (!win.confirm(this.getString("confirm-clear"))) return;

		const key = this._getHistoryKey(item);
		this.chatHistory.set(key, []);
		this.saveChatHistory();
		if (chatDiv) chatDiv.innerHTML = `<div style="text-align: center; color: #aaa; margin-top: 10px; font-size: 11px;">${this.getString("cleared")}</div>`;
		this.showAlert(this.getString("alert-title"), this.getString("alert-cleared"));
	},


	async main() {
		await this.loadChatHistory();
		await this.initializeProvider();
		

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
		// Keep as stub for potential future window-specific initialization
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
	},

	/**
	 * 刷新配置状态展示区 + 对话底部模型下拉
	 */
	async _refreshConfigStatus(doc) {
		if (!doc) return;

		try {
			const config = await this.loadConfig();

			doc.querySelectorAll(".deepread-chat-model-select-cls").forEach(sel => {
				this._fillModelPicker(sel, config.provider, config.model);
			});

			const statusDivs = doc.querySelectorAll(".deepread-config-status-cls");
			if (statusDivs.length === 0) return;

			const keyOk = !!config.apiKey;
			const keyText = keyOk
				? (this._locale === "zh" ? "已配置" : "configured")
				: (this._locale === "zh" ? "未配置（请到系统设置填写）" : "missing (open settings)");
			const html = `
				<div style="font-weight:bold; margin-bottom:4px; color:#333; border-bottom:1px solid #eee; padding-bottom:2px;">
					${this._locale === "zh" ? "📡 当前配置（只读）" : "📡 Current Config (read-only)"}
				</div>
				<div style="margin:2px 0;"><b>Provider:</b> ${this._escapeHTML(config.provider)}</div>
				<div style="margin:2px 0;"><b>Model:</b> ${this._escapeHTML(config.model)}</div>
				<div style="margin:2px 0;"><b>API Key:</b> ${keyOk ? "✓ " : "✗ "}${this._escapeHTML(keyText)}</div>
				<div style="margin:2px 0;"><b>Temp:</b> ${this._escapeHTML(String(config.temperature))}</div>
				<div style="margin:2px 0;"><b>Tokens:</b> ${this._escapeHTML(String(config.maxTokens))}</div>
			`;
			statusDivs.forEach(div => { div.innerHTML = html; });
		} catch (e) {
			doc.querySelectorAll(".deepread-config-status-cls").forEach(div => {
				div.textContent = "Error loading config: " + e.message;
			});
		}
	}
};

