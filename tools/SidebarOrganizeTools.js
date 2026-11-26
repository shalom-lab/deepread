/* Tools available to the floating chat. Execution scope comes from the user
 * message captured by the host, never from arguments supplied by the model. */
(function () {
	const registry = DeepRead.ToolRegistry;
	const t = (zh, en) => DeepRead._locale === "zh" ? zh : en;

	function snapshotScope(selection, kind) {
		if (!selection?.length) throw new Error(t("发送时没有选中文献。", "No items were selected when this message was sent."));
		const items = new Map();
		const titles = new Set();
		const attachments = new Set();
		for (const s of selection) {
			const obj = Zotero.Items.get(s.itemID);
			if (!obj || obj.deleted || obj.key !== s.key || obj.libraryID !== s.libraryID) continue;
			if (obj.isRegularItem()) {
				items.set(obj.id, obj);
				titles.add(obj.id);
				for (const id of s.attachmentIDs || []) {
					const att = Zotero.Items.get(id);
					if (att && !att.deleted && att.parentItemID === obj.id) attachments.add(id);
				}
			} else if (obj.isAttachment() && DeepRead._isSupportedAttachment(obj) && obj.parentItemID === s.parentItemID) {
				const parent = obj.parentItemID && Zotero.Items.get(obj.parentItemID);
				if (!parent || parent.deleted || !parent.isRegularItem()) continue;
				items.set(parent.id, parent);
				attachments.add(obj.id);
			}
		}
		if (!items.size) throw new Error(t("选区中没有可整理的文献或子附件。", "The selection has no eligible items or child attachments."));
		const scope = DeepRead.AtomTools.buildScopeFromItems([...items.values()]);
		scope.attachmentIDList = scope.attachmentIDList.filter(id => kind !== "titles" && attachments.has(id));
		scope.attachmentIDs = new Set(scope.attachmentIDList);
		return { items: [...items.values()], scope, titles };
	}

	async function build(args, message) {
		const kind = args.kind ?? "all";
		if (!["all", "titles", "attachments"].includes(kind)) throw new Error("Unknown organize kind");
		const { items, scope, titles } = snapshotScope(message.selection, kind);
		const { proposals } = await DeepRead.OrganizeAgent.buildProposal({ items, scope, useModelForRoles: kind !== "titles" });
		const rows = [];
		const notes = [];
		for (const p of proposals) {
			p.titleSelected = kind !== "attachments" && titles.has(p.itemID) && p.fromTitle !== p.toTitle && !!p.official;
			if (kind !== "attachments" && titles.has(p.itemID) && !p.official) notes.push("#" + p.itemID + " · " + p.titleBlockedReason);
			const byID = new Map(p.attachments.map(a => [a.attachmentID, a]));
			for (const step of DeepRead.OrganizeRenameTool.proposalToAtomSteps(p)) {
				const a = byID.get(step.args.attachmentID);
				if (a && a.from === a.to && a.filename === a.to) continue;
				const from = a ? a.from : p.fromTitle;
				const to = a ? a.to : p.toTitle;
				const name = a ? t("附件改名", "Rename file") : t("文献标题", "Item title");
				const source = a
					? (a.modelClassified ? t("模型分类", "Model classification") : t("文件名规则", "Filename rule")) + " · " + (a.reason || a.role)
					: p.titleSource;
				const confidence = Math.round(100 * (a ? a.confidence : p.titleConfidence));
				const target = a ? a.attachmentID : p.itemID;
				const old = a && a.filename && a.filename !== from ? from + " / " + a.filename : from;
				rows.push({ id: step.tool + "-" + target, name, detail: "#" + target + " · " + old + " → " + to + " · " + source + " (" + confidence + "%)",
					step, from, filename: a?.filename, target, key: a ? a.key : p.key, parentKey: p.key,
					parentID: p.itemID, libraryID: p.libraryID });
			}
		}
		return { scope, rows, notes };
	}

	function stillCurrent(row) {
		const obj = Zotero.Items.get(row.target);
		const parent = Zotero.Items.get(row.parentID);
		if (!parent || parent.deleted || parent.key !== row.parentKey || parent.libraryID !== row.libraryID ||
			!obj || obj.deleted || obj.key !== row.key || obj.libraryID !== row.libraryID || obj.getField("title") !== row.from) return false;
		if (obj.isEditable?.() === false || Zotero.Libraries.get(row.libraryID)?.editable === false) return false;
		if (row.step.tool === "set_item_title") return obj.isRegularItem();
		return obj.parentItemID === parent.id && obj.attachmentFilename === row.filename &&
			DeepRead._isSupportedAttachment(obj) && !(obj.isStoredFileAttachment?.() && Zotero.Libraries.get(row.libraryID)?.filesEditable === false);
	}

	async function apply(plan, picked) {
		const lines = plan.notes.slice();
		for (const row of plan.rows) {
			if (!picked.has(row.id) || row.attempted) continue;
			row.attempted = true;
			try {
				if (!stillCurrent(row)) {
					lines.push(t("已跳过（对象已变更或不可写）", "Skipped (changed or read-only)") + " · " + row.detail);
					continue;
				}
				const [result] = await DeepRead.AtomTools.runPlan([row.step], plan.scope);
				const status = result.ok ? t("已执行", "Applied") : t("失败", "Failed") + " · " + result.error;
				const fileStatus = result.fileRenamed ? t(" · 文件已改名", " · file renamed") : "";
				const titleStatus = result.titleUpdated ? t(" · 显示标题已更新", " · display title updated") : "";
				lines.push(status + fileStatus + titleStatus + " · " + row.detail);
			} catch (e) { lines.push(t("失败", "Failed") + " · " + row.detail + " · " + e.message); }
		}
		return lines.join("\n");
	}

	registry.deepread_get_context = {
		name: "deepread_get_context", source: "deepread", domain: "context", floatingChat: true,
		description: "Read the Zotero item and collection selection captured when the current user message was sent.",
		inputSchema: { type: "object", properties: {} }, annotations: { readOnlyHint: true },
		run: (_args, message) => ({ items: message.selection ?? null, collections: message.collections ?? null, capturedAt: message.ts })
	};
	registry.deepread_plan_organize = {
		name: "deepread_plan_organize", source: "deepread", domain: "items", floatingChat: true,
		description: "Organize the selected Zotero papers. Prepare official item title corrections and/or role-based PDF/Word filenames. DeepRead shows a change list and applies only the rows the user approves.",
		inputSchema: { type: "object", properties: { kind: { type: "string", enum: ["all", "titles", "attachments"] } } },
		annotations: { readOnlyHint: true }, run: build, apply
	};
})();
