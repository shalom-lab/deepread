/* Streamable HTTP tool discovery. Sessions and tool descriptors belong to one
 * endpoint, so a settings change cannot redirect a pending model tool call. */
(function () {
	if (typeof DeepRead === "undefined") return;

	const enabledKey = "extensions.deepread.mcp.enabled";
	const serversKey = "extensions.deepread.mcp.servers";
	const DEFAULT_URL = "http://127.0.0.1:23120/mcp";
	const clients = new Map();
	const t = (zh, en) => DeepRead._locale === "zh" ? zh : en;
	const object = value => value !== null && typeof value === "object" && !Array.isArray(value);
	const unavailable = () => new Error(t("此工具已停用或清单已更改", "MCP tool list changed or tool unavailable"));

	function parseConfig(text) {
		let json;
		try { json = JSON.parse(text); }
		catch { throw new Error(t("JSON 格式无效，请检查引号、逗号和括号。", "Invalid JSON. Check quotes, commas and brackets.")); }
		if (!object(json) || !object(json.mcpServers) || Object.keys(json).some(key => key !== "mcpServers")) {
			throw new Error(t("配置应只包含 mcpServers 对象。", "Provide an object containing mcpServers."));
		}
		return Object.entries(json.mcpServers).map(([id, entry]) => {
			if (!/^[A-Za-z][A-Za-z0-9_-]{0,31}$/.test(id)) throw new Error(t("服务名应以英文字母开头，最多 32 个字母、数字、下划线或短横线。", "Use a server ID starting with a letter, with up to 32 letters, numbers, underscores or hyphens."));
			if (!object(entry) || Object.keys(entry).some(k => !["url", "enabled", "headers", "type"].includes(k)) ||
				(entry.type !== undefined && !["http", "streamable-http"].includes(entry.type))) {
				throw new Error(id + t("：支持 Streamable HTTP 的 url、enabled、headers 配置。", ": use Streamable HTTP with url, enabled and optional headers."));
			}
			let url;
			try {
				if (typeof entry.url !== "string") throw Error();
				url = new URL(entry.url);
				if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.hash) throw Error();
			} catch { throw new Error(id + t("：请输入完整 HTTP(S) 地址。", ": enter a full HTTP(S) URL.")); }
			if ("enabled" in entry && typeof entry.enabled !== "boolean") throw new Error(id + t("：enabled 应为 true 或 false。", ": enabled must be true or false."));
			if ("headers" in entry && !object(entry.headers)) throw new Error(id + t("：headers 应为键值对象。", ": headers must be an object."));
			const headers = Object.create(null);
			for (const [key, value] of Object.entries(entry.headers || {})) {
				if (!/^[A-Za-z0-9!#$%&'*+.^_`|~-]+$/.test(key) || typeof value !== "string" || /[\r\n\0]/.test(value) ||
					/^(accept|content-type|content-length|host|connection|transfer-encoding|cookie|origin|mcp-session-id|mcp-protocol-version|__proto__)$/i.test(key) ||
					Object.hasOwn(headers, key.toLowerCase())) throw new Error(id + t("：请求头无效或与协议保留字段冲突。", ": invalid, duplicate or reserved HTTP header."));
				headers[key.toLowerCase()] = value;
			}
			return { id, url: url.href, enabled: entry.enabled !== false, headers };
		});
	}

	function readEvent(block, id) {
		const payload = block.split(/\r?\n/).filter(line => line.startsWith("data:")).map(line => line.slice(5).trimStart()).join("\n");
		if (!payload || payload === "[DONE]") return;
		const message = JSON.parse(payload);
		if (message.id === id) return message;
	}

	async function readReply(response, id) {
		if (!(response.headers.get("content-type") || "").toLowerCase().includes("text/event-stream")) return JSON.parse(await response.text());
		const reader = response.body?.getReader?.();
		const decoder = new TextDecoder();
		let buffer = "";
		try {
			for (;;) {
				const chunk = reader ? await reader.read() : { done: true };
				if (!reader) buffer = await response.text();
				else buffer += decoder.decode(chunk.value, { stream: !chunk.done });
				const blocks = buffer.split(/\r?\n\r?\n/);
				buffer = chunk.done ? "" : blocks.pop();
				for (const block of blocks) {
					const reply = readEvent(block, id);
					if (reply) return reply;
				}
				if (chunk.done) throw new Error(t("MCP 未返回对应结果", "MCP response missing"));
			}
		} finally {
			if (reader) reader.cancel().catch(() => {});
		}
	}

	class Client {
		constructor(config) {
			this.config = config;
			this.signature = JSON.stringify(config);
			this.sequence = 0;
			this.generation = 0;
			this.requests = new Set();
			this.clear("unqueried");
		}

		clear(state) {
			this.generation++;
			this.session = "";
			this.version = "2025-03-26";
			this.ready = false;
			this.state = state;
			this.tools = new Map();
		}

		dispose() {
			this.disposed = true;
			for (const controller of this.requests) controller.abort();
			this.clear("disabled");
		}

		async rpc(method, params) {
			if (this.disposed) throw unavailable();
			const generation = this.generation;
			const notify = method === "notifications/initialized";
			const body = { jsonrpc: "2.0", method };
			if (!notify) body.id = ++this.sequence;
			if (params) body.params = params;
			const headers = { ...this.config.headers, "Content-Type": "application/json", Accept: "application/json, text/event-stream",
				"MCP-Protocol-Version": this.version };
			if (this.session) headers["Mcp-Session-Id"] = this.session;
			const Controller = typeof AbortController === "function" ? AbortController
				: Zotero.getMainWindow()?.AbortController || Services.appShell.hiddenDOMWindow.AbortController;
			const controller = new Controller();
			this.requests.add(controller);
			const timer = setTimeout(() => controller.abort(), 8000);
			try {
				const response = await fetch(this.config.url, {
					method: "POST", body: JSON.stringify(body), headers, signal: controller.signal, credentials: "omit", redirect: "error"
				});
				if (!response.ok) {
					const error = new Error("MCP HTTP " + response.status);
					error.status = response.status;
					throw error;
				}
				if (generation !== this.generation) throw unavailable();
				if (method === "initialize") this.session = response.headers.get("mcp-session-id") || "";
				if (notify) { response.body?.cancel?.().catch(() => {}); return; }
				const reply = await readReply(response, body.id);
				if (generation !== this.generation || reply?.id !== body.id) throw unavailable();
				if (reply.error) {
					const error = new Error("MCP " + (reply.error.code || "RPC error"));
					error.code = reply.error.code;
					throw error;
				}
				if (!Object.hasOwn(reply, "result")) throw new Error("Invalid MCP response");
				return reply.result;
			} finally {
				clearTimeout(timer);
				this.requests.delete(controller);
			}
		}

		async initialize() {
			const start = () => this.rpc("initialize", { protocolVersion: this.version, capabilities: {},
				clientInfo: { name: "DeepRead", version: DeepRead.version || "1" } });
			let hello;
			try { hello = await start(); }
			catch (e) {
				if (e.status !== 400 && e.code !== -32602 && e.code !== -32600) throw e;
				this.version = "2024-11-05";
				this.session = "";
				hello = await start();
			}
			this.version = hello.protocolVersion || this.version;
			await this.rpc("notifications/initialized");
			this.ready = true;
		}

		discover() {
			if (!this.pending) {
				// A server can expire a session between chat turns. Retry only
				// discovery, never a tools/call that may already have written.
				const hadSession = !!this.session;
				this.pending = this.list().catch(e => {
					if (this.disposed || !hadSession || e.status !== 404) throw e;
					this.clear("unqueried");
					return this.list();
				}).catch(e => { this.clear("offline"); throw e; })
					.finally(() => { this.pending = null; });
			}
			return this.pending;
		}

		async list() {
			if (!this.ready) await this.initialize();
			const next = new Map();
			const names = new Set();
			const cursors = new Set();
			let cursor;
			do {
				const result = await this.rpc("tools/list", cursor ? { cursor } : {});
				if (!Array.isArray(result?.tools)) throw new Error("Invalid tools/list");
				for (const item of result.tools) {
					if (typeof item?.name !== "string" || !item.name || names.has(item.name)) throw new Error("Invalid MCP tool name");
					names.add(item.name);
					let base = item.name.replace(/[^a-zA-Z0-9_]/g, "_").replace(/^(?=\d)/, "_");
					const id = this.config.id;
					if (id !== "zotero" || base.startsWith("mcp_")) base = "mcp_" + id.length + "_" + id + "_" + base;
					let name = base.slice(0, 64);
					for (let n = 2; next.has(name); n++) {
						const suffix = "_" + n;
						name = base.slice(0, 64 - suffix.length) + suffix;
					}
					const tool = { name, mcpName: item.name, server: id, description: typeof item.description === "string" ? item.description : "",
						inputSchema: item.inputSchema || { type: "object", properties: {} }, annotations: item.annotations || {} };
					const old = this.tools.get(name);
					next.set(name, old && JSON.stringify(old) === JSON.stringify(tool) ? old : tool);
				}
				cursor = result.nextCursor;
				if (cursor && (typeof cursor !== "string" || cursors.has(cursor))) throw new Error("Invalid tools/list cursor");
				cursors.add(cursor);
			} while (cursor);
			if (this.disposed) throw unavailable();
			this.tools = next;
			this.state = "online";
			return [...next.values()];
		}

		async call(spec, args) {
			if (this.tools.get(spec.name) !== spec) throw unavailable();
			const generation = this.generation;
			let result;
			try { result = await this.rpc("tools/call", { name: spec.mcpName, arguments: args || {} }); }
			catch (e) {
				if (generation === this.generation && e.code == null) this.clear("offline");
				throw e;
			}
			if (typeof result === "string") return result;
			const parts = Array.isArray(result?.content) ? result.content : [];
			const text = parts.map(part => typeof part === "string" ? part : part?.text ?? JSON.stringify(part)).join("\n");
			return (result?.isError ? t("工具返回错误：", "Tool error: ") : "") + (text || JSON.stringify(result ?? ""));
		}
	}

	// Reconcile at discovery and again at execution: settings can change while
	// the model is responding or while a user is reviewing a write operation.
	function reconcile(active) {
		const wanted = new Map(active.map(config => [config.id, config]));
		for (const [id, client] of clients) {
			if (JSON.stringify(wanted.get(id)) === client.signature) continue;
			client.dispose();
			clients.delete(id);
		}
		for (const config of active) if (!clients.has(config.id)) clients.set(config.id, new Client(config));
		return active.map(c => clients.get(c.id));
	}

	DeepRead.Mcp = {
		parseConfig,
		isEnabled() { return DeepRead._pref(enabledKey, false) === true; },
		defaultConfigText() {
			const url = DeepRead._pref("extensions.deepread.mcp.url", DEFAULT_URL);
			return JSON.stringify({ mcpServers: { zotero: { url } } }, null, 2);
		},
		configText() { return DeepRead._pref(serversKey, this.defaultConfigText()); },
		setEnabled(enabled) {
			if (enabled) parseConfig(this.configText());
			DeepRead._setPref(enabledKey, !!enabled);
			if (this.isEnabled() !== !!enabled) throw new Error(t("无法保存 MCP 开关", "Could not save the MCP setting"));
			this._active();
		},
		saveConfig(text) {
			parseConfig(text);
			const canonical = JSON.stringify(JSON.parse(text), null, 2);
			DeepRead._setPref(serversKey, canonical);
			if (DeepRead._pref(serversKey, null) !== canonical) throw new Error(t("无法保存 MCP 配置", "Could not save MCP configuration"));
			this._active();
		},
		_active() {
			try {
				return reconcile(this.isEnabled() ? parseConfig(this.configText()).filter(c => c.enabled) : []);
			} catch (e) { reconcile([]); throw e; }
		},
		statuses() {
			const enabled = this.isEnabled();
			const all = parseConfig(this.configText());
			return all.map(c => {
				const client = clients.get(c.id);
				return { id: c.id, state: !enabled || !c.enabled ? "disabled" : client?.state || "unqueried", count: client?.tools.size || 0 };
			});
		},
		async listTools() {
			const active = this._active();
			const results = await Promise.allSettled(active.map(c => c.discover()));
			const current = this._active();
			return results.flatMap((r, i) => r.status === "fulfilled" && current.includes(active[i]) ? r.value : []);
		},
		async callTool(spec, args) {
			const active = this._active();
			if (typeof spec === "string") {
				// Preserve the original string API for callers using the published alias.
				const available = await this.listTools();
				spec = available.find(tool => tool.name === spec);
			}
			const client = active.find(c => c.config.id === spec?.server);
			if (!client || !spec) throw unavailable();
			return client.call(spec, args);
		},
		reset() { reconcile([]); }
	};
})();
