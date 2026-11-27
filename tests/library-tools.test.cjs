const test = require("node:test");
const assert = require("node:assert/strict");
require("../deepread.js");
require("../tools/ToolRuntime.js");
require("../tools/ZoteroAtomTools.js");
require("../tools/LibraryTools.js");

function fixture() {
	const items = new Map(), collections = new Map(), lib = { editable: true };
	const fields = ["title", ...DeepRead.AtomTools.editableMetadataFields];
	let seq = 20;
	class Item {
		constructor(type) {
			this.itemType = type;
			this.itemTypeID = type === "note" ? 2 : 1;
			this.fields = {}; this.tags = []; this.collections = [];
			this.libraryID = 1; this.note = "";
		}
		get parentItemID() { return this.parentID || null; }
		getField(f) { return this.fields[f] || ""; }
		setField(f, v) { this.fields[f] = v; }
		getDisplayTitle() { return this.getField("title") || "Note"; }
		isRegularItem() { return this.itemType === "journalArticle"; }
		isNote() { return this.itemType === "note"; }
		getCreatorsJSON() { return []; }
		getCollections() { return this.collections.slice(); }
		setCollections(ids) { this.collections = ids.slice(); }
		getTags() { return structuredClone(this.tags); }
		setTags(values) { this.tags = structuredClone(values); }
		getAttachments() { return []; }
		getNotes() { return [...items.values()].filter(i => i.isNote() && i.parentID === this.id).map(i => i.id); }
		getNote() { return this.note; }
		setNote(s) { this.note = s; }
		async loadDataType(type) { assert.equal(type, "note"); }
		fromJSON(json) { this.fields = { ...json }; }
		toJSON() { return { ...this.fields, note: this.note, tags: structuredClone(this.tags), collections: this.collections.slice(), deleted: !!this.deleted }; }
		async save() {
			if (!this.id) { this.id = ++seq; this.key = "K" + this.id; }
			items.set(this.id, this);
		}
		saveTx() { return this.save(); }
	}
	class Collection {
		constructor() { this.libraryID = 1; this.deleted = false; }
		getChildItems() { return [...items.values()].filter(i => i.collections.includes(this.id)).map(i => i.id); }
		getChildCollections() { return [...collections.values()].filter(c => c.parentID === this.id).map(c => c.id); }
		hasDescendent(type, id) { return type === "collection" && this.getChildCollections().includes(id); }
		async save(opts) {
			if (!this.id) { this.id = ++seq; this.key = "C" + this.id; }
			if (this.deleted) {
				assert.equal(opts.deleteItems, false);
				for (const child of this.getChildCollections()) collections.get(child).deleted = true;
			}
			collections.set(this.id, this);
		}
	}
	let query;
	class Search {
		constructor() { this.filters = []; }
		addCondition(...c) { this.filters.push(c); }
		async search() {
			query = this;
			return [...items.values()].filter(it => it.libraryID === this.libraryID && !it.deleted &&
				this.filters.every(([field, , value]) => field !== "DOI" || it.getField(field).toLowerCase().includes(value))).map(i => i.id);
		}
	}
	global.Zotero = { Item, Collection, Search, locale: "en-US", DB: { executeTransaction: async fn => fn(), waitForTransaction: async () => {} },
		Items: { get: n => items.get(n), getAsync: async ids => ids.map(n => items.get(n)), loadDataTypes: async () => {},
			trash: async ids => ids.forEach(id => { items.get(id).deleted = true; }),
			getAll: async id => [...items.values()].filter(i => i.libraryID === id && !i.deleted).map(i => i.id) },
		Collections: { get: n => collections.get(n), getByLibrary: id => [...collections.values()].filter(c => c.libraryID === id && !c.deleted) },
		Libraries: { get: id => id === 1 ? lib : { editable: false }, hasTrash: () => true },
		ItemTypes: { getID: type => type === "journalArticle" ? 1 : 0 },
		ItemFields: { isValidForType: () => true, getID: f => fields.indexOf(f) + 1,
			getName: n => fields[n - 1], getItemTypeFields: () => fields.map((_, i) => i + 1) },
		getMainWindow: () => ({ setTimeout, clearTimeout, ZoteroPane: { itemsView: {}, collectionsView: { selection: { focused: 0 } } }, DOMParser: class {
			parseFromString(s) { return { querySelectorAll: () => [], body: { textContent: s.replace(/<[^>]+>/g, "").replace(/&lt;/g, "<") } }; }
		} })
	};
	function paper(id, title, doi, lib = 1) {
		const it = new Item("journalArticle");
		Object.assign(it, { id, key: "K" + id, libraryID: lib, fields: { title, DOI: doi, year: "2024" } });
		items.set(id, it);
		return it;
	}
	function collection(id, name) {
		const c = new Collection();
		Object.assign(c, { id, key: "C" + id, name });
		collections.set(id, c);
		return c;
	}
	const a = paper(1, "A", "10.1234/example"), b = paper(2, "B", "10.1234/example");
	const outside = paper(3, "Outside", "10.1234/other", 2);
	const c = collection(8, "Topic"), d = collection(9, "Other");
	const message = { libraryID: 1, selection: [a,b].map(it => ({ itemID: it.id, key: it.key, libraryID: 1 })),
		collections: [{ collectionID: c.id, key: c.key, libraryID: 1 }] };
	const run = async (name, args) => {
		const spec = DeepRead.ToolRegistry["deepread_" + name];
		DeepRead.ToolRuntime.validate(spec, args);
		return spec.run(args, message);
	};
	const apply = (p, chosen = p.rows.map(r => r.id)) => DeepRead.ToolRuntime.applyRows(p, new Set(chosen));
	return { a,b,c,d,outside,message,items,collections,lib,run,apply,query: () => query };
}

test("search scopes all conditions to the captured library, paginates, and refuses a missing filter collection", async () => {
	const f = fixture();
	const results = await f.run("search_library", { query: "abc", title: "T", year: "2024", creator: "Doe", tag: "x", fulltext: "test", collectionID: 8, limit: 1 });
	assert.equal(f.query().filters.length, 6);
	assert.deepEqual(f.query().filters.at(-1), ["collection", "is", "C8"]);
	assert.deepEqual(results.entries.map(i => i.itemID), [1]);
	assert.equal(results.nextOffset, 1);
	assert.equal(results.total, 2);
	await assert.rejects(f.run("search_library", { collectionID: 100 }));
	await assert.rejects(f.run("search_library", { limit: -1 }));
});

test("readable items, grouped statistics, duplicate groups and merge field comparison stay inside the library", async () => {
	const f = fixture();
	assert.equal((await f.run("read_items", {}))[0].fields.DOI, "10.1234/example");
	await assert.rejects(f.run("read_items", { itemIDs: [3] }));
	assert.deepEqual((await f.run("library_statistics", {})).entries, [{ value: "2024", count: 2 }]);
	assert.deepEqual((await f.run("find_duplicates", {})).entries[0].itemIDs, [1,2]);
	assert.deepEqual((await f.run("find_duplicates", { mode: "title_year" })).entries, []);
	assert.deepEqual((await f.run("find_duplicates", { mode: "compare" })).differences.title, ["A","B"]);
	await assert.rejects(f.run("find_duplicates", { mode: "compare", itemIDs: [1] }));
});

test("statistics count each direct membership and distinguish unfiled and same-name collections by ID", async () => {
	const f = fixture();
	f.d.name = f.c.name;
	f.a.setCollections([8, 9]);
	f.outside.setCollections([8]);
	const result = await f.run("library_statistics", { group: "collection" });
	assert.equal(result.records, 2);
	assert.deepEqual(result.entries.map(r => [r.collectionID, r.count]), [[8, 1], [9, 1], [null, 1]]);
});

test("full-text child hits are intersected with metadata on the paper before pagination", async () => {
	const f = fixture();
	const pdf = new Zotero.Item("attachment"); pdf.parentID = 1; await pdf.save();
	Zotero.Search = class {
		constructor() { this.conditions = []; }
		addCondition(...values) { this.conditions.push(values); }
		async search() {
			assert.equal(this.libraryID, 1);
			return this.conditions.some(([key]) => key === "fulltextContent") ? [pdf.id] : [1, 2];
		}
	};
	const result = await f.run("search_library", { year: "2024", fulltext: "clinical" });
	assert.deepEqual(result.entries.map(r => r.itemID), [1]);
});

test("edits only approved selected item fields, honors stale values and permissions", async () => {
	const f = fixture();
	const args = { field: "date", value: "2021" };
	const p = await f.run("edit_item_field", args);
	assert.equal(f.a.getField("date"), "");
	await f.apply(p, ["1"]);
	assert.equal(f.a.getField("date"), "2021"); assert.equal(f.b.getField("date"), "");
	await assert.rejects(f.apply(p));
	const stale = await f.run("edit_item_field", args);
	f.b.setField("date", "2019");
	assert.match(await f.apply(stale), /changed/i);
	const locked = await f.run("edit_item_field", args);
	f.lib.editable = false;
	assert.match(await f.apply(locked), /read-only/);
	assert.equal(f.b.getField("date"), "2019");
	await assert.rejects(f.run("edit_item_field", { ...args, field: "title" }));
	await assert.rejects(f.run("edit_item_field", { ...args, itemIDs: [3] }));
});

test("collection creation, moves, membership and non-destructive subtree trash are individually reviewed", async () => {
	const f = fixture();
	assert.equal((await f.run("collections", {})).total, 2);
	const prepare = a => f.run("manage_collection", a);
	const p = await prepare({ action: "create", name: "Child", parentID: 8 });
	assert.equal(f.collections.size, 2);
	await f.apply(p); assert.equal(f.collections.size, 3);
	const add = await prepare({ action: "add_items", collectionID: 8 });
	await f.apply(add, ["1"]);
	assert.deepEqual((await f.run("collections", { collectionID: 8 })).entries.map(x => x.itemID), [1]);
	const staleTrash = await prepare({ action: "trash", collectionID: 8 });
	assert.match(staleTrash.rows[0].detail, /#21 · Child/);
	await f.apply(await prepare({ action: "remove_items", collectionID: 8 }));
	assert.match(await f.apply(staleTrash), /changed/i);
	assert.deepEqual(f.a.collections, []);
	const rename = await prepare({ action: "rename", collectionID: 8, name: "R" });
	f.c.name = "Concurrent";
	assert.match(await f.apply(rename), /changed/i);
	await f.apply(await prepare({ action: "rename", collectionID: 8, name: "R" }));
	assert.equal(f.c.name, "R");
	await assert.rejects(prepare({ action: "move", collectionID: 8, parentID: 21 }));
	await f.apply(await prepare({ action: "move", collectionID: 8, parentID: 9 }));
	assert.equal(f.c.parentID, 9);
	await assert.rejects(prepare({ action: "trash", collectionID: 9 }), /select/i);
	await f.apply(await prepare({ action: "add_items", collectionID: 8 }));
	const trash = await prepare({ action: "trash", collectionID: 8 });
	assert.equal(trash.rows[0].selected, false);
	await f.apply(trash); assert.equal(f.c.deleted, true);
	assert.equal(f.collections.get(21).deleted, true); assert.equal(f.a.deleted, undefined);
});

test("item creation shows fields and writes to the captured library; trash guards selected objects and children", async () => {
	const f = fixture();
	const create = await f.run("manage_items", { action: "create", title: "Test", fields: { DOI: "10.5555/p" } });
	assert.equal(f.items.size, 3); assert.match(create.rows[0].detail, /10.5555/);
	await f.apply(create); assert.equal(f.items.get(21).getField("DOI"), "10.5555/p");
	const trash = await f.run("manage_items", { action: "trash" });
	assert.equal(trash.rows[0].selected, false);
	const child = new Zotero.Item("note"); child.parentID = 1; await child.save();
	const result = await f.apply(trash, ["1", "2"]);
	assert.match(result, /changed/); assert.equal(f.a.deleted, undefined); assert.equal(f.b.deleted, true);
	await assert.rejects(f.run("manage_items", { action: "trash", itemIDs: [3] }));
});

test("reviewed merge requires explicit master, one library, editable unchanged descendants and no replay", async () => {
	const f = fixture();
	const args = { action: "merge", masterID: 1 };
	await assert.rejects(f.run("manage_items", args), /unavailable/);
	const merged = [];
	Zotero.Items.merge = async (master, others) => { merged.push([master.id, others.map(i => i.id)]); };
	await assert.rejects(f.run("manage_items", { action: "merge", masterID: 3 }));
	await assert.rejects(f.run("manage_items", { ...args, itemIDs: [2,3] }));
	const note = new Zotero.Item("note"); note.parentID = 1; await note.save();
	const stale = await f.run("manage_items", args);
	note.setNote("edited");
	assert.match(await f.apply(stale), /changed/);
	const ready = await f.run("manage_items", args);
	assert.match(ready.rows[0].detail, /Keep master #1.*A/); assert.match(ready.rows[0].detail, /Children #21/);
	assert.equal(ready.rows[0].selected, false);
	const unchecked = await f.run("manage_items", args);
	await f.apply(unchecked, []); assert.deepEqual(merged, []);
	await f.apply(ready); assert.deepEqual(merged, [[1,[2]]]);
	await assert.rejects(f.apply(ready)); assert.equal(merged.length, 1);
});

test("merge refuses an unloaded tree, a busy transaction, and replay while the native result is pending", async () => {
	const f = fixture(), args = { action: "merge", masterID: 1 };
	const win = Zotero.getMainWindow(); Zotero.getMainWindow = () => win;
	let calls = 0, complete;
	Zotero.Items.merge = () => { calls++; return new Promise(resolve => { complete = resolve; }); };
	win.ZoteroPane.collectionsView.selection.focused = -1;
	assert.match(await f.apply(await f.run("manage_items", args)), /library tree to load/);
	win.ZoteroPane.collectionsView.selection.focused = 0;
	Zotero.DB.inTransaction = () => true;
	assert.match(await f.apply(await f.run("manage_items", args)), /busy/);
	assert.equal(calls, 0);
	Zotero.DB.inTransaction = () => false;
	win.setTimeout = callback => { queueMicrotask(callback); return 1; };
	win.clearTimeout = () => {};
	assert.match(await f.apply(await f.run("manage_items", args)), /has not returned a final result/);
	assert.match(await f.apply(await f.run("manage_items", args)), /still processing/);
	assert.equal(calls, 1);
	complete();
});

test("tag replacement merges destination, keeps automatic tag types, and revalidates before writing", async () => {
	const f = fixture();
	f.a.tags = [{ tag: "old", type: 1 }, { tag: "new", type: 0 }, { tag: "keep", type: 1 }];
	f.b.tags = [{ tag: "old", type: 1 }];
	assert.equal((await f.run("list_tags", {})).entries.find(x => x.tag === "old").count, 2);
	const replace = await f.run("manage_tags", { action: "replace", tag: "old", newTag: "new" });
	f.b.tags.push({ tag: "user" });
	assert.match(await f.apply(replace), /changed/i);
	assert.deepEqual(f.a.tags, [{ tag: "new", type: 0 }, { tag: "keep", type: 1 }]);
	assert.equal(f.b.tags[0].tag, "old");
	await f.apply(await f.run("manage_tags", { action: "add", tag: "new" }));
	await f.apply(await f.run("manage_tags", { action: "remove", tag: "new", itemIDs: [1] }));
	assert.deepEqual(f.a.tags, [{ tag: "keep", type: 1 }]);
	await assert.rejects(f.run("manage_tags", { action: "replace", tag: "old" }));
});

test("child notes and export, append and replacement preserve user selection and escape supplied text", async () => {
	const f = fixture();
	const create = await f.run("edit_note", { itemID: 1, action: "create", text: "<safe>" });
	assert.deepEqual(f.a.getNotes(), []);
	await f.apply(create);
	const note = f.items.get(21);
	assert.equal(note.parentID, 1); assert.equal(note.note, "<p>&lt;safe&gt;</p>");
	assert.equal((await f.run("read_notes", { itemID: 1 })).entries[0].itemID, 21);
	assert.equal((await f.run("read_notes", { itemID: 21, format: "html" })).content, note.note);
	await assert.rejects(f.run("edit_note", { itemID: 21, action: "append", text: "append" }));
	f.message.selection.push({ itemID: 21, key: note.key, libraryID: 1, parentItemID: 1 });
	note.setNote('<div data-schema-version="9"><p>note</p></div>');
	await f.apply(await f.run("edit_note", { itemID: 21, action: "append", text: "$&" }));
	assert.equal(note.note, '<div data-schema-version="9"><p>note</p><p>$&amp;</p></div>');
	const replace = await f.run("edit_note", { itemID: 21, action: "replace", text: "new note" });
	assert.equal(replace.rows[0].selected, false);
	note.setNote("user edit"); assert.match(await f.apply(replace), /changed/i);
	assert.equal(note.note, "user edit");
	await f.apply(await f.run("edit_note", { itemID: 21, action: "replace", text: "new note" }));
	assert.equal((await f.run("read_notes", { itemID: 21 })).content, "new note");
});

test("CSL citations release the engine on errors; RIS and BibTeX export only metadata and support continuation", async () => {
	const f = fixture();
	let freed = 0;
	Zotero.Styles = { init: async () => {}, getVisible: () => [{ styleID: "apa", title: "APA" }],
		get: style => style === "invalid" ? null : { getCiteProc: () => ({
			free: () => freed++, updateItems(ids) { assert.deepEqual(ids, [1,2]); }, previewCitationCluster: () => "(A, B)"
		}) } };
	Zotero.Cite = { makeFormattedBibliographyOrCitationList() { throw new Error("style error"); } };
	assert.equal((await f.run("citation", { action: "styles" })).entries[0].id, "apa");
	assert.equal((await f.run("citation", { action: "citation" })).text, "(A, B)");
	await assert.rejects(f.run("citation", { action: "bibliography" }), /style error/);
	await assert.rejects(f.run("citation", { action: "citation", style: "invalid" }));
	assert.equal(freed, 2);
	Zotero.Translate = { Export: class {
		setItems(items) { assert.equal(items[0].id, 1); }
		getTranslators() { return [{ label: "RIS", translatorID: "ris" }, { label: "BibTeX", translatorID: "bibtex" }]; }
		setTranslator(chosen) { this.chosen = chosen; }
		setDisplayOptions(opts) { assert.equal(opts.exportFileData, false); assert.equal(opts.exportNotes, false); }
		async translate() { this.string = "a".repeat(6000) + this.chosen; }
	} };
	for (const format of ["ris", "bibtex"]) {
		const first = await f.run("export_references", { format }); assert.equal(first.nextOffset, 6000);
		const last = await f.run("export_references", { format, offset: first.nextOffset }); assert.equal(last.content, format);
	}
});

test("DOI lookup is read-only through preview, rejects mismatched metadata and prevents duplicates at apply", async () => {
	const f = fixture();
	const wanted = "10.5432/test";
	let returned = "10.1234/incorrect";
	Zotero.Translate = { Search: class {
		setIdentifier(input) { assert.equal(input.DOI, wanted); }
		getTranslators() { return ["Crossref"]; }
		setTranslator() {}
		async translate(options) {
			assert.deepEqual(options, { libraryID: false, saveAttachments: false });
			return [{ itemType: "journalArticle", DOI: returned, title: "Found", creators: [{ firstName: "A", lastName: "B", creatorType: "author" }],
				collections: [500], attachments: [{ url: "ignored" }] }];
		}
	} };
	await assert.rejects(f.run("import_doi", { doi: "invalid" }));
	await assert.rejects(f.run("import_doi", { doi: wanted }), /matching/);
	returned = wanted;
	const one = await f.run("import_doi", { doi: "https://doi.org/" + wanted });
	const two = await f.run("import_doi", { doi: wanted });
	assert.equal(f.items.size, 3);
	assert.match(one.rows[0].detail, /Found/);
	await f.apply(one); assert.equal(f.items.size, 4);
	assert.deepEqual(f.items.get(21).collections, []);
	assert.equal(f.items.get(21).fields.attachments, undefined);
	assert.match(await f.apply(two), /after this proposal/);
	assert.deepEqual((await f.run("import_doi", { doi: wanted })).rows, []);
});
