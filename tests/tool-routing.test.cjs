const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

require("../deepread.js");
const bootstrap = fs.readFileSync(path.join(__dirname, "../bootstrap.js"), "utf8");
for (const [, file] of bootstrap.matchAll(/loadSubScript\(scriptURI \+ '(tools\/[^']+)'\)/g)) require("../" + file);
require("../agents/SidebarChat.js");
require("../agents/McpClient.js");

const side = DeepRead.SidebarChat;
const router = DeepRead.ToolDiscovery;
const native = side._nativeTools();
const snapshot = {
	libraryID: 1,
	selection: [{ itemID: 12, key: "ARTICLE", libraryID: 1, title: "Selected paper", attachmentIDs: [13] }],
	collections: [{ collectionID: 22, key: "FOLDER", libraryID: 1, name: "Folder" }],
	reader: { attachmentID: 13, libraryID: 1, page: 2, selectedText: "A paragraph in the PDF" }
};
const organizer = ["deepread_get_context", "deepread_list_attachments", "deepread_plan_organize", "deepread_find_tools"].sort();
const names = tools => tools.map(tool => tool.name).sort();
const user = (content, context = {}) => ({ role: "user", content, ...context });
const external = {
	name: "mcp_8_catalogx_search_trials", mcpName: "search_trials", server: "catalogx",
	description: "Search clinical trials in the catalog.", inputSchema: { type: "object", properties: { query: { type: "string" } } }
};

test("both stock organizer presets and short requests expose only the four organizer tools", t => {
	const locale = DeepRead._locale;
	t.after(() => { DeepRead._locale = locale; });
	const prompts = ["整理选中条目", "Organize the selected items"];
	for (const lang of ["zh", "en"]) {
		DeepRead._locale = lang;
		const { presets } = side._normalizePresets([]);
		prompts.push(presets.find(preset => preset.id === "builtin-organize").prompt);
	}
	for (const text of prompts) {
		const offered = router.select([...native, external], user(text, snapshot));
		assert.deepEqual(names(offered), organizer, text);
	}
});

test("standalone writing exposes zero schemas despite an active PDF, selections and tool keywords in supplied text", () => {
	for (const prompt of [
		"你好",
		"请润色下面这句话：这个附件的标签有错，需要分类。",
		"Translate this sentence into Chinese: The reader opened a PDF and added a note.",
		"请润色这句话：“打开笔记，然后添加标签。”",
		'Translate this sentence: "Open the note, then add a tag."'
	]) {
		const msg = user(prompt, snapshot);
		assert.equal(router.isTextOnly(msg), true, prompt);
		assert.deepEqual(router.select([...native, external], msg), [], prompt);
	}
	const fromReader = user("翻译当前 PDF 里选中的文字", snapshot);
	assert.equal(router.isTextOnly(fromReader), false);
	assert.ok(router.select(native, fromReader).some(t => t.name === "deepread_reader_context"));
});

test("scoped tasks expose the requested capability without unrelated writes or a filled default list", () => {
	for (const [prompt, target] of [
		["给选中的文献添加标签", "deepread_manage_tags"],
		["Import a paper into Zotero by DOI", "deepread_import_doi"]
	]) {
		const selected = names(router.select(native, user(prompt, snapshot)));
		assert.ok(selected.includes(target), prompt);
		assert.ok(!selected.includes("deepread_sync_library"), prompt);
		assert.ok(!selected.includes("deepread_manage_attachment"), prompt);
		assert.ok(selected.length < native.length / 2, prompt);
		assert.equal(new Set(selected).size, selected.length);
	}
});

test("a writing request followed by an explicit Zotero save keeps the note tool available when discovery is off", () => {
	const withAndWithoutDiscovery = [native, native.filter(tool => tool !== router.find)];
	for (const prompt of [
		"请先翻译下面这句话：The sky is blue. 然后把译文追加到选中条目的笔记。",
		"Translate the following: This is a test. Then append the translation to the selected note.",
		"请改写“太阳升起来了”，然后把改好的句子保存到选中条目的笔记。",
		'Rewrite "The sun came up", then save the result to my selected note.'
	]) {
		const msg = user(prompt, snapshot);
		assert.equal(router.isTextOnly(msg), false, prompt);
		for (const available of withAndWithoutDiscovery) {
			assert.ok(names(router.select(available, msg)).includes("deepread_edit_note"), prompt);
		}
	}
});

test("a tag filter on a library search exposes the search tool that accepts a tag", () => {
	const available = native.filter(tool => tool !== router.find);
	for (const prompt of [
		"在文献库里查找标签为「待读」的条目",
		"Search my Zotero library for papers tagged follow-up"
	]) {
		assert.ok(names(router.select(available, user(prompt))).includes("deepread_search_library"), prompt);
	}
});

test("disabled discovery and organizer tools stay unavailable and unrelated tools do not fill the gap", t => {
	const disabled = ["deepread_find_tools", "deepread_plan_organize"];
	t.mock.method(DeepRead, "_pref", (key, fallback) => key === "extensions.deepread.tools.disabled"
		? JSON.stringify(disabled.map(name => JSON.stringify([name]))) : fallback);
	const available = side._nativeTools();
	assert.ok(disabled.every(name => !names(available).includes(name)));
	const expected = organizer.filter(name => !disabled.includes(name));
	for (const tools of [available, available.filter(t => expected.includes(t.name) || t.name === "deepread_sync_library")]) {
		assert.deepEqual(names(router.select(tools, user("整理选中条目", snapshot))), expected);
	}
});

test("external tools can be routed by either callable name and discovered by their remote name", () => {
	const available = [...native, external];
	for (const name of [external.name, external.mcpName]) {
		const selected = router.select(available, user("Please run " + name + " for the term asthma"));
		assert.ok(selected.includes(external), name);
		assert.ok(!selected.includes(DeepRead.ToolRegistry.deepread_manage_items), name);
	}
	const found = router.find.run({ query: external.mcpName }, {}, available);
	assert.ok(found.tools.some(t => t.name === external.name));
	assert.ok(!router.find.run({ query: external.mcpName }, {}, native).tools.some(t => t.name === external.name));
});

test("an explicit external tool after a creative writing instruction is callable on the first turn", () => {
	for (const prompt of [
		"写一首短诗，再调用 search_trials 查询相关临床试验。",
		"Write a short poem, then use catalogx search_trials to find relevant trials."
	]) {
		const msg = user(prompt, snapshot);
		assert.equal(router.isTextOnly(msg), false, prompt);
		assert.ok(router.select([...native, external], msg).includes(external), prompt);
	}
});

test("short follow-ups retain a recent tool task and a new standalone writing request starts fresh", () => {
	const first = user("给选中的文献添加标签", snapshot);
	const name = "deepread_manage_tags", call = { name, id: "t1", arguments: { action: "add", tag: "read" } };
	const history = [first, { role: "assistant", toolCalls: [call] }, { role: "tool", name, toolCallId: "t1", content: "Applied" },
		{ role: "assistant", content: "The tag was added." }];
	for (const text of ["继续", "Continue"]) {
		const follow = user(text, snapshot);
		for (const past of [history, [...history, follow]]) {
			assert.ok(names(router.select(native, follow, past)).includes(name), text);
		}
	}
	const rewrite = user("请润色这句话：阳光很好。", snapshot);
	assert.deepEqual(router.select(native, rewrite, [...history, rewrite]), []);
});

test("a plain-text floating chat turn skips MCP discovery and sends no tools to the model", async t => {
	const message = user("Translate this sentence into Chinese: A tag identifies each record.", snapshot);
	const messages = side._messages, provider = DeepRead.provider;
	t.after(() => { side._messages = messages; DeepRead.provider = provider; });
	side._messages = [message];
	t.mock.method(side, "_doc", () => null);
	t.mock.method(side, "_renderMessages", () => {});
	t.mock.method(side, "save", () => {});
	t.mock.method(DeepRead.Mcp, "isEnabled", () => true);
	const discovery = t.mock.method(DeepRead.Mcp, "listTools", async () => [external]);
	let calls = 0;
	DeepRead.provider = { config: { model: "fixture" }, async chat(_history, opts) {
		calls++;
		assert.equal(opts.tools, undefined);
		return { content: "每条记录都由一个标签标识。" };
	} };
	await side._runTurn();
	assert.equal(calls, 1);
	assert.equal(discovery.mock.callCount(), 0);
	assert.equal(side._messages.at(-1).content, "每条记录都由一个标签标识。");
});
