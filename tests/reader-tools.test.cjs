const test = require("node:test");
const assert = require("node:assert/strict");
require("../deepread");
require("../tools/ToolRuntime");
require("../tools/ReaderTools");

function fixture() {
	const events = [], items = new Map();
	const lib = { editable: true };
	const att = { id: 10, key: "FILE1234", libraryID: 1, parentItemID: 1, attachmentReaderType: "pdf",
		isFileAttachment: () => true, getDisplayTitle: () => "Demo", isEditable: () => true,
		getAnnotations: (trashed, asIDs) => { assert.ok(asIDs && !trashed); return [22]; } };
	const ann = { id: 22, key: "NOTE1234", libraryID: 1, parentItemID: 10, annotationType: "highlight",
		annotationText: "Sample", annotationComment: "Old", annotationColor: "#ffee00", annotationPosition: "{}",
		dateModified: "2026-01-01", annotationPageLabel: "ii", getTags: () => [], isAnnotation: () => true, isEditable: () => true,
		async saveTx() { events.push("save"); }, async eraseTx() { events.push("delete"); items.delete(this.id); } };
	items.set(att.id, att); items.set(ann.id, ann);
	const nativeSelection = { text: "The selection", sortIndex: "00001|000020|00030", pageLabel: "ii", position: { pageIndex: 1, rects: [[1, 3, 8, 5]] } };
	const state = { primary: true, primaryViewSelectionPopup: { annotation: nativeSelection } };
	const proxy = { getTextContent: async () => ({ items: [{ str: "a".repeat(6002) }, { str: "end", hasEOL: true }] }),
		getViewport: ({ scale }) => ({ width: 800 * scale, height: 1200 * scale }),
		render: ({ viewport, canvasContext }) => { events.push(["render", viewport, !!canvasContext]); return { promise: Promise.resolve() }; } };
	const pdf = { numPages: 5, async getPage(n) { events.push(["getPage", n]); return proxy; }, getOutline: async () => [{ title: "I", items: [{ title: "II" }] }] };
	const app = { pdfViewer: { currentPageNumber: 2 }, pdfDocument: pdf };
	const elements = [];
	const dom = { createElementNS(_, tag) {
		const el = { tag, style: {}, getContext: () => ({}), toDataURL: type => "data:" + type + ";base64,TEST",
			setAttribute() {}, addEventListener() {}, append() {}, showModal() { events.push("shown"); } };
		elements.push(el); return el;
	}, documentElement: { appendChild() {} } };
	const frame = { PDFViewerApplication: app, document: dom };
	const win = { document: dom, Zotero_Tabs: { selectedID: "tab-1", getState: () => [] }, ZoteroPane: { selectItems: async ids => { events.push(ids); return true; } } };
	const reader = { _window: win, itemID: 10, tabID: "tab-1", type: "pdf", _instanceID: "reader-id",
		_internalReader: { _state: state, _primaryView: { _iframeWindow: frame } }, navigate: async l => events.push(l) };
	global.Zotero = { Items: { get: id => items.get(id), getByLibraryAndKey: () => null }, Libraries: { get: () => lib },
		Reader: { _readers: [reader], getByTabID: id => id === "tab-1" && reader, open: async id => events.push(["open", id]) },
		getMainWindow: () => win, DataObjectUtilities: { generateKey: () => "NEW12345" },
		Annotations: { saveFromJSON: async (_item, data) => { events.push(data); return { id: 23, key: data.key }; } } };
	const message = { libraryID: 1, reader: DeepRead.ReaderTools.capture(win), selection: [] };
	function get(name, args) {
		const tool = DeepRead.ToolRegistry["deepread_" + name];
		DeepRead.ToolRuntime.validate(tool, args);
		return tool.run(args, message);
	}
	const apply = (p, pick = true) => DeepRead.ToolRuntime.applyRows(p, new Set(pick ? p.rows.map(r => r.id) : []));
	return { events, items, att, ann, lib, state, pdf, app, elements, win, reader, nativeSelection, message, get, apply };
}

test("reader snapshot retains the original selection and handles a closed reader or split view", () => {
	const { state, reader, win, get, message, nativeSelection } = fixture();
	nativeSelection.text = "Changed";
	nativeSelection.position.rects[0][0] = 0;
	assert.equal(get("reader_context", { action: "snapshot" }).selectedText, "The selection");
	assert.deepEqual(message.reader.highlight.position.rects, [[1, 3, 8, 5]]);
	assert.equal(get("reader_context", { action: "live" }).selectedText, "Changed");
	reader._internalReader._lastViewPrimary = false;
	state.secondaryViewStats = { pageIndex: 3 };
	assert.equal(get("reader_context", { action: "live" }).page, 4);
	assert.equal(get("reader_context", { action: "live" }).selectedText, "");
	assert.deepEqual(get("reader_context", { action: "open_documents" }).documents.map(r => r.attachmentID), [10]);
	win.Zotero_Tabs.selectedID = "zotero-pane";
	assert.equal(get("reader_context", { action: "live" }).status, "no_reader");
});

test("PDF bookmarks resolve names and references to one-based page starts without loading page content", async () => {
	const { pdf, get, events } = fixture();
	pdf.getOutline = async () => [{ title: "Start", dest: [0] }, { title: "Results", dest: "results" },
		{ title: "Invalid", dest: "missing" }, { title: "Outside", url: "https://example.org", dest: [1] }];
	pdf.getDestination = async name => name === "results" ? [{ num: 9, gen: 0 }] : null;
	pdf.getPageIndex = async ref => { assert.equal(ref.num, 9); return 3; };
	assert.deepEqual((await get("read_pdf", { action: "outline" })).entries.map(e => e.page), [1, 4, null, null]);
	assert.deepEqual(events, []);
});

test("PDF page reads, outline, continuation and scope never scan other pages", async () => {
	const { get, events, items, att, reader } = fixture();
	const read = args => get("read_pdf", args);
	const result = await read({ action: "page_text" });
	assert.equal(result.text.length, 6000);
	assert.equal(result.nextOffset, 6000);
	assert.equal((await read({ action: "page_text", page: 2, offset: 6000 })).text, "aa end\n");
	assert.deepEqual(events, [["getPage", 2], ["getPage", 2]]);
	assert.deepEqual((await read({ action: "outline" })).entries, [{ depth: 0, title: "I", page: null }, { depth: 1, title: "II", page: null }]);
	assert.deepEqual((await read({ action: "image", page: 1 })).image, { mimeType: "image/jpeg", data: "TEST" });
	await assert.rejects(read({ action: "page_text", page: 7 }), /out of range/);
	items.set(77, { ...att, id: 77, key: "OTHER" });
	await assert.rejects(read({ action: "outline", attachmentID: 77 }), /outside/);
	reader._internalReader._primaryView = null;
	await assert.rejects(read({ action: "page_text" }), /load/);
});

test("navigation review covers open, page, annotation, bounded local image preview and PDF replacement", async () => {
	const { get, apply, app, elements, events } = fixture();
	const go = a => get("reader_navigate", a);
	const open = go({ action: "open", attachmentID: 10 });
	assert.deepEqual(events, []);
	await apply(open, false);
	assert.deepEqual(events, []);
	await apply(go({ action: "open" }));
	await apply(go({ action: "page", page: 5 }));
	await apply(go({ action: "annotation", annotationID: 22 }));
	assert.deepEqual(events, [["open", 10], { pageIndex: 4 }, { annotationID: "NOTE1234" }]);
	await apply(go({ action: "page_image", page: 3 }));
	assert.ok(elements.some(el => el.tag === "img" && el.src === "data:image/png;base64,TEST"));
	assert.deepEqual(events.slice(3), [["getPage", 3], ["render", { width: 800, height: 1200 }, true], "shown"]);
	const stale = go({ action: "page", page: 2 });
	app.pdfDocument = { ...app.pdfDocument };
	assert.match(await apply(stale), /reloaded/);
});

test("annotated text is created only at reviewed, captured PDF coordinates and only once", async () => {
	const { get, apply, events, message, nativeSelection, app } = fixture();
	const plan = get("edit_annotations", { action: "underline", comment: "keep" });
	nativeSelection.text = "newer selection";
	assert.equal(events.length, 0);
	await apply(plan);
	assert.equal(events[0].type, "underline");
	assert.equal(events[0].text, "The selection");
	assert.deepEqual(events[0].position, message.reader.highlight.position);
	await assert.rejects(apply(plan), /reviewed/);
	app.pdfDocument = { ...app.pdfDocument };
	assert.throws(() => get("edit_annotations", { action: "highlight" }), /PDF changed/);
	message.reader.highlight = null;
	assert.throws(() => get("edit_annotations", { action: "highlight" }), /Select a passage/);
});

test("annotation read/update/delete check attachment, permissions, concurrent edits and preview every change", async () => {
	const { get, apply, ann, items, lib, events } = fixture();
	assert.equal(get("read_annotations", {}).annotations[0].annotationID, 22);
	assert.equal(get("read_annotations", { annotationID: 22 }).text, "Sample");
	const update = (comment = "New") => get("edit_annotations", { action: "update", annotationID: 22, comment });
	const p = update();
	assert.match(p.rows[0].detail, /Old → New/);
	assert.equal(ann.annotationComment, "Old");
	ann.annotationComment = "Manual";
	assert.match(await apply(p), /changed since review/);
	await apply(update()); assert.equal(ann.annotationComment, "New");
	ann.saveTx = async () => { throw Error("read error"); };
	assert.match(await apply(update("Other")), /read error/);
	assert.equal(ann.annotationComment, "New");
	const remove = () => get("edit_annotations", { action: "remove", annotationID: 22 });
	const q = remove();
	assert.equal(q.rows[0].selected, false);
	lib.editable = false;
	assert.match(await apply(q), /read-only/);
	lib.editable = true;
	ann.annotationIsExternal = true;
	assert.throws(remove, /read-only/);
	ann.annotationIsExternal = false;
	ann.parentItemID = 88;
	assert.throws(update, /another attachment/);
	ann.parentItemID = 10;
	await apply(remove());
	assert.deepEqual(events, ["save", "delete"]); assert.equal(items.has(22), false);
});

test("locate item stays in the captured library and checks the key before changing the tab", async () => {
	const { get, apply, att, events } = fixture();
	const locate = () => get("locate_item", { itemID: 10 });
	const p = locate(); att.key = "CHANGED";
	assert.match(await apply(p), /identity changed/); assert.deepEqual(events, []);
	await apply(locate()); assert.deepEqual(events, [[10]]);
	att.libraryID = 5; assert.throws(locate, /captured library/);
});

test("Zotero 7/8 annotation objects and missing private reader features degrade independently", async () => {
	const { att, ann, get, app, state } = fixture();
	att.getAnnotations = () => [ann];
	assert.equal(get("read_annotations", {}).annotations[0].key, ann.key);
	delete app.pdfViewer;
	assert.equal(get("reader_context", { action: "live" }).page, null);
	state.primaryViewStats = { pageIndex: 3 };
	assert.equal(get("reader_context", { action: "live" }).page, 4);
	app.pdfDocument = null;
	await assert.rejects(get("read_pdf", { action: "outline" }), /Open this PDF/);
	assert.equal(get("reader_context", { action: "live" }).selectedText, "The selection");
	assert.equal(get("read_annotations", { annotationID: ann.id }).comment, "Old");
});
