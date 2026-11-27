// Run with node tests/library-smoke.cjs <path-to-zotero>. Synthetic data only.
const { runSmoke } = require("./host-smoke.cjs");

async function exercise(dir) {
	const result = { host: Zotero.version, checks: [] };
	try {
		const progress = text => IOUtils.writeUTF8(PathUtils.join(dir, "stage.txt"), text);
		await progress("Waiting for Zotero UI");
		await Zotero.uiReadyPromise;
		const normalize = p => p.replace(/\\/g, "/").toLowerCase();
		if (!normalize(Zotero.DataDirectory.dir).startsWith(normalize(dir) + "/") ||
			normalize(Services.dirsvc.get("ProfD", Ci.nsIFile).path) !== normalize(PathUtils.join(dir, "profile"))) {
			throw Error("Refusing to exercise a non-fixture database");
		}
		const dr = Zotero.DeepRead;
		const lib = Zotero.Libraries.userLibraryID;
		const pane = Zotero.getMainWindow().ZoteroPane;
		for (let i = 0; !pane.collectionsView && i < 150; i++) await Zotero.Promise.delay(100);
		if (!pane.collectionsView) throw Error("Main library tree did not initialize");
		await pane.collectionsView.waitForLoad();
		await pane.collectionsView.selectLibrary(lib);
		await pane.itemsView.waitForLoad();
		const msg = { selection: [], collections: [], libraryID: lib };
		const select = (...items) => { msg.selection = items.map(i => ({ itemID: i.id, key: i.key, libraryID: i.libraryID, parentItemID: i.parentItemID || undefined })); };
		const run = async (name, args) => {
			const spec = dr.ToolRegistry["deepread_" + name];
			dr.ToolRuntime.validate(spec, args);
			return spec.run(args, msg);
		};
		const apply = async (name, args, accept = true) => {
			await progress("Preparing " + name + " / " + args.action);
			const spec = dr.ToolRegistry["deepread_" + name], p = await run(name, args);
			if (!p.rows.length) throw Error("Missing proposal: " + JSON.stringify(p.notes));
			await progress("Applying " + name + " / " + args.action);
			let timer;
			const wait = new Promise((_resolve, reject) => {
				timer = Zotero.getMainWindow().setTimeout(() => reject(Error("Host did not finish " + args.action)), 20000);
			});
			let answer;
			try { answer = await Promise.race([spec.apply(p, new Set(accept ? p.rows.map(r => r.id) : [])), wait]); }
			finally { Zotero.getMainWindow().clearTimeout(timer); }
			if (answer.includes("Not completed")) throw Error(answer);
			return answer;
		};
		const check = (condition, label) => { if (!condition) throw Error(label); result.checks.push(label); };
		const getID = receipt => Number(/#(\d+)[^#]*$/.exec(receipt)?.[1]);
		const first = await apply("manage_items", { action: "create", title: "DR Fixture primary", fields: { date: "2011" } });
		const second = await apply("manage_items", { action: "create", title: "DR Fixture other", fields: { DOI: "10.1000/drfixture" } });
		const a = Zotero.Items.get(getID(first)), b = Zotero.Items.get(getID(second));
		check(a.getField("date") === "2011" && a.id !== b.id, "Create two fixture papers");
		select(b);
		await apply("manage_tags", { action: "add", tag: "DR Original" }, false);
		check(!b.hasTag("DR Original"), "Cancelled tag addition");
		await apply("manage_tags", { action: "add", tag: "DR Original" });
		await apply("manage_tags", { action: "replace", tag: "DR Original", newTag: "DR Merged" });
		check(b.hasTag("DR Merged") && !b.hasTag("DR Original"), "Edit tag and read stored tags");
		await apply("edit_note", { action: "create", itemID: b.id, text: "fixture & <safe>" });
		const n = Zotero.Items.get(b.getNotes()[0]);
		select(n);
		await apply("edit_note", { action: "append", itemID: n.id, text: "line two" });
		check((await run("read_notes", { itemID: n.id })).content.includes("line two"), "Read and append child note");
		await apply("edit_note", { action: "replace", itemID: n.id, text: "replacement" });
		check((await run("read_notes", { itemID: n.id })).content === "replacement", "Replace note text");
		select(a);
		await apply("manage_collection", { action: "create", name: "DR fixture parent" });
		const c = Zotero.Collections.getByLibrary(lib, false).find(c => c.name === "DR fixture parent");
		await apply("manage_collection", { action: "create", name: "DR fixture child", parentID: c.id });
		const child = c.getChildCollections(false)[0];
		await apply("manage_collection", { action: "add_items", collectionID: child.id });
		check(a.getCollections().includes(child.id), "Add to nested collection");
		msg.collections = [{ collectionID: c.id, key: c.key, libraryID: lib }];
		await apply("manage_collection", { action: "trash", collectionID: c.id });
		check(c.deleted && child.deleted && !a.deleted && !n.deleted, "Trash collection subtree and preserve member paper and note");
		msg.collections = [];
		await progress("Selecting merge candidates in the real item tree");
		await pane.collectionsView.selectItems([a.id, b.id], true);
		select(a,b);
		const merge = { action: "merge", masterID: a.id };
		await apply("manage_items", merge, false);
		check(!b.deleted && n.parentItemID === b.id, "Cancelled merge");
		await apply("manage_items", merge);
		check(b.deleted && a.hasTag("DR Merged") && n.parentItemID === a.id && !n.deleted, "Merge into explicit master, retain tag and child note");
		result.ok = true;
	} catch (e) { result.error = String(e) + "\n" + e.stack; }
	await IOUtils.writeUTF8(PathUtils.join(dir, "result.json"), JSON.stringify(result));
	if (Services.dirsvc.get("ProfD", Ci.nsIFile).path === PathUtils.join(dir, "profile")) Services.startup.quit(Ci.nsIAppStartup.eForceQuit);
}

runSmoke({ name: "library", modules: ["deepread.js", "tools/ToolRuntime.js", "tools/ZoteroAtomTools.js", "tools/LibraryTools.js"], exercise })
	.catch(e => { console.error(e.message); process.exitCode = 1; });
