/**
 * Zotero MCP（Streamable HTTP）客户端
 * 默认 http://127.0.0.1:23120/mcp ，可用 extensions.deepread.mcp.url 覆盖
 * 工具名和参数以对方 tools/list 为准，这里不写死 Zotero 操作
 */
(function () {
	if (typeof DeepRead === "undefined") return;

	const DEFAULT_URL = "http://127.0.0.1:23120/mcp";

	DeepRead.Mcp = {
		_id: 0,
		_session: "",
		_ready: false,
		_tools: [],
		_byModelName: {},

		_tOffline(e) {
			const msg = e && e.message ? e.message : "";
			if (/abort|timeout|network|failed|refused/i.test(msg)) return "MCP 未连接";
			return msg || "MCP 未连接";
		},

		url() {
			const custom = DeepRead._pref && DeepRead._pref("extensions.deepread.mcp.url", "");
			const raw = custom ? String(custom).trim() : "";
			return raw || DEFAULT_URL;
		},

		reset() {
			this._ready = false;
			this._session = "";
			this._tools = [];
			this._byModelName = {};
		},

		_modelName(name) {
			let safe = String(name || "tool").replace(/[^a-zA-Z0-9_]/g, "_");
			if (/^[0-9]/.test(safe)) safe = "_" + safe;
			return (safe || "tool").slice(0, 64);
		},

		_slimSchema(schema) {
			const s = schema && typeof schema === "object" ? schema : {};
			const out = {
				type: s.type || "object",
				properties: s.properties && typeof s.properties === "object" ? s.properties : {}
			};
			if (Array.isArray(s.required) && s.required.length) out.required = s.required;
			return out;
		},

		async listTools() {
			if (this._ready && this._tools.length) return this._tools;
			await this.connect();
			return this._tools;
		},

		async connect() {
			this.reset();
			let lastError = null;
			for (const version of ["2025-03-26", "2024-11-05"]) {
				try {
					await this._rpc("initialize", {
						protocolVersion: version,
						capabilities: {},
						clientInfo: { name: "DeepRead", version: "0.11.17" }
					});
					try {
						await this._rpc("notifications/initialized", {}, true);
					} catch (e) { /* 有的服务对通知回空体 */ }
					const listed = await this._rpc("tools/list", {});
					const tools = (listed && listed.tools) || [];
					const used = new Set();
					this._tools = tools.map(t => {
						let modelName = this._modelName(t.name);
						while (used.has(modelName)) modelName = (modelName + "_").slice(0, 64);
						used.add(modelName);
						const spec = {
							name: modelName,
							mcpName: t.name,
							description: t.description || "",
							inputSchema: this._slimSchema(t.inputSchema),
							annotations: t.annotations || {}
						};
						this._byModelName[modelName] = spec;
						if (t.name && t.name !== modelName) this._byModelName[t.name] = spec;
						return spec;
					});
					this._ready = true;
					return this._tools;
				} catch (e) {
					lastError = e;
					this.reset();
				}
			}
			throw lastError || new Error("MCP 未连接");
		},

		async callTool(name, args) {
			if (!this._ready) await this.connect();
			const spec = this._byModelName[name];
			const mcpName = spec ? spec.mcpName : name;
			try {
				const result = await this._rpc("tools/call", {
					name: mcpName,
					arguments: args && typeof args === "object" ? args : {}
				});
				return this._resultText(result);
			} catch (e) {
				this.reset();
				throw e;
			}
		},

		_resultText(result) {
			if (result == null) return "";
			if (typeof result === "string") return result;
			const parts = Array.isArray(result.content) ? result.content : [];
			const text = parts.map(part => {
				if (!part) return "";
				if (typeof part === "string") return part;
				if (part.text) return String(part.text);
				return JSON.stringify(part);
			}).filter(Boolean).join("\n");
			if (text) return result.isError ? ("工具返回错误：\n" + text) : text;
			return JSON.stringify(result);
		},

		async _rpc(method, params, isNotify) {
			const body = { jsonrpc: "2.0", method };
			if (!isNotify) body.id = ++this._id;
			if (params && Object.keys(params).length) body.params = params;
			const headers = {
				"Content-Type": "application/json",
				"Accept": "application/json, text/event-stream",
				"MCP-Protocol-Version": "2025-03-26"
			};
			if (this._session) headers["Mcp-Session-Id"] = this._session;
			const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
			const timer = controller ? setTimeout(() => controller.abort(), 8000) : null;
			let response;
			try {
				response = await fetch(this.url(), {
					method: "POST",
					headers,
					body: JSON.stringify(body),
					signal: controller ? controller.signal : undefined
				});
			} catch (e) {
				throw new Error(this._tOffline(e));
			} finally {
				if (timer) clearTimeout(timer);
			}
			const sid = response.headers.get("mcp-session-id") || response.headers.get("Mcp-Session-Id");
			if (sid) this._session = sid;
			if (isNotify) {
				if (!response.ok && response.status !== 202) {
					const errText = await response.text();
					throw new Error("MCP " + response.status + " " + errText.slice(0, 240));
				}
				return null;
			}
			const ctype = (response.headers.get("content-type") || "").toLowerCase();
			const raw = await response.text();
			if (!response.ok) {
				throw new Error("MCP " + response.status + " " + raw.slice(0, 240));
			}
			const data = ctype.includes("text/event-stream") ? this._parseSse(raw) : JSON.parse(raw || "{}");
			if (data && data.error) {
				throw new Error(data.error.message || "MCP error");
			}
			return data && Object.prototype.hasOwnProperty.call(data, "result") ? data.result : data;
		},

		_parseSse(text) {
			const chunks = [];
			String(text || "").split(/\n/).forEach(line => {
				const trimmed = line.trim();
				if (!trimmed.startsWith("data:")) return;
				const payload = trimmed.slice(5).trim();
				if (!payload || payload === "[DONE]") return;
				try { chunks.push(JSON.parse(payload)); } catch (e) { /* ignore */ }
			});
			const hit = chunks.find(c => c && (c.result || c.error)) || chunks[chunks.length - 1];
			if (!hit) throw new Error("MCP 没有返回结果");
			return hit;
		}
	};
})();
