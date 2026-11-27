const { test } = require("node:test");
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
require("../deepread.js");
require("../tools/ToolRuntime.js");
require("../agents/McpServer.js");

function fakeHost() {
	const entries = new Map();
	return {
		registerTool(def) {
			if (entries.has(def.name)) throw Error("collision");
			entries.set(def.name, def);
		},
		unregisterTool(name) { entries.delete(name); },
		unregisterAllTools(id) {
			for (const [name, entry] of entries) if (entry.pluginID === id) entries.delete(name);
		},
		getRegisteredTools: () => [...entries.values()],
		entries
	};
}

function fixture(t, online = true) {
	const api = fakeHost();
	const prefs = new Map();
	const applied = [];
	let observer;
	const window = { crypto: { randomUUID }, ZoteroPane: {
		getSelectedItems: () => [], getSelectedCollections: () => [], getSelectedLibraryID: () => 42
	} };
	global.Zotero = {
		getMainWindow: () => window, ZoteroMCP: online ? { api } : null,
		Plugins: { addObserver: o => { observer = o; }, removeObserver: o => { assert.equal(o, observer); observer = null; } },
		Prefs: { get: k => prefs.get(k), set: (k, v) => prefs.set(k, v) }
	};
	const spec = { name: "deepread_test", domain: "items", source: "deepread", description: "Fixture",
		floatingChat: true, inputSchema: { type: "object", properties: {} }, annotations: { readOnlyHint: true },
		run: async (_args, msg) => ({ libraryID: msg.libraryID }) };
	const planSpec = { ...spec, name: "deepread_test_plan",
		run: async () => ({ rows: ["a", "b"].map(id => ({ id, name: "Change", detail: id, execute: () => {} })), notes: [] }),
		apply: async (_plan, ids) => { applied.push(...ids); return "result"; } };
	DeepRead.ToolRegistry = { [spec.name]: spec, [planSpec.name]: planSpec,
		private: { ...spec, name: "private", floatingChat: false }, unreviewed_write: { ...spec, name: "unreviewed_write", annotations: {} } };
	const server = DeepRead.McpServer;
	server.start();
	t.after(() => server.stop());
	return { server, api, spec, planSpec, applied, window, observer: () => observer,
		startCall: () => api.entries.get(planSpec.name).handler({}), apply: args => api.entries.get("deepread_apply_plan").handler(args),
		result: async planId => { await new Promise(resolve => setImmediate(resolve)); return api.entries.get("deepread_plan_result").handler({ planId }); } };
}

test("external hosting defaults off, follows host lifecycle and blocks stale callbacks", async t => {
	const { server, api, observer } = fixture(t, false);
	assert.equal(server.status().enabled, false);
	server.setEnabled(true);
	assert.deepEqual(server.status(), { enabled: true, hostAvailable: false, count: 0, error: "" });
	Zotero.ZoteroMCP = { api };
	observer().startup({ id: "zotero-mcp-plugin@autoagent.my" });
	assert.deepEqual([...api.entries.keys()].sort(), ["deepread_apply_plan", "deepread_plan_result", "deepread_test", "deepread_test_plan"]);
	const lookup = api.entries.get("deepread_test").handler;
	assert.deepEqual(await lookup({}), { libraryID: 42 });
	await assert.rejects(lookup({ libraryID: 9, selection: [] }), /argument/);
	const replacement = fakeHost();
	observer().shutdown({ id: "zotero-mcp-plugin@autoagent.my" });
	Zotero.ZoteroMCP = { api: replacement };
	observer().startup({ id: "zotero-mcp-plugin@autoagent.my" });
	await assert.rejects(lookup({}), /enabled/);
	assert.equal(replacement.entries.size, 4);
	server.setEnabled(false);
	assert.equal(replacement.entries.size, 0);
});

test("external previews contain no executable payload; approval honors local rows once", async t => {
	const { server, api, startCall, apply, applied, result } = fixture(t);
	server.setEnabled(true);
	const preview = await startCall();
	assert.deepEqual(preview.rows[0], { id: "a", name: "Change", detail: "a" });
	assert.deepEqual(applied, []);
	await assert.rejects(apply({ planId: preview.planId, rowIds: ["missing"] }), /change IDs/);
	await assert.rejects(apply({ planId: preview.planId, rowIds: ["a", "a"] }), /change IDs|argument/);
	t.mock.method(DeepRead.ToolRuntime, "review", async (_window, rows) => {
		assert.deepEqual(rows.map(r => r.id), ["b"]);
		return new Set(["a", "b"]);
	});
	assert.equal((await apply({ planId: preview.planId, rowIds: ["b"] })).status, "awaiting_local_review");
	assert.equal((await result(preview.planId)).result, "result");
	assert.deepEqual(applied, ["b"]);
	await assert.rejects(apply({ planId: preview.planId, rowIds: ["b"] }), /expired/);
	assert.equal(api.entries.has("unreviewed_write"), false);
});

test("cancellation, expiry, disabled tools and export shutdown never authorize a pending write", async t => {
	const { server, startCall, apply, applied, planSpec, result, api } = fixture(t);
	server.setEnabled(true);
	const review = t.mock.method(DeepRead.ToolRuntime, "review", async () => null);
	const args = async () => ({ planId: (await startCall()).planId, rowIds: ["a"] });
	const cancelled = await apply(await args());
	assert.equal((await result(cancelled.planId)).status, "cancelled");
	const expired = await args();
	const now = Date.now();
	const clock = t.mock.method(Date, "now", () => now + 310000);
	await assert.rejects(apply(expired), /expired/);
	clock.mock.restore();
	const disabled = await args();
	DeepRead.ToolRuntime.setEnabled(planSpec, false);
	DeepRead.ToolRuntime.setEnabled(planSpec, true);
	await assert.rejects(apply(disabled), /expired/);
	let finish;
	review.mock.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
	t.mock.method(DeepRead.ToolRuntime, "cancelReview", () => finish?.(new Set(["a"])));
	const pending = await apply(await args());
	assert.equal((await result(pending.planId)).status, "awaiting_local_review");
	await assert.rejects(apply(await args()), /pending/);
	const getResult = api.entries.get("deepread_plan_result").handler;
	server.stop();
	await assert.rejects(getResult({ planId: pending.planId }), /enabled/);
	assert.deepEqual(applied, []);
});

test("register collisions preserve other plugins and recover after the name is released", t => {
	const { server, api } = fixture(t);
	api.registerTool({ name: "deepread_test", pluginID: "other" });
	server.setEnabled(true);
	assert.match(server.status().error, /collision/);
	assert.equal(api.entries.get("deepread_test").pluginID, "other");
	api.unregisterTool("deepread_test");
	server.refresh();
	assert.equal(api.entries.get("deepread_test").pluginID, "deepread@zotero.org");
	server.stop();
	assert.equal(api.entries.size, 0);
});
