const test = require("node:test");
const assert = require("node:assert/strict");
require("../deepread");
for (const name of ["ToolRuntime", "ZoteroAtomTools", "OrganizeRenameTool", "ToolDiscovery", "AttachmentTools", "TransferTools"]) require("../tools/" + name);
require("../agents/SidebarChat");
require("../agents/ToolCenter");
const R = DeepRead.ToolRuntime, reg = DeepRead.ToolRegistry;

function fixture(t) {
	const prefs = new Map(), lib = { libraryID: 1, editable: true, filesEditable: true, name: "Library" };
	t.mock.method(DeepRead, "_pref", (k, d) => prefs.get(k) ?? d);
	t.mock.method(DeepRead, "_setPref", (k, v) => prefs.set(k, v));
	const objects = new Map();
	function add(id, parentID) {
		const fields = { title: parentID ? "Attachment" : "Paper" };
		const obj = { id, key: "K" + id, libraryID: 1, parentID, itemType: parentID ? "attachment" : "book",
			get parentItemID() { return this.parentID; }, getField: key => fields[key], setField: (k, v) => fields[k] = v,
			getDisplayTitle: () => fields.title, isAttachment: () => !!parentID, isRegularItem: () => !parentID,
			isFileAttachment: () => !!parentID, isStoredFileAttachment: () => !!parentID, isEditable: () => true,
			getAttachments: () => [...objects.values()].filter(o => o.parentID === id).map(o => o.id), saveTx: async () => {},
			attachmentFilename: "old.pdf", exists: false, fileExists: async () => obj.exists,
			async renameAttachmentFile(name) { this.attachmentFilename = name; return true; }
		};
		objects.set(id, obj); return obj;
	}
	const paper = add(1), child = add(2, 1), dest = add(3);
	const win = { ZoteroPane: { getSelectedLibraryID: () => 1, getSelectedItems: () => [paper, dest], getSelectedCollections: () => [] } };
	global.Zotero = { getMainWindow: () => win, Items: { get: id => objects.get(id) }, Libraries: { get: id => id === 1 && lib } };
	DeepRead._locale = "en";
	const msg = R.capture(win);
	const prepare = (name, args) => reg[name].run(R.validate(reg[name], args), msg);
	const apply = plan => R.applyRows(plan, new Set(plan.rows.map(r => r.id)));
	return { lib, child, paper, dest, win, prepare, apply, objects, prefs, msg };
}

test("attachment operations use captured parents and children and perform only the reviewed action", async t => {
	const { child, prepare, apply, lib } = fixture(t);
	const manage = args => prepare("deepread_manage_attachment", args);
	assert.equal((await prepare("deepread_list_attachments", {})).items[0].fileExists, false);
	await assert.rejects(manage({ action: "rename", attachmentID: 2, newName: "../out.pdf" }), /valid filename/);
	const rename = await manage({ action: "rename", attachmentID: 2, newName: "paper.pdf" });
	assert.equal(child.attachmentFilename, "old.pdf");
	assert.match(await apply(rename), /paper.pdf/);
	await assert.rejects(apply(rename), /already reviewed/);
	const stale = await manage({ action: "move", attachmentID: 2, parentItemID: 3 });
	assert.equal(stale.rows[0].selected, false);
	child.key = "replacement";
	assert.match(await apply(stale), /changed/);
	child.key = "K2";
	assert.match(await apply(await manage({ action: "move", attachmentID: 2, parentItemID: 3 })), /#1 → #3/);
	await assert.rejects(manage({ action: "trash", attachmentID: 2 }), /captured selection/);
	child.parentID = 1;
	const denied = await manage({ action: "trash", attachmentID: 2 });
	lib.filesEditable = false;
	assert.match(await apply(denied), /not writable/);
	assert.ok(!child.deleted);
	lib.filesEditable = true;
	assert.match(await apply(await manage({ action: "trash", attachmentID: 2 })), /Moved to trash/);
	assert.equal(child.deleted, true);
});

test("managed file picker and sync download report cancellations and missing files", async t => {
	const { child, prepare, apply, win } = fixture(t);
	const manage = args => prepare("deepread_manage_attachment", args);
	const imported = [];
	let chosen = false;
	win.FilePicker = class {
		init() {} appendFilters() {} get returnOK() { return 0; } get file() { return "/test/paper.pdf"; }
		async show() { return chosen ? 0 : 1; }
	};
	Zotero.Attachments = { async importFromFile(args) { imported.push(args); return { id: 8, attachmentFilename: "paper.pdf" }; } };
	assert.match(await apply(await manage({ action: "import", parentItemID: 1 })), /cancelled/);
	assert.equal(imported.length, 0); chosen = true;
	assert.match(await apply(await manage({ action: "import", parentItemID: 1 })), /#8/);
	assert.equal(imported[0].parentItemID, 1);
	Zotero.Sync = { Runner: { downloadFile: async () => false } };
	assert.match(await apply(await manage({ action: "download", attachmentID: 2 })), /did not produce/);
	Zotero.Sync.Runner.downloadFile = async () => { child.exists = true; };
	assert.match(await apply(await manage({ action: "download", attachmentID: 2 })), /File downloaded/);
	let revealed;
	win.ZoteroPane.showAttachmentInFilesystem = async id => { revealed = id; };
	assert.match(await apply(await manage({ action: "reveal", attachmentID: 2 })), /Revealed file/);
	assert.equal(revealed, 2);
});

test("RIS/BibTeX preview never saves; only selected rows enter the captured, writable library", async t => {
	const { prepare, lib } = fixture(t), saved = [];
	let fmt = "RIS", supplied, records = ["One", "Two"].map(title => ({ itemType: "book", title, date: "2022", attachments: [{ path: "private" }], tags: [{ tag: "sample" }] }));
	Zotero.Translate = { Import: class {
		setString(value) { supplied = value; } async getTranslators() { return [{ label: fmt }]; } setTranslator() {}
		async translate(options) { assert.deepEqual(options, { libraryID: false, saveAttachments: false }); return records; }
	} };
	Zotero.ItemTypes = { getID: type => type === "book" && 2 };
	Zotero.ItemFields = { getItemTypeFields: () => [1, 2], getName: id => ["", "title", "date"][id], getFieldIDFromTypeAndBase: () => 1 };
	Zotero.Utilities = { Item: { itemToAPIJSON: item => [{ title: null, tags: item.tags, key: "external", path: "/private" }] } };
	Zotero.Item = class { fromJSON(json) { this.data = json; } getField(k) { return this.data[k]; } async saveTx() { saved.push(this); this.id = 75; } };
	for (fmt of ["RIS", "BibTeX"]) {
		const before = saved.length;
		const p = await prepare("deepread_import_references", { text: "translated text" });
		assert.equal(supplied, "translated text"); assert.equal(saved.length, before);
		assert.match(p.rows[1].detail, /Two/);
		assert.match(await R.applyRows(p, new Set([p.rows[1].id])), /Unchecked[\s\S]*#75/);
		assert.deepEqual(saved.at(-1).data, { itemType: "book", title: "Two", date: "2022", tags: [{tag: "sample"}] });
	}
	const p = await prepare("deepread_import_references", { text: "record" });
	lib.editable = false; assert.match(await R.applyRows(p, new Set([p.rows[0].id])), /read-only/);
	assert.equal(saved.length, 2);
	lib.editable = true;
	records = [{ itemType: "book", attachments: [{ path: "ignored" }] }];
	await assert.rejects(prepare("deepread_import_references", { text: "record" }), /No bibliographic metadata/);
});

test("reordered fields in identical native write requests produce one review and one write", async t => {
	fixture(t);
	const side = DeepRead.SidebarChat;
	let writes = 0, prepared = 0;
	const spec = { name: "deepread_create_fixture", run() {
		prepared++;
		return { rows: [{ id: "new", name: "Add record", execute() { writes++; return "saved"; } }] };
	}, apply: R.applyRows };
	t.mock.method(side, "_loadTools", async () => [spec]);
	t.mock.method(side, "_doc", () => null);
	t.mock.method(side, "_renderMessages", () => {});
	t.mock.method(side, "save", async () => {});
	t.mock.method(side, "_confirmPlan", async rows => { assert.equal(rows.length, 1); return [true]; });
	side._messages = [{ role: "user", content: "Create a sample record with deepread_create_fixture" }];
	DeepRead.provider = { config: { model: "test" }, chat: async () => ({ toolCalls: [
		{ name: spec.name, id: "a", arguments: { fields: { year: "2000", title: "Test" }, type: "book" } },
		{ name: spec.name, id: "b", arguments: { type: "book", fields: { title: "Test", year: "2000" } } }
	] }) };
	await side._runTurn();
	assert.equal(prepared, 1); assert.equal(writes, 1);
	assert.match(side._messages.at(-1).content, /saved/);
});

test("library sync is scoped and requires review; concurrent sync and provider errors are reported", async t => {
	const { prepare, apply } = fixture(t);
	const seen = [];
	Zotero.Sync = { Runner: { enabled: true, syncInProgress: false, lastSyncStatus: "done", async sync(opts) { seen.push(opts.libraries); } } };
	assert.equal((await prepare("deepread_sync_status", {})).enabled, true);
	const p = await prepare("deepread_sync_library", {});
	assert.deepEqual(seen, []);
	assert.match(await apply(p), /done/); assert.deepEqual(seen, [[1]]);
	const stale = await prepare("deepread_sync_library", {});
	Zotero.Sync.Runner.syncInProgress = true;
	assert.match(await apply(stale), /already running/); assert.equal(seen.length, 1);
	Zotero.Sync.Runner.syncInProgress = false;
	Zotero.Sync.Runner.sync = async opts => { opts.onError(new Error("offline")); };
	assert.match(await apply(await prepare("deepread_sync_library", {})), /offline/);
});

test("tool center validates JSON, honors disable during confirmation and stores metadata-only activity", async t => {
	const { win, prefs } = fixture(t);
	const tool = reg.deepread_manage_attachment;
	assert.throws(() => R.validate(tool, { action: "trash", attachmentID: "2" }), /attachmentID/);
	assert.throws(() => R.validate(tool, { action: "trash", attachmentID: 2, bypass: true }), /Invalid/);
	t.mock.method(R, "review", async (_win, rows) => { R.setEnabled(tool, false); return new Set([rows[0].id]); });
	await assert.rejects(DeepRead.ToolCenter.testTool(tool, { action: "trash", attachmentID: 2 }, win), /disabled/);
	assert.equal(R.lastCall(tool).status, "error");
	assert.ok(!prefs.get("extensions.deepread.tools.recent").includes("attachmentID"));
	R.setEnabled(tool, true);
	assert.match(await DeepRead.ToolCenter.testTool(reg.deepread_list_attachments, {}, win), /old.pdf/);
});

test("deferred tools cannot run until discovered and advertised on the next model request", async t => {
	const { msg } = fixture(t);
	const side = DeepRead.SidebarChat, find = DeepRead.ToolDiscovery.find, calls = [];
	const candidates = Array.from({ length: 28 }, (_, i) => ({ name: "action_" + i, domain: "test", description: "Mock",
		annotations: { readOnlyHint: true }, run: () => { calls.push(i); return i; } }));
	const target = candidates.at(-1);
	t.mock.method(side, "_loadTools", async () => [find, ...candidates]);
	side._messages = [{ role: "user", content: "Test lookup", ...msg }];
	let round = 0;
	DeepRead.provider = { config: { model: "fixture" }, async chat(messages, { tools }) {
		if (round++ === 0) {
			assert.ok(!tools.includes(target));
			return { toolCalls: [{ name: find.name, id: "q", arguments: { query: target.name } }, { name: target.name, id: "early", arguments: {} }] };
		}
		if (round === 2) {
			assert.ok(tools.includes(target));
			assert.match(messages.find(m => m.toolCallId === "early").content, /not offered/);
			return { toolCalls: [{ name: target.name, id: "approved", arguments: {} }] };
		}
		return { content: "Done" };
	} };
	await side._runTurn(); assert.deepEqual(calls, [27]);
});

test("tool reasoning survives the active DeepSeek exchange without entering storage or another model's history", async t => {
	fixture(t);
	const side = DeepRead.SidebarChat;
	const spec = { name: "read_fixture", annotations: { readOnlyHint: true }, run: () => "demo" };
	t.mock.method(side, "_loadTools", async () => [spec]);
	t.mock.method(side, "_renderMessages", () => {});
	t.mock.method(side, "_doc", () => null);
	t.mock.method(side, "save", () => {});
	side._messages = [{ role: "user", content: "Use read_fixture" }];
	let round = 0;
	DeepRead.provider = { config: { model: "alpha", _providerName: "deepseek" }, baseURL: "local", async chat(history) {
		if (!round++) return { deepseekReasoning: "private-token", toolCalls: [{ id: "a", name: spec.name, arguments: {} }] };
		assert.equal(history.at(-2).deepseekReasoning, "private-token");
		return { content: "done", deepseekReasoning: "private-final" };
	} };
	await side._runTurn();
	assert.ok(!JSON.stringify(side._messages).includes("private-"));
	const history = side._messages.concat({ role: "user", content: "continue" });
	assert.ok(side._forModel(history, [spec]).some(m => m.deepseekReasoning === "private-token"));
	DeepRead.provider.config.model = "beta";
	const changed = side._forModel(history, [spec]);
	assert.ok(!changed.some(m => m.deepseekReasoning || m.toolCalls?.length || m.role === "tool"));
	assert.ok(changed.some(m => m.content.includes("demo")));
});

test("partial parallel tool histories preserve readable results without replaying broken calls", t => {
	fixture(t);
	DeepRead.provider = { config: { model: "m", _providerName: "openai" } };
	const history = [{ role: "user", content: "search" }, { role: "assistant", model: "m", toolCalls: [{ id: "a" }, { id: "b" }] },
		{ role: "tool", toolCallId: "b", name: "search", content: "one record" }, { role: "user", content: "continue" }];
	const output = DeepRead.SidebarChat._forModel(history, []);
	assert.ok(!output.some(m => m.toolCalls?.length || m.role === "tool"));
	assert.ok(output.some(m => m.content.includes("one record")));
});

test("model prompts omit duplicated schema names and keep local inventory details only for references to the list", t => {
	fixture(t);
	const side = DeepRead.SidebarChat, example = reg.deepread_list_attachments;
	const inventory = { role: "assistant", content: "1. " + example.name + " · list files" };
	const history = [{ role: "user", content: "/tools" }, inventory];
	for (const tagged of [false, true]) {
		if (tagged) inventory.toolInventory = true;
		const task = { role: "user", content: "Rename the attachment" };
		const prompt = side._forModel([...history, task], [example]);
		assert.ok(prompt.every(m => !m.content.includes(example.name)));
		assert.match(prompt.at(-1).content, /Rename the attachment/);
		const reference = { role: "user", content: "Explain the first one" };
		assert.equal(side._forModel([...history, reference], [example])[1].content, inventory.content);
	}
	const pure = { role: "user", content: "Write a poem" };
	assert.equal(side._forModel([pure], []).at(-1).content, pure.content);
});

test("successive discovery batches replace older schemas and a last-step match gets one callable step", async t => {
	fixture(t);
	const side = DeepRead.SidebarChat, find = DeepRead.ToolDiscovery.find;
	const targets = ["a", "b", "c", "d"].map(key => ({
		name: "fixture_" + key, domain: "test", description: key,
		annotations: { readOnlyHint: true }, run: () => key
	}));
	t.mock.method(side, "_loadTools", async () => [find, ...targets]);
	t.mock.method(side, "_doc", () => null);
	t.mock.method(side, "_renderMessages", () => {});
	t.mock.method(side, "save", () => {});
	side._messages = [{ role: "user", content: "请协助完成库内任务" }];
	let step = 0;
	DeepRead.provider = { config: { model: "fixture" }, chat: async (messages, { tools }) => {
		if (step === 5) {
			assert.equal(tools, undefined);
			assert.equal(messages.at(-1).content, '"d"');
			return { content: "Done" };
		}
		const names = (tools || []).map(t => t.name);
		if (step < 4) assert.ok(names.includes(find.name));
		else assert.ok(!names.includes(find.name));
		const matches = names.filter(n => n.startsWith("fixture_"));
		assert.deepEqual(matches, step ? [targets[step - 1].name] : []);
		const calls = step ? [{ name: targets[step - 1].name, id: "run" + step, arguments: {} }] : [];
		if (step < 4) calls.push({ name: find.name, id: "find" + step, arguments: { query: targets[step].name } });
		step++;
		return { toolCalls: calls };
	} };
	await side._runTurn();
	assert.equal(step, 5); assert.equal(side._messages.at(-1).content, "Done");
});

test("independently approved writes execute in order and recheck authorization after waiting", async t => {
	fixture(t);
	let started, finish;
	const active = new Promise(resolve => { started = resolve; });
	const release = new Promise(resolve => { finish = resolve; });
	const first = { name: "first", async apply() { started(); await release; return "done"; } };
	const next = { name: "next", apply: () => assert.fail("tool disabled while waiting") };
	const a = R.applyReviewed(first, {}, new Set(["1"]));
	await active;
	const b = R.applyReviewed(next, {}, new Set(["2"]));
	R.setEnabled(next, false);
	finish(); assert.equal(await a, "done");
	await assert.rejects(b, /disabled/);
});

test("PDF page pixels enter only the live multimodal request and never the saved messages", async t => {
	const { msg } = fixture(t), side = DeepRead.SidebarChat;
	const image = { mimeType: "image/png", data: "YWJjZA==" };
	const spec = { name: "deepread_read_pdf", annotations: { readOnlyHint: true }, run: () => ({ attachmentID: 2, page: 3, image }) };
	t.mock.method(side, "_loadTools", async () => [spec]);
	for (const supportsToolImages of [true, false]) {
		side._messages = [{ role: "user", content: "read figure", ...msg }];
		let round = 0;
		DeepRead.provider = { config: { model: "fixture" }, supportsToolImages, chat: async messages => {
			if (!round++) return { toolCalls: [{ name: spec.name, id: "r", arguments: { action: "image" } }] };
			const tool = messages.find(m => m.role === "tool");
			if (supportsToolImages) {
				assert.deepEqual(messages.at(-1).images, [image]); assert.match(tool.content, /imageProvided/);
			} else assert.match(tool.content, /cannot receive/);
			return { content: "Done" };
		} };
		await side._runTurn();
		assert.ok(!JSON.stringify(side._messages).includes(image.data));
	}
});
