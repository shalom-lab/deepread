/**
 * 常驻浮层对话
 * - 用户消息保存发送时的选区元数据
 * - 界面（下拉、填入、运行、发送）跟单篇阅读同一套交互
 * - 对话和预设使用 deepread.sqlite 中的浮窗专用表
 * - 首次加载时将默认整理提示词合入浮层预设
 */
(function () {
	if (typeof DeepRead === "undefined") return;

	const ORGANIZE_ID = "builtin-organize";
	const MAX_MESSAGES = 200;
	const MAX_TOOL_ROUNDS = 4;
	const MAX_TOOL_CHARS = 8000;
	// Earlier Zotero MCP versions omit annotations on these lookups.
	const ZOTERO_LOOKUPS = new Set([
		"get_libraries", "search_library", "search_libraries", "search_annotations", "get_item_details",
		"get_annotations", "get_content", "get_collections", "search_collections", "get_collection_details",
		"get_collection_items", "get_subcollections", "search_fulltext", "get_item_abstract",
		"get_citation", "list_citation_styles"
	]);

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

		_normalizePresets(saved) {
			const records = Array.isArray(saved) ? saved : saved.presets;
			if (!Array.isArray(records)) throw new Error("Invalid sidebar presets file");
			const builtin = {
				id: ORGANIZE_ID,
				name: this._t("条目整理", "Organize"),
				prompt: this._t(
						"请整理当前选中的 Zotero 条目。先核对选中范围；如果无法读取选区，请让我提供条目信息。用官方元数据核对标题，并按附件角色建议文件名。逐项列出原值、建议值、来源和把握度，等我确认后再修改。",
						"Review the selected Zotero items. Verify the selection first, or ask me for the items if it is unavailable. Check titles against official metadata and suggest filenames by attachment role. List each current value, proposed value, source and confidence. Wait for my confirmation before making changes."
					)
			};
			if (records.some(p => !p || typeof p !== "object")) throw new Error("Invalid sidebar preset");
			const list = records.slice();
			if (!list.some(p => p.id === ORGANIZE_ID)) {
				const legacy = list.find(p => !p.id && (
					["条目整理", "Organize"].includes(p.name) || p.prompt === builtin.prompt ||
					p.prompt?.startsWith("请整理当前选中的 Zotero 条目。先核对选中范围") ||
					p.prompt?.startsWith("Review the selected Zotero items. Verify the selection first")
				));
				if (legacy) legacy.id = ORGANIZE_ID;
				else list.unshift(builtin);
			}
			for (const p of list) if (!p.id) p.id = this._newId();
			const defaultId = list.some(p => p.id === saved.defaultId) ? saved.defaultId : ORGANIZE_ID;
			return { presets: list, defaultId };
		},

		async loadPrompts() {
			const { presets, defaultId } = await DeepRead.Store.readPresets(true);
			this._presets = presets;
			this._defaultPresetId = defaultId;
			return presets;
		},

		async savePrompts(presets, defaultId = this._defaultPresetId) {
			if (!presets.some(p => p.id === defaultId)) defaultId = ORGANIZE_ID;
			await DeepRead.Store.savePresets(presets, true, defaultId);
			this._presets = presets;
			this._defaultPresetId = defaultId;
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
			const data = DeepRead.Store.sidebarChats();
			this._conversations = data.conversations;
			this._activeId = data.activeId || "";
			this._ensureActive();
			this._loaded = true;
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
				const saving = DeepRead.Store.saveChats(this._conversations, this._activeId);
				const doc = this._doc();
				if (doc) this._paintChats(doc);
				return saving.catch(e => DeepRead.storageError(e));
			} catch (e) {
				DeepRead.storageError(e);
			}
		},

		/** 发给模型的副本。说明只加在请求里，不写入历史文件。 */
		_forModel(messages, tools) {
			const withTools = tools.length > 0;
			const note = this._t(
				"这是 DeepRead 的常驻对话，没有绑定单篇文献。"
					+ (withTools
						? "需要整理选中文献或给附件改名时，调用 deepread_plan_organize 生成可勾选的变更清单。按用户要求选择 titles、attachments 或 all。查库时使用本轮提供的工具。"
						: "当前没有连上 Zotero MCP，不要假装已经搜过文献库。")

					+ (withTools ? "会改文献库的工具不会立刻执行，会先列出变更给用户确认。" : ""),
				"This is DeepRead's floating chat, not tied to one item. "
					+ (withTools
						? "To organize selected papers or rename attachments, call deepread_plan_organize to show the change list. Choose titles, attachments or all according to the request. Use the provided tools for library queries. "
						: "Zotero MCP is offline. Do not pretend you searched the library. ")

					+ (withTools ? " Tools that change the library are not run until the user confirms the change list." : "")
			);
			const out = [];
			const lastUser = messages.slice().reverse().find(m => m.role === "user");
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
					if (m.collections || m.collection) {
						content += "\n[Zotero collection at send time]\n" + JSON.stringify(m.collections ?? m.collection);
					}
					if (m === lastUser) {
						const local = tools.filter(tool => !tool.server).map(tool => tool.name).join(", ");
						const status = this._t("当前内置工具", "Current built-in tools") + " · " + local + "\n" + this._mcpLabel;
						content = note + "\n" + status + "\n" + this._t(
							"用户问你能做什么时，按本轮提供的工具回答。浮窗中输入 /tools 可以查看实时清单。",
							"Answer capability questions using the tools offered this turn. /tools shows the live inventory."
						) + "\n\n" + content;
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

		_selectedCollections(doc) {
			const pane = doc?.defaultView?.frameElement?.ownerDocument?.defaultView?.ZoteroPane;
			const rows = pane?.getSelectedCollections?.() ?? pane?.collectionsView?.getSelectedCollections?.()
				?? [pane?.getSelectedCollection?.()].filter(Boolean);
			return rows.map(c => ({ collectionID: c.id, key: c.key, libraryID: c.libraryID, name: c.name }));
		},

		_showSelection(el, records, collections = false) {
			if (!el) return;
			const n = records?.length;
			el.hidden = n === 0;
			if (el.hidden) return;
			if (!records) {
				el.textContent = this._t("无法读取当前选区", "Selection unavailable");
				el.title = "";
				return;
			}
			const count = collections
				? this._t(`已选分类 ${n} 个`, `Collections (${n})`)
				: this._t(`已选条目 ${n} 项`, `Items (${n})`);
			const names = records.map(r => (collections ? r.name : r.title) || "#" + (collections ? r.collectionID : r.itemID));
			el.textContent = count + " · " + names.join("、");
			el.title = [count, ...records.map((r, i) => `#${collections ? r.collectionID : r.itemID} · ${names[i]}`)].join("\n");
		},

		refreshSelection(frame, collectionOnly = false) {
			const doc = frame && frame.contentDocument;
			const el = doc && doc.querySelector("[data-role='selection']");
			if (!el) return;
			const collections = this._selectedCollections(doc);
			const badge = doc.querySelector("[data-role='collection']");
			const identity = JSON.stringify(collections);
			if (collectionOnly && badge.dataset.id === identity) return;
			badge.dataset.id = identity;
			this._showSelection(badge, collections, true);
			this._showSelection(el, this._selection(doc));
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
			this._cancelReview?.();
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
  padding: 8px 10px; background: #fff; border: 1px solid rgba(0,0,0,.08); border-radius: 6px;
}
.composer { display: flex; flex-direction: column; gap: 6px; flex: 0 0 auto; border-top: 1px solid #ececef; padding-top: 8px; }
.presets { display: flex; gap: 6px; align-items: center; }
.presets select { flex: 1; min-width: 0; }
.selection { min-width: 0; font-size: 11px; color: #52525b; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.pane > .selection { flex: 0 0 auto; padding: 0 4px; }
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
.admin-actions { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 6px; }
.bubble { box-sizing: border-box; min-width: 0; max-width: 92%; padding: 6px 10px 8px; border-radius: 12px; white-space: pre-wrap; word-break: break-word; }
.foldbar { display: flex; align-items: center; gap: 4px; cursor: pointer; font-size: 10px; color: #71717a; user-select: none; }
.bubble-actions { display: flex; margin-left: auto; flex-shrink: 0; }
.bubble .body { margin-top: 4px; }
.bubble.is-folded .body, .bubble.is-folded .who { display: none; }
.plan { align-self: stretch; max-width: 100%; background: #fff; border: 1px solid #ececef; border-radius: 12px; padding: 8px 10px; }
.plan table { width: 100%; border-collapse: collapse; font-size: 11px; margin: 6px 0; }
.plan th, .plan td { text-align: left; padding: 6px 4px; border-bottom: 1px solid #f4f4f5; vertical-align: top; word-break: break-word; }
.plan th { color: #71717a; font-weight: 650; }
.deepread-msg-header .message-role { font-weight: bold; font-size: 11px; color: #666; flex-shrink: 0; }
.deepread-msg-wrapper.is-folded .body, .deepread-msg-wrapper.is-folded .who { display: none; }
.menu { position: fixed; z-index: 5; background: #fff; border: 1px solid #e4e4e7; border-radius: 10px; box-shadow: 0 4px 18px rgba(24,24,27,.12); min-width: 142px; padding: 4px; box-sizing: border-box; max-height: calc(100vh - 8px); overflow-y: auto; }
.menu button { display: flex; align-items: center; gap: 9px; width: 100%; text-align: left; border: 0; border-radius: 5px; background: transparent; padding: 6px 8px; font: inherit; color: #3f3f46; cursor: pointer; }
.menu button:hover, .menu button:focus-visible { background: #f3f1ff; color: #4433ad; }
.menu button.danger { margin-top: 3px; border-top: 1px solid #eee; color: #b42318; }
.menu button.danger:hover, .menu button.danger:focus-visible { background: #fff1ef; }
.menu-icon { width: 16px; text-align: center; font-size: 15px; line-height: 1; }
.bubble.pending { color: #71717a; }
.tool-group { min-width: 0; color: #52525b; font-size: 11px; }
.tool-group > summary { display: flex; align-items: center; gap: 6px; min-height: 24px; padding: 0 4px; cursor: pointer; }
.tool-group > summary::before { content: "▸"; color: #71717a; }
.tool-group[open] > summary::before { content: "▾"; }
.tool-group .count { flex-shrink: 0; font-weight: 600; }
.tool-group .names, .tool .result { min-width: 0; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; color: #71717a; }
.bubble.tool { margin-left: 8px; padding: 1px 8px; max-width: 100%; border-left: 2px solid #e4e4e7; border-radius: 0; }
.tool .foldbar { width: 100%; min-height: 22px; padding: 0; border: 0; background: transparent; font: inherit; text-align: left; }
.tool .tool-name { flex-shrink: 0; max-width: 60%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.tool .body { margin-bottom: 5px; }
.bubble.tool.is-skip .foldbar { color: #a1a1aa; }
.bubble.tool .meta { color: #71717a; margin-bottom: 4px; }
.bubble.tool .toolraw { margin: 0; max-height: 140px; overflow: auto; white-space: pre-wrap; word-break: break-word; font: 11px/1.4 ui-monospace, Consolas, monospace; background: #fafafa; border-radius: 8px; padding: 6px; }
.who { display: block; margin: 0 10px 6px; font-size: 10px; color: #a1a1aa; }
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
    <div class="selection" data-role="collection" hidden></div>
    <div class="selection" data-role="selection" hidden></div>
    <div id="msgs" data-role="msgs"></div>
    <div class="composer">
      <div class="presets">
        <select class="field" data-role="preset" title="${this._esc(this._t("预设", "Preset"))}"></select>
        <button type="button" class="btn btn-ghost" data-act="fill">${this._esc(this._t("填入", "Fill"))}</button>
        <button type="button" class="btn btn-ghost" data-act="run">${run}</button>
      </div>
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
      <button type="button" class="btn btn-ghost" data-act="preset-default">${this._esc(this._t("设为默认", "Set as default"))}</button>
      <button type="button" class="btn btn-danger" data-act="preset-del">${this._esc(this._t("删除", "Delete"))}</button>
    </div>
    <button type="button" class="btn-link" data-act="open-prefs">${this._esc(this._t("打开 API Key 设置…", "Open API Key settings…"))}</button>
    <button type="button" class="btn-link" data-act="mcp-release">${this._esc(this._t("推荐安装 Zotero MCP 插件（用于检索文献库）↗", "Recommended: Zotero MCP plugin for library search ↗"))}</button>
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
			on("mcp-release", () => Zotero.launchURL("https://github.com/cookjohn/zotero-mcp/releases/latest"));
			on("open-prefs", () => {
				if (typeof DeepRead.openPreferencePane === "function") DeepRead.openPreferencePane();
			});
			on("preset-add", () => this._addPreset(doc));
			on("preset-save", () => this._updatePreset(doc));
			on("preset-default", () => this._setDefaultPreset(doc));
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
			const picker = this._doc()?.querySelector("[data-role='preset']");
			if (picker) {
				picker.selectedIndex = this._presets.findIndex(p => p.id === this._defaultPresetId);
				this._doc().getElementById("deepread-sidechat-root")?._syncPresetButtons?.();
			}
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
					if (p.id === ORGANIZE_ID) opt.textContent += this._t("（内置）", " (built-in)");
					if (p.id === this._defaultPresetId) opt.textContent += this._t("（默认）", " (default)");
					sel.appendChild(opt);
				});
				if (prev && list[parseInt(prev, 10)]) sel.value = prev;
			}
			this._readPresetIntoForm(doc);
		},

		async _setDefaultPreset(doc) {
			const sel = doc.querySelector("[data-role='preset-list']");
			const preset = this._presets[sel.value];
			if (!preset || preset.id === this._defaultPresetId) return;
			await this.savePrompts(this._presets, preset.id);
			await this._fillPresets(doc, preset.id);
			this._renderPresetAdmin(doc);
		},

		_readPresetIntoForm(doc) {
			const sel = doc.querySelector("[data-role='preset-list']");
			const name = doc.querySelector("[data-role='preset-name']");
			const body = doc.querySelector("[data-role='preset-body']");
			const idx = sel ? parseInt(sel.value, 10) : -1;
			const preset = Number.isFinite(idx) ? this._presets[idx] : null;
			if (name) name.value = preset ? (preset.name || "") : "";
			if (body) body.value = preset ? (preset.prompt || "") : "";
			const del = doc.querySelector("[data-act='preset-del']");
			del.disabled = !preset || preset.id === ORGANIZE_ID;
			del.title = preset?.id === ORGANIZE_ID ? this._t("内置预设不可删除", "Built-in preset cannot be deleted") : "";
			doc.querySelector("[data-act='preset-default']").disabled = !preset || preset.id === this._defaultPresetId;
		},

		_blankPresetForm(doc) {
			const sel = doc.querySelector("[data-role='preset-list']");
			const name = doc.querySelector("[data-role='preset-name']");
			const body = doc.querySelector("[data-role='preset-body']");
			if (sel) sel.selectedIndex = -1;
			this._readPresetIntoForm(doc);
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
			const list = (this._presets || []).concat([{ id: this._newId(), name, prompt }]);
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
			list[idx] = { ...preset, name, prompt };
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
			if (this._presets[idx].id === ORGANIZE_ID) return;
			const win = Zotero.getMainWindow && Zotero.getMainWindow();
			const ok = win?.confirm?.(this._t("删除这条预设？", "Delete this preset?"));
			if (!ok) return;
			const list = this._presets.filter((_, i) => i !== idx);
			await this.savePrompts(list);
			await this._fillPresets(doc);
			this._renderPresetAdmin(doc);
		},

		_canResend(msg) {
			if (this._busy || !msg || msg.role !== "user") return false;
			for (let i = this._messages.length - 1; i >= 0; i--) {
				if (this._messages[i].role === "user") return this._messages[i] === msg;
			}
			return false;
		},

		_showMsgMenu(doc, x, y, index) {
			if (this._closeMsgMenu) this._closeMsgMenu();
			const msg = this._messages[index];
			if (!msg || this._busy) return;
			const menu = doc.createElement("div");
			menu.className = "menu";
			const close = () => {
				menu.remove();
				doc.removeEventListener("pointerdown", outside, true);
				doc.removeEventListener("keydown", keydown);
				this._closeMsgMenu = null;
			};
			const outside = e => { if (!menu.contains(e.target)) close(); };
			const keydown = e => { if (e.key === "Escape") close(); };
			this._closeMsgMenu = close;
			const add = (icon, label, fn, danger = false) => {
				const btn = doc.createElement("button");
				btn.type = "button";
				if (danger) btn.className = "danger";
				const mark = doc.createElement("span");
				mark.className = "menu-icon";
				mark.setAttribute("aria-hidden", "true");
				mark.textContent = icon;
				btn.append(mark, label);
				btn.addEventListener("click", e => {
					e.stopPropagation();
					close();
					const current = this._messages.indexOf(msg);
					if (!this._busy && current >= 0) fn(current);
				});
				menu.appendChild(btn);
			};
			add(this._isFolded(msg) ? "▸" : "▾", this._isFolded(msg) ? this._t("展开", "Expand") : this._t("折叠", "Fold"), () => {
				msg.folded = !this._isFolded(msg);
				this._renderMessages();
			});
			if (msg.content) add("☆", this._t("存为预设", "Save as preset"), i => this._saveMessagePreset(i));
			if (this._canResend(msg)) add("↻", this._t("重新发送", "Resend"), i => this._resendFrom(i));
			add("×", this._t("删除消息", "Delete message"), i => this._deleteMessage(i), true);
			(doc.body || doc.documentElement).appendChild(menu);
			menu.style.left = Math.max(4, Math.min(x, doc.documentElement.clientWidth - menu.offsetWidth - 4)) + "px";
			menu.style.top = Math.max(4, Math.min(y, doc.documentElement.clientHeight - menu.offsetHeight - 4)) + "px";
			doc.addEventListener("pointerdown", outside, true);
			doc.addEventListener("keydown", keydown);
			menu.firstElementChild.focus();
		},

		async _saveMessagePreset(index) {
			const msg = this._messages[index];
			if (!msg || !msg.content) return;
			const win = Zotero.getMainWindow && Zotero.getMainWindow();
			if (!win || !win.prompt) return;
			const name = win.prompt(this._t("预设名称", "Preset name"), this._t("新预设", "New preset"));
			if (!name || !name.trim()) return;
			const list = (this._presets || []).concat([{ id: this._newId(), name: name.trim(), prompt: String(msg.content).trim() }]);
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
			if (!this._canResend(msg)) return;
			const inventory = this._isToolQuestion(msg.content);
			if (!inventory) await DeepRead.syncProviderConfig();
			if (!this._canResend(msg)) return;
			if (!inventory && !DeepRead.provider?.config?.apiKey) {
				DeepRead.showAlert("DeepRead", this._t("请先在设置中配置 API Key", "Set an API key in preferences first"));
				return;
			}
			this._messages.splice(this._messages.indexOf(msg) + 1);
			this.save();
			this._renderMessages();
			await this._completeTurn();
		},

		async _fillPresets(doc, preferredId) {
			try {
				await this.loadPrompts();
			} catch (e) {
				DeepRead.log("SidebarChat presets: " + (e.message || e));
				this._presets = [];
			}
			if (!this._doc() || this._doc() !== doc) return;
			const sel = doc.querySelector("[data-role='preset']");
			if (!sel) return;
			const prev = preferredId || sel.selectedOptions[0]?.dataset.id;
			sel.textContent = "";
			this._presets.forEach((p, i) => {
				const opt = doc.createElement("option");
				opt.value = String(i);
				opt.dataset.id = p.id;
				opt.textContent = p && p.name ? p.name : this._t("未命名预设", "Untitled preset");
				sel.appendChild(opt);
			});
			const picked = this._presets.find(p => p.id === prev) || this._presets.find(p => p.id === this._defaultPresetId);
			sel.selectedIndex = this._presets.indexOf(picked);
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
			const mcp = DeepRead.Mcp?.isEnabled() ? this._mcpLabel || "MCP …" : this._t("MCP 已关闭", "MCP off");
			if (el) {
				el.textContent = this._t("内置", "Built-in") + " · " + this._nativeTools().length + " | " + mcp;
				el.title = this._t("输入 /tools 查看当前工具", "Type /tools to list the current tools");
			}
			if (!doc.querySelector(".deepread-model-picker")) this._mountModelPicker(doc);
			else this._fillModelPicker(doc);
		},

		async _refreshMcpStatus() {
			await this._loadTools();
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
			list.forEach(m => {
				m.folded = anyOpen;
				if (m.role === "tool") m.groupOpen = !anyOpen;
			});
			this._renderMessages();
		},

		_toolTitle(name, server, originalName) {
			const lookup = originalName || name;
			const zh = {
				deepread_get_context: "读取选区",
				deepread_plan_organize: "条目整理",
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
				deepread_get_context: "Selection",
				deepread_plan_organize: "Organize items",
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
			const label = Object.hasOwn(table, lookup) ? table[lookup] : lookup || this._t("工具", "Tool");
			return server ? server + " · " + label : label;
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

		_appendToolGroup(box, doc, entries) {
			const group = doc.createElement("details");
			group.className = "tool-group";
			const first = entries[0].msg;
			group.open = !!first.groupOpen;
			const header = doc.createElement("summary");
			const count = doc.createElement("span");
			count.className = "count";
			const n = entries.length;
			count.textContent = this._t(`工具调用 · ${n} 次`, `Tool calls · ${n}`);
			const names = doc.createElement("span");
			names.className = "names";
			const totals = new Map();
			for (const { msg } of entries) {
				const title = this._toolTitle(msg.name, msg.server, msg.mcpName);
				totals.set(title, (totals.get(title) || 0) + 1);
			}
			names.textContent = Array.from(totals, ([name, times]) => times > 1 ? name + " ×" + times : name).join(" · ");
			header.appendChild(count);
			header.appendChild(names);
			group.appendChild(header);
			const populate = () => {
				if (group.children.length > 1) return;
				for (const { msg, index } of entries) this._appendToolCase(group, doc, index, msg);
			};
			group.addEventListener("toggle", () => {
				if (!group.isConnected) return;
				first.groupOpen = group.open;
				if (group.open) populate();
			});
			if (group.open) populate();
			box.appendChild(group);
		},

		_appendToolCase(box, doc, index, msg) {
			const folded = this._isFolded(msg);
			const title = this._toolTitle(msg.name, msg.server, msg.mcpName);
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
			const bar = doc.createElement("button");
			bar.type = "button";
			bar.setAttribute("aria-expanded", String(!folded));
			bar.className = "foldbar";
			const chev = doc.createElement("span");
			chev.textContent = folded ? "▸" : "▾";
			const label = doc.createElement("span");
			label.className = "tool-name";
			label.textContent = title;
			const result = doc.createElement("span");
			result.className = "result";
			result.textContent = msg.skipped ? this._t("已跳过", "Skipped") : summary;
			bar.appendChild(chev);
			bar.appendChild(label);
			bar.appendChild(result);
			bar.addEventListener("click", (e) => {
				e.preventDefault();
				e.stopPropagation();
				msg.folded = !this._isFolded(msg);
				bubble.classList.toggle("is-folded", msg.folded);
				bar.setAttribute("aria-expanded", String(!msg.folded));
				chev.textContent = msg.folded ? "▸" : "▾";
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

		_appendBubble(box, doc, index, msg, whoText) {
			const folded = this._isFolded(msg);
			const { card: bubble, header: bar } = DeepRead._createMessageCard(doc, msg.role);
			bubble.classList.toggle("is-folded", folded);
			bubble.title = this._t("右键：存为预设、删除、重发", "Right-click: save preset, delete, resend");
			bubble.addEventListener("contextmenu", (e) => {
				e.preventDefault();
				if (this._busy) return;
				this._showMsgMenu(doc, e.clientX, e.clientY, index);
			});
			bar.classList.add("foldbar");
			bar.style.justifyContent = "flex-start";
			const chev = doc.createElement("span");
			chev.textContent = folded ? "▸" : "▾";
			const label = doc.createElement("span");
			label.className = "message-role";
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
			const actions = doc.createElement("span");
			actions.className = "bubble-actions";
			const copy = DeepRead._makeMsgActionBtn(doc, { title: this._t("复制", "Copy"), icon: "📋" });
			copy.addEventListener("click", e => {
				e.stopPropagation();
				DeepRead._copyToClipboard(msg.content, doc);
			});
			const more = DeepRead._makeMsgActionBtn(doc, { title: this._t("更多操作", "More actions"), icon: "⋯" });
			more.disabled = this._busy;
			more.addEventListener("click", e => {
				e.stopPropagation();
				const rect = more.getBoundingClientRect();
				this._showMsgMenu(doc, rect.left, rect.bottom, index);
			});
			actions.appendChild(copy);
			actions.appendChild(more);
			bar.appendChild(actions);
			bar.addEventListener("click", (e) => {
				e.preventDefault();
				e.stopPropagation();
				if (this._busy) return;
				msg.folded = !this._isFolded(msg);
				this._renderMessages();
			});
			const body = DeepRead._renderMessageBody(msg, doc);
			body.classList.add("body");
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
			if (this._closeMsgMenu) this._closeMsgMenu();
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
					"选中文献后，可以整理标题和附件名。输入 /tools 查看当前可用工具。",
					"Select papers to review titles and attachment names. Type /tools to see available tools."
				);
				box.appendChild(empty);
			}
			let pendingTools = [];
			const flushTools = () => {
				if (pendingTools.length) this._appendToolGroup(box, doc, pendingTools);
				pendingTools = [];
			};
			list.forEach((msg, index) => {
				const calls = msg.toolCalls && msg.toolCalls.length
					? msg.toolCalls.map(c => this._toolTitle(c.name)).filter(Boolean).join("、")
					: "";
				if (msg.role === "tool") {
					pendingTools.push({ msg, index });
					return;
				}
				if (msg.role === "assistant" && !msg.content && calls) return;
				if (!msg.content && msg.role !== "user") return;
				flushTools();
				let whoText = "";
				if (calls) whoText = this._t("接着调用 ", "Then ") + calls;
				else if (msg.role === "assistant" && msg.model) whoText = msg.model;
				this._appendBubble(
					box, doc, index, msg,
					whoText
				);
			});
			flushTools();
			if (this._busy) {
				const pending = doc.createElement("div");
				pending.className = "bubble assistant pending";
				pending.textContent = this._statusLine || "…";
				box.appendChild(pending);
			}
			if (this._reviewCard?.ownerDocument === doc) box.appendChild(this._reviewCard);
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
			if (this._busy || this._sending) return;
			const message = String(text || "").trim();
			if (!message) return;
			const selection = this._selection(doc);
			const collections = this._selectedCollections(doc);
			this._sending = true;
			const inventory = this._isToolQuestion(message);
			try { if (!inventory) await DeepRead.syncProviderConfig(); }
			finally { this._sending = false; }
			if (!inventory && !DeepRead.provider?.config?.apiKey) {
				DeepRead.showAlert("DeepRead", this._t("请先在设置中配置 API Key", "Set an API key in preferences first"));
				const input = doc && doc.querySelector && doc.querySelector("[data-role='input']");
				if (input && !input.value) input.value = message;
				return;
			}
			this._messages.push({ role: "user", content: message, selection, collections, ts: Date.now() });
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

		_nativeTools() {
			return Object.values(DeepRead.ToolRegistry).filter(t => t.floatingChat);
		},

		_isToolQuestion(text) {
			const q = String(text || "").trim().replace(/[?？。!！]+$/, "").toLowerCase();
			return q === "/tools" || /^(你)?(现在|目前|当前)?(支持(什么|哪些)(东西|功能|工具|操作)?|能做什么|能用哪些工具|有哪些(工具|功能))$/.test(q)
				|| /^(what (can you do|tools (are available|do you have))|list (your |available )?tools)$/.test(q);
		},

		_toolInventory(tools) {
			const sections = new Map();
			for (const tool of tools) {
				const source = tool.server ? "MCP · " + tool.server : this._t("DeepRead 内置", "DeepRead built-in");
				if (!sections.has(source)) sections.set(source, []);
				const id = "`" + tool.name + "`";
				const name = tool.mcpName || tool.name;
				const title = this._toolTitle(name);
				const description = !tool.server && DeepRead._locale === "zh" ? tool.descriptionZh : tool.description;
				const label = tool.server && title !== name ? title : description || "";
				const plain = label.replace(/\s+/g, " ").trim().slice(0, 180).replace(/[\\`*_\[\]<>!&]/g, c => "&#" + c.charCodeAt(0) + ";");
				sections.get(source).push("- " + id + (plain ? " · " + plain : ""));
			}
			return [this._mcpLabel, ...Array.from(sections, ([source, entries]) =>
				"**" + source + " (" + entries.length + ")**\n\n" + entries.join("\n"))].join("\n\n");
		},

		async _loadTools() {
			const local = this._nativeTools();
			const mcp = DeepRead.Mcp;
			if (!mcp || !mcp.isEnabled()) {
				this._mcpLabel = this._t("MCP 已关闭", "MCP off");
				return local;
			}
			try {
				const discovered = await mcp.listTools();
				if (!mcp.isEnabled()) {
					this._mcpLabel = this._t("MCP 已关闭", "MCP off");
					return local;
				}
				const tools = discovered.filter(remote => !local.some(t => t.name === remote.name));
				const active = mcp.statuses().filter(s => s.state !== "disabled");
				const offline = active.filter(s => s.state === "offline").map(s => s.id);
				this._mcpLabel = active.length
					? this._t(`MCP · ${tools.length} 个工具`, `MCP · ${tools.length} tools`)
					: this._t("MCP · 未启用服务", "MCP · no servers enabled");
				if (offline.length) this._mcpLabel += this._t(" · 离线 ", " · offline ") + offline.join(", ");
				return local.concat(tools);
			} catch (e) {
				this._mcpLabel = this._t("MCP 不可用，请检查设置", "MCP unavailable · check settings");
				DeepRead.log("SidebarChat mcp: " + (e.message || e));
				return local;
			}
		},

		_needsConfirm(call, tools) {
			const spec = (tools || []).find(t => t.name === call.name);
			const ann = (spec && spec.annotations) || {};
			if (ann.destructiveHint === true || ann.readOnlyHint === false) return true;
			if (ann.readOnlyHint === true) return false;
			if (spec?.server === "zotero" && ZOTERO_LOOKUPS.has(spec.mcpName)) return false;
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

		_confirmPlan(calls, offered) {
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
					const tool = offered?.get(call.name);
					nameCell.textContent = tool ? this._toolTitle(tool.name, tool.server, tool.mcpName) : call.name || "";
					const changeCell = doc.createElement("td");
					changeCell.textContent = call.detail ?? this._describeChange(call);
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
				const countSelected = () => {
					const n = boxes.filter(el => el.checked).length;
					yes.disabled = !n;
					yes.textContent = this._t(`执行所选 ${n} 项`, `Apply selected (${n})`);
				};
				boxes.forEach(el => el.addEventListener("change", countSelected));
				countSelected();
				const cancel = () => done(null);
				const done = (picked) => {
					if (this._reviewCard !== card) return;
					doc.defaultView.removeEventListener("pagehide", cancel);
					this._cancelReview = null;
					this._reviewCard = null;
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
				this._reviewCard = card;
				this._cancelReview = cancel;
				doc.defaultView.addEventListener("pagehide", cancel, { once: true });
				box.scrollTop = box.scrollHeight;
			});
		},

		async _reviewOrganize(spec, args, message) {
			const plan = await spec.run(args, message);
			if (!plan.rows.length) return [this._t("没有需要执行的变更。", "No changes to apply."), ...plan.notes].join("\n");
			const choices = await this._confirmPlan(plan.rows);
			if (!choices) return this._t("已取消条目整理。", "Organize changes cancelled.");
			return spec.apply(plan, new Set(plan.rows.filter((_, i) => choices[i]).map(r => r.id)));
		},

		async _runTurn() {
			const message = this._messages.slice().reverse().find(m => m.role === "user");
			const tools = await this._loadTools();
			if (this._isToolQuestion(message?.content)) {
				this._messages.push({ role: "assistant", content: this._toolInventory(tools), ts: Date.now() });
				this.save();
				return;
			}
			const activeModel = DeepRead.provider.config.model;
			const offered = new Map(tools.map(t => [t.name, t]));
			let organizeSummary;
			const live = this._doc();
			if (live) this._paintModel(live);
			let transcript = this._forModel(this._messages, tools);
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
					if (offered.has(call.name) && this._needsConfirm(call, tools)) writes.push(call);
					else reads.push(call);
				});
				const runOne = async (call, allow) => {
					const spec = offered.get(call.name);
					this._statusLine = allow
						? this._t("调用 ", "Call ") + call.name
						: this._t("已跳过 ", "Skipped ") + call.name;
					this._renderMessages();
					let output = "";
					if (!allow) {
						output = this._t("用户没有确认这次修改。", "The user did not confirm this change.");
					} else {
						try {
							if (!spec) throw new Error(this._t("本轮未提供此工具", "Tool not offered this turn"));
							const args = call.arguments || {};
							if (spec.apply && spec.run) {
								organizeSummary ??= await this._reviewOrganize(spec, args, message);
								output = organizeSummary;
							} else if (spec.run) {
								output = JSON.stringify(await spec.run(args, message));
							} else {
								output = await DeepRead.Mcp.callTool(spec, args);
							}
						} catch (e) {
							output = this._t("工具调用失败：", "Tool call failed: ") + (e.message || e);
						}
					}
					if (output.length > MAX_TOOL_CHARS) output = output.slice(0, MAX_TOOL_CHARS) + "\n…";
					const toolMsg = {
						role: "tool",
						toolCallId: call.id,
						name: call.name,
						server: spec?.server,
						mcpName: spec?.mcpName,
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
					const picked = await this._confirmPlan(writes, offered);
					for (let i = 0; i < writes.length; i++) {
						await runOne(writes[i], !!(picked && picked[i]));
					}
				}
				if (organizeSummary !== undefined) {
					finalContent = organizeSummary;
					break;
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
