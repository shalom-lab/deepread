/**
 * Zotero 原子 Tool 层
 * 安全模型：执行范围锁定在当次选中的 itemID / attachmentID 白名单；
 * 越权 ID 直接拒绝。删/挪为高确认级别（默认不勾选，由上层 UI 控制）。
 */
(function () {
	if (typeof DeepRead === "undefined") return;

	const FIELD_ALLOW = new Set([
		"title",
		"date",
		"DOI",
		"url",
		"publicationTitle",
		"journalAbbreviation",
		"abstractNote",
		"extra",
		"volume",
		"issue",
		"pages",
		"language"
	]);

	const HIGH_CONFIRM = new Set(["delete_attachment", "move_attachment"]);

	function ok(data) {
		return Object.assign({ ok: true }, data || {});
	}
	function fail(error, data) {
		return Object.assign({ ok: false, error: String(error || "unknown") }, data || {});
	}

	function toIdSet(list) {
		const s = new Set();
		(list || []).forEach(x => {
			const n = Number(x);
			if (!isNaN(n) && n > 0) s.add(n);
		});
		return s;
	}

	DeepRead.AtomTools = {
		HIGH_CONFIRM,

		/**
		 * 从选中顶层条目构建执行白名单（含其子 PDF/Word 附件）。
		 * 笔记 / HTML 等不进入 attachmentIDs。
		 */
		buildScopeFromItems(items) {
			const itemIDs = new Set();
			const attachmentIDs = new Set();
			for (const raw of (items || [])) {
				const top = (DeepRead._getTopLevelItem && DeepRead._getTopLevelItem(raw)) || raw;
				if (!top || !top.id) continue;
				if (top.isRegularItem && top.isRegularItem()) {
					itemIDs.add(Number(top.id));
					const ids = top.getAttachments ? top.getAttachments() : [];
					for (const aid of ids) {
						const att = Zotero.Items.get(aid);
						if (!att) continue;
						if (DeepRead._isSupportedAttachment && !DeepRead._isSupportedAttachment(att)) continue;
						attachmentIDs.add(Number(att.id));
					}
				} else if (top.isAttachment && top.isAttachment()) {
					attachmentIDs.add(Number(top.id));
					if (top.parentItemID) itemIDs.add(Number(top.parentItemID));
				}
			}
			return {
				itemIDs,
				attachmentIDs,
				itemIDList: [...itemIDs],
				attachmentIDList: [...attachmentIDs]
			};
		},

		isHighConfirm(toolId) {
			return HIGH_CONFIRM.has(String(toolId || ""));
		},

		/**
		 * 硬门槛：步骤涉及的 ID 必须落在 scope 内。
		 */
		assertArgsInScope(toolId, args, scope) {
			if (!scope || !scope.itemIDs || !scope.attachmentIDs) {
				return fail("missing execution scope");
			}
			const a = args || {};
			const tool = String(toolId || "");

			const needItem = (id, label) => {
				const n = Number(id);
				if (!scope.itemIDs.has(n)) {
					return fail("out-of-scope " + (label || "itemID") + ": " + id, {
						itemID: n,
						allowedItemIDs: scope.itemIDList
					});
				}
				return null;
			};
			const needAtt = (id) => {
				const n = Number(id);
				if (!scope.attachmentIDs.has(n)) {
					return fail("out-of-scope attachmentID: " + id, {
						attachmentID: n,
						allowedAttachmentIDs: scope.attachmentIDList
					});
				}
				return null;
			};

			if (tool === "set_item_title" || tool === "set_item_field") {
				return needItem(a.itemID, "itemID");
			}
			if (tool === "rename_attachment" || tool === "delete_attachment") {
				return needAtt(a.attachmentID);
			}
			if (tool === "move_attachment") {
				const e1 = needAtt(a.attachmentID);
				if (e1) return e1;
				return needItem(a.toItemID, "toItemID");
			}
			return fail("unknown tool for scope check: " + tool);
		},

		/** 过滤/标注越权步骤，不执行它们 */
		filterStepsToScope(steps, scope) {
			const kept = [];
			const rejected = [];
			for (const step of (steps || [])) {
				const gate = this.assertArgsInScope(step.tool, step.args, scope);
				if (gate) {
					rejected.push(Object.assign({
						skipped: true,
						rejected: true,
						tool: step.tool,
						args: step.args
					}, gate));
					continue;
				}
				const copy = Object.assign({}, step);
				if (this.isHighConfirm(step.tool) && copy.selected === undefined) {
					copy.selected = false; // 删/挪默认不勾选
				}
				kept.push(copy);
			}
			return { kept, rejected };
		},

		async set_item_title({ itemID, title, officialSource, requireOfficial }) {
			try {
				const item = Zotero.Items.get(itemID);
				if (!item) return fail("item missing", { itemID });
				const next = String(title || "").trim();
				if (!next) return fail("empty title", { itemID });
				if (requireOfficial !== false) {
					if (!officialSource || !String(officialSource).trim()) {
						return fail("refuse title without officialSource", { itemID });
					}
				}
				const prev = item.getField("title") || "";
				item.setField("title", next);
				await item.saveTx();
				return ok({ itemID, field: "title", from: prev, to: next, officialSource: officialSource || "" });
			} catch (e) {
				return fail(e.message || e, { itemID });
			}
		},

		async rename_attachment({ attachmentID, newName }) {
			try {
				const att = Zotero.Items.get(attachmentID);
				if (!att) return fail("attachment missing", { attachmentID });
				if (!att.isAttachment || !att.isAttachment()) {
					return fail("not an attachment", { attachmentID });
				}
				const safe = DeepRead.OrganizeRenameTool
					? DeepRead.OrganizeRenameTool.fsSafe(newName)
					: String(newName || "").replace(/[\\/:*?"<>|]/g, "").trim();
				if (!safe) return fail("empty newName", { attachmentID });

				const prev = (att.getField && att.getField("title")) || "";
				let fileRenamed = false;
				if (typeof att.renameAttachmentFile === "function") {
					try {
						fileRenamed = !!(await att.renameAttachmentFile(safe));
					} catch (e) {
						fileRenamed = false;
					}
				}
				att.setField("title", safe);
				await att.saveTx();
				return ok({
					attachmentID,
					from: prev,
					to: safe,
					fileRenamed,
					note: fileRenamed ? "" : "display title updated; file rename may have failed"
				});
			} catch (e) {
				return fail(e.message || e, { attachmentID });
			}
		},

		async delete_attachment({ attachmentID, trash }) {
			try {
				const att = Zotero.Items.get(attachmentID);
				if (!att) return fail("attachment missing", { attachmentID });
				if (!att.isAttachment || !att.isAttachment()) {
					return fail("not an attachment", { attachmentID });
				}
				const parentID = att.parentItemID || null;
				const title = (att.getField && att.getField("title")) || "";
				if (trash === false) {
					await Zotero.Items.erase(att.id);
				} else {
					att.deleted = true;
					await att.saveTx();
				}
				return ok({ attachmentID, parentID, title, trashed: trash !== false });
			} catch (e) {
				return fail(e.message || e, { attachmentID });
			}
		},

		async move_attachment({ attachmentID, toItemID }) {
			try {
				const att = Zotero.Items.get(attachmentID);
				const parent = Zotero.Items.get(toItemID);
				if (!att) return fail("attachment missing", { attachmentID });
				if (!parent) return fail("target item missing", { toItemID });
				if (!att.isAttachment || !att.isAttachment()) {
					return fail("not an attachment", { attachmentID });
				}
				if (!parent.isRegularItem || !parent.isRegularItem()) {
					return fail("target must be regular item", { toItemID });
				}
				if (att.libraryID !== parent.libraryID) {
					return fail("cross-library move not supported", { attachmentID, toItemID });
				}
				const fromParent = att.parentItemID || null;
				att.parentID = parent.id;
				await att.saveTx();
				return ok({ attachmentID, fromParentID: fromParent, toItemID: parent.id });
			} catch (e) {
				return fail(e.message || e, { attachmentID, toItemID });
			}
		},

		async set_item_field({ itemID, field, value }) {
			try {
				const item = Zotero.Items.get(itemID);
				if (!item) return fail("item missing", { itemID });
				const f = String(field || "");
				if (!FIELD_ALLOW.has(f)) {
					return fail("field not allowed: " + f, { itemID, field: f, allow: [...FIELD_ALLOW] });
				}
				if (f === "title") {
					return fail("use set_item_title for title", { itemID });
				}
				const prev = item.getField(f) || "";
				item.setField(f, value == null ? "" : String(value));
				await item.saveTx();
				return ok({ itemID, field: f, from: prev, to: String(value == null ? "" : value) });
			} catch (e) {
				return fail(e.message || e, { itemID, field });
			}
		},

		list() {
			return [
				{ id: "set_item_title", risk: "medium", confirm: "normal", desc: "Set item title (official source required by default)" },
				{ id: "rename_attachment", risk: "medium", confirm: "normal", desc: "Rename attachment file/title" },
				{ id: "delete_attachment", risk: "high", confirm: "explicit", desc: "Trash/erase attachment (default unchecked)" },
				{ id: "move_attachment", risk: "high", confirm: "explicit", desc: "Move attachment (default unchecked; both IDs in scope)" },
				{ id: "set_item_field", risk: "medium", confirm: "normal", desc: "Set whitelisted item field" }
			];
		},

		async run(toolId, args, scope) {
			const fn = this[toolId];
			if (typeof fn !== "function" || ["list", "run", "runPlan", "buildScopeFromItems", "assertArgsInScope", "filterStepsToScope", "isHighConfirm"].includes(toolId)) {
				return fail("unknown atom tool: " + toolId);
			}
			if (scope) {
				const gate = this.assertArgsInScope(toolId, args, scope);
				if (gate) return gate;
			}
			return await fn.call(this, args || {});
		},

		/**
		 * steps: [{ tool, args, selected? }]
		 * scope: buildScopeFromItems(...) 结果；强烈建议必传
		 */
		async runPlan(steps, scope) {
			const results = [];
			if (!scope) {
				return [fail("runPlan requires scope (selected item/attachment whitelist)")];
			}
			const { kept, rejected } = this.filterStepsToScope(steps, scope);
			rejected.forEach(r => results.push(r));

			for (const step of kept) {
				if (step && step.selected === false) {
					results.push({
						skipped: true,
						tool: step.tool,
						reason: this.isHighConfirm(step.tool) ? "unchecked-high-confirm" : "unchecked"
					});
					continue;
				}
				const r = await this.run(step.tool, step.args || {}, scope);
				results.push(Object.assign({ tool: step.tool }, r));
			}
			return results;
		},

		/** 序列化 scope，便于打进 prompt / log */
		scopeForPrompt(scope) {
			return {
				allowedItemIDs: (scope && scope.itemIDList) || [],
				allowedAttachmentIDs: (scope && scope.attachmentIDList) || []
			};
		},

		_toIdSet: toIdSet
	};

	if (!DeepRead.ToolRegistry) DeepRead.ToolRegistry = {};
	DeepRead.AtomTools.list().forEach(t => {
		DeepRead.ToolRegistry[t.id] = {
			id: t.id,
			risk: t.risk,
			confirm: t.confirm,
			run: (args, scope) => DeepRead.AtomTools.run(t.id, args, scope)
		};
	});
})();
