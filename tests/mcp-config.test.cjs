const { test } = require("node:test");
const assert = require("node:assert/strict");

require("../deepread.js");
require("../tools/ZoteroAtomTools.js");
require("../tools/SidebarOrganizeTools.js");
require("../agents/McpClient.js");
require("../agents/SidebarChat.js");

const mcp = DeepRead.Mcp;
const side = DeepRead.SidebarChat;
const enabledKey = "extensions.deepread.mcp.enabled";
const serversKey = "extensions.deepread.mcp.servers";

function fixture(t, enabled, servers = {}) {
	const prefs = new Map([[enabledKey, enabled], [serversKey, JSON.stringify({ mcpServers: servers })]]);
	t.mock.method(DeepRead, "_pref", (key, fallback) => prefs.get(key) ?? fallback);
	t.mock.method(DeepRead, "log", () => {});
	global.Zotero = { Prefs: { get: key => prefs.get(key), set: (key, value) => prefs.set(key, value) } };
	DeepRead._locale = "zh";
	DeepRead.provider = null;
	side._messages = [];
	mcp.reset();
	t.after(() => mcp.reset());
	return prefs;
}

test("capability questions work without a model key or a connection", async t => {
	fixture(t, false, { zotero: { url: "http://localhost:23120/mcp" } });
	t.mock.method(global, "fetch", () => assert.fail("MCP disabled"));
	t.mock.method(DeepRead, "syncProviderConfig", () => assert.fail("Inventory does not call a model"));
	for (const q of ["/tools", "你现在支持哪些功能？"]) {
		await side._send(q, null);
		assert.match(side._messages.at(-1).content, /deepread_get_context/);
		assert.match(side._messages.at(-1).content, /deepread_plan_organize/);
		assert.doesNotMatch(side._messages.at(-1).content, /search_library/);
	}
});

test("discovery isolates failures, honors per-server headers and routes same-named tools", async t => {
	const prefs = fixture(t, true, {
		first: { url: "https://first.test/mcp", headers: { Authorization: "Bearer fixture" } },
		second: { url: "https://second.test/mcp" },
		offline: { url: "https://offline.test/mcp" },
		disabled: { url: "https://disabled.test/mcp", enabled: false }
	});
	const calls = [];
	t.mock.method(global, "fetch", async (url, req) => {
		const host = new URL(url).hostname;
		assert.notEqual(host, "disabled.test");
		if (host === "offline.test") throw Error("offline");
		const { method, params, id } = JSON.parse(req.body);
		const headers = new Headers(req.headers);
		assert.equal(headers.get("Authorization"), host === "first.test" ? "Bearer fixture" : null);
		let result;
		if (method === "initialize") {
			result = { protocolVersion: "2025-03-26" };
		} else {
			assert.equal(headers.get("Mcp-Session-Id"), host);
			if (!id) return new Response(null, { status: 202 });
			if (method === "tools/list") {
				result = params?.cursor ? { tools: [{ name: "second_page" }] } :
					{ tools: [{ name: "lookup", description: "Look up a reference" }], nextCursor: "more" };
			} else {
				assert.equal(method, "tools/call");
				calls.push([host, params.name]);
				result = { content: [{ type: "text", text: host }] };
			}
		}
		return Response.json({ jsonrpc: "2.0", id, result }, { headers: { "Mcp-Session-Id": host } });
	});
	const tools = await side._loadTools();
	const matches = tools.filter(tool => tool.mcpName === "lookup");
	assert.equal(matches.length, 2);
	assert.notEqual(matches[0].name, matches[1].name);
	assert.equal(tools.filter(t => t.mcpName === "second_page").length, 2);
	const report = side._toolInventory(tools);
	assert.match(report, /first/);
	assert.match(report, /second/);
	assert.doesNotMatch(report, /Bearer|fixture|https:\/\//);
	for (const tool of matches) assert.equal(await mcp.callTool(tool, {}), tool.server + ".test");
	assert.deepEqual(calls, [["first.test", "lookup"], ["second.test", "lookup"]]);
	prefs.set(serversKey, JSON.stringify({ mcpServers: { first: { url: "https://different.test/mcp" } } }));
	await assert.rejects(mcp.callTool(matches[0], {}));
	prefs.set(enabledKey, false);
	await assert.rejects(mcp.callTool(matches[1], {}));
	assert.equal(calls.length, 2);
});

test("an empty or invalid server list leaves native tools usable", async t => {
	const prefs = fixture(t, true);
	t.mock.method(global, "fetch", () => assert.fail("No usable endpoints"));
	assert.deepEqual(await side._loadTools(), side._nativeTools());
	prefs.set(serversKey, "{");
	assert.deepEqual(await side._loadTools(), side._nativeTools());
});

test("external tools with unknown effects require confirmation even when their names look read-only", () => {
	const needsConfirm = (server, name, annotations) => side._needsConfirm({ name }, [{ name, server, mcpName: name, annotations }]);
	assert.equal(needsConfirm("zotero", "get_content"), false);
	assert.equal(needsConfirm("another", "get_content"), true);
	assert.equal(needsConfirm("zotero", "get_and_reset"), true);
	assert.equal(needsConfirm("another", "lookup", { readOnlyHint: true }), false);
	assert.equal(needsConfirm("zotero", "get_content", { destructiveHint: true }), true);
});

test("old Zotero URL survives upgrade and malformed edits do not replace saved configuration", t => {
	const prefs = fixture(t, false);
	prefs.delete(serversKey);
	prefs.set("extensions.deepread.mcp.url", "http://localhost:9001/legacy");
	assert.equal(JSON.parse(mcp.configText()).mcpServers.zotero.url, "http://localhost:9001/legacy");
	const original = '{"mcpServers":{"papers":{"url":"https://papers.test/api"}}}';
	mcp.saveConfig(original);
	mcp.setEnabled(true);
	assert.equal(mcp.isEnabled(), true);
	for (const invalid of ["{", "[]", '{"mcpServers":{"bad":{"command":"node"}}}']) {
		assert.throws(() => mcp.saveConfig(invalid));
		assert.deepEqual(JSON.parse(mcp.configText()), JSON.parse(original));
	}
	mcp.setEnabled(false);
	assert.equal(mcp.isEnabled(), false);
	assert.deepEqual(JSON.parse(mcp.configText()), JSON.parse(original));
});
