const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const image = { mimeType: "image/png", data: "aGk=" };
const jpeg = { mimeType: "image/jpeg", data: "YWJj" };
const caption = { role: "user", content: "Pages 2 and 3", images: [image, jpeg] };
const start = { role: "user", content: "Read these pages" };
const tool = { name: "read_page", description: "Read", inputSchema: { type: "object", properties: {} } };
function fixture(name, replies) {
	const requests = [];
	const context = vm.createContext({ fetch: async (_url, opts) => {
		requests.push(JSON.parse(opts.body));
		assert.ok(replies.length, "Unexpected provider request");
		return { ok: true, json: async () => replies.shift() };
	} });
	for (const file of ["BaseAI", name]) {
		vm.runInContext(fs.readFileSync(path.join(__dirname, "../providers/" + file + "Provider.js"), "utf8"), context);
	}
	return { provider: new context[name + "Provider"]({ apiKey: "fixture", model: "fixture" }), requests };
}

test("Gemini restores the call signature and parallel response order, then attaches actual image parts", async () => {
	const calls = [
		{ functionCall: { id: "A", name: "read_page", args: { page: 2 } }, thoughtSignature: "signed" },
		{ functionCall: { name: "read_page", args: { page: 3 } } }
	];
	const answer = { candidates: [{ content: { parts: [{ thought: true, text: "hidden" }, { text: "Answer" }] } }] };
	const { provider, requests } = fixture("Gemini", [
		{ candidates: [{ content: { parts: [{ thought: true, text: "hidden" }, { text: "Opening" }, ...calls] } }] }, answer
	]);
	assert.equal(provider.supportsToolImages, true);
	const first = await provider.chat([start], { tools: [tool] });
	assert.equal(first.content, "Opening");
	assert.equal(first.toolCalls[0].thoughtSignature, "signed");
	assert.equal(first.toolCalls[1].thoughtSignature, undefined);
	const assistant = { role: "assistant", content: first.content, toolCalls: first.toolCalls };
	const response = i => ({ role: "tool", toolCallId: first.toolCalls[i].id, name: "read_page", content: "read " + i });
	const history = [start, assistant, response(1), response(0), caption];
	assert.equal((await provider.chat(history)).content, "Answer");
	const contents = requests[1].contents;
	assert.deepEqual(contents.map(c => c.role), ["user", "model", "user"]);
	assert.deepEqual(contents[1].parts, [{ text: "Opening" }, ...calls]);
	const [a, b, png, jpg, label] = contents[2].parts;
	assert.deepEqual(a, { functionResponse: { id: "A", name: "read_page", response: { result: "read 0" } } });
	assert.deepEqual(b, { functionResponse: { name: "read_page", response: { result: "read 1" } } });
	assert.deepEqual([png, jpg, label], [{ inlineData: image }, { inlineData: jpeg }, { text: caption.content }]);
	assert.ok(!JSON.stringify(contents).includes("hidden"));
});

test("Gemini also accepts images in ordinary text chat and keeps PDF attachment on the first user message", async () => {
	const { provider, requests } = fixture("Gemini", [{ candidates: [{ content: { parts: [{ text: "OK" }] } }] }]);
	await provider.chat([start, { role: "assistant", content: "Ready" }, caption], {}, { base64: "cGRm", mimeType: "application/pdf" });
	assert.deepEqual(requests[0].contents[0].parts[0], { inlineData: { mimeType: "application/pdf", data: "cGRm" } });
	assert.deepEqual(requests[0].contents[2].parts[0], { inlineData: image });
	await assert.rejects(provider.chat([{ ...caption, images: [{ mimeType: "image/png", data: "https://remote/" }] }]), /Invalid tool image/);
	assert.equal(requests.length, 1);
});

for (const name of ["OpenAI", "DeepSeek"]) {
	test(name + " tool history preserves responses and sends only supported media", async () => {
		const reply = { choices: [{ message: { content: "OK" } }] };
		const { provider, requests } = fixture(name, [reply]);
		assert.equal(provider.supportsToolImages, name === "OpenAI");
		const assistant = { role: "assistant", content: "", toolCalls: [{ id: "A", name: "read_page", arguments: {}, thoughtSignature: "gemini-only" }] };
		const output = { role: "tool", toolCallId: "A", name: "read_page", content: "OK" };
		await provider.chat([start, assistant, output, caption], { tools: [tool] });
		const msgs = requests[0].messages;
		assert.equal(msgs[2].tool_call_id, "A");
		assert.ok(!JSON.stringify(requests[0]).includes("gemini-only"));
		if (name === "OpenAI") {
			assert.deepEqual(msgs[3].content, [
				{ type: "image_url", image_url: { url: "data:image/png;base64,aGk=" } },
				{ type: "image_url", image_url: { url: "data:image/jpeg;base64,YWJj" } },
				{ type: "text", text: caption.content }
			]);
			await assert.rejects(provider.chat([{ ...caption, images: [{ mimeType: "image/svg+xml", data: "aGk=" }] }]), /Invalid tool image/);
		} else {
			assert.deepEqual(msgs[3], { role: "user", content: caption.content });
			assert.ok(!JSON.stringify(requests[0]).includes(image.data));
		}
	});
}
