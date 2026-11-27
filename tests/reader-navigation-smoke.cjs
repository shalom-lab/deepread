// Run with node tests/reader-navigation-smoke.cjs <path-to-zotero>.
const fs = require("node:fs");
const path = require("node:path");
const { runSmoke } = require("./host-smoke.cjs");
const { samplePDF } = require("./reader-smoke.cjs");

async function exercise(dir) {
	const report = { host: Zotero.version, checks: [] };
	const progress = async step => {
		report.checks.push(step);
		await IOUtils.writeUTF8(PathUtils.join(dir, "progress.json"), JSON.stringify(report));
	};
	try {
		await progress("Zotero initialized");
		await Zotero.uiReadyPromise;
		const clean = p => p.replace(/\\/g, "/").toLowerCase();
		if (!clean(Zotero.DataDirectory.dir).startsWith(clean(dir) + "/")) throw Error("Unexpected data directory");
		const dr = Zotero.DeepRead, win = Zotero.getMainWindow();
		await Zotero.Libraries.get(Zotero.Libraries.userLibraryID).waitForDataLoad("item");
		const it = await Zotero.Attachments.importFromFile({ file: PathUtils.join(dir, "reader.pdf"), libraryID: Zotero.Libraries.userLibraryID });
		await progress("imported fixture");
		const msg = { selection: [{ itemID: it.id, key: it.key, libraryID: it.libraryID }], libraryID: it.libraryID };
		const list = () => dr.ToolRegistry.deepread_reader_context.run({ action: "open_tabs" }, msg);
		const spec = dr.ToolRegistry.deepread_reader_navigate;
		const approve = async (args, accept = true) => {
			const plan = await spec.run(args, msg);
			const receipt = await spec.apply(plan, new Set(accept ? plan.rows.map(r => r.id) : []));
			if (/(Not completed|未完成)/.test(receipt)) throw Error(receipt);
		};
		const reader = await Zotero.Reader.open(it.id);
		const libraryTabID = list().tabs.find(t => t.type === "library")?.tabID;
		if (!libraryTabID || !list().tabs.some(t => t.tabID === reader.tabID && t.active)) throw Error("Native tabs unavailable");
		await progress("enumerated current reader and library tabs");
		await approve({ action: "switch_tab", tabID: libraryTabID }, false);
		if (win.Zotero_Tabs.selectedID !== reader.tabID) throw Error("Unchecked tab switch changed the UI");
		await approve({ action: "switch_tab", tabID: libraryTabID });
		if (win.Zotero_Tabs.selectedID !== libraryTabID) throw Error("Could not switch to library tab");
		await progress("cancelled and accepted library tab switch");
		if (list().windows.length) throw Error("Unexpected preexisting reader window");
		await approve({ action: "open_window" }, false);
		if (list().windows.length) throw Error("Unchecked window open changed the UI");
		await approve({ action: "open_window" });
		const [target] = list().windows;
		if (!target || target.attachmentID !== it.id) throw Error("Missing separate reader");
		await approve({ action: "open_window" });
		if (list().windows.length !== 1 || list().windows[0].instanceID !== target.instanceID) throw Error("Duplicate separate reader");
		await progress("opened separate reader for selected attachment and reused exact window");
		await approve({ action: "switch_tab", tabID: reader.tabID });
		if (win.Zotero_Tabs.selectedID !== reader.tabID) throw Error("Reader tab not selected");
		await approve({ action: "focus_window", instanceID: target.instanceID });
		const windowReader = Zotero.Reader._readers.find(r => r._instanceID === target.instanceID);
		if (!windowReader?._window || windowReader._window === win || windowReader._window.closed) throw Error("Reader window disappeared");
		await progress("focused enumerated standalone reader after switching back to original tab");
		report.ok = true;
	} catch (e) { report.error = String(e) + "\n" + e.stack; }
	await IOUtils.writeUTF8(PathUtils.join(dir, "result.json"), JSON.stringify(report));
	if (Services.dirsvc.get("ProfD", Ci.nsIFile).path === PathUtils.join(dir, "profile")) Services.startup.quit(Ci.nsIAppStartup.eForceQuit);
}

runSmoke({ name: "navigation", modules: ["deepread.js", "tools/ToolRuntime.js", "tools/ReaderTools.js"], exercise,
	prepare: dir => fs.writeFileSync(path.join(dir, "reader.pdf"), samplePDF())
}).catch(err => { console.error(err.message); process.exitCode = 1; });
