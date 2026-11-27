const test = require("node:test");
const assert = require("node:assert/strict");
require("../deepread");
require("../tools/ToolRuntime");
require("../tools/ReaderTools");

function fixture() {
	const events = [];
	const file = { id: 7, libraryID: 1, key: "ATT", parentItemID: 2, attachmentReaderType: "epub",
		isFileAttachment: () => true, getDisplayTitle: () => "Selected book" };
	const parent = { id: 2, key: "BOOK", libraryID: 1 };
	const items = new Map([[7, file], [2, parent]]);
	const libraryTab = { id: "zotero-pane", type: "library", title: "Library" };
	const readerTab = { id: "reader-1", type: "reader", title: "Book", data: { itemID: 7 } };
	const tabs = { selectedID: "zotero-pane", _tabs: [libraryTab, readerTab],
		select(id) { this.selectedID = id; events.push(["select", id]); } };
	const win = { Zotero_Tabs: tabs, focus() { events.push("main"); } };
	const standalone = { itemID: 7, _instanceID: "window-1", _window: { focus() { events.push("reader"); } } };
	const tabReader = { itemID: 7, _instanceID: "tab-reader", tabID: "reader-1", _window: win };
	const api = { _readers: [tabReader, standalone], open: async (...args) => { events.push(args); return standalone; } };
	global.Zotero = { Items: { get: id => items.get(id) }, Reader: api, getMainWindow: () => win };
	const message = { libraryID: 1, selection: [{ itemID: 2, key: "BOOK", libraryID: 1, attachmentIDs: [7] }] };
	const run = (name, args) => {
		const spec = DeepRead.ToolRegistry["deepread_" + name];
		DeepRead.ToolRuntime.validate(spec, args);
		return spec.run(args, message);
	};
	const go = (action, target) => run("reader_navigate", { action, ...target });
	const list = (offset = 0) => run("reader_context", { action: "open_tabs", offset });
	const apply = (p, accept = true) => DeepRead.ToolRuntime.applyRows(p, new Set(accept ? ["action"] : []));
	return { events, items, file, tabs, standalone, readerTab, api, win, message, go, list, apply };
}

test("enumerates distinct tab and window IDs; focusing a reviewed surface requires one approval", async () => {
	const { events, go, list, apply } = fixture();
	const inventory = list();
	assert.equal(inventory.tabs[0].active, true);
	assert.deepEqual(inventory.tabs.map(t => t.tabID), ["zotero-pane", "reader-1"]);
	assert.deepEqual(inventory.windows, [{ instanceID: "window-1", attachmentID: 7, title: "Selected book" }]);
	const tab = { tabID: inventory.tabs[1].tabID };
	await apply(go("switch_tab", tab), false);
	assert.deepEqual(events, []);
	const reviewed = go("switch_tab", tab);
	assert.match(reviewed.rows[0].detail, /reader-1.*#7.*Selected book/);
	await apply(reviewed);
	assert.deepEqual(events, ["main", ["select", "reader-1"]]);
	assert.equal(list().tabs[1].active, true);
	await assert.rejects(apply(reviewed), /reviewed/);
	await apply(go("focus_window", { instanceID: "window-1" }));
	await apply(go("switch_tab", { tabID: "zotero-pane" }));
	assert.deepEqual(events.slice(2), ["reader", "main", ["select", "zotero-pane"]]);
	assert.throws(() => go("focus_window", { instanceID: "tab-reader" }), /unavailable/);
	assert.throws(() => go("focus_window", {}), /Specify a listed/);
});

test("large tab lists remain bounded and their remaining IDs can be discovered", () => {
	const { tabs, list } = fixture();
	tabs._tabs.push(...Array.from({ length: 100 }, (_, i) => ({ id: "extra-" + i, title: "Reader", type: "reader" })));
	assert.equal(list().tabs.length, 100);
	assert.equal(list().nextOffset, 100);
	const last = list(100);
	assert.deepEqual(last.tabs.map(t => t.tabID), ["extra-98", "extra-99"]);
	assert.equal(last.nextOffset, null);
});

test("closed, replaced and missing host surfaces do not redirect approved operations", async () => {
	const { events, tabs, api, standalone, go, list, apply, file } = fixture();
	const tab = () => go("switch_tab", { tabID: "reader-1" });
	let p = tab();
	tabs._tabs[1] = { ...tabs._tabs[1] };
	assert.match(await apply(p), /closed or changed/);
	p = tab();
	file.key = "NEW";
	assert.match(await apply(p), /closed or changed/);
	const focus = () => go("focus_window", { instanceID: "window-1" });
	p = focus();
	standalone._window.closed = true;
	assert.match(await apply(p), /closed or changed/);
	assert.deepEqual(list().windows, []);
	assert.deepEqual(events, []);
	tabs._tabs = {};
	assert.equal(list().tabsAvailable, false);
	assert.throws(tab, /unavailable/);
	delete api._readers;
	assert.deepEqual(list().windows, []);
});

test("separate window resolves a single selected attachment; validates scope, identity and native return", async () => {
	const { events, items, message, api, file, go, apply, win } = fixture();
	const open = id => go("open_window", id == null ? {} : { attachmentID: id });
	await apply(open(), false);
	assert.deepEqual(events, []);
	await apply(open());
	assert.deepEqual(events, [[7, null, { openInWindow: true, allowDuplicate: true }], "reader"]);
	items.set(9, { ...file, id: 9, key: "TWO" });
	assert.throws(() => open(9), /outside/);
	message.selection[0].attachmentIDs.push(9);
	assert.throws(() => open(), /Specify one/);
	const stale = open(7);
	file.parentItemID = 22;
	assert.match(await apply(stale), /outside|changed/i);
	file.parentItemID = 2;
	api.open = async () => ({ itemID: 7, _window: win });
	assert.match(await apply(open(7)), /verify/);
	file.attachmentReaderType = null;
	assert.throws(() => open(7), /No built-in reader/);
});
