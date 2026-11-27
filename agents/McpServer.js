/* Export registered native tools through the Zotero MCP host. Only Zotero's
 * own review UI can approve an external request to apply a prepared plan. */
(function () {
	const pref = "extensions.deepread.mcp.exportEnabled";
	const pluginID = "deepread@zotero.org";
	const hostID = "zotero-mcp-plugin@autoagent.my";
	const planLifetime = 5 * 60 * 1000;
	const registrations = new Map();
	const plans = new Map();
	const receipts = new Map();
	let api, running = false, watching = false, retryTimer, reviewing, registrationError = "";
	let activeCalls = 0;

	const t = (zh, en) => DeepRead._locale === "zh" ? zh : en;
	const enabled = () => DeepRead._pref(pref, false) === true;
	const host = () => {
		const value = Zotero.ZoteroMCP?.api;
		return ["registerTool", "unregisterTool", "unregisterAllTools", "getRegisteredTools"].every(k => typeof value?.[k] === "function") ? value : null;
	};
	const applyTool = {
		name: "deepread_apply_plan",
		description: "Ask the local Zotero user to approve selected rows of a single-use DeepRead plan. Returns immediately. Use deepread_plan_result with the same planId to check the outcome.",
		inputSchema: { type: "object", properties: {
			planId: { type: "string", minLength: 1, maxLength: 64 },
			rowIds: { type: "array", items: { type: "string", minLength: 1, maxLength: 256 }, minItems: 1, uniqueItems: true }
		}, required: ["planId", "rowIds"], additionalProperties: false }
	};
	const resultTool = {
		name: "deepread_plan_result", description: "Read the status and final receipt of a submitted DeepRead plan. The receipt is retained for five minutes after completion.",
		inputSchema: { type: "object", required: ["planId"], additionalProperties: false, properties: { planId: { type: "string", minLength: 1, maxLength: 64 } } }
	};

	function available(spec) {
		return spec === applyTool || spec === resultTool || (DeepRead.ToolRegistry[spec.name] === spec && spec.floatingChat &&
			typeof spec.run === "function" && DeepRead.ToolRuntime.enabled(spec) &&
			(typeof spec.apply === "function" || spec.annotations?.readOnlyHint === true));
	}

	function assertCurrent(entry) {
		if (!running || registrations.get(entry.spec.name) !== entry || !enabled() || host() !== api || !available(entry.spec)) {
			throw new Error("DeepRead MCP tool is no longer enabled");
		}
	}

	function drop(id) {
		const state = plans.get(id);
		if (state) clearTimeout(state.timeout);
		plans.delete(id);
	}

	function prunePlans() {
		for (const [id, state] of plans) {
			if (state.expires <= Date.now() || state.window.closed || registrations.get(state.entry.spec.name) !== state.entry) drop(id);
		}
	}

	function prepare(entry, plan, window) {
		const rows = plan.rows.map(({ id, name, detail }) => ({ id: String(id), name, detail }));
		if (!rows.length) return { planId: null, rows, notes: plan.notes || [] };
		if (new Set(rows.map(r => r.id)).size !== rows.length) throw new Error("Duplicate change ID in prepared plan");
		prunePlans();
		if (plans.size >= 32) throw new Error("Too many outstanding DeepRead plans");
		const id = window.crypto.randomUUID();
		plans.set(id, { entry, window, plan, expires: Date.now() + planLifetime, timeout: setTimeout(() => drop(id), planLifetime) });
		return { planId: id, rows, notes: plan.notes || [], expiresInSeconds: planLifetime / 1000 };
	}

	function beginApply(args) {
		prunePlans();
		const state = plans.get(args.planId);
		if (!state || state.window.closed) throw new Error("DeepRead plan expired, consumed or unknown");
		assertCurrent(state.entry);
		const requested = new Set(args.rowIds);
		const rows = state.plan.rows.filter(row => requested.has(String(row.id)));
		if (!requested.size || rows.length !== requested.size || requested.size !== args.rowIds.length) throw new Error("Invalid change IDs");
		if (reviewing) throw new Error("Another external DeepRead review is pending");
		if (receipts.size >= 64) throw new Error("Too many pending or recent DeepRead receipts");
		drop(args.planId);
		reviewing = state;
		state.awaiting = true;
		const receipt = { status: "awaiting_local_review" };
		receipts.set(args.planId, receipt);
		void finishApply(state, rows, receipt).catch(e => {
			receipt.status = "error";
			receipt.error = String(e.message || e);
		}).finally(() => {
			if (receipts.get(args.planId) === receipt) receipt.timeout = setTimeout(() => receipts.delete(args.planId), planLifetime);
		});
		return { planId: args.planId, status: receipt.status };
	}

	async function finishApply(state, rows, receipt) {
		const timer = setTimeout(() => {
			if (reviewing === state && state.awaiting) DeepRead.ToolRuntime.cancelReview();
		}, Math.max(0, state.expires - Date.now()));
		try {
			const picked = await DeepRead.ToolRuntime.review(state.window, rows,
				t("外接 MCP 请求修改 · ", "External MCP change request · ") + state.entry.spec.name);
			state.awaiting = false;
			assertCurrent(state.entry);
			receipt.status = "cancelled";
			if (!picked?.size || state.window.closed || Date.now() >= state.expires) return;
			const approved = new Set(rows.filter(row => picked.has(row.id)).map(row => row.id));
			if (!approved.size) return;
			receipt.status = "applying";
			receipt.result = await DeepRead.ToolRuntime.applyReviewed(state.entry.spec, state.plan, approved, () => {
				assertCurrent(state.entry);
				if (state.window.closed || state.expires <= Date.now()) throw new Error("DeepRead plan expired");
			});
			receipt.status = "reviewed";
		} finally {
			clearTimeout(timer);
			if (reviewing === state) reviewing = null;
		}
	}

	async function invoke(entry, args = {}) {
		assertCurrent(entry);
		const spec = entry.spec;
		const runtime = DeepRead.ToolRuntime;
		if (activeCalls >= 8) throw new Error("Too many concurrent DeepRead calls");
		activeCalls++;
		const started = Date.now();
		let status = "error";
		try {
			runtime.validate({ ...spec, inputSchema: { additionalProperties: false, ...spec.inputSchema } }, args);
			let result;
			if (spec === applyTool) {
				result = beginApply(args);
				status = result.status;
			} else if (spec === resultTool) {
				const receipt = receipts.get(args.planId);
				if (!receipt) throw new Error("Unknown or expired DeepRead receipt");
				result = { status: receipt.status, result: receipt.result, error: receipt.error };
				status = "ok";
			} else {
				const window = Zotero.getMainWindow();
				if (!window || window.closed) throw new Error("Zotero main window is unavailable");
				const message = await runtime.capture(window);
				assertCurrent(entry);
				const output = await spec.run(args, message);
				assertCurrent(entry);
				result = spec.apply ? prepare(entry, output, window) : output;
				status = spec.apply ? "prepared" : "ok";
			}
			return result;
		} finally {
			activeCalls--;
			runtime.recordTool(spec, status, Date.now() - started);
		}
	}

	function detach() {
		registrations.clear();
		for (const id of plans.keys()) drop(id);
		for (const receipt of receipts.values()) clearTimeout(receipt.timeout);
		receipts.clear();
		if (reviewing?.awaiting) DeepRead.ToolRuntime.cancelReview();
		const old = api;
		api = null;
		if (old) {
			try { old.unregisterAllTools(pluginID); }
			catch (e) { DeepRead.log("Could not remove DeepRead MCP exports: " + e.message); }
		}
	}

	function refresh() {
		if (!running) return;
		const current = enabled() && host();
		if (current !== api) detach();
		api = current || null;
		registrationError = "";
		if (!api) return;
		try {
			const specs = Object.values(DeepRead.ToolRegistry).filter(available);
			if (specs.some(s => s.apply)) specs.push(applyTool, resultTool);
			const desired = new Map(specs.map(s => [s.name, s]));
			const owned = new Set(api.getRegisteredTools().filter(r => r.pluginID === pluginID).map(r => r.name));
			for (const name of owned) {
				if (!desired.has(name) || !registrations.has(name) || registrations.get(name).spec !== desired.get(name)) {
					api.unregisterTool(name);
					owned.delete(name);
				}
			}
			for (const name of registrations.keys()) if (!owned.has(name)) registrations.delete(name);
			prunePlans();
			if (reviewing?.awaiting && !available(reviewing.entry.spec)) DeepRead.ToolRuntime.cancelReview();
			for (const spec of specs) {
				if (owned.has(spec.name)) continue;
				const entry = { spec };
				try {
					api.registerTool({ name: spec.name,
						description: spec.apply ? spec.description + " This external call only returns a preview. Request local review with deepread_apply_plan." : spec.description,
						inputSchema: spec.inputSchema, pluginID, handler: args => invoke(entry, args) });
					registrations.set(spec.name, entry);
				} catch (e) { registrationError = spec.name + ": " + e.message; }
			}
		} catch (e) {
			detach();
			registrationError = e.message;
		}
	}

	const observer = {
		startup({ id }) { if (id === hostID) refresh(); },
		shutdown({ id }) { if (id === hostID) detach(); }
	};

	DeepRead.McpServer = {
		isEnabled: enabled,
		setEnabled(value) {
			DeepRead._setPref(pref, !!value);
			if (enabled() !== !!value) throw new Error("Could not save MCP export setting");
			refresh();
		},
		refresh,
		start() {
			if (running) return;
			running = true;
			if (Zotero.Plugins?.addObserver && Zotero.Plugins?.removeObserver) {
				Zotero.Plugins.addObserver(observer);
				watching = true;
			} else {
				const poll = () => {
					if (!running) return;
					if (enabled()) refresh();
					retryTimer = setTimeout(poll, 5000);
				};
				retryTimer = setTimeout(poll, 5000);
			}
			refresh();
		},
		stop() {
			running = false;
			if (watching) Zotero.Plugins.removeObserver(observer);
			watching = false;
			clearTimeout(retryTimer);
			detach();
		},
		exportsName(name) { return registrations.has(name); },
		status() {
			return { enabled: enabled(), hostAvailable: !!host(), count: registrations.size, error: registrationError };
		}
	};
})();
