// Run with Node 22.13+ using node --test tests/storage.test.cjs.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");

require("../deepread.js");
const bootstrap = fs.readFileSync(path.join(__dirname, "../bootstrap.js"), "utf8");
for (const [, script] of bootstrap.matchAll(/loadSubScript\(scriptURI \+ '(tools\/[^']+)'\)/g)) require("../" + script);
require("../agents/SidebarChat.js");

function fixture(t, files = {}, prefs = {}) {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "deepread-test-"));
	for (const [name, data] of Object.entries(files)) {
		fs.writeFileSync(path.join(dir, name), JSON.stringify(data));
	}
	const state = { writes: [], failOn: null };
	global.Zotero = { DataDirectory: { dir }, Prefs: { get: key => prefs[key] } };
	global.IOUtils = { exists: fs.existsSync, readUTF8: file => fs.promises.readFile(file, "utf8") };
	global.PathUtils = path;
	global.ChromeUtils = { importESModule: () => ({ Sqlite: {
		openConnection({ path: filename }) {
			const sql = new DatabaseSync(filename);
			const execute = (query, args = []) => {
				if (state.failOn && query.includes(state.failOn)) throw new Error("simulated write failure");
				if (/^(DELETE|INSERT)/.test(query)) state.writes.push([query, args[0]]);
				return sql.prepare(query).all(...args).map(r => ({ getResultByName: k => r[k] }));
			};
			return {
				execute, executeCached: execute, close: () => sql.close(),
				async executeTransaction(fn) {
					sql.exec("BEGIN");
					try { await fn(); sql.exec("COMMIT"); }
					catch (e) { sql.exec("ROLLBACK"); throw e; }
				}
			};
		}
	} }) };
	DeepRead.SidebarChat._loaded = false;
	t.after(async () => {
		await DeepRead.Store.close();
		fs.rmSync(dir, { recursive: true, force: true });
	});
	return { dir, state, store: DeepRead.Store, side: DeepRead.SidebarChat };
}

test("four legacy files import together, preserving messages, empty chats and defaults", async t => {
	const messages = [
		{ role: "user", content: "整理", selection: { items: [{ id: 35, key: "Q23" }] } },
		{ role: "assistant", toolCalls: [{ id: "call-1", arguments: { item: 35 } }] },
		{ role: "tool", toolCallId: "call-1", content: "结果" }
	];
	const itemPreset = { name: "概览", prompt: "总结" };
	const custom = { id: "custom", name: "分析", prompt: "列出方法" };
	const files = {
		"deepread_history.json": { "35": messages },
		"deepread_prompts.json": [itemPreset],
		"deepread_sidebar_chat.json": { version: 2, activeId: "b", conversations: [
			{ id: "a", title: "空", messages: [] }, { id: "b", title: "会话", messages }
		] },
		"deepread_sidebar_prompts.json": { defaultId: "custom", presets: [custom] }
	};
	const { dir, state, store, side } = fixture(t, files);
	await store.open();
	assert.deepEqual(store.itemHistory().get("35"), messages);
	assert.deepEqual(await DeepRead.loadPromptPresets(), [itemPreset]);
	assert.deepEqual(await side.load(), messages);
	assert.equal(side._activeId, "b");
	assert.deepEqual(side._conversations[0].messages, []);
	await side.loadPrompts();
	assert.deepEqual(side._presets.map(p => p.id), ["builtin-organize", "custom"]);
	assert.equal(side._defaultPresetId, "custom");

	state.writes.length = 0;
	side._messages.pop();
	await side.save();
	assert.deepEqual(state.writes.map(w => w[1]), ["b"]);
	await side.savePrompts([side._presets[0]], "builtin-organize");
	await DeepRead.savePromptPresets([{ ...itemPreset, name: "快速概览" }]);
	await store.saveChats([side._conversations[0]], "a");
	await store.saveHistory(new Map());
	await store.close();
	await store.open();
	assert.deepEqual(store.sidebarChats().conversations.map(c => c.id), ["a"]);
	assert.equal(store.sidebarChats().activeId, "a");
	assert.equal(store.itemHistory().size, 0);
	assert.equal((await store.readPresets(true)).defaultId, "builtin-organize");
	assert.equal((await DeepRead.loadPromptPresets())[0].name, "快速概览");
	for (const [name, original] of Object.entries(files)) {
		assert.equal(fs.readFileSync(path.join(dir, name), "utf8"), JSON.stringify(original));
	}
});

test("queued edits and resend persist in order and write only the edited chat", async t => {
	const { store, state } = fixture(t);
	await store.open();
	const history = new Map([["10", []], ["11", [{ role: "user", content: "另一个" }]]]);
	await store.saveHistory(history);
	state.writes.length = 0;
	const chat = history.get("10");
	chat.push({ role: "user", content: "问题" });
	const first = store.saveHistory(history, "10");
	chat.push({ role: "assistant", content: "旧回答" });
	const second = store.saveHistory(history, "10");
	chat.pop();
	const deleted = store.saveHistory(history, "10");
	chat.push({ role: "assistant", content: "新回答" });
	const resent = store.saveHistory(history, "10");
	await Promise.all([first, second, deleted, resent]);
	assert.deepEqual(state.writes.map(w => w[1]), ["10", "10", "10", "10"]);
	await store.close();
	await store.open();
	assert.deepEqual(store.itemHistory(), history);
});

test("failed migration rolls back, then retries with old preferences and v1 sidebar chat", async t => {
	const first = { role: "user", content: "早期的消息" };
	const { dir, store, state } = fixture(t, {
		"deepread_sidebar_chat.json": { messages: [first] },
		"deepread_sidebar_prompts.json": [{ name: "条目整理", prompt: "自定义过的提示" }]
	}, { "extensions.deepread.history": JSON.stringify({ "123": [first] }) });
	state.failOn = "INSERT OR REPLACE INTO sidebar_presets";
	await assert.rejects(store.open(), /simulated/);
	const sql = new DatabaseSync(path.join(dir, "deepread.sqlite"));
	try {
		assert.equal(sql.prepare("PRAGMA user_version").get().user_version, 0);
		assert.deepEqual(sql.prepare("SELECT name FROM sqlite_master WHERE type='table'").all(), []);
	} finally { sql.close(); }
	state.failOn = null;
	await store.open();
	assert.deepEqual(store.itemHistory().get("123"), [first]);
	assert.deepEqual(store.sidebarChats().conversations[0].messages, [first]);
	assert.equal((await store.readPresets(true)).presets[0].id, "builtin-organize");
	assert.equal((await store.readPresets(true)).presets[0].prompt, "自定义过的提示");
	assert.equal((await store.readPresets(false)).presets.length, 1);
	const revised = new Map([["next", [first]]]);
	state.failOn = "INSERT OR REPLACE INTO item_chats";
	await assert.rejects(store.saveHistory(revised), /simulated/);
	assert.deepEqual(store.itemHistory().get("123"), [first]);
	state.failOn = null;
	await store.saveHistory(revised);
	await store.close();
	await store.open();
	assert.deepEqual(store.itemHistory(), revised);
});

test("malformed JSON is preserved and the migration can be retried", async t => {
	const { dir, store } = fixture(t);
	const file = path.join(dir, "deepread_history.json");
	fs.writeFileSync(file, "{");
	await assert.rejects(store.open(), /deepread_history.json/);
	assert.equal(fs.readFileSync(file, "utf8"), "{");
	fs.writeFileSync(file, "{}");
	await store.open();
	assert.equal(store.itemHistory().size, 0);
});

test("fresh storage catalogs all built-ins and reconciles stale declarations on restart", async t => {
	const { dir, store, state } = fixture(t);
	await store.open();
	await store.close();
	const sql = new DatabaseSync(path.join(dir, "deepread.sqlite"));
	try {
		assert.equal(sql.prepare("PRAGMA user_version").get().user_version, 2);
		const rows = sql.prepare("SELECT * FROM tools ORDER BY name").all();
		assert.deepEqual(rows.map(r => r.name), Object.keys(DeepRead.ToolRegistry).sort());
		const exposed = rows.filter(r => r.floating_chat).map(r => r.name);
		assert.deepEqual(exposed, Object.values(DeepRead.ToolRegistry).filter(t => t.floatingChat).map(t => t.name).sort());
		for (const name of ["deepread_get_context", "deepread_manage_attachment", "deepread_edit_annotations",
			"deepread_import_references", "deepread_sync_status", "deepread_search_library"]) assert.ok(exposed.includes(name), name);
		for (const name of ["deepread_manage_items", "deepread_manage_collection", "deepread_edit_annotations", "deepread_edit_note"]) {
			const row = rows.find(r => r.name === name);
			assert.deepEqual([row.read_only, row.confirmation], [0, "apply_selected"]);
		}
		const plan = rows.find(r => r.name === "deepread_plan_organize");
		assert.equal(plan.read_only, 1);
		assert.equal(plan.confirmation, "apply_selected");
		assert.deepEqual(JSON.parse(plan.input_schema), DeepRead.ToolRegistry[plan.name].inputSchema);
		const del = rows.find(r => r.name === "delete_attachment");
		assert.deepEqual([del.domain, del.source, del.risk, del.read_only, del.confirmation],
			["attachments", "deepread", "high", 0, "explicit"]);
		assert.throws(() => DeepRead.registerTool(DeepRead.ToolRegistry[plan.name]), /Duplicate/);
		sql.exec("UPDATE tools SET name = 'removed_tool' WHERE name = 'delete_attachment'");
		sql.exec("UPDATE tools SET domain = 'old_domain' WHERE name = 'set_item_field'");
	} finally { sql.close(); }
	state.writes.length = 0;
	await store.open();
	assert.deepEqual(state.writes.map(w => w[1]).sort(), ["delete_attachment", "removed_tool", "set_item_field"]);
	await store.close();
	state.writes.length = 0;
	await store.open();
	assert.deepEqual(state.writes, []);
});

test("v1 upgrades atomically without reimporting or rewriting any conversation or preset", async t => {
	const { dir, store, state } = fixture(t);
	const file = path.join(dir, "deepread.sqlite");
	const tables = ["item_chats", "sidebar_chats", "item_presets", "sidebar_presets"];
	const initial = new DatabaseSync(file);
	try {
		for (const table of tables) {
			initial.exec("CREATE TABLE " + table + " (id TEXT PRIMARY KEY NOT NULL, data TEXT NOT NULL, position INTEGER NOT NULL, selected INTEGER NOT NULL)");
			initial.prepare("INSERT INTO " + table + " VALUES (?, ?, ?, ?)").run("old", '[{"text":"keep"}]', 7, 1);
		}
		initial.exec("PRAGMA user_version = 1");
	} finally { initial.close(); }
	fs.writeFileSync(path.join(dir, "deepread_history.json"), "{");
	state.failOn = "INSERT OR REPLACE INTO tools";
	await assert.rejects(store.open(), /simulated/);
	const rolledBack = new DatabaseSync(file);
	try {
		assert.equal(rolledBack.prepare("PRAGMA user_version").get().user_version, 1);
		assert.deepEqual(rolledBack.prepare("SELECT name FROM sqlite_master WHERE name='tools'").all(), []);
	} finally { rolledBack.close(); }
	state.failOn = null;
	await store.open();
	await store.close();
	const upgraded = new DatabaseSync(file);
	try {
		assert.equal(upgraded.prepare("PRAGMA user_version").get().user_version, 2);
		assert.equal(upgraded.prepare("SELECT COUNT(*) AS n FROM tools").get().n, Object.keys(DeepRead.ToolRegistry).length);
		for (const table of tables) {
			assert.deepEqual({ ...upgraded.prepare("SELECT * FROM " + table).get() },
				{ id: "old", data: '[{"text":"keep"}]', position: 7, selected: 1 });
		}
	} finally { upgraded.close(); }
});
