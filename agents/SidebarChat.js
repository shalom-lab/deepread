/**
 * 常驻浮层对话
 * - 不绑定文献条目，也不附带 PDF
 * - 界面（下拉、填入、运行、发送）跟单篇阅读同一套交互
 * - 数据分开：对话 deepread_sidebar_chat.json，预设 deepread_sidebar_prompts.json
 * - 不读不写 deepread_history.json / deepread_prompts.json
 * - 「条目整理」是内置动作，不写入预设文件
 */
(function () {
	if (typeof DeepRead === "undefined") return;

	const ACTION_ORGANIZE = "__organize__";
	const MAX_MESSAGES = 200;
	const MAX_TOOL_ROUNDS = 4;
	const MAX_TOOL_CHARS = 8000;

	DeepRead.SidebarChat = {
		_messages: [],
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
			try {
				const fp = this._promptsFilePath();
				if (typeof IOUtils !== "undefined" && await IOUtils.exists(fp)) {
					const text = await IOUtils.readUTF8(fp);
					const saved = text ? JSON.parse(text) : [];
					if (Array.isArray(saved)) {
						this._presets = saved.filter(p => p && (p.name || p.prompt));
						return this._presets;
					}
				}
			} catch (e) {
				DeepRead.log("SidebarChat.loadPrompts: " + (e.message || e));
			}
			this._presets = [];
			return this._presets;
		},

		async savePrompts(presets) {
			const list = Array.isArray(presets) ? presets : [];
			this._presets = list;
			await IOUtils.writeUTF8(this._promptsFilePath(), JSON.stringify(list));
			return true;
		},

		async load() {
			if (this._loaded) return this._messages;
			this._loaded = true;
			try {
				const fp = this._filePath();
				if (typeof IOUtils !== "undefined" && await IOUtils.exists(fp)) {
					const text = await IOUtils.readUTF8(fp);
					const data = text ? JSON.parse(text) : null;
					const list = data && Array.isArray(data.messages) ? data.messages : [];
					this._messages = list.filter(m => m && (m.role === "user" || m.role === "assistant") && m.content).slice(-MAX_MESSAGES);
				}
			} catch (e) {
				DeepRead.log("SidebarChat.load: " + (e.message || e));
				this._messages = [];
			}
			return this._messages;
		},

		save() {
			if (!this._loaded) return;
			try {
				const messages = (this._messages || []).slice(-MAX_MESSAGES);
				this._messages = messages;
				const json = JSON.stringify({ version: 1, messages });
				IOUtils.writeUTF8(this._filePath(), json).catch(e => {
					DeepRead.log("SidebarChat.save: " + (e.message || e));
				});
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
					+ "用户若要整理条目，会自己打开「条目整理」。",
				"This is DeepRead's floating chat, not tied to one item. "
					+ (withTools
						? "Use the provided Zotero tools to look things up. Do not invent library items. "
						: "Zotero MCP is offline. Do not pretend you searched the library. ")
					+ "The user opens Organize themselves."
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
					if (!noted) {
						content = note + "\n\n" + content;
						noted = true;
					}
					out.push({ role: "user", content });
				}
			});
			return out;
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
			this._bind(doc);
			await this._fillPresets(doc);
			if (this._busy) this._setBusy(doc, true);
			this._refreshMcpStatus();
		},

		_html() {
			const fill = this._esc(this._t("填入", "Fill"));
			const run = this._esc(this._t("运行", "Run"));
			const send = this._esc(this._t("发送", "Send"));
			const clear = this._esc(this._t("清空", "Clear"));
			const placeholder = this._esc(this._t(
				"输入消息。Enter 换行，Ctrl+Enter 发送。这条对话不绑定条目。",
				"Type a message. Enter for a new line, Ctrl+Enter to send. This chat is not tied to an item."
			));
			return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8"/>
<style>
html, body { margin: 0; height: 100%; background: #fafafa; color: #18181b; }
body { font: 12px/1.45 "Segoe UI", "PingFang SC", "Microsoft YaHei", system-ui, sans-serif; }
#deepread-sidechat-root {
  height: 100%; box-sizing: border-box;
  display: flex; flex-direction: column; gap: 8px;
  padding: 2px 2px 0;
}
.presets { display: flex; gap: 6px; align-items: center; }
.presets select {
  flex: 1; min-width: 0;
  border: 1px solid #ececef; border-radius: 8px;
  padding: 6px 8px; font: inherit; background: #fff; color: inherit;
}
.btn {
  border: none; border-radius: 8px; padding: 6px 10px;
  font: inherit; font-weight: 600; cursor: pointer; white-space: nowrap;
}
.btn-ghost { background: #f4f4f5; color: #3f3f46; }
.btn-primary { background: #5744e6; color: #fff; }
.btn:disabled { opacity: .45; cursor: default; }
#msgs {
  flex: 1; min-height: 0; overflow: auto;
  display: flex; flex-direction: column; gap: 8px;
  padding: 2px;
}
.bubble {
  max-width: 92%; padding: 8px 10px; border-radius: 12px;
  white-space: pre-wrap; word-break: break-word;
}
.bubble.user { align-self: flex-end; background: #f3f1ff; }
.bubble.assistant { align-self: flex-start; background: #fff; border: 1px solid #ececef; }
.bubble.pending { color: #71717a; }
.bubble.tool { align-self: stretch; max-width: 100%; background: #fafafa; border: 1px dashed #e4e4e7; color: #3f3f46; font-size: 11px; }
.confirm { align-self: stretch; max-width: 100%; background: #fff; border: 1px solid #e4e4e7; border-radius: 12px; padding: 8px 10px; }
.confirm pre { margin: 6px 0; white-space: pre-wrap; word-break: break-word; font: 11px/1.4 ui-monospace, monospace; max-height: 120px; overflow: auto; }
.confirm .row { justify-content: flex-end; }
.who { display: block; margin-top: 4px; font-size: 10px; color: #a1a1aa; }
.empty { margin: auto; color: #71717a; text-align: center; padding: 18px 12px; line-height: 1.55; }
.composer { display: flex; flex-direction: column; gap: 6px; }
textarea {
  width: 100%; min-height: 52px; max-height: 110px; resize: vertical;
  border: 1px solid #ececef; border-radius: 10px; padding: 8px;
  font: inherit; box-sizing: border-box; background: #fff;
}
.row { display: flex; justify-content: space-between; align-items: center; gap: 8px; }
.hint { font-size: 10px; color: #a1a1aa; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
</style>
</head>
<body>
<div id="deepread-sidechat-root">
  <div class="presets">
    <select data-role="preset" title="${this._esc(this._t("预设", "Preset"))}"></select>
    <button type="button" class="btn btn-ghost" data-act="fill">${fill}</button>
    <button type="button" class="btn btn-ghost" data-act="run">${run}</button>
  </div>
  <div id="msgs" data-role="msgs"></div>
  <div class="composer">
    <textarea data-role="input" placeholder="${placeholder}"></textarea>
    <div class="row">
      <span class="hint" data-role="model"></span>
      <span style="display:flex;gap:6px;">
        <button type="button" class="btn btn-ghost" data-act="clear">${clear}</button>
        <button type="button" class="btn btn-primary" data-act="send">${send}</button>
      </span>
    </div>
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
				const action = preset && preset.value === ACTION_ORGANIZE;
				if (fillBtn) {
					fillBtn.disabled = !!action || this._busy;
					fillBtn.title = action
						? this._t("条目整理会打开整理面板", "Organize opens the plan panel")
						: this._t("追加到输入框", "Append into the input");
				}
				if (runBtn) {
					runBtn.textContent = action ? this._t("打开", "Open") : this._t("运行", "Run");
					runBtn.disabled = this._busy;
				}
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
					if (e.key !== "Enter" || !(e.ctrlKey || e.metaKey) || e.altKey) return;
					e.preventDefault();
					this._sendFromInput(doc);
				});
			}
			this._paintModel(doc);
			syncPresetButtons();
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
			const action = doc.createElement("option");
			action.value = ACTION_ORGANIZE;
			action.textContent = this._t("条目整理", "Organize");
			sel.appendChild(action);
			this._presets.forEach((p, i) => {
				const opt = doc.createElement("option");
				opt.value = String(i);
				opt.textContent = p && p.name ? p.name : this._t("未命名预设", "Untitled preset");
				sel.appendChild(opt);
			});
			if (prev && Array.from(sel.options).some(o => o.value === prev)) sel.value = prev;
			else sel.value = ACTION_ORGANIZE;
			const root = doc.getElementById("deepread-sidechat-root");
			if (root && root._syncPresetButtons) root._syncPresetButtons();
		},

		_paintModel(doc) {
			if (!doc) return;
			const el = doc.querySelector("[data-role='model']");
			if (!el) return;
			let model = "";
			try {
				model = (DeepRead.provider && DeepRead.provider.config && DeepRead.provider.config.model) || "";
			} catch (e) { /* ignore */ }
			const mcp = this._mcpLabel || this._t("MCP 未连接", "MCP offline");
			el.textContent = model ? (model + " · " + mcp) : mcp;
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
					"直接输入即可对话。预设存在浮层自己的文件里。「条目整理」会打开整理面板。连上 Zotero MCP 后，可以让模型查库。",
					"Type to chat. Presets live in the floating panel's own file. Organize opens the plan panel. After Zotero MCP is connected, the model can query the library."
				);
				box.appendChild(empty);
			}
			list.forEach(msg => {
				if (msg.role === "tool") {
					const bubble = doc.createElement("div");
					bubble.className = "bubble tool";
					const body = String(msg.content || "");
					bubble.textContent = (msg.name || "tool") + "\n" + (body.length > 240 ? body.slice(0, 240) + "…" : body);
					box.appendChild(bubble);
					return;
				}
				const calls = msg.toolCalls && msg.toolCalls.length
					? msg.toolCalls.map(c => c.name).filter(Boolean).join(", ")
					: "";
				if (msg.role === "assistant" && !msg.content && calls) {
					const bubble = doc.createElement("div");
					bubble.className = "bubble tool";
					bubble.textContent = this._t("调用 ", "Call ") + calls;
					box.appendChild(bubble);
					return;
				}
				if (!msg.content && msg.role !== "user") return;
				const bubble = doc.createElement("div");
				bubble.className = "bubble " + (msg.role === "user" ? "user" : "assistant");
				bubble.textContent = msg.content || "";
				if (calls) {
					const who = doc.createElement("span");
					who.className = "who";
					who.textContent = this._t("接着调用 ", "Then call ") + calls;
					bubble.appendChild(who);
				} else if (msg.role === "assistant" && msg.model) {
					const who = doc.createElement("span");
					who.className = "who";
					who.textContent = msg.model;
					bubble.appendChild(who);
				}
				box.appendChild(bubble);
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
			["[data-act='send']", "[data-act='run']", "[data-act='clear']"].forEach(sel => {
				const btn = root.querySelector(sel);
				if (btn) btn.disabled = !!busy;
			});
			if (root._syncPresetButtons) root._syncPresetButtons();
		},

		_openOrganize() {
			const frame = this._frame;
			if (!frame || !DeepRead.OrganizeDialog || typeof DeepRead.OrganizeDialog.mountFrame !== "function") {
				DeepRead.showAlert("DeepRead", this._t("整理模块未加载", "Organize module is not loaded"));
				return;
			}
			try {
				DeepRead.OrganizeDialog.mountFrame(frame);
			} catch (e) {
				DeepRead.log("SidebarChat organize: " + (e.message || e));
				DeepRead.showAlert("DeepRead", this._t("打开整理失败：", "Failed to open organize: ") + (e.message || e));
			}
		},

		_selectedPreset(doc) {
			const sel = doc.querySelector("[data-role='preset']");
			if (!sel) return null;
			if (sel.value === ACTION_ORGANIZE) return { action: ACTION_ORGANIZE };
			const preset = this._presets[parseInt(sel.value, 10)];
			return preset || null;
		},

		_fillInput(doc) {
			const picked = this._selectedPreset(doc);
			if (!picked || picked.action === ACTION_ORGANIZE) return;
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
			if (picked.action === ACTION_ORGANIZE) {
				this._openOrganize();
				return;
			}
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
			await DeepRead.syncProviderConfig();
			if (!DeepRead.provider || !DeepRead.provider.config || !DeepRead.provider.config.apiKey) {
				DeepRead.showAlert("DeepRead", this._t("请先在设置中配置 API Key", "Set an API key in preferences first"));
				const input = doc && doc.querySelector && doc.querySelector("[data-role='input']");
				if (input && !input.value) input.value = message;
				return;
			}
			this._busy = true;
			this._messages.push({ role: "user", content: message, ts: Date.now() });
			this.save();
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

		_confirmTool(call) {
			const doc = this._doc();
			const box = doc && doc.querySelector("[data-role='msgs']");
			if (!box) return Promise.resolve(false);
			return new Promise(resolve => {
				const card = doc.createElement("div");
				card.className = "confirm";
				const title = doc.createElement("div");
				title.textContent = this._t("这个工具会改文献库，先确认再执行：", "This tool can change the library. Confirm before running:") + " " + call.name;
				const pre = doc.createElement("pre");
				let args = "";
				try { args = JSON.stringify(call.arguments || {}, null, 2); } catch (e) { args = ""; }
				pre.textContent = args.length > 800 ? args.slice(0, 800) + "…" : args;
				const row = doc.createElement("div");
				row.className = "row";
				const no = doc.createElement("button");
				no.type = "button";
				no.className = "btn btn-ghost";
				no.textContent = this._t("取消", "Cancel");
				const yes = doc.createElement("button");
				yes.type = "button";
				yes.className = "btn btn-primary";
				yes.textContent = this._t("确认执行", "Run");
				const done = (ok) => {
					if (card.parentNode) card.parentNode.removeChild(card);
					resolve(ok);
				};
				no.addEventListener("click", () => done(false));
				yes.addEventListener("click", () => done(true));
				row.appendChild(no);
				row.appendChild(yes);
				card.appendChild(title);
				if (args) card.appendChild(pre);
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
				for (const call of calls) {
					this._statusLine = this._t("调用 ", "Call ") + call.name;
					this._renderMessages();
					let output = "";
					const allow = this._needsConfirm(call, tools) ? await this._confirmTool(call) : true;
					if (!allow) {
						output = this._t("用户取消了这次工具调用。", "The user cancelled this tool call.");
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
						content: output,
						ts: Date.now()
					};
					this._messages.push(toolMsg);
					transcript.push(toolMsg);
					this.save();
					this._renderMessages();
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
			this._messages = [];
			this.save();
			this._renderMessages();
		}
	};
})();
