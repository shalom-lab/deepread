const { test } = require("node:test");
const assert = require("node:assert/strict");

require("../deepread.js");
require("../tools/ToolRuntime.js");
require("../tools/ToolDiscovery.js");
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

test("only known reads from the local Zotero MCP bypass review", t => {
	t.mock.method(mcp, "isLocalZoteroTool", tool => tool.server === "local");
	const needsConfirm = (server, name, annotations) => side._needsConfirm({ name }, [{ name, server, mcpName: name, annotations }]);
	assert.equal(needsConfirm("local", "get_content"), false);
	assert.equal(needsConfirm("zotero", "get_content", { readOnlyHint: true }), true);
	assert.equal(needsConfirm("another", "get_content"), true);
	assert.equal(needsConfirm("local", "get_and_reset", { readOnlyHint: true }), true);
	assert.equal(needsConfirm("local", "update_collection", { readOnlyHint: true }), true);
	assert.equal(needsConfirm("another", "lookup", { readOnlyHint: true }), true);
	assert.equal(needsConfirm("local", "get_content", { destructiveHint: true }), true);
});

test("discovery identifies the default Zotero endpoint independently of the configured name", async t => {
	fixture(t, true, {
		local: { url: "http://127.0.0.1:23120/mcp" }, zotero: { url: "https://remote.test/mcp" }
	});
	t.mock.method(global, "fetch", async (_url, req) => {
		const { id, method } = JSON.parse(req.body);
		if (!id) return new Response(null, { status: 202 });
		const result = method === "initialize" ? { protocolVersion: "2025-03-26" } : { tools: [{ name: "get_content" }] };
		return Response.json({ jsonrpc: "2.0", id, result });
	});
	const [local, remote] = await mcp.listTools();
	assert.equal(mcp.isLocalZoteroTool(local), true);
	assert.equal(mcp.isLocalZoteroTool(remote), false);
	assert.equal(mcp.isLocalZoteroTool({ ...local }), false);
});

test("reviewed mixed operations report native results, selected MCP responses, skipped rows and uncertain outcomes", async t => {
	fixture(t, false);
	const nativeResult = "Paper <A> $id$ " + "x".repeat(8050) + " end";
	const planned = { name: "local_plan", annotations: { readOnlyHint: true }, run: async () => ({ rows: [{ id: 1 }], notes: [] }),
		apply: async (_plan, rows) => { assert.deepEqual([...rows], [1]); return nativeResult; } };
	const external = { name: "mcp_custom", server: "remote", mcpName: "write_item", annotations: { readOnlyHint: true } };
	t.mock.method(side, "_loadTools", async () => [planned, external]);
	let reviews = 0;
	t.mock.method(side, "_confirmPlan", async rows => {
		reviews++;
		assert.equal(rows.length, 4);
		assert.deepEqual(rows.map(r => r.name || r.id), [1, "mcp_custom", "mcp_custom", "mcp_custom"]);
		return [true, true, false, true];
	});
	const invoked = [];
	t.mock.method(mcp, "callTool", async (_spec, args) => {
		invoked.push(args.itemID);
		if (args.itemID === 3) throw Error("timeout");
		return "updated title";
	});
	side._messages = [{ role: "user", content: "Apply these changes with local_plan and mcp_custom" }];
	DeepRead.provider = { config: { model: "test" }, chat: async () => {
		assert.equal(reviews, 0, "reviewed writes should end this turn");
		return { toolCalls: [
			{ name: planned.name, id: "plan", arguments: {} },
			...[1, 2, 3].map(itemID => ({ name: external.name, id: String(itemID), arguments: { itemID } }))
		] };
	} };
	await side._runTurn();
	assert.deepEqual(invoked, [1, 3]);
	assert.equal(reviews, 1);
	const receipt = side._messages.at(-1);
	assert.equal(receipt.receipt, true);
	assert.ok(receipt.content.includes(nativeResult));
	assert.match(receipt.content, /remote.*itemID：1\n服务返回 · updated title/);
	assert.match(receipt.content, /itemID：2\n未执行/);
	assert.match(receipt.content, /itemID：3\n无法核实执行结果.*timeout/);
	assert.deepEqual(JSON.parse(side._toolArgsText({ server: "remote", receipt: true, arguments: { itemID: 1, nested: { field: nativeResult } } })),
		{ itemID: 1, nested: { field: nativeResult } });
	assert.equal(side._messages.find(m => m.role === "tool" && m.name === planned.name).content, nativeResult);
	assert.equal(side._forModel(side._messages, [planned]).find(m => m.role === "tool").content.endsWith("…"), true);
});

test("canceling a combined review runs neither the native apply function nor the external tool", async t => {
	fixture(t, false);
	const planned = { name: "local_plan", run: async () => ({ rows: [{ id: "file", name: "Rename file" }] }),
		apply: () => assert.fail("cancelled native apply") };
	const remote = { name: "rename_item", mcpName: "rename_item", server: "remote" };
	t.mock.method(side, "_loadTools", async () => [planned, remote]);
	t.mock.method(mcp, "callTool", () => assert.fail("cancelled external call"));
	let reviews = 0;
	t.mock.method(side, "_confirmPlan", async rows => {
		reviews++;
		assert.deepEqual(rows.map(row => row.name), ["Rename file", "rename_item"]);
		return null;
	});
	side._messages = [{ role: "user", content: "Rename them with local_plan and rename_item" }];
	DeepRead.provider = { config: { model: "test" }, chat: async () => ({ toolCalls: [
		{ name: remote.name, id: "mcp" }, { name: planned.name, id: "native" }
	] }) };
	await side._runTurn();
	assert.equal(reviews, 1);
	assert.match(side._messages.at(-1).content, /未执行/);
	assert.match(side._messages.at(-1).content, /已取消本次修改/);
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
