/* Preferences are also a local test client of the registered tool contracts. */
(function () {
	const R = DeepRead.ToolRuntime, { t } = R;
	const latest = new Map();
	const key = spec => JSON.stringify([spec.server || "", spec.mcpName || spec.name]);

	async function testTool(tool, args, win) {
		const check = () => {
			if (!R.enabled(tool) || (!tool.server && (!tool.floatingChat || DeepRead.ToolRegistry[tool.name] !== tool))) {
				throw new Error(t("工具未启用或仅供内部调用", "Tool disabled or internal"));
			}
		};
		check();
		R.validate(tool, args);
		const message = R.capture(win), start = Date.now();
		let status = "error";
		try {
			let result;
			if (tool.apply) {
				const plan = await tool.run(args, message);
				if (!plan.rows.length) result = [...plan.notes, t("没有变更", "No changes")].join("\n");
				else {
					const picked = await R.review(win, plan.rows, tool.name);
					if (!picked?.size) { status = "cancelled"; return t("已取消", "Cancelled"); }
					check();
					result = await R.applyReviewed(tool, plan, picked);
				}
			} else if (tool.server || tool.annotations?.readOnlyHint !== true) {
				const rows = [{ id: "test", name: tool.name, detail: JSON.stringify(args, null, 2), selected: tool.annotations?.destructiveHint !== true }];
				const picked = await R.review(win, rows, tool.server || tool.name);
				if (!picked?.has("test")) { status = "cancelled"; return t("已取消", "Cancelled"); }
				check();
				result = tool.server ? await DeepRead.Mcp.callTool(tool, args) : await tool.run(args, message);
			} else result = await tool.run(args, message);
			status = tool.apply ? "reviewed" : "ok";
			if (!tool.server && tool.name === "deepread_read_pdf" && result?.image) return result;
			return typeof result === "string" ? result : JSON.stringify(result, null, 2);
		} finally { R.recordTool(tool, status, Date.now() - start); }
	}

	DeepRead.ToolCenter = { testTool, mount(root) {
		const el = id => root.querySelector('[data-tools="' + id + '"]');
		const doc = root.ownerDocument, list = el("list"), bridge = DeepRead.McpServer;
		const create = name => doc.createElementNS("http://www.w3.org/1999/xhtml", name);
		let rows = [], state = [], generation = 0, testing = false;
		const selected = () => rows.find(r => key(r) === list.value);
		function status() {
			const info = bridge.status();
			el("export").checked = info.enabled;
			el("host").textContent = !info.enabled ? "" : info.error || (info.hostAvailable
				? t("已对外注册 ", "Exported tools · ") + info.count : t("等待本机 Zotero MCP 插件", "Waiting for the Zotero MCP plugin"));
		}
		function online(tool) { return !tool.server || state.some(s => s.id === tool.server && s.state === "online"); }
		function paint() {
			const tool = selected();
			if (!tool) return;
			const internal = !tool.server && !tool.floatingChat;
			const last = R.lastCall(tool);
			const about = (DeepRead._locale === "zh" && tool.descriptionZh) || tool.description || "";
			const risk = tool.risk || (tool.apply ? "review" : tool.annotations?.readOnlyHint && !tool.server ? "low" : "unknown");
			const policy = internal ? t("内部步骤", "Internal") : tool.apply || tool.server && DeepRead.SidebarChat._needsConfirm({ name: tool.name }, [tool])
				? t("需核对", "Review required") : t("只读", "Read-only");
			el("info").textContent = [about, [tool.domain || tool.server, risk, policy].join(" · "), last ?
				t("最近调用 ", "Last call ") + new Date(last.at).toLocaleString() + " · " + last.status + " · " + last.elapsedMs + " ms" : ""].filter(Boolean).join("\n");
			el("schema").textContent = JSON.stringify(tool.inputSchema || {}, null, 2);
			el("enabled").checked = R.enabled(tool); el("enabled").disabled = internal;
			el("test").disabled = testing || internal || !R.enabled(tool) || !online(tool);
		}
		function fill() {
			const native = Object.values(DeepRead.ToolRegistry);
			const prev = list.value;
			const remote = DeepRead.Mcp.isEnabled() ? [...latest.values()].filter(tool => state.some(s => s.id === tool.server)) : [];
			rows = [...native, ...remote];
			list.replaceChildren();
			const groups = new Map();
			for (const spec of rows) {
				const source = spec.server || t("DeepRead 原生", "DeepRead native");
				if (!groups.has(source)) {
					const group = create("optgroup"); group.label = source; groups.set(source, group); list.appendChild(group);
				}
				const opt = create("option"); opt.value = key(spec); opt.textContent = spec.name; groups.get(source).appendChild(opt);
			}
			if (rows.some(r => key(r) === prev)) list.value = prev;
			const available = rows.filter(r => (r.server || r.floatingChat) && online(r) && R.enabled(r));
			el("counts").textContent = t("原生注册 ", "Registered native ") + native.length + t(" · 可用 ", " · Available ") + available.length +
				(R.lastOffered != null ? t(" · 上次提交模型 ", " · Last sent to model ") + R.lastOffered : "") +
				(state.length ? "\n" + state.map(s => s.id + " · " + s.state).join(" / ") : "");
			paint(); status();
		}
		async function refresh() {
			const token = ++generation;
			try {
				const tools = DeepRead.Mcp.isEnabled() ? await DeepRead.Mcp.listTools() : [];
				if (token !== generation) return;
				state = DeepRead.Mcp.statuses();
				for (const [id, spec] of latest) if (state.some(s => s.id === spec.server && s.state === "online")) latest.delete(id);
				for (const tool of tools) {
					if (!(DeepRead.Mcp.isLocalZoteroTool(tool) && bridge.exportsName(tool.mcpName))) latest.set(key(tool), tool);
				}
				fill();
			} catch (e) { el("result").textContent = e.message; }
		}
		el("export").onchange = () => { try { bridge.setEnabled(el("export").checked); } catch (e) { el("result").textContent = e.message; } status(); };
		el("center").ontoggle = () => { if (el("center").open) refresh(); };
		el("refresh").onclick = refresh;
		el("args").value = "{}";
		list.onchange = () => { el("args").value = "{}"; el("result").textContent = ""; paint(); };
		el("enabled").onchange = () => {
			try { R.setEnabled(selected(), el("enabled").checked); fill(); DeepRead.SidebarChat._refreshMcpStatus().catch(() => {}); }
			catch (e) { el("result").textContent = e.message; paint(); }
		};
		el("test").onclick = async () => {
			if (testing) return;
			const tool = selected(); testing = true; list.disabled = true; paint();
			try {
				const result = await testTool(tool, JSON.parse(el("args").value), Zotero.getMainWindow());
				if (result?.image) {
					const image = create("img");
					image.alt = "#" + result.attachmentID + " p." + result.page;
					image.style.maxWidth = "100%";
					image.src = "data:" + result.image.mimeType + ";base64," + result.image.data;
					el("result").replaceChildren(image);
				} else el("result").textContent = result;
			}
			catch (e) { el("result").textContent = e.message || String(e); }
			finally { testing = false; list.disabled = false; paint(); }
		};
		// Keep preferences fast to open. Discovery starts when the list is expanded.
		fill();
	} };
})();
