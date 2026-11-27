/* Attachment reads and reviewed operations are bound to the captured selection. */
(function () {
	const R = DeepRead.ToolRuntime;
	const { t } = R;
	const id = { type: "integer", minimum: 1 };
	function attachments(message) {
		const entries = new Map();
		for (const selected of message?.selection || []) {
			const item = R.selectedItem(message, selected.itemID);
			if (item.isAttachment()) entries.set(item.id, item);
			else for (const aid of selected.attachmentIDs || []) {
				const child = Zotero.Items.get(aid);
				if (child?.isAttachment() && !child.deleted && child.parentItemID === item.id && child.libraryID === item.libraryID) entries.set(child.id, child);
			}
		}
		return entries;
	}
	function writableFile(item) {
		R.assertEditable(item);
		if (!item.isFileAttachment() || (item.isStoredFileAttachment() && !Zotero.Libraries.get(item.libraryID).filesEditable)) {
			throw new Error(t("附件不可写", "Attachment file is not writable"));
		}
	}
	DeepRead.registerTool({
		name: "deepread_list_attachments", domain: "attachments", source: "deepread", floatingChat: true,
		description: "List selected items' attachments, their IDs, filenames, MIME types, file availability and parent IDs. Use offset for more.",
		descriptionZh: "查看所选文献的附件、文件名、类型、磁盘可用性与父条目。",
		inputSchema: { type: "object", additionalProperties: false, properties: { offset: { type: "integer", minimum: 0 }, limit: { type: "integer", minimum: 1, maximum: 50 } } },
		annotations: { readOnlyHint: true },
		async run({ offset = 0, limit = 25 }, message) {
			const list = [...attachments(message).values()];
			const items = [];
			for (const a of list.slice(offset, offset + limit)) {
				const file = a.isFileAttachment();
				items.push({ itemID: a.id, key: a.key, libraryID: a.libraryID, parentItemID: a.parentItemID || null,
					title: a.getField("title"), filename: file ? a.attachmentFilename : null, mimeType: a.attachmentContentType,
					fileExists: file ? await a.fileExists() : null });
			}
			return { total: list.length, offset, items };
		}
	});
	const names = {
		rename: ["重命名附件", "Rename attachment"], move: ["移动附件", "Move attachment"], trash: ["将附件移到回收站", "Trash attachment"],
		download: ["下载同步附件", "Download synced file"], reveal: ["在文件夹中显示", "Show in folder"],
		import: ["从本机选择附件并导入", "Choose and import a local file"]
	};
	async function plan({ action, attachmentID, parentItemID, newName }, message) {
		const name = t(...names[action]), notes = [];
		let detail, execute;
		if (action === "import") {
			const parent = R.selectedItem(message, parentItemID);
			const check = () => {
				const current = R.assertEditable(R.selectedItem(message, parentItemID));
				if (!current.isRegularItem() || !Zotero.Libraries.get(current.libraryID).filesEditable) throw new Error(t("请选择可写入附件的父文献", "Select a writable parent item"));
			};
			check();
			detail = "#" + parentItemID + " · " + parent.getField("title");
			execute = async () => {
				check();
				const win = Zotero.getMainWindow();
				const Picker = win.FilePicker || ChromeUtils.importESModule("chrome://zotero/content/modules/filePicker.mjs").FilePicker;
				const picker = new Picker();
				picker.init(win, name, picker.modeOpen);
				picker.appendFilters(picker.filterAll);
				if (await picker.show() !== picker.returnOK) return t("已取消选择文件", "File selection cancelled");
				check();
				const result = await Zotero.Attachments.importFromFile({ file: picker.file, parentItemID });
				return "#" + result.id + " · " + result.attachmentFilename;
			};
		} else {
			const a = attachments(message).get(attachmentID);
			if (!a || !a.isFileAttachment()) throw new Error(t("请选择此次选区中的文件附件", "Choose a file attachment from the captured selection"));
			const key = a.key, library = a.libraryID, parent = a.parentItemID, filename = a.attachmentFilename, title = a.getField("title");
			const check = () => {
				const current = attachments(message).get(attachmentID);
				if (!current || current.key !== key || current.libraryID !== library || current.parentItemID !== parent ||
					current.attachmentFilename !== filename || current.getField("title") !== title) throw new Error(t("附件在确认前已变更", "Attachment changed before confirmation"));
				if (action !== "download" && action !== "reveal") writableFile(current);
				return current;
			};
			check();
			detail = "#" + attachmentID + " · " + filename;
			const scope = { itemIDs: new Set(), attachmentIDs: new Set([attachmentID]) };
			if (action === "rename") {
				const ext = s => (s.match(/\.[^.]+$/)?.[0] || "").toLowerCase();
				if (typeof newName !== "string" || !newName || /^[. ]|[. ]$/.test(newName) || DeepRead.OrganizeRenameTool.fsSafe(newName) !== newName || ext(filename) !== ext(newName))
					throw new Error(t("请输入保留原扩展名的有效文件名", "Enter a valid filename preserving the extension"));
				detail += " → " + newName + " · " + t("显示标题", "Display title") + " " + title + " → " + newName;
				execute = async () => {
					check();
					const r = await DeepRead.AtomTools.run("rename_attachment", { attachmentID, newName }, scope);
					if (!r.ok) {
						const disk = r.fileRenamed ? t("磁盘已改名为 ", "Disk file renamed to ") + r.filename : r.fileOutcomeUnknown ? t("磁盘结果待核实", "Disk outcome unverified") : "";
						throw new Error([disk, r.error].filter(Boolean).join(" · "));
					}
					return [r.filename, r.to].join(" · ");
				};
			} else if (action === "move") {
				const checkTarget = () => {
					const target = R.assertEditable(R.selectedItem(message, parentItemID));
					if (!target.isRegularItem() || target.id === parent || target.libraryID !== library) throw new Error(t("目标须为同库的另一条已选文献", "Choose another selected parent from the same library"));
					return target;
				};
				const target = checkTarget(); scope.itemIDs.add(target.id);
				detail += " · #" + (parent || "—") + " → #" + target.id + " " + target.getField("title");
				execute = async () => {
					check(); checkTarget();
					const r = await DeepRead.AtomTools.run("move_attachment", { attachmentID, toItemID: target.id }, scope);
					if (!r.ok) throw new Error(r.error);
					return "#" + (r.fromParentID || "—") + " → #" + r.toItemID;
				};
			} else if (action === "trash") {
				execute = async () => {
					check();
					const r = await DeepRead.AtomTools.run("delete_attachment", { attachmentID, trash: true }, scope);
					if (!r.ok) throw new Error(r.error);
					return t("已移到回收站", "Moved to trash");
				};
			} else if (action === "reveal") {
				execute = async () => {
					const current = check(), pane = Zotero.getMainWindow()?.ZoteroPane;
					if (!await current.fileExists() || !pane?.showAttachmentInFilesystem) throw new Error(t("无法定位本机文件", "Local file unavailable"));
					await pane.showAttachmentInFilesystem(current.id, true);
					return t("已定位文件", "Revealed file") + " · " + filename;
				};
			} else if (action === "download") {
				if (!a.isStoredFileAttachment() || typeof Zotero.Sync?.Runner?.downloadFile !== "function") throw new Error(t("此附件不支持同步下载", "Sync download is unavailable for this attachment"));
				execute = async () => {
					const current = check();
					if (await current.fileExists()) return t("文件已在本机", "File already available");
					await Zotero.Sync.Runner.downloadFile(current);
					if (!await current.fileExists()) throw new Error(t("未找到已下载的文件", "Download did not produce a local file"));
					return t("文件已下载", "File downloaded") + " · " + current.attachmentFilename;
				};
			} else throw new Error("Unknown attachment action");
		}
		return { rows: [{ id: action + "-" + (attachmentID || parentItemID), name, detail, selected: !["trash", "move"].includes(action), execute }], notes };
	}
	DeepRead.registerTool({
		name: "deepread_manage_attachment", domain: "attachments", source: "deepread", floatingChat: true,
		description: "Prepare a reviewed attachment rename, move to a selected parent, trash, reveal in folder, sync download, or local file-picker import. Use attachmentID for existing files and parentItemID for move/import.",
		descriptionZh: "确认后重命名、移动、回收、下载附件或在文件夹中定位，也可从本机选择文件导入。",
		inputSchema: { type: "object", properties: { action: { type: "string", enum: Object.keys(names) }, attachmentID: id, parentItemID: id,
			newName: { type: "string", minLength: 1, maxLength: 240 } }, required: ["action"], additionalProperties: false },
		risk: "high", confirm: "apply_selected", annotations: { readOnlyHint: false }, run: plan, apply: R.applyRows
	});
})();
