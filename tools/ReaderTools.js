/* Reader APIs and PDF.js features vary by Zotero version. Probe the actual
 * document/view rather than inferring capabilities from the version number. */
(function () {
	const rt = DeepRead.ToolRuntime;
	const t = (zh, en) => rt.t(zh, en);
	const fail = (zh, en) => { throw new Error(t(zh, en)); };
	const textCap = 6000;
	// Gecko rewraps page-script objects when their promises cross into plugin chrome.
	const unwrap = object => object && typeof Cu !== "undefined" ? Cu.waiveXrays(object) : object;
	const docIDs = new WeakMap();
	const session = Date.now().toString(36) + Math.random().toString(36).slice(2);
	let sequence = 0;
	function docID(pdf) {
		if (!pdf) return null;
		if (!docIDs.has(pdf)) docIDs.set(pdf, session + "-" + (++sequence));
		return docIDs.get(pdf);
	}
	const cut = (value, size = textCap) => String(value ?? "").slice(0, size);
	const readers = () => (Zotero.Reader?._readers || []).filter(r => !r._isTabClosed && !r._window?.closed);
	const main = () => Zotero.getMainWindow?.();
	function activeWindow() {
		const front = typeof Services !== "undefined" && Services.wm?.getMostRecentWindow(null);
		if (front && (front.Zotero_Tabs || readers().some(r => r._window === front))) return front;
		return main();
	}
	const state = reader => reader?._internalReader?._state;
	function currentReader(win) {
		const tabs = win?.Zotero_Tabs;
		if (tabs) return Zotero.Reader?.getByTabID?.(tabs.selectedID);
		return win && readers().find(r => r._window === win);
	}
	function view(reader) {
		const inner = reader?._internalReader;
		const secondary = inner?._lastViewPrimary === false || (inner?._lastViewPrimary == null && inner?._state?.primary === false);
		return { secondary, current: inner?._lastView || (secondary ? inner?._secondaryView : inner?._primaryView) };
	}
	function pdfApp(reader) {
		const frame = view(reader).current?._iframeWindow;
		return frame?.PDFViewerApplication || frame?.wrappedJSObject?.PDFViewerApplication;
	}
	function pageNumber(reader) {
		const { secondary } = view(reader);
		const stats = secondary ? state(reader)?.secondaryViewStats : state(reader)?.primaryViewStats;
		const n = pdfApp(reader)?.pdfViewer?.currentPageNumber ?? (stats?.pageIndex + 1);
		return Number.isSafeInteger(n) && n > 0 ? n : null;
	}
	function rectangles(rects) {
		return Array.isArray(rects) && rects.length > 0 && rects.length <= 400 &&
			rects.every(r => Array.isArray(r) && r.length === 4 && r.every(Number.isFinite) && r[0] <= r[2] && r[1] <= r[3]);
	}
	function selection(reader) {
		const { secondary, current } = view(reader);
		const s = state(reader);
		const annotation = (secondary ? s?.secondaryViewSelectionPopup : s?.primaryViewSelectionPopup)?.annotation;
		let raw = annotation?.text;
		if (!raw) raw = current?._iframeWindow?.getSelection?.()?.toString();
		const selectedText = cut(raw);
		const p = annotation?.position;
		let highlight = null;
		if (selectedText && selectedText === raw && Number.isSafeInteger(p?.pageIndex) && p.pageIndex >= 0 &&
			rectangles(p.rects) && (!p.nextPageRects || rectangles(p.nextPageRects)) && typeof annotation.sortIndex === "string" && annotation.sortIndex) {
			const position = { pageIndex: p.pageIndex, rects: p.rects.map(r => Array.from(r)) };
			if (p.nextPageRects) position.nextPageRects = p.nextPageRects.map(r => Array.from(r));
			highlight = { position, sortIndex: cut(annotation.sortIndex, 80), pageLabel: cut(annotation.pageLabel, 80) };
		}
		return { selectedText, truncated: !!raw && raw.length > textCap, highlight };
	}
	function ref(item) {
		return { attachmentID: item.id, key: item.key, libraryID: item.libraryID };
	}
	function capture(win) {
		try {
			const reader = currentReader(win || main());
			const item = reader && Zotero.Items.get(reader.itemID);
			if (!item || item.deleted) return null;
			return { ...ref(item), capturedAt: Date.now(), tabID: reader.tabID || null, instanceID: reader._instanceID || null, docID: docID(pdfApp(reader)?.pdfDocument),
				type: reader.type || item.attachmentReaderType || null, page: pageNumber(reader), ...selection(reader) };
		} catch { return { unavailable: true }; }
	}
	DeepRead.ReaderTools = { capture };

	function attachment(message, requestedID) {
		const snapshot = message?.reader;
		const id = requestedID ?? snapshot?.attachmentID;
		const item = Number.isSafeInteger(id) && Zotero.Items.get(id);
		if (!item || item.deleted || !item.isFileAttachment?.()) fail("请选择文件附件或打开阅读器。", "Select a file attachment or open a reader.");
		if (snapshot?.attachmentID === id && snapshot.key === item.key && snapshot.libraryID === item.libraryID) return item;
		for (const s of message?.selection || []) {
			if (s.libraryID !== item.libraryID) continue;
			if (s.itemID === id && s.key === item.key) return item;
			if (s.itemID === item.parentItemID && s.attachmentIDs?.includes(id) && rt.selectedItem(message, s.itemID)) return item;
		}
		fail("附件不在发送时的选区或阅读器中。", "The attachment was outside the message selection and reader.");
	}
	function readerFor(item, message) {
		const snapshot = message?.reader;
		const match = readers().filter(r => r.itemID === item.id);
		if (snapshot?.attachmentID === item.id && snapshot.instanceID) return match.find(r => r._instanceID === snapshot.instanceID);
		return match.find(r => r.tabID && r.tabID === snapshot?.tabID) || match[0];
	}
	function openedPdf(item, message) {
		const reader = readerFor(item, message);
		const pdf = pdfApp(reader)?.pdfDocument;
		if (!pdf) fail("请在 Zotero 阅读器里打开这个 PDF 并等待载入。", "Open this PDF in Zotero and wait for it to load.");
		return { reader, pdf };
	}
	function pageFor(n, reader, pdf) {
		const index = n ?? pageNumber(reader);
		if (!Number.isSafeInteger(pdf.numPages) || pdf.numPages < 1) fail("PDF 页数尚未就绪。", "PDF page count is unavailable.");
		if (!Number.isSafeInteger(index) || index < 1 || index > pdf.numPages) fail("页码超出范围。", "Page number out of range.");
		return index;
	}
	function listOpen() {
		const loaded = readers();
		const documents = loaded.slice(0, 80).flatMap(r => {
			const it = Zotero.Items.get(r.itemID);
			return !it || it.deleted ? [] : [{ ...ref(it), loaded: true, tabID: r.tabID || null, title: cut(it.getDisplayTitle?.(), 160), page: pageNumber(r) }];
		});
		const loadedIDs = new Set(loaded.map(r => r.itemID));
		const tabs = main()?.Zotero_Tabs;
		let truncated = loaded.length > 80;
		for (const tab of tabs?.getState?.() || []) {
			if (tab.type !== "reader" || !tab.data?.itemID || loadedIDs.has(tab.data.itemID)) continue;
			if (documents.length === 80) { truncated = true; break; }
			const it = Zotero.Items.get(tab.data.itemID);
			if (it && !it.deleted) documents.push({ ...ref(it), loaded: false, title: cut(tab.title, 160), tabID: tabs.getTabIDByItemID?.(it.id) || null });
			loadedIDs.add(tab.data.itemID);
		}
		return { documents, truncated };
	}
	function publicContext(s) {
		if (!s) return { status: "no_reader" };
		if (s.unavailable) return { status: "unavailable" };
		const { highlight, docID: documentToken, ...details } = s;
		return { status: "open", ...details, canHighlightSelection: !!highlight };
	}
	async function bookmarkPage(pdf, node) {
		if (!node.dest || node.url) return null;
		try {
			const dest = typeof node.dest === "string" ? unwrap(await pdf.getDestination(node.dest)) : node.dest;
			const ref = dest?.[0];
			if (ref == null) return null;
			const index = Number.isInteger(ref) ? ref : await pdf.getPageIndex(ref);
			return Number.isSafeInteger(index) && index >= 0 && index < pdf.numPages ? index + 1 : null;
		} catch { return null; } // A broken bookmark should not hide the rest of the outline.
	}
	async function readPdf(args, message) {
		const item = attachment(message, args.attachmentID);
		const { reader, pdf } = openedPdf(item, message);
		if (args.action === "outline") {
			if (typeof pdf.getOutline !== "function") fail("此阅读器无法读取目录。", "Outline unavailable in this reader.");
			const entries = [];
			let truncated = false;
			async function walk(nodes, depth) {
				for (const node of nodes || []) {
					if (entries.length >= 60 || depth > 10) { truncated = true; break; }
					entries.push({ depth, title: cut(node.title, 100), page: await bookmarkPage(pdf, node) });
					if (node.items?.length) await walk(node.items, depth + 1);
				}
			}
			await walk(unwrap(await pdf.getOutline()), 0);
			return { ...ref(item), entries, truncated };
		}
		if (args.action === "image") {
			const page = pageFor(args.page, reader, pdf);
			const raster = await rasterPage(reader, pdf, page, true);
			return { ...ref(item), page, pageCount: pdf.numPages, width: raster.width, height: raster.height,
				image: { mimeType: "image/jpeg", data: raster.uri.slice(raster.uri.indexOf(",") + 1) } };
		}
		if (args.action !== "page_text") fail("无效的 PDF 操作。", "Unknown PDF action.");
		const page = pageFor(args.page, reader, pdf);
		if (typeof pdf.getPage !== "function") fail("此版本无法读取 PDF 单页。", "PDF page access unavailable.");
		const proxy = unwrap(await pdf.getPage(page));
		if (typeof proxy?.getTextContent !== "function") fail("此版本无法提取页面文字。", "Page text extraction unavailable.");
		const content = unwrap(await proxy.getTextContent());
		const offset = args.offset ?? 0;
		if (!Number.isSafeInteger(offset) || offset < 0) fail("文本偏移无效。", "Invalid text offset.");
		let seen = 0, text = "";
		for (const run of content.items) {
			if (typeof run.str !== "string") continue;
			const piece = run.str + (run.hasEOL ? "\n" : " ");
			if (seen + piece.length > offset) text += piece.slice(Math.max(0, offset - seen), Math.max(0, offset - seen) + textCap + 1 - text.length);
			seen += piece.length;
			if (text.length > textCap) break;
		}
		return { ...ref(item), page, pageCount: pdf.numPages, text: cut(text), nextOffset: text.length > textCap ? offset + textCap : null };
	}

	const annotationFields = a => ({ annotationID: a.id, key: a.key, type: a.annotationType,
		pageLabel: a.annotationPageLabel, text: cut(a.annotationText, 500), comment: cut(a.annotationComment, 500), color: a.annotationColor });
	function annotationFor(item, id) {
		const a = Number.isSafeInteger(id) && Zotero.Items.get(id);
		if (!a || a.deleted || !a.isAnnotation?.() || a.parentItemID !== item.id || a.libraryID !== item.libraryID)
			fail("标注已失效或不属于此附件。", "The annotation is missing or belongs to another attachment.");
		return a;
	}
	function readAnnotations(args, message) {
		const item = attachment(message, args.attachmentID);
		if (args.annotationID) {
			const a = annotationFor(item, args.annotationID);
			return { ...ref(item), ...annotationFields(a), text: cut(a.annotationText, 3200), comment: cut(a.annotationComment, 3200) };
		}
		const offset = args.offset ?? 0;
		if (!Number.isSafeInteger(offset) || offset < 0) fail("无效的起始位置。", "Invalid offset.");
		// Zotero 7/8 return item objects even when the second argument is supplied.
		const children = item.getAnnotations(false, true);
		const annotations = children.slice(offset, offset + 6).map(child =>
			annotationFields(annotationFor(item, typeof child === "number" ? child : child.id)));
		return { ...ref(item), annotations, total: children.length, nextOffset: offset + annotations.length < children.length ? offset + annotations.length : null };
	}

	async function rasterPage(reader, pdf, n, forModel) {
		const frame = view(reader).current?._iframeWindow;
		if (!frame?.document) fail("此窗口不支持页面图像。", "Page image unavailable in this window.");
		if (typeof pdf.getPage !== "function") fail("此版本无法读取 PDF 单页。", "PDF page access unavailable.");
		const page = unwrap(await pdf.getPage(n));
		if (!page?.getViewport || !page.render) fail("此版本无法渲染页面图像。", "Page image rendering unavailable.");
		const options = data => typeof Cu !== "undefined" ? Cu.cloneInto(data, frame, { wrapReflectors: true }) : data;
		const base = page.getViewport(options({ scale: 1 }));
		const scale = Math.min(2, 1200 / Math.max(base.width, base.height));
		if (!(scale > 0) || !Number.isFinite(scale)) throw new Error("Invalid PDF page bounds");
		const viewport = page.getViewport(options({ scale }));
		const canvas = frame.document.createElementNS("http://www.w3.org/1999/xhtml", "canvas");
		canvas.width = Math.max(1, Math.ceil(viewport.width));
		canvas.height = Math.max(1, Math.ceil(viewport.height));
		const params = typeof Cu !== "undefined" ? Cu.waiveXrays(Cu.createObjectIn(frame)) : {};
		try {
			params.canvasContext = canvas.getContext("2d");
			params.viewport = viewport;
			await page.render(params).promise;
			let uri = forModel ? canvas.toDataURL("image/jpeg", 0.8) : canvas.toDataURL("image/png");
			if (forModel) {
				const max = "data:image/jpeg;base64,".length + 4 * Math.floor(1024000 / 3);
				if (uri.length > max) uri = canvas.toDataURL("image/jpeg", 0.45);
				if (uri.length > max || !uri.startsWith("data:image/jpeg;base64,")) fail("页图超过传输上限或编码不受支持。", "Page image exceeds the transfer limit or encoding is unavailable.");
			}
			return { uri, width: canvas.width, height: canvas.height };
		} finally {
			canvas.width = canvas.height = 0;
		}
	}
	async function showPageImage(item, reader, pdf, n) {
		const hostDoc = reader._window?.document || main()?.document;
		if (!hostDoc) fail("此窗口不支持页面预览。", "Page preview is unavailable in this window.");
		const { uri } = await rasterPage(reader, pdf, n, false);
		const make = tag => hostDoc.createElementNS("http://www.w3.org/1999/xhtml", tag);
		const overlay = make("dialog");
		if (!overlay.showModal) fail("此窗口不支持页面预览。", "Page preview unavailable.");
		overlay.setAttribute("aria-label", t("PDF 页面预览", "PDF page preview"));
		overlay.style.cssText = "max-width:92vw;max-height:90vh;border:0;padding:10px;color:CanvasText;background:Canvas";
		const img = make("img");
		img.src = uri;
		img.alt = "#" + item.id + " · " + n;
		img.style.cssText = "display:block;object-fit:contain;max-width:85vw;max-height:75vh";
		const close = make("button");
		close.textContent = t("关闭预览", "Close preview");
		close.addEventListener("click", () => overlay.close());
		overlay.addEventListener("close", () => overlay.remove(), { once: true });
		overlay.append(img, close);
		hostDoc.documentElement.appendChild(overlay);
		try { overlay.showModal(); } catch (e) { overlay.remove(); throw e; }
		return t("已显示页面图像", "Displayed page image") + " · #" + item.id + " · " + n;
	}

	function ensureSame(message, orig) {
		const it = attachment(message, orig.id);
		if (it.key !== orig.key || it.libraryID !== orig.libraryID || (it.parentItemID || null) !== orig.parentID)
			fail("附件已变更。", "Attachment changed.");
		return it;
	}
	function plan(name, detail, execute, selected = true) {
		return { rows: [{ id: "action", name, detail, selected, execute }], notes: [] };
	}
	function openWindows() {
		const win = main();
		return readers().filter(r => !r.tabID && r._instanceID && r._window && r._window !== win && typeof r._window.focus === "function");
	}
	function tabInventory(start = 0) {
		const tabs = main()?.Zotero_Tabs;
		const available = Array.isArray(tabs?._tabs);
		const entries = available ? tabs._tabs : [];
		const windows = openWindows();
		const end = start + 100;
		const truncated = Math.max(entries.length, windows.length) > end;
		return {
			tabsAvailable: available,
			tabs: entries.slice(start, end).map(tab => ({ tabID: tab.id, type: tab.type,
				title: cut(tab.title, 160), itemID: tab.data?.itemID || null, active: tabs.selectedID === tab.id })),
			windows: windows.slice(start, end).map(r => ({ instanceID: r._instanceID, attachmentID: r.itemID,
				title: cut(Zotero.Items.get(r.itemID)?.getDisplayTitle?.(), 160) })),
			truncated, nextOffset: truncated ? end : null
		};
	}
	function switchSurface(args) {
		const win = main(), tabs = win?.Zotero_Tabs;
		const windowTarget = args.action === "focus_window";
		if (!(windowTarget ? args.instanceID : args.tabID)) fail("请指定列出的标签页或窗口 ID。", "Specify a listed tabID or instanceID.");
		const lookup = () => windowTarget
			? openWindows().find(r => r._instanceID === args.instanceID)
			: Array.isArray(tabs?._tabs) && tabs._tabs.find(tab => tab.id === args.tabID);
		const surface = lookup();
		if (!win || !surface || (!windowTarget && (typeof tabs.select !== "function" || typeof win.focus !== "function"))) {
			fail("目标标签页或窗口不可用。", "Target tab or reader window unavailable.");
		}
		const destination = windowTarget ? surface._window : win;
		const itemID = () => windowTarget ? surface.itemID : surface.data?.itemID;
		const originalID = itemID(), item = originalID && Zotero.Items.get(originalID);
		const key = item?.key, libraryID = item?.libraryID;
		const label = windowTarget ? t("切换至阅读器窗口", "Focus reader window") : t("切换标签页", "Switch tab");
		const detail = [windowTarget ? args.instanceID : args.tabID, originalID && "#" + originalID,
			cut(item?.getDisplayTitle?.() || surface.title, 160)].filter(Boolean).join(" · ");
		return plan(label, detail, async () => {
			const current = originalID && Zotero.Items.get(originalID);
			if (win.closed || destination.closed || main() !== win || lookup() !== surface || itemID() !== originalID ||
				(windowTarget && surface._window !== destination) ||
				(originalID && (!current || current.deleted || current.key !== key || current.libraryID !== libraryID))) {
				fail("待切换的标签页或窗口已关闭或变更。", "Target tab or window closed or changed.");
			}
			if (windowTarget) destination.focus();
			else {
				win.focus();
				await tabs.select(args.tabID);
				if (tabs.selectedID !== args.tabID) fail("未能切换标签页。", "Tab selection was not applied.");
			}
			return label + " · " + detail;
		});
	}
	function selectedDocument(message, requestedID) {
		if (requestedID != null || !message?.selection?.length) return attachment(message, requestedID);
		const candidates = new Set();
		for (const row of message.selection) {
			const item = rt.selectedItem(message, row.itemID);
			const ids = item.isFileAttachment?.() ? [item.id] : row.attachmentIDs || [];
			for (const id of ids) {
				const file = Zotero.Items.get(id);
				if (file?.attachmentReaderType && !file.deleted && file.libraryID === item.libraryID && (id === item.id || file.parentItemID === item.id)) {
					candidates.add(id);
				}
			}
		}
		if (candidates.size !== 1) fail("请从选区中指定一个可阅读的 attachmentID。", "Specify one supported attachmentID from the selection.");
		return attachment(message, candidates.values().next().value);
	}
	function navigate(args, message) {
		if (args.action === "switch_tab" || args.action === "focus_window") return switchSurface(args);
		const item = args.action === "open_window" ? selectedDocument(message, args.attachmentID) : attachment(message, args.attachmentID);
		const id = item.id;
		const identity = { id, key: item.key, libraryID: item.libraryID, parentID: item.parentItemID || null };
		const name = t("阅读器", "Reader");
		if (args.action === "open" || args.action === "open_window") {
			if (!item.attachmentReaderType) fail("该附件没有内置阅读器。", "No built-in reader for this attachment.");
			const inWindow = args.action === "open_window";
			const label = inWindow ? t("在独立阅读器窗口打开", "Open in separate reader window") : t("打开文档", "Open document");
			const detail = [label, "#" + id, cut(item.getDisplayTitle?.(), 160)].filter(Boolean).join(" · ");
			return plan(name, detail, async () => {
				if (!ensureSame(message, identity).attachmentReaderType || typeof Zotero.Reader?.open !== "function")
					fail("该附件没有内置阅读器。", "No built-in reader for this attachment.");
				if (inWindow) {
					// allowDuplicate prevents an unloaded tab from intercepting this request.
					const reader = await Zotero.Reader.open(id, null, { openInWindow: true, allowDuplicate: true });
					if (!reader || reader.tabID || reader.itemID !== id || !reader._window || reader._window === main() || reader._window.closed || typeof reader._window.focus !== "function") {
						fail("无法核实独立阅读器窗口是否已打开。", "Could not verify the separate reader window.");
					}
					reader._window.focus();
					return label + " · #" + id;
				}
				await Zotero.Reader.open(id);
				return t("已请求打开文档", "Requested document open") + " · #" + id;
			});
		}
		const { reader, pdf } = openedPdf(item, message);
		let target, detail, location;
		if (args.action === "annotation") {
			target = annotationFor(item, args.annotationID).key;
			detail = t("跳至标注", "Go to annotation") + " · #" + args.annotationID;
			location = { annotationID: target };
		} else if (args.action === "page" || args.action === "page_image") {
			const n = pageFor(args.page, reader, pdf);
			detail = (args.action === "page" ? t("跳至第", "Go to page") : t("本地预览页图", "Preview page image locally")) + " " + n;
			location = { pageIndex: n - 1 };
		} else fail("无效的阅读器操作。", "Unknown reader action.");
		return plan(name, "#" + id + " · " + detail, async () => {
			const current = ensureSame(message, identity);
			const open = openedPdf(current, message);
			if (open.reader !== reader || open.pdf !== pdf) fail("阅读器已关闭或文档已重新加载。", "Reader closed or document reloaded.");
			if (target && annotationFor(current, args.annotationID).key !== target) fail("标注已变更。", "Annotation changed.");
			if (args.action === "page_image") return showPageImage(current, reader, pdf, location.pageIndex + 1);
			await reader.navigate(location);
			return "#" + id + " · " + detail;
		});
	}

	function locateItem(args, message) {
		const libraryID = message.libraryID || message.reader?.libraryID || rt.libraryID(message);
		const lookup = () => {
			const it = Zotero.Items.get(args.itemID);
			if (!it || !it.key || it.deleted || it.libraryID !== libraryID) fail("条目不在这次对话的文献库中。", "Item missing from the captured library.");
			return it;
		};
		const it = lookup(), key = it.key;
		const title = t("在文献库中定位", "Show in library");
		return plan(title, "#" + it.id + " · " + cut(it.getDisplayTitle?.(), 250), async () => {
			if (lookup().key !== key) fail("条目标识已变更。", "Item identity changed.");
			const pane = main()?.ZoteroPane;
			if (!pane?.selectItems || !await pane.selectItems([it.id])) fail("无法选中条目。", "Could not select the item.");
			return title + " · #" + it.id;
		});
	}

	function editableAnnotation(parent, id) {
		rt.assertEditable(parent);
		const a = annotationFor(parent, id);
		rt.assertEditable(a);
		if (a.annotationIsExternal) fail("外部标注只读。", "External annotation is read-only.");
		return a;
	}
	function annotationStamp(a) {
		return JSON.stringify([a.key, a.dateModified, a.annotationPosition, a.annotationText, a.annotationColor, a.annotationComment, a.getTags()]);
	}
	function editAnnotations(args, message) {
		const item = attachment(message, args.attachmentID);
		const identity = { id: item.id, key: item.key, libraryID: item.libraryID, parentID: item.parentItemID || null };
		rt.assertEditable(item);
		const color = args.color;
		if (color != null && !/^#[a-fA-F0-9]{6}$/.test(color)) fail("无效的标注颜色。", "Invalid annotation color.");
		if (args.comment != null && (typeof args.comment !== "string" || args.comment.length > 2000))
			fail("标注批注最多 2000 个字符。", "A comment can contain up to 2000 characters.");
		if (args.action === "highlight" || args.action === "underline") {
			const s = message.reader;
			if (s?.attachmentID !== item.id || s.key !== item.key || s.libraryID !== item.libraryID || !s.highlight || s.truncated)
				fail("请在 PDF 中划选一段文字后重新发送。", "Select a passage in the PDF and send a new message.");
			const { reader, pdf } = openedPdf(item, message);
			if (s.docID !== docID(pdf) || s.highlight.position.pageIndex >= pdf.numPages)
				fail("选区对应的 PDF 已更换，请重新划选。", "Selected PDF changed; select the passage again.");
			const name = args.action === "highlight" ? t("高亮选中文字", "Highlight selection") : t("为选区加下划线", "Underline selection");
			const finalColor = color || "#ffd400";
			const detail = "#" + item.id + " · p." + (s.highlight.position.pageIndex + 1) + " · " + s.selectedText +
				" · " + finalColor + (args.comment ? " · " + args.comment : "");
			return plan(name, detail, async () => {
				const current = ensureSame(message, identity);
				const active = openedPdf(current, message);
				if (active.reader !== reader || active.pdf !== pdf) fail("PDF 已重新加载，请重新划选。", "PDF reloaded; select the passage again.");
				rt.assertEditable(current);
				const key = Zotero.DataObjectUtilities.generateKey();
				if (Zotero.Items.getByLibraryAndKey(current.libraryID, key)) throw new Error("Annotation key collision");
				const a = await Zotero.Annotations.saveFromJSON(current, { key, type: args.action, ...s.highlight,
					text: s.selectedText, comment: args.comment || "", color: finalColor, tags: [] });
				return name + " · #" + a.id + " · " + a.key + " · " + detail;
			});
		}
		if (args.action !== "update" && args.action !== "remove") fail("无效的标注操作。", "Unknown annotation action.");
		const annotation = editableAnnotation(item, args.annotationID);
		const stamp = annotationStamp(annotation);
		const remove = args.action === "remove";
		const name = remove ? t("永久删除标注", "Permanently remove annotation") : t("更新标注", "Update annotation");
		const changes = [];
		if (!remove && color != null && annotation.annotationColor !== color) changes.push({ field: "annotationColor", label: t("颜色", "Color"), to: color });
		if (!remove && args.comment != null && annotation.annotationComment !== args.comment) changes.push({ field: "annotationComment", label: t("批注", "Comment"), to: args.comment });
		if (!remove && !changes.length) return { rows: [], notes: [t("标注没有需要更新的字段。", "No annotation fields need updating.")] };
		const description = remove ? cut(annotation.annotationText || annotation.annotationComment, 300) :
			changes.map(c => c.label + " · " + (annotation[c.field] || "∅") + " → " + (c.to || "∅")).join(" · ");
		const detail = "#" + annotation.id + " · " + description;
		return plan(name, detail, async () => {
			const current = editableAnnotation(ensureSame(message, identity), args.annotationID);
			if (annotationStamp(current) !== stamp) fail("确认前标注已变更。", "Annotation changed since review.");
			if (remove) await current.eraseTx();
			else {
				const before = changes.map(c => current[c.field]);
				try {
					for (const c of changes) current[c.field] = c.to;
					await current.saveTx();
				} catch (e) {
					for (const [i, c] of changes.entries()) current[c.field] = before[i];
					throw e;
				}
			}
			return name + " · " + detail;
		}, !remove);
	}

	const id = { type: "integer", minimum: 1 };
	const offset = { type: "integer", minimum: 0 };
	function tool(name, domain, zh, en, actions, fields, run, reviewed = false, required = []) {
		const properties = { ...fields };
		if (actions) properties.action = { type: "string", enum: actions };
		const spec = { name, domain, source: "deepread", floatingChat: true, description: en, descriptionZh: zh,
			inputSchema: { type: "object", properties, required: actions ? ["action", ...required] : required, additionalProperties: false },
			annotations: { readOnlyHint: !reviewed }, run };
		if (reviewed) Object.assign(spec, { risk: "medium", confirm: "apply_selected", apply: (p, ids) => rt.applyRows(p, ids) });
		DeepRead.registerTool(spec);
	}
	tool("deepread_reader_context", "context", "读取阅读器、页码、选中文字、打开的文档、标签页和独立阅读器窗口 ID。",
		"Read the captured or current reader, page and selected text; list documents or open_tabs with tabID and separate reader instanceID. Page through open_tabs using nextOffset.", ["snapshot", "live", "open_documents", "open_tabs"], { offset },
		(args, message) => {
			if (args.action === "open_tabs") return tabInventory(args.offset);
			if (args.action === "open_documents") return listOpen();
			if (args.action === "live") return { ...publicContext(capture(activeWindow())), queriedAt: Date.now() };
			if (args.action === "snapshot") return publicContext(message.reader);
			fail("无效的上下文操作。", "Unknown context action.");
		});
	tool("deepread_read_pdf", "pdf", "读取已打开 PDF 的目录、单页文字或适合视觉模型的单页图像。页码从 1 开始，offset 可继续读文字。",
		"Read the outline, page text or a bounded page image for visual analysis from an open PDF. Pages start at 1. Continue text with nextOffset.", ["page_text", "outline", "image"],
		{ attachmentID: id, page: id, offset }, readPdf);
	tool("deepread_reader_navigate", "reader", "确认后打开文档或独立窗口、切换标签页或阅读器窗口、跳至页码或标注、预览页图。",
		"Open a selected document or separate reader window, switch_tab by tabID or focus_window by instanceID from open_tabs, navigate to a PDF page (1-based) or annotation, or preview a page image after review.",
		["open", "open_window", "switch_tab", "focus_window", "page", "annotation", "page_image"], { attachmentID: id, page: id, annotationID: id,
			tabID: { type: "string", minLength: 1, maxLength: 150 }, instanceID: { type: "string", minLength: 1, maxLength: 150 } }, navigate, true);
	tool("deepread_read_annotations", "annotations", "列出选中文件或活动文档的标注，按 annotationID 读取批注及原文。",
		"List annotations on a selected attachment or the captured reader. Read details by annotationID. Page through results with offset.",
		null, { attachmentID: id, annotationID: id, offset }, readAnnotations);
	tool("deepread_locate_item", "ui", "在 Zotero 文献库内定位指定条目。", "Select and show an item in the captured Zotero library tab after review.",
		null, { itemID: id }, locateItem, true, ["itemID"]);
	tool("deepread_edit_annotations", "annotations", "用发送时的 PDF 划选范围创建高亮或下划线，更新批注或颜色，或确认后删除标注。",
		"Prepare a highlight/underline on the captured PDF selection, update a comment/color, or review permanent removal of an annotation.",
		["highlight", "underline", "update", "remove"], { attachmentID: id, annotationID: id, comment: { type: "string", maxLength: 2000 },
			color: { type: "string", pattern: "^#[a-fA-F0-9]{6}$" } }, editAnnotations, true);
})();
