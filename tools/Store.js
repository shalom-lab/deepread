/* One row per conversation or preset. Message order and provider-specific fields
 * stay together in JSON. The four legacy files are read only during import. */
(function () {
	const tables = ["item_chats", "sidebar_chats", "item_presets", "sidebar_presets"];
	const cache = new Map();
	let db;
	let ready = false;
	let pending = Promise.resolve();

	function row(id, value, position = 0, selected = false) {
		return { id: String(id), data: JSON.stringify(value), position, selected: Number(selected) };
	}

	function index(rows) {
		const result = new Map(rows.map(r => [r.id, r]));
		if (result.size !== rows.length) throw new Error("Duplicate DeepRead record ID");
		return result;
	}

	function queue(task) {
		if (!ready) throw new Error("DeepRead storage is not available");
		const operation = pending.then(task);
		pending = operation.catch(() => {});
		return operation;
	}

	async function readRows(table) {
		const records = await db.execute("SELECT id, data, position, selected FROM " + table + " ORDER BY position, id");
		return index(records.map(record => Object.fromEntries(
			["id", "data", "position", "selected"].map(k => [k, record.getResultByName(k)])
		)));
	}

	async function updateRows(table, previous, next) {
		for (const id of previous.keys()) {
			if (!next.has(id)) await db.executeCached("DELETE FROM " + table + " WHERE id = ?", [id]);
		}
		for (const r of next.values()) {
			const old = previous.get(r.id);
			if (old && old.data === r.data && old.position === r.position && old.selected === r.selected) continue;
			await db.executeCached("INSERT OR REPLACE INTO " + table +
				" (id, data, position, selected) VALUES (?, ?, ?, ?)", [r.id, r.data, r.position, r.selected]);
		}
	}

	function save(table, rows) {
		// Serialize the caller's values before queueing; subsequent UI edits must not mutate this save.
		const next = index(rows);
		return queue(async () => {
			await db.executeTransaction(() => updateRows(table, cache.get(table), next));
			cache.set(table, next);
		});
	}

	async function legacy(name, fallback) {
		const path = PathUtils.join(Zotero.DataDirectory.dir, name);
		if (!await IOUtils.exists(path)) return fallback();
		try { return JSON.parse(await IOUtils.readUTF8(path)); }
		catch (e) { throw new Error(name + ": " + e.message); }
	}

	function historyRows(history) {
		return Array.from(history, ([id, messages]) => {
			if (!Array.isArray(messages)) throw new Error("Invalid item history: " + id);
			return row(id, messages);
		});
	}

	function chatRows(chats, activeId) {
		return chats.map((c, i) => {
			if (!c || !c.id || !Array.isArray(c.messages)) throw new Error("Invalid sidebar conversation");
			return row(c.id, c, i, c.id === activeId);
		});
	}

	function presetRows(presets, sidebar, defaultId) {
		return presets.map((p, i) => {
			if (!p || typeof p !== "object") throw new Error("Invalid DeepRead preset");
			return row(sidebar ? p.id : i, p, i, sidebar ? p.id === defaultId : i === 0);
		});
	}

	async function importLegacy() {
		const history = await legacy("deepread_history.json", () =>
			JSON.parse(Zotero.Prefs.get("extensions.deepread.history", true) || "{}"));
		if (!history || typeof history !== "object" || Array.isArray(history)) throw new Error("Invalid item history");
		const itemPresets = await legacy("deepread_prompts.json", () => []);
		if (!Array.isArray(itemPresets)) throw new Error("Invalid item presets");
		if (!itemPresets.length) itemPresets.push({
			name: DeepRead.getString("default-preset-name"), prompt: DeepRead.getString("default-preset-prompt")
		});
		const side = DeepRead.SidebarChat;
		const stored = await legacy("deepread_sidebar_chat.json", () => ({ conversations: [], version: 2 }));
		let chats;
		if (stored?.version === 2 && Array.isArray(stored.conversations)) {
			chats = stored.conversations.map(c => {
				if (!c || !Array.isArray(c.messages)) throw new Error("Invalid legacy conversation");
				return { ...side._blankConv(), ...c, id: String(c.id || side._newId()) };
			});
		} else if (Array.isArray(stored?.messages)) {
			const c = side._blankConv();
			c.messages = stored.messages;
			const first = c.messages.find(m => m?.role === "user" && m.content);
			if (first) c.title = String(first.content).replace(/\s+/g, " ").trim().slice(0, 28);
			chats = [c];
		} else throw new Error("Invalid sidebar chat history");
		const presets = side._normalizePresets(await legacy("deepread_sidebar_prompts.json", () => []));
		return {
			item_chats: historyRows(Object.entries(history)),
			sidebar_chats: chatRows(chats, String(stored.activeId || chats[0]?.id || "")),
			item_presets: presetRows(itemPresets, false),
			sidebar_presets: presetRows(presets.presets, true, presets.defaultId)
		};
	}

	async function createConversationTables() {
		const imported = await importLegacy();
		for (const table of tables) {
			await db.execute("CREATE TABLE " + table +
				" (id TEXT PRIMARY KEY NOT NULL, data TEXT NOT NULL, position INTEGER NOT NULL, selected INTEGER NOT NULL)");
			const expected = index(imported[table]);
			await updateRows(table, new Map(), expected);
			const actual = await readRows(table);
			if (actual.size !== expected.size || Array.from(expected.values()).some(r => {
				const saved = actual.get(r.id);
				return !saved || saved.data !== r.data || saved.position !== r.position || saved.selected !== r.selected;
			})) throw new Error("Migration verification failed: " + table);
		}
	}

	// Only persist declarations. Executable code and external server credentials never belong in this table.
	async function syncToolCatalog() {
		const columns = ["name", "domain", "source", "description", "description_zh", "read_only", "risk",
			"confirmation", "floating_chat", "input_schema"];
		const saved = await db.execute("SELECT " + columns.join(", ") + " FROM tools");
		const previous = new Map(saved.map(r => [r.getResultByName("name"), r]));
		for (const tool of Object.values(DeepRead.ToolRegistry)) {
			const readOnly = tool.annotations?.readOnlyHint === true;
			const fields = [tool.name, tool.domain, tool.source, tool.description, tool.descriptionZh || null,
				Number(readOnly), tool.risk || (readOnly ? "low" : "unknown"), tool.confirm || (readOnly ? "none" : "normal"),
				Number(!!tool.floatingChat), tool.inputSchema ? JSON.stringify(tool.inputSchema) : null];
			const old = previous.get(tool.name);
			previous.delete(tool.name);
			if (old && columns.every((c, i) => old.getResultByName(c) === fields[i])) continue;
			await db.executeCached("INSERT OR REPLACE INTO tools (" + columns.join(", ") + ") VALUES (" +
				columns.map(() => "?").join(", ") + ")", fields);
		}
		for (const name of previous.keys()) await db.executeCached("DELETE FROM tools WHERE name = ?", [name]);
	}

	DeepRead.Store = {
		async open() {
			let sqlite;
			try { sqlite = ChromeUtils.importESModule("resource://gre/modules/Sqlite.sys.mjs").Sqlite; }
			catch (e) { sqlite = ChromeUtils.import("resource://gre/modules/Sqlite.jsm").Sqlite; }
			db = await sqlite.openConnection({ path: PathUtils.join(Zotero.DataDirectory.dir, "deepread.sqlite") });
			try {
				await db.executeTransaction(async () => {
					const [v] = await db.execute("PRAGMA user_version");
					const version = v.getResultByName("user_version");
					if (![0, 1, 2].includes(version)) throw new Error("Unsupported DeepRead database version: " + version);
					if (version === 0) await createConversationTables();
					if (version < 2) {
						await db.execute("CREATE TABLE tools (" +
							"name TEXT PRIMARY KEY NOT NULL, domain TEXT NOT NULL, source TEXT NOT NULL, description TEXT NOT NULL, " +
							"description_zh TEXT, read_only INTEGER NOT NULL, risk TEXT NOT NULL, confirmation TEXT NOT NULL, " +
							"floating_chat INTEGER NOT NULL, input_schema TEXT)");
					}
					await syncToolCatalog();
					if (version < 2) await db.execute("PRAGMA user_version = 2");
				});
				for (const table of tables) cache.set(table, await readRows(table));
				ready = true;
			} catch (e) {
				await db.close();
				db = null;
				throw e;
			}
		},

		async close() {
			ready = false;
			await pending;
			if (db) await db.close();
			db = null;
			cache.clear();
		},

		itemHistory() {
			return new Map(Array.from(cache.get("item_chats").values(), r => [r.id, JSON.parse(r.data)]));
		},
		saveHistory(history, key) {
			if (key === undefined) return save("item_chats", historyRows(history));
			const entry = row(key, history.get(key));
			return queue(async () => {
				await db.executeCached("INSERT OR REPLACE INTO item_chats (id, data, position, selected) VALUES (?, ?, 0, 0)",
					[entry.id, entry.data]);
				cache.get("item_chats").set(entry.id, entry);
			});
		},
		sidebarChats() {
			const rows = Array.from(cache.get("sidebar_chats").values());
			return { conversations: rows.map(r => JSON.parse(r.data)), activeId: rows.find(r => r.selected)?.id };
		},
		saveChats(chats, activeId) { return save("sidebar_chats", chatRows(chats, activeId)); },
		readPresets(sidebar) {
			return queue(() => {
				const rows = Array.from(cache.get(sidebar ? "sidebar_presets" : "item_presets").values());
				return { presets: rows.map(r => JSON.parse(r.data)), defaultId: rows.find(r => r.selected)?.id };
			});
		},
		savePresets(presets, sidebar, defaultId) {
			return save(sidebar ? "sidebar_presets" : "item_presets", presetRows(presets, sidebar, defaultId));
		}
	};
})();
