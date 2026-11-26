/**
 * 常驻浮层对话
 * - 用户消息保存发送时的选区元数据
 * - 界面（下拉、填入、运行、发送）跟单篇阅读同一套交互
 * - 数据分开：对话 deepread_sidebar_chat.json，预设 deepread_sidebar_prompts.json
 * - 不读不写 deepread_history.json / deepread_prompts.json
 * - 首次加载时将默认整理提示词合入浮层预设
 */
(function () {
	if (typeof DeepRead === "undefined") return;

	const MAX_MESSAGES = 200;
	const MAX_TOOL_ROUNDS = 4;
	const MAX_TOOL_CHARS = 8000;

	DeepRead.SidebarChat = {
		_messages: [],
		_conversations: [],
		_activeId: "",
		_query: "",
		_loaded: false,
		_busy: false,
		_frame: null,
		_gen: 0,
		_presets: [],

		_t(zh, en) {
			return DeepRead._locale === "zh" ? zh : en;
		},

		_esc(s) {
			return DeepRead._escapeHTML
				? DeepRead._escapeHTML(String(s == null ? "" : s))
				: String(s == null ? "" : s)
					.replace(/&/g, "&amp;")
					.replace(/</g, "&lt;")
					.replace(/>/g, "&gt;")
					.replace(/"/g, "&quot;");
		},

		_filePath() {
			return PathUtils.join(Zotero.DataDirectory.dir, "deepread_sidebar_chat.json");
		},

		_promptsFilePath() {
			return PathUtils.join(Zotero.DataDirectory.dir, "deepread_sidebar_prompts.json");
		},

		async loadPrompts() {
			const fp = this._promptsFilePath();
			const saved = await IOUtils.exists(fp) ? JSON.parse(await IOUtils.readUTF8(fp)) : [];
			if (saved && Array.isArray(saved.presets)) {
				this._presets = saved.presets;
				return this._presets;
			}
			if (!Array.isArray(saved)) throw new Error("Invalid sidebar presets file");
			const list = saved.filter(p => p && (p.name || p.prompt));
			if (!list.some(p => ["条目整理", "Organize"].includes(p.name))) {
				list.unshift({
					name: this._t("条目整理", "Organize"),
					prompt: this._t(
						"请整理当前选中的 Zotero 条目。先核对选中范围；如果无法读取选区，请让我提供条目信息。用官方元数据核对标题，并按附件角色建议文件名。逐项列出原值、建议值、来源和把握度，等我确认后再修改。",
						"Review the selected Zotero items. Verify the selection first, or ask me for the items if it is unavailable. Check titles against official metadata and suggest filenames by attachment role. List each current value, proposed value, source and confidence. Wait for my confirmation before making changes."
					)
				});
			}
			await this.savePrompts(list);
			return this._presets;
		},

		async savePrompts(presets) {
			const fp = this._promptsFilePath();
			await IOUtils.writeUTF8(fp, JSON.stringify({ presets }), { tmpPath: fp + ".tmp" });
			this._presets = presets;
			return true;
		},

		_newId() {
			try {
				if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
			} catch (e) { /* ignore */ }
			return "c-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 10);
		},

		_keepMsg(m) {
			if (!m) return false;
			if (m.role === "tool") return true;
			if (m.role === "assistant" && m.toolCalls && m.toolCalls.length) return true;
			return (m.role === "user" || m.role === "assistant") && !!m.content;
		},

		_blankConv() {
			const now = Date.now();
			return {
				id: this._newId(),
				title: this._t("新对话", "New chat"),
				createdAt: now,
				updatedAt: now,
				messages: []
			};
		},

		_ensureActive() {
			if (!Array.isArray(this._conversations) || !this._conversations.length) {
				const fresh = this._blankConv();
				this._conversations = [fresh];
				this._activeId = fresh.id;
			}
			let conv = this._conversations.find(c => c.id === this._activeId);
			if (!conv) {
				conv = this._conversations[0];
				this._activeId = conv.id;
			}
			if (!Array.isArray(conv.messages)) conv.messages = [];
			this._messages = conv.messages;
			return conv;
		},

		async load() {
			if (this._loaded) return this._messages;
			this._loaded = true;
			this._conversations = [];
			this._activeId = "";
			try {
				const fp = this._filePath();
				if (typeof IOUtils !== "undefined" && await IOUtils.exists(fp)) {
					const text = await IOUtils.readUTF8(fp);
					const data = text ? JSON.parse(text) : null;
					if (data && data.version >= 2 && Array.isArray(data.conversations)) {
						this._conversations = data.conversations.map(c => ({
							id: c && c.id ? String(c.id) : this._newId(),
							title: c && c.title ? String(c.title) : this._t("新对话", "New chat"),
							createdAt: c && c.createdAt ? c.createdAt : Date.now(),
							updatedAt: c && c.updatedAt ? c.updatedAt : Date.now(),
							messages: ((c && c.messages) || []).filter(m => this._keepMsg(m)).slice(-MAX_MESSAGES)
						}));
						this._activeId = data.activeId ? String(data.activeId) : "";
					} else if (data && Array.isArray(data.messages)) {
						const conv = this._blankConv();
						conv.messages = data.messages.filter(m => this._keepMsg(m)).slice(-MAX_MESSAGES);
						const first = conv.messages.find(m => m.role === "user" && m.content);
						if (first) {
							const t = String(first.content).replace(/\s+/g, " ").trim();
							conv.title = t.length > 28 ? t.slice(0, 28) + "…" : t;
						}
						this._conversations = [conv];
						this._activeId = conv.id;
					}
				}
			} catch (e) {
				DeepRead.log("SidebarChat.load: " + (e.message || e));
				this._conversations = [];
			}
			this._ensureActive();
			return this._messages;
		},

		save() {
			if (!this._loaded) return;
			try {
				const conv = this._ensureActive();
				const messages = (this._messages || []).filter(m => this._keepMsg(m)).slice(-MAX_MESSAGES);
				conv.messages = messages;
				this._messages = messages;
				const first = messages.find(m => m.role === "user" && m.content);
				const untitled = !conv.title || conv.title === "新对话" || conv.title === "New chat";
				if (first && untitled) {
					const t = String(first.content).replace(/\s+/g, " ").trim();
					conv.title = t.length > 28 ? t.slice(0, 28) + "…" : t;
				}
				conv.updatedAt = Date.now();
				const json = JSON.stringify({
					version: 2,
					activeId: this._activeId,
					conversations: this._conversations
				});
				IOUtils.writeUTF8(this._filePath(), json).catch(e => {
					DeepRead.log("SidebarChat.save: " + (e.message || e));
				});
				const doc = this._doc();
				if (doc) this._paintChats(doc);
			} catch (e) {
				DeepRead.log("SidebarChat.save: " + (e.message || e));
			}
		},

		/** 发给模型的副本。说明只加在请求里，不写入历史文件。 */
		_forModel(messages, withTools) {
			const note = this._t(
				"这是 DeepRead 的常驻对话，没有绑定单篇文献。"
					+ (withTools
						? "需要查 Zotero 文献库时调用提供的工具，不要编造库里没有的条目。"
						: "当前没有连上 Zotero MCP，不要假装已经搜过文献库。")

					+ (withTools ? "会改文献库的工具不会立刻执行，会先列出变更给用户确认。" : ""),
				"This is DeepRead's floating chat, not tied to one item. "
					+ (withTools
						? "Use the provided Zotero tools to look things up. Do not invent library items. "
						: "Zotero MCP is offline. Do not pretend you searched the library. ")

					+ (withTools ? " Tools that change the library are not run until the user confirms the change list." : "")
			);
			const out = [];
			let noted = false;
			(messages || []).forEach(m => {
				if (!m) return;
				if (m.role === "tool") {
					out.push({
						role: "tool",
						toolCallId: m.toolCallId,
						name: m.name,
						content: String(m.content || "")
					});
					return;
				}
				if (m.role === "assistant") {
					out.push({
						role: "assistant",
						content: m.content || "",
						toolCalls: m.toolCalls || null
					});
					return;
				}
				if (m.role === "user" && m.content) {
					let content = String(m.content);
					if (m.selection !== undefined) {
						const context = m.selection === null ? "unavailable" : JSON.stringify(m.selection);
						content += "\n\n[Zotero selection at send time]\n" + context;
					}
					if (!noted) {
						content = note + "\n\n" + content;
						noted = true;
					}
					out.push({ role: "user", content });
				}
			});
			return out;
		},

		_selection(doc) {
			try {
				const pane = doc.defaultView.frameElement.ownerDocument.defaultView.ZoteroPane;
				return pane.getSelectedItems().map(item => ({
					itemID: item.id,
					key: item.key,
					libraryID: item.libraryID,
					itemType: item.itemType,
					title: item.getDisplayTitle() || "",
					parentItemID: item.parentItemID || undefined,
					attachmentIDs: item.isRegularItem() ? item.getAttachments() : undefined
				}));
			} catch (e) {
				return null;
			}
		},

		_showSelection(el, items) {
			if (!el) return;
			el.hidden = Array.isArray(items) && !items.length;
			if (el.hidden) return;
			const label = items
				? this._t(`已选 ${items.length} 项`, `${items.length} selected`) + " · " + (items[0].title || "#" + items[0].itemID)
				: this._t("无法读取当前选区", "Selection unavailable");
			if (el.textContent !== label) el.textContent = label;
			el.title = (items || []).map(it => `#${it.itemID} · ${it.title}`).join("\n");
		},

		refreshSelection(frame) {
			const doc = frame && frame.contentDocument;
			const el = doc && doc.querySelector("[data-role='selection']");
			if (el) this._showSelection(el, this._selection(doc));
		},

		_doc() {
			const frame = this._frame;
			if (!frame) return null;
			try {
				const doc = frame.contentDocument;
				if (!doc || !doc.getElementById("deepread-sidechat-root")) return null;
				return doc;
			} catch (e) {
				return null;
			}
		},

		mount(frame) {
			if (!frame) return;
			this._frame = frame;
			const gen = ++this._gen;
			this._mountAsync(frame, gen).catch(e => {
				DeepRead.log("SidebarChat.mount: " + (e.message || e) + "\n" + (e.stack || ""));
				DeepRead.showAlert("DeepRead", this._t("对话面板打开失败：", "Chat panel failed: ") + (e.message || e));
			});
		},

		async _mountAsync(frame, gen) {
			await this.load();
			if (gen !== this._gen || frame !== this._frame) return;
			const doc = frame.contentDocument;
			const win = frame.contentWindow;
			if (!doc || !win) throw new Error("chat frame not ready");

			doc.open();
			doc.write(this._html());
			doc.close();
			if (gen !== this._gen) return;

			this._renderMessages();
			this._paintChats(doc);
			this._bind(doc);
			this.refreshSelection(frame);
			await this._fillPresets(doc);
			if (this._busy) this._setBusy(doc, true);
			this._refreshMcpStatus();
		},

		_icon(name) {
			const common = "width=\"16\" height=\"16\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"";
			if (name === "plus") return `<svg ${common}><path d="M12 5v14M5 12h14"/></svg>`;
			if (name === "edit") return `<svg ${common}><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>`;
			if (name === "trash") return `<svg ${common}><path d="M4 7h16"/><path d="M9 7V5h6v2"/><path d="M7 7l1 13h8l1-13"/></svg>`;
			if (name === "gear") return `<svg ${common}><circle cx="12" cy="12" r="3"/><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M18.4 5.6 17 7M7 17l-1.4 1.4"/></svg>`;
			if (name === "fill") return `<svg ${common}><path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M5 21h14"/></svg>`;
			return `<svg ${common}><path d="M22 2 11 13"/><path d="M22 2 15 22l-4-9-9-4Z"/></svg>`;
		},

		_html() {
			const run = this._esc(this._t("运行", "Run"));
			const placeholder = this._esc(this._t(
				"输入你想了解的内容，例如“帮我总结这篇文章”。Enter 发送，Ctrl+Enter 换行。",
				"Ask anything, e.g. Summarize this paper. Enter to send, Ctrl+Enter for a new line."
			));
			return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8"/>
<style>
html, body { margin: 0; height: 100%; background: #fff; color: #18181b; }
body { font: 12px/1.45 "Segoe UI", "PingFang SC", "Microsoft YaHei", system-ui, sans-serif; }
#deepread-sidechat-root { height: 100%; box-sizing: border-box; display: flex; flex-direction: column; }
.tabs { display: flex; gap: 0; flex: 0 0 auto; border-bottom: 1px solid #ececef; padding: 0 2px; }
.tab { border: none; background: none; padding: 8px 12px 7px; margin-bottom: -1px; font: inherit; font-weight: 650; color: #71717a; cursor: pointer; border-bottom: 2px solid transparent; }
.tab.is-on { color: #5744e6; border-bottom-color: #5744e6; }
.pane { flex: 1; min-height: 0; display: flex; flex-direction: column; gap: 8px; padding: 8px 4px 6px; }
.pane.admin { justify-content: flex-start; overflow: auto; }
.pane[hidden] { display: none !important; }
.chatbar { display: flex; gap: 6px; align-items: center; flex: 0 0 auto; }
.chatbar select, .chatbar input, .field, .admin select, .admin input, .admin textarea {
  width: 100%; box-sizing: border-box; border: 1px solid #d4d4d8; border-radius: 6px;
  padding: 6px 8px; font: inherit; background: #fff; color: inherit;
}
.chatbar select { flex: 1; min-width: 0; }
.chatbar input { flex: 0 1 96px; min-width: 64px; }
.chat-tools { display: flex; gap: 2px; flex: 0 0 auto; }
#msgs {
  flex: 1; min-height: 0; overflow: auto; display: flex; flex-direction: column; gap: 8px;
  padding: 6px; background: #fafafa; border: 1px solid #f4f4f5; border-radius: 8px;
}
.composer { display: flex; flex-direction: column; gap: 6px; flex: 0 0 auto; border-top: 1px solid #ececef; padding-top: 8px; }
.presets { display: flex; gap: 6px; align-items: center; }
.presets select { flex: 1; min-width: 0; }
.selection { min-width: 0; font-size: 11px; color: #52525b; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.composer textarea {
  width: 100%; min-height: 64px; max-height: 140px; resize: vertical;
  border: 1px solid #d4d4d8; border-radius: 6px; padding: 8px; font: inherit; box-sizing: border-box; background: #fff;
}
.send-row { display: flex; align-items: center; gap: 8px; }
.model-slot { flex: 1; min-width: 0; }
.model-slot .deepread-picker-btn { border-radius: 6px !important; border-color: #d4d4d8 !important; padding: 6px 22px 6px 8px !important; font-size: 12px !important; }
.meta-row { display: flex; align-items: center; justify-content: space-between; gap: 8px; font-size: 11px; color: #a1a1aa; }
.meta-row button { border: none; background: none; padding: 0; font: inherit; color: #71717a; cursor: pointer; }
.meta-row button:hover { color: #5744e6; }
.btn { border: 1px solid transparent; border-radius: 6px; padding: 6px 12px; font: inherit; font-weight: 600; cursor: pointer; white-space: nowrap; }
.btn-ghost { background: #fff; color: #3f3f46; border-color: #d4d4d8; }
.btn-ghost:hover { background: #f4f4f5; }
.btn-primary { background: #5744e6; color: #fff; border-color: #5744e6; }
.btn:disabled { opacity: .45; cursor: default; }
.btn-danger { background: #fff; color: #b91c1c; border-color: #fecaca; }
.btn-link { border: none; background: none; padding: 4px 0 0; font: inherit; color: #5744e6; cursor: pointer; text-align: left; }
.btn-link:hover { text-decoration: underline; }
.iconbtn { width: 28px; height: 28px; padding: 0; display: inline-flex; align-items: center; justify-content: center; flex: 0 0 auto; border-radius: 6px; }
.iconbtn svg { display: block; }
.admin-head { font-weight: 650; font-size: 13px; color: #27272a; }
.admin-hint { font-size: 11px; color: #a1a1aa; line-height: 1.45; margin-top: -2px; }
.admin select[data-role='preset-list'] {
  flex: 0 0 auto; height: 148px; min-height: 148px; max-height: 148px;
  padding: 4px; overflow-y: auto;
}
.admin textarea { min-height: 110px; resize: vertical; }
.admin-actions { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 6px; }
.bubble { max-width: 92%; padding: 6px 10px 8px; border-radius: 12px; white-space: pre-wrap; word-break: break-word; }
.foldbar { display: flex; align-items: center; gap: 4px; cursor: pointer; font-size: 10px; color: #71717a; user-select: none; }
.bubble .body { margin-top: 4px; }
.bubble.is-folded .body, .bubble.is-folded .who { display: none; }
.plan { align-self: stretch; max-width: 100%; background: #fff; border: 1px solid #ececef; border-radius: 12px; padding: 8px 10px; }
.plan table { width: 100%; border-collapse: collapse; font-size: 11px; margin: 6px 0; }
.plan th, .plan td { text-align: left; padding: 6px 4px; border-bottom: 1px solid #f4f4f5; vertical-align: top; word-break: break-word; }
.plan th { color: #71717a; font-weight: 650; }
.bubble.user { align-self: flex-end; background: #f3f1ff; cursor: context-menu; }
.bubble.assistant { align-self: flex-start; background: #fff; border: 1px solid #ececef; cursor: context-menu; }
.menu { position: fixed; z-index: 5; background: #fff; border: 1px solid #e4e4e7; border-radius: 8px; box-shadow: 0 8px 24px rgba(0,0,0,.12); min-width: 128px; padding: 4px 0; }
.menu button { display: block; width: 100%; text-align: left; border: none; background: transparent; padding: 6px 12px; font: inherit; cursor: pointer; }
.menu button:hover { background: #f4f4f5; }
.bubble.pending { color: #71717a; }
.bubble.tool { align-self: stretch; max-width: 100%; background: #fff; border: 1px dashed #e4e4e7; color: #3f3f46; font-size: 11px; }
.bubble.tool.is-skip .foldbar { color: #a1a1aa; }
.bubble.tool .meta { color: #71717a; margin-bottom: 4px; }
.bubble.tool .toolraw { margin: 0; max-height: 140px; overflow: auto; white-space: pre-wrap; word-break: break-word; font: 11px/1.4 ui-monospace, Consolas, monospace; background: #fafafa; border-radius: 8px; padding: 6px; }
.who { display: block; margin-top: 4px; font-size: 10px; color: #a1a1aa; }
.empty { margin: auto; color: #71717a; text-align: center; padding: 24px 16px; line-height: 1.55; }
</style>
</head>
<body>
<div id="deepread-sidechat-root">
  <div class="tabs">
    <button type="button" class="tab is-on" data-act="tab-chat">${this._esc(this._t("对话", "Chat"))}</button>
    <button type="button" class="tab" data-act="tab-settings">${this._esc(this._t("设置", "Settings"))}</button>
  </div>
  <div class="pane" data-role="chat-view">
    <div class="chatbar">
      <select data-role="chat-list" title="${this._esc(this._t("对话列表", "Chats"))}"></select>
      <input data-role="chat-q" placeholder="${this._esc(this._t("查找", "Find"))}" />
      <div class="chat-tools">
        <button type="button" class="btn btn-ghost iconbtn" data-act="new-chat" title="${this._esc(this._t("新建对话", "New chat"))}">${this._icon("plus")}</button>
        <button type="button" class="btn btn-ghost iconbtn" data-act="rename-chat" title="${this._esc(this._t("改名", "Rename"))}">${this._icon("edit")}</button>
        <button type="button" class="btn btn-ghost iconbtn" data-act="del-chat" title="${this._esc(this._t("删除对话", "Delete chat"))}">${this._icon("trash")}</button>
      </div>
    </div>
    <div id="msgs" data-role="msgs"></div>
    <div class="composer">
      <div class="presets">
        <select class="field" data-role="preset" title="${this._esc(this._t("预设", "Preset"))}"></select>
        <button type="button" class="btn btn-ghost" data-act="fill">${this._esc(this._t("填入", "Fill"))}</button>
        <button type="button" class="btn btn-ghost" data-act="run">${run}</button>
      </div>
      <div class="selection" data-role="selection" hidden></div>
      <textarea data-role="input" placeholder="${placeholder}"></textarea>
      <div class="send-row">
        <div class="model-slot" data-role="model-slot"></div>
        <button type="button" class="btn btn-primary" data-act="send">${this._esc(this._t("发送", "Send"))}</button>
      </div>
      <div class="meta-row">
        <span data-role="model"></span>
        <span>
          <button type="button" data-act="fold-all">${this._esc(this._t("折叠全部", "Fold all"))}</button>
          ·
          <button type="button" data-act="clear">${this._esc(this._t("清空", "Clear"))}</button>
        </span>
      </div>
    </div>
  </div>
  <div class="pane admin" data-role="preset-admin" hidden>
    <div class="admin-head">${this._esc(this._t("提示词预设", "Prompt presets"))}</div>
    <div class="admin-hint">${this._esc(this._t("只服务浮层对话，和单篇阅读互不影响。", "For the floating chat only. Separate from item reading."))}</div>
    <select data-role="preset-list" size="6"></select>
    <input data-role="preset-name" placeholder="${this._esc(this._t("预设名称", "Preset name"))}" />
    <textarea data-role="preset-body" placeholder="${this._esc(this._t("预设内容", "Preset prompt"))}"></textarea>
    <div class="admin-actions">
      <button type="button" class="btn btn-ghost" data-act="preset-add">${this._esc(this._t("新建", "New"))}</button>
      <button type="button" class="btn btn-primary" data-act="preset-save">${this._esc(this._t("保存", "Save"))}</button>
      <button type="button" class="btn btn-danger" data-act="preset-del">${this._esc(this._t("删除", "Delete"))}</button>
    </div>
    <button type="button" class="btn-link" data-act="open-prefs">${this._esc(this._t("打开 API Key 设置…", "Open API Key settings…"))}</button>
  </div>
</div>
</body>
</html>`;
		},

		_bind(doc) {
			const root = doc.getElementById("deepread-sidechat-root");
			if (!root) throw new Error("chat root missing");
			const input = root.querySelector("[data-role='input']");
			const preset = root.querySelector("[data-role='preset']");
			const fillBtn = root.querySelector("[data-act='fill']");
			const runBtn = root.querySelector("[data-act='run']");

			const syncPresetButtons = () => {
				const disabled = this._busy || !this._selectedPreset(doc);
				if (fillBtn) fillBtn.disabled = disabled;
				if (runBtn) runBtn.disabled = disabled;
			};
			if (preset) preset.addEventListener("change", syncPresetButtons);
			root._syncPresetButtons = syncPresetButtons;

			if (fillBtn) fillBtn.addEventListener("click", () => this._fillInput(doc));
			if (runBtn) runBtn.addEventListener("click", () => this._runPreset(doc));
			const sendBtn = root.querySelector("[data-act='send']");
			if (sendBtn) sendBtn.addEventListener("click", () => this._sendFromInput(doc));
			const clearBtn = root.querySelector("[data-act='clear']");
			if (clearBtn) clearBtn.addEventListener("click", () => this._clear(doc));
			if (input) {
				input.addEventListener("keydown", (e) => {
					if (e.key !== "Enter" || e.isComposing || e.keyCode === 229 || e.altKey) return;
					if (e.ctrlKey || e.metaKey) {
						e.preventDefault();
						const start = input.selectionStart == null ? input.value.length : input.selectionStart;
						const end = input.selectionEnd == null ? start : input.selectionEnd;
						const v = input.value || "";
						input.value = v.slice(0, start) + "\n" + v.slice(end);
						input.selectionStart = input.selectionEnd = start + 1;
						return;
					}
					if (e.shiftKey) return;
					e.preventDefault();
					this._sendFromInput(doc);
				});
			}
			this._mountModelPicker(doc);
			const q = root.querySelector("[data-role='chat-q']");
			if (q) q.addEventListener("input", () => {
				this._query = q.value || "";
				this._paintChats(doc);
			});
			const chatList = root.querySelector("[data-role='chat-list']");
			if (chatList) chatList.addEventListener("change", () => {
				if (chatList.value) this._switchChat(chatList.value);
			});
			const on = (act, fn) => {
				const btn = root.querySelector("[data-act='" + act + "']");
				if (btn) btn.addEventListener("click", fn);
			};
			on("new-chat", () => this._newChat());
			on("rename-chat", () => this._renameChat());
			on("del-chat", () => this._deleteChat());
			on("tab-chat", () => this._showTab("chat"));
			on("tab-settings", () => this._showTab("settings"));
			on("fold-all", () => this._foldAll());
			on("open-prefs", () => {
				if (typeof DeepRead.openPreferencePane === "function") DeepRead.openPreferencePane();
			});
			on("preset-add", () => this._addPreset(doc));
			on("preset-save", () => this._updatePreset(doc));
			on("preset-del", () => this._deletePreset(doc));
			const presetList = root.querySelector("[data-role='preset-list']");
			if (presetList) presetList.addEventListener("change", () => this._readPresetIntoForm(doc));
			this._paintModel(doc);
			syncPresetButtons();
		},

		_paintChats(doc) {
			if (!doc) return;
			const sel = doc.querySelector("[data-role='chat-list']");
			if (!sel) return;
			const q = String(this._query || "").trim().toLowerCase();
			const rows = (this._conversations || [])
				.slice()
				.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
				.filter(c => !q || String(c.title || "").toLowerCase().includes(q));
			const prev = sel.value;
			sel.textContent = "";
			rows.forEach(c => {
				const opt = doc.createElement("option");
				opt.value = c.id;
				opt.textContent = c.title || this._t("新对话", "New chat");
				sel.appendChild(opt);
			});
			const want = this._activeId || prev;
			if (want && Array.from(sel.options).some(o => o.value === want)) sel.value = want;
		},

		_switchChat(id) {
			if (this._busy || !id || id === this._activeId) return;
			const conv = (this._conversations || []).find(c => c.id === id);
			if (!conv) return;
			this._activeId = conv.id;
			this._messages = conv.messages || [];
			this.save();
			this._renderMessages();
		},

		_newChat() {
			if (this._busy) return;
			const current = this._ensureActive();
			const hasBody = (current.messages || []).some(m => m && (m.content || (m.toolCalls && m.toolCalls.length)));
			if (!hasBody) return;
			const conv = this._blankConv();
			this._conversations.unshift(conv);
			this._activeId = conv.id;
			this._messages = conv.messages;
			this._showTab("chat");
			this.save();
			this._renderMessages();
		},

		_renameChat() {
			if (this._busy) return;
			const conv = this._ensureActive();
			const win = Zotero.getMainWindow && Zotero.getMainWindow();
			if (!win || !win.prompt) return;
			const name = win.prompt(this._t("对话名称", "Chat name"), conv.title || "");
			if (!name || !name.trim()) return;
			conv.title = name.trim();
			conv.updatedAt = Date.now();
			this.save();
		},

		_deleteChat() {
			if (this._busy) return;
			const win = Zotero.getMainWindow && Zotero.getMainWindow();
			const ok = win && win.confirm
				? win.confirm(this._t("删除这条对话？其他对话和单篇阅读不受影响。", "Delete this chat? Other chats and item reading stay."))
				: false;
			if (!ok) return;
			this._conversations = (this._conversations || []).filter(c => c.id !== this._activeId);
			this._activeId = "";
			this._ensureActive();
			this.save();
			this._renderMessages();
		},

		_showTab(which) {
			const doc = this._doc();
			if (!doc) return;
			const settings = which === "settings";
			const view = doc.querySelector("[data-role='chat-view']");
			const admin = doc.querySelector("[data-role='preset-admin']");
			if (view) {
				if (settings) view.setAttribute("hidden", "");
				else view.removeAttribute("hidden");
			}
			if (admin) {
				if (settings) admin.removeAttribute("hidden");
				else admin.setAttribute("hidden", "");
			}
			doc.querySelectorAll(".tab").forEach(tab => {
				const on = tab.getAttribute("data-act") === (settings ? "tab-settings" : "tab-chat");
				tab.classList.toggle("is-on", on);
			});
			if (settings) this._renderPresetAdmin(doc);
		},

		_renderPresetAdmin(doc) {
			const sel = doc.querySelector("[data-role='preset-list']");
			if (!sel) return;
			const prev = sel.value;
			sel.textContent = "";
			const list = this._presets || [];
			if (!list.length) {
				const opt = doc.createElement("option");
				opt.value = "";
				opt.disabled = true;
				opt.selected = true;
				opt.textContent = this._t("还没有预设，填好名称和内容后点「新建」", "No presets yet. Fill the fields, then New");
				sel.appendChild(opt);
			} else {
				list.forEach((p, i) => {
					const opt = doc.createElement("option");
					opt.value = String(i);
					opt.textContent = p && p.name ? p.name : this._t("未命名预设", "Untitled preset");
					sel.appendChild(opt);
				});
				if (prev && list[parseInt(prev, 10)]) sel.value = prev;
			}
			this._readPresetIntoForm(doc);
		},

		_readPresetIntoForm(doc) {
			const sel = doc.querySelector("[data-role='preset-list']");
			const name = doc.querySelector("[data-role='preset-name']");
			const body = doc.querySelector("[data-role='preset-body']");
			const idx = sel ? parseInt(sel.value, 10) : -1;
			const preset = Number.isFinite(idx) ? this._presets[idx] : null;
			if (name) name.value = preset ? (preset.name || "") : "";
			if (body) body.value = preset ? (preset.prompt || "") : "";
		},

		_blankPresetForm(doc) {
			const sel = doc.querySelector("[data-role='preset-list']");
			const name = doc.querySelector("[data-role='preset-name']");
			const body = doc.querySelector("[data-role='preset-body']");
			if (sel) sel.selectedIndex = -1;
			if (name) {
				name.value = "";
				name.focus();
			}
			if (body) body.value = "";
		},

		async _addPreset(doc) {
			const name = (doc.querySelector("[data-role='preset-name']").value || "").trim();
			const prompt = (doc.querySelector("[data-role='preset-body']").value || "").trim();
			if (!name && !prompt) {
				this._blankPresetForm(doc);
				return;
			}
			if (!name || !prompt) {
				DeepRead.showAlert("DeepRead", this._t("请填写预设名称和内容", "Enter a preset name and prompt"));
				return;
			}
			const list = (this._presets || []).concat([{ name, prompt }]);
			await this.savePrompts(list);
			await this._fillPresets(doc);
			this._renderPresetAdmin(doc);
			const sel = doc.querySelector("[data-role='preset-list']");
			if (sel) sel.value = String(list.length - 1);
			this._readPresetIntoForm(doc);
		},

		async _updatePreset(doc) {
			const sel = doc.querySelector("[data-role='preset-list']");
			const idx = sel ? parseInt(sel.value, 10) : -1;
			const preset = this._presets[idx];
			if (!preset) {
				await this._addPreset(doc);
				return;
			}
			const name = (doc.querySelector("[data-role='preset-name']").value || "").trim();
			const prompt = (doc.querySelector("[data-role='preset-body']").value || "").trim();
			if (!name || !prompt) {
				DeepRead.showAlert("DeepRead", this._t("请填写预设名称和内容", "Enter a preset name and prompt"));
				return;
			}
			const list = this._presets.slice();
			list[idx] = { name, prompt };
			await this.savePrompts(list);
			await this._fillPresets(doc);
			this._renderPresetAdmin(doc);
			if (sel) sel.value = String(idx);
		},

		async _deletePreset(doc) {
			const sel = doc.querySelector("[data-role='preset-list']");
			const idx = sel ? parseInt(sel.value, 10) : -1;
			if (!this._presets[idx]) {
				DeepRead.showAlert("DeepRead", this._t("先选一条要删除的预设", "Select a preset to delete"));
				return;
			}
			const win = Zotero.getMainWindow && Zotero.getMainWindow();
			const ok = win && win.confirm
				? win.confirm(this._t("删除这条预设？", "Delete this preset?"))
				: true;
			if (!ok) return;
			const list = this._presets.filter((_, i) => i !== idx);
			await this.savePrompts(list);
			await this._fillPresets(doc);
			this._renderPresetAdmin(doc);
		},

		_showMsgMenu(doc, x, y, index) {
			const old = doc.getElementById("deepread-side-menu");
			if (old) old.remove();
			const msg = this._messages[index];
			if (!msg) return;
			const menu = doc.createElement("div");
			menu.id = "deepread-side-menu";
			menu.className = "menu";
			menu.style.left = Math.max(4, x) + "px";
			menu.style.top = Math.max(4, y) + "px";
			const add = (label, fn) => {
				const btn = doc.createElement("button");
				btn.type = "button";
				btn.textContent = label;
				btn.addEventListener("click", (e) => {
					e.stopPropagation();
					menu.remove();
					fn();
				});
				menu.appendChild(btn);
			};
			add(this._isFolded(msg) ? this._t("展开", "Expand") : this._t("折叠", "Fold"), () => {
				msg.folded = !this._isFolded(msg);
				this._renderMessages();
			});
			if (msg.content) {
				add(this._t("存为预设", "Save as preset"), () => this._saveMessagePreset(index));
			}
			if (msg.role === "user") {
				add(this._t("重新发送", "Resend"), () => this._resendFrom(index));
			}
			add(this._t("删除消息", "Delete message"), () => this._deleteMessage(index));
			(doc.body || doc.documentElement).appendChild(menu);
			const hide = () => {
				if (menu.parentNode) menu.remove();
				doc.removeEventListener("click", hide);
			};
			doc.defaultView.setTimeout(() => doc.addEventListener("click", hide), 0);
		},

		async _saveMessagePreset(index) {
			const msg = this._messages[index];
			if (!msg || !msg.content) return;
			const win = Zotero.getMainWindow && Zotero.getMainWindow();
			if (!win || !win.prompt) return;
			const name = win.prompt(this._t("预设名称", "Preset name"), this._t("新预设", "New preset"));
			if (!name || !name.trim()) return;
			const list = (this._presets || []).concat([{ name: name.trim(), prompt: String(msg.content).trim() }]);
			await this.savePrompts(list);
			const doc = this._doc();
			if (doc) await this._fillPresets(doc);
			DeepRead.showAlert("DeepRead", this._t("已存为预设「" + name.trim() + "」", "Saved preset \"" + name.trim() + "\""));
		},

		_deleteMessage(index) {
			if (this._busy || !this._messages[index]) return;
			this._messages.splice(index, 1);
			this.save();
			this._renderMessages();
		},

		async _resendFrom(index) {
			if (this._busy) return;
			const msg = this._messages[index];
			if (!msg || msg.role !== "user") return;
			await DeepRead.syncProviderConfig();
			if (!DeepRead.provider || !DeepRead.provider.config || !DeepRead.provider.config.apiKey) {
				DeepRead.showAlert("DeepRead", this._t("请先在设置中配置 API Key", "Set an API key in preferences first"));
				return;
			}
			this._messages.splice(index + 1);
			this.save();
			this._renderMessages();
			await this._completeTurn();
		},

		async _fillPresets(doc) {
			try {
				await this.loadPrompts();
			} catch (e) {
				DeepRead.log("SidebarChat presets: " + (e.message || e));
				this._presets = [];
			}
			if (!this._doc() || this._doc() !== doc) return;
			const sel = doc.querySelector("[data-role='preset']");
			if (!sel) return;
			const prev = sel.value;
			sel.textContent = "";
			this._presets.forEach((p, i) => {
				const opt = doc.createElement("option");
				opt.value = String(i);
				opt.textContent = p && p.name ? p.name : this._t("未命名预设", "Untitled preset");
				sel.appendChild(opt);
			});
			if (prev && Array.from(sel.options).some(o => o.value === prev)) sel.value = prev;
			else sel.selectedIndex = sel.options.length ? 0 : -1;
			const root = doc.getElementById("deepread-sidechat-root");
			if (root && root._syncPresetButtons) root._syncPresetButtons();
		},

		_mountModelPicker(doc) {
			const slot = doc && doc.querySelector("[data-role='model-slot']");
			if (!slot || !DeepRead._createModelPicker || slot.querySelector(".deepread-model-picker")) return;
			slot.appendChild(DeepRead._createModelPicker(doc));
			this._fillModelPicker(doc);
		},

		_fillModelPicker(doc) {
			const picker = doc && doc.querySelector(".deepread-chat-model-select-cls");
			if (!picker || !DeepRead._fillModelPicker) return;
			const cfg = (DeepRead.provider && DeepRead.provider.config) || {};
			DeepRead._fillModelPicker(picker, cfg._providerName || "gemini", cfg.model || "");
		},

		_paintModel(doc) {
			if (!doc) return;
			const el = doc.querySelector("[data-role='model']");
			const mcp = this._mcpLabel || this._t("MCP 未连接", "MCP offline");
			if (el) el.textContent = mcp;
			if (!doc.querySelector(".deepread-model-picker")) this._mountModelPicker(doc);
			else this._fillModelPicker(doc);
		},

		async _refreshMcpStatus() {
			this._mcpLabel = this._t("MCP 未连接", "MCP offline");
			const before = this._doc();
			if (before) this._paintModel(before);
			try {
				if (!DeepRead.Mcp) return;
				const tools = await DeepRead.Mcp.listTools();
				this._mcpLabel = this._t(`MCP · ${tools.length} 个工具`, `MCP · ${tools.length} tools`);
			} catch (e) {
				this._mcpLabel = this._t("MCP 未连接", "MCP offline");
			}
			const after = this._doc();
			if (after) this._paintModel(after);
		},

		_isFolded(msg) {
			if (!msg) return false;
			if (msg.folded === true) return true;
			if (msg.folded === false) return false;
			return msg.role === "tool";
		},

		_foldAll() {
			if (this._busy) return;
			const list = this._messages || [];
			if (!list.length) return;
			const anyOpen = list.some(m => !this._isFolded(m));
			list.forEach(m => { m.folded = anyOpen; });
			this._renderMessages();
		},

		_toolTitle(name) {
			const zh = {
				get_libraries: "文献库列表",
				search_library: "检索文献库",
				search_libraries: "检索全部文献库",
				search_annotations: "检索注释",
				get_item_details: "查看条目",
				get_annotations: "读取注释",
				get_content: "读取正文",
				get_collections: "分类列表",
				search_collections: "检索分类",
				get_collection_details: "分类详情",
				get_collection_items: "分类中的条目",
				get_subcollections: "子分类",
				create_collection: "新建分类",
				update_collection: "修改分类",
				delete_collection: "删除分类",
				add_items_to_collection: "加入分类",
				remove_items_from_collection: "移出分类",
				search_fulltext: "全文检索",
				get_item_abstract: "读取摘要",
				fulltext_database: "全文库",
				export_bibliography: "导出参考文献",
				get_citation: "生成引文",
				list_citation_styles: "引文样式"
			};
			const en = {
				get_libraries: "Libraries",
				search_library: "Search library",
				search_libraries: "Search all libraries",
				search_annotations: "Search annotations",
				get_item_details: "Item details",
				get_annotations: "Annotations",
				get_content: "Read text",
				get_collections: "Collections",
				search_collections: "Search collections",
				get_collection_details: "Collection details",
				get_collection_items: "Items in collection",
				get_subcollections: "Subcollections",
				create_collection: "Create collection",
				update_collection: "Update collection",
				delete_collection: "Delete collection",
				add_items_to_collection: "Add to collection",
				remove_items_from_collection: "Remove from collection",
				search_fulltext: "Full text search",
				get_item_abstract: "Abstract",
				fulltext_database: "Full text database",
				export_bibliography: "Export bibliography",
				get_citation: "Citation",
				list_citation_styles: "Citation styles"
			};
			const table = DeepRead._locale === "zh" ? zh : en;
			return (name && table[name]) || name || this._t("工具", "Tool");
		},

		_toolArgsText(msg) {
			if (msg && msg.arguments && typeof msg.arguments === "object" && Object.keys(msg.arguments).length) {
				return this._describeChange({ name: msg.name, arguments: msg.arguments });
			}
			const list = this._messages || [];
			const idx = list.indexOf(msg);
			for (let i = idx - 1; i >= 0 && i >= idx - 6; i--) {
				const prev = list[i];
				if (!prev) continue;
				if (prev.role === "user") break;
				if (prev.role !== "assistant" || !prev.toolCalls) continue;
				const call = prev.toolCalls.find(c => c && msg.toolCallId && c.id === msg.toolCallId)
					|| prev.toolCalls.find(c => c && c.name === msg.name);
				if (call) return this._describeChange(call);
			}
			return "";
		},

		_toolSummary(content) {
			const text = String(content || "").trim();
			if (!text) return this._t("无结果", "No result");
			if (text.indexOf("用户没有确认") === 0 || text.indexOf("用户取消") === 0) return this._t("未执行", "Not run");
			if (text.indexOf("工具调用失败") === 0 || text.indexOf("Tool call failed") === 0) return this._t("失败", "Failed");
			try {
				const data = JSON.parse(text);
				if (Array.isArray(data)) return this._t(data.length + " 条", data.length + " items");
				if (data && typeof data === "object") {
					const lists = ["items", "results", "collections", "annotations", "libraries"];
					for (let i = 0; i < lists.length; i++) {
						if (Array.isArray(data[lists[i]])) {
							const n = data[lists[i]].length;
							return this._t(n + " 条", n + " items");
						}
					}
					if (typeof data.count === "number") return this._t(data.count + " 条", data.count + " items");
					if (data.title) return String(data.title).slice(0, 60);
					if (data.name) return String(data.name).slice(0, 60);
					if (data.message) return String(data.message).slice(0, 80);
				}
			} catch (e) { /* plain text */ }
			const line = text.split(/\r?\n/).find(s => s.trim()) || text;
			return line.length > 72 ? line.slice(0, 72) + "…" : line;
		},

		_appendToolCase(box, doc, index, msg) {
			const folded = this._isFolded(msg);
			const title = this._toolTitle(msg.name);
			const summary = this._toolSummary(msg.content);
			const args = this._toolArgsText(msg);
			const bubble = doc.createElement("div");
			bubble.className = "bubble tool" + (folded ? " is-folded" : "") + (msg.skipped ? " is-skip" : "");
			bubble.title = this._t("右键：删除这条记录", "Right-click: delete this record");
			bubble.addEventListener("contextmenu", (e) => {
				e.preventDefault();
				if (this._busy) return;
				this._showMsgMenu(doc, e.clientX, e.clientY, index);
			});
			const bar = doc.createElement("div");
			bar.className = "foldbar";
			const chev = doc.createElement("span");
			chev.textContent = folded ? "▸" : "▾";
			const label = doc.createElement("span");
			label.textContent = title + " · " + summary;
			bar.appendChild(chev);
			bar.appendChild(label);
			bar.addEventListener("click", (e) => {
				e.preventDefault();
				e.stopPropagation();
				if (this._busy) return;
				msg.folded = !this._isFolded(msg);
				this._renderMessages();
			});
			const body = doc.createElement("div");
			body.className = "body";
			if (args) {
				const meta = doc.createElement("div");
				meta.className = "meta";
				meta.textContent = this._t("入参 ", "Args ") + args;
				body.appendChild(meta);
			}
			const pre = doc.createElement("pre");
			pre.className = "toolraw";
			const raw = String(msg.content || "");
			pre.textContent = raw.length > 4000 ? raw.slice(0, 4000) + "…" : raw;
			body.appendChild(pre);
			bubble.appendChild(bar);
			bubble.appendChild(body);
			box.appendChild(bubble);
		},

		_appendBubble(box, doc, index, msg, className, text, whoText) {
			const folded = this._isFolded(msg);
			const bubble = doc.createElement("div");
			bubble.className = "bubble " + className + (folded ? " is-folded" : "");
			bubble.title = this._t("右键：存为预设、删除、重发", "Right-click: save preset, delete, resend");
			bubble.addEventListener("contextmenu", (e) => {
				e.preventDefault();
				if (this._busy) return;
				this._showMsgMenu(doc, e.clientX, e.clientY, index);
			});
			const bar = doc.createElement("div");
			bar.className = "foldbar";
			const chev = doc.createElement("span");
			chev.textContent = folded ? "▸" : "▾";
			const label = doc.createElement("span");
			label.textContent = msg.role === "user"
				? this._t("你", "You")
				: (msg.role === "tool" ? (msg.name || "tool") : "DeepRead");
			bar.appendChild(chev);
			bar.appendChild(label);
			if (msg.role === "user" && msg.selection && msg.selection.length) {
				const selection = doc.createElement("span");
				selection.className = "selection";
				this._showSelection(selection, msg.selection);
				bar.appendChild(selection);
			}
			bar.addEventListener("click", (e) => {
				e.preventDefault();
				e.stopPropagation();
				if (this._busy) return;
				msg.folded = !this._isFolded(msg);
				this._renderMessages();
			});
			const body = doc.createElement("div");
			body.className = "body";
			body.textContent = text;
			bubble.appendChild(bar);
			bubble.appendChild(body);
			if (whoText) {
				const who = doc.createElement("span");
				who.className = "who";
				who.textContent = whoText;
				bubble.appendChild(who);
			}
			box.appendChild(bubble);
		},

		_renderMessages() {
			const doc = this._doc();
			if (!doc) return;
			const box = doc.querySelector("[data-role='msgs']");
			if (!box) return;
			box.textContent = "";
			const list = this._messages || [];
			if (!list.length && !this._busy) {
				const empty = doc.createElement("div");
				empty.className = "empty";
				empty.textContent = this._t(
					"直接输入即可对话。预设存在浮层自己的文件里。连上 Zotero MCP 后，可以让模型查库。会改库的操作会先列出变更，确认后才执行。",
					"Type to chat. Presets live in the floating panel's own file. After Zotero MCP is connected, the model can query the library. Changes are listed and run only after you confirm."
				);
				box.appendChild(empty);
			}
			list.forEach((msg, index) => {
				const calls = msg.toolCalls && msg.toolCalls.length
					? msg.toolCalls.map(c => this._toolTitle(c.name)).filter(Boolean).join("、")
					: "";
				if (msg.role === "tool") {
					this._appendToolCase(box, doc, index, msg);
					return;
				}
				if (msg.role === "assistant" && !msg.content && calls) return;
				if (!msg.content && msg.role !== "user") return;
				let whoText = "";
				if (calls) whoText = this._t("接着调用 ", "Then ") + calls;
				else if (msg.role === "assistant" && msg.model) whoText = msg.model;
				this._appendBubble(
					box, doc, index, msg,
					msg.role === "user" ? "user" : "assistant",
					msg.content || "",
					whoText
				);
			});
			if (this._busy) {
				const pending = doc.createElement("div");
				pending.className = "bubble assistant pending";
				pending.textContent = this._statusLine || "…";
				box.appendChild(pending);
			}
			box.scrollTop = box.scrollHeight;
		},

		_setBusy(doc, busy) {
			const root = doc && doc.getElementById("deepread-sidechat-root");
			if (!root) return;
			["[data-act='send']", "[data-act='run']", "[data-act='clear']", "[data-act='fold-all']"].forEach(sel => {
				const btn = root.querySelector(sel);
				if (btn) btn.disabled = !!busy;
			});
			if (root._syncPresetButtons) root._syncPresetButtons();
		},

		_selectedPreset(doc) {
			const sel = doc.querySelector("[data-role='preset']");
			if (!sel) return null;
			const preset = this._presets[parseInt(sel.value, 10)];
			return preset || null;
		},

		_fillInput(doc) {
			const picked = this._selectedPreset(doc);
			if (!picked) return;
			const input = doc.querySelector("[data-role='input']");
			if (!input) return;
			const chunk = picked.prompt || "";
			const cur = input.value || "";
			input.value = cur.trim() ? cur.replace(/\s*$/, "") + "\n" + chunk : chunk;
			input.focus();
		},

		_runPreset(doc) {
			const picked = this._selectedPreset(doc);
			if (!picked) return;
			const text = (picked.prompt || "").trim();
			if (!text) return;
			const input = doc.querySelector("[data-role='input']");
			if (input) input.value = "";
			this._send(text, doc);
		},

		_sendFromInput(doc) {
			const input = doc.querySelector("[data-role='input']");
			if (!input) return;
			const text = input.value.trim();
			if (!text || this._busy) return;
			input.value = "";
			this._send(text, doc);
		},

		async _send(text, doc) {
			if (this._busy) return;
			const message = String(text || "").trim();
			if (!message) return;
			const selection = this._selection(doc);
			await DeepRead.syncProviderConfig();
			if (!DeepRead.provider || !DeepRead.provider.config || !DeepRead.provider.config.apiKey) {
				DeepRead.showAlert("DeepRead", this._t("请先在设置中配置 API Key", "Set an API key in preferences first"));
				const input = doc && doc.querySelector && doc.querySelector("[data-role='input']");
				if (input && !input.value) input.value = message;
				return;
			}
			this._messages.push({ role: "user", content: message, selection, ts: Date.now() });
			this.save();
			await this._completeTurn();
		},

		async _completeTurn() {
			if (this._busy) return;
			this._busy = true;
			this._renderMessages();
			const live = this._doc();
			if (live) this._setBusy(live, true);
			try {
				await this._runTurn();
			} catch (e) {
				DeepRead.log("SidebarChat.send: " + (e.message || e));
				DeepRead.showAlert("DeepRead", this._t("发送失败：", "Send failed: ") + (e.message || e));
			} finally {
				this._busy = false;
				this._renderMessages();
				const after = this._doc();
				if (after) {
					this._setBusy(after, false);
					this._paintModel(after);
				}
			}
		},

		async _loadTools() {
			if (!DeepRead.Mcp || typeof DeepRead.Mcp.listTools !== "function") return [];
			try {
				const tools = await DeepRead.Mcp.listTools();
				this._mcpLabel = this._t(`MCP · ${tools.length} 个工具`, `MCP · ${tools.length} tools`);
				return tools || [];
			} catch (e) {
				this._mcpLabel = this._t("MCP 未连接", "MCP offline");
				DeepRead.log("SidebarChat mcp: " + (e.message || e));
				return [];
			}
		},

		_needsConfirm(call, tools) {
			const spec = (tools || []).find(t => t.name === call.name || t.mcpName === call.name);
			const ann = (spec && spec.annotations) || {};
			if (ann.destructiveHint === true || ann.readOnlyHint === false) return true;
			if (ann.readOnlyHint === true) return false;
			const n = String(call.name || "").toLowerCase();
			if (/search|get_|list_|find_|read_|fetch|query|browse|lookup|semantic/.test(n)) return false;
			return true;
		},

		_describeChange(call) {
			const args = (call && call.arguments) || {};
			const keys = ["title", "name", "query", "itemID", "itemKey", "key", "collectionID", "collectionName", "tag", "tags", "note", "content", "parentCollection", "libraryID"];
			const bits = [];
			keys.forEach(k => {
				if (args[k] == null || args[k] === "") return;
				let v = args[k];
				if (typeof v === "object") {
					try { v = JSON.stringify(v); } catch (e) { v = ""; }
				}
				v = String(v);
				if (v.length > 80) v = v.slice(0, 80) + "…";
				if (v) bits.push(k + "：" + v);
			});
			if (bits.length) return bits.join(" · ");
			try {
				const s = JSON.stringify(args);
				if (!s || s === "{}") return this._t("（无参数）", "(no arguments)");
				return s.length > 180 ? s.slice(0, 180) + "…" : s;
			} catch (e) {
				return "";
			}
		},

		_confirmPlan(calls) {
			const doc = this._doc();
			const box = doc && doc.querySelector("[data-role='msgs']");
			if (!box || !calls || !calls.length) return Promise.resolve(null);
			return new Promise(resolve => {
				const card = doc.createElement("div");
				card.className = "plan";
				const title = doc.createElement("div");
				title.textContent = this._t(
					"这些操作会修改文献库。核对下面的变更，确认后才执行。",
					"These actions change the library. Review the list, then confirm."
				);
				const table = doc.createElement("table");
				const thead = doc.createElement("thead");
				const hr = doc.createElement("tr");
				[this._t("执行", "Run"), this._t("操作", "Action"), this._t("将要修改", "Change")].forEach(text => {
					const th = doc.createElement("th");
					th.textContent = text;
					hr.appendChild(th);
				});
				thead.appendChild(hr);
				const tbody = doc.createElement("tbody");
				const boxes = [];
				calls.forEach(call => {
					const tr = doc.createElement("tr");
					const runCell = doc.createElement("td");
					const boxIn = doc.createElement("input");
					boxIn.type = "checkbox";
					boxIn.checked = true;
					boxes.push(boxIn);
					runCell.appendChild(boxIn);
					const nameCell = doc.createElement("td");
					nameCell.textContent = call.name || "";
					const changeCell = doc.createElement("td");
					changeCell.textContent = this._describeChange(call);
					tr.appendChild(runCell);
					tr.appendChild(nameCell);
					tr.appendChild(changeCell);
					tbody.appendChild(tr);
				});
				table.appendChild(thead);
				table.appendChild(tbody);
				const row = doc.createElement("div");
				row.className = "row";
				const no = doc.createElement("button");
				no.type = "button";
				no.className = "btn btn-ghost";
				no.textContent = this._t("取消", "Cancel");
				const yes = doc.createElement("button");
				yes.type = "button";
				yes.className = "btn btn-primary";
				yes.textContent = this._t("确认执行", "Apply");
				const done = (picked) => {
					if (card.parentNode) card.parentNode.removeChild(card);
					resolve(picked);
				};
				no.addEventListener("click", () => done(null));
				yes.addEventListener("click", () => done(boxes.map(el => !!el.checked)));
				row.appendChild(no);
				row.appendChild(yes);
				card.appendChild(title);
				card.appendChild(table);
				card.appendChild(row);
				box.appendChild(card);
				box.scrollTop = box.scrollHeight;
			});
		},

		async _runTurn() {
			const activeModel = DeepRead.provider.config.model;
			const tools = await this._loadTools();
			const live = this._doc();
			if (live) this._paintModel(live);
			let transcript = this._forModel(this._messages, tools.length > 0);
			let finalContent = "";
			for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
				this._statusLine = round === 0 ? "…" : this._t("整理工具结果…", "Reading tool results…");
				this._renderMessages();
				const result = await DeepRead.provider.chat(transcript, {
					model: activeModel,
					tools: tools.length ? tools : undefined
				}, null);
				const calls = (result && result.toolCalls) || [];
				finalContent = result && result.content ? String(result.content) : "";
				if (!calls.length) break;
				const assistantMsg = {
					role: "assistant",
					content: finalContent,
					toolCalls: calls,
					model: activeModel || "",
					ts: Date.now()
				};
				this._messages.push(assistantMsg);
				transcript.push({
					role: "assistant",
					content: finalContent,
					toolCalls: calls
				});
				this.save();
				const reads = [];
				const writes = [];
				calls.forEach(call => {
					if (this._needsConfirm(call, tools)) writes.push(call);
					else reads.push(call);
				});
				const runOne = async (call, allow) => {
					this._statusLine = allow
						? this._t("调用 ", "Call ") + call.name
						: this._t("已跳过 ", "Skipped ") + call.name;
					this._renderMessages();
					let output = "";
					if (!allow) {
						output = this._t("用户没有确认这次修改。", "The user did not confirm this change.");
					} else {
						try {
							output = await DeepRead.Mcp.callTool(call.name, call.arguments || {});
						} catch (e) {
							output = this._t("工具调用失败：", "Tool call failed: ") + (e.message || e);
						}
					}
					if (output.length > MAX_TOOL_CHARS) output = output.slice(0, MAX_TOOL_CHARS) + "\n…";
					const toolMsg = {
						role: "tool",
						toolCallId: call.id,
						name: call.name,
						arguments: call.arguments || {},
						content: output,
						folded: true,
						skipped: !allow,
						ts: Date.now()
					};
					this._messages.push(toolMsg);
					transcript.push({
						role: "tool",
						toolCallId: call.id,
						name: call.name,
						content: output
					});
					this.save();
					this._renderMessages();
				};
				for (const call of reads) await runOne(call, true);
				if (writes.length) {
					this._statusLine = this._t("等待确认修改…", "Waiting to confirm changes…");
					this._renderMessages();
					const picked = await this._confirmPlan(writes);
					for (let i = 0; i < writes.length; i++) {
						await runOne(writes[i], !!(picked && picked[i]));
					}
				}
				finalContent = "";
			}
			if (!finalContent) {
				this._statusLine = this._t("整理工具结果…", "Reading tool results…");
				this._renderMessages();
				const wrapped = await DeepRead.provider.chat(transcript, { model: activeModel }, null);
				finalContent = wrapped && wrapped.content ? String(wrapped.content) : "";
			}
			if (!finalContent) {
				throw new Error(this._t("模型没有返回内容", "The model returned no content"));
			}
			this._messages.push({ role: "assistant", content: finalContent, model: activeModel || "", ts: Date.now() });
			this.save();
		},

		_clear(doc) {
			if (this._busy) return;
			const win = Zotero.getMainWindow && Zotero.getMainWindow();
			const ok = win && win.confirm
				? win.confirm(this._t("清空这条常驻对话？单篇阅读的记录不会动。", "Clear this floating chat? Item chats stay as they are."))
				: false;
			if (!ok) return;
			const conv = this._ensureActive();
			conv.title = this._t("新对话", "New chat");
			this._messages.splice(0, this._messages.length);
			this.save();
			this._renderMessages();
		}
	};
})();
