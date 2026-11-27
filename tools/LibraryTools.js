/* Native library operations. All object IDs are resolved inside the library
 * captured for this message. Writes re-read their targets after local review. */
(function () {
	const rt = DeepRead.ToolRuntime;
	const { t } = rt;
	const id = { type: "integer", minimum: 1 };
	const string = (maxLength, minLength = 1) => ({ type: "string", minLength, maxLength });
	const options = (...values) => ({ type: "string", enum: values });
	const object = (properties, required = []) => ({ type: "object", properties, required, additionalProperties: false });
	const page = { offset: { type: "integer", minimum: 0 }, limit: { type: "integer", minimum: 1, maximum: 50 } };
	const itemIDs = { type: "array", items: id, minItems: 1, maxItems: 50, uniqueItems: true };
	const fields = DeepRead.AtomTools.editableMetadataFields;
	function tool(name, domain, description, descriptionZh, inputSchema, run, review = false, risk = "medium") {
		const definition = { name: "deepread_" + name, domain, source: "deepread", description, descriptionZh,
			inputSchema, run, floatingChat: true, annotations: { readOnlyHint: !review } };
		if (review) Object.assign(definition, { confirm: "apply_selected", risk, apply: rt.applyRows });
		DeepRead.registerTool(definition);
	}
	function fail(zh, en) { throw new Error(t(zh, en)); }
	function same(a, b) {
		if (JSON.stringify(a) !== JSON.stringify(b)) fail("对象已发生变化，请重新生成方案。", "Target changed. Prepare a new plan.");
	}
	function present(value, label) {
		if (value == null || value === "") throw new Error(t("缺少参数 ", "Missing argument ") + label);
		return value;
	}
	function libItem(itemID, lib) {
		const item = Zotero.Items.get(itemID);
		if (!item || item.deleted || item.libraryID !== lib) fail("条目在此文献库中不可用。", "Item is unavailable in this library.");
		return item;
	}
	function regular(item) {
		if (!item.isRegularItem()) fail("请选择普通文献条目。", "Select a bibliographic item.");
		return item;
	}
	function selectedIDs(args, message) {
		const ids = args.itemIDs ?? message.selection?.map(s => s.itemID);
		if (!Array.isArray(ids) || !ids.length || ids.length > 50 || new Set(ids).size !== ids.length) {
			fail("每次请选择 1–50 个不同的条目。", "Select 1–50 distinct items per request.");
		}
		return ids;
	}
	function windowOf(rows, args) {
		const offset = args.offset ?? 0;
		const entries = rows.slice(offset, offset + (args.limit ?? 15));
		return { total: rows.length, offset, nextOffset: offset + entries.length < rows.length ? offset + entries.length : null, entries };
	}
	const sortIDs = ids => ids.slice().sort((a, b) => a - b);
	function ref(item) {
		return { itemID: item.id, libraryID: item.libraryID, key: item.key, itemType: item.itemType,
			title: (item.getDisplayTitle() || "").slice(0, 280), year: String(item.getField("year") || "").slice(0, 4) };
	}
	function collectionRef(id, lib) {
		const c = Zotero.Collections.get(id);
		if (!c || c.deleted || c.libraryID !== lib) fail("分类在此文献库中不可用。", "Collection is unavailable in this library.");
		return c;
	}
	function checkedCollection(id, lib) {
		const c = collectionRef(id, lib);
		const state = [c.key, c.name, c.parentID || null];
		return () => {
			const current = collectionRef(id, lib);
			same(state, [current.key, current.name, current.parentID || null]);
			return rt.assertEditable(current);
		};
	}
	function writableLibrary(id) {
		const lib = Zotero.Libraries.get(id);
		if (!lib?.editable) fail("文献库不可写。", "Library is read-only.");
	}
	function changeRow(id, name, detail, execute, selected = true) {
		return { id: String(id), name, detail, selected, execute };
	}
	const plan = rows => ({ rows, notes: [] });
	async function selectSearch(lib, conditions) {
		const s = new Zotero.Search();
		s.libraryID = lib;
		for (const condition of conditions) s.addCondition(...condition);
		return s.search();
	}
	tool("search_library", "search", "Search this library using text, title, creator, year, tag, collection or full text. Results are paginated.",
		"按题名、作者、年份、标签、分类或全文检索当前文献库，支持分页。",
		object({ query: string(300), title: string(300), creator: string(200), year: string(4), tag: string(200),
			fulltext: string(300), collectionID: id, ...page }), async (args, msg) => {
			const lib = rt.libraryID(msg);
			const conditions = [];
			for (const [key, condition, op] of [["query", "quicksearch-titleCreatorYear", "contains"], ["title", "title", "contains"],
				["creator", "creator", "contains"], ["year", "year", "is"], ["tag", "tag", "is"]]) {
				if (args[key]) conditions.push([condition, op, args[key]]);
			}
			if (args.collectionID) conditions.push(["collection", "is", collectionRef(args.collectionID, lib).key]);
			let ids;
			if (args.fulltext) {
				// Indexed text usually belongs to the PDF child. Title/year/tags
				// and collection membership normally belong to its parent.
				const matches = new Set();
				for (const id of await selectSearch(lib, [["fulltextContent", "contains", args.fulltext]])) {
					const it = libItem(id, lib);
					matches.add(it.parentItemID || it.id);
				}
				ids = conditions.length ? (await selectSearch(lib, conditions)).filter(id => matches.has(id)) : [...matches];
			} else ids = await selectSearch(lib, conditions);
			const result = windowOf(sortIDs(ids), args);
			result.entries = result.entries.map(n => ref(libItem(n, lib)));
			return result;
		});
	tool("read_items", "items", "Read bibliographic fields, creators, tags, collection IDs and child IDs in the current library.",
		"读取文献元数据、作者、标签、分类及子附件和笔记 ID。", object({ itemIDs }), (a, m) =>
			selectedIDs(a, m).map(id => {
				const item = regular(libItem(id, rt.libraryID(m)));
				const data = {};
				for (const f of fields) data[f] = String(item.getField(f) || "").slice(0, 1500);
				return { ...ref(item), fields: data, creators: item.getCreatorsJSON().slice(0, 50), tags: item.getTags().slice(0, 100),
					collections: item.getCollections().slice(0, 100), attachmentIDs: item.getAttachments().slice(0, 100), noteIDs: item.getNotes().slice(0, 100) };
			}));
	tool("edit_item_field", "items", "Propose a field change on selected bibliographic records. Use the organize tool for titles.",
		"为选中文献逐项预览字段修改。标题通过条目整理核对。", object({ itemIDs, field: options(...fields), value: string(8000, 0) }, ["field", "value"]),
		(a, m) => {
			if (!fields.includes(a.field)) fail("此字段不可编辑。", "Unsupported field.");
			const rows = [];
			for (const id of selectedIDs(a, m)) {
				const resolve = () => rt.assertEditable(regular(rt.selectedItem(m, id)));
				const item = resolve();
				if (!Zotero.ItemFields.isValidForType(Zotero.ItemFields.getID(a.field), item.itemTypeID)) fail("条目类型不支持该字段。", "Field unavailable for this item type.");
				const before = item.getField(a.field) || "";
				if (before === a.value) continue;
				rows.push(changeRow(id, a.field, "#" + id + " · " + before + " → " + a.value, async () => {
					const target = resolve();
					same(target.getField(a.field) || "", before);
					const scope = { itemIDs: new Set([id]), attachmentIDs: new Set() };
					const r = await DeepRead.AtomTools.run("set_item_field", { itemID: id, field: a.field, value: a.value }, scope);
					if (!r.ok) throw Error(r.error);
					return "#" + id + " · " + a.field + " · " + before + " → " + target.getField(a.field);
				}));
			}
			return plan(rows);
		}, true);
	// Native merge and trash can affect descendants, including trashed child
	// notes and annotations. Lock the reviewed tree and all field values.
	function childIDs(item) {
		if (item.isRegularItem()) return [...item.getAttachments(true), ...item.getNotes(true)];
		if (item.isNote()) return item.getAttachments(true);
		return item.isFileAttachment?.() ? item.getAnnotations(true, true) : [];
	}
	async function loadTrees(items) {
		let level = items;
		while (level.length) {
			await Zotero.Items.loadDataTypes(level);
			const ids = level.flatMap(childIDs);
			level = ids.length ? await Zotero.Items.getAsync(ids) : [];
		}
	}
	function treeState(item) {
		const children = childIDs(item);
		return { itemID: item.id, key: item.key, type: item.itemType, json: item.toJSON(),
			children: sortIDs(children).map(id => {
				const child = Zotero.Items.get(id);
				if (!child || child.libraryID !== item.libraryID || child.parentItemID !== item.id) fail("子条目已变更。", "Child item changed.");
				return treeState(child);
			}) };
	}
	function treeLabel(state) {
		const ids = [];
		function visit(node) {
			for (const child of node.children) { ids.push("#" + child.itemID); visit(child); }
		}
		visit(state);
		return "#" + state.itemID + " · " + state.json.title +
			(ids.length ? "\n" + t("子条目 ", "Children ") + ids.join(", ") : "");
	}
	const mergingItems = new Set();
	async function mergeInZotero(master, others) {
		const win = Zotero.getMainWindow();
		const pane = win?.ZoteroPane;
		// Native merges commit before Zotero refreshes the collection tree. At
		// early startup the refresh can wait forever for its first selection.
		if (!pane?.itemsView || !(pane.collectionsView?.selection?.focused >= 0)) {
			fail("请等 Zotero 文献库列表加载完毕后再确认合并。", "Wait for the Zotero library tree to load before confirming a merge.");
		}
		const ids = [master.id, ...others.map(i => i.id)];
		if (ids.some(id => mergingItems.has(id))) fail("Zotero 仍在处理涉及这些条目的合并。", "Zotero is still processing a merge involving these records.");
		ids.forEach(id => mergingItems.add(id));
		let timer;
		const operation = (async () => {
			try {
				await Zotero.Items.merge(master, others);
				return t("保留 ", "Kept ") + "#" + master.id + " · " + t("已合并 ", "Merged ") + others.map(i => "#" + i.id).join(", ");
			} finally { ids.forEach(id => mergingItems.delete(id)); }
		})();
		try {
			return await Promise.race([operation, new Promise(resolve => {
				timer = win.setTimeout(() => resolve(t("Zotero 尚未返回最终结果。请在文献库核对主条目和回收站，勿重复执行。",
					"Zotero has not returned a final result. Check the master record and Trash before attempting another merge.")), 60000);
			})]);
		} finally { win.clearTimeout(timer); }
	}
	tool("manage_items", "items", "Propose creating a bibliographic item, trashing selected papers, or merging selected duplicates of the same type. Merge retains the specified master metadata and lets Zotero reconcile children, tags and collections.",
		"创建文献、将选中文献移至回收站或合并选中的同类型重复项。合并保留指定主条目的元数据，由 Zotero 处理子条目、标签和分类。",
		object({ action: options("create", "trash", "merge"), itemIDs, masterID: id, itemType: string(60), title: string(1500),
			fields: object(Object.fromEntries(fields.map(f => [f, string(5000, 0)]))) }, ["action"]), async (a, m) => {
			const lib = rt.libraryID(m);
			writableLibrary(lib);
			if (a.action === "create") {
				const title = present(a.title?.trim(), "title");
				const type = a.itemType || "journalArticle";
				const typeID = Zotero.ItemTypes.getID(type);
				if (!typeID || ["attachment", "annotation", "note"].includes(type)) fail("不支持该文献类型。", "Unsupported bibliographic type.");
				const data = { title, ...a.fields };
				for (const f of Object.keys(data)) {
					if (!Zotero.ItemFields.isValidForType(Zotero.ItemFields.getID(f), typeID)) fail("条目类型不支持字段 " + f, "Field unavailable for this type: " + f);
				}
				const label = t("创建文献", "Create record");
				return plan([changeRow("create", label, "#" + lib + " · " + type + "\n" + JSON.stringify(data, null, 2), () => Zotero.DB.executeTransaction(async () => {
					writableLibrary(lib);
					const item = new Zotero.Item(type);
					item.libraryID = lib;
					for (const [f, value] of Object.entries(data)) item.setField(f, value);
					await item.save();
					return label + " · #" + item.id + " · " + item.getField("title");
				}))]);
			}
			const resolve = id => {
				const item = rt.assertEditable(regular(rt.selectedItem(m, id)));
				same(item.libraryID, lib);
				if (!Zotero.Libraries.hasTrash?.(lib)) fail("此库未提供回收站。", "Library has no trash.");
				return item;
			};
			const items = selectedIDs(a, m).map(resolve);
			await loadTrees(items);
			const snapshots = items.map(treeState);
			const check = (id, state) => {
				const item = resolve(id);
				same(treeState(item), state);
				return item;
			};
			if (a.action === "trash") {
				const label = t("移至回收站", "Move to trash");
				return plan(snapshots.map(state => changeRow(state.itemID, label, treeLabel(state), () => Zotero.DB.executeTransaction(async () => {
					const item = check(state.itemID, state);
					await Zotero.Items.trash([item.id]);
					return label + " · #" + item.id;
				}), false)));
			}
			const master = items.find(item => item.id === a.masterID);
			if (!master || items.length < 2 || items.some(item => item.itemTypeID !== master.itemTypeID)) {
				fail("合并需要同类型文献及选区内的主条目 ID。", "Select at least two records of one type and identify their master.");
			}
			if (typeof Zotero.Items.merge !== "function") fail("当前 Zotero 无法执行原生合并。", "Native item merge is unavailable.");
			const label = t("合并选中文献", "Merge selected records");
			const detail = snapshots.map(state => (state.itemID === master.id ? t("保留主条目 ", "Keep master ") : t("合并后移入回收站 ", "Merge and trash ")) + treeLabel(state)).join("\n") +
				"\n" + t("保留主条目字段，合并分类和标签。Zotero 会迁移子笔记并核对重复附件。", "Keep master fields, combine tags and collections, and let Zotero move notes and reconcile duplicate attachments.");
			return plan([changeRow("merge", label, detail, async () => {
				// The native merge opens its own transaction; nesting it deadlocks.
				if (Zotero.DB.inTransaction?.()) fail("文献库正在处理另一项写入，请稍后重新确认。", "The library is busy with another write. Review this merge again in a moment.");
				const all = snapshots.map(s => check(s.itemID, s));
				if (snapshots.some(s => s.children.length) && Zotero.Libraries.get(lib)?.filesEditable === false) {
					fail("此库不允许变更附件。", "Library files are read-only.");
				}
				const keep = all.find(i => i.id === master.id);
				const others = all.filter(i => i !== keep);
				return mergeInZotero(keep, others);
			}, false)]);
		}, true, "high");
	async function eachPaper(lib, visit) {
		const ids = await Zotero.Items.getAll(lib, true, false, true);
		for (let offset = 0; offset < ids.length; offset += 100) {
			const batch = await Zotero.Items.getAsync(ids.slice(offset, offset + 100));
			for (const item of batch) if (item && item.libraryID === lib && !item.deleted && item.isRegularItem()) visit(item);
		}
	}
	tool("library_statistics", "statistics", "Count regular records by year, journal, item type or direct collection membership in the captured library. A record may belong to several collections.",
		"统计文献总数及年份、期刊、类型或所属分类的分布。一条文献可以计入多个分类。", object({ group: options("year", "journal", "type", "collection"), ...page }), async (a, m) => {
			const libraryID = rt.libraryID(m);
			const counts = new Map();
			let records = 0;
			const collections = a.group === "collection" ? new Map(Zotero.Collections.getByLibrary(libraryID, true)
				.filter(c => !c.deleted).map(c => [c.id, c.name])) : null;
			const count = key => counts.set(key, (counts.get(key) || 0) + 1);
			await eachPaper(libraryID, item => {
				records++;
				if (collections) {
					const direct = item.getCollections().filter(id => collections.has(id));
					for (const id of direct.length ? direct : [null]) count(id);
					return;
				}
				const group = a.group === "type" ? item.itemType : item.getField(a.group === "journal" ? "publicationTitle" : "year");
				count(group || t("未填", "Unspecified"));
			});
			const entries = [...counts].map(([key, count]) => collections
				? { collectionID: key, value: collections.get(key) ?? t("未分类", "Unfiled"), count }
				: { value: key, count });
			entries.sort((a, b) => b.count - a.count || a.value.localeCompare(b.value) || (a.collectionID ?? 0) - (b.collectionID ?? 0));
			return { records, ...windowOf(entries, a) };
		});
	tool("find_duplicates", "items", "Find possible duplicate groups by exact DOI or normalized title and year. Preview differing fields for selected records.",
		"按相同 DOI 或相同题名与年份查找重复候选，并可预览选中记录的字段差异。",
		object({ mode: options("doi", "title_year", "compare"), itemIDs, ...page }), async (a, m) => {
			if (a.mode === "compare") {
				const items = selectedIDs(a, m).map(id => regular(rt.selectedItem(m, id)));
				if (items.length < 2) fail("请至少选择两条文献。", "Select at least two records.");
				const differences = {};
				for (const f of ["title", ...fields]) {
					const values = items.map(i => String(i.getField(f) || "").slice(0, 500));
					if (new Set(values).size > 1) differences[f] = values;
				}
				return { items: items.map(ref), differences };
			}
			const groups = new Map();
			await eachPaper(rt.libraryID(m), item => {
				let value;
				if (a.mode === "title_year") {
					const title = String(item.getField("title") || "").normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();
					const year = item.getField("year");
					if (title && year) value = title + " / " + year;
				} else value = String(item.getField("DOI") || "").trim().replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, "").toLowerCase();
				if (!value) return;
				if (!groups.has(value)) groups.set(value, []);
				groups.get(value).push(item.id);
			});
			const matches = [...groups].filter(([, ids]) => ids.length > 1).sort(([a], [b]) => a.localeCompare(b));
			return windowOf(matches.map(([value, ids]) => ({ value, count: ids.length, itemIDs: sortIDs(ids).slice(0, 50) })), a);
		});
	tool("collections", "collections", "List collections and parent IDs, or list items in one collection in the current library.",
		"读取当前文献库的分类树或指定分类下的条目。", object({ collectionID: id, ...page }), (a, m) => {
			const lib = rt.libraryID(m);
			if (a.collectionID) {
				const result = windowOf(sortIDs(collectionRef(a.collectionID, lib).getChildItems(true)), a);
				result.entries = result.entries.map(id => ref(libItem(id, lib)));
				return result;
			}
			return windowOf(Zotero.Collections.getByLibrary(lib, true).map(c => ({ collectionID: c.id, key: c.key, name: c.name, parentID: c.parentID || null })), a);
		});
	function collectionTree(root) {
		const queue = [root];
		const rows = [];
		for (let i = 0; i < queue.length; i++) {
			const c = rt.assertEditable(queue[i]);
			rows.push({ id: c.id, key: c.key, name: c.name, parent: c.parentID || null, members: sortIDs(c.getChildItems(true)) });
			for (const child of sortIDs(c.getChildCollections(true))) queue.push(collectionRef(child, root.libraryID));
		}
		return rows;
	}
	tool("manage_collection", "collections", "Propose creating, renaming, moving or trashing a collection, or changing selected item memberships. Trash includes its child collections and preserves the bibliographic items.",
		"创建、重命名或移动分类，核对下级分类后移至回收站，或调整选中条目的分类归属。删除分类时文献保留在库中。",
		object({ action: options("create", "rename", "move", "trash", "add_items", "remove_items"), name: string(255),
			collectionID: id, parentID: id, itemIDs }, ["action"]), (a, m) => {
			const lib = rt.libraryID(m);
			writableLibrary(lib);
			const action = a.action;
			const label = ({ create: t("新建分类", "Create collection"), rename: t("分类改名", "Rename collection"), move: t("移动分类", "Move collection"),
				trash: t("分类移入回收站", "Trash collection"), add_items: t("加入分类", "Add to collection"), remove_items: t("移出分类", "Remove from collection") })[action];
			const parent = a.parentID ? checkedCollection(a.parentID, lib) : () => null;
			const name = ["create", "rename"].includes(action) ? present(a.name?.trim(), "name") : null;
			if (action === "create") {
				const detail = (parent()?.name || "#" + lib) + " / " + name;
				return plan([changeRow("create", label, detail, () => Zotero.DB.executeTransaction(async () => {
					writableLibrary(lib);
					const p = parent();
					const c = new Zotero.Collection();
					c.libraryID = lib;
					c.name = name;
					if (p) c.parentID = p.id;
					await c.save();
					return "#" + c.id + " · " + detail;
				}))]);
			}
			const cid = present(a.collectionID, "collectionID");
			const get = checkedCollection(cid, lib);
			const collection = get();
			const target = collection.name + " (#" + cid + ")";
			if (action === "add_items" || action === "remove_items") {
				const add = action === "add_items";
				const rows = [];
				for (const id of selectedIDs(a, m)) {
					const resolve = () => rt.assertEditable(rt.selectedItem(m, id));
					const item = resolve();
					same(item.libraryID, lib);
					if (item.parentItemID) fail("子条目跟随父条目的分类。", "Child items inherit their parent's collections.");
					const before = sortIDs(item.getCollections());
					if (before.includes(cid) === add) continue;
					const detail = "#" + id + " · " + target;
					rows.push(changeRow(id, label, detail, () => Zotero.DB.executeTransaction(async () => {
						get();
						const current = resolve();
						same(current.parentItemID || null, null);
						same(sortIDs(current.getCollections()), before);
						current.setCollections(add ? [...before, cid] : before.filter(n => n !== cid));
						await current.save();
						return label + " · " + detail;
					})));
				}
				return plan(rows);
			}
			if (!m.collections?.some(c => c.collectionID === cid && c.key === collection.key && c.libraryID === lib)) {
				fail("请先选中要修改的分类。", "Select the collection to change.");
			}
			const tree = action === "trash" ? collectionTree(collection) : null;
			const check = c => {
				if (action === "trash" && (!("deleted" in c) || !Zotero.Libraries.hasTrash?.(lib))) fail("此版本或此库不支持将分类移至回收站。", "Collection trash unavailable in this version or library.");
				if (action === "move" && a.parentID && (a.parentID === cid || c.hasDescendent("collection", a.parentID))) fail("分类不能移入自身或子分类。", "Cannot move a collection into itself or its descendants.");
			};
			check(collection);
			if (action === "rename" && collection.name === name || action === "move" && (a.parentID || null) === (collection.parentID || null)) return plan([]);
			const detail = action === "rename" ? target + " → " + name : action === "move" ? target + " → " + (parent()?.name || t("库根目录", "library root")) :
				tree.map(c => "#" + c.id + " · " + c.name).join("\n") + "\n" + t("文献保留在库中", "Items stay in the library");
			return plan([changeRow(cid, label, detail, () => Zotero.DB.executeTransaction(async () => {
				const c = get();
				check(c);
				if (action === "rename") c.name = name;
				else if (action === "move") c.parentID = parent()?.id || false;
				else if (action === "trash") { same(collectionTree(c), tree); c.deleted = true; }
				else fail("未知分类操作。", "Unknown collection action.");
				await c.save({ deleteItems: false });
				return label + " · " + detail;
			}), action !== "trash")]);
		}, true);
	tool("list_tags", "tags", "List tags used by selected records, with counts.", "列出选中条目的标签及出现次数。", object({ itemIDs, ...page }), (a, m) => {
		const counts = new Map();
		for (const id of selectedIDs(a, m)) {
			for (const { tag } of rt.selectedItem(m, id).getTags()) counts.set(tag, (counts.get(tag) || 0) + 1);
		}
		return windowOf([...counts].sort(([a], [b]) => a.localeCompare(b)).map(([tag, count]) => ({ tag, count })), a);
	});
	tool("manage_tags", "tags", "Propose adding, removing or replacing a tag on selected records. Replacing merges with an existing destination tag.",
		"为所选条目添加、移除或替换标签，目标标签已存在时合并。", object({ action: options("add", "remove", "replace"), itemIDs, tag: string(255), newTag: string(255) }, ["action", "tag"]),
		(a, m) => {
			const old = present(a.tag.trim(), "tag");
			const dest = a.action === "replace" ? present(a.newTag?.trim(), "newTag") : old;
			const rows = [];
			for (const id of selectedIDs(a, m)) {
				const resolve = () => rt.assertEditable(rt.selectedItem(m, id));
				const before = resolve().getTags();
				const match = before.find(x => x.tag === old);
				if (a.action === "add" ? match : !match) continue;
				if (a.action === "replace" && dest === old) continue;
				const after = before.filter(tag => tag.tag !== old);
				if (a.action !== "remove" && !after.some(tag => tag.tag === dest)) after.push({ tag: dest, type: match?.type || 0 });
				const label = t("修改标签", "Edit tags");
				const detail = "#" + id + " · " + (a.action === "add" ? "+ " + dest : a.action === "remove" ? "− " + old : old + " → " + dest);
				rows.push(changeRow(id, label, detail, () => Zotero.DB.executeTransaction(async () => {
					const item = resolve();
					same(item.getTags(), before);
					item.setTags(after);
					await item.save();
					return detail;
				})));
			}
			return plan(rows);
		}, true);
	function noteText(html) {
		const Parser = Zotero.getMainWindow()?.DOMParser;
		if (!Parser) fail("当前窗口无法读取笔记文本。", "The current window cannot convert note HTML to text.");
		const doc = new Parser().parseFromString(html, "text/html");
		for (const el of doc.querySelectorAll("br,p,div,li,h1,h2,h3,tr")) el.appendChild(doc.createTextNode("\n"));
		return doc.body.textContent.trim();
	}
	tool("read_notes", "notes", "List child notes of a paper or read/export a note as paginated plain text or HTML.",
		"列出文献下的笔记，或分段读取、导出笔记文本或 HTML。", object({ itemID: id, format: options("text", "html"), offset: { type: "integer", minimum: 0 } }, ["itemID"]),
		async (a, m) => {
			const lib = rt.libraryID(m);
			const item = libItem(a.itemID, lib);
			if (item.isRegularItem()) {
				const list = windowOf(sortIDs(item.getNotes()), a);
				list.entries = list.entries.map(id => ref(libItem(id, lib)));
				return list;
			}
			if (!item.isNote()) fail("请选择文献或笔记。", "Select a paper or a note.");
			await item.loadDataType("note");
			const content = a.format === "html" ? item.getNote() : noteText(item.getNote());
			const offset = a.offset ?? 0;
			const end = offset + 6000;
			return { itemID: item.id, offset, totalCharacters: content.length, content: content.slice(offset, end), nextOffset: end < content.length ? end : null };
		});
	function noteParagraphs(text) {
		const quote = s => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
		return text.split(/\r?\n/).map(line => "<p>" + quote(line) + "</p>").join("");
	}
	tool("edit_note", "notes", "Create a child note on a selected paper or append/replace plain text on a selected note. Replace discards prior rich formatting.",
		"为选中文献创建子笔记，或向选中笔记追加文本、用纯文本替换完整内容。", object({ action: options("create", "append", "replace"), itemID: id, text: string(8000) }, ["action", "itemID", "text"]),
		async (a, m) => {
			const lib = rt.libraryID(m);
			const resolve = () => rt.assertEditable(rt.selectedItem(m, a.itemID));
			const item = resolve();
			const create = a.action === "create";
			if (create) regular(item);
			else if (!item.isNote()) fail("请选择要编辑的笔记。", "Select the note to edit.");
			if (!create) await item.loadDataType("note");
			const before = create ? "" : item.getNote();
			const parent = item.parentItemID || null;
			const label = create ? t("创建子笔记", "Create child note") : a.action === "append" ? t("追加笔记", "Append to note") : t("替换整篇笔记（含原格式）", "Replace entire note and formatting");
			const detail = "#" + item.id + " · " + item.getDisplayTitle() + "\n" +
				(a.action === "replace" ? noteText(before) + "\n→\n" : "") + a.text;
			return plan([changeRow(item.id, label, detail, () => Zotero.DB.executeTransaction(async () => {
				const source = resolve();
				same(source.libraryID, lib);
				same(source.parentItemID || null, parent);
				const note = create ? new Zotero.Item("note") : source;
				const html = noteParagraphs(a.text);
				if (create) {
					note.libraryID = lib;
					note.parentID = regular(source).id;
				} else {
					if (!note.isNote()) fail("笔记已变更。", "Note changed.");
					same(note.getNote(), before);
				}
				const wrapper = /^\s*<div\b[^>]*\bdata-schema-version=/i.test(before) && /<\/div>\s*$/i.test(before);
				note.setNote(a.action === "append" ? (wrapper ? before.replace(/<\/div>\s*$/i, () => html + "</div>") : before + html) : html);
				await note.save();
				return label + " · #" + note.id + "\n" + a.text;
			}), a.action !== "replace")]);
		}, true);
	tool("citation", "citation", "List installed CSL styles, format an in-text citation, or format a bibliography with an installed style.",
		"列出已安装的 CSL 样式，生成文内引文或参考文献。", object({ action: options("styles", "citation", "bibliography"), style: string(300),
			locale: string(30), itemIDs, ...page }, ["action"]), async (a, m) => {
			await Zotero.Styles.init();
			if (a.action === "styles") return windowOf(Zotero.Styles.getVisible().map(s => ({ id: s.styleID, title: s.title })), a);
			const items = selectedIDs(a, m).map(id => regular(libItem(id, rt.libraryID(m))));
			const style = Zotero.Styles.get(a.style || "http://www.zotero.org/styles/apa");
			if (!style) fail("此 CSL 样式尚未安装，请先列出 styles。", "CSL style unavailable. List installed styles first.");
			const engine = style.getCiteProc(a.locale || Zotero.locale, "text");
			try {
				if (a.action === "citation") {
					engine.updateItems(items.map(i => i.id));
					return { text: engine.previewCitationCluster({ citationItems: items.map(i => ({ id: i.id })), properties: {} }, [], [], "text") };
				}
				return { text: Zotero.Cite.makeFormattedBibliographyOrCitationList(engine, items, "text") };
			} finally { engine.free(); }
		});
	tool("export_references", "import_export", "Export bibliographic records as RIS or BibTeX text from an installed Zotero translator. Read larger output by character offset.",
		"通过 Zotero 导出器生成 RIS 或 BibTeX 文本，长结果可按字符位置续读。", object({ format: options("ris", "bibtex"), itemIDs,
			offset: { type: "integer", minimum: 0 } }, ["format"]), async (a, m) => {
			const items = selectedIDs(a, m).map(id => regular(libItem(id, rt.libraryID(m))));
			const exporter = new Zotero.Translate.Export();
			exporter.setItems(items);
			const translator = (await exporter.getTranslators()).find(entry => entry.label.toLowerCase() === a.format);
			if (!translator) fail("未找到所选导出器。", "Requested export translator is unavailable.");
			exporter.setTranslator(translator.translatorID);
			exporter.setDisplayOptions({ exportFileData: false, exportNotes: false });
			await exporter.translate();
			if (!exporter.string) fail("导出器返回空结果。", "Export returned no text.");
			const offset = a.offset ?? 0;
			const end = offset + 6000;
			return { format: a.format, content: exporter.string.slice(offset, end), totalCharacters: exporter.string.length,
				offset, nextOffset: end < exporter.string.length ? end : null };
		});
	const normalizeDOI = value => String(value || "").trim().replace(/^(https?:\/\/(?:dx\.)?doi\.org\/|doi:\s*)/i, "").toLowerCase();
	tool("import_doi", "import_export", "Look up a DOI with installed Zotero translators and propose importing one bibliographic record into the captured library.",
		"用 Zotero 的 DOI 查询器取得元数据，核对后导入单条文献。", object({ doi: string(255) }, ["doi"]), async (a, m) => {
			const lib = rt.libraryID(m);
			writableLibrary(lib);
			const doi = normalizeDOI(a.doi);
			if (!/^10\.\d{4,9}\/[^\s]+$/.test(doi)) fail("DOI 格式不正确。", "Invalid DOI.");
			const duplicate = async () => (await selectSearch(lib, [["DOI", "contains", doi]])).some(id =>
				normalizeDOI(libItem(id, lib).getField("DOI")) === doi);
			if (await duplicate()) return { rows: [], notes: [t("文献库已包含 DOI ", "Library already contains DOI ") + doi] };
			const lookup = new Zotero.Translate.Search();
			lookup.setIdentifier({ DOI: doi });
			const translators = await lookup.getTranslators();
			if (!translators.length) fail("未找到可用的 DOI 查询器。", "No DOI lookup translator is available.");
			lookup.setTranslator(translators);
			const matches = (await lookup.translate({ libraryID: false, saveAttachments: false })).filter(x => normalizeDOI(x.DOI) === doi && x.title);
			if (matches.length !== 1) fail("未找到唯一且 DOI 匹配的文献。", "Lookup did not return exactly one matching reference.");
			const found = matches[0];
			const typeID = Zotero.ItemTypes.getID(found.itemType);
			if (!typeID || ["attachment", "note", "annotation"].includes(found.itemType)) fail("查询结果不是受支持的文献类型。", "Unsupported bibliographic record type.");
			const data = {};
			for (const field of Zotero.ItemFields.getItemTypeFields(typeID).map(id => Zotero.ItemFields.getName(id))) {
				if (typeof found[field] === "string" && found[field]) data[field] = found[field];
			}
			if (!data.DOI || !data.title) fail("条目类型不支持保存本次 DOI 或标题。", "This type cannot store the returned DOI and title.");
			const creators = (found.creators || []).map(c => c.name || c.fieldMode === 1
				? { name: c.name || c.lastName, creatorType: c.creatorType } : { firstName: c.firstName || "", lastName: c.lastName || "", creatorType: c.creatorType });
			const label = t("导入 DOI", "Import DOI");
			// Only these explicitly previewed fields are passed to fromJSON.
			const detail = "#" + lib + " · " + JSON.stringify({ itemType: found.itemType, ...data, creators }, null, 2);
			return plan([changeRow(doi, label, detail, () => Zotero.DB.executeTransaction(async () => {
				writableLibrary(lib);
				if (await duplicate()) fail("确认期间已导入相同 DOI。", "DOI was imported after this proposal.");
				const item = new Zotero.Item(found.itemType);
				item.libraryID = lib;
				item.fromJSON({ itemType: found.itemType, ...data, creators });
				await item.save();
				return label + " · #" + item.id + " · " + item.getField("DOI") + " · " + item.getField("title");
			}))]);
		}, true);
})();
