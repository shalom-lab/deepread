/* Shared boundaries for native chat, tool testing and MCP requests. */
(function () {
	const t = (zh, en) => DeepRead._locale === "zh" ? zh : en;
	const disabledPref = "extensions.deepread.tools.disabled";
	const latestPref = "extensions.deepread.tools.recent";
	const identity = tool => JSON.stringify(tool.server ? [tool.server, tool.mcpName] : [tool.name]);
	let pendingReview;
	let pendingWrite = Promise.resolve(), accepting = true;

	function readList(key) {
		const data = JSON.parse(DeepRead._pref(key, "[]"));
		if (!Array.isArray(data)) throw new Error(t("工具设置格式无效", "Invalid tool settings"));
		return data;
	}

	function capture(win) {
		const pane = win?.ZoteroPane;
		let selection = null, collections = null, libraryID = null, reader = null;
		try {
			selection = pane.getSelectedItems().map(item => ({
				itemID: item.id, key: item.key, libraryID: item.libraryID, itemType: item.itemType,
				title: item.getDisplayTitle() || "", parentItemID: item.parentItemID || undefined,
				attachmentIDs: item.isRegularItem() ? item.getAttachments() : undefined
			}));
		} catch { /* Selection is unavailable in some windows. */ }
		try {
			const list = pane.getSelectedCollections?.() ?? pane.collectionsView?.getSelectedCollections?.() ?? [pane.getSelectedCollection?.()].filter(Boolean);
			collections = list.map(c => ({ collectionID: c.id, key: c.key, libraryID: c.libraryID, name: c.name }));
		} catch { /* Preserve the distinction between unavailable and empty. */ }
		try { libraryID = pane.getSelectedLibraryID(); } catch { /* no library pane */ }
		try { reader = DeepRead.ReaderTools?.capture(win) ?? null; } catch { /* no active reader */ }
		return { ts: Date.now(), selection, collections, libraryID, reader };
	}

	function selectedItem(message, itemID) {
		const entry = message?.selection?.find(s => s.itemID === itemID);
		const item = entry && Zotero.Items.get(itemID);
		if (!item || item.deleted || !entry.key || item.key !== entry.key || item.libraryID !== entry.libraryID ||
			(item.parentItemID || null) !== (entry.parentItemID || null)) {
			throw new Error(t("条目不在发送时的选区内，或已变更", "Item outside the captured selection or changed") + " #" + itemID);
		}
		return item;
	}

	function libraryID(message) {
		const id = message?.libraryID;
		if (Number.isSafeInteger(id) && id > 0) return id;
		const ids = new Set([...(message?.selection || []), ...(message?.collections || [])].map(r => r.libraryID));
		const [only] = ids;
		if (ids.size === 1 && Number.isSafeInteger(only) && only > 0) return only;
		throw new Error(t("请先选中一个文献库", "Select a library first"));
	}

	function assertEditable(obj) {
		if (!obj || obj.deleted || !Zotero.Libraries.get(obj.libraryID)?.editable || obj.isEditable?.() === false) {
			throw new Error(t("对象已删除或没有写入权限", "Object unavailable or read-only"));
		}
		return obj;
	}

	function stableJSON(value) {
		return JSON.stringify(value, (_, entry) => {
			if (!entry || typeof entry !== "object" || Array.isArray(entry)) return entry;
			return Object.fromEntries(Object.keys(entry).sort().map(key => [key, entry[key]]));
		});
	}

	// Validate the JSON Schema vocabulary used by the bundled tool declarations.
	// External servers can publish richer schemas and validate those themselves.
	function validate(spec, args) {
		function check(value, schema, path) {
			const invalid = () => { throw new Error(t("无效工具参数", "Invalid tool argument") + " · " + path); };
			if (schema.enum && !schema.enum.includes(value)) invalid();
			switch (schema.type) {
				case "object":
					if (!value || Array.isArray(value) || typeof value !== "object") invalid();
					for (const k of schema.required || []) if (!Object.hasOwn(value, k)) invalid();
					for (const k of Object.keys(value)) {
						const prop = Object.hasOwn(schema.properties || {}, k) && schema.properties[k];
						if (prop) check(value[k], prop, path + "." + k);
						else if (schema.additionalProperties === false) invalid();
					}
					break;
				case "array":
					if (!Array.isArray(value) || value.length < (schema.minItems ?? 0) || value.length > (schema.maxItems ?? 10000)) invalid();
					if (schema.items) value.forEach((entry, i) => check(entry, schema.items, path + "[" + i + "]"));
					if (schema.uniqueItems && new Set(value.map(stableJSON)).size !== value.length) invalid();
					break;
				case "string":
					if (typeof value !== "string" || value.length < (schema.minLength ?? 0) || value.length > (schema.maxLength ?? Infinity)) invalid();
					if (schema.pattern && !new RegExp(schema.pattern).test(value)) invalid();
					break;
				case "integer": case "number":
					if (!Number.isFinite(value) || (schema.type === "integer" && !Number.isSafeInteger(value)) ||
						value < (schema.minimum ?? -Infinity) || value > (schema.maximum ?? Infinity)) invalid();
					break;
				case "boolean": if (typeof value !== "boolean") invalid(); break;
			}
		}
		check(args, spec.server ? { type: "object" } : spec.inputSchema || { type: "object" }, spec.name);
		return args;
	}

	async function applyRows(plan, picked) {
		if (plan.reviewed) throw new Error(t("这份方案已处理", "Plan already reviewed"));
		plan.reviewed = true;
		const lines = [...(plan.notes || [])];
		for (const row of plan.rows) {
			let result;
			try {
				result = picked.has(row.id) ? await row.execute() : t("未勾选", "Unchecked");
			} catch (e) {
				result = t("未完成", "Not completed") + " · " + (e.message || e);
			}
			lines.push("• " + row.name + " · " + row.detail + "\n  " + result);
		}
		return lines.join("\n");
	}

	// Local confirmation for callers outside of the floating conversation.
	function review(win, rows, title) {
		if (!rows.length || !win?.document || win.closed) return Promise.resolve(null);
		if (pendingReview) throw new Error(t("另一项操作正在等待确认", "Another request is waiting for review"));
		const doc = win.document;
		const element = name => doc.createElementNS("http://www.w3.org/1999/xhtml", name);
		const dialog = element("dialog");
		dialog.setAttribute("aria-label", title);
		dialog.style.cssText = "max-width:min(580px,90vw);max-height:78vh;overflow:auto;border:1px solid #999;border-radius:8px;padding:16px;font:menu;color:CanvasText;background:Canvas";
		const heading = element("h3");
		heading.textContent = title;
		dialog.appendChild(heading);
		const checks = rows.map(row => {
			const label = element("label");
			label.style.cssText = "display:block;white-space:pre-wrap;overflow-wrap:anywhere;margin-block:8px";
			const check = element("input");
			check.type = "checkbox"; check.checked = row.selected !== false;
			label.append(check, doc.createTextNode(" " + row.name + " · " + row.detail));
			dialog.appendChild(label);
			return check;
		});
		const cancel = element("button"), apply = element("button");
		cancel.textContent = t("取消", "Cancel");
		apply.style.marginInlineStart = "8px";
		const update = () => {
			const n = checks.filter(c => c.checked).length;
			apply.disabled = !n;
			apply.textContent = t("执行所选 " + n + " 项", "Apply selected (" + n + ")");
		};
		dialog.addEventListener("change", update); update();
		dialog.append(cancel, apply);
		doc.documentElement.appendChild(dialog);
		return new Promise((resolve, reject) => {
			const done = value => {
				if (pendingReview !== dismissed) return;
				pendingReview = null;
				win.removeEventListener("pagehide", dismissed);
				win.removeEventListener("unload", dismissed);
				dialog.remove();
				resolve(value);
			};
			const dismissed = () => done(null);
			pendingReview = dismissed;
			cancel.onclick = dismissed;
			dialog.oncancel = dismissed;
			dialog.onclose = dismissed;
			win.addEventListener("pagehide", dismissed);
			win.addEventListener("unload", dismissed);
			apply.onclick = () => done(new Set(rows.filter((_, i) => checks[i].checked).map(r => r.id)));
			try { dialog.showModal(); cancel.focus(); }
			catch (e) { pendingReview = null; win.removeEventListener("pagehide", dismissed); win.removeEventListener("unload", dismissed); dialog.remove(); reject(e); }
		});
	}

	DeepRead.ToolRuntime = {
		t, capture, selectedItem, libraryID, assertEditable, validate, stableJSON, applyRows, review,
		applyReviewed(tool, plan, picked, stillAuthorized) {
			const allowed = new Set(picked);
			const run = pendingWrite.then(() => {
				if (!accepting || !this.enabled(tool)) throw new Error(t("这项工具操作已停用", "Tool operation disabled"));
				stillAuthorized?.();
				return tool.apply(plan, allowed);
			});
			pendingWrite = run.catch(() => {});
			return run;
		},
		shutdown() { accepting = false; this.cancelReview(); return pendingWrite; },
		cancelReview() { pendingReview?.(); },
		enabled(tool) { return !readList(disabledPref).includes(identity(tool)); },
		setEnabled(tool, enabled) {
			const keys = new Set(readList(disabledPref)), key = identity(tool);
			if (enabled) keys.delete(key); else keys.add(key);
			DeepRead._setPref(disabledPref, JSON.stringify([...keys]));
			if (this.enabled(tool) !== enabled) throw new Error(t("未能保存工具设置", "Could not save tool setting"));
			DeepRead.McpServer?.refresh?.();
		},
		recordTool(tool, status, elapsedMs) {
			try {
				const key = identity(tool);
				const entries = readList(latestPref).filter(r => r.key !== key);
				entries.unshift({ key, status, elapsedMs: Math.max(0, Math.round(elapsedMs)), at: Date.now() });
				DeepRead._setPref(latestPref, JSON.stringify(entries.slice(0, 100)));
			} catch { /* Telemetry must not interrupt a completed operation. */ }
		},
		lastCall(tool) { return readList(latestPref).find(r => r.key === identity(tool)); }
	};
})();
