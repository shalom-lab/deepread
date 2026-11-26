/**
 * Zotero 原子 Tool 层（写库前仍应由上层提案 + 人工 OK）
 * - set_item_title
 * - rename_attachment
 * - delete_attachment
 * - move_attachment
 * - set_item_field（白名单字段）
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

	function ok(data) {
		return Object.assign({ ok: true }, data || {});
	}
	function fail(error, data) {
		return Object.assign({ ok: false, error: String(error || "unknown") }, data || {});
	}

	DeepRead.AtomTools = {
		/**
		 * 改条目标题。opts.requireOfficial === true 时必须带 officialSource。
		 */
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

		/** 重命名附件文件 + 显示名 */
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

		/** 删除附件（高危） */
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

		/** 附件换父条目（高危） */
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

		/** 白名单字段写入 */
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
				{ id: "set_item_title", risk: "medium", desc: "Set item title (official source required by default)" },
				{ id: "rename_attachment", risk: "medium", desc: "Rename attachment file/title" },
				{ id: "delete_attachment", risk: "high", desc: "Trash/erase attachment" },
				{ id: "move_attachment", risk: "high", desc: "Move attachment to another item" },
				{ id: "set_item_field", risk: "medium", desc: "Set whitelisted item field" }
			];
		},

		async run(toolId, args) {
			const fn = this[toolId];
			if (typeof fn !== "function" || toolId === "list" || toolId === "run" || toolId === "runPlan") {
				return fail("unknown atom tool: " + toolId);
			}
			return await fn.call(this, args || {});
		},

		/**
		 * 按序执行已确认的原子步骤。
		 * steps: [{ tool, args, selected? }]
		 */
		async runPlan(steps) {
			const results = [];
			for (const step of (steps || [])) {
				if (step && step.selected === false) {
					results.push({ skipped: true, tool: step.tool });
					continue;
				}
				const tool = step && step.tool;
				const args = (step && step.args) || {};
				const r = await this.run(tool, args);
				results.push(Object.assign({ tool }, r));
				// 高危失败不中断整批，继续后续（由上层汇总）
			}
			return results;
		}
	};

	if (!DeepRead.ToolRegistry) DeepRead.ToolRegistry = {};
	DeepRead.AtomTools.list().forEach(t => {
		DeepRead.ToolRegistry[t.id] = {
			id: t.id,
			risk: t.risk,
			run: (args) => DeepRead.AtomTools.run(t.id, args)
		};
	});
})();
