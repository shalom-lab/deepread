// Run with node tests/reader-smoke.cjs <path-to-zotero>. Uses a fresh data directory.
const fs = require("node:fs");
const path = require("node:path");
const { runSmoke } = require("./host-smoke.cjs");

function samplePDF() {
	const stream = "BT /F1 16 Tf 60 700 Td (DeepRead fixture) Tj ET";
	const objects = [
		"<< /Type /Catalog /Pages 2 0 R /Outlines 6 0 R >>", "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
		"<< /Type /Page /Parent 2 0 R /Contents 4 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> >>",
		"<< /Length " + stream.length + " >>\nstream\n" + stream + "\nendstream", "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
		"<< /Type /Outlines /First 7 0 R /Last 7 0 R /Count 1 >>",
		"<< /Title (Fixture chapter) /Parent 6 0 R /Dest [3 0 R /Fit] >>"
	];
	let doc = "%PDF-1.4\n"; const offsets = [0];
	objects.forEach((s, i) => { offsets.push(doc.length); doc += (i + 1) + " 0 obj\n" + s + "\nendobj\n"; });
	const start = doc.length;
	return doc + "xref\n0 " + offsets.length + "\n0000000000 65535 f \n" + offsets.slice(1).map(n => String(n).padStart(10, "0") + " 00000 n \n").join("") +
		"trailer\n<< /Size " + offsets.length + " /Root 1 0 R >>\nstartxref\n" + start + "\n%%EOF\n";
}

// This function is executed by a temporary Zotero bootstrap script.
async function exercise(dir) {
	const result = { host: Zotero.version, checks: [] };
	const progress = async step => {
		result.checks.push(step);
		await IOUtils.writeUTF8(PathUtils.join(dir, "progress.json"), JSON.stringify(result));
	};
	try {
		await Zotero.uiReadyPromise;
		// The runner must never write a fixture into another data directory.
		const normalized = p => p.replace(/\\/g, "/").toLowerCase();
		if (!normalized(Zotero.DataDirectory.dir).startsWith(normalized(dir) + "/")) throw Error("Unexpected test data directory: " + Zotero.DataDirectory.dir);
		const dr = Zotero.DeepRead;
		await progress("isolated profile ready");
		await Zotero.Libraries.get(Zotero.Libraries.userLibraryID).waitForDataLoad("item");
		const item = await Zotero.Attachments.importFromFile({ file: PathUtils.join(dir, "reader.pdf"), libraryID: Zotero.Libraries.userLibraryID });
		await progress("fixture PDF imported");
		await Promise.race([Zotero.Reader.open(item.id), Zotero.Promise.delay(22000).then(() => {
			const messages = Services.console.getMessageArray().slice(-60).map(m => String(m.errorMessage || m.message || m)).filter(m => /Error|reader|fail/i.test(m));
			throw Error("Reader open timed out. Loaded library: " + item.library.getDataLoaded("item") + ", readers: " + Zotero.Reader._readers.length +
				", console: " + messages.slice(-7).join(" | ").slice(0, 1700));
		})]);
		const win = Zotero.getMainWindow();
		let snapshot;
		for (let i = 0; i < 100; i++) {
			snapshot = dr.ReaderTools.capture(win);
			if (snapshot?.page === 1 && snapshot.docID) break;
			await Zotero.Promise.delay(200);
		}
		const msg = { reader: snapshot, libraryID: item.libraryID };
		const run = (name, args) => dr.ToolRegistry["deepread_" + name].run(args, msg);
		const apply = async (name, args, accept) => {
			const spec = dr.ToolRegistry["deepread_" + name], proposal = await spec.run(args, msg);
			const receipt = await spec.apply(proposal, new Set(accept ? proposal.rows.map(row => row.id) : []));
			if (/(Not completed|未完成)/.test(receipt)) throw Error(receipt);
		};
		if (snapshot?.page !== 1 || snapshot.attachmentID !== item.id) throw Error("Missing current reader page " + JSON.stringify(snapshot));
		await progress("reader snapshot");
		const content = await run("read_pdf", { action: "page_text", page: 1 });
		if (!content.text.includes("DeepRead fixture")) throw Error("Invalid PDF text");
		await progress("PDF page text");
		const outline = await run("read_pdf", { action: "outline" });
		if (outline.entries[0]?.title !== "Fixture chapter" || outline.entries[0]?.page !== 1) throw Error("Unexpected outline: " + JSON.stringify(outline));
		await progress("PDF outline");
		await apply("reader_navigate", { action: "page", page: 1 }, true);
		await progress("page navigation");
		await apply("reader_navigate", { action: "page_image", page: 1 }, true);
		const dialog = win.document.querySelector("dialog[open] img");
		if (!dialog?.src.startsWith("data:image/png;base64,")) throw Error("No page image");
		dialog.closest("dialog").close();
		await progress("local page image");
		const raster = await run("read_pdf", { action: "image", page: 1 });
		if (raster.image.mimeType !== "image/jpeg" || !raster.image.data.startsWith("/9j/") || raster.width < 100)
			throw Error("Missing rendered JPEG page");
		await progress("bounded page image for model");
		const reader = Zotero.Reader.getByTabID(win.Zotero_Tabs.selectedID);
		const view = reader._internalReader._primaryView;
		const fixtureRange = { pageIndex: 0, text: "DeepRead fixture", sortIndex: "00000|000000|00090", collapsed: false,
			position: { pageIndex: 0, rects: [[58, 695, 178, 718]] } };
		// Feed the fixture range through Zotero's native selection popup, which supplies the
		// same selection data consumed by DeepRead when a user sends a chat message.
		view._setSelectionRanges(Cu.cloneInto([fixtureRange], reader._iframeWindow));
		msg.reader = dr.ReaderTools.capture(win);
		if (msg.reader.selectedText !== fixtureRange.text || !msg.reader.highlight) throw Error("Missing native selection");
		await apply("edit_annotations", { action: "highlight", comment: "before" }, true);
		const [a] = item.getAnnotations();
		if (!a || a.annotationText !== fixtureRange.text) throw Error("Missing highlight from selected passage");
		await progress("native reader selection and reviewed highlight creation");
		const list = await run("read_annotations", {});
		if (!list.annotations.some(entry => entry.key === a.key)) throw Error("Annotation missing");
		const args = { action: "update", annotationID: a.id, comment: "after" };
		await apply("edit_annotations", args, false);
		if (a.annotationComment !== "before") throw Error("Cancelled edit wrote");
		await apply("edit_annotations", args, true);
		if (a.annotationComment !== "after") throw Error("Edit failed");
		await apply("reader_navigate", { action: "annotation", annotationID: a.id }, true);
		await apply("edit_annotations", { action: "remove", annotationID: a.id }, true);
		if (item.getAnnotations().length) throw Error("Removal failed");
		await progress("annotation list, cancel, edit, navigate and delete");
		msg.selection = [{ itemID: item.id, libraryID: item.libraryID, key: item.key }];
		const originalPath = await item.getFilePathAsync(), originalTitle = item.getField("title");
		const rename = { action: "rename", attachmentID: item.id, newName: "reviewed-paper.pdf" };
		await apply("manage_attachment", rename, false);
		if (!await IOUtils.exists(originalPath) || item.getField("title") !== originalTitle) throw Error("Unchecked rename wrote");
		await apply("manage_attachment", rename, true);
		const savedTitle = await Zotero.DB.valueQueryAsync("SELECT value FROM itemData JOIN itemDataValues USING (valueID) WHERE itemID=? AND fieldID=?",
			[item.id, Zotero.ItemFields.getID("title")]);
		const newPath = await item.getFilePathAsync();
		if (await IOUtils.exists(originalPath) || !await IOUtils.exists(newPath) || item.attachmentFilename !== rename.newName || savedTitle !== rename.newName)
			throw Error("Attachment rename or title persistence failed");
		await progress("cancelled and approved attachment rename, physical file and SQLite item title");
		result.ok = true;
	} catch (e) { result.error = String(e) + "\n" + e.stack; }
	await IOUtils.writeUTF8(PathUtils.join(dir, "result.json"), JSON.stringify(result));
	if (Services.dirsvc.get("ProfD", Ci.nsIFile).path === PathUtils.join(dir, "profile")) Services.startup.quit(Ci.nsIAppStartup.eForceQuit);
}

if (require.main === module) runSmoke({ name: "reader", modules: ["deepread.js", "tools/ToolRuntime.js", "tools/ZoteroAtomTools.js", "tools/OrganizeRenameTool.js", "tools/AttachmentTools.js", "tools/ReaderTools.js"], exercise,
	prepare: scratch => fs.writeFileSync(path.join(scratch, "reader.pdf"), samplePDF())
}).catch(e => { console.error(e.message); process.exitCode = 1; });
module.exports = { samplePDF };
