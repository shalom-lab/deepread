(function () {
	const R = DeepRead.ToolRuntime, { t } = R;
	const base = { source: "deepread", floatingChat: true };
	const empty = { type: "object", properties: {}, additionalProperties: false };
	function importMetadata(item) {
		const type = item.itemType;
		const typeID = Zotero.ItemTypes.getID(type);
		if (!typeID || ["attachment", "annotation", "note"].includes(type)) throw new Error(t("需要文献记录", "A bibliographic record is required"));
		const fields = Zotero.ItemFields;
		const source = { ...item };
		const convert = Zotero.Utilities.Item?.itemToAPIJSON || Zotero.Utilities.itemToAPIJSON;
		const [converted] = convert(item);
		const json = { itemType: type };
		for (const id of fields.getItemTypeFields(typeID)) {
			const field = fields.getName(id);
			// Some translator utilities omit unchanged base fields (including title).
			const value = source[field] ?? converted[field];
			if ((typeof value === "string" || typeof value === "number") && String(value).trim()) json[field] = String(value);
		}
		for (const key of ["creators", "tags"]) {
			if (converted[key]?.length) json[key] = converted[key];
		}
		if (!Object.keys(json).some(key => !["itemType", "tags"].includes(key))) throw new Error(t("导入记录缺少可识别的文献信息", "No bibliographic metadata found in import record"));
		const titleField = fields.getFieldIDFromTypeAndBase(typeID, "title");
		const label = json.title || (titleField && json[fields.getName(titleField)]) || json.DOI || json.ISBN || json.creators?.[0]?.lastName || type;
		return { json, label };
	}
	function syncState() {
		const runner = Zotero.Sync?.Runner;
		if (!runner) throw new Error(t("此版本未提供同步服务", "The sync service is unavailable"));
		return { enabled: !!runner.enabled, inProgress: !!runner.syncInProgress, lastStatus: runner.lastSyncStatus || null };
	}
	DeepRead.registerTool({ ...base, name: "deepread_sync_status", domain: "sync", inputSchema: empty,
		description: "Read Zotero sync availability, progress and the latest status.", descriptionZh: "查看 Zotero 同步是否启用、是否进行中及最近状态。",
		annotations: { readOnlyHint: true }, run: syncState });
	DeepRead.registerTool({ ...base, name: "deepread_sync_library", domain: "sync", inputSchema: empty,
		description: "Request local confirmation to synchronize the captured library with its configured Zotero account.",
		descriptionZh: "确认后同步发送消息时选中的文献库。", risk: "medium", confirm: "apply_selected", annotations: { readOnlyHint: false },
		run(_args, message) {
			const id = R.libraryID(message);
			const lib = Zotero.Libraries.get(id);
			const check = () => {
				const state = syncState();
				if (!lib || Zotero.Libraries.get(id) !== lib || !state.enabled || state.inProgress) throw new Error(t("文献库不可用、未配置同步，或已有同步在进行", "Library unavailable, sync disabled or already running"));
			};
			check();
			return { notes: [], rows: [{ id: "sync-" + id, name: t("同步文献库", "Sync library"), detail: "#" + id + " · " + lib.name,
				async execute() {
					check();
					const errors = [];
					const result = await Zotero.Sync.Runner.sync({ libraries: [id], onError: err => errors.push(String(err?.message || err)) });
					if (result === false || errors.length) throw new Error(errors.join(" · ") || t("同步未完成", "Sync did not complete"));
					return syncState().lastStatus || t("同步请求已处理", "Sync request processed");
				} }] };
		}, apply: R.applyRows });

	DeepRead.registerTool({ ...base, name: "deepread_import_references", domain: "import_export",
		description: "Preview a RIS or BibTeX text import into the captured library. One selectable row per bibliographic record. Imports metadata, creators and tags.",
		descriptionZh: "预览 RIS 或 BibTeX 文本并逐条勾选要导入的文献元数据。", risk: "medium",
		annotations: { readOnlyHint: false }, confirm: "apply_selected",
		inputSchema: { type: "object", additionalProperties: false, required: ["text"], properties: {
			text: { type: "string", minLength: 1, maxLength: 100000 } } },
		async run({ text }, message) {
			const libID = R.libraryID(message);
			const assertLibrary = () => {
				if (!Zotero.Libraries.get(libID)?.editable) throw new Error(t("目标文献库只读或已不可用", "Destination library unavailable or read-only"));
			};
			assertLibrary();
			const translator = new Zotero.Translate.Import();
			translator.setString(text);
			const detected = await translator.getTranslators();
			const importer = detected.find(tr => /^(RIS|BibTeX)$/i.test(tr.label));
			if (!importer) throw new Error(t("未识别出 RIS 或 BibTeX 文本", "No RIS or BibTeX translator matched the text"));
			translator.setTranslator(importer);
			const items = await translator.translate({ libraryID: false, saveAttachments: false });
			if (!items.length || items.length > 100) throw new Error(t("每批可导入 1–100 条文献", "Import between 1 and 100 records per batch"));
			const rows = items.map((item, i) => {
				const { json, label } = importMetadata(item);
				const name = t("导入文献", "Import reference");
				return { id: "import-" + i, name, detail: "#" + libID + " · " + label + (json.DOI && label !== json.DOI ? " · " + json.DOI : ""),
					async execute() {
						assertLibrary();
						const record = new Zotero.Item(json.itemType);
						record.libraryID = libID;
						record.fromJSON(json);
						await record.saveTx();
						return "#" + record.id + " · " + record.getField("title");
					} };
			});
			return { rows, notes: [] };
		}, apply: R.applyRows });
})();
