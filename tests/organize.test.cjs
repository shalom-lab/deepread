const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const vm = require("node:vm");

require("../deepread.js");
for (const file of ["tools/OfficialMetaLookup", "tools/ZoteroAtomTools", "tools/OrganizeRenameTool",
	"agents/OrganizeAgent", "tools/SidebarOrganizeTools", "agents/McpClient", "agents/SidebarChat"]) require("../" + file);
const registry = DeepRead.ToolRegistry;
const organize = registry.deepread_plan_organize;
const side = DeepRead.SidebarChat;

function fixture(t) {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "deepread-organize-"));
	t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
	const records = new Map();
	const library = { editable: true, filesEditable: true };
	global.Zotero = { Items: { get: id => records.get(id), erase: id => records.delete(id) }, Libraries: { get: () => library } };
	function add(id, parent, filename) {
		const fields = { title: "Original " + id };
		const item = {
			id, key: "KEY" + id, libraryID: 1, parentID: parent, attachmentFilename: filename,
			get parentItemID() { return this.parentID; },
			get attachmentPath() { return this.attachmentFilename; },
			isRegularItem: () => !parent, isAttachment: () => !!parent,
			isPDFAttachment: () => !!filename?.endsWith(".pdf"),
			getAttachments: () => [...records.values()].filter(it => it.parentItemID === id).map(it => it.id),
			isStoredFileAttachment: () => true,
			getField: k => fields[k] || "", setField: (k, v) => { fields[k] = v; },
			saveTx: async () => {},
			async renameAttachmentFile(name) {
				const old = path.join(dir, this.attachmentFilename);
				const next = path.join(dir, name);
				if (!fs.existsSync(old)) return false;
				if (old === next) return true;
				if (fs.existsSync(next)) return -1;
				fs.renameSync(old, next);
				this.attachmentFilename = name;
				return true;
			}
		};
		if (filename) fs.writeFileSync(path.join(dir, filename), String(id));
		records.set(id, item);
		return item;
	}
	const paper = add(1);
	const pdf = add(2, 1, "old.pdf");
	const html = add(3, 1, "link.html");
	const other = add(4);
	const message = { role: "user", content: "整理", ts: 100, collections: [], selection: [
		{ itemID: 1, key: paper.key, libraryID: 1, attachmentIDs: paper.getAttachments() }
	] };
	t.mock.method(DeepRead, "syncProviderConfig", async () => {});
	t.mock.method(DeepRead.OfficialMeta, "lookupOfficial", async () => ({ ok: true, title: "Official", source: "crossref", sourceLabel: "Crossref" }));
	DeepRead.provider = { config: {} };
	DeepRead._locale = "en";
	return { dir, records, paper, pdf, html, other, message, library, add, scope: DeepRead.AtomTools.buildScopeFromItems([paper, other]) };
}

test("set_item_title requires official metadata and a scoped item", async t => {
	const { scope, paper } = fixture(t);
	const tool = registry.set_item_title;
	const args = { itemID: 1, title: "Updated" };
	assert.equal((await tool.run(args, scope)).ok, false);
	assert.equal((await tool.run({ ...args, officialSource: "Crossref" })).ok, false);
	assert.equal((await tool.run({ ...args, officialSource: "Crossref" }, scope)).ok, true);
	assert.equal(paper.getField("title"), "Updated");
});

test("set_item_field validates the field and rejects unrelated item IDs", async t => {
	const { scope, paper } = fixture(t);
	const tool = registry.set_item_field;
	for (const field of ["title", "unsupported"]) assert.equal((await tool.run({ itemID: 1, field, value: "bad" }, scope)).ok, false);
	assert.equal((await tool.run({ itemID: 7, field: "date", value: "2025" }, scope)).ok, false);
	assert.equal((await tool.run({ itemID: 1, field: "date", value: "2025" }, scope)).ok, true);
	assert.equal(paper.getField("date"), "2025");
});

test("rename_attachment distinguishes name collisions, missing files and partial saves", async t => {
	const { dir, scope, pdf } = fixture(t);
	const run = () => registry.rename_attachment.run({ attachmentID: 2, newName: "next.pdf" }, scope);
	fs.writeFileSync(path.join(dir, "next.pdf"), "other");
	assert.match((await run()).error, /exists/);
	assert.equal(fs.readFileSync(path.join(dir, "next.pdf"), "utf8"), "other");
	fs.unlinkSync(path.join(dir, "next.pdf"));
	t.mock.method(pdf, "saveTx", async () => { throw new Error("read only"); });
	const partial = await run();
	assert.equal(partial.ok, false);
	assert.equal(partial.fileRenamed, true);
	assert.equal(partial.titleUpdated, false);
	assert.equal(pdf.getField("title"), "Original 2");
	assert.equal(fs.readFileSync(path.join(dir, "next.pdf"), "utf8"), "2");
	fs.unlinkSync(path.join(dir, "next.pdf"));
	assert.match((await run()).error, /missing/);
});

test("move_attachment checks both targets, library, and explicit selection", async t => {
	const { scope, pdf, other } = fixture(t);
	const step = { tool: "move_attachment", args: { attachmentID: 2, toItemID: 4 } };
	assert.equal((await DeepRead.AtomTools.runPlan([step], scope))[0].skipped, true);
	assert.equal((await registry.move_attachment.run({ attachmentID: 2, toItemID: 10 }, scope)).ok, false);
	other.libraryID = 2;
	assert.equal((await registry.move_attachment.run(step.args, scope)).ok, false);
	other.libraryID = 1;
	assert.equal((await DeepRead.AtomTools.runPlan([{ ...step, selected: true }], scope))[0].ok, true);
	assert.equal(pdf.parentItemID, 4);
});

test("delete_attachment skips unchecked operations, excludes HTML, and defaults to trash", async t => {
	const { scope, pdf, records } = fixture(t);
	const step = { tool: "delete_attachment", args: { attachmentID: 2 } };
	assert.equal((await DeepRead.AtomTools.runPlan([step], scope))[0].skipped, true);
	assert.equal((await registry.delete_attachment.run({ attachmentID: 3 }, scope)).ok, false);
	assert.equal((await DeepRead.AtomTools.runPlan([{ ...step, selected: true }], scope))[0].trashed, true);
	assert.equal(pdf.deleted, true);
	assert.equal(records.has(2), true);
});

test("get_context uses the message snapshot, including an unavailable or empty selection", t => {
	const { message } = fixture(t);
	const get = registry.deepread_get_context.run;
	assert.deepEqual(get({}, message), { items: message.selection, capturedAt: 100, collections: [] });
	assert.equal(get({}, {}).items, null);
	assert.deepEqual(get({}, { selection: [] }).items, []);
});

test("organize only applies checked rows, renames the file on disk and cannot replay the plan", async t => {
	const { dir, message, paper, pdf, add } = fixture(t);
	add(8, 1, "later.pdf");
	const plan = await organize.run({}, message);
	assert.deepEqual(plan.rows.map(r => r.id), ["set_item_title-1", "rename_attachment-2"]);
	assert.match(plan.rows[1].detail, /Filename · old\.pdf → .*Display title · Original 2 →/);
	assert.equal(pdf.attachmentFilename, "old.pdf");
	const ids = new Set([plan.rows[1].id, "rename_attachment-8"]);
	const receipt = await organize.apply(plan, ids);
	assert.match(receipt, /Unchecked · #1 · Item title/);
	assert.ok(receipt.includes("Applied · #2 · Filename · old.pdf → " + pdf.attachmentFilename + " · Display title · Original 2 → " + pdf.getField("title")));
	assert.equal(paper.getField("title"), "Original 1");
	assert.equal(pdf.attachmentFilename, pdf.getField("title"));
	assert.equal(fs.readFileSync(path.join(dir, pdf.attachmentFilename), "utf8"), "2");
	assert.equal(await organize.apply(plan, new Set(plan.rows.map(r => r.id))), "");
	assert.equal(paper.getField("title"), "Original 1");
});

test("partial organize receipt records the actual filename when the display title cannot be saved", async t => {
	const { dir, message, pdf } = fixture(t);
	const plan = await organize.run({ kind: "attachments" }, message);
	t.mock.method(pdf, "saveTx", async () => { throw new Error("save failed"); });
	const receipt = await organize.apply(plan, new Set(plan.rows.map(r => r.id)));
	assert.ok(receipt.includes("Partially applied · #2 · Filename · old.pdf → " + pdf.attachmentFilename));
	assert.match(receipt, /save failed/);
	assert.match(receipt, /Display title unchanged/);
	assert.doesNotMatch(receipt, /Display title · Original 2 →/);
	assert.equal(pdf.getField("title"), "Original 2");
	assert.equal(fs.readFileSync(path.join(dir, pdf.attachmentFilename), "utf8"), "2");
});

test("organize excludes changed, moved, missing and read-only targets after confirmation", async t => {
	const { message, paper, pdf, library, records } = fixture(t);
	const plan = await organize.run({}, message);
	paper.setField("title", "Manual edit");
	pdf.parentID = 4;
	const all = new Set(plan.rows.map(r => r.id));
	assert.equal((await organize.apply(plan, all)).split("Skipped").length - 1, 2);
	assert.equal(pdf.attachmentFilename, "old.pdf");
	pdf.parentID = 1;
	const retry = await organize.run({}, message);
	library.filesEditable = false;
	records.delete(1);
	assert.match(await organize.apply(retry, all), /Skipped/);
	records.set(1, paper);
	const readOnly = await organize.run({ kind: "attachments" }, message);
	assert.match(await organize.apply(readOnly, all), /Skipped/);
});

test("a Zotero relink error after a disk rename leaves the disk outcome unverified in the receipt", async t => {
	const { dir, message, pdf } = fixture(t);
	const plan = await organize.run({ kind: "attachments" }, message);
	t.mock.method(pdf, "renameAttachmentFile", async name => {
		fs.renameSync(path.join(dir, "old.pdf"), path.join(dir, name));
		return -2;
	});
	const receipt = await organize.apply(plan, new Set(plan.rows.map(r => r.id)));
	assert.match(receipt, /Failed · #2.*Filename on disk unverified/);
	assert.equal(fs.existsSync(path.join(dir, "old.pdf")), false);
	assert.equal(pdf.attachmentFilename, "old.pdf");
});

test("child selection stays limited to itself and no official source blocks title updates", async t => {
	const { message, pdf, add } = fixture(t);
	message.selection = [{ itemID: 2, libraryID: 1, key: pdf.key, parentItemID: 1 }];
	add(5, 1, "sibling.pdf");
	assert.deepEqual((await organize.run({}, message)).rows.map(r => r.id), ["rename_attachment-2"]);
	message.selection = [{ itemID: 1, key: "KEY1", libraryID: 1, attachmentIDs: [] }];
	DeepRead.OfficialMeta.lookupOfficial = async () => ({ source: "none", error: "No DOI" });
	const plan = await organize.run({ kind: "titles" }, message);
	assert.deepEqual(plan.rows, []);
	assert.match(plan.notes[0], /No DOI/);
	await assert.rejects(organize.run({}, { selection: [] }), /selected/);
	await assert.rejects(organize.run({ kind: "erase" }, message), /kind/);
});

test("floating Agent runs locally with MCP offline, rejects forged tool calls, and cancellation writes nothing", async t => {
	const { message, pdf } = fixture(t);
	t.mock.method(DeepRead.Mcp, "isEnabled", () => true);
	t.mock.method(DeepRead.Mcp, "listTools", async () => { throw Error("offline"); });
	t.mock.method(DeepRead.Mcp, "callTool", () => assert.fail("unexpected MCP call"));
	t.mock.method(DeepRead, "log", () => {});
	t.mock.method(side, "_confirmPlan", async rows => {
		assert.equal(rows.length, 1);
		assert.match(rows[0].detail, /old.pdf/);
		return null;
	});
	side._messages = [message];
	DeepRead.provider.chat = async (_messages, config) => {
		assert.deepEqual(config.tools.map(t => t.name), ["deepread_get_context", "deepread_plan_organize"]);
		return { toolCalls: [
			{ id: "1", name: "delete_attachment", arguments: { attachmentID: 2 } },
			{ id: "2", name: "deepread_plan_organize", arguments: { kind: "attachments" } }
		] };
	};
	await side._runTurn();
	assert.match(side._messages.find(m => m.role === "tool" && m.name === "delete_attachment").content, /not offered/);
	assert.match(side._messages.at(-1).content, /cancelled/);
	assert.equal(pdf.deleted, undefined);
	assert.equal(pdf.attachmentFilename, "old.pdf");
});

for (const name of ["Gemini", "OpenAI", "DeepSeek"]) {
	test(name + " adapter publishes native schemas and decodes a planning call", async () => {
		const toolName = organize.name;
		const context = vm.createContext({ Date, fetch: async (_url, options) => {
			const payload = JSON.parse(options.body);
			const specs = name === "Gemini" ? payload.tools[0].functionDeclarations : payload.tools.map(t => t.function);
			assert.equal(specs.length, 2);
			assert.deepEqual(specs.find(t => t.name === toolName).parameters.properties.kind.enum, ["all", "titles", "attachments"]);
			const result = name === "Gemini" ? { candidates: [{ content: { parts: [{ functionCall: { name: toolName, args: { kind: "titles" } } }] } }] }
				: { choices: [{ message: { tool_calls: [{ id: "1", function: { name: toolName, arguments: '{"kind":"titles"}' } }] } }] };
			return { ok: true, json: async () => result };
		} });
		for (const file of ["BaseAI", name]) {
			vm.runInContext(fs.readFileSync(path.join(__dirname, "../providers/" + file + "Provider.js"), "utf8"), context);
		}
		const provider = new context[name + "Provider"]({ apiKey: "mock", model: "mock" });
		const result = await provider.chat([{ role: "user", content: "organize" }], { tools: side._nativeTools() });
		assert.equal(result.toolCalls[0].name, toolName);
		assert.equal(result.toolCalls[0].arguments.kind, "titles");
	});
}

test("MCP collisions preserve the local tool and route long aliases to the correct remote name", async t => {
	fixture(t);
	const mcp = DeepRead.Mcp;
	mcp.reset();
	const prefix = "x".repeat(64);
	const names = [organize.name, prefix + "A", prefix + "B"];
	const called = [];
	t.mock.method(DeepRead, "_pref", (key, fallback) => key === "extensions.deepread.mcp.enabled" ? true : fallback);
	t.mock.method(global, "fetch", async (_url, req) => {
		const { id, method, params } = JSON.parse(req.body);
		if (!id) return new Response(null, { status: 202 });
		let result = { protocolVersion: "2025-03-26" };
		if (method === "tools/list") result = { tools: names.map(name => ({ name })) };
		if (method === "tools/call") { called.push(params.name); result = { content: [{ text: "ok" }] }; }
		return Response.json({ jsonrpc: "2.0", id, result });
	});
	const tools = await side._loadTools();
	assert.equal(tools.find(t => t.name === organize.name), organize);
	assert.equal(new Set(tools.map(t => t.name)).size, 4);
	const second = tools.find(t => t.mcpName === prefix + "B");
	assert.ok(second.name.length <= 64);
	assert.equal(await mcp.callTool(second, {}), "ok");
	assert.deepEqual(called, [prefix + "B"]);
	mcp.reset();
	await assert.rejects(mcp.callTool(second, {}));
	assert.equal(called.length, 1);
});

test("failed bounded PDF preview falls back to filename without reading the entire PDF", async t => {
	const { pdf } = fixture(t);
	pdf.getFilePathAsync = async () => pdf.attachmentFilename;
	const pages = [];
	Zotero.PDFWorker = { async getFullText(_id, maxPages) { pages.push(maxPages); throw Error("unavailable"); } };
	assert.equal(await DeepRead.OrganizeRenameTool.extractPreviewText(pdf, 5), "");
	assert.deepEqual(pages, [5]);
});
