/* Tools available to the floating chat. Execution scope comes from the user
 * message captured by the host, never from arguments supplied by the model. */
(function () {
	const t = (zh, en) => DeepRead._locale === "zh" ? zh : en;

	function change(label, before, after) {
		return label + " · " + (before || t("（空）", "(empty)")) + " → " + (after || t("（空）", "(empty)"));
	}

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
				const fields = [];
				if (a && a.filename !== to) fields.push(change(t("文件名", "Filename"), a.filename, to));
				if (from !== to) fields.push(change(a ? t("显示标题", "Display title") : name, from, to));
				rows.push({ id: step.tool + "-" + target, name, detail: "#" + target + " · " + fields.join(" · ") + " · " + source + " (" + confidence + "%)",
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
		if (plan.reviewed) return "";
		plan.reviewed = true;
		const lines = plan.notes.slice();
		for (const row of plan.rows) {
			const target = "#" + row.target + " · " + row.name;
			if (!picked.has(row.id)) {
				lines.push(t("未勾选", "Unchecked") + " · " + target);
				continue;
			}
			try {
				if (!stillCurrent(row)) {
					lines.push(t("已跳过（对象已变更或不可写）", "Skipped (changed or read-only)") + " · " + target);
					continue;
				}
				const [result] = await DeepRead.AtomTools.runPlan([row.step], plan.scope);
				const updates = [];
				if (result.fileRenamed) updates.push(change(t("文件名", "Filename"), row.filename, result.filename));
				if (result.titleUpdated) updates.push(change(t("显示标题", "Display title"), row.from, result.to));
				if (result.ok && row.step.tool === "set_item_title") updates.push(change(t("文献标题", "Item title"), result.from, result.to));
				let status = t("已执行", "Applied");
				if (!result.ok) {
					status = updates.length ? t("部分完成", "Partially applied") : t("失败", "Failed");
					if (!updates.length) updates.push(row.name);
					if (result.fileRenamed && !result.titleUpdated && row.from !== row.step.args.newName) {
						updates.push(t("显示标题未更新", "Display title unchanged"));
					}
					if (result.fileOutcomeUnknown) updates.push(t("磁盘上的文件名尚未核实", "Filename on disk unverified"));
					updates.push(result.error || result.reason);
				}
				lines.push([status, "#" + row.target, ...updates].join(" · "));
			} catch (e) { lines.push(t("失败", "Failed") + " · " + target + " · " + e.message); }
		}
		return lines.map(line => "• " + line).join("\n");
	}

	DeepRead.registerTool({
		name: "deepread_get_context", source: "deepread", domain: "context", floatingChat: true,
		descriptionZh: "读取发送时的文献、分类和库 ID，或明确请求当前实时选区。",
		description: "Read selected Zotero items, collections and library at send time. Set mode to live to inspect the current main window instead.",
		inputSchema: { type: "object", properties: { mode: { type: "string", enum: ["snapshot", "live"] } }, additionalProperties: false }, annotations: { readOnlyHint: true },
		run: ({ mode }, message) => {
			const data = mode === "live" ? DeepRead.ToolRuntime.capture(Zotero.getMainWindow()) : message;
			return { items: data.selection ?? null, collections: data.collections ?? null, capturedAt: data.ts,
				...(data.libraryID != null && { libraryID: data.libraryID }), ...(mode && { mode }) };
		}
	});
	DeepRead.registerTool({
		name: "deepread_plan_organize", source: "deepread", domain: "items", floatingChat: true,
		descriptionZh: "核对所选文献的标题，建议 PDF 或 Word 附件名，勾选确认后执行。",
		description: "Organize the selected Zotero papers. Prepare official item title corrections and/or role-based PDF/Word filenames. DeepRead shows a change list and applies only the rows the user approves.",
		inputSchema: { type: "object", properties: { kind: { type: "string", enum: ["all", "titles", "attachments"] } } },
		annotations: { readOnlyHint: true }, confirm: "apply_selected", run: build, apply
	});
})();
